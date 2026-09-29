import test from 'node:test';
import assert from 'node:assert/strict';
import { importBundled } from './import-bundled.mjs';
const { PhysicsWorld } = await importBundled('src/physics/PhysicsWorld.ts','expedition-physics');
const { EncounterSystem } = await importBundled('src/enemies/EncounterSystem.ts','expedition-cover-system');
const { EncounterModel } = await importBundled('src/enemies/EncounterModel.ts','expedition-cover-model');
await PhysicsWorld.load();
test('actual Rapier world wall blocks seed acquisition and an in-flight swept seed', () => {
  const physics = new PhysicsWorld(); physics.init();
  const system = new EncounterSystem(); system.g = { physics };
  const verts = new Float32Array([-3,0,5, 3,0,5, 3,5,5, -3,5,5]);
  const indices = new Uint32Array([0,1,2,0,2,3]);
  let wall = physics.createTrimesh(verts,indices); physics.step();
  const m = new EncounterModel([{kind:'spitter',position:[0,0,0]}],()=>0,0,null,
    (a,b)=>system.projectileBlock(a,b));
  m.setTargets([{id:'behind-wall',position:[0,0,10]}]);
  for(let i=0;i<120;i++)m.step(1/60);
  assert.equal(m.get('spitter').phase,'idle');
  physics.removeBody(wall.body,[wall.collider]); physics.step();
  for(let i=0;i<60;i++)m.step(1/60);
  assert.equal(m.snapshot().projectiles.length,1);
  wall=physics.createTrimesh(verts,indices); physics.step();
  const events=[];for(let i=0;i<90;i++)events.push(...m.step(1/60));
  assert.equal(events.some(e=>e.type==='damage'),false);
  assert.equal(m.snapshot().projectiles.length,0);
  physics.world.free();
});
