import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// GLTFLoader's image path references browser globals even when we only inspect
// the mesh contract. The embedded 4-pixel palette image needs dimensions only.
globalThis.self ??= globalThis;
globalThis.createImageBitmap ??= async () => ({ width: 4, height: 1, close() {} });

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requiredBones = ['Pelvis', 'Spine', 'Chest', 'Neck', 'Head',
  'UpperArm_L', 'Forearm_L', 'Hand_L', 'UpperArm_R', 'Forearm_R', 'Hand_R',
  'Thigh_L', 'Shin_L', 'Foot_L', 'Thigh_R', 'Shin_R', 'Foot_R'];
const roles = ['suit', 'suitDark', 'skin', 'boots', 'gloves', 'hat', 'pack'];

async function load(name) {
  const file = path.join(root, 'public/models', name);
  assert.ok(existsSync(file), `missing exported asset: ${file}`);
  const bytes = readFileSync(file);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new GLTFLoader().parseAsync(buffer, '');
}

test('worker GLB has a single skinned connected-body object and stable bone/material contract', async () => {
  const gltf = await load('worker.glb');
  const meshes = [];
  gltf.scene.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
  assert.equal(meshes.filter(o => o.name === 'WorkerBody').length, 1,
    `skinned nodes: ${meshes.map(o => o.name).join(', ')}`);
  const body = meshes.find(o => o.name === 'WorkerBody');
  assert.ok(body.geometry.getAttribute('skinIndex'));
  assert.ok(body.geometry.getAttribute('skinWeight'));
  assert.ok(body.geometry.getAttribute('position').count > 300);
  for (const name of requiredBones) assert.ok(body.skeleton.getBoneByName(name), `missing ${name}`);
  const mats = new Set();
  gltf.scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) mats.add(m.name); });
  for (const role of roles) assert.ok(mats.has(role), `missing material role ${role}`);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const extents = [];
  gltf.scene.traverse(o => { if (o.isMesh) {
    const b = new THREE.Box3().setFromObject(o);
    extents.push(`${o.name}:${b.min.y.toFixed(2)}..${b.max.y.toFixed(2)}`);
  } });
  assert.ok(box.getSize(new THREE.Vector3()).y >= 1.65 && box.getSize(new THREE.Vector3()).y <= 1.95,
    `wrong worker height ${box.getSize(new THREE.Vector3()).y}: ${extents.join(' ')}`);
});

test('each tool/carry glove exports as one connected object with merge-ready attributes', async () => {
  const gltf = await load('worker-hands.glb');
  const expected = ['ToolGrip_L', 'ToolGrip_R', 'CarryGrip_L', 'CarryGrip_R'];
  const found = new Map();
  gltf.scene.traverse(o => { if (o.isMesh) found.set(o.name, o); });
  for (const name of expected) {
    const mesh = found.get(name);
    assert.ok(mesh, `missing ${name}`);
    for (const attr of ['position', 'normal', 'color'])
      assert.ok(mesh.geometry.getAttribute(attr), `${name} missing ${attr}`);
    assert.ok(mesh.geometry.getAttribute('position').count > 80, `${name} too simple`);
  }
});
