import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

globalThis.document = { createElement: () => ({ getContext: () => {
  const context = { font: '12px sans-serif', measureText(text) {
    const size = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 12);
    return { width: Array.from(text).length * size * 0.58 };
  } };
  return new Proxy(context, { get: (target, key) => key in target ? target[key] : () => {} });
} }) };

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(async () => vite.close());
const { Terrain } = await vite.ssrLoadModule('/src/world/Terrain.ts');
const { buildLandmarks, voxelRowboatHullGeometry } = await vite.ssrLoadModule('/src/world/Landmarks.ts');

test('voxel ferry hull is one hollow, seat-sized silhouette', () => {
  const hull = voxelRowboatHullGeometry();
  assert.equal(hull.userData.voxelConnectedComponents, 1);
  assert.ok(hull.userData.voxelCount > 250, 'hull must have a continuous floor and sides');
  assert.ok(hull.getAttribute('position').count / 3 < 5000,
    'small ferry should not use hero-level micro geometry');
  assert.ok(hull.boundingBox.min.x >= -1.4 && hull.boundingBox.max.x <= 1.4);
  assert.ok(hull.boundingBox.min.z >= -2.7 && hull.boundingBox.max.z <= 2.7);
  assert.ok(hull.boundingBox.max.y <= 1.25);
  hull.dispose();
});

function build(mode) {
  const colliders = [];
  const physics = {
    createFixed(position, rotation) { return { position: position.toArray(), rotation: rotation.toArray() }; },
    attach(body, desc) {
      const shape = desc.shape;
      colliders.push({ at: body.position, rotation: body.rotation,
        halfExtents: shape.halfExtents
          ? [shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z] : null,
        radius: shape.radius ?? null, halfHeight: shape.halfHeight ?? null });
      return {};
    },
    createTrimesh() {}, register() {},
  };
  const scene = new THREE.Scene();
  const built = buildLandmarks(scene, physics, new Terrain(), mode);
  return { built, scene, colliders };
}

test('voxel route carpentry keeps playable landmark and collider positions', () => {
  const baseline = build('baseline'), voxel = build('voxel');
  assert.deepEqual(voxel.colliders, baseline.colliders,
    'visual bevels and cloth may not move the player or prop collision');
  for (const field of ['sellPad', 'shopCounter', 'kingMelonPos'])
    assert.deepEqual(voxel.built[field].toArray(), baseline.built[field].toArray(), field);
  assert.equal(voxel.built.dock.deckTop, baseline.built.dock.deckTop);
  assert.deepEqual(voxel.built.kingMelonAnchors.map(p => p.toArray()),
    baseline.built.kingMelonAnchors.map(p => p.toArray()));
  const props = voxel.built.mesh.geometry.userData.authoredProps;
  assert.equal(props.find(p => p.id === 'merv-shop')?.details.style, 'framed-facade');
  for (const id of ['merv-shop', 'shop-apron-crate', 'hill-farm-workstation',
    'orchard-ladder--13.5-30'])
    assert.ok(props.some(p => p.id === id), `${id} stays authored on the route`);
  assert.ok(voxel.built.signs.every(sign => sign.userData.signAudit?.layout),
    'route and progression signs keep readable texture metadata');
  assert.equal(voxel.built.boatFlag.userData.visualStyle, 'stepped-pennant');
  assert.equal(voxel.built.boatFlag.visible, false,
    'unlock flag must stay hidden until game progression enables it');
  assert.ok(props.filter(p => p.details.kind === 'ladder')
    .every(p => p.details.style === 'softened-timber'));
  baseline.built.mesh.geometry.dispose(); voxel.built.mesh.geometry.dispose();
});
