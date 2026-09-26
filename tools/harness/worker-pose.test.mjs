import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as THREE from 'three';
import { solveTwoBone } from '../../src/player/WorkerPose.ts';
import { loadWorkerAsset, cloneWorkerVisual } from '../../src/player/WorkerAsset.ts';
import { DEFAULT_COLORS } from '../../src/player/PlayerRig.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.self ??= globalThis;
globalThis.createImageBitmap ??= async () => ({ width: 4, height: 1, close() {} });
globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
};

const close = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a-b) < tolerance, `${a} != ${b}`);

test('two-bone target reaches ordinary wrist and ankle targets with a stable pole', () => {
  const base = new THREE.Vector3(0, 0, 0);
  const target = new THREE.Vector3(0.35, -0.36, 0.12);
  const pole = new THREE.Vector3(1, 0, 0.5);
  const result = solveTwoBone(base, target, pole, 0.35, 0.35);
  close(result.joint.distanceTo(base), 0.35);
  close(result.joint.distanceTo(result.target), 0.35);
  close(result.target.distanceTo(target), 0);
  assert.ok(result.joint.x > 0, 'bend should face pole');
});

test('two-bone target clamps too-far and folded goals without NaNs or pole flips', () => {
  const base = new THREE.Vector3();
  const pole = new THREE.Vector3(1, 0, 0);
  for (const goal of [new THREE.Vector3(0, -10, 0),
                       new THREE.Vector3(0, -0.001, 0),
                       new THREE.Vector3(0, -0.59999, 0)]) {
    const r = solveTwoBone(base, goal, pole, 0.3, 0.3);
    assert.ok(r.joint.toArray().every(Number.isFinite));
    assert.ok(r.target.toArray().every(Number.isFinite));
    assert.ok(r.target.length() <= 0.6);
    assert.ok(r.joint.x > 0, 'pole bend changed sign');
  }
});

test('loaded worker clones share geometry but own palette materials and release them', async () => {
  const bytes = readFileSync(path.join(root, 'public/models/worker.glb'));
  await loadWorkerAsset(`data:application/octet-stream;base64,${bytes.toString('base64')}`);
  const blue = cloneWorkerVisual({ ...DEFAULT_COLORS,
    suit: new THREE.Color(0x247aca) });
  const red = cloneWorkerVisual({ ...DEFAULT_COLORS,
    suit: new THREE.Color(0xd34630) });
  assert.ok(blue.root.visible && blue.body.visible);
  assert.notEqual(blue.body, red.body);
  assert.notEqual(blue.body.skeleton, red.body.skeleton);
  assert.equal(blue.body.geometry, red.body.geometry);
  assert.notEqual(blue.body.material, red.body.material);
  assert.notEqual(blue.body.material.map, red.body.material.map);
  const geometry = blue.body.geometry;
  let geometryDisposed = false;
  geometry.addEventListener('dispose', () => { geometryDisposed = true; });
  blue.dispose();
  assert.equal(geometryDisposed, false);
  assert.ok(red.body.material.map, 'other avatar keeps palette');
  red.dispose();
});
