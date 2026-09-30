import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { MultiplayerAuthority } = await importBundled('src/net/MultiplayerAuthority.ts', 'net-catch-intent');

function fixture() {
  const sent = [];
  const net = new MultiplayerAuthority();
  net.connected = true;
  net.isHost = true;
  net.g = { clock: { elapsed: 10 }, player: { state: 'active' } };
  net.transport = { id: 'host', send: (...args) => sent.push(args) };
  net.tools = { activeId: 'net', owned: new Set(['net']) };
  net.interaction = { carried: null };
  net.authority = { holdingFor: () => ({ carried: -1, bought: new Set(['net']) }) };
  net.remotes.set('guest', { targetPos: new THREE.Vector3(), state: 'active',
    busy: false, carrying: null, toolId: 'net', hasPlayerPacket: true });
  net.sendSnapshot = () => {};
  return { net, sent };
}

test('host timestamps a remote equipped net swing and refuses replay', () => {
  const { net } = fixture();
  const start = { kind: 'netSwingStart', playerId: 'guest', rid: 1, swingId: 4 };
  net.applyIntent(start, 'guest');
  assert.equal(net.netCatchGuard.catch('guest', 4, 10.12, true), true);
  net.applyIntent({ ...start, rid: 2 }, 'guest');
  assert.equal(net.netCatchGuard.catch('guest', 4, 10.14, true), false);
});

test('an unequipped, captured, or unowned remote net cannot arm the catch', () => {
  for (const patch of [{ toolId: 'hand' }, { state: 'captured' }, { busy: true }]) {
    const { net } = fixture();
    Object.assign(net.remotes.get('guest'), patch);
    net.applyIntent({ kind: 'netSwingStart', playerId: 'guest', rid: 1, swingId: 1 }, 'guest');
    assert.equal(net.netCatchGuard.catch('guest', 1, 10.12, true), false);
  }
  const { net } = fixture();
  net.authority.holdingFor = () => ({ carried: -1, bought: new Set() });
  net.applyIntent({ kind: 'netSwingStart', playerId: 'guest', rid: 1, swingId: 1 }, 'guest');
  assert.equal(net.netCatchGuard.catch('guest', 1, 10.12, true), false);
});

test('a local host net swing uses the same guard and capture cancels it', () => {
  const { net } = fixture();
  assert.equal(net.beginNetSwing(1), true);
  assert.equal(net.netCatchGuard.catch('host', 1, 10.13, true), true);
  assert.equal(net.beginNetSwing(2), true);
  net.cancelNetSwing('host');
  assert.equal(net.netCatchGuard.catch('host', 2, 10.13, true), false);
});
