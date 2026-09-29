import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';
const { MultiplayerAuthority } = await importBundled('src/net/MultiplayerAuthority.ts', 'bait-authority');

function fixture() {
  const net = new MultiplayerAuthority();
  const events = [], sent = [], armed = [];
  const fruit = { id: 7, state: 'carried', position: new THREE.Vector3(), speed: 10 };
  let owner = 'guest';
  net.connected = true; net.isHost = true; net.hostId = 'host';
  net.transport = { id: 'host', send: (...args) => sent.push(args) };
  net.g = { clock: { elapsed: 1 }, player: { position: new THREE.Vector3() },
    bus: { emit: (name, payload) => events.push({ name, payload }) } };
  net.encounters = { trackThrownFruit: (...args) => armed.push(args),
    cancelThrownFruit: () => {}, offerBait: () => armed.push('spoof') };
  net.fruitSys = { get: () => fruit };
  net.authority = {
    holdingFor: () => ({ carried: fruit.state === 'carried' ? 7 : -1, pos: new THREE.Vector3() }),
    ownerOf: () => owner,
    nearPeer: () => true,
    release: () => { fruit.state = 'free'; owner = undefined; return null; },
  };
  net.remotes.set('guest', { state: 'active', busy: false });
  net.sendSnapshot = () => {};
  return { net, fruit, events, sent, armed };
}
test('new accepted remote throw arms once; its successful duplicate cannot rearm', () => {
  const { net, armed } = fixture();
  const intent = { kind: 'throw', playerId: 'guest', rid: 1, fruitId: 7, at: [0, 1, 0], vel: [10, 0, 0] };
  net.applyIntent(intent, 'guest');
  net.applyIntent({ ...intent, rid: 2 }, 'guest');
  assert.deepEqual(armed, [[7, 'guest']]);
});
test('drops, denied release and legacy arbitrary bait coordinates never arm bait', () => {
  const { net, armed } = fixture();
  net.applyIntent({ kind: 'drop', playerId: 'guest', rid: 1, fruitId: 7, vel: [10, 0, 0] }, 'guest');
  net.authority.release = () => 'not-yours';
  net.applyIntent({ kind: 'throw', playerId: 'guest', rid: 2, fruitId: 7, vel: [10, 0, 0] }, 'guest');
  net.applyIntent({ kind: 'encounter', playerId: 'guest', rid: 3,
    encounter: { kind: 'bait', actorId: 'guest', position: [0, 1, 0] } }, 'guest');
  assert.deepEqual(armed, []);
});
test('throw provenance reaches the host instead of being relabeled as drop', () => {
  const { net, sent } = fixture();
  net.isHost = false;
  net.noteRelease(7, new THREE.Vector3(0, 1, 0), new THREE.Vector3(10, 0, 0), true);
  assert.equal(sent[0][0].intent.kind, 'throw');
});
test('only current host can relay a bait cue; duplicate and invalid cues are ignored', () => {
  const { net, events } = fixture();
  net.isHost = false;
  const cue = { t: 'baitConfirmed', from: 'host', cue: 1,
    fruitId: 7, actorId: 'guest', position: [1, 1, 0] };
  net.onMessage({ ...cue, from: 'intruder' });
  net.onMessage(cue); net.onMessage(cue);
  net.onMessage({ ...cue, cue: 2, position: [NaN, 1, 0] });
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'encounter:baited');
  assert.equal(events[0].payload.actorId, 'guest');
});


test('unchanged host election preserves a flight, real authority changes clear it', () => {
  const { net } = fixture();
  let cleared = 0;
  net.encounters.clearBaitFlights = () => cleared++;
  net.authority.reset = () => {};
  net.promote = () => {};
  net.applyHost();
  assert.equal(cleared, 0, 'same incumbent must keep a thrown fruit eligible');
  net.hostId = 'guest';
  net.applyHost();
  assert.equal(cleared, 1, 'losing authority clears provenance');
  net.hostId = 'host';
  net.applyHost();
  assert.equal(cleared, 2, 'promotion starts without another host flight provenance');
});
