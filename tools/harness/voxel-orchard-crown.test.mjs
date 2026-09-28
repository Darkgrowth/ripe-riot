import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(async () => vite.close());
const { voxelPlantShape } = await vite.ssrLoadModule('/src/art/voxel/VoxelTrees.ts');
const { plantShape } = await vite.ssrLoadModule('/src/plants/PlantGeometry.ts');

test('each orchard habit keeps foliage near low saved fruit without bloating the batched mesh', () => {
  for (const type of ['appleTree', 'orangeTree']) for (const variant of [0, 1, 2]) {
    const original = plantShape(type, variant, true);
    const next = voxelPlantShape(type, variant, true);
    const position = next.geometry.getAttribute('position');
    const color = next.geometry.getAttribute('color');
    const leaf = [];
    for (let i = 0; i < position.count; i++) {
      if (color.getY(i) > color.getX(i) * 1.12) {
        leaf.push([position.getX(i), position.getY(i), position.getZ(i)]);
      }
    }
    const lowFruit = next.attachPoints.filter(pt => pt.y < next.height - 1.7);
    assert.ok(lowFruit.length >= 3);
    for (const pt of lowFruit) {
      assert.ok(leaf.some(([x, y, z]) => y >= pt.y && y < pt.y + 0.85
        && Math.hypot(x - pt.x, y - pt.y, z - pt.z) < 0.85),
      `${type}:${variant} has an exposed fruit spur without nearby foliage`);
    }
    assert.equal(next.geometry.userData.voxelConnectedComponents, 1);
    assert.ok(position.count / 3 < 12000);
    assert.deepEqual(next.attachPoints.map(pt => pt.toArray()),
      original.attachPoints.map(pt => pt.toArray()));
    assert.deepEqual(next.collider, original.collider);
  }
});
