import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(async () => vite.close());
const THREE = await vite.ssrLoadModule('three');
const { Terrain } = await vite.ssrLoadModule('/src/world/Terrain.ts');
const { Dressing } = await vite.ssrLoadModule('/src/world/Dressing.ts');
const { Rng } = await vite.ssrLoadModule('/src/core/Rng.ts');
const { PhysicsWorld } = await vite.ssrLoadModule('/src/physics/PhysicsWorld.ts');
const { PlantSystem } = await vite.ssrLoadModule('/src/plants/Plants.ts');
const { plantShape } = await vite.ssrLoadModule('/src/plants/PlantGeometry.ts');
const { voxelPlantShape } = await vite.ssrLoadModule('/src/art/voxel/VoxelTrees.ts');

test('Spitter hill dressing uses voxel batches while retaining seeded clearances', () => {
  const terrain = new Terrain();
  const baselineScene = new THREE.Scene(), voxelScene = new THREE.Scene();
  const baseline = new Dressing(), voxel = new Dressing('voxel');
  baseline.build(baselineScene, terrain);
  voxel.build(voxelScene, terrain);
  assert.deepEqual(voxel.counts, baseline.counts);
  assert.equal(voxel.total, baseline.total);
  const point = new THREE.Vector3(), matrix = new THREE.Matrix4();
  let local = 0;
  for (const mesh of voxelScene.children.filter(child => child.isInstancedMesh)) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      point.setFromMatrixPosition(matrix);
      if (Math.hypot(point.x + 31, point.z + 8) > 10) continue;
      local++;
      assert.match(mesh.name, /^Dressing:voxel:/, `legacy dressing at ${point.x},${point.z}`);
      assert.ok(terrain.pathWeight(point.x, point.z) <= 0.42,
        'converted dressing must not obstruct the hill track');
    }
  }
  assert.ok(local > 5, 'Spitter should be surrounded by several converted details');
  baseline.dispose();
  voxel.dispose();
});

test('all Boulder Plum nests get voxel art with identical sockets and collider', async () => {
  const oldShape = plantShape('boulderBush', 0, false);
  const newShape = voxelPlantShape('boulderBush', 0, false);
  assert.deepEqual(newShape.attachPoints.map(p => p.toArray()),
    oldShape.attachPoints.map(p => p.toArray()));
  assert.deepEqual(newShape.collider, oldShape.collider);
  assert.equal(newShape.height, oldShape.height);
  assert.match(newShape.geometry.name, /^VoxelTree:boulderBush/);
  assert.equal(newShape.geometry.userData.voxelConnectedComponents, 1);
  newShape.geometry.computeBoundingBox();
  assert.ok(newShape.geometry.boundingBox.max.y < oldShape.attachPoints[0].y - 0.12,
    'the main plum socket must sit visibly above the supporting stump');

  await PhysicsWorld.load();
  const physics = new PhysicsWorld();
  physics.init();
  const scene = new THREE.Scene(), baselineScene = new THREE.Scene();
  const plants = new PlantSystem(scene, physics, 'voxel');
  const baselinePlants = new PlantSystem(baselineScene, physics);
  const nearRng = new Rng(1), baselineRng = new Rng(1);
  const near = plants.plant(1, 'boulderBush', new THREE.Vector3(-35, 10, -11.5),
    nearRng, { variant: 0, scale: 1 });
  const baselineNear = baselinePlants.plant(1, 'boulderBush',
    new THREE.Vector3(-35, 10, -11.5), baselineRng, { variant: 0, scale: 1 });
  const hill = plants.plant(2, 'boulderBush', new THREE.Vector3(-36, 21, -30),
    new Rng(2), { variant: 0, scale: 1 });
  const far = plants.plant(3, 'boulderBush', new THREE.Vector3(80, 10, -60),
    new Rng(3), { variant: 0, scale: 1 });
  assert.match(near.batchKey, /voxel/);
  assert.match(hill.batchKey, /voxel/);
  assert.match(far.batchKey, /voxel/);
  assert.doesNotMatch(baselineNear.batchKey, /voxel/);
  assert.equal(near.nodes.length, far.nodes.length);
  assert.deepEqual(near.nodes.map(node => node.local.toArray()),
    baselineNear.nodes.map(node => node.local.toArray()));
  assert.equal(nearRng.next(), baselineRng.next(), 'visual selection must not change seeded fruit');
  assert.equal(near.body, null);
  assert.equal(baselineNear.body, null);
  plants.dispose();
  baselinePlants.dispose();
  physics.world.free();
});
