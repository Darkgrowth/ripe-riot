import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { MultiplayerAuthority } = await importBundled('src/net/MultiplayerAuthority.ts', 'chaos-network');
const { PlayerController } = await importBundled('src/player/PlayerController.ts', 'chaos-player');

function guestFixture() {
  const launches = [];
  const net = new MultiplayerAuthority();
  net.isHost = false;
  net.hostId = 'host-a';
  net.transport = { id: 'guest' };
  net.g = { player: { applyChaosLaunch: (velocity, source) => launches.push({ velocity, source }) },
    bus: { emit() {} } };
  return { net, launches };
}

test('only the current host can launch a guest and one event is applied once', () => {
  const { net, launches } = guestFixture();
  const packet = { t: 'chaosLaunch', from: 'host-a', impactId: 7,
    kind: 'mimic-charge', velocity: [7, 2, 1] };
  net.onMessage(packet);
  net.onMessage(packet);
  net.onMessage({ ...packet, impactId: 6 });
  net.onMessage({ ...packet, from: 'intruder', impactId: 8 });
  assert.equal(launches.length, 1);
  assert.deepEqual(launches[0].velocity.toArray(), [7, 2, 1]);
  assert.equal(launches[0].source, 'mimic-charge');
});

test('a promoted host has a new launch epoch and old-host packets stay stale', () => {
  const { net, launches } = guestFixture();
  net.onMessage({ t: 'chaosLaunch', from: 'host-a', impactId: 11,
    kind: 'mimic-charge', velocity: [5, 1, 0] });
  net.hostId = 'host-b';
  net.onMessage({ t: 'chaosLaunch', from: 'host-a', impactId: 12,
    kind: 'mimic-charge', velocity: [5, 1, 0] });
  net.onMessage({ t: 'chaosLaunch', from: 'host-b', impactId: 1,
    kind: 'mimic-charge', velocity: [4, 2, 0] });
  assert.equal(launches.length, 2);
  assert.equal(launches[1].source, 'mimic-charge');
});

test('invalid launch packets never add player velocity', () => {
  const { net, launches } = guestFixture();
  for (const velocity of [[Infinity, 1, 0], [NaN, 0, 0], [200, 0, 0],
    [0, 0], 'bad', null]) {
    net.onMessage({ t: 'chaosLaunch', from: 'host-a', impactId: 2,
      kind: 'mimic-charge', velocity });
  }
  assert.equal(launches.length, 0);
});

test('the host sends a targeted, numbered launch and cannot use an absent peer', () => {
  const sent = [];
  const net = new MultiplayerAuthority();
  net.isHost = true;
  net.connected = true;
  net.hostId = 'host-a';
  net.transport = { id: 'host-a', send: (packet, to) => sent.push({ packet, to }) };
  net.peers = ['guest'];
  assert.equal(net.launchPeer('missing', new THREE.Vector3(5, 2, 0), 'mimic-charge'), false);
  assert.equal(net.launchPeer('guest', new THREE.Vector3(5, 2, 0), 'mimic-charge'), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'guest');
  assert.equal(sent[0].packet.impactId, 1);
  assert.deepEqual(sent[0].packet.velocity, [5, 2, 0]);
});

test('player applies a launch without an immediate high-speed ragdoll', () => {
  const calls = [];
  const fake = { state: 'active', addImpulseVelocity: (...args) => calls.push(args) };
  assert.equal(PlayerController.prototype.applyChaosLaunch.call(fake,
    new THREE.Vector3(12, 3, 0), 'mimic-charge'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], false);
  assert.equal(calls[0][2], 'mimic-charge');
});

test('a Snapjaw packet releases the local capture revision before adding velocity', () => {
  const { net, launches } = guestFixture();
  const order = [];
  net.encounters = { releaseFromFling: (victim, flingId, revision) => {
    order.push(['release', victim, flingId, revision]); return true;
  } };
  net.g.player.applyChaosLaunch = (velocity, source) => {
    order.push(['launch', source]); launches.push({ velocity, source }); return true;
  };
  net.onMessage({ t: 'chaosLaunch', from: 'host-a', impactId: 4,
    kind: 'snapjaw-fling', velocity: [8, 5, 0], flingId: 2, encounterRevision: 50 });
  assert.deepEqual(order, [['release', 'guest', 2, 50], ['launch', 'snapjaw-fling']]);
  net.onMessage({ t: 'chaosLaunch', from: 'host-a', impactId: 5,
    kind: 'snapjaw-fling', velocity: [8, 5, 0] });
  assert.equal(launches.length, 1, 'unsequenced old packets cannot revive a hold');
});

test('host Snapjaw launches carry the same fling identity and revision as the model', () => {
  const sent = [];
  const net = new MultiplayerAuthority();
  net.isHost = true; net.connected = true; net.peers = ['victim'];
  net.transport = { id: 'host', send: (packet, to) => sent.push({ packet, to }) };
  assert.equal(net.launchPeer('victim', new THREE.Vector3(8, 5, 0), 'snapjaw-fling'), false);
  assert.equal(net.launchPeer('victim', new THREE.Vector3(8, 5, 0), 'snapjaw-fling', 3, 81), true);
  assert.equal(sent[0].to, 'victim');
  assert.equal(sent[0].packet.flingId, 3);
  assert.equal(sent[0].packet.encounterRevision, 81);
});
