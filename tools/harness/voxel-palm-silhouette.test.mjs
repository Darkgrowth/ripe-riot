import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(async () => vite.close());
const { voxelPlantShape } = await vite.ssrLoadModule('/src/art/voxel/VoxelTrees.ts');
const { plantShape } = await vite.ssrLoadModule('/src/plants/PlantGeometry.ts');

function profile(variant) {
  const old = plantShape('palm', variant, false);
  const next = voxelPlantShape('palm', variant, false);
  const position = next.geometry.getAttribute('position');
  const color = next.geometry.getAttribute('color');
  const leaves = [];
  for (let i = 0; i < position.count; i++) {
    if (color.getY(i) <= color.getX(i) * 1.15) continue;
    leaves.push({ x: position.getX(i), y: position.getY(i), z: position.getZ(i) });
  }
  assert.ok(leaves.length > 500, 'palm needs a substantial shaded crown');
  const extent = axis => Math.max(...leaves.map(p => p[axis])) - Math.min(...leaves.map(p => p[axis]));
  return {
    old, next, leaves,
    minY: Math.min(...leaves.map(p => p.y)),
    maxY: Math.max(...leaves.map(p => p.y)),
    widthX: extent('x'), widthZ: extent('z'),
    meanX: leaves.reduce((sum, p) => sum + p.x, 0) / leaves.length,
  };
}

test('palm fronds read as broad overhead crowns without hanging comb tips', () => {
  for (const variant of [0, 1, 2]) {
    const p = profile(variant);
    assert.equal(p.next.height, p.old.height);
    assert.deepEqual(p.next.collider, p.old.collider);
    assert.deepEqual(p.next.attachPoints.map(point => point.toArray()),
      p.old.attachPoints.map(point => point.toArray()));
    assert.equal(p.next.geometry.userData.voxelConnectedComponents, 1);
    assert.ok(p.next.geometry.getAttribute('position').count / 3 < 4000,
      'route palms must stay within their existing triangle budget');
    assert.ok(p.minY > p.next.height - 1.25,
      `variant ${variant} has dangling frond tips at ${p.minY.toFixed(2)} m`);
    assert.ok(p.widthX > 4.3 && p.widthZ > 4.3,
      'the broad fronds need a readable shade silhouette');
  }
});

test('palm variants have distinct sheltered and cascading crown silhouettes', () => {
  const [shade, swept, cascade] = [0, 1, 2].map(profile);
  assert.ok(swept.meanX > shade.meanX + 0.14,
    'windswept palm foliage should visibly favor one side');
  assert.ok(cascade.minY - cascade.next.height < shade.minY - shade.next.height - 0.16,
    'cascading palm should have a lower but still compact frond edge');
});

test('palm trunk has a coherent mid-height cross-section without missing corners', () => {
  const shape = voxelPlantShape('palm', 0, false);
  const position = shape.geometry.getAttribute('position');
  const color = shape.geometry.getAttribute('color');
  const sampleY = Math.round(shape.height * 0.52 / 0.22) * 0.22;
  const bark = [];
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(position.getY(i) - sampleY) > 0.005) continue;
    if (color.getX(i) <= color.getY(i) * 1.12) continue;
    bark.push({ x: position.getX(i), z: position.getZ(i) });
  }
  assert.ok(bark.length > 8);
  const xs = bark.map(p => p.x), zs = bark.map(p => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  for (const [x, z] of [[minX, minZ], [minX, maxZ], [maxX, minZ], [maxX, maxZ]]) {
    assert.ok(bark.some(p => Math.abs(p.x - x) < 0.005 && Math.abs(p.z - z) < 0.005),
      `missing trunk corner at ${x.toFixed(2)},${z.toFixed(2)}`);
  }
});

test('palm frond fans leave readable gaps around the middle canopy', () => {
  for (const [variant, minimumEmpty] of [[0, 14], [2, 19]]) {
    const p = profile(variant);
    const centre = p.next.attachPoints.reduce((sum, point) => sum.add(point),
      p.next.attachPoints[0].clone().set(0, 0, 0)).multiplyScalar(1 / p.next.attachPoints.length);
    const bins = Array(72).fill(false);
    for (const leaf of p.leaves) {
      const x = leaf.x - centre.x, z = leaf.z - centre.z;
      const radius = Math.hypot(x, z);
      if (radius < 1.8 || radius >= 2.5) continue;
      bins[Math.floor((Math.atan2(x, z) + Math.PI) / (2 * Math.PI) * 72) % 72] = true;
    }
    assert.ok(bins.filter(occupied => !occupied).length >= minimumEmpty,
      `palm ${variant} needs visible negative space between broad fronds`);
  }
});
