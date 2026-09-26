import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeVoxelWorker, makeVoxelPatch } from '../../src/proof/VoxelWorld.ts';

test('worker reads as one connected voxel body at the established character scale', () => {
  const worker = makeVoxelWorker();
  assert.equal(worker.connectedComponents, 1,
    'the body, face, cap, boots and gloves must meet as one authored volume');
  assert.ok(worker.mesh.isMesh, 'visible worker should be one batched surface');
  const box = worker.mesh.geometry.boundingBox;
  assert.ok(box.max.y - box.min.y > 1.75 && box.max.y - box.min.y < 2.2,
    'worker should remain near the current game silhouette height');
  assert.ok(worker.mesh.geometry.getAttribute('color')?.count > 100,
    'the exposed faces need their authored pixel palette');
});

test('orchard proof is a compact batched terrain patch with attached voxel trees', () => {
  const patch = makeVoxelPatch();
  assert.ok(patch.terrain.isMesh);
  assert.ok(patch.treeMeshes.length >= 2);
  assert.ok(patch.treeMeshes.every(tree => tree.isMesh));
  assert.ok(patch.group.children.length < 30,
    'the proof must not add one draw object per voxel');
  const box = patch.terrain.geometry.boundingBox;
  assert.ok(box.max.x - box.min.x > 12 && box.max.z - box.min.z > 9);
  assert.ok(patch.groundY(0, 0) > patch.waterY,
    'the worker path should sit above the shoreline');
});
