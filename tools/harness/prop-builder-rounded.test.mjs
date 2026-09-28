import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(async () => vite.close());
const { PropBuilder } = await vite.ssrLoadModule('/src/world/PropBuilder.ts');

test('softened structural box keeps its cuboid footprint and collider', () => {
  const colliders = [];
  const physics = {
    createFixed(position) { return { position: position.clone() }; },
    attach(body, desc) { colliders.push({ body, desc }); },
  };
  const builder = new PropBuilder(physics);
  builder.translate(4, 2, -3).roundedBox(2, 1, 0.4, 0.09,
    new THREE.Color(0x98765a), true, [0, 0.5, 0]);
  const geometry = builder.finish();
  assert.ok(geometry);
  geometry.computeBoundingBox();
  assert.ok(Math.abs(geometry.boundingBox.min.x - 3) < 0.01);
  assert.ok(Math.abs(geometry.boundingBox.max.y - 3) < 0.01);
  assert.ok(Math.abs(geometry.boundingBox.min.z + 3.2) < 0.01);
  assert.ok(geometry.getAttribute('position').count / 3 <= 120,
    'one broad bevel should stay much cheaper than tiny box tessellation');
  assert.equal(colliders.length, 1);
  assert.deepEqual(colliders[0].body.position.toArray(), [4, 2.5, -3]);
  const { x, y, z } = colliders[0].desc.shape.halfExtents;
  assert.deepEqual([x, y, z], [1, 0.5, 0.2]);
  geometry.dispose();
});

test('hidden cylinder core keeps exact physics without a coincident render cap', () => {
  const colliders = [];
  const physics = {
    createFixed(position) { return { position: position.clone() }; },
    attach(body, desc) { colliders.push({ body, desc }); },
  };
  const builder = new PropBuilder(physics);
  builder.translate(2, 0, -4).cylinderCollider(0.44, 1, [0, 0.5, 0]);
  assert.equal(builder.finish(), null, 'collider-only body must not add smooth geometry');
  assert.equal(colliders.length, 1);
  assert.deepEqual(colliders[0].body.position.toArray(), [2, 0.5, -4]);
  assert.equal(colliders[0].desc.shape.radius, 0.44);
  assert.equal(colliders[0].desc.shape.halfHeight, 0.5);
});
