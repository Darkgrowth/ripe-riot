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
const { PropBuilder } = await vite.ssrLoadModule('/src/world/PropBuilder.ts');
const { buildIslandWorksites, voxelReelRimGeometry, voxelHarvestDrumGeometry } =
  await vite.ssrLoadModule('/src/world/IslandWorksites.ts');

test('voxel reel rim is a single coarse loop in the existing diameter', () => {
  const rim = voxelReelRimGeometry();
  assert.equal(rim.userData.voxelConnectedComponents, 1);
  assert.ok(rim.boundingBox.min.x >= -1.1 && rim.boundingBox.max.x <= 1.1);
  assert.ok(rim.boundingBox.min.y >= -1.1 && rim.boundingBox.max.y <= 1.1);
  assert.ok(rim.getAttribute('position').count / 3 < 2000);
  rim.dispose();
});

test('voxel reel drum is one solid coarse core under the original cylinder collider', () => {
  const drum = voxelHarvestDrumGeometry();
  assert.equal(drum.userData.voxelConnectedComponents, 1);
  assert.ok(drum.boundingBox.min.z >= -0.57 && drum.boundingBox.max.z <= 0.57);
  assert.ok(drum.getAttribute('position').count / 3 < 3500);
  drum.dispose();
});

function build(mode) {
  const colliders = [];
  const physics = {
    createFixed(position, rotation) { return { position: position.toArray(), rotation: rotation.toArray() }; },
    attach(body, desc) {
      const shape = desc.shape;
      colliders.push({ position: body.position, rotation: body.rotation,
        size: shape.halfExtents ? [shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z] : null });
    },
  };
  const builder = new PropBuilder(physics), signs = [];
  buildIslandWorksites(builder, { height: () => 0 }, signs, mode);
  return { geometry: builder.finish(), signs, colliders };
}

test('voxel worksite restyle preserves all three signs and the solid route footprint', () => {
  const baseline = build('baseline'), voxel = build('voxel');
  assert.ok(baseline.geometry && voxel.geometry);
  assert.deepEqual(voxel.colliders, baseline.colliders);
  assert.deepEqual(voxel.signs.map(sign => sign.userData.signAudit.layout.title),
    ['HILL FARM', 'PALM BEACH', 'THE KING MELON']);
  assert.equal(voxel.geometry.userData.authoredProps.find(p => p.id === 'hill-farm-workstation')
    ?.details.style, 'rounded-voxel-frame-and-canvas');
  assert.equal(voxel.geometry.userData.authoredProps.find(p => p.id === 'ravine-harvest-reel')
    ?.details.style, 'stepped-voxel-rims');
  const positions = voxel.geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++)
    assert.ok(Number.isFinite(positions.getX(i)) && Number.isFinite(positions.getY(i))
      && Number.isFinite(positions.getZ(i)), 'merged worksite geometry must stay finite');
  assert.ok(voxel.geometry.getAttribute('position').count / 3 < 24000,
    `worksite triangles: voxel ${voxel.geometry.getAttribute('position').count / 3}, `
      + `baseline ${baseline.geometry.getAttribute('position').count / 3}`);
  baseline.geometry.dispose(); voxel.geometry.dispose();
  for (const sign of [...baseline.signs, ...voxel.signs]) {
    sign.geometry.dispose(); sign.material.map.dispose(); sign.material.dispose();
  }
});
