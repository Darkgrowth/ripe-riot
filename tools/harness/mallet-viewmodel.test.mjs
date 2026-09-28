import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as THREE from 'three';
import { loadWorkerHands } from '../../src/render/WorkerHands.ts';
import { buildViewModel, VIEW_DEPTH, VIEW_LATERAL } from '../../src/render/Viewmodel.ts';
import { MalletVisualTimeline, sampleMalletViewPose } from '../../src/player/MalletViewPose.ts';
import { MALLET_TIMING } from '../../src/tools/MalletSwing.ts';
import { FIXED_DT } from '../../src/core/Time.ts';
import { importBundled } from './import-bundled.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.self ??= globalThis;
globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
};
const hands = readFileSync(path.join(root, 'public/models/worker-hands-detailed-voxel-v1.glb'));
const url = `data:application/octet-stream;base64,${hands.toString('base64')}`;

test('mallet has separate tool and bracing hands, with palms visible in the ready pose', async () => {
  await loadWorkerHands(url);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true });
  const vm = buildViewModel('hand', material, 'voxel');
  const tool = vm.root.getObjectByName('vm:hand');
  const right = vm.root.getObjectByName('vm:hand:rightGrip');
  const left = vm.root.getObjectByName('vm:hand:leftGrip');
  assert.ok(tool?.isMesh && right?.isMesh && left?.isMesh);
  assert.notEqual(tool.geometry, right.geometry);
  assert.notEqual(left.geometry, right.geometry);
  const camera = new THREE.PerspectiveCamera(52, 16 / 9, .01, 6);
  const halfWidth = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect * VIEW_DEPTH;
  vm.root.position.x = VIEW_LATERAL * halfWidth;
  vm.root.updateMatrixWorld(true);
  const rightPalm = right.localToWorld(new THREE.Vector3(.19, .03, -.22)).project(camera);
  const leftPalm = left.localToWorld(new THREE.Vector3(.11, -.02, -.24)).project(camera);
  for (const palm of [rightPalm, leftPalm]) {
    assert.ok(palm.y > -.9 && palm.y < -.1, `palm clipped or too high: ${palm.y}`);
    assert.ok(palm.x > -.2 && palm.x < .95, `palm outside lower-right grip area: ${palm.x}`);
  }
  const shaft = tool.localToWorld(new THREE.Vector3(.16, -.02, -.24));
  const rightGrip = right.localToWorld(new THREE.Vector3(.19, .03, -.22));
  const leftGrip = left.localToWorld(new THREE.Vector3(.11, -.02, -.24));
  assert.ok(shaft.distanceTo(rightGrip) < .06, 'lead glove must meet the shaft');
  assert.ok(shaft.distanceTo(leftGrip) < .06, 'support glove must meet the shaft');
  const disposed = new Set();
  for (const mesh of [tool, right, left])
    mesh.geometry.addEventListener('dispose', () => disposed.add(mesh.name));
  vm.dispose(); material.dispose();
  assert.equal(disposed.size, 3, 'all three geometries must be released on swap/dispose');
});

test('mallet head crosses the aim area at the shared 0.18-second contact beat at three aspect ratios', async () => {
  await loadWorkerHands(url);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true });
  for (const aspect of [4 / 3, 16 / 9, 3420 / 1266]) {
    const camera = new THREE.PerspectiveCamera(52, aspect, .01, 6);
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * aspect * VIEW_DEPTH;
    const baseX = VIEW_LATERAL * halfWidth;
    const fit = Math.min(1, aspect / (16 / 9));
    const vm = buildViewModel('hand', material, 'voxel');
    vm.setFit(fit);
    const tool = vm.root.getObjectByName('vm:hand');
    const projectHead = (time) => {
      const pose = sampleMalletViewPose(time, MALLET_TIMING.total, baseX, 0, fit);
      vm.setMalletPose(pose);
      vm.root.position.set(baseX + pose.rootX, pose.rootY, 0);
      vm.root.updateMatrixWorld(true);
      return tool.localToWorld(new THREE.Vector3(.16, .26, -.24)).project(camera);
    };
    const ready = projectHead(0);
    const windup = projectHead(MALLET_TIMING.windup);
    const toolAtWindup = tool.getWorldPosition(new THREE.Vector3());
    const leftAtWindup = vm.root.getObjectByName('vm:hand:leftGrip').getWorldPosition(new THREE.Vector3());
    const contact = projectHead(MALLET_TIMING.contactAt);
    const recovered = projectHead(MALLET_TIMING.total);
    assert.ok(ready.x > .30, `ready mallet should stay to the right: ${ready.x}`);
    assert.ok(windup.x > ready.x, 'windup should visibly pull the head farther right');
    assert.ok(Math.abs(leftAtWindup.x - toolAtWindup.x) > .004,
      'support hand should follow the tool instead of being welded to it');
    assert.ok(Math.abs(contact.x) < .14, `contact missed crosshair at aspect ${aspect}: ${contact.x}`);
    assert.ok(Math.abs(contact.y) < .25, `contact missed crosshair height: ${contact.y}`);
    assert.ok(Math.abs(recovered.x - ready.x) < .01, 'recovery must return to ready position');
    vm.dispose();
  }
  material.dispose();
});

test('hit briefly holds the cosmetic contact pose without changing attack timing', () => {
  const timeline = new MalletVisualTimeline();
  timeline.start(MALLET_TIMING.total, 11);
  timeline.step(MALLET_TIMING.contactAt);
  const atContact = timeline.elapsed;
  assert.equal(timeline.impact(11, 'hit'), true);
  timeline.step(.02);
  assert.ok(timeline.elapsed > atContact, 'simulation age must continue through impact');
  assert.equal(timeline.presentationElapsed, atContact,
    'only the cosmetic pose should hold for a few visible frames');
  timeline.step(.04);
  assert.ok(timeline.presentationElapsed > atContact);
  timeline.step(1);
  assert.equal(timeline.elapsed, MALLET_TIMING.total);
  assert.equal(timeline.active, false);
  timeline.start(MALLET_TIMING.total, 12);
  timeline.step(.12);
  assert.equal(timeline.impact(12, 'whoosh'), true);
  timeline.step(.03);
  assert.ok(timeline.elapsed > .12, 'a whoosh must never freeze the mallet');
  timeline.cancel();
  assert.equal(timeline.active, false);
  assert.equal(timeline.impactStrength, 0);
});

test('a late result cannot recoil the next swing or a swapped-away mallet', () => {
  const timeline = new MalletVisualTimeline();
  timeline.start(MALLET_TIMING.total, 21);
  timeline.step(MALLET_TIMING.total);
  timeline.start(MALLET_TIMING.total, 22);
  timeline.step(MALLET_TIMING.contactAt);
  assert.equal(timeline.impact(21, 'hit'), false);
  assert.equal(timeline.impactStrength, 0);
  assert.equal(timeline.impact(22, 'blocked'), true);
  assert.ok(timeline.impactStrength > 0);
  timeline.cancel();
  assert.equal(timeline.impact(22, 'hit'), false);
  assert.equal(timeline.impactStrength, 0);
});

test('viewmodel advances with every fixed simulation tick through a 0.25-second hitch', async () => {
  const { ViewmodelSystem } = await importBundled('src/player/ViewmodelSystem.ts',
    'viewmodel-fixed-time');
  const vm = new ViewmodelSystem('voxel');
  const root = new THREE.Group();
  vm.g = { player: { state: 'active', yaw: 0, pitch: 0, speed: 0,
    grounded: true, bobPhase: 0, landDip: 0 },
  input: { enabled: true, pointerLocked: true, synthetic: false },
  playerCamera: { enabled: true },
  renderer: { camera: { fov: 68, aspect: 16 / 9 }, viewScene: new THREE.Scene() } };
  vm.tools = { activeId: 'hand', activeTool: { charge: 0 } };
  vm.interaction = { carried: null, throwCharge: 0 };
  vm.current = { root, setFit() {}, setMalletPose() {} };
  vm.currentId = 'hand';
  vm.stow = 0;
  vm.carry = { root: new THREE.Group(), reset() {} };
  vm.mallet.start(MALLET_TIMING.total, 31);
  // Game.tick can run 15 fixed steps, then calls frameUpdate with only .1 s.
  for (let i = 0; i < 15; i++) vm.fixedStep(FIXED_DT);
  vm.frameUpdate(.1);
  assert.ok(vm.mallet.elapsed >= .249 && vm.mallet.elapsed <= .251,
    `visual mallet should share the 15-step simulation age: ${vm.mallet.elapsed}`);
  assert.ok(vm.mallet.elapsed > MALLET_TIMING.contactAt,
    'rendered mallet must have crossed contact when the authoritative swing has');
  assert.ok(vm.mallet.presentationElapsed > MALLET_TIMING.contactAt);
  vm.g.input.pointerLocked = false;
  vm.fixedStep(FIXED_DT);
  assert.equal(vm.mallet.active, false, 'opening a menu cancels visual contact');
});

test('viewmodel rejects a late result from an earlier swing before adding recoil', async () => {
  const { ViewmodelSystem } = await importBundled('src/player/ViewmodelSystem.ts',
    'viewmodel-result-id');
  const vm = new ViewmodelSystem('voxel');
  vm.tools = { activeId: 'hand' };
  vm.mallet.start(MALLET_TIMING.total, 42);
  vm.mallet.step(MALLET_TIMING.contactAt);
  vm.applyMeleeResult({ swingId: 41, outcome: 'hit' });
  assert.equal(vm.kickVel, 0);
  vm.applyMeleeResult({ swingId: 42, outcome: 'hit' });
  assert.ok(vm.kickVel > 0);
  vm.mallet.start(MALLET_TIMING.total, 43);
  vm.tools.activeId = 'net';
  const before = vm.kickVel;
  vm.applyMeleeResult({ swingId: 43, outcome: 'hit' });
  assert.equal(vm.kickVel, before);
});
