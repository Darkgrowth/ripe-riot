import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';
const { OrchardTerrain } = await importBundled('src/world/OrchardClearing.ts', 'orchard-terrain');
const { inOrchardSafeZone, ORCHARD_RUN } = await importBundled('src/world/OrchardLayout.ts', 'orchard-layout');
const { IslandDirector } = await importBundled('src/systems/IslandDirector.ts', 'orchard-director');
const { DockRecovery } = await importBundled('src/player/DockRecovery.ts', 'orchard-recovery');

test('safe apron excludes the loaded tree and both threats, and rejects invalid positions', () => {
  assert.equal(inOrchardSafeZone(...ORCHARD_RUN.spawn), true);
  for (const key of ['loadedTree', 'mimic', 'snapjaw', 'boulderBank'])
    assert.equal(inOrchardSafeZone(...ORCHARD_RUN[key]), false, key);
  assert.equal(inOrchardSafeZone(NaN, 27), false);
  assert.equal(inOrchardSafeZone(Infinity, 27), false);
});

test('crate and harvest pockets share walkable ground; the plum bank slopes toward the grove', () => {
  const terrain = new OrchardTerrain();
  for (const [x, z] of [ORCHARD_RUN.spawn, ORCHARD_RUN.crate, ORCHARD_RUN.loadedTree,
    ORCHARD_RUN.mimic, ORCHARD_RUN.snapjaw]) {
    assert.ok(terrain.height(x, z) > 7);
    assert.ok(terrain.normal(x, z).y > .9);
  }
  assert.ok(terrain.height(-35, 25) - terrain.height(-29, 25) > 1.7);
  for (let x = -7; x >= -29; x -= 1) assert.ok(terrain.normal(x, 27).y > .72);
  assert.ok(terrain.height(60, 60) < 0, 'no far-away Sunpatch expedition terrain');
});

function directorFixture() {
  const awake = [], events = [], director = new IslandDirector();
  director.world = { orchardRun: true };
  director.fruit = { authoritative: true };
  director.g = { has: () => false, bus: { emit: (name, data) => events.push({ name, data }) },
    get: () => ({ setHarvestAwake: v => awake.push(v) }) };
  return { director, awake, events, at: new THREE.Vector3(-23, 7.5, 27),
    step(seconds) { for (let i = 0; i < Math.ceil(seconds * 60); i++) director.fixedStep(1 / 60); } };
}

test('accepted violent harvest warns before waking, duplicates do not extend a burst, then the orchard rests', () => {
  const f = directorFixture();
  assert.equal(f.director.acceptAgitation('shake:1', 'tree-shaker', f.at), true);
  assert.equal(f.director.acceptAgitation('shake:1', 'tree-shaker', f.at), false);
  f.step(2); assert.deepEqual(f.awake, []);
  f.step(.3); assert.deepEqual(f.awake, [true]);
  f.step(28); assert.deepEqual(f.awake, [true, false]);
  assert.equal(f.director.netState().agitation.pressure, 0);
  assert.equal(f.director.start('order', true), false, 'no unrelated timed money orders');
});

test('crate disturbance and guest requests cannot wake the grove', () => {
  const f = directorFixture();
  assert.equal(f.director.acceptAgitation('safe', 'tree-shaker', new THREE.Vector3(-7, 8, 27)), false);
  f.director.fruit.authoritative = false;
  assert.equal(f.director.acceptAgitation('guest', 'tree-shaker', f.at), false);
  f.step(35); assert.deepEqual(f.awake, []);
});

test('prototype recovery heals at the crate but never at the dangerous harvest pockets', () => {
  const terrain = new OrchardTerrain();
  const pad = new THREE.Vector3(-7, terrain.height(-7, 27), 27);
  const vitals = { health: 30, maxHealth: 100, downed: false, wiped: false,
    heal(n) { this.health = Math.min(100, this.health + n); } };
  const p = { state: 'active', position: new THREE.Vector3(-15, terrain.height(-15, 32), 32), velocity: new THREE.Vector3() };
  const world = { orchardRun: true, safeRadius: 6, sellPad: pad, spawnPoint: pad, shopCounter: pad };
  const g = { player: p, get: key => key === 'vitals' ? vitals : world, bus: { emit() {} } };
  const system = new DockRecovery(); system.init(g);
  for (let i = 0; i < 300; i++) system.fixedStep(1 / 60);
  assert.equal(vitals.health, 30);
  p.position.copy(pad);
  for (let i = 0; i < 300; i++) system.fixedStep(1 / 60);
  assert.equal(vitals.health, 100);
});
