import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { MultiplayerAuthority } = await importBundled('src/net/MultiplayerAuthority.ts',
  'melee-authority');
const { KingVine } = await importBundled('src/boss/KingVine.ts', 'melee-guardian');

function fixture() {
  const net = new MultiplayerAuthority();
  const events = [];
  const sent = [];
  let hits = 0;
  net.g = { clock: { elapsed: 1 }, player: { state: 'active',
    position: new THREE.Vector3(), eyePosition: new THREE.Vector3(0, 1.7, 0) },
    input: { enabled: true }, bus: { emit: (name, payload) => events.push({ name, payload }) } };
  net.encounters = { resolveMelee: () => { hits++; return { outcome: 'hit', target: 'mimic' }; },
    tryHit: () => { hits++; } };
  net.kingVine = null;
  net.tools = { activeId: 'hand' };
  net.interaction = { carried: null };
  net.shop = { open: false };
  net.transport = { id: 'host', send: (...args) => sent.push(args) };
  net.connected = true;
  net.isHost = true;
  net.remotes.set('guest', { targetPos: new THREE.Vector3(), height: 1.7,
    state: 'active', busy: false, carrying: null, toolId: 'hand', hasPlayerPacket: true });
  net.authority = { nearPeer: () => true, holdingFor: () => ({ carried: -1 }) };
  net.sendSnapshot = () => {};
  return { net, events, sent, get hits() { return hits; } };
}

test('host resolves one local swing and reports its identity and result', () => {
  const f = fixture();
  f.net.tryMelee(new THREE.Vector3(0, 1.7, 0), new THREE.Vector3(0, 0, 1), 1);
  assert.equal(f.hits, 1);
  assert.deepEqual(f.events.at(-1), { name: 'tool:meleeResult', payload: {
    swingId: 1, outcome: 'hit', target: 'mimic', point: undefined } });
});

test('host rejects replayed or spoofed remote melee and old melee hit routes', () => {
  const f = fixture();
  const intent = { kind: 'melee', playerId: 'guest', rid: 3,
    melee: { swingId: 1, origin: [0, 1.7, 0], direction: [0, 0, 1] } };
  f.net.applyIntent(intent, 'guest');
  f.net.applyIntent({ ...intent, rid: 4 }, 'guest');
  f.net.applyIntent({ ...intent, rid: 5, melee: { ...intent.melee,
    swingId: 2, origin: [30, 1.7, 0] } }, 'guest');
  f.net.applyIntent({ kind: 'encounter', playerId: 'guest', rid: 6,
    encounter: { kind: 'hit', strike: 'melee', origin: [0, 1.7, 0],
      direction: [0, 0, 1], actorId: 'guest' } }, 'guest');
  assert.equal(f.hits, 1);
  assert.equal(f.sent.filter(([m]) => m.kind === 'melee').length, 3);
  assert.equal(f.sent[0][0].outcome, 'hit');
});

test('client presents only a validated host result', () => {
  const f = fixture();
  f.net.onResult({ kind: 'melee', rid: 8, swingId: 4, ok: true,
    outcome: 'blocked', target: 'snapjaw', point: [1, 2, 3] });
  const result = f.events.at(-1);
  assert.equal(result.name, 'tool:meleeResult');
  assert.equal(result.payload.swingId, 4);
  assert.equal(result.payload.outcome, 'blocked');
  assert.deepEqual(result.payload.point.toArray(), [1, 2, 3]);
});

test('host requires an active free-handed mallet user for remote damage', () => {
  for (const state of [
    { toolId: 'aircannon' }, { carrying: 'apple' }, { state: 'captured' }, { busy: true },
  ]) {
    const f = fixture();
    Object.assign(f.net.remotes.get('guest'), state);
    f.net.applyIntent({ kind: 'melee', playerId: 'guest', rid: 10,
      melee: { swingId: 1, origin: [0, 1.7, 0], direction: [0, 0, 1] } }, 'guest');
    assert.equal(f.hits, 0);
    assert.equal(f.net.meleeStats.rejected, 1);
  }
});

test('guardian accepts a bounded mallet-head edge contact during recovery', () => {
  const boss = new KingVine({ center: [0, 0, 4.7] });
  boss.phase = 'recover';
  const origin = [0, 1.7, 0];
  const direction = [0, 0, 1];
  assert.equal(boss.canStrike(origin, direction, 'melee'), true);
  assert.equal(boss.tryHit(origin, direction, 'melee', 'solo')?.kind, 'stem');
});

test('host ledger refuses a swing when a packet falsely claims empty hands', () => {
  const f = fixture();
  f.net.authority.holdingFor = () => ({ carried: 7 });
  f.net.applyIntent({ kind: 'melee', playerId: 'guest', rid: 11,
    melee: { swingId: 1, origin: [0, 1.7, 0], direction: [0, 0, 1] } }, 'guest');
  assert.equal(f.hits, 0);
  assert.equal(f.net.meleeStats.lastReason, 'inactive');
});
