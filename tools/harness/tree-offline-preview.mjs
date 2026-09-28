/** Export the shipped voxel plant geometry and saved fruit sockets for Blender review.
 * node tools/harness/tree-offline-preview.mjs output.json
 * No browser, game process or cursor access is involved. */
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
  const { voxelPlantShape } = await vite.ssrLoadModule('/src/art/voxel/VoxelTrees.ts');
  const samples = [
    ['appleTree', 0, true], ['appleTree', 1, true],
    ['orangeTree', 2, true], ['palm', 0, false], ['palm', 1, false],
    ['gumTree', 0, false], ['spikeShrub', 1, false],
  ];
  const output = samples.map(([type, variant, harvestCrown]) => {
    const shape = voxelPlantShape(type, variant, harvestCrown);
    const position = shape.geometry.getAttribute('position');
    const color = shape.geometry.getAttribute('color');
    return {
      type, variant, harvestCrown,
      vertices: Array.from(position.array), colors: Array.from(color.array),
      fruit: shape.attachPoints.map(point => point.toArray()),
      height: shape.height, triangles: position.count / 3,
      components: shape.geometry.userData.voxelConnectedComponents,
    };
  });
  writeFileSync(process.argv[2], JSON.stringify(output));
  console.log(output.map(x => `${x.type}:${x.variant} ${x.triangles} triangles, ${x.components} components`).join('\n'));
} finally {
  await vite.close();
}
