import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(async () => vite.close());
const THREE = await vite.ssrLoadModule('three');
const { Rng } = await vite.ssrLoadModule('/src/core/Rng.ts');
const { PhysicsWorld } = await vite.ssrLoadModule('/src/physics/PhysicsWorld.ts');
const { PlantSystem } = await vite.ssrLoadModule('/src/plants/Plants.ts');

test('voxel mode gives route palms a stepped crown without moving coconuts or trunk collision', async () => {
  await PhysicsWorld.load();
  const physics = new PhysicsWorld();
  physics.init();
  const voxelScene = new THREE.Scene();
  const baselineScene = new THREE.Scene();
  const voxelPlants = new PlantSystem(voxelScene, physics, 'voxel');
  const baselinePlants = new PlantSystem(baselineScene, physics);
  const position = new THREE.Vector3(52.5, 2.4, 63.5);
  const voxel = voxelPlants.plant(1, 'palm', position, new Rng(73), { variant: 1, scale: 1.15 });
  const baseline = baselinePlants.plant(2, 'palm', position, new Rng(73), { variant: 1, scale: 1.15 });
  const mesh = voxelScene.children.find(child => child.name === `Plants:${voxel.batchKey}`);

  assert.match(voxel.batchKey, /:voxel$/);
  assert.doesNotMatch(baseline.batchKey, /:voxel$/);
  assert.match(mesh?.geometry.name ?? '', /^VoxelTree:palm:/);
  assert.ok(mesh.geometry.userData.voxelCount > 300, 'fronds need a shaped silhouette');
  assert.ok(mesh.geometry.getAttribute('position').count / 3 < 4000,
    'background palms must use a coarser grid than hero assets');
  assert.equal(mesh.geometry.userData.voxelConnectedComponents, 1);
  assert.deepEqual(voxel.nodes.map(node => node.local.toArray()),
    baseline.nodes.map(node => node.local.toArray()));
  assert.deepEqual(voxel.colliders.length, baseline.colliders.length);
  assert.equal(voxel.height, baseline.height);

  voxelPlants.dispose();
  baselinePlants.dispose();
  physics.world.free();
});
