import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(async () => vite.close());
const THREE = await vite.ssrLoadModule('three');
const { PropBuilder } = await vite.ssrLoadModule('/src/world/PropBuilder.ts');
const { voxelRockGeometry } = await vite.ssrLoadModule('/src/art/voxel/VoxelRock.ts');

test('scenery boulder keeps a connected stepped outline on a coarse grid', () => {
  for (let variant = 0; variant < 3; variant++) {
    const geo = voxelRockGeometry(1.25, variant);
    const box = geo.boundingBox;
    assert.equal(geo.userData.voxelConnectedComponents, 1);
    assert.ok(geo.getAttribute('position').count / 3 < 400,
      'scattered rocks should not carry hero-asset detail');
    assert.ok(box.min.x >= -1.25 && box.max.x <= 1.25);
    assert.ok(box.min.z >= -1.25 && box.max.z <= 1.25);
    geo.dispose();
  }
});

test('scenery boulder can change its silhouette without changing the original ball collider', () => {
  const visual = new THREE.BoxGeometry(1.8, 1.8, 1.8);
  const colliders = [];
  const physics = {
    createFixed(position) { return { position: position.clone() }; },
    attach(body, desc) { colliders.push({ body, desc }); },
  };
  const builder = new PropBuilder(physics);
  builder.translate(4, 3, -2);
  builder.sphere(1.25, 0, new THREE.Color(0x998877), true, [0, 0, 0], visual);
  const mesh = builder.finish();
  assert.equal(mesh.getAttribute('position').count, 36);
  assert.equal(colliders.length, 1);
  assert.equal(colliders[0].desc.shape.radius, 1.25);
  assert.deepEqual(colliders[0].body.position.toArray(), [4, 3, -2]);
  mesh.dispose();
});
