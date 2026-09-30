import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { MultiplayerAuthority } = await importBundled('src/net/MultiplayerAuthority.ts', 'snapjaw-avatar');

test('a remote held victim follows the jaw instead of their stale player packet', () => {
  const net = new MultiplayerAuthority();
  net.encounters = { snapshot: () => ({ encounters: [{ kind: 'snapjaw',
    position: [0, 0, 0], heading: 0, capturedVictimId: 'guest' }], flights: [] }) };
  const posed = [];
  const rig = { root: new THREE.Group(), poseActive: input => posed.push(input) };
  const remote = { id: 'guest', state: 'captured', pos: new THREE.Vector3(30, 0, 30),
    yaw: 0, height: 1.82, lastMoveAt: -Infinity, carrying: null, busy: false, rig };
  net.poseRig(remote);
  assert.equal(posed.length, 1);
  assert.ok(posed[0].position.z > 1.2 && posed[0].position.y > .45,
    'the held worker should protrude from the mouth at gameplay camera scale');
  assert.ok(Math.abs(posed[0].position.x) > .25,
    'a slight side offset makes the worker visible beside the teeth');
  assert.ok(Math.abs(rig.root.rotation.x) > .3, 'held avatar needs an authored tilted pose');
});

test('a remote flying victim keeps a flight pose until the flight expires', () => {
  const net = new MultiplayerAuthority();
  let remaining = 1;
  net.encounters = { snapshot: () => ({ encounters: [],
    flights: [{ victimId: 'guest', flingId: 2, remaining }] }) };
  const rig = { root: new THREE.Group(), poseActive: () => {} };
  const remote = { id: 'guest', state: 'active', pos: new THREE.Vector3(1, 2, 3),
    yaw: 0, height: 1.82, lastMoveAt: -Infinity, carrying: null, busy: false, rig };
  net.poseRig(remote);
  assert.ok(Math.abs(rig.root.rotation.x) > .2);
  remaining = 0;
  rig.root.rotation.set(0, 0, 0);
  net.poseRig(remote);
  assert.equal(rig.root.rotation.x, 0);
});
