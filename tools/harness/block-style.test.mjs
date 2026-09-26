import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBlockWorker, makeBlockPatch } from '../../src/proof/BlockWorld.ts';

test('block-study worker remains one connected batched character at game scale', () => {
  const worker = makeBlockWorker();
  assert.equal(worker.connectedComponents, 1);
  assert.equal(worker.mesh.isMesh, true);
  const box = worker.mesh.geometry.boundingBox;
  assert.ok(box.max.y - box.min.y > 1.7 && box.max.y - box.min.y < 2.2);
  assert.ok(worker.mesh.geometry.getAttribute('color')?.count > 100);
});

test('block-study world is a small patch with batched square trees', () => {
  const patch = makeBlockPatch();
  assert.equal(patch.terrain.isMesh, true);
  assert.ok(patch.treeMeshes.length >= 2);
  assert.ok(patch.treeMeshes.every(tree => tree.isMesh));
  assert.ok(patch.treeMeshes.every(tree => tree.userData.connectedComponents === 1),
    'trunk, canopy and fruit should form connected tree volumes');
  assert.ok(patch.group.children.length < 20, 'no individual voxel scene objects');
  const box = patch.terrain.geometry.boundingBox;
  assert.ok(box.max.x - box.min.x > 12 && box.max.z - box.min.z > 9);
  assert.ok(patch.groundY(0, 0) > patch.waterY);
});
