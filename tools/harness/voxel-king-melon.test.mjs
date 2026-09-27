import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKingMelonGeometry, buildVoxelKingMelonGeometry,
  kingMelonGeometryForMode } from '../../src/world/KingMelonGeometry.ts';

const RADIUS = 5.6;
const EPSILON = 0.0001;

test('voxel King Melon stays inside the legendary collider art envelope', () => {
  const geometry = buildVoxelKingMelonGeometry(RADIUS);
  const box = geometry.boundingBox;
  assert.ok(box, 'geometry has computed bounds');
  for (const axis of ['x', 'z']) {
    assert.ok(box.min[axis] >= -RADIUS * 1.08 - EPSILON, `${axis} negative edge`);
    assert.ok(box.max[axis] <= RADIUS * 1.08 + EPSILON, `${axis} positive edge`);
    assert.ok(Math.abs(box.min[axis] + box.max[axis]) < 0.6,
      `${axis} remains centered on the physics body`);
  }
  assert.ok(box.min.y >= -RADIUS * 0.9 - EPSILON, 'bottom remains inside envelope');
  assert.ok(box.max.y <= RADIUS * 0.9 + EPSILON, 'crown remains inside envelope');
  assert.ok(Math.abs(box.min.y + box.max.y) < 0.7,
    'vertical center remains near the physics body');
  assert.ok(box.max.x - box.min.x > RADIUS * 1.8, 'legendary silhouette remains wide');
  assert.ok(box.max.y - box.min.y > RADIUS * 1.6, 'legendary silhouette remains tall');
  geometry.dispose();
});

test('voxel rind is one connected colored surface with broad stripe contrast', () => {
  const geometry = buildVoxelKingMelonGeometry(RADIUS);
  const positions = geometry.getAttribute('position');
  const colors = geometry.getAttribute('color');
  assert.equal(geometry.userData.voxelConnectedComponents, 1);
  assert.equal(colors.count, positions.count, 'every surface vertex has a color');
  assert.ok(positions.count > 3000, 'the landmark has shaped visible faces');
  assert.ok(positions.count < 60000, 'hidden cells do not all become draw faces');
  let minGreen = Infinity;
  let maxGreen = 0;
  let equatorSamples = 0;
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    if (Math.abs(y) > 0.3) continue;
    const r = Math.hypot(positions.getX(i), positions.getZ(i));
    if (r < RADIUS * 0.9) continue;
    equatorSamples++;
    minGreen = Math.min(minGreen, colors.getY(i));
    maxGreen = Math.max(maxGreen, colors.getY(i));
  }
  assert.ok(equatorSamples > 300, 'stripe check sampled the exposed equator');
  assert.ok(maxGreen > minGreen * 2.5, 'dark and pale rind bands read apart');
  geometry.dispose();
});

test('voxel mode selects its own geometry while baseline keeps the original rind', () => {
  const baseline = kingMelonGeometryForMode(RADIUS, 'baseline');
  const original = buildKingMelonGeometry(RADIUS);
  const voxel = kingMelonGeometryForMode(RADIUS, 'voxel');
  assert.equal(baseline.getAttribute('position').count,
    original.getAttribute('position').count, 'baseline remains the existing geometry');
  assert.deepEqual(baseline.boundingBox.min.toArray(), original.boundingBox.min.toArray());
  assert.deepEqual(baseline.boundingBox.max.toArray(), original.boundingBox.max.toArray());
  assert.notEqual(voxel.getAttribute('position').count,
    baseline.getAttribute('position').count, 'voxel mode has a distinct rind surface');
  baseline.dispose();
  original.dispose();
  voxel.dispose();
});
