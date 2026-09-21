// Real island geometry + Rapier, without a browser, renderer, or GPU.
// The canvas stub only skips rasterizing sign textures; their props/colliders
// and every fruit, plant, terrain and waterfall collider are built normally.
// Run: node tools/harness/vinebomb-check.mjs
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const result = await build({
  stdin: { resolveDir: root, loader: 'ts', contents: `
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PhysicsWorld } from './src/physics/PhysicsWorld';
import { QueryMask } from './src/physics/Layers';
import { Sunpatch } from './src/world/Sunpatch';
import { buildLandmarks } from './src/world/Landmarks';
import { FruitSystem } from './src/fruit/FruitSystem';
import { Fruit } from './src/fruit/Fruit';

export async function audit() {
  globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, {
    get: (target, key) => target[key] ?? (key === 'measureText' ? text => ({ width: String(text).length * 24 }) : (() => {})),
    set: (target, key, value) => (target[key] = value, true),
  }) }) };
  await PhysicsWorld.load();
  const physics = new PhysicsWorld(); physics.init();
  const world = new Sunpatch(), scene = new THREE.Scene();
  world.terrain.build(scene, physics, true);
  world.defineLandmarks();
  world.built = buildLandmarks(scene, physics, world.terrain);
  let nextId = 2;
  const game = {
    physics, renderer: { scene }, clock: { elapsed: 0 },
    player: { id: 1, position: new THREE.Vector3(-24, 9, 22) },
    newId: () => nextId++, get: () => world, bus: { emit() {} },
  };
  const fruit = new FruitSystem(); fruit.init(game);
  const step = count => {
    for (let i = 0; i < count; i++) {
      game.clock.elapsed += 1 / 60;
      fruit.fixedStep(1 / 60); physics.step();
    }
  };
  step(45);
  const sites = [...fruit.fruits.values()].filter(f => f.species === 'vinebomb');
  assert.ok(sites.length > 0, 'authored elastic nodes exist');
  const originals = sites.map(f => ({
    position: f.position.clone(), quaternion: f.quaternion.clone(),
    variant: f.variant?.id ?? null, roll: f.sizeRoll,
    direction: f.tensionDir.clone(), tension: f.tension,
  }));
  for (const f of sites) {
    const overlaps = [];
    physics.world.intersectionsWithShape(f.position, f.quaternion,
      new physics.raw.Ball(f.radius), c => {
        overlaps.push({ position: c.translation(), type: c.shape.type }); return true;
      }, undefined, QueryMask.solid);
    assert.equal(overlaps.length, 0,
      'vine at ' + f.position.toArray() + ' starts inside solid: ' + JSON.stringify(overlaps));
    assert.ok(f.tensionDir.dot(world.terrain.normal(f.position.x, f.position.z)) >= 0,
      'initial release direction must face away from the terrain');
    fruit.remove(f);
  }
  const rows = [];
  // Repeat after body-handle churn and a long clock advance. This is an
  // offline regression of the lifetime sensitivity, not a replacement for
  // running the complete browser scenario sequence.
  for (const phase of ['fresh', 'after-churn']) {
    if (phase === 'after-churn') {
      for (let i = 0; i < 128; i++) {
        const f = fruit.spawnFree('apple', new THREE.Vector3(-24, 14, 22));
        step(2); fruit.remove(f);
      }
      game.clock.elapsed += 300;
      step(45);
    }
    for (const source of originals) {
      const f = new Fruit(physics, nextId++, 'vinebomb', source.variant, source.roll);
      f.attachTo({ plantId: -1, nodeIndex: 0, position: source.position.clone(),
        quaternion: source.quaternion.clone() });
      f.syncToAttachment();
      f.tension = source.tension; f.tensionDir.copy(source.direction);
      f.detach(fruit.ctx, 'offline-regression');
      fruit.fruits.set(f.id, f);
      step(8);
      const early = f.position.distanceTo(source.position);
      step(240);
      const row = { phase, node: source.position.toArray().map(v => +v.toFixed(2)),
        early: +early.toFixed(3), travelled: +f.travelled.toFixed(3),
        peakSpeed: +f.maxSpeedSinceDetach.toFixed(3),
        outcome: f.state === 'gone' ? (f.position.y < -3.5 ? 'sank' : 'destroyed') : f.state };
      rows.push(row); console.log(JSON.stringify(row));
      assert.ok(f.maxSpeedSinceDetach > 11, 'elastic release retains its launch impulse');
      assert.ok(early > 0.5, 'elastic node is not immediately trapped by a nearby prop');
      if (source.position.x === 30 && source.position.z === -26) {
        assert.ok(f.travelled > 10, 'waterfall vine travels >10 m before any despawn');
      }
      fruit.remove(f);
    }
  }
  console.log('PASS ' + originals.length + ' clear authored nodes; ' + rows.length + ' measured flights');
  physics.world.free();
}
` },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
});
const mod = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(
  createRequire(import.meta.url), mod, mod.exports);
await mod.exports.audit();
