import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(async () => vite.close());
const { PropBuilder } = await vite.ssrLoadModule('/src/world/PropBuilder.ts');

test('static prop merge retains authored voxel colors and placement', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
  ], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1, 0, 0, 1,
  ], 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute([
    1, 0, 0, 0, 1, 0, 0, 0, 1,
  ], 3));
  const builder = new PropBuilder(null);
  builder.translate(2, 0, 3).meshColored(geometry);
  const merged = builder.finish();
  assert.ok(merged);
  const colors = merged.getAttribute('color');
  const positions = merged.getAttribute('position');
  assert.deepEqual([colors.getX(0), colors.getY(0), colors.getZ(0)], [1, 0, 0]);
  assert.deepEqual([colors.getX(1), colors.getY(1), colors.getZ(1)], [0, 1, 0]);
  assert.deepEqual([colors.getX(2), colors.getY(2), colors.getZ(2)], [0, 0, 1]);
  assert.deepEqual([positions.getX(0), positions.getZ(0)], [2, 3]);
  merged.dispose();
});
