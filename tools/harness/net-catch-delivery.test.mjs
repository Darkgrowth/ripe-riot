import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { MultiplayerAuthority } = await importBundled(
  'src/net/MultiplayerAuthority.ts', 'net-catch-delivery-authority');

function fixture() {
  const sent = [], caught = [];
  const net = new MultiplayerAuthority();
  net.isHost = true; net.connected = true;
  net.transport = { id: 'host', send: (packet, to) => sent.push({ packet, to }) };
  net.g = { clock: { elapsed: 10 }, player: { state: 'active',
    position: new THREE.Vector3(10, 0, 0), eyeHeight: 1.7, body: {} },
  physics: { raycast: () => null }, bus: { emit() {} } };
  net.remotes.set('rescuer', { id: 'rescuer', targetPos: new THREE.Vector3(), height: 1.82,
    state: 'active', busy: false, carrying: null, toolId: 'net',
    hasPlayerPacket: true, recoveryUntil: 0 });
  net.remotes.set('victim', { id: 'victim', targetPos: new THREE.Vector3(0, .8, 2.8),
    height: 1.82, state: 'active', busy: false, carrying: null, toolId: 'hand',
    hasPlayerPacket: true, recoveryUntil: 0, flingId: 2 });
  net.authority = { holdingFor: () => ({ carried: -1, bought: new Set(['net']) }) };
  net.encounters = { setTargets() {},
    flyingVictim: (victim, flingId) => victim === 'victim' && flingId === 2,
    canNetCatch: (victim, flingId) => victim === 'victim' && flingId === 2,
    finishNetCatch: (...args) => { caught.push(args); return true; } };
  // Periodic player/snapshot broadcasts are outside nomination validation.
  net.sendPlayerPacket = () => {};
  net.sendSnapshot = () => {};
  const catches = () => sent.filter(({ packet }) => packet.t === 'netCaught');
  const results = () => sent.filter(({ packet }) => packet.t === 'result'
    && packet.kind === 'netCatch');
  const step = (elapsed) => { net.g.clock.elapsed = elapsed; net.fixedStep(1 / 60); };
  return { net, sent, caught, catches, results, step };
}

function compressedDelivery(net, request = {}, start = {}) {
  // A guest can progress several fixed steps in one synchronous render frame.
  // Both ordered packets then reach the host before its next simulation tick.
  net.onMessage({ t: 'intent', from: 'rescuer', intent: {
    kind: 'netSwingStart', playerId: 'rescuer', rid: 1, swingId: 4, ...start } });
  net.onMessage({ t: 'intent', from: 'rescuer', intent: {
    kind: 'netCatch', playerId: 'rescuer', rid: 2,
    catch: { victimId: 'victim', flingId: 2, swingId: 4,
      origin: [0, 1.7, 0], aim: [0, 0, 1], ...request } } });
}

test('compressed guest delivery waits for the host swing window and finishes after victim acknowledgement', () => {
  const f = fixture();
  compressedDelivery(f.net);
  assert.equal(f.catches().length, 0, 'receiving a nomination grants no early catch');
  assert.equal(f.results().length, 0, 'an early nomination remains pending rather than permanently failing');
  f.step(10.05);
  assert.equal(f.catches().length, 0, 'host simulated wind-up still gates the catch');
  assert.equal(f.results().length, 0);
  f.step(10.066666666666666);
  assert.equal(f.catches().length, 1, 'host retries the nomination inside its own active window');
  assert.deepEqual(f.results().map(({ packet, to }) => ({ rid: packet.rid, ok: packet.ok, to })),
    [{ rid: 2, ok: true, to: 'rescuer' }]);
  assert.equal(f.catches()[0].to, 'victim');
  assert.deepEqual(f.caught, [], 'a reservation is not completed before the victim stops');
  const { catchId, flingId } = f.catches()[0].packet;
  f.net.onMessage({ t: 'netCatchAck', from: 'victim', catchId, flingId, stopped: true });
  assert.deepEqual(f.caught, [['victim', 2]]);
  f.step(10.1);
  assert.equal(f.catches().length, 1, 'the deferred nomination is consumed once');
  assert.equal(f.results().length, 1);
});

test('a deferred guest nomination cannot catch a victim that landed before the host window opens', () => {
  const f = fixture();
  compressedDelivery(f.net);
  assert.equal(f.results().length, 0, 'receipt must leave the nomination pending');
  // Encounter metadata can outlive the physical flight by a packet. The current
  // victim packet is decisive even while flyingVictim still reports this ID.
  f.net.remotes.get('victim').flingId = 0;
  f.step(10.066666666666666);
  assert.equal(f.catches().length, 0);
  assert.equal(f.results().length, 1);
  assert.equal(f.results()[0].packet.ok, false);
  assert.deepEqual(f.caught, []);
});

for (const invalidation of ['victim moved', 'rescuer moved', 'new obstruction']) {
  test(`a deferred guest nomination revalidates current geometry: ${invalidation}`, () => {
    const f = fixture();
    compressedDelivery(f.net);
    assert.equal(f.results().length, 0, 'receipt must leave the nomination pending');
    if (invalidation === 'victim moved') f.net.remotes.get('victim').targetPos.z = 9;
    if (invalidation === 'rescuer moved') f.net.remotes.get('rescuer').targetPos.x = 9;
    if (invalidation === 'new obstruction') f.net.g.physics.raycast = () => ({ distance: .5 });
    f.step(10.066666666666666);
    assert.equal(f.catches().length, 0, 'receipt-time geometry must not authorize a later catch');
    assert.equal(f.results().length, 1);
    assert.equal(f.results()[0].packet.ok, false);
    assert.deepEqual(f.caught, []);
  });
}

for (const invalidation of ['cancelled swing', 'new swing', 'net stowed', 'window expired']) {
  test(`a deferred guest nomination cannot survive ${invalidation}`, () => {
    const f = fixture();
    compressedDelivery(f.net);
    assert.equal(f.results().length, 0);
    if (invalidation === 'cancelled swing') f.net.cancelNetSwing('rescuer');
    if (invalidation === 'new swing') f.net.onMessage({ t: 'intent', from: 'rescuer', intent: {
      kind: 'netSwingStart', playerId: 'rescuer', rid: 3, swingId: 5 } });
    if (invalidation === 'net stowed') f.net.remotes.get('rescuer').toolId = 'hand';
    f.step(invalidation === 'window expired' ? 10.3 : 10.066666666666666);
    assert.equal(f.catches().length, 0);
    assert.equal(f.results().length, 1);
    assert.equal(f.results()[0].packet.ok, false);
    f.step(10.4);
    assert.equal(f.results().length, 1, 'a refused nomination cannot revive later');
  });
}

test('guest timing claims cannot accelerate a deferred host catch', () => {
  const f = fixture();
  compressedDelivery(f.net, { phaseT: .17, elapsed: .17 }, { startedAt: 0 });
  assert.equal(f.catches().length, 0);
  assert.equal(f.results().length, 0);
  f.step(10.05);
  assert.equal(f.catches().length, 0);
  f.step(10.066666666666666);
  assert.equal(f.catches().length, 1);
  assert.equal(f.results()[0].packet.ok, true);
});

test('one deferred nomination per rescuer cannot be replaced by duplicate packets', () => {
  const f = fixture();
  compressedDelivery(f.net);
  compressedDelivery(f.net, { origin: [99, 1.7, 0] });
  assert.equal(f.results().length, 0, 'replayed request ID keeps its original pending nomination');
  f.net.onMessage({ t: 'intent', from: 'rescuer', intent: {
    kind: 'netCatch', playerId: 'rescuer', rid: 3,
    catch: { victimId: 'victim', flingId: 2, swingId: 4,
      origin: [99, 1.7, 0], aim: [0, 0, 1] } } });
  assert.deepEqual(f.results().map(({ packet }) => ({ rid: packet.rid, ok: packet.ok })),
    [{ rid: 3, ok: false }]);
  f.step(10.066666666666666);
  assert.equal(f.catches().length, 1);
  assert.deepEqual(f.results().map(({ packet }) => ({ rid: packet.rid, ok: packet.ok })),
    [{ rid: 3, ok: false }, { rid: 2, ok: true }]);
});

for (const invalidation of ['no current flight', 'outside the hoop']) {
  test(`an initially invalid nomination is refused instead of buffered: ${invalidation}`, () => {
    const f = fixture(), victim = f.net.remotes.get('victim');
    if (invalidation === 'no current flight') victim.flingId = 0;
    if (invalidation === 'outside the hoop') victim.targetPos.z = 9;
    compressedDelivery(f.net);
    assert.equal(f.results().length, 1, 'an early swing cannot make an invalid nomination pending');
    assert.equal(f.results()[0].packet.ok, false);
    victim.flingId = 2; victim.targetPos.z = 2.8;
    f.step(10.066666666666666);
    assert.equal(f.catches().length, 0, 'later eligibility cannot revive the refused request');
    assert.equal(f.results().length, 1);
  });
}

test('changing host discards a deferred nomination from the former authority', () => {
  const f = fixture();
  compressedDelivery(f.net);
  f.net.authority.reset = () => {};
  f.net.encounters.clearBaitFlights = () => {};
  f.net.hostId = 'new-host';
  f.net.applyHost();
  // Becoming active again must not revive requests from the former epoch.
  f.net.isHost = true;
  f.step(10.066666666666666);
  assert.equal(f.catches().length, 0);
  assert.equal(f.results().length, 0);
});
