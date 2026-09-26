import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { MimicRig } from '../../src/enemies/MimicRig.ts';
import {
  makeDetailedVoxelMimicShell,
  makeDetailedVoxelMimicThroat,
  makeDetailedVoxelMimicTeeth,
  makeDetailedVoxelMimicStem,
  makeDetailedVoxelMimicEye,
  makeDetailedVoxelMimicRootSegment,
  makeDetailedVoxelMimicRootFoot,
} from '../../src/enemies/VoxelMimicGeometry.ts';

function sizeOf(geometry) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  return [max.x - min.x, max.y - min.y, max.z - min.z];
}

function checkSurface(geometry) {
  assert.equal(geometry.type, 'BufferGeometry');
  const positions = geometry.getAttribute('position');
  const colors = geometry.getAttribute('color');
  const normals = geometry.getAttribute('normal');
  assert.ok(positions.count > 0);
  assert.equal(colors.count, positions.count);
  assert.equal(normals.count, positions.count);
  assert.equal(positions.count % 3, 0);
  assert.ok([...positions.array].every(Number.isFinite));
}

test('detailed upper and lower rind keep the hinged Mimic scale with finer stepped surfaces', () => {
  for (const upper of [true, false]) {
    const shell = makeDetailedVoxelMimicShell(upper);
    checkSurface(shell);
    const [width, height, depth] = sizeOf(shell);
    assert.ok(width > 2.25 && width < 2.55, `rind width ${width}`);
    assert.ok(height > 0.72 && height < 0.92, `rind height ${height}`);
    assert.ok(depth > 2.0 && depth < 2.35, `rind depth ${depth}`);
    assert.ok(shell.getAttribute('position').count > 3500,
      'the new shell should carry materially finer stepped shape than the coarse B study');
    const { min, max } = shell.boundingBox;
    assert.ok(upper ? Math.abs(min.y) < 0.001 : Math.abs(max.y) < 0.001,
      'both cut lips must meet at the original hinge plane');
  }
});

test('shell cut has distinct rind, rib, flesh, and throat roles for an open mouth', () => {
  const shell = makeDetailedVoxelMimicShell(true);
  const color = shell.getAttribute('color');
  const unique = new Set();
  for (let i = 0; i < color.count; i++)
    unique.add(`${color.getX(i).toFixed(3)},${color.getY(i).toFixed(3)},${color.getZ(i).toFixed(3)}`);
  assert.ok(unique.size >= 4, `only ${unique.size} color roles found`);
});

test('throat, teeth, stem, and eyes align with the current split-shell landmarks', () => {
  const throat = makeDetailedVoxelMimicThroat();
  const teeth = makeDetailedVoxelMimicTeeth();
  const stem = makeDetailedVoxelMimicStem();
  const eye = makeDetailedVoxelMimicEye();
  for (const part of [throat, teeth, stem, eye]) checkSurface(part);
  const [throatW, throatH, throatD] = sizeOf(throat);
  assert.ok(throatW > 1.3 && throatW < 1.7);
  assert.ok(throatH < 0.12 && throatD > 0.6);
  teeth.computeBoundingBox();
  assert.ok(teeth.boundingBox.min.x < -0.56 && teeth.boundingBox.max.x > 0.56);
  assert.ok(teeth.boundingBox.min.y < -0.18 && teeth.boundingBox.max.y <= 0.12);
  assert.ok(teeth.boundingBox.min.z > 1.25 && teeth.boundingBox.max.z < 1.65);
  stem.computeBoundingBox();
  assert.ok(stem.boundingBox.min.y < 0.86 && stem.boundingBox.max.y > 1.25);
  assert.ok(stem.boundingBox.min.z > 0.55 && stem.boundingBox.max.z < 0.98);
  const [eyeW, eyeH, eyeD] = sizeOf(eye);
  assert.ok(eyeW > 0.10 && eyeW < 0.24);
  assert.ok(eyeH > 0.10 && eyeH < 0.24);
  assert.ok(eyeD > 0.04 && eyeD < 0.15);
});

test('warning eyes seat into the upper rind instead of floating ahead of it', () => {
  const rig = new MimicRig(new THREE.Group(), 'voxel');
  const shell = rig.upper.getObjectByName('Mimic detailed voxel upper shell');
  const vertices = shell.geometry.getAttribute('position');
  for (const eye of rig.upper.children.filter(child => child.name === 'Mimic seed eye')) {
    eye.geometry.computeBoundingBox();
    let front = -Infinity;
    for (let i = 0; i < vertices.count; i++) {
      if (Math.abs(vertices.getX(i) - eye.position.x) > 0.11
        || Math.abs(vertices.getY(i) - eye.position.y) > 0.11) continue;
      front = Math.max(front, vertices.getZ(i) + shell.position.z);
    }
    assert.ok(Number.isFinite(front));
    const back = eye.position.z + eye.geometry.boundingBox.min.z;
    const tip = eye.position.z + eye.geometry.boundingBox.max.z;
    assert.ok(back <= front + 0.01, `eye back ${back} is ahead of rind ${front}`);
    assert.ok(tip > front, `eye tip ${tip} is buried in rind ${front}`);
  }
});

test('root pieces retain the animated segment and planted foot scale with shaped surfaces', () => {
  const segment = makeDetailedVoxelMimicRootSegment();
  const foot = makeDetailedVoxelMimicRootFoot();
  for (const part of [segment, foot]) checkSurface(part);
  const [segmentW, segmentH, segmentD] = sizeOf(segment);
  assert.ok(segmentW > 0.30 && segmentW < 0.47);
  assert.ok(segmentH > 1.0 && segmentH < 1.15);
  assert.ok(segmentD > 0.28 && segmentD < 0.44);
  const [footW, footH, footD] = sizeOf(foot);
  assert.ok(footW > 0.38 && footW < 0.55);
  assert.ok(footH > 0.14 && footH < 0.28);
  assert.ok(footD > 0.50 && footD < 0.70);
  assert.ok(segment.getAttribute('position').count > 36,
    'a root should have a shaped silhouette rather than one box');
});
