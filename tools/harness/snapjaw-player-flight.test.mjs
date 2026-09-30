import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { importBundled } from './import-bundled.mjs';

const { PlayerController } = await importBundled('src/player/PlayerController.ts', 'snapjaw-player-flight');
const { PhysicsWorld } = await importBundled('src/physics/PhysicsWorld.ts', 'snapjaw-flight-physics');
const { Groups } = await importBundled('src/physics/Layers.ts', 'snapjaw-flight-layers');

function barePlayer() {
  const player = Object.create(PlayerController.prototype);
  player.state = 'active';
  player.velocity = new THREE.Vector3();
  player.grounded = true;
  return player;
}

test('a host fling releases capture before velocity, and a confirmed net catch damps it once', () => {
  const player = barePlayer();
  player.state = 'captured';
  player.velocity.set(0, 0, 0);
  assert.equal(player.applyChaosLaunch(new THREE.Vector3(8, 5, 0), 'snapjaw-fling'), true);
  assert.equal(player.state, 'active');
  assert.deepEqual(player.velocity.toArray(), [8, 5, 0]);
  assert.ok(Math.abs(player.yaw + Math.PI / 2) < 1e-6,
    'the launched player should face the flight lane');
  assert.equal(player.stopChaosFlight(), true);
  assert.ok(player.velocity.x < 2 && player.velocity.y <= 1.2);
  assert.equal(player.stopChaosFlight(), false);
});

test('a Mimic shove cannot be net-caught and a downed victim cannot be launched', () => {
  const player = barePlayer();
  player.velocity.set(0, 0, 0);
  assert.equal(player.applyChaosLaunch(new THREE.Vector3(8, 2, 0), 'mimic-charge'), true);
  assert.equal(player.stopChaosFlight(), false);
  player.state = 'downed';
  assert.equal(player.applyChaosLaunch(new THREE.Vector3(8, 2, 0), 'snapjaw-fling'), false);
});

test('Snapjaw’s new arc carries an actual player capsule clear of a flat jaw site', async t => {
  await PhysicsWorld.load();
  const physics = new PhysicsWorld(); physics.init();
  const floor = physics.createFixed(new THREE.Vector3(0, -0.25, 0));
  physics.attach(floor, RAPIER.ColliderDesc.cuboid(18, .25, 18), Groups.world);
  const player = new PlayerController(physics, 1, new THREE.Vector3(0, .1, 0));
  assert.equal(player.applyChaosLaunch(new THREE.Vector3(8, 8.6, 0),
    'snapjaw-fling', 1), true);
  assert.equal(player.catchableFlingId, 1);
  const idle = { moveX: 0, moveZ: 0, sprint: false, crouch: false,
    jump: false, jumpPressed: false };
  let peak = player.position.y;
  for (let i = 0; i < 60; i++) {
    player.step(idle, 1 / 60); physics.step();
    peak = Math.max(peak, player.position.y);
  }
  assert.ok(peak > 1.4, `throw should have a visible apex (peak ${peak})`);
  assert.ok(player.position.x > 5, `throw should travel at least 5 m (x ${player.position.x})`);
  assert.equal(player.state, 'active');
  assert.equal(player.catchableFlingId, 0,
    'the local flight identity must clear once the capsule lands');
  t.diagnostic(`flat-ground flight: peak ${peak.toFixed(2)} m, travel ${player.position.x.toFixed(2)} m`);
  player.dispose();
});
