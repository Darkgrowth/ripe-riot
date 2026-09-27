import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EncounterProjectileVisual, EncounterVisual } from
  '../../src/enemies/EncounterVisuals.ts';

const state = (phase, health = 2, timeLeft = 0) => ({
  kind: 'spitter', position: [-31, 0, -8], heading: 0, phase, timeLeft,
  health, baited: false, capturedVictimId: null, captureTimeLeft: 0,
});

test('voxel Spitter visibly braces, fires, relaxes, and reacts to a hit', () => {
  const scene = new THREE.Scene();
  const visual = new EncounterVisual('spitter', scene, 'voxel');
  const body = visual.root.getObjectByName('Spitter rooted anatomy');
  const head = visual.root.getObjectByName('Spitter firing head');
  const bulb = visual.root.getObjectByName('Spitter pressure bulb');
  const muzzle = visual.root.getObjectByName('Spitter muzzle');
  assert.ok(body && head && bulb && muzzle);
  let drawObjects = 0;
  visual.root.traverse(object => { if (object instanceof THREE.Mesh) drawObjects++; });
  assert.equal(drawObjects, 6, 'four authored surfaces plus warning ring and firing lane');
  visual.update(state('idle'), 0, 0.016);
  const idleBulb = bulb.scale.x;
  visual.update(state('warn', 2, 0.2), 0, 0.016);
  assert.ok(bulb.scale.x > idleBulb + 0.08, 'pressure bulb swells before the shot');
  const aimedHead = head.rotation.x;
  visual.update(state('attack', 2, 0.18), 0, 0.016);
  assert.ok(head.rotation.x > aimedHead + 0.20, 'firing creates a sharp recoil');
  const mouthOrigin = muzzle.getWorldPosition(new THREE.Vector3());
  assert.deepEqual(mouthOrigin.toArray(), [-31, 2.1, -8],
    'visible muzzle origin matches the authoritative projectile spawn');
  visual.update(state('recover', 2, 1.2), 0, 0.016);
  assert.ok(bulb.scale.x < idleBulb + 0.08, 'pressure releases after firing');
  visual.update(state('recover', 1, 1.1), 0, 0.016);
  assert.ok(Math.abs(body.rotation.z) > 0.04, 'damage has a distinct hit reaction');
  visual.dispose();
});

test('voxel Spitter remains wilted after defeat, including a loaded snapshot', () => {
  const scene = new THREE.Scene();
  const live = new EncounterVisual('spitter', scene, 'voxel');
  live.update(state('idle'), 0, 0.016);
  live.update(state('defeated', 0), 0, 0.8);
  const liveBody = live.root.getObjectByName('Spitter rooted anatomy');
  assert.equal(live.root.visible, true);
  assert.ok(liveBody.rotation.x > 0.45, 'live plant folds after defeat');
  const loaded = new EncounterVisual('spitter', scene, 'voxel');
  loaded.update(state('defeated', 0), 0, 0.016);
  const loadedBody = loaded.root.getObjectByName('Spitter rooted anatomy');
  assert.equal(loaded.root.visible, true);
  assert.ok(loadedBody.rotation.x > 0.45, 'loaded defeat starts settled');
  const baseline = new EncounterVisual('spitter', scene, 'polygon');
  baseline.update(state('defeated', 0), 0, 0.016);
  assert.equal(baseline.root.visible, false);
  live.dispose();
  loaded.dispose();
  baseline.dispose();
});

test('voxel seed pod visual follows the authoritative projectile position', () => {
  const scene = new THREE.Scene();
  const projectile = new EncounterProjectileVisual(scene, 'voxel');
  const pod = projectile.root.getObjectByName('Spitter seed pod');
  assert.ok(pod);
  assert.equal(projectile.root.children.length, 1, 'one pod mesh replaces ball and halo');
  const shot = { id: 1, position: [-31, 2.1, -8], velocity: [3, 1, 10], timeLeft: 1 };
  projectile.update(shot, 0.016);
  assert.deepEqual(projectile.root.position.toArray(), shot.position);
  const bounds = new THREE.Box3().setFromObject(pod);
  assert.ok(bounds.getSize(new THREE.Vector3()).length() < 1.25,
    'visible pod remains compact relative to the 0.85m collision tolerance');
  projectile.dispose();
});
