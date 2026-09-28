import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(async () => vite.close());
const { voxelPlantShape } = await vite.ssrLoadModule('/src/art/voxel/VoxelTrees.ts');
const { plantShape } = await vite.ssrLoadModule('/src/plants/PlantGeometry.ts');

test('gum and spike shrubs have connected colored voxel surfaces with unchanged gameplay nodes', () => {
  for (const type of ['gumTree', 'spikeShrub']) for (const variant of [0, 1, 2]) {
    const original = plantShape(type, variant, false);
    const next = voxelPlantShape(type, variant, false);
    assert.match(next.geometry.name, new RegExp(`^VoxelTree:${type}:${variant}$`));
    assert.equal(next.geometry.userData.voxelConnectedComponents, 1);
    assert.ok(next.geometry.getAttribute('position').count / 3 < 3500,
      `${type}:${variant} needs a restrained background mesh`);
    assert.deepEqual(next.attachPoints.map(pt => pt.toArray()),
      original.attachPoints.map(pt => pt.toArray()));
    assert.deepEqual(next.collider, original.collider);
    assert.equal(next.height, original.height);
    assert.ok(next.geometry.getAttribute('swayWeight'));
  }
});
