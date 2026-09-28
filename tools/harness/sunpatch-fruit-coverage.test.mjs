import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(() => vite.close());
const THREE = await vite.ssrLoadModule('three');
const { FRUIT } = await vite.ssrLoadModule('/src/fruit/FruitDefs.ts');
const { voxelFruitGeometry } = await vite.ssrLoadModule('/src/art/voxel/VoxelFruit.ts');
const { FruitRenderer } = await vite.ssrLoadModule('/src/fruit/FruitRenderer.ts');

test('every harvestable Sunpatch species has connected near and far voxel geometry', () => {
  for (const species of Object.keys(FRUIT)) for (const detail of [8, 12, 20]) {
    const geometry = voxelFruitGeometry(species, detail);
    assert.equal(geometry.userData.voxelConnectedComponents, 1, `${species}:${detail} disconnected`);
    const p = geometry.getAttribute('position');
    assert.ok(p.count > 0 && p.count / 3 < 12000, `${species}:${detail} triangle budget`);
    assert.ok(Array.from(p.array).every(Number.isFinite));
    assert.equal(p.count, geometry.getAttribute('color').count);
    geometry.computeBoundingBox();
    assert.ok(geometry.boundingBox.min.y >= -0.65 && geometry.boundingBox.max.y <= 0.7);
    assert.ok(geometry.boundingBox.max.x <= 0.6 && geometry.boundingBox.min.x >= -0.6);
  }
});

test('world batches use voxel geometry for every species while preserving instance transforms', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.7, 0);
  const renderer = new FruitRenderer(scene, 'voxel', camera);
  const fruit = Object.keys(FRUIT).map((species, i) => ({
    id: i, species, visible: true, renderScale: 1,
    position: new THREE.Vector3(i, 1, -3), quaternion: new THREE.Quaternion(),
    tint: new THREE.Color(1, 1, 1), emissive: 0,
  }));
  renderer.update(fruit);
  for (const f of fruit) {
    const mesh = scene.getObjectByName(`Fruit:${f.species}`);
    assert.ok(mesh?.geometry.name.startsWith(`VoxelFruit:${f.species}`), f.species);
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0, matrix);
    assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(matrix).toArray(), f.position.toArray());
  }
  camera.position.z = 200;
  renderer.update(fruit);
  for (const f of fruit) assert.equal(scene.getObjectByName(`Fruit:${f.species}:far`)?.count, 1);
  renderer.dispose();
});
