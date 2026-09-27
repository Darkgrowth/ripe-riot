import test from 'node:test';
import assert from 'node:assert/strict';
import { voxelSpitterBase, voxelSpitterBulb, voxelSpitterMuzzle,
  voxelSpitterLeaves, voxelSpitterPod } from
  '../../src/enemies/VoxelSpitterGeometry.ts';

function bounds(geometry) {
  const box = geometry.boundingBox;
  assert.ok(box, `${geometry.name} needs a bounding box`);
  assert.equal(geometry.getAttribute('color').count,
    geometry.getAttribute('position').count, `${geometry.name} uses vertex color`);
  assert.ok(geometry.getAttribute('position').count > 100,
    `${geometry.name} has a visible exposed surface`);
  return box;
}

test('rooted Spitter base is one planted stalk at encounter scale', () => {
  const geometry = voxelSpitterBase();
  const box = bounds(geometry);
  assert.equal(geometry.userData.voxelConnectedComponents, 1);
  assert.ok(box.min.y <= 0.01 && box.max.y >= 1.8 && box.max.y <= 2.02);
  assert.ok(box.max.x - box.min.x >= 1.6, 'roots spread beyond narrow stalk');
  geometry.dispose();
});

test('pressure bulb sits behind the forward launching aperture', () => {
  const bulb = voxelSpitterBulb();
  const muzzle = voxelSpitterMuzzle();
  const bulbBox = bounds(bulb);
  const muzzleBox = bounds(muzzle);
  assert.equal(bulb.userData.voxelConnectedComponents, 1);
  assert.equal(muzzle.userData.voxelConnectedComponents, 1);
  assert.ok(bulbBox.min.z < -0.9 && bulbBox.max.z < -0.05,
    'pressure sac extends behind head center');
  assert.ok(muzzleBox.min.z < -0.2 && muzzleBox.max.z >= 0,
    'aperture ends at the logical projectile spawn plane');
  assert.ok(muzzleBox.max.x - muzzleBox.min.x < 1.1,
    'launch tube remains narrower than a broad biting jaw');
  bulb.dispose();
  muzzle.dispose();
});

test('lateral leaves add a clear silhouette while pod stays within hit tolerance', () => {
  const leaves = voxelSpitterLeaves();
  const pod = voxelSpitterPod();
  const leavesBox = bounds(leaves);
  const podBox = bounds(pod);
  assert.ok(leavesBox.min.x < -0.9 && leavesBox.max.x > 0.9);
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Math.max(Math.abs(podBox.min[axis]), Math.abs(podBox.max[axis])) <= 0.42,
      `pod ${axis} radius stays small relative to 0.85m hit tolerance`);
  }
  assert.ok(podBox.max.z - podBox.min.z >
    (podBox.max.x - podBox.min.x) * 1.3, 'seed is elongated along its flight axis');
  const positions = pod.getAttribute('position');
  let middleWidth = 0;
  let tipWidth = 0;
  for (let i = 0; i < positions.count; i++) {
    const x = Math.abs(positions.getX(i));
    const z = positions.getZ(i);
    if (Math.abs(z) < 0.08) middleWidth = Math.max(middleWidth, x);
    if (z > 0.27) tipWidth = Math.max(tipWidth, x);
  }
  assert.ok(middleWidth > 0.20 && tipWidth < middleWidth * 0.75,
    'front of seed tapers to a narrower point');
  assert.ok(pod.getAttribute('position').count > 300, 'pod has a faceted seed surface');
  leaves.dispose();
  pod.dispose();
});
