import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EncounterVisual } from '../../src/enemies/EncounterVisuals.ts';
import { voxelSnapjawBase, voxelSnapjawCore, voxelSnapjawLowerJaw,
  voxelSnapjawTeeth, voxelSnapjawUpperJaw } from
  '../../src/enemies/VoxelSnapjawGeometry.ts';

const state = (phase, health = 2, timeLeft = 0) => ({
  kind: 'snapjaw', position: [0, 0, 0], heading: 0, phase, timeLeft,
  health, baited: false, capturedVictimId: null, captureTimeLeft: 0,
});

test('voxel Snapjaw base and both leaf jaws are connected, visible-scale surfaces', () => {
  for (const make of [voxelSnapjawBase, voxelSnapjawLowerJaw, voxelSnapjawUpperJaw]) {
    const geometry = make();
    assert.equal(geometry.userData.voxelConnectedComponents, 1, geometry.name);
    assert.ok(geometry.getAttribute('position').count > 1500, geometry.name);
    assert.equal(geometry.getAttribute('color').count,
      geometry.getAttribute('position').count, geometry.name);
    assert.ok(geometry.boundingBox.max.x - geometry.boundingBox.min.x > 2,
      geometry.name);
    geometry.dispose();
  }
});

test('voxel-only poses open for recovery, react to a hit, then remain wilted after defeat', () => {
  const scene = new THREE.Scene();
  const voxel = new EncounterVisual('snapjaw', scene, 'voxel');
  const jaw = voxel.root.getObjectByName('Snapjaw moving leaf jaw');
  const body = voxel.root.getObjectByName('Snapjaw rooted anatomy');
  const seed = voxel.root.getObjectByName('Snapjaw exposed seed');
  assert.ok(jaw && body && seed);
  voxel.update(state('idle'), 0, 0.016);
  const idleJawY = jaw.position.y;
  voxel.update(state('warn', 2, 0.5), 0, 0.016);
  assert.ok(jaw.position.y > idleJawY);
  voxel.update(state('attack', 2, 0.02), 0, 0.016);
  assert.ok(jaw.position.y < idleJawY + 0.08);
  voxel.update(state('recover', 2, 1), 0, 0.016);
  assert.ok(jaw.position.y > idleJawY + 0.4);
  voxel.update(state('recover', 1, 0.8), 0, 0.016);
  assert.ok(body.rotation.x < -0.1, 'nonlethal strike jerks the rooted plant back');
  voxel.update(state('defeated', 0), 0, 0.8);
  assert.equal(voxel.root.visible, true);
  assert.equal(seed.visible, false);
  assert.ok(body.position.y < -0.4 && body.scale.y < 0.65);
  assert.ok(jaw.position.y < idleJawY + 0.05, 'jaw no longer presents an open bite');
  voxel.update(state('defeated', 0), 0, 10);
  assert.equal(voxel.root.visible, true, 'wilted remnant persists');
  voxel.dispose();
  assert.equal(scene.children.includes(voxel.root), false);
});

test('a visual created from a defeated snapshot starts settled; polygon baseline still vanishes', () => {
  const scene = new THREE.Scene();
  const voxel = new EncounterVisual('snapjaw', scene, 'voxel');
  voxel.update(state('defeated', 0), 0, 0.016);
  const body = voxel.root.getObjectByName('Snapjaw rooted anatomy');
  assert.ok(body.position.y < -0.4);
  assert.equal(voxel.root.visible, true);
  const baseline = new EncounterVisual('snapjaw', scene, 'polygon');
  baseline.update(state('defeated', 0), 0, 0.016);
  assert.equal(baseline.root.visible, false);
  voxel.dispose();
  baseline.dispose();
});

test('exposed seed is saturated amber against ivory fangs', () => {
  const average = geometry => {
    const colors = geometry.getAttribute('color');
    const total = [0, 0, 0];
    for (let i = 0; i < colors.count; i++) {
      total[0] += colors.getX(i);
      total[1] += colors.getY(i);
      total[2] += colors.getZ(i);
    }
    geometry.dispose();
    return total.map(value => value / colors.count);
  };
  const amber = average(voxelSnapjawCore());
  const ivory = average(voxelSnapjawTeeth());
  assert.ok(amber[1] < ivory[1] * 0.55, 'amber has less yellow than teeth');
  assert.ok(amber[2] < ivory[2] * 0.30, 'amber has far less blue than teeth');
  assert.ok(amber[0] > amber[1] * 1.55, 'seed keeps a warm orange hue');
});

test('recovery reveals a recessed seed with restrained light and size', () => {
  const scene = new THREE.Scene();
  const visual = new EncounterVisual('snapjaw', scene, 'voxel');
  const seed = visual.root.getObjectByName('Snapjaw exposed seed');
  assert.ok(seed);
  visual.update(state('idle'), 0, 0.016);
  const idleGlow = seed.material.emissiveIntensity;
  visual.update(state('recover', 2, 1), 0, 0.016);
  assert.ok(seed.position.z < 0.75, 'seed sits behind the front fangs');
  assert.ok(seed.scale.x <= 1.10, 'recovery leaves clear space around the seed');
  assert.ok(seed.material.emissiveIntensity > idleGlow,
    'recovery still draws attention to the target');
  assert.ok(seed.material.emissiveIntensity < 0.40,
    'the pulse does not wash out the amber surface');
  visual.dispose();
});
