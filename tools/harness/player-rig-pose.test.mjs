import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as THREE from 'three';
import { loadWorkerAsset } from '../../src/player/WorkerAsset.ts';
import { makePlayerRig } from '../../src/player/PlayerRig.ts';

globalThis.self ??= globalThis;
globalThis.createImageBitmap ??= async () => ({ width: 4, height: 1, close() {} });
globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
};

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bytes = readFileSync(path.join(project, 'public/models/worker.glb'));
await loadWorkerAsset(`data:application/octet-stream;base64,${bytes.toString('base64')}`);

const input = (changes = {}) => ({ position: new THREE.Vector3(), yaw: 0,
  height: 1.82, time: 0, moving: false, down: false,
  carrying: false, busy: false, ...changes });

function bonePosition(rig, name) {
  rig.root.updateMatrixWorld(true);
  return rig.body.skeleton.getBoneByName(name).getWorldPosition(new THREE.Vector3());
}

function bootSole(rig, side) {
  let min = Infinity;
  const vertex = new THREE.Vector3();
  rig.root.updateMatrixWorld(true);
  rig.root.traverse((object) => {
    if (object.name !== `Boot_${side}`) return;
    const positions = object.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      min = Math.min(min, vertex.y);
    }
  });
  assert.ok(Number.isFinite(min), `missing Boot_${side}`);
  return min;
}

test('idle hands rest near the hips while weight shifts above planted boots', () => {
  const rig = makePlayerRig();
  try {
    rig.poseActive(input());
    const leftHand = bonePosition(rig, 'Hand_L');
    const rightHand = bonePosition(rig, 'Hand_R');
    assert.ok(Math.abs(leftHand.x) < 0.40 && Math.abs(rightHand.x) < 0.40,
      'resting arms should not hang straight outside the hips');
    assert.ok(leftHand.z > 0.045 && rightHand.z > 0.045,
      'elbows should bend the hands slightly in front of the body');
    const chestX = bonePosition(rig, 'Chest').x;
    for (const side of ['L', 'R'])
      assert.ok(Math.abs(bootSole(rig, side)) < 0.03, 'idle boot should remain grounded');

    rig.poseActive(input({ time: 0.9 }));
    assert.ok(Math.abs(bonePosition(rig, 'Chest').x - chestX) > 0.01,
      'idle torso should visibly shift weight');
    for (const side of ['L', 'R'])
      assert.ok(Math.abs(bootSole(rig, side)) < 0.03,
        'weight shift should not lift or bury a boot');
  } finally { rig.dispose(); }
});

test('each walking swing lifts its own boot while the other stays planted', () => {
  const rig = makePlayerRig();
  try {
    rig.poseActive(input({ time: 0.18, moving: true }));
    const leftLift = bootSole(rig, 'L');
    const rightPlant = bootSole(rig, 'R');
    assert.ok(leftLift > 0.045, `left swing boot dragged at ${leftLift}`);
    assert.ok(Math.abs(rightPlant) < 0.03, `right stance boot floated at ${rightPlant}`);
    const rootY = rig.root.position.y;

    rig.poseActive(input({ time: 0.59, moving: true }));
    const rightLift = bootSole(rig, 'R');
    const leftPlant = bootSole(rig, 'L');
    assert.ok(rightLift > 0.045, `right swing boot dragged at ${rightLift}`);
    assert.ok(Math.abs(leftPlant) < 0.03, `left stance boot floated at ${leftPlant}`);
    assert.ok(Math.abs(rig.root.position.y - rootY) < 1e-6,
      'gait should not change the calibrated standing pivot');
  } finally { rig.dispose(); }
});

test('torso and head briefly lag a turn and settle without changing down pose height', () => {
  const rig = makePlayerRig();
  try {
    rig.poseActive(input());
    rig.poseActive(input({ yaw: 0.6, time: 1 / 60 }));
    const chest = rig.body.skeleton.getBoneByName('Chest');
    const neck = rig.body.skeleton.getBoneByName('Neck');
    assert.ok(Math.abs(chest.rotation.y) > 0.015 && Math.abs(chest.rotation.y) < 0.15,
      'torso should follow a turn with bounded lag');
    assert.ok(Math.abs(neck.rotation.y) > 0.015 && Math.abs(neck.rotation.y) < 0.15,
      'head should follow a turn with bounded lag');
    for (let i = 2; i <= 32; i++)
      rig.poseActive(input({ yaw: 0.6, time: i / 60 }));
    assert.ok(Math.abs(chest.rotation.y) < 0.03 && Math.abs(neck.rotation.y) < 0.03,
      'turn response should settle');
    const standingY = rig.root.position.y;
    rig.poseActive(input({ yaw: 0.6, time: 33 / 60, down: true }));
    assert.ok(standingY - rig.root.position.y > 0.3, 'down pose must still lower the worker');
  } finally { rig.dispose(); }
});
