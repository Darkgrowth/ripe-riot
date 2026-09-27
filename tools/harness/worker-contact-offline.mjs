// Reconstruct mesh and collider support from a saved six-part pose. No browser or renderer.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { loadWorkerAsset } from '../../src/player/WorkerAsset.ts';
import { makePlayerRig, RAGDOLL_PART_NAMES } from '../../src/player/PlayerRig.ts';

globalThis.self ??= globalThis;
globalThis.createImageBitmap ??= async () => ({ width: 4, height: 1, close() {} });
globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
};
const bytes = readFileSync('public/models/worker-detailed-voxel-v1.glb');
await loadWorkerAsset(`data:application/octet-stream;base64,${bytes.toString('base64')}`);
const rig = makePlayerRig();
const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const state = report.states.find(s => s.name === process.argv[3]);
if (!state?.local?.packet) throw new Error('Missing saved physical pose');
const poses = {};
for (const [index, name] of RAGDOLL_PART_NAMES.entries()) {
  const i = index * 7;
  poses[name] = {
    position: new THREE.Vector3(...state.local.packet.slice(i, i + 3)),
    quaternion: new THREE.Quaternion(...state.local.packet.slice(i + 3, i + 7)),
  };
}
rig.posePhysics(poses);
rig.root.updateMatrixWorld(true);
const meshes = [];
rig.root.traverse(object => {
  if (!object.isMesh) return;
  const attribute = object.geometry.getAttribute('position');
  const vertex = new THREE.Vector3();
  let min = Infinity;
  for (let i = 0; i < attribute.count; i++) {
    if (object.isSkinnedMesh) object.getVertexPosition(i, vertex);
    else vertex.fromBufferAttribute(attribute, i);
    min = Math.min(min, vertex.applyMatrix4(object.matrixWorld).y);
  }
  meshes.push({ name: object.name, y: min });
});
meshes.sort((a, b) => a.y - b.y);
const colliders = [];
const capsule = (name, halfHeight, radius) => {
  const { position, quaternion } = poses[name];
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
  colliders.push({ name: `${name} capsule`, y: position.y - halfHeight * Math.abs(axis.y) - radius });
};
const box = (name, label, translation, halfExtents) => {
  const { position, quaternion } = poses[name];
  const center = new THREE.Vector3(...translation).applyQuaternion(quaternion).add(position);
  const basis = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const reach = basis.reduce((sum, axis, i) => sum + Math.abs(axis.applyQuaternion(quaternion).y) * halfExtents[i], 0);
  colliders.push({ name: `${name} ${label}`, y: center.y - reach });
};
const ball = (name, label, translation, radius) => {
  const { position, quaternion } = poses[name];
  const center = new THREE.Vector3(...translation).applyQuaternion(quaternion).add(position);
  colliders.push({ name: `${name} ${label}`, y: center.y - radius });
};
capsule('torso', .21, .27);
capsule('head', .04, .28);
for (const name of ['armL', 'armR']) { capsule(name, .31, .12); box(name, 'palm', [0, -.38, 0], [.19, .17, .18]); }
for (const name of ['legL', 'legR']) { capsule(name, .32, .14); box(name, 'sole', [0, -.32, .03], [.30, .13, .25]); }
box('torso', 'candidate pack', [0, 0, -.258], [.236, .283, .108]);
for (const name of ['armL', 'armR']) ball(name, 'candidate palm ball', [0, -.38, 0], .15);
for (const name of ['legL', 'legR']) ball(name, 'candidate sole ball', [0, -.28, 0], .22);
colliders.sort((a, b) => a.y - b.y);
const checks = [
  ['armL', 'Glove_L', 'candidate palm ball'], ['armR', 'Glove_R', 'candidate palm ball'],
  ['legL', 'Boot_L', 'candidate sole ball'], ['legR', 'Boot_R', 'candidate sole ball'],
  ['torso', 'Backpack', 'candidate pack'],
].map(([part, prefix, candidate]) => {
  const meshY = Math.min(...meshes.filter(m => m.name.startsWith(prefix)).map(m => m.y));
  const colliderY = colliders.find(c => c.name === `${part} ${candidate}`).y;
  return { part, meshY, colliderY, meshMinusCollider: meshY - colliderY };
});
console.log(JSON.stringify({ state: state.name, physicsGround: state.local.ground,
  lowestMeshes: meshes.slice(0, 8), lowestColliders: colliders.slice(0, 8), checks }, null, 2));
rig.dispose();
