import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(async () => vite.close());
const THREE = await vite.ssrLoadModule('three');
const { Rng } = await vite.ssrLoadModule('/src/core/Rng.ts');
const { PhysicsWorld } = await vite.ssrLoadModule('/src/physics/PhysicsWorld.ts');
const { PlantSystem } = await vite.ssrLoadModule('/src/plants/Plants.ts');
const { FruitRenderer } = await vite.ssrLoadModule('/src/fruit/FruitRenderer.ts');
const { skipVoxelPilotDecor } = await vite.ssrLoadModule('/src/fruit/FruitSystem.ts');

test('voxel pilot batches orchard trees separately while outer island keeps baseline', async () => {
  await PhysicsWorld.load();
  const physics = new PhysicsWorld();
  physics.init();
  const scene = new THREE.Scene();
  const plants = new PlantSystem(scene, physics, 'voxel');
  const inside = plants.plant(1, 'appleTree', new THREE.Vector3(-24, 3, 22),
    new Rng(1), { variant: 0, scale: 1 });
  const outside = plants.plant(2, 'appleTree', new THREE.Vector3(3, 3, 22),
    new Rng(2), { variant: 0, scale: 1 });
  assert.notEqual(inside.batchKey, outside.batchKey);
  assert.match(inside.batchKey, /voxel/);
  assert.doesNotMatch(outside.batchKey, /voxel/);
  const voxelBatch = scene.children.find(child => child.name === `Plants:${inside.batchKey}`);
  const oldBatch = scene.children.find(child => child.name === `Plants:${outside.batchKey}`);
  assert.match(voxelBatch?.geometry.name ?? '', /^VoxelTree:appleTree/);
  assert.doesNotMatch(oldBatch?.geometry.name ?? '', /^VoxelTree:/);
  assert.equal(inside.nodes.length, outside.nodes.length);
  plants.dispose();
  physics.world.free();
});

test('baseline mode keeps the orchard tree on its existing geometry path', async () => {
  await PhysicsWorld.load();
  const physics = new PhysicsWorld();
  physics.init();
  const scene = new THREE.Scene();
  const plants = new PlantSystem(scene, physics);
  const tree = plants.plant(3, 'orangeTree', new THREE.Vector3(-24, 3, 22),
    new Rng(3), { variant: 1, scale: 1 });
  assert.doesNotMatch(tree.batchKey, /voxel/);
  const batch = scene.children.find(child => child.name === `Plants:${tree.batchKey}`);
  assert.doesNotMatch(batch?.geometry.name ?? '', /^VoxelTree:/);
  plants.dispose();
  physics.world.free();
});

test('fruit pilot swaps only the ordinary species within existing instanced batches', () => {
  const scene = new THREE.Scene();
  const renderer = new FruitRenderer(scene, 'voxel');
  const makeFruit = (id, species) => ({
    id, species, visible: true, renderScale: 0.4, position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(), tint: new THREE.Color(0xffffff), emissive: false,
  });
  renderer.update([makeFruit(1, 'apple'), makeFruit(2, 'orange'),
    makeFruit(3, 'watermelon'), makeFruit(4, 'coconut')]);
  for (const species of ['apple', 'orange', 'watermelon']) {
    const batch = scene.children.find(child => child.name === `Fruit:${species}`);
    assert.match(batch?.geometry.name ?? '', new RegExp(`^VoxelFruit:${species}$`));
    assert.equal(batch.count, 1);
  }
  const coconut = scene.children.find(child => child.name === 'Fruit:coconut');
  assert.doesNotMatch(coconut?.geometry.name ?? '', /^VoxelFruit:/);
  renderer.dispose();
});

test('distant ordinary fruit use one cheaper batch per species and retain instance effects', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const renderer = new FruitRenderer(scene, 'voxel', camera);
  const fruit = (id, z) => ({
    id, species: 'apple', visible: true, renderScale: 0.34,
    position: new THREE.Vector3(0, 0, z), quaternion: new THREE.Quaternion(),
    tint: new THREE.Color(id === 1 ? 0xffddcc : 0xcceeff), emissive: id === 2,
  });
  const close = fruit(1, 4), distant = fruit(2, 30);
  renderer.update([close, distant]);
  const near = scene.children.find(child => child.name === 'Fruit:apple');
  const far = scene.children.find(child => child.name === 'Fruit:apple:far');
  assert.equal(near?.count, 1);
  assert.equal(far?.count, 1);
  assert.ok(far.geometry.getAttribute('position').count < near.geometry.getAttribute('position').count * 0.4);
  assert.ok(Math.abs(far.geometry.getAttribute('instanceEmissive').getX(0) - 0.85) < 1e-6);
  assert.ok(far.instanceColor.getX(0) > 0);
  assert.equal(renderer.lastDrawn, 2);
  assert.equal(renderer.speciesCount, 1);
  assert.equal(renderer.activeDrawBatches, 2);
  renderer.highlightId = distant.id;
  renderer.update([close, distant]);
  assert.equal(near.count, 2, 'highlighted fruit should retain near detail');
  assert.equal(far.count, 0);
  renderer.hiddenId = distant.id;
  renderer.update([close, distant]);
  assert.equal(renderer.lastDrawn, 1);
  assert.equal(near.count, 1);
  renderer.dispose();
});

test('voxel pilot changes only melon vines planted in the orchard clearing', async () => {
  await PhysicsWorld.load();
  const physics = new PhysicsWorld();
  physics.init();
  const scene = new THREE.Scene();
  const plants = new PlantSystem(scene, physics, 'voxel');
  const inside = plants.plant(11, 'melonVine', new THREE.Vector3(-24, 3, 22),
    new Rng(11), { variant: 0, scale: 1 });
  const outside = plants.plant(12, 'melonVine', new THREE.Vector3(3, 3, 22),
    new Rng(12), { variant: 0, scale: 1 });
  assert.match(inside.batchKey, /voxel/);
  assert.doesNotMatch(outside.batchKey, /voxel/);
  const shape = scene.children.find(child => child.name === `Plants:${inside.batchKey}`)?.geometry;
  assert.match(shape?.name ?? '', /^VoxelTree:melonVine/);
  assert.equal(inside.nodes.length, outside.nodes.length);
  plants.dispose();
  physics.world.free();
});

test('voxel pilot keeps collider-bearing approach bananas and omits only the colliderless puff bush', () => {
  assert.equal(skipVoxelPilotDecor('voxel', { type: 'puffBush', x: -14, z: 36.5 }), true);
  for (const [x, z] of [[-4, 37.5], [-19.5, 34.5]]) {
    assert.equal(skipVoxelPilotDecor('voxel', { type: 'bananaPlant', x, z }), false);
    assert.equal(skipVoxelPilotDecor('baseline', { type: 'bananaPlant', x, z }), false);
  }
  assert.equal(skipVoxelPilotDecor('voxel', { type: 'puffBush', x: -14, z: 36.5, fruit: true }), false);
  assert.equal(skipVoxelPilotDecor('voxel', { type: 'palm', x: 1, z: 38 }), false);
  assert.equal(skipVoxelPilotDecor('voxel', { type: 'palm', x: -4, z: 37.5 }), false);
});

test('hidden colliderless puff consumes the usual RNG while voxel banana retains its trunk collider', async () => {
  await PhysicsWorld.load();
  const physics = new PhysicsWorld();
  physics.init();
  const hiddenScene = new THREE.Scene(), visibleScene = new THREE.Scene();
  const hiddenPlants = new PlantSystem(hiddenScene, physics, 'voxel');
  const visiblePlants = new PlantSystem(visibleScene, physics, 'voxel');
  const hiddenRng = new Rng(24), visibleRng = new Rng(24);
  const position = new THREE.Vector3(-14, 3, 36.5);
  const hidden = hiddenPlants.plant(21, 'puffBush', position, hiddenRng,
    { scale: 1.2, hiddenCosmetic: true });
  const visible = visiblePlants.plant(22, 'puffBush', position, visibleRng,
    { scale: 1.2 });
  assert.equal(hiddenScene.children.length, 0);
  assert.equal(hidden.body, null);
  assert.equal(hidden.nodes.length, visible.nodes.length);
  assert.equal(hiddenRng.next(), visibleRng.next());
  const banana = hiddenPlants.plant(23, 'bananaPlant', new THREE.Vector3(-4, 3, 37.5),
    new Rng(23), { scale: 1.2 });
  assert.match(banana.batchKey, /voxel/);
  assert.ok(banana.body, 'banana visual must retain the original trunk collider');
  assert.equal(banana.colliders.length, 1);
  hiddenPlants.dispose();
  visiblePlants.dispose();
  physics.world.free();
});
