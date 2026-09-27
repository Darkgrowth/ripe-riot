// Offline Rapier drop of saved mesh/body orientations onto flat and 18.1-degree ground.
// Locks rotation to isolate contact-envelope fit; this is not a full jointed gameplay run.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { loadWorkerAsset } from '../../src/player/WorkerAsset.ts';
import { makePlayerRig, RAGDOLL_PART_NAMES } from '../../src/player/PlayerRig.ts';

globalThis.self ??= globalThis;
globalThis.createImageBitmap ??= async () => ({ width: 4, height: 1, close() {} });
globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
};
await RAPIER.init();
const bytes = readFileSync('public/models/worker-detailed-voxel-v1.glb');
await loadWorkerAsset(`data:application/octet-stream;base64,${bytes.toString('base64')}`);
const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rig = makePlayerRig();
const samples = [
  { state: 'flat-settling', angle: 0 },
  { state: 'flat-floor-contact', angle: 0 },
  { state: 'slope-settling', angle: 18.1 },
  { state: 'slope-floor-contact', angle: 18.1 },
];
const parts = [
  { name: 'torso', prefix: 'Backpack', hh: .21, radius: .27 },
  { name: 'armR', prefix: 'Glove_R', hh: .31, radius: .12 },
  { name: 'legR', prefix: 'Boot_R', hh: .32, radius: .14 },
];
const all = [];
for (const { state: stateName, angle } of samples) {
  const state = report.states.find(s => s.name === stateName);
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
  for (const part of parts) {
    const original = poses[part.name];
    const inverse = original.quaternion.clone().invert();
    const localVertices = [];
    rig.root.traverse(object => {
      if (!object.isMesh || !object.name.startsWith(part.prefix)) return;
      const position = object.geometry.getAttribute('position');
      const vertex = new THREE.Vector3();
      for (let i = 0; i < position.count; i++) {
        if (object.isSkinnedMesh) object.getVertexPosition(i, vertex);
        else vertex.fromBufferAttribute(position, i);
        localVertices.push(vertex.applyMatrix4(object.matrixWorld)
          .sub(original.position).applyQuaternion(inverse).clone());
      }
    });
    if (!localVertices.length) throw new Error(`Missing ${part.prefix} mesh`);
    for (const version of ['old', 'fitted']) {
      const world = new RAPIER.World({ x: 0, y: -22, z: 0 });
      world.timestep = 1 / 60;
      const groundRotation = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(angle));
      const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed()
        .setTranslation(0, -.2, 0).setRotation(groundRotation));
      world.createCollider(RAPIER.ColliderDesc.cuboid(20, .2, 20).setFriction(.8), ground);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, 1.5, 0).setRotation(original.quaternion)
        .lockRotations());
      world.createCollider(RAPIER.ColliderDesc.capsule(part.hh, part.radius)
        .setFriction(.7), body);
      let extra;
      if (part.name === 'torso' && version === 'fitted') {
        extra = RAPIER.ColliderDesc.cuboid(.236, .283, .108).setTranslation(0, 0, -.258);
      } else if (part.name === 'armR') {
        extra = version === 'old'
          ? RAPIER.ColliderDesc.cuboid(.19, .17, .18).setTranslation(0, -.38, 0)
          : RAPIER.ColliderDesc.ball(.15).setTranslation(0, -.38, 0);
      } else if (part.name === 'legR') {
        extra = version === 'old'
          ? RAPIER.ColliderDesc.cuboid(.30, .13, .25).setTranslation(0, -.32, .03)
          : RAPIER.ColliderDesc.ball(.22).setTranslation(0, -.28, 0);
      }
      if (extra) world.createCollider(extra.setFriction(.8), body);
      for (let step = 0; step < 150; step++) world.step();
      const t = body.translation(), q = body.rotation();
      const center = new THREE.Vector3(t.x, t.y, t.z);
      const rotation = new THREE.Quaternion(q.x, q.y, q.z, q.w);
      const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(groundRotation);
      const groundTop = new THREE.Vector3(0, -.2, 0)
        .add(new THREE.Vector3(0, .2, 0).applyQuaternion(groundRotation));
      const min = Math.min(...localVertices.map(v => v.clone().applyQuaternion(rotation)
        .add(center).sub(groundTop).dot(normal)));
      all.push({ state: stateName, angle, part: part.name, version, meshClearance: +min.toFixed(3) });
      world.free();
    }
  }
}
console.log(JSON.stringify(all, null, 2));
rig.dispose();
