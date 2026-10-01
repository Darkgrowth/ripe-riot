import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { importBundled } from './import-bundled.mjs';
await RAPIER.init();
const { FruitSystem } = await importBundled('src/fruit/FruitSystem.ts', 'orchard-population');
const { PhysicsWorld } = await importBundled('src/physics/PhysicsWorld.ts', 'orchard-population-physics');
const { OrchardTerrain } = await importBundled('src/world/OrchardClearing.ts', 'orchard-population-terrain');

test('real authored clearing has all cargo choices and reload tombstones remove nodes without regrowth', () => {
  const physics = new PhysicsWorld(); physics.init();
  const terrain = new OrchardTerrain();
  const world = { orchardRun: true, terrain,
    groundAt(x, z, offset = 0) { return new THREE.Vector3(x, terrain.height(x, z) + offset, z); } };
  let nextId = 1;
  const actions = new Map();
  const g = { physics, clock: { elapsed: 0 },
    renderer: { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera() },
    newId: () => nextId++, reserveId(id) { nextId = Math.max(nextId, id + 1); },
    get: () => world, bus: { emit() {} },
    debug: { addAction: (key, f) => actions.set(key, f), addProbe() {} } };
  const fruit = new FruitSystem('voxel'); fruit.init(g);
  const layout = actions.get('orchard.layout')();
  assert.ok(layout.totalValue >= 1500);
  assert.ok(layout.plants < 35);
  for (const species of ['apple', 'orange', 'puffmelon', 'gluefruit', 'boulderplum', 'watermelon'])
    assert.ok(layout.cargo.some(f => f.species === species), species);
  assert.ok(layout.cargo.every(f => Math.hypot(f.pos[0] + 23, f.pos[2] - 24) < 25));
  const consumed = layout.cargo.filter(f => f.species === 'apple').slice(0, 2).map(f => f.id);
  fruit.restoreRunFruitIds(consumed);
  fruit.restoreRunFruitIds(consumed);
  assert.ok(consumed.every(id => !fruit.get(id)));
  assert.equal(fruit.nodeManifest().changes.length, 2);
  assert.equal(fruit.regrow.length, 0);
  assert.ok([...fruit.plants.all()].every(p => p.nodes.every(n => !consumed.includes(n.fruitId))));
  console.log(JSON.stringify({ plants: layout.plants, value: layout.totalValue,
    cargo: layout.cargo.reduce((out, f) => { out[f.species] = (out[f.species] ?? 0) + 1; return out; }, {}) }));
  physics.world.free();
});
