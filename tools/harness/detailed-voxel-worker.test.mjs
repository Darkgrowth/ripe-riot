import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadWorkerAsset } from '../../src/player/WorkerAsset.ts';
import { makePlayerRig } from '../../src/player/PlayerRig.ts';

globalThis.self ??= globalThis;
globalThis.createImageBitmap ??= async () => ({ width: 4, height: 1, close() {} });
globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function candidate(name) {
  const bytes = readFileSync(path.join(root, 'public/models', name));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new GLTFLoader().parseAsync(data, '');
}

const expectedBones = ['Pelvis', 'Spine', 'Chest', 'Neck', 'Head',
  'UpperArm_L', 'Forearm_L', 'Hand_L', 'UpperArm_R', 'Forearm_R', 'Hand_R',
  'Thigh_L', 'Shin_L', 'Foot_L', 'Thigh_R', 'Shin_R', 'Foot_R'];

test('versioned worker keeps the co-op rig, four-color body palette and fitted limb contract', async () => {
  const { scene } = await candidate('worker-detailed-voxel-v1.glb');
  const body = scene.getObjectByName('WorkerBody');
  assert.ok(body?.isSkinnedMesh);
  for (const name of expectedBones) assert.ok(body.skeleton.getBoneByName(name), name);
  for (const attr of ['position', 'uv', 'skinIndex', 'skinWeight'])
    assert.ok(body.geometry.getAttribute(attr), `body missing ${attr}`);
  assert.ok(body.geometry.getAttribute('position').count > 500);
  assert.ok(body.material.map, 'co-op palette image must remain on WorkerBody');
  assert.equal(body.material.map.image.width, 4);
  const uv = body.geometry.getAttribute('uv');
  assert.ok(Array.from({ length: uv.count }, (_, i) => uv.getX(i))
    .some(x => x > 0.6 && x < 0.65), 'skin faces must sample the third palette pixel');
  const box = new THREE.Box3().setFromObject(scene);
  const height = box.getSize(new THREE.Vector3()).y;
  assert.ok(height > 1.75 && height < 1.95, `worker height ${height}`);

  const meshes = [];
  scene.traverse(obj => { if (obj.isMesh) meshes.push(obj); });
  assert.ok(meshes.length < 32,
    `do not make one scene object per voxel (${meshes.length}: ${meshes.map(o => o.name)})`);
  for (const side of ['L', 'R']) {
    for (const name of ['UpperSleeve', 'ForeSleeve', 'Glove',
      'ThighSuit', 'ShinSuit', 'Boot']) {
      assert.ok(scene.getObjectByName(`${name}_${side}`), `${name}_${side}`);
    }
  }
  const materials = new Set(meshes.flatMap(obj =>
    (Array.isArray(obj.material) ? obj.material : [obj.material]).map(mat => mat.name)));
  for (const role of ['suit', 'suitDark', 'gloves', 'boots', 'hat', 'pack'])
    assert.ok(materials.has(role), `missing ${role} material`);
});

test('versioned first-person gloves retain four named, vertex-colored grip meshes', async () => {
  const { scene } = await candidate('worker-hands-detailed-voxel-v1.glb');
  const meshes = [];
  scene.traverse(obj => { if (obj.isMesh) meshes.push(obj); });
  assert.equal(meshes.length, 4);
  for (const pose of ['Tool', 'Carry']) for (const side of ['L', 'R']) {
    const name = `${pose}Grip_${side}`;
    const glove = scene.getObjectByName(name);
    assert.ok(glove?.isMesh, name);
    for (const attr of ['position', 'normal', 'color'])
      assert.ok(glove.geometry.getAttribute(attr), `${name} missing ${attr}`);
    assert.ok(glove.geometry.getAttribute('position').count > 800);
  }
});

test('current player pose controller moves the fitted voxel arm and leg sections', async () => {
  const bytes = readFileSync(path.join(root, 'public/models/worker-detailed-voxel-v1.glb'));
  await loadWorkerAsset(`data:application/octet-stream;base64,${bytes.toString('base64')}`);
  const rig = makePlayerRig();
  assert.equal(rig.source, 'glb');
  const glove = rig.root.getObjectByName('Glove_L');
  const boot = rig.root.getObjectByName('Boot_L');
  assert.ok(glove && boot);
  const input = { position: new THREE.Vector3(), yaw: 0, height: 1.82,
    time: 0, moving: false, down: false, carrying: false, busy: false };
  rig.poseActive(input);
  const gloveStart = glove.getWorldPosition(new THREE.Vector3());
  const bootStart = boot.getWorldPosition(new THREE.Vector3());
  rig.poseActive({ ...input, time: 0.18, moving: true });
  assert.ok(glove.getWorldPosition(new THREE.Vector3()).distanceTo(gloveStart) > .005,
    'glove must follow the animated hand bone');
  assert.ok(boot.getWorldPosition(new THREE.Vector3()).distanceTo(bootStart) > .005,
    'boot must follow the animated foot bone');
  rig.dispose();
});
