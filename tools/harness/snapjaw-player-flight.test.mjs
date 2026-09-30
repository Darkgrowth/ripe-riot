import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { PlayerController } = await importBundled('src/player/PlayerController.ts', 'snapjaw-player-flight');

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
