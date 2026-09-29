import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';
const { FruitSystem } = await importBundled('src/fruit/FruitSystem.ts', 'site-fruit');
const setup = () => {
  const sys = new FruitSystem();
  const nodes = [{ fruitId: 2, grip: .1 }, { fruitId: 3, grip: .1 }];
  const plant = { id: 1, nodes, position: new THREE.Vector3(), height: 1 };
  sys.plants = { get: () => plant, shakePlant: () => 1 };
  sys.g = { clock: { elapsed: 1 }, bus: { emit() {} } };
  for (let i = 0; i < 2; i++) {
    const f = { id: i + 2, state: 'attached', species: 'apple', def: { attachStrength: 1 },
      attach: { plantId: 1, nodeIndex: i }, detach() { this.state = 'free'; this.attach = null; } };
    sys.fruits.set(f.id, f);
  }
  return sys;
};
test('denied site disturbance leaves every physical stem attached', () => {
  const sys = setup(); sys.beforeHarvest = () => false;
  sys.detachAuthoritative(sys.get(2), 'hand');
  assert.equal(sys.get(2).state, 'attached');
  assert.equal(sys.shakeAuthoritative(1, 2), 0);
  assert.equal(sys.get(3).state, 'attached');
});
test('a multi-fruit shake checks the authored gate once and still releases approved fruit', () => {
  const sys = setup(); let calls = 0; sys.beforeHarvest = () => { calls++; return true; };
  assert.equal(sys.shakeAuthoritative(1, 2), 2);
  assert.equal(calls, 1);
});

test('restoring an existing loose prize replaces its body without leaving an orphan collider', () => {
  const sys = setup(); let removed = 0;
  const f = sys.get(2);
  Object.assign(f, { state: 'free', attach: null, body: { old: true }, colliders: [],
    position: new THREE.Vector3(), refreshTint() {},
    release() { assert.equal(this.body, null); this.body = { setTranslation() {} }; this.state = 'free'; } });
  sys.harvestSites.push({ id: 'orchard-mimic', kind: 'mimic', plantId: 1, fruitIds: [2], position: [0, 0, 0] });
  sys.g.physics = { removeBody() { removed++; } };
  sys.restoreHarvestPrize(2, { position: [1, 2, 3], damage: .2 });
  assert.equal(removed, 1);
  assert.deepEqual(f.position.toArray(), [1, 2, 3]);
});
