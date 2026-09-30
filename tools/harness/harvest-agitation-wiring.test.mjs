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
  net.remotes = new Map([['guest', { hasPlayerPacket: true, state: 'active',
    busy: false, carrying: null, toolId: 'aircannon' }]]);
  net.authority = { nearPeer: () => true, holdingFor: () => ({
    bought: new Set(['aircannon']), carried: -1,
  }) };
  net.g = { clock: { elapsed: 1 }, physics: { explode() {} },
    bus: { emit() {} }, has: name => name === 'director',
    get: () => ({ acceptAgitation: (...args) => calls.push(args) }) };
  net.transport = { id: 'host', send() {} };
  net.sendSnapshot = () => {};
  const intent = { kind: 'blast', playerId: 'guest', rid: 8, at: [-24, 2, 22],
    radius: 4, power: 4, upBias: .3 };
  net.applyIntent(intent, 'guest');
  net.applyIntent(intent, 'guest');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'remote-air:guest:8');
  assert.equal(calls[0][1], 'air-cannon');
  assert.deepEqual(calls[0][2].toArray(), [-24, 2, 22]);
});

test('host rejects a remote blast without an owned equipped cannon or a live player', () => {
  const explosions = [];
  const pressure = [];
  const net = new MultiplayerAuthority();
  const remote = { hasPlayerPacket: true, state: 'active', busy: false,
    carrying: null, toolId: 'hand' };
  const holding = { bought: new Set(), carried: -1, pos: new THREE.Vector3(-24, 2, 22) };
  net.remotes = new Map([['guest', remote]]);
  net.authority = { nearPeer: () => true, holdingFor: () => holding };
  net.g = { clock: { elapsed: 5 }, physics: { explode: (...args) => explosions.push(args) },
    bus: { emit() {} }, has: name => name === 'director',
    get: () => ({ acceptAgitation: (...args) => pressure.push(args) }) };
  net.transport = { id: 'host', send() {} };
  net.sendSnapshot = () => {};
  const shot = { kind: 'blast', playerId: 'guest', rid: 3, at: [-24, 2, 22],
    radius: 4, power: 4, upBias: .3 };
  net.applyIntent(shot, 'guest');
  holding.bought.add('aircannon');
  net.applyIntent({ ...shot, rid: 4 }, 'guest');
  remote.toolId = 'aircannon';
  remote.state = 'captured';
  net.applyIntent({ ...shot, rid: 5 }, 'guest');
  assert.equal(explosions.length, 0);
  assert.equal(pressure.length, 0);
  remote.state = 'active';
  net.applyIntent({ ...shot, rid: 6 }, 'guest');
  assert.equal(explosions.length, 1);
  assert.equal(pressure.length, 1);
});

test('host does not shake fruit for a remote peer without an owned equipped shaker', () => {
  let shakes = 0;
  const net = new MultiplayerAuthority();
  const position = new THREE.Vector3(-24, 1, 22);
  net.remotes = new Map([['guest', { hasPlayerPacket: true, state: 'active',
    busy: false, carrying: null, toolId: 'hand' }]]);
  net.fruitSys = { plants: { get: id => id === 12 || id === 13 ? { position } : null } };
  const holding = { bought: new Set(), carried: -1, pos: position };
  net.authority = { holdingFor: () => holding, shake: () => { shakes++; return 1; } };
  net.g = { clock: { elapsed: 5 }, has: () => false };
  net.transport = { id: 'host', send() {} };
  net.sendSnapshot = () => {};
  const request = { kind: 'shake', playerId: 'guest', plantId: 12, strength: 1.3 };
  net.applyIntent({ ...request, rid: 1 }, 'guest');
  holding.bought.add('shaker');
  net.applyIntent({ ...request, rid: 2 }, 'guest');
  assert.equal(shakes, 0);
  net.remotes.get('guest').toolId = 'shaker';
  net.applyIntent({ ...request, rid: 3 }, 'guest');
  assert.equal(shakes, 1);
});

test('one accepted remote cannon shot cannot be replayed but can shake a plant it hit', () => {
  let explosions = 0;
  let shakes = 0;
  const net = new MultiplayerAuthority();
  const position = new THREE.Vector3(-24, 1, 22);
  net.remotes = new Map([['guest', { hasPlayerPacket: true, state: 'active',
    busy: false, carrying: null, toolId: 'aircannon' }]]);
  net.fruitSys = { plants: { get: id => id === 12 || id === 13 ? { position } : null } };
  net.authority = {
    nearPeer: () => true,
    holdingFor: () => ({ bought: new Set(['aircannon']), carried: -1, pos: position }),
    shake: () => { shakes++; return 1; },
  };
  net.g = { clock: { elapsed: 5 }, physics: { explode: () => { explosions++; } },
    bus: { emit() {} }, has: () => false };
  net.transport = { id: 'host', send() {} };
  net.sendSnapshot = () => {};
  const shot = { kind: 'blast', playerId: 'guest', rid: 6, at: position.toArray(),
    radius: 4, power: 23.4, upBias: .3 };
  net.applyIntent(shot, 'guest');
  net.applyIntent(shot, 'guest');
  net.applyIntent({ kind: 'shake', playerId: 'guest', rid: 8, plantId: 12,
    strength: 1.0 }, 'guest');
  net.applyIntent({ kind: 'shake', playerId: 'guest', rid: 9, plantId: 12,
    strength: 1.0 }, 'guest');
  net.applyIntent({ kind: 'shake', playerId: 'guest', rid: 10, plantId: 13,
    strength: 2.1 }, 'guest');
  assert.equal(explosions, 1);
  assert.equal(shakes, 1);
});

test('host accepts two immediate full-charge cannon shots when recharge allows them', () => {
  let explosions = 0;
  const net = new MultiplayerAuthority();
  const position = new THREE.Vector3(-24, 1, 22);
  net.remotes = new Map([['guest', { hasPlayerPacket: true, state: 'active',
    busy: false, carrying: null, toolId: 'aircannon' }]]);
  net.authority = { nearPeer: () => true, holdingFor: () => ({
    bought: new Set(['aircannon']), carried: -1, pos: position,
  }) };
  net.g = { clock: { elapsed: 5 }, physics: { explode: () => { explosions++; } },
    bus: { emit() {} }, has: () => false };
  net.transport = { id: 'host', send() {} };
  net.sendSnapshot = () => {};
  const shot = { kind: 'blast', playerId: 'guest', at: position.toArray(),
    radius: 4.5, power: 45, upBias: .3 };
  net.applyIntent({ ...shot, rid: 10 }, 'guest');
  net.applyIntent({ ...shot, rid: 11 }, 'guest');
  net.applyIntent({ ...shot, rid: 12 }, 'guest');
  assert.equal(explosions, 2);
});

test('remote Air Cannon encounter damage needs one recently accepted blast', () => {
  const hits = [];
  const net = new MultiplayerAuthority();
  const position = new THREE.Vector3(-24, 1, 22);
  net.remotes = new Map([['guest', { hasPlayerPacket: true, state: 'active',
    busy: false, carrying: null, toolId: 'aircannon' }]]);
  net.authority = { nearPeer: () => true, holdingFor: () => ({
    bought: new Set(['aircannon']), carried: -1, pos: position,
  }) };
  net.encounters = { tryHit: (...args) => hits.push(args) };
  net.g = { clock: { elapsed: 5 }, physics: { explode() {} },
    bus: { emit() {} }, has: () => false };
  net.transport = { id: 'host', send() {} };
  net.sendSnapshot = () => {};
  const hit = { kind: 'encounter', playerId: 'guest', rid: 2,
    encounter: { kind: 'hit', strike: 'air', origin: position.toArray(),
      direction: [0, 0, 1] } };
  net.applyIntent(hit, 'guest');
  assert.equal(hits.length, 0);
  net.applyIntent({ kind: 'blast', playerId: 'guest', rid: 1,
    at: position.toArray(), radius: 4, power: 23.4, upBias: .3 }, 'guest');
  net.applyIntent(hit, 'guest');
  net.applyIntent(hit, 'guest');
  assert.equal(hits.length, 1);
});

test('remote cannon hits cannot point away from the accepted blast centre', () => {
  const hits = [];
  const vines = [];
  const net = new MultiplayerAuthority();
  const position = new THREE.Vector3(-24, 1, 22);
  net.remotes = new Map([['guest', { hasPlayerPacket: true, state: 'active',
    busy: false, carrying: null, toolId: 'aircannon' }]]);
  net.authority = { nearPeer: () => true, holdingFor: () => ({
    bought: new Set(['aircannon']), carried: -1, pos: position,
  }) };
  net.encounters = { tryHit: (...args) => hits.push(args) };
  net.kingVine = { tryHit: (...args) => vines.push(args) };
  net.g = { clock: { elapsed: 5 }, physics: { explode() {} },
    bus: { emit() {} }, has: () => false };
  net.transport = { id: 'host', send() {} };
  net.sendSnapshot = () => {};
  net.applyIntent({ kind: 'blast', playerId: 'guest', rid: 1,
    at: [-16, 1, 22], radius: 4, power: 23.4, upBias: .3 }, 'guest');
  const forged = { origin: position.toArray(), direction: [-1, 0, 0], strike: 'air' };
  net.applyIntent({ kind: 'encounter', playerId: 'guest', rid: 2,
    encounter: { kind: 'hit', ...forged } }, 'guest');
  net.applyIntent({ kind: 'vineHit', playerId: 'guest', rid: 3,
    vineHit: forged }, 'guest');
  assert.equal(hits.length, 0);
  assert.equal(vines.length, 0);
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
  net.remotes = new Map([['guest', { hasPlayerPacket: true, state: 'active',
    busy: false, carrying: null, toolId: 'shaker' }]]);
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

test('remote Tree Shaker follows primary cooldown and one shake per area plant', () => {
  let shakes = 0;
  const net = new MultiplayerAuthority();
  const position = new THREE.Vector3(-24, 1, 22);
  net.remotes = new Map([['guest', { hasPlayerPacket: true, state: 'active',
    busy: false, carrying: null, toolId: 'shaker' }]]);
  net.fruitSys = { plants: { get: id => [12, 13].includes(id) ? { position } : null } };
  net.authority = { holdingFor: () => ({ bought: new Set(['shaker']),
    carried: -1, pos: position }), shake: () => { shakes++; return 1; } };
  net.g = { clock: { elapsed: 5 }, has: () => false };
  net.transport = { id: 'host', send() {} };
  net.sendSnapshot = () => {};
  const request = { kind: 'shake', playerId: 'guest', plantId: 12 };
  net.applyIntent({ ...request, rid: 1, strength: 1.75 }, 'guest');
  net.applyIntent({ ...request, rid: 2, strength: 1.75 }, 'guest');
  assert.equal(shakes, 1);
  net.g.clock.elapsed = 5.85;
  net.applyIntent({ ...request, rid: 3, strength: 1.75 }, 'guest');
  assert.equal(shakes, 2);
  net.g.clock.elapsed = 6.7;
  net.applyIntent({ ...request, rid: 4, strength: 1.35 }, 'guest');
  net.applyIntent({ ...request, rid: 5, plantId: 13, strength: 1.2 }, 'guest');
  net.applyIntent({ ...request, rid: 6, strength: 1.35 }, 'guest');
  assert.equal(shakes, 4);
  net.g.clock.elapsed = 7.7;
  net.applyIntent({ ...request, rid: 7, strength: 1.35 }, 'guest');
  assert.equal(shakes, 4);
});
