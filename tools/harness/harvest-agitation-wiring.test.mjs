import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { IslandDirector } = await importBundled('src/systems/IslandDirector.ts', 'agitation-wiring');
const { AirCannon, TreeShaker } = await importBundled('src/tools/Tools.ts', 'agitation-air-cannon');
const { MultiplayerAuthority } = await importBundled('src/net/MultiplayerAuthority.ts', 'agitation-remote-blast');

test('only host-accepted deliberate rare fruit detachment adds pressure once', () => {
  const callbacks = new Map();
  const orchard = new THREE.Vector3(-24, 1, 22);
  const fruit = { authoritative: true, fruits: new Map([
    [1, { id: 1, variant: null, species: 'apple', position: orchard }],
    [2, { id: 2, variant: { id: 'golden' }, species: 'apple', position: orchard }],
    [3, { id: 3, variant: null, species: 'vinebomb', position: orchard }],
  ]), get(id) { return this.fruits.get(id); } };
  const g = { bus: { on(name, callback) { callbacks.set(name, callback); } },
    get(name) {
      if (name === 'fruit') return fruit;
      if (name === 'world') return { at: () => ({ position: orchard }) };
      if (name === 'legendary') return { phase: 'prepare', tethers: [] };
      throw new Error(name);
    }, has: () => false };
  const director = new IslandDirector();
  director.init(g);
  const detached = callbacks.get('fruit:detached');
  detached({ fruitId: 1, cause: 'hand' });
  assert.equal(director.getAgitationPresentation().pressure, 0);
  detached({ fruitId: 2, cause: 'island-event' });
  assert.equal(director.getAgitationPresentation().pressure, 0);
  detached({ fruitId: 2, cause: 'hand' });
  detached({ fruitId: 2, cause: 'hand' });
  assert.equal(director.getAgitationPresentation().pressure, 2);
  detached({ fruitId: 3, cause: 'hand' });
  assert.equal(director.getAgitationPresentation().pressure, 4);
  fruit.authoritative = false;
  detached({ fruitId: 2, cause: 'hand' });
  assert.equal(director.getAgitationPresentation().pressure, 4);
});

test('a fired Air Cannon records one accepted local action; a dry press records none', () => {
  const calls = [];
  const position = new THREE.Vector3(-24, 2, 22);
  const director = { acceptAgitation: (...args) => calls.push(args) };
  const game = {
    player: { position, velocity: new THREE.Vector3(), addImpulseVelocity() {} },
    playerCamera: { addShake() {}, addRecoil() {} },
    renderer: { setFovOffset() {} }, bus: { emit() {} },
    has: name => name === 'director', get: name => name === 'director' ? director : null,
  };
  const cannon = new AirCannon();
  cannon.attach({ game, fruit: { blast: () => 0 }, interaction: {} });
  cannon.onSecondary(true);
  cannon.onSecondary(true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'air-cannon');
  assert.deepEqual(calls[0][2].toArray(), position.toArray());
  cannon.recharge = 1;
  cannon.onSecondary(true);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0][0], calls[1][0], 'each accepted shot needs a unique ID');
});

test('host counts a validated remote blast once using the peer request ID', () => {
  const calls = [];
  const net = new MultiplayerAuthority();
  net.authority = { nearPeer: () => true };
  net.g = { clock: { elapsed: 1 }, physics: { explode() {} },
    bus: { emit() {} }, has: name => name === 'director',
    get: () => ({ acceptAgitation: (...args) => calls.push(args) }) };
  net.transport = { id: 'host', send() {} };
  net.sendSnapshot = () => {};
  const intent = { kind: 'blast', playerId: 'guest', rid: 8, at: [-24, 2, 22],
    radius: 4, power: 4, upBias: .3 };
  net.applyIntent(intent, 'guest');
  net.applyIntent(intent, 'guest');
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'remote-air:guest:8');
  assert.equal(calls[0][1], 'air-cannon');
  assert.deepEqual(calls[0][2].toArray(), [-24, 2, 22]);
});

test('Tree Shaker adds one local pressure action even when no fruit drops', () => {
  const calls = [];
  const position = new THREE.Vector3(-24, 1, 22);
  const game = {
    player: { id: 'solo', position }, playerCamera: { addShake() {} },
    bus: { emit() {} }, has: name => name === 'director',
    get: () => ({ acceptAgitation: (...args) => calls.push(args) }),
  };
  const shaker = new TreeShaker();
  shaker.attach({ game, interaction: {}, fruit: {
    plants: { all: () => [{ id: 12, position }] }, shake: () => 0,
  } });
  shaker.onSecondary(true);
  shaker.onSecondary(true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'tree-shaker');
  shaker.cooldown = 0;
  shaker.onSecondary(true);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0][0], calls[1][0]);
});

test('host counts equipped nearby remote Tree Shaker action once across area packets', () => {
  const calls = [];
  const position = new THREE.Vector3(-24, 1, 22);
  const net = new MultiplayerAuthority();
  net.remotes = new Map([['guest', { state: 'active', toolId: 'shaker' }]]);
  net.fruitSys = { plants: { get: id => id === 12 ? { position } : null } };
  net.authority = {
    holdingFor: () => ({ bought: new Set(['shaker']), carried: -1, pos: position }),
    shake: () => 0,
  };
  net.g = { clock: { elapsed: 1 }, has: name => name === 'director',
    get: () => ({ acceptAgitation: (...args) => calls.push(args) }) };
  net.transport = { id: 'host', send() {} };
  net.sendSnapshot = () => {};
  const shake = { kind: 'shake', playerId: 'guest', plantId: 12, strength: 1.3 };
  net.applyIntent({ ...shake, rid: 8 }, 'guest');
  net.applyIntent({ ...shake, rid: 9 }, 'guest');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'tree-shaker');
  net.g.clock.elapsed = 4;
  net.applyIntent({ ...shake, rid: 10 }, 'guest');
  assert.equal(calls.length, 2);
  net.remotes.get('guest').toolId = 'hand';
  net.applyIntent({ ...shake, rid: 11 }, 'guest');
  assert.equal(calls.length, 2);
});
