import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { FruitAuthority } = await importBundled('src/net/FruitAuthority.ts', 'expedition-fruit-authority');
const { MultiplayerAuthority } = await importBundled('src/net/MultiplayerAuthority.ts', 'expedition-net-authority');

test('an orchard warning cannot claim attached fruit or displace existing cargo', () => {
  const fruit = { id: 1, state: 'attached', position: new THREE.Vector3(), radius: .4,
    mass: 1, def: { attachStrength: 1 }, hasTrait: () => false,
    pickUp() { this.state = 'carried'; } };
  const held = { ...fruit, id: 2, state: 'carried', stow() { this.state = 'stowed'; } };
  let disturbances = 0;
  const authority = new FruitAuthority({ fruit: { get: id => id === 1 ? fruit : held,
    detachAuthoritative(f) { if (++disturbances > 1) f.state = 'free'; } },
    evaluate() {}, emit() {} });
  const holding = authority.holdingFor('guest');
  holding.carried = 2;
  assert.equal(authority.claim('guest', 1), 'wrong-phase');
  assert.equal(fruit.state, 'attached');
  assert.equal(holding.carried, 2);
  assert.deepEqual(holding.basket, []);
  assert.equal(authority.ownerOf(1), undefined);
  assert.equal(authority.claim('guest', 1), null);
  assert.equal(holding.carried, 1);
  assert.deepEqual(holding.basket, [2]);
});

function networkFixture() {
  const net = new MultiplayerAuthority();
  let settlements = 0;
  let cuts = 0;
  const sent = [];
  net.transport = { id: 'host', send: message => sent.push(message) };
  net.connected = true; net.isHost = true;
  net.authority = { nearPeer: () => true, holdingFor: () => ({ pos: new THREE.Vector3() }) };
  net.remotes.set('guest', { state: 'active', busy: false });
  net.progress = { isAtDock: p => p.length() < 7, confirmSettlement: () => ++settlements === 1 };
  net.legendary = { remoteCut: (vine, near, origin, direction) => {
    assert.ok(origin instanceof THREE.Vector3);
    assert.ok(direction instanceof THREE.Vector3);
    cuts++; return null;
  } };
  net.sendSnapshot = () => {};
  return { net, sent, get settlements() { return settlements; }, get cuts() { return cuts; } };
}

test('settlement requires a present active player at the dock and retains host idempotency', () => {
  const f = networkFixture();
  const intent = { kind: 'settle', playerId: 'guest', rid: 1 };
  f.net.authority.holdingFor = () => ({ pos: new THREE.Vector3(100, 0, 0) });
  f.net.applyIntent(intent, 'guest');
  assert.equal(f.settlements, 0);
  assert.equal(f.sent.at(-1).reason, 'out-of-reach');
  f.net.authority.holdingFor = () => ({ pos: new THREE.Vector3() });
  f.net.remotes.get('guest').state = 'downed';
  f.net.applyIntent(intent, 'guest');
  assert.equal(f.settlements, 0);
  f.net.remotes.get('guest').state = 'active';
  f.net.applyIntent(intent, 'guest');
  f.net.applyIntent(intent, 'guest');
  assert.equal(f.sent.at(-2).ok, true);
  assert.equal(f.sent.at(-1).reason, 'wrong-phase');
});

test('remote cuts require finite aim and forward it to the authoritative reach check', () => {
  const f = networkFixture();
  const intent = { kind: 'lcut', playerId: 'guest', rid: 2, vine: 0 };
  f.net.applyIntent(intent, 'guest');
  f.net.applyIntent({ ...intent, at: [0, NaN, 0], dir: [0, 0, 1] }, 'guest');
  f.net.applyIntent({ ...intent, at: [0, 12, 0], dir: [0, 0, 1] }, 'guest');
  assert.equal(f.cuts, 0);
  f.net.applyIntent({ ...intent, at: [0, 1.7, 0], dir: [0, 0, 1] }, 'guest');
  assert.equal(f.cuts, 1);
});

test('a warned harvest reconciles quietly and sends its warning without waiting for a periodic snapshot', () => {
  const f = networkFixture();
  let snapshots = 0, forfeits = 0, reconciled = 0, reattached = 0;
  f.net.authority.claim = () => 'wrong-phase';
  f.net.encounters = { harvestPrompt: () => 'Inspect the overloaded crop' };
  f.net.sendSnapshot = () => snapshots++;
  f.net.applyIntent({ kind: 'pick', playerId: 'guest', rid: 7, fruitId: 22 }, 'guest');
  assert.equal(snapshots, 1);
  f.net.pending.set(7, { kind: 'pick', fruitId: 22, ids: [22], plantId: 4, nodeIndex: 0 });
  f.net.interaction = { forfeit: () => forfeits++, reconcile: () => reconciled++ };
  f.net.fruitSys = { get: () => ({ id: 22 }), reattach: () => reattached++ };
  f.net.onResult({ kind: 'pick', rid: 7, ok: false, reason: 'wrong-phase' });
  assert.equal(forfeits, 0);
  assert.equal(reconciled, 1);
  assert.equal(reattached, 1);
});

function snapshotFixture() {
  const net = new MultiplayerAuthority();
  const events = [], sent = [];
  net.transport = { id: 'host', send: message => sent.push(message) };
  net.economy = { money: 400, discoveryTier: 0, discoveryPoints: 0,
    lifetimeEarned: 0, fruitSold: 0, bestSale: 0 };
  net.g = { has: () => false, bus: { emit: (...event) => events.push(event) } };
  net.authority = { goneIds: () => [] };
  net.fruitSys = { nodeSeq: 0, fruits: new Map(), freedByLog: new Set(),
    applyNodeChanges: () => true };
  net.packFruit = () => [];
  net.packRopes = () => [];
  net.applyRopes = () => {};
  net.nodeLogFor = () => [];
  return { net, events, sent };
}

test('host snapshots silently mirror expedition counters, including downward corrections', () => {
  const host = snapshotFixture(), guest = snapshotFixture();
  Object.assign(host.net.economy, { lifetimeEarned: 10437, fruitSold: 17, bestSale: 320 });
  host.net.sendSnapshot();
  guest.net.applySnapshot(host.sent.at(-1));
  for (const key of ['lifetimeEarned', 'fruitSold', 'bestSale']) {
    assert.equal(guest.net.economy[key], host.net.economy[key], key);
  }
  Object.assign(host.net.economy, { lifetimeEarned: 0, fruitSold: 0, bestSale: 0 });
  host.net.sendSnapshot();
  guest.net.applySnapshot(host.sent.at(-1));
  assert.equal(guest.net.economy.lifetimeEarned, 0);
  assert.equal(guest.net.economy.fruitSold, 0);
  assert.equal(guest.net.economy.bestSale, 0);
  assert.deepEqual(guest.events, [], 'mirroring must not replay sales or rewards');
});

test('missing or malformed expedition counters preserve the last valid host values', () => {
  const f = snapshotFixture();
  Object.assign(f.net.economy, { lifetimeEarned: 123, fruitSold: 4, bestSale: 50 });
  for (const economyStats of [undefined, null, [], 'bad',
    { lifetimeEarned: Infinity, fruitSold: -2, bestSale: NaN },
    { lifetimeEarned: '100', fruitSold: null, bestSale: {} }]) {
    f.net.applySnapshot({ economyStats });
    assert.equal(f.net.economy.lifetimeEarned, 123);
    assert.equal(f.net.economy.fruitSold, 4);
    assert.equal(f.net.economy.bestSale, 50);
  }
  assert.deepEqual(f.events, []);
});
