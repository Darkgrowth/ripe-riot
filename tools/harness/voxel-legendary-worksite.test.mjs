import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Bundle only the exported presentation helpers so these checks never start a
// Game, browser, physics world, or preview server.
const compiled = await build({
  stdin: {
    contents: `export { buildVoxelHoldingVineGeometry, isLegendaryHoldingVine,
  RopeSystem } from './src/systems/RopeSystem.ts';
export { buildVoxelExtractionBorderGeometry, LegendaryHarvest } from './src/systems/LegendaryHarvest.ts';`,
    resolveDir: process.cwd(), sourcefile: 'voxel-legendary-worksite-entry.ts',
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
  tsconfig: 'tsconfig.json', logLevel: 'silent',
});
const { buildVoxelHoldingVineGeometry, buildVoxelExtractionBorderGeometry,
  isLegendaryHoldingVine, RopeSystem, LegendaryHarvest } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const THREE = await import('three');

test('voxel holding vine uses its real tube radius and has hard, readable bands', () => {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, 10, 0),
  ]);
  const radius = 0.32;
  const geometry = buildVoxelHoldingVineGeometry(curve, radius,
    new THREE.Color().setHex(0x4e8a2e, THREE.SRGBColorSpace));
  const positions = geometry.getAttribute('position');
  const colors = geometry.getAttribute('color');
  assert.equal(colors.count, positions.count);
  assert.equal(positions.count, 24 * 4 * 6, 'twenty-four square-section vine lengths');
  const box = geometry.boundingBox;
  assert.ok(box.min.y >= -0.01 && box.max.y <= 10.01, 'vine endpoints stay on the curve');
  assert.ok(box.max.x <= radius + 0.001 && box.min.x >= -radius - 0.001);
  assert.ok(box.max.z <= radius + 0.001 && box.min.z >= -radius - 0.001);
  let low = Infinity, high = 0;
  for (let i = 0; i < colors.count; i++) {
    low = Math.min(low, colors.getY(i));
    high = Math.max(high, colors.getY(i));
  }
  assert.ok(high > low * 1.8, 'neighboring lengths have contrasting flat color bands');
  geometry.dispose();
});

test('only world-to-legendary holding vines get the voxel art and cuts remove their mesh', () => {
  const end = kind => ({ kind, local: new THREE.Vector3(), ownerId: -1 });
  const vine = { id: 7, a: end('world'), b: end('legendary'), cuttable: true,
    shared: false, net: undefined };
  assert.equal(isLegendaryHoldingVine(vine), true);
  assert.equal(isLegendaryHoldingVine({ ...vine, b: end('fruit') }), false);
  assert.equal(isLegendaryHoldingVine({ ...vine, cuttable: false }), false);
  assert.equal(isLegendaryHoldingVine({ ...vine, shared: true }), false);
  const system = new RopeSystem('voxel');
  const banded = new THREE.MeshStandardMaterial({ vertexColors: true });
  const selected = new THREE.MeshStandardMaterial({ color: 0xffd15c });
  system.vineMaterial = banded;
  system.selectedMaterial = selected;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
    banded);
  system.group.add(mesh);
  system.meshes.set(vine.id, mesh);
  system.ropes.set(vine.id, vine);
  system.highlight(vine.id);
  assert.equal(mesh.material, selected, 'crosshair target uses the gold highlight');
  system.highlight(null);
  assert.equal(mesh.material, banded, 'deselection restores the voxel bands');
  system.remove(vine.id, 'cut');
  assert.equal(system.ropes.has(vine.id), false);
  assert.equal(system.meshes.has(vine.id), false);
  assert.equal(system.group.children.includes(mesh), false, 'no cut vine ghost remains');
  banded.dispose();
  selected.dispose();
});

test('extraction border geometry has gaps and stays inside the original pad', () => {
  const radius = 15;
  const geometry = buildVoxelExtractionBorderGeometry(radius);
  const positions = geometry.getAttribute('position');
  const colors = geometry.getAttribute('color');
  assert.equal(positions.count, 24 * 12, 'twenty-four separate top-and-side border pieces');
  assert.equal(colors.count, positions.count);
  let minR = Infinity, maxR = 0;
  for (let i = 0; i < positions.count; i++) {
    const r = Math.hypot(positions.getX(i), positions.getZ(i));
    minR = Math.min(minR, r);
    maxR = Math.max(maxR, r);
  }
  assert.ok(minR > radius - 1.1 && maxR < radius, 'border fits inside pad radius');
  assert.ok(geometry.boundingBox.min.y >= -0.001
    && geometry.boundingBox.max.y <= 0.15, 'border is only a visual raised rim');
  geometry.dispose();
});

test('border follows pad phase visibility and its resources are released on disposal', () => {
  const scene = new THREE.Scene();
  const legendary = new LegendaryHarvest('voxel');
  legendary.g = { renderer: { scene } };
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 0.35, 28),
    new THREE.MeshStandardMaterial({ opacity: 0.42, transparent: true }));
  const border = new THREE.Mesh(buildVoxelExtractionBorderGeometry(15),
    new THREE.MeshStandardMaterial({ vertexColors: true }));
  scene.add(pad, border);
  legendary.padMesh = pad;
  legendary.padBorder = border;
  for (const phase of ['prepare', 'drop', 'recover', 'complete']) {
    legendary.phase = phase;
    legendary.updatePadVisuals();
    assert.equal(border.visible, pad.visible, `${phase} border follows pad`);
    assert.equal(border.visible, phase !== 'prepare', `${phase} visibility`);
  }
  let disposedGeometry = false, disposedMaterial = false;
  border.geometry.addEventListener('dispose', () => { disposedGeometry = true; });
  border.material.addEventListener('dispose', () => { disposedMaterial = true; });
  legendary.dispose();
  assert.equal(scene.children.includes(border), false);
  assert.equal(disposedGeometry, true);
  assert.equal(disposedMaterial, true);
});
