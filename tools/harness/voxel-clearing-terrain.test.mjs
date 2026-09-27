import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import * as THREE from 'three';

// Compile source without opening a browser, game, WebSocket, or preview server.
const compiled = await build({
  stdin: { contents: `export { Terrain } from './src/world/Terrain.ts';
export * as clearing from './src/art/voxel/VoxelClearingTerrain.ts';`,
    resolveDir: process.cwd(), sourcefile: 'voxel-clearing-terrain-entry.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  tsconfig: 'tsconfig.json', logLevel: 'silent',
});
const { Terrain, clearing } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

function nearestVertex(position, x, z) {
  let best = -1, distance = Infinity;
  for (let i = 0; i < position.count; i++) {
    const d = Math.hypot(position.getX(i) - x, position.getZ(i) - z);
    if (d < distance) { best = i; distance = d; }
  }
  assert.ok(distance < 1, `terrain vertex near (${x}, ${z})`);
  return best;
}

test('voxel orchard tint uses the existing ground mesh and preserves collision geometry', () => {
  const terrain = new Terrain();
  const scene = new THREE.Scene();
  const colliderInputs = [];
  const physics = { createTrimesh: (positions, indices) =>
    colliderInputs.push({ positions: positions.slice(), indices: indices.slice() }) };
  terrain.build(scene, physics, true);
  const mesh = terrain.mesh;
  const position = mesh.geometry.getAttribute('position');
  const colors = mesh.geometry.getAttribute('color');
  const beforePositions = position.array.slice();
  const beforeColors = colors.array.slice();
  const routeIndex = nearestVertex(position, -24, 22);
  const gateIndex = nearestVertex(position, -1, 34);
  const outsideIndex = nearestVertex(position, 90, 90);
  assert.equal(typeof clearing.paintVoxelClearingTerrain, 'function',
    'voxel presentation must paint the one authoritative terrain mesh');

  clearing.paintVoxelClearingTerrain(terrain);

  assert.equal(scene.children.length, 1, 'no second ground surface intersects the route');
  assert.equal(terrain.mesh, mesh);
  assert.equal(mesh.geometry.getAttribute('position'), position);
  assert.deepEqual(position.array, beforePositions, 'visible triangles stay on the collision surface');
  assert.equal(colliderInputs.length, 1);
  assert.equal(colliderInputs[0].positions.length,
    (Math.round(terrain.extent / terrain.cell) + 1) ** 2 * 3);
  assert.notDeepEqual(Array.from(colors.array.slice(routeIndex * 3, routeIndex * 3 + 3)),
    Array.from(beforeColors.slice(routeIndex * 3, routeIndex * 3 + 3)),
    'the orchard route receives its voxel earth treatment');
  assert.notDeepEqual(Array.from(colors.array.slice(gateIndex * 3, gateIndex * 3 + 3)),
    Array.from(beforeColors.slice(gateIndex * 3, gateIndex * 3 + 3)),
    'the recorded gate approach receives the same ground treatment');
  assert.deepEqual(Array.from(colors.array.slice(outsideIndex * 3, outsideIndex * 3 + 3)),
    Array.from(beforeColors.slice(outsideIndex * 3, outsideIndex * 3 + 3)),
    'terrain outside the clearing retains its original palette');
  terrain.dispose();
});
