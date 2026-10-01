import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';
const { MultiplayerAuthority } = await importBundled('src/net/MultiplayerAuthority.ts', 'orchard-authority');
const { HarvestExtraction } = await importBundled('src/systems/HarvestExtraction.ts', 'orchard-net-ledger');
const { EventBus } = await importBundled('src/core/Events.ts', 'orchard-authority-bus');

test('orchard starter tools remain legal without a shop and other tools remain unavailable', () => {
  const net = new MultiplayerAuthority();
  net.world = { orchardRun: true };
  net.tools = { owned: new Set(['hand', 'aircannon', 'net', 'ropegun']) };
  assert.equal(net.purchasedList(), 'aircannon,net');
});

function remoteFixture() {
  const net = new MultiplayerAuthority(), events = [], explosions = [];
  net.world = { orchardRun: true };
  const holding = { bought: new Set(['aircannon']), carried: -1, basket: [], pos: new THREE.Vector3(-20, 1, 20) };
  net.authority = { nearPeer: () => true, holdingFor: () => holding, shake: () => null };
  net.remotes = new Map([['guest', { hasPlayerPacket: true, state: 'active', busy: false,
    carrying: null, toolId: 'aircannon', wiped: false }]]);
  net.g = { clock: { elapsed: 5 }, has: () => false,
    bus: { emit: (...args) => events.push(args) }, physics: { explode: (...args) => explosions.push(args) } };
  net.transport = { id: 'host', send() {} }; net.sendSnapshot = () => {};
  return { net, holding, events, explosions };
}

test('validated remote cannon clears nearby stuck loose fruit once; rejected cannon cannot', () => {
  const { net, explosions } = remoteFixture();
  const freed = [];
  net.fruitSys = { fruits: new Map([[7, { id: 7, state: 'free', stuck: true, body: {},
    position: new THREE.Vector3(-20, 1, 20), unstick: () => freed.push(7) }],
    [8, { id: 8, state: 'free', stuck: true, body: {}, position: new THREE.Vector3(50, 1, 50),
      unstick: () => freed.push(8) }]]) };
  const shot = { kind: 'blast', playerId: 'guest', rid: 1, at: [-20, 1, 20], radius: 4, power: 4, upBias: .3 };
  net.remotes.get('guest').toolId = 'hand'; net.applyIntent(shot, 'guest');
  assert.deepEqual(freed, []);
  net.remotes.get('guest').toolId = 'aircannon'; net.applyIntent({ ...shot, rid: 2 }, 'guest');
  net.applyIntent({ ...shot, rid: 2 }, 'guest');
  assert.deepEqual(freed, [7]);
  assert.equal(explosions.length, 1);
});

test('orchard bare hand tree shake accepts only a close active empty-handed peer', () => {
  const { net, holding } = remoteFixture(); let shakes = 0;
  net.fruitSys = { plants: { get: () => ({ position: new THREE.Vector3(-20, 1, 20) }) } };
  net.authority.shake = () => { shakes++; return null; };
  const intent = { kind: 'shake', playerId: 'guest', plantId: 3, strength: .55 };
  net.applyIntent({ ...intent, rid: 1 }, 'guest');
  assert.equal(shakes, 1);
  holding.pos.set(50, 1, 50); net.applyIntent({ ...intent, rid: 2 }, 'guest');
  assert.equal(shakes, 1);
});

test('only a wiped peer can forfeit its own ledger cargo; arbitrary IDs cannot destroy another haul', () => {
  const { net, holding, events } = remoteFixture(); const removed = [], gone = [];
  const fruits = new Map([[1, { id: 1, state: 'stowed', species: 'apple', value: () => 20 }],
    [2, { id: 2, state: 'carried', species: 'puffmelon', value: () => 100 }],
    [3, { id: 3, state: 'stowed', species: 'apple', value: () => 25 }]]);
  net.fruitSys = { get: id => fruits.get(id), remove: f => { removed.push(f.id); fruits.delete(f.id); } };
  net.authority.ownerOf = id => id === 3 ? 'host' : 'guest';
  net.authority.destroyed = id => gone.push(id);
  holding.basket = [1, 3]; holding.carried = 2;
  net.applyIntent({ kind: 'forfeit', playerId: 'guest', fruitIds: [3], rid: 1 }, 'guest');
  assert.deepEqual(removed, []);
  const guest = net.remotes.get('guest'); guest.state = 'downed'; guest.wiped = true;
  net.applyIntent({ kind: 'forfeit', playerId: 'guest', fruitIds: [3], rid: 2 }, 'guest');
  assert.deepEqual(removed, [1, 2]); assert.deepEqual(gone, [1, 2]);
  assert.equal(fruits.has(3), true);
  assert.equal(events.filter(([name]) => name === 'fruit:destroyed').length, 2);
});

test('guest evacuation transmits the wiped pose before the owner-derived forfeit request', () => {
  const net = new MultiplayerAuthority(), sent = [];
  net.world = { orchardRun: true }; net.connected = true; net.isHost = false;
  net.transport = { id: 'guest', send: m => sent.push(m) };
  net.vitals = { wiped: true }; net.fruitSys = { nodeSeq: 0 };
  net.interaction = { carried: null, basket: { items: [{ id: 7 }] } };
  net.tools = { owned: new Set(['hand', 'net', 'aircannon']), activeId: 'hand' };
  net.g = { clock: { elapsed: 2 }, has: () => false,
    player: { state: 'downed', position: new THREE.Vector3(), yaw: 0, height: 1.82, catchableFlingId: 0 } };
  net.forfeitCargo([999]);
  assert.equal(sent[0].t, 'player'); assert.equal(sent[0].wiped, true); assert.equal(sent[0].s, 'downed');
  assert.equal(sent[1].intent.kind, 'forfeit');
  assert.equal(sent[1].intent.fruitIds, undefined, 'the host derives IDs from its own ledger');
});

test('custom co-op room names are separated by mode before opening transport', () => {
  const channels = [];
  const oldChannel = globalThis.BroadcastChannel, oldWindow = globalThis.window;
  globalThis.BroadcastChannel = class { constructor(name) { channels.push(name); } postMessage() {} close() {} };
  globalThis.window = { setInterval: () => 1, clearInterval() {} };
  try {
    const expedition = new MultiplayerAuthority(); expedition.world = { orchardRun: false };
    expedition.connect = t => t.close(); expedition.openRoom('shared');
    const orchard = new MultiplayerAuthority(); orchard.world = { orchardRun: true };
    orchard.connect = t => t.close(); orchard.openRoom('shared');
    assert.notEqual(channels[0], channels[1]);
    expedition.openRoom('orchard-v1:shared');
    assert.equal(new Set(channels).size, 3, 'a custom prefixed expedition room must not collide with Orchard');
  } finally { globalThis.BroadcastChannel = oldChannel; globalThis.window = oldWindow; }
});

test('a guest cannot bank fruit after the host has finished the extraction', () => {
  const { net } = remoteFixture(); let sales = 0;
  net.g.has = name => name === 'extraction'; net.g.get = () => ({ finished: true });
  net.authority.sell = () => { sales++; return { deny: null, ids: [], count: 1, total: 100, values: [] }; };
  net.applyIntent({ kind: 'sell', playerId: 'guest', fruitIds: [1], rid: 1 }, 'guest');
  assert.equal(sales, 0);
});

test('host snapshots deliver the full extraction ledger to guests and ignore non-host injection', () => {
  function peer(isHost) {
    const net = new MultiplayerAuthority(), run = new HarvestExtraction(), messages = [];
    const fruit = { nodeSeq: 0, freedByLog: new Set(), fruits: new Map(), applyNodeChanges: () => true,
      restoreRunFruitIds() {}, get: () => undefined };
    const economy = { money: 0, discoveryTier: 0, discoveryPoints: 0, lifetimeEarned: 0, fruitSold: 0, bestSale: 0 };
    const interaction = { carried: null, basket: { items: [] } };
    const world = { sellPad: new THREE.Vector3(-7, 1, 27), sellRadius: 3.2 };
    const systems = { extraction: run, net, fruit, world, interaction };
    const g = { clock: { elapsed: 0, paused: false }, bus: new EventBus(),
      player: { position: world.sellPad.clone(), state: 'active' }, has: n => n in systems, get: n => systems[n] };
    net.g = g; net.connected = true; net.isHost = isHost; net.hostId = 'host';
    net.transport = { id: isHost ? 'host' : 'guest', send: m => messages.push(m) };
    net.fruitSys = fruit; net.economy = economy; net.interaction = interaction;
    net.authority = { goneIds: () => [] }; net.ropes = { ropes: new Map() };
    net.packFruit = () => []; net.packRopes = () => []; net.nodeLogFor = () => [];
    run.init(g);
    return { net, run, g, messages };
  }
  const host = peer(true), guest = peer(false);
  host.g.bus.emit('fruit:sold', { fruitId: 12, value: 500, species: 'boulderplum' });
  host.run.finish(); host.net.sendSnapshot();
  const state = host.messages[0];
  guest.net.onMessage({ ...state, from: 'intruder' }); assert.equal(guest.run.banked, 0);
  guest.net.onMessage({ ...state, from: 'host' });
  assert.equal(guest.run.banked, 500); assert.equal(guest.run.finished, true);
  assert.deepEqual(guest.run.netState().cargo, { boulderplum: 1 });
  assert.deepEqual(guest.run.consumedIds, [12]);
});
