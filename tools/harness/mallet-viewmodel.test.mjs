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
  const rightAnchor = right.localToWorld(new THREE.Vector3(.19, .065, -.22)).project(camera);
  const leftAnchor = left.localToWorld(new THREE.Vector3(.07, .185, -.24)).project(camera);
  for (const anchor of [rightAnchor, leftAnchor]) {
    assert.ok(anchor.y > -.95 && anchor.y < -.1, `glove clipped or too high: ${anchor.y}`);
    assert.ok(anchor.x > -.2 && anchor.x < .95, `glove outside lower-right grip area: ${anchor.x}`);
  }
  const shaft = tool.localToWorld(new THREE.Vector3(.16, .14, -.24));
  const nearestGripVertex = (mesh) => {
    const positions = mesh.geometry.getAttribute('position');
    let nearest = Infinity;
    for (let i = 0; i < positions.count; i++) {
      const point = mesh.localToWorld(new THREE.Vector3(
        positions.getX(i), positions.getY(i), positions.getZ(i)));
      if (Math.abs(point.y - shaft.y) > .12) continue;
      nearest = Math.min(nearest, Math.hypot(point.x - shaft.x, point.z - shaft.z));
    }
    return nearest;
  };
  assert.ok(nearestGripVertex(right) < .015, `lead glove must meet the shaft: ${nearestGripVertex(right)}`);
  assert.ok(nearestGripVertex(left) < .015, `support glove must meet the shaft: ${nearestGripVertex(left)}`);
  const disposed = new Set();
  for (const mesh of [tool, right, left])
    mesh.geometry.addEventListener('dispose', () => disposed.add(mesh.name));
  vm.dispose(); material.dispose();
  assert.equal(disposed.size, 3, 'all three geometries must be released on swap/dispose');
});

test('mallet lead and support palms grip distinct shaft heights', async () => {
  await loadWorkerHands(url);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true });
  const vm = buildViewModel('hand', material, 'voxel');
  vm.root.updateMatrixWorld(true);
  const brownCentre = (name) => {
    const mesh = vm.root.getObjectByName(name);
    const positions = mesh.geometry.getAttribute('position');
    const colors = mesh.geometry.getAttribute('color');
    const centre = new THREE.Vector3();
    let count = 0;
    for (let i = 0; i < positions.count; i++) {
      if (colors.getX(i) >= .5 || colors.getX(i) <= .1) continue;
      centre.add(mesh.localToWorld(new THREE.Vector3(
        positions.getX(i), positions.getY(i), positions.getZ(i))));
      count++;
    }
    assert.ok(count > 0);
    return centre.divideScalar(count);
  };
  const lead = brownCentre('vm:hand:rightGrip');
  const support = brownCentre('vm:hand:leftGrip');
  assert.ok(support.y - lead.y > .065,
    `support palm should brace above the lead palm on the shaft: ${support.y - lead.y}`);
  vm.dispose(); material.dispose();
});

test('mallet gloves leave the shaft and world readable at the recorded ultrawide aspect', async () => {
  await loadWorkerHands(url);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true });
  const aspect = 3424 / 1268;
  const camera = new THREE.PerspectiveCamera(52, aspect, .01, 6);
  const halfWidth = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * aspect * VIEW_DEPTH;
  const vm = buildViewModel('hand', material, 'voxel');
  vm.root.position.x = VIEW_LATERAL * halfWidth;
  vm.root.updateMatrixWorld(true);
  const widths = {};
  for (const side of ['leftGrip', 'rightGrip']) {
    const mesh = vm.root.getObjectByName(`vm:hand:${side}`);
    const positions = mesh.geometry.getAttribute('position');
    const colors = mesh.geometry.getAttribute('color');
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < positions.count; i++) {
      // Leather, including the palm and cuff. Fabric and steel are separate.
      if (colors.getX(i) <= .1 || colors.getX(i) >= .5) continue;
      const point = mesh.localToWorld(new THREE.Vector3(
        positions.getX(i), positions.getY(i), positions.getZ(i))).project(camera);
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    }
    widths[side] = maxX - minX;
  }
  assert.ok(widths.leftGrip < .17 && widths.rightGrip < .17,
    `gloves overwhelm the 3424x1268 view: NDC widths ${JSON.stringify(widths)}`);
  vm.dispose(); material.dispose();
});

test('the two mallet grips read as separate hands at gameplay aspect ratios', async () => {
  await loadWorkerHands(url);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true });
  for (const aspect of [4 / 3, 16 / 9, 3440 / 1440, 3424 / 1268, 32 / 9]) {
    const camera = new THREE.PerspectiveCamera(52, aspect, .01, 6);
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * aspect * VIEW_DEPTH;
    const vm = buildViewModel('hand', material, 'voxel');
    vm.setFit(Math.min(1, aspect / (16 / 9)));
    vm.root.position.x = VIEW_LATERAL * halfWidth;
    vm.root.updateMatrixWorld(true);
    const projectCentre = (name) => {
      const mesh = vm.root.getObjectByName(name);
      const positions = mesh.geometry.getAttribute('position');
      const colors = mesh.geometry.getAttribute('color');
      const centre = new THREE.Vector3();
      let count = 0;
      for (let i = 0; i < positions.count; i++) {
        if (colors.getX(i) <= .1 || colors.getX(i) >= .5) continue;
        centre.add(mesh.localToWorld(new THREE.Vector3(
          positions.getX(i), positions.getY(i), positions.getZ(i))));
        count++;
      }
      assert.ok(count > 0, 'the grip needs a visible glove');
      return centre.divideScalar(count).project(camera);
    };
    const lead = projectCentre('vm:hand:rightGrip');
    const support = projectCentre('vm:hand:leftGrip');
    assert.ok(support.y - lead.y > .10,
      `support glove must sit distinctly above the lead grip at ${aspect}: ${support.y - lead.y}`);
    assert.ok(Math.hypot(support.x - lead.x, support.y - lead.y) > .23,
      `glove silhouettes must not merge side-to-side at ${aspect}`);
    assert.ok(lead.y > -1.05 && support.y < -.20,
      `both gloves should remain legible below the aim point at ${aspect}: lead ${lead.y}, support ${support.y}`);
    const cuffCentre = (name, anchorZ) => {
      const mesh = vm.root.getObjectByName(name);
      const positions = mesh.geometry.getAttribute('position');
      const centre = new THREE.Vector3();
      let count = 0;
      for (let i = 0; i < positions.count; i++) {
        if (positions.getZ(i) < anchorZ + .08) continue;
        centre.add(mesh.localToWorld(new THREE.Vector3(
          positions.getX(i), positions.getY(i), positions.getZ(i))));
        count++;
      }
      assert.ok(count > 0, 'the glove needs a connected cuff');
      return centre.divideScalar(count).project(camera);
    };
    const leadCuff = cuffCentre('vm:hand:rightGrip', -.22);
    const supportCuff = cuffCentre('vm:hand:leftGrip', -.24);
    assert.ok(leadCuff.x - supportCuff.x > .22,
      `the forearms should fan apart beneath the shared shaft at ${aspect}: ${leadCuff.x - supportCuff.x}`);
    for (const name of ['vm:hand:rightGrip', 'vm:hand:leftGrip']) {
      const mesh = vm.root.getObjectByName(name);
      const positions = mesh.geometry.getAttribute('position');
      let inFrame = 0;
      for (let i = 0; i < positions.count; i++) {
        const projected = mesh.localToWorld(new THREE.Vector3(
          positions.getX(i), positions.getY(i), positions.getZ(i))).project(camera);
        if (Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1) inFrame++;
      }
      assert.ok(inFrame / positions.count > .65,
        `${name} must be mostly visible, got ${(inFrame / positions.count).toFixed(2)} at ${aspect}`);
    }
    vm.dispose();
  }
  material.dispose();
});

test('mallet sleeves leave the lower frame without showing their terminal caps through the swing', async () => {
  await loadWorkerHands(url);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true });
  for (const aspect of [16 / 9, 3440 / 1440, 32 / 9]) {
    const camera = new THREE.PerspectiveCamera(52, aspect, .01, 6);
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * aspect * VIEW_DEPTH;
    const baseX = VIEW_LATERAL * halfWidth;
    const vm = buildViewModel('hand', material, 'voxel');
    for (const time of [0, MALLET_TIMING.windup, MALLET_TIMING.contactAt,
      MALLET_TIMING.activeEnd, MALLET_TIMING.total]) {
      const pose = sampleMalletViewPose(time, MALLET_TIMING.total, baseX);
      vm.setMalletPose(pose);
      vm.root.position.set(baseX + pose.rootX, pose.rootY, 0);
      vm.root.rotation.y = pose.rootYaw;
      vm.root.updateMatrixWorld(true);
      for (const side of ['leftGrip', 'rightGrip']) {
        const mesh = vm.root.getObjectByName(`vm:hand:${side}`);
        const positions = mesh.geometry.getAttribute('position');
        const colors = mesh.geometry.getAttribute('color');
        let lowest = Infinity;
        for (let i = 0; i < positions.count; i++)
          if (colors.getX(i) > .5) lowest = Math.min(lowest, positions.getY(i));
        const projected = [];
        for (let i = 0; i < positions.count; i++) {
          if (colors.getX(i) < .5 || positions.getY(i) > lowest + .012) continue;
          projected.push(mesh.localToWorld(new THREE.Vector3(
            positions.getX(i), positions.getY(i), positions.getZ(i))).project(camera));
        }
        assert.ok(projected.length > 0, `${side} must have a sleeve terminal`);
        const highestTerminal = Math.max(...projected.map(point => point.y));
        assert.ok(highestTerminal < -1.02,
          `${side} exposes its sleeve end at ${aspect.toFixed(2)} and ${time.toFixed(2)}s: ${highestTerminal.toFixed(2)}`);
      }
    }
    vm.dispose();
  }
  material.dispose();
});

test('each mallet forearm runs diagonally from its wrist toward its own screen edge', async () => {
  await loadWorkerHands(url);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true });
  const vm = buildViewModel('hand', material, 'voxel');
  for (const [side, outward] of [['leftGrip', -1], ['rightGrip', 1]]) {
    const mesh = vm.root.getObjectByName(`vm:hand:${side}`);
    const positions = mesh.geometry.getAttribute('position');
    const colors = mesh.geometry.getAttribute('color');
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < positions.count; i++) {
      if (colors.getX(i) < .5) continue;
      low = Math.min(low, positions.getY(i));
      high = Math.max(high, positions.getY(i));
    }
    const meanX = (bottom) => {
      let sum = 0, count = 0;
      for (let i = 0; i < positions.count; i++) {
        if (colors.getX(i) < .5) continue;
        if (bottom ? positions.getY(i) > low + .035 : positions.getY(i) < high - .035)
          continue;
        sum += positions.getX(i); count++;
      }
      assert.ok(count > 0);
      return sum / count;
    };
    const diagonal = (meanX(true) - meanX(false)) * outward;
    assert.ok(diagonal > .13,
      `${side} should lean outward from wrist to elbow, got ${diagonal.toFixed(3)} m`);
  }
  vm.dispose(); material.dispose();
});

test('mallet head crosses the aim area at the shared 0.18-second contact beat across screen shapes', async () => {
  await loadWorkerHands(url);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true });
  for (const aspect of [4 / 3, 16 / 9, 3440 / 1440, 32 / 9]) {
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
