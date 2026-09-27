import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { keepSnapjawOutsideView, SNAPJAW_CAPTURE_VIEW_DISTANCE } from '../../src/player/SnapjawCaptureView.ts';
import { voxelSnapjawLowerJaw, voxelSnapjawUpperJaw, voxelSnapjawTeeth } from '../../src/enemies/VoxelSnapjawGeometry.ts';

test('capture view moves out of the jaw without changing gaze or player position', () => {
  const eye = new THREE.Vector3(0.12, 1.7, 0.7);
  const playerPosition = eye.clone();
  const jaw = new THREE.Vector3(0, 0, 0);
  keepSnapjawOutsideView(eye, jaw, 0);
  assert.ok(Math.hypot(eye.x, eye.z) >= SNAPJAW_CAPTURE_VIEW_DISTANCE - 1e-6);
  assert.equal(eye.y, 1.7);
  assert.deepEqual(playerPosition.toArray(), [0.12, 1.7, 0.7]);
});

test('capture view leaves a clear view alone and handles a centered bite', () => {
  const jaw = new THREE.Vector3(4, 0, 7);
  const clear = new THREE.Vector3(4, 1.7, 10);
  keepSnapjawOutsideView(clear, jaw, 0);
  assert.deepEqual(clear.toArray(), [4, 1.7, 10]);
  const centered = new THREE.Vector3(4, 1.7, 7);
  keepSnapjawOutsideView(centered, jaw, Math.PI / 2);
  assert.ok(Math.abs(centered.x - (4 + SNAPJAW_CAPTURE_VIEW_DISTANCE)) < 1e-6);
  assert.equal(centered.z, 7);
});

test('front and side bites keep the lens outside the authored voxel jaw', () => {
  const jaws = [voxelSnapjawLowerJaw(), voxelSnapjawUpperJaw(), voxelSnapjawTeeth()];
  const jawRadius = Math.max(...jaws.map(geometry => {
    const positions = geometry.getAttribute('position');
    let radius = 0;
    for (let i = 0; i < positions.count; i++)
      radius = Math.max(radius, Math.hypot(positions.getX(i), positions.getZ(i)));
    geometry.dispose();
    return radius;
  }));
  // Test the shipped jaw meshes, so growing a lip later cannot silently put
  // the lens back inside the model during a captured bite.
  const jaw = new THREE.Vector3();
  for (const angle of [-1, -0.5, 0, 0.5, 1]) {
    const eye = new THREE.Vector3(Math.sin(angle) * 1.15, 1.7, Math.cos(angle) * 1.15);
    keepSnapjawOutsideView(eye, jaw, 0);
    assert.ok(Math.hypot(eye.x, eye.z) - jawRadius >= 0.9,
      `lens gap at angle ${angle}`);
  }
});
