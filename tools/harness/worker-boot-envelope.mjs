// Inspect the authored boot vertices in each ragdoll leg body's local frame.
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
const files = process.argv.slice(2);
for (const file of files) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  for (const state of report.states) {
    const packet = state.local?.packet;
    if (!packet) continue;
    const poses = {};
    for (const [index, name] of RAGDOLL_PART_NAMES.entries()) {
      const i = index * 7;
      poses[name] = { position: new THREE.Vector3(...packet.slice(i, i + 3)),
        quaternion: new THREE.Quaternion(...packet.slice(i + 3, i + 7)) };
    }
    rig.posePhysics(poses);
    rig.root.updateMatrixWorld(true);
    for (const [label, bodyName, meshPrefix] of [
      ['bootL', 'legL', 'Boot_L'], ['bootR', 'legR', 'Boot_R'],
      ['gloveL', 'armL', 'Glove_L'], ['gloveR', 'armR', 'Glove_R'],
      ['helmet', 'head', 'Helmet'],
      ['backpack', 'torso', 'Backpack'],
    ]) {
      const part = poses[bodyName];
      const inverse = part.quaternion.clone().invert();
      const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      rig.root.traverse(object => {
        if (!object.isMesh || !object.name.startsWith(meshPrefix)) return;
        const positions = object.geometry.getAttribute('position');
        const vertex = new THREE.Vector3();
        for (let i = 0; i < positions.count; i++) {
          if (object.isSkinnedMesh) object.getVertexPosition(i, vertex);
          else vertex.fromBufferAttribute(positions, i);
          vertex.applyMatrix4(object.matrixWorld).sub(part.position).applyQuaternion(inverse);
          for (let axis = 0; axis < 3; axis++) {
            bounds.min[axis] = Math.min(bounds.min[axis], vertex.getComponent(axis));
            bounds.max[axis] = Math.max(bounds.max[axis], vertex.getComponent(axis));
          }
        }
      });
      console.log(file, state.name, label,
        'min', bounds.min.map(n => +n.toFixed(3)),
        'max', bounds.max.map(n => +n.toFixed(3)));
    }
  }
}
rig.dispose();
