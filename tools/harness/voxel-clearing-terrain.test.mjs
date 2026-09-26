import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
after(async () => vite.close());
const { Terrain } = await vite.ssrLoadModule('/src/world/Terrain.ts');
const { buildVoxelClearingTerrain } = await vite.ssrLoadModule('/src/art/voxel/VoxelClearingTerrain.ts');

test('one batched orchard ground mesh stays close to the unchanged terrain height', () => {
  const terrain = new Terrain();
  const before = [terrain.height(-24, 22), terrain.height(-7, 29), terrain.height(-35, 18)];
  const mesh = buildVoxelClearingTerrain(terrain);
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  assert.equal(mesh.name, 'Detailed voxel orchard ground');
  assert.ok(position.count > 50_000, `ground should be batched; got ${position.count} vertices`);
  assert.equal(geometry.getAttribute('color').count, position.count);
  assert.deepEqual(before, [terrain.height(-24, 22), terrain.height(-7, 29), terrain.height(-35, 18)]);
  let largestGap = 0;
  for (let i = 0; i < position.count; i += 6) {
    if (normal.getY(i) < 0.95) continue; // upright voxel seams sit below the walking surface
    for (let k = i; k < i + 6; k++) {
      largestGap = Math.max(largestGap, Math.abs(position.getY(k)
        - terrain.height(position.getX(k), position.getZ(k))));
    }
  }
  assert.ok(largestGap < 0.35, `walking surface diverges ${largestGap.toFixed(3)} m`);
  assert.ok(geometry.boundingBox.min.x >= -55 && geometry.boundingBox.max.x <= 7);
  geometry.dispose();
  mesh.material.dispose();
});
