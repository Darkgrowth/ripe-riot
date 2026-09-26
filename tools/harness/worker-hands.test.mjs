import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as THREE from 'three';
import { loadWorkerHands, toolHand, gripHand } from '../../src/render/WorkerHands.ts';
import { buildViewModel, VIEWMODEL_IDS } from '../../src/render/Viewmodel.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.self ??= globalThis;
globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
};
const bytes = readFileSync(path.join(root, 'public/models/worker-hands.glb'));
const assetUrl = `data:application/octet-stream;base64,${bytes.toString('base64')}`;

test('connected tool gloves clone and transform without mutating shared source', async () => {
  await loadWorkerHands(assetUrl);
  const left = toolHand('L', new THREE.Vector3(-.17, -.08, -.26), .25);
  const right = toolHand('R', new THREE.Vector3(.16, -.11, -.22), -.3);
  for (const geo of [left, right]) {
    assert.ok(geo.getAttribute('position').count > 80);
    for (const attr of ['position', 'normal', 'color'])
      assert.ok(geo.getAttribute(attr), `missing ${attr}`);
    assert.equal(geo.getAttribute('color').itemSize, 3);
    assert.ok(geo.getAttribute('color').getX(0) < .9,
      'authored glove color was lost in the GLB export');
    const colors = geo.getAttribute('color');
    const samples = Array.from({ length: colors.count }, (_, i) =>
      [colors.getX(i), colors.getY(i), colors.getZ(i)]);
    assert.ok(samples.some(([r, g]) => r > .68 && g > .38),
      'connected forearm sleeve is missing from glove geometry');
  }
  assert.ok(new THREE.Box3().setFromBufferAttribute(left.getAttribute('position')).min.x < 0);
  assert.ok(new THREE.Box3().setFromBufferAttribute(right.getAttribute('position')).max.x > 0);
  const secondLeft = toolHand('L', new THREE.Vector3(), 0);
  assert.notEqual(left, secondLeft);
  assert.ok(new THREE.Box3().setFromBufferAttribute(secondLeft.getAttribute('position')).getCenter(new THREE.Vector3()).length() < .2);
  left.dispose(); right.dispose(); secondLeft.dispose();
});

test('all existing tool IDs assemble with authored gloves and dispose their geometry', async () => {
  await loadWorkerHands(assetUrl);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true });
  for (const id of VIEWMODEL_IDS) {
    const vm = buildViewModel(id, material);
    const mesh = vm.root.children.find(o => o.isMesh);
    assert.ok(mesh?.geometry.getAttribute('color'), `${id}: missing merged colors`);
    let disposed = false;
    mesh.geometry.addEventListener('dispose', () => { disposed = true; });
    vm.dispose();
    assert.ok(disposed, `${id}: leaked geometry on swap`);
  }
  material.dispose();
});

test('left and right carry gloves have independent cupped geometry', async () => {
  await loadWorkerHands(assetUrl);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
  const left = gripHand(mat, 1), right = gripHand(mat, -1);
  assert.notEqual(left.geometry, right.geometry);
  assert.ok(left.geometry.getAttribute('position').count > 80);
  assert.ok(right.geometry.getAttribute('position').count > 80);
  assert.ok(new THREE.Box3().setFromBufferAttribute(left.geometry.getAttribute('position')).min.y < -.19,
    'cupped glove should continue into a connected forearm');
  left.geometry.dispose(); right.geometry.dispose(); mat.dispose();
});
