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
const { voxelFruitGeometry } = await vite.ssrLoadModule('/src/art/voxel/VoxelFruit.ts');
const { skipVoxelPilotDecor } = await vite.ssrLoadModule('/src/fruit/FruitSystem.ts');

test('voxel pilot uses the same fruit-tree kit in orchard, hill farm and cave orchard', async () => {
  await PhysicsWorld.load();
  const physics = new PhysicsWorld();
  physics.init();
  const scene = new THREE.Scene();
  const plants = new PlantSystem(scene, physics, 'voxel');
  const inside = plants.plant(1, 'appleTree', new THREE.Vector3(-24, 3, 22),
    new Rng(1), { variant: 0, scale: 1 });
  const hill = plants.plant(2, 'appleTree', new THREE.Vector3(-15, 9, -35),
    new Rng(2), { variant: 0, scale: 1 });
  const cave = plants.plant(3, 'orangeTree', new THREE.Vector3(62, 3, -8),
    new Rng(3), { variant: 1, scale: 1 });
  assert.equal(inside.batchKey, hill.batchKey, 'same species and variant reuse one instanced batch');
  assert.match(inside.batchKey, /voxel/);
  assert.match(cave.batchKey, /voxel/);
  const voxelBatch = scene.children.find(child => child.name === `Plants:${inside.batchKey}`);
  const caveBatch = scene.children.find(child => child.name === `Plants:${cave.batchKey}`);
  assert.match(voxelBatch?.geometry.name ?? '', /^VoxelTree:appleTree/);
  assert.match(caveBatch?.geometry.name ?? '', /^VoxelTree:orangeTree/);
  assert.equal(inside.nodes.length, hill.nodes.length);
  assert.equal(inside.colliders.length, hill.colliders.length);
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

test('hill and cave fruit trees retain seeded gameplay nodes and RNG across art modes', async () => {
  await PhysicsWorld.load();
  const physics = new PhysicsWorld();
  physics.init();
  const voxel = new PlantSystem(new THREE.Scene(), physics, 'voxel');
  const baseline = new PlantSystem(new THREE.Scene(), physics, 'baseline');
  for (const [id, type, x, z] of [
    [51, 'appleTree', -15, -35],
    [52, 'orangeTree', 62, -8],
  ]) {
    const visualRng = new Rng(id), gameplayRng = new Rng(id);
    const position = new THREE.Vector3(x, 4, z);
    const next = voxel.plant(id, type, position, visualRng);
    const old = baseline.plant(id, type, position, gameplayRng);
    assert.equal(next.variant, old.variant);
    assert.equal(next.scale, old.scale);
    assert.equal(next.rotationY, old.rotationY);
    assert.deepEqual(next.nodes.map(node => node.local.toArray()),
      old.nodes.map(node => node.local.toArray()));
    assert.equal(next.colliders.length, old.colliders.length);
    assert.equal(visualRng.next(), gameplayRng.next());
  }
  voxel.dispose();
  baseline.dispose();
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
  for (const species of ['apple', 'orange', 'watermelon', 'coconut']) {
    const batch = scene.children.find(child => child.name === `Fruit:${species}`);
    assert.match(batch?.geometry.name ?? '', new RegExp(`^VoxelFruit:${species}$`));
    assert.equal(batch.count, 1);
    if (species === 'coconut') assert.ok(batch.geometry.getAttribute('position').count / 3 < 1400,
      'small fruit must not multiply the route triangle count');
  }
  renderer.dispose();
});

test('small voxel coconuts use a connected, restrained near mesh', () => {
  const geometry = voxelFruitGeometry('coconut', 12);
  assert.equal(geometry.userData.voxelConnectedComponents, 1);
  assert.ok(geometry.getAttribute('position').count / 3 < 1400,
    'many coconuts can be visible together along the route');
});

test('distant coconuts leave the near batch while aimed coconuts regain detail', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const renderer = new FruitRenderer(scene, 'voxel', camera);
  const coconut = { id: 81, species: 'coconut', visible: true, renderScale: 0.25,
    position: new THREE.Vector3(0, 0, 30), quaternion: new THREE.Quaternion(),
    tint: new THREE.Color(0xffffff), emissive: false };
  renderer.update([coconut]);
  const far = scene.children.find(child => child.name === 'Fruit:coconut:far');
  assert.equal(far?.count, 1);
  renderer.highlightId = coconut.id;
  renderer.update([coconut]);
  const near = scene.children.find(child => child.name === 'Fruit:coconut');
  assert.equal(near.count, 1);
  assert.equal(far.count, 0);
  assert.ok(far.geometry.getAttribute('position').count
    < near.geometry.getAttribute('position').count);
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

test('first-island route converts melon vines in Old Orchard and Hill Farm', async () => {
  await PhysicsWorld.load();
  const physics = new PhysicsWorld();
  physics.init();
  const scene = new THREE.Scene();
  const plants = new PlantSystem(scene, physics, 'voxel');
  const inside = plants.plant(11, 'melonVine', new THREE.Vector3(-24, 3, 22),
    new Rng(11), { variant: 0, scale: 1 });
  const hill = plants.plant(12, 'melonVine', new THREE.Vector3(-36, 21, -30),
    new Rng(12), { variant: 0, scale: 1 });
  const outside = plants.plant(13, 'melonVine', new THREE.Vector3(80, 3, -60),
    new Rng(13), { variant: 0, scale: 1 });
  assert.match(inside.batchKey, /voxel/);
  assert.match(hill.batchKey, /voxel/);
  assert.match(outside.batchKey, /voxel/);
  const shape = scene.children.find(child => child.name === `Plants:${inside.batchKey}`)?.geometry;
  assert.match(shape?.name ?? '', /^VoxelTree:melonVine/);
  assert.equal(inside.nodes.length, outside.nodes.length);
  assert.deepEqual(hill.nodes.map(node => node.local.toArray()),
    outside.nodes.map(node => node.local.toArray()));
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
  const shopPuff = visiblePlants.plant(25, 'puffBush', new THREE.Vector3(21.5, 3, 48),
    new Rng(25), { variant: 0, scale: 1.1 });
  const hillPuff = visiblePlants.plant(26, 'puffBush', new THREE.Vector3(-36, 21, -30),
    new Rng(26), { variant: 0, scale: 1.1 });
  const remotePuff = visiblePlants.plant(27, 'puffBush', new THREE.Vector3(80, 3, -60),
    new Rng(27), { variant: 0, scale: 1.1 });
  assert.match(shopPuff.batchKey, /voxel/, 'visible route bush should share the voxel canopy language');
  assert.match(hillPuff.batchKey, /voxel/, 'Hill Farm bushes should share that canopy language');
  assert.match(remotePuff.batchKey, /voxel/, 'back-country bushes share the complete Sunpatch kit');
  assert.deepEqual(shopPuff.nodes.map(node => node.local.toArray()),
    remotePuff.nodes.map(node => node.local.toArray()));
  const banana = hiddenPlants.plant(23, 'bananaPlant', new THREE.Vector3(-4, 3, 37.5),
    new Rng(23), { scale: 1.2 });
  assert.match(banana.batchKey, /voxel/);
  assert.ok(banana.body, 'banana visual must retain the original trunk collider');
  assert.equal(banana.colliders.length, 1);
  const shopBanana = hiddenPlants.plant(24, 'bananaPlant', new THREE.Vector3(43.5, 3, 60.5),
    new Rng(24), { scale: 1.15 });
  assert.match(shopBanana.batchKey, /voxel/,
    'the shop approach should not retain flat banana blades among voxel palms');
  assert.ok(shopBanana.body);
  hiddenPlants.dispose();
  visiblePlants.dispose();
  physics.world.free();
});
