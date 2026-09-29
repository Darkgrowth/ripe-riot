import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const [{ LegendaryHarvest }, { Terrain }] = await Promise.all([
  importBundled('src/systems/LegendaryHarvest.ts', 'legendary-cut-access'),
  importBundled('src/world/Terrain.ts', 'legendary-cut-terrain'),
]);

function fixture() {
  const harvest = new LegendaryHarvest('voxel'), terrain = new Terrain();
  harvest.world = { terrain };
  harvest.vines = [0, 1, 2, 3].map(id => ({ id }));
  harvest.vineIdx = [0, 1, 2, 3];
  harvest.ropes = { endpoints(_vine, a, b) { a.set(8, 51, -62); b.set(8, 42, -62); } };
  harvest.g = { player: { body: null }, physics: { raycast: () => null } };
  harvest.body = { translation: () => ({x: 8, y: 39, z: -62}) };
  return { harvest, terrain };
}

test('all four physical holding vines have cut points reachable from actual staging terrain', () => {
  const { harvest, terrain } = fixture();
  const points = harvest.cutPoints?.() ?? [];
  assert.equal(points.length, 4, 'each high vine needs a visible ground cutting tie');
  for (const p of points) {
    const [x, y, z] = p.position;
    const eye = new THREE.Vector3(x, terrain.height(x, z + 2) + 1.6, z + 2);
    const direction = new THREE.Vector3(...p.position).sub(eye).normalize();
    assert.ok(eye.distanceTo(new THREE.Vector3(...p.position)) < 3.4);
    assert.equal(harvest.validateCutAim(p.vine, eye, direction), true,
      `vine ${p.vine} must be reachable without ladders or an Air Cannon`);
  }
});

test('root ties require close, aimed, unobstructed contact and remaining vine identity', () => {
  const { harvest, terrain } = fixture();
  const p = harvest.cutPoints?.()[0];
  assert.ok(p, 'cut point exists');
  const [x, , z] = p.position, target = new THREE.Vector3(...p.position);
  const eye = new THREE.Vector3(x, terrain.height(x, z + 2) + 1.6, z + 2);
  const dir = target.clone().sub(eye).normalize();
  assert.equal(harvest.validateCutAim(0, eye, dir.clone().negate()), false);
  const far = eye.clone().addScaledVector(dir, -4);
  assert.equal(harvest.validateCutAim(0, far, target.clone().sub(far).normalize()), false);
  harvest.g.physics.raycast = () => ({ distance: .8 });
  assert.equal(harvest.validateCutAim(0, eye, dir), false, 'solid cover blocks E cutting');
  harvest.g.physics.raycast = () => null;
  harvest.vines.shift(); harvest.vineIdx.shift();
  assert.equal(harvest.validateCutAim(0, eye, dir), false, 'cut identity cannot be replayed');
});

test('remote raw vine indices do not bypass aim, reach and authority checks', () => {
  const { harvest } = fixture();
  assert.equal(harvest.remoteCut(0, () => true), 'out-of-reach');
});
