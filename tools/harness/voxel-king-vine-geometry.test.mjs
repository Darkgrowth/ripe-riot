import test from 'node:test';
import assert from 'node:assert/strict';
import { voxelKingVineBase, voxelKingVineArm, voxelKingVineConnector, voxelKingVineCore,
  voxelKingVineGuardLeaf, voxelKingVineSeed } from '../../src/boss/VoxelKingVineGeometry.ts';

function bounds(geometry) {
  assert.equal(geometry.userData.voxelConnectedComponents, 1,
    `${geometry.name} must be a single connected plant surface`);
  assert.ok(geometry.getAttribute('position').count > 0, `${geometry.name} is empty`);
  assert.ok(geometry.getAttribute('color'), `${geometry.name} has no authored colour`);
  return geometry.boundingBox;
}

test('King Vine has a grounded, broad, connected guardian silhouette', () => {
  const geometry = voxelKingVineBase();
  const box = bounds(geometry);
  assert.ok(box.min.y >= -0.1 && box.min.y <= 0.1);
  assert.ok(box.max.y >= 2.9 && box.max.y <= 3.5);
  assert.ok(box.max.x - box.min.x >= 3.0, 'buttress roots and crown read across the path');
  assert.ok(box.max.z - box.min.z >= 2.6, 'roots spread in depth');
  assert.ok(geometry.userData.voxelCount > 1000, 'plant has authored volume');
  assert.ok(geometry.getAttribute('position').count / 3 < 40000,
    'boss body stays within a practical triangle budget');
  geometry.dispose();
});

test('sweep arm reaches the existing attack lane as one lateral paddle', () => {
  const geometry = voxelKingVineArm();
  const box = bounds(geometry);
  assert.ok(box.min.z >= -0.5 && box.min.z <= 0.15, 'starts at the arm pivot');
  assert.ok(box.max.z >= 9.2 && box.max.z <= 9.8, 'stays near the old 9.5 m reach');
  assert.ok(box.max.x - box.min.x >= 1.3, 'end has a lateral sweeping profile');
  assert.ok(geometry.userData.voxelCount > 300);
  assert.ok(geometry.getAttribute('position').count / 3 < 30000);
  geometry.dispose();
});

test('the exposed core stays centered on the authoritative recovery hit', () => {
  const geometry = voxelKingVineCore();
  const box = bounds(geometry);
  assert.ok(Math.abs((box.min.x + box.max.x) / 2) <= 0.1);
  assert.ok(Math.abs((box.min.y + box.max.y) / 2 - 1.7) <= 0.1);
  assert.ok(Math.abs((box.min.z + box.max.z) / 2) <= 0.1);
  assert.ok(box.max.y - box.min.y >= 0.8, 'vulnerable stem is visible at normal distance');
  geometry.dispose();
});

test('a hinged protective leaf covers the core until recovery', () => {
  const geometry = voxelKingVineGuardLeaf();
  const box = bounds(geometry);
  assert.ok(box.min.x >= -0.15 && box.min.x <= 0.1, 'starts at its hinge');
  assert.ok(box.max.x >= 0.62 && box.max.x <= 0.9, 'reaches inward across half the stem');
  assert.ok(box.min.y <= -0.5 && box.max.y >= 0.5, 'covers the stem vertically');
  assert.ok(box.max.z - box.min.z <= 0.5, 'is a leaf blade, not a bulky head');
  geometry.dispose();
});

test('flying seed is a compact pointed pod centered on its projectile state', () => {
  const geometry = voxelKingVineSeed();
  const box = bounds(geometry);
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(box.min[axis] >= -0.75 && box.max[axis] <= 0.75,
      `seed ${axis} extent stays inside the existing deflection target`);
    assert.ok(Math.abs((box.min[axis] + box.max[axis]) / 2) <= 0.1,
      `seed ${axis} is centered on the logical position`);
  }
  assert.ok(box.max.z - box.min.z > box.max.x - box.min.x,
    'seed points along its flight path');
  geometry.dispose();
});

test('one connected braided stem can reach the hanging melon at different heights', () => {
  for (const topY of [6.5, 18.2]) {
    const geometry = voxelKingVineConnector(topY);
    const box = bounds(geometry);
    assert.ok(box.min.y >= 2.7 && box.min.y <= 3.05, 'joins the crown');
    assert.ok(Math.abs(box.max.y - topY) < 0.25, 'reaches the existing melon underside');
    assert.ok(box.max.x - box.min.x < 1.0 && box.max.z - box.min.z < 1.0,
      'connector stays a taut stem rather than a canopy');
    geometry.dispose();
  }
});
