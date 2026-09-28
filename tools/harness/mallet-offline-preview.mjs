/** Export the actual first-person mallet meshes for headless camera review.
 * node tools/harness/mallet-offline-preview.mjs output.json [contact]
 * Then render with Blender's mallet-offline-render.py. This never opens a
 * browser or captures the real cursor. */
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { loadWorkerHands } from '../../src/render/WorkerHands.ts';
import { buildViewModel, VIEW_DEPTH, VIEW_LATERAL } from '../../src/render/Viewmodel.ts';
import { sampleMalletViewPose } from '../../src/player/MalletViewPose.ts';
import { MALLET_TIMING } from '../../src/tools/MalletSwing.ts';

globalThis.self ??= globalThis;
globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
};

const hands = readFileSync('public/models/worker-hands-detailed-voxel-v1.glb');
await loadWorkerHands(`data:application/octet-stream;base64,${hands.toString('base64')}`);
const material = new THREE.MeshStandardMaterial({ vertexColors: true });
const vm = buildViewModel('hand', material, 'voxel');
const halfWidth = Math.tan(THREE.MathUtils.degToRad(52) / 2) * (16 / 9) * VIEW_DEPTH;
const baseX = VIEW_LATERAL * halfWidth;
if (process.argv[3] === 'contact') {
  const pose = sampleMalletViewPose(0.18, MALLET_TIMING.total, baseX, 0, 1);
  vm.setMalletPose(pose);
  vm.root.position.set(baseX + pose.rootX, pose.rootY, 0);
  vm.root.rotation.y = pose.rootYaw;
} else vm.root.position.x = baseX;
vm.root.updateMatrixWorld(true);
const parts = [];
vm.root.traverse(object => {
  if (!object.isMesh) return;
  const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry;
  const position = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  const vertices = [], colors = [];
  for (let i = 0; i < position.count; i++) {
    const point = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i))
      .applyMatrix4(object.matrixWorld);
    vertices.push(point.x, point.y, point.z);
    colors.push(color.getX(i), color.getY(i), color.getZ(i));
  }
  parts.push({ name: object.name, vertices, colors });
  if (geometry !== object.geometry) geometry.dispose();
});
writeFileSync(process.argv[2], JSON.stringify(parts));
vm.dispose(); material.dispose();
