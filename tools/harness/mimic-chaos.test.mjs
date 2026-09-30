import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { EncounterModel } from '../../src/enemies/EncounterModel.ts';
import { HarvestSites } from '../../src/enemies/HarvestSites.ts';
import { importBundled } from './import-bundled.mjs';

const [{ PhysicsWorld }, { Groups }, { EncounterSystem }] = await Promise.all([
  importBundled('src/physics/PhysicsWorld.ts', 'mimic-chaos-physics'),
  importBundled('src/physics/Layers.ts', 'mimic-chaos-layers'),
  importBundled('src/enemies/EncounterSystem.ts', 'mimic-chaos-system'),
]);
const { FruitSystem } = await importBundled('src/fruit/FruitSystem.ts', 'mimic-chaos-fruit');
const { EncounterVisual } = await importBundled('src/enemies/EncounterVisuals.ts', 'mimic-chaos-visual');
await PhysicsWorld.load();

test('the committed Mimic lane and ring are readable before the launch', () => {
  const scene = new THREE.Scene();
  const visual = new EncounterVisual('mimic', scene, 'voxel');
  try {
    visual.update({ kind: 'mimic', position: [0, 0, 0], heading: 0,
      phase: 'warn', timeLeft: .5, health: 3, baited: false,
      capturedVictimId: null, captureTimeLeft: 0, dormant: false, returning: false }, 0, 1 / 60);
    assert.ok(visual.danger.material.opacity >= .25,
      'the orange warning ring remains visible from the gameplay camera');
    assert.ok(visual.lane.material.opacity >= .16,
      'the charge direction reads through orchard foliage');
  } finally { visual.dispose(); }
});

test('authored orchard Puff Melons append after existing prize IDs and share its save ledger', () => {
  const system = new FruitSystem();
  let nextId = 1000;
  const planted = [];
  const node = () => ({ local: new THREE.Vector3(), world: new THREE.Vector3(),
    quat: new THREE.Quaternion(), fruitId: -1, grip: 1 });
  system.g = { newId: () => nextId++ };
  system.world = { terrain: { height: () => 2 } };
  system.plants = { plant(id, type, position) {
    const plant = { id, type, position, nodes: Array.from({ length: type === 'puffBush' ? 3 : 1 }, node) };
    planted.push(plant);
    return plant;
  }, updateNodes() {} };
  system.growFruitAt = (plant, index, species, given) => {
    plant.nodes[index].fruitId = given.id;
    system.fruits.set(given.id, { id: given.id, species, state: 'attached',
      attach: { plantId: plant.id, nodeIndex: index } });
  };
  const hillNest = { id: 500, type: 'boulderBush', position: new THREE.Vector3(-35, 2, -11),
    nodes: [{ fruitId: 501 }] };
  system.populateHarvestSites(hillNest);
  const orchard = system.harvestSites.find(site => site.id === 'orchard-mimic');
  assert.deepEqual(orchard.fruitIds.slice(0, 3), [1001, 1002, 1003],
    'the authored watermelon IDs remain fixed');
  assert.deepEqual(system.harvestSites.find(site => site.id === 'snapjaw-cache').fruitIds,
    [1005, 1006], 'the existing cache IDs remain fixed');
  const puff = planted.find(plant => plant.type === 'puffBush' && plant.id > 1006);
  assert.ok(puff, 'an extra harvestable orchard Puff bush exists');
  assert.ok(system.oneTimePlants.has(puff.id), 'its fruit cannot regrow after sale');
  assert.deepEqual(orchard.fruitIds.filter(id => system.fruits.get(id)?.species === 'puffmelon'),
    [1008, 1009], 'both real Puff fruits are tracked in the existing site ledger');
});

test('host-accepted site warning and activation each count once toward local agitation', () => {
  const site = { id: 'orchard-mimic', kind: 'mimic', plantId: 20,
    fruitIds: [21, 22, 23], position: [-23, 2, 25] };
  const accepted = [];
  const fruit = { plants: { shakePlant() {} } };
  const director = { acceptAgitation(id, kind, at) {
    accepted.push({ id, kind, at: at.toArray() }); return true;
  } };
  const system = Object.create(EncounterSystem.prototype);
  system.sites = new HarvestSites([site]);
  system.model = new EncounterModel([{ kind: 'mimic', position: [-23, 2, 22], dormant: true }]);
  system.g = { clock: { elapsed: 1 }, bus: { emit() {} }, has: name => name === 'director',
    get: name => name === 'fruit' ? fruit : director };
  assert.equal(system.guardHarvest(99, 'hand'), true, 'ordinary fruit is calm');
  assert.equal(system.guardHarvest(20, 'hand'), false);
  assert.equal(system.guardHarvest(20, 'hand'), false, 'held repeat is not another action');
  system.g.clock.elapsed = 1.8;
  assert.equal(system.guardHarvest(20, 'hand'), true);
  assert.equal(system.guardHarvest(20, 'hand'), true, 'active crop cannot count again');
  assert.equal(accepted.length, 2);
  assert.deepEqual(accepted.map(a => a.kind), ['site-disturbance', 'site-disturbance']);
  assert.deepEqual(accepted.map(a => a.at), [[-23, 2, 25], [-23, 2, 25]]);
  assert.equal(new Set(accepted.map(a => a.id)).size, 2, 'each accepted action has its own dedupe ID');
});

function armedModel(blocked = null, target = [0, 0, 10]) {
  const model = new EncounterModel([{ kind: 'mimic', position: [0, 0, 0], leashRadius: 13 }],
    () => 0, 0, blocked);
  model.setTargets([{ id: 'picker', position: target }]);
  model.step(1 / 60);
  assert.equal(model.get('mimic').phase, 'warn');
  model.step(.8);
  assert.equal(model.get('mimic').phase, 'attack');
  return model;
}

test('a Mimic charge emits one numbered swept impact only when it ends', () => {
  const model = armedModel(null, [0, 0, 12.8]);
  assert.equal(model.step(.25).filter(e => e.type === 'mimic-impact').length, 0);
  const events = model.step(.8);
  const impacts = events.filter(e => e.type === 'mimic-impact');
  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].id, 1);
  assert.deepEqual(impacts[0].from, [0, 0, 0]);
  assert.ok(impacts[0].to[2] > 10 && impacts[0].to[2] < 11);
  assert.equal(impacts[0].treePlantId, null);
  assert.equal(model.get('mimic').phase, 'recover');
  assert.equal(model.step(.1).filter(e => e.type === 'mimic-impact').length, 0);
});

test('a launched victim gets a full counterattack window before another Mimic hit', () => {
  const model = armedModel(null, [0, 0, 5]);
  const first = model.step(.4).filter(e => e.type === 'damage');
  assert.deepEqual(first.map(e => e.amount), [28], 'the committed charge keeps its existing damage');
  const promoted = new EncounterModel([{ kind: 'mimic', position: [0, 0, 0] }]);
  assert.equal(promoted.applySnapshot(model.snapshot()), true);
  promoted.setTargets([{ id: 'picker', position: [0, 0, 5] }]);
  const afterPromotion = [];
  for (let i = 0; i < 40; i++) afterPromotion.push(...promoted.step(.1));
  assert.equal(afterPromotion.filter(e => e.type === 'damage').length, 0,
    'host promotion preserves the same victim recovery window');
  const duringRecovery = [];
  for (let i = 0; i < 40; i++) duringRecovery.push(...model.step(.1));
  assert.equal(duringRecovery.filter(e => e.type === 'damage').length, 0,
    'the launch must leave time to stand, approach, and make a timed counterstrike');
  assert.equal(model.get('mimic').phase, 'idle', 'grace does not leave an invisible active attack');
  const afterGrace = [];
  for (let i = 0; i < 60; i++) afterGrace.push(...model.step(.1));
  assert.equal(afterGrace.some(e => e.type === 'damage'), true,
    'the threat resumes after a bounded quiet window');
});

test('real tree contact creates a longer stagger and names the touched tree', () => {
  const blocked = (_from, to) => to[2] >= 1
    ? { point: [0, 0, 1], treePlantId: 71 } : null;
  const model = armedModel(blocked);
  const impacts = model.step(.1).filter(e => e.type === 'mimic-impact');
  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].treePlantId, 71);
  assert.deepEqual(impacts[0].to, [0, 0, 1]);
  assert.equal(model.get('mimic').phase, 'stagger');
  assert.ok(model.get('mimic').timeLeft > .7, 'tree gives a real fruit-shower opening');
  assert.equal(model.step(.1).filter(e => e.type === 'mimic-impact').length, 0);
});

test('rail or rock contact stops the charge without a tree shower', () => {
  const model = armedModel((_from, to) => to[2] >= 1
    ? { point: [0, 0, 1], treePlantId: null } : null);
  const impacts = model.step(.1).filter(e => e.type === 'mimic-impact');
  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].treePlantId, null);
  assert.equal(model.get('mimic').phase, 'recover');
  model.setTargets([{ id: 'picker', position: [40, 0, 0] }]);
  assert.equal(model.step(.5).filter(e => e.type === 'mimic-impact').length, 0,
    'returning home cannot make a fruit shower');
});

test('a timed mallet interruption stores one bounded redirected next heading in snapshots', () => {
  const model = armedModel(null, [0, 0, 8]);
  model.step(.2);
  const hit = model.tryHit([2, 1.2, 2], [-1, 0, 0], 'melee', 'picker');
  assert.equal(hit?.damage, 1);
  assert.equal(model.get('mimic').phase, 'stagger');
  const redirected = model.snapshot().encounters[0].pendingHeading;
  assert.ok(Number.isFinite(redirected) && redirected < -1 && redirected > -2);
  const promoted = new EncounterModel([{ kind: 'mimic', position: [0, 0, 0] }]);
  assert.equal(promoted.applySnapshot(model.snapshot()), true);
  assert.equal(promoted.snapshot().encounters[0].pendingHeading, redirected);
  model.step(3);
  model.step(3);
  assert.equal(model.get('mimic').phase, 'idle');
  model.step(1 / 60);
  assert.equal(model.get('mimic').phase, 'warn');
  assert.equal(model.get('mimic').heading, redirected);
  assert.equal(model.snapshot().encounters[0].pendingHeading, null,
    'the mallet steering is consumed after one committed warning');
});

test('nearest physical obstruction decides whether a charge hit a fruit tree', () => {
  const physics = new PhysicsWorld(); physics.init();
  const treeBody = physics.createFixed(new THREE.Vector3(0, 1, 3));
  const treeCollider = physics.attach(treeBody, RAPIER.ColliderDesc.capsule(1, .5), Groups.plant);
  physics.register({ id: 71, kind: 'plant', type: 'appleTree' }, treeBody, [treeCollider]);
  const system = Object.create(EncounterSystem.prototype);
  system.g = { physics };
  system.sites = { atPlant: () => undefined };
  try {
    physics.step();
    assert.equal(system.mimicBlocked([0, 0, 0], [0, 0, 4], .85).treePlantId, 71);
    const railBody = physics.createFixed(new THREE.Vector3(0, .8, 2));
    const railCollider = physics.attach(railBody, RAPIER.ColliderDesc.cuboid(1, .7, .15), Groups.prop);
    physics.register({ id: 99, kind: 'rail' }, railBody, [railCollider]);
    physics.step();
    const contact = system.mimicBlocked([0, 0, 0], [0, 0, 4], .85);
    assert.equal(contact.treePlantId, null, 'a nearer fence masks the tree');
    assert.ok(contact.point[2] < 2, 'the closest physical hit point is reported');
  } finally { physics.world.free(); }
});

test('orchard Puff fruit share the save ledger but not the two-action Mimic gate', () => {
  const defs = [{ id: 'orchard-mimic', kind: 'mimic', plantId: 20,
    fruitIds: [21, 22, 23, 81], position: [0, 0, 0] }];
  const sites = new HarvestSites(defs);
  assert.equal(sites.disturb(80, 1).allow, true, 'Puff plant can be harvested normally');
  assert.equal(sites.snapshot()[0].phase, 'quiet');
  sites.release(81);
  const restored = new HarvestSites(defs);
  restored.apply(sites.snapshot());
  assert.deepEqual(restored.snapshot()[0].released, [81]);
  restored.consume(81);
  const again = new HarvestSites(defs);
  again.apply(restored.snapshot());
  assert.deepEqual(again.snapshot()[0].consumed, [81]);
  assert.equal(again.snapshot()[0].phase, 'quiet');
});

test('the host charge moves attached Puff and loose fruit once without releasing the gated prize', () => {
  const fruit = new FruitSystem();
  fruit.net = { authoritative: true };
  const make = (id, state, plantId) => ({ id, state, species: id === 1 ? 'puffmelon' : 'watermelon',
    attach: state === 'attached' ? { plantId, nodeIndex: 0 } : null,
    mass: 2, position: new THREE.Vector3(0.3, 1, 2), pushes: 0,
    applyImpulse() { this.pushes++; } });
  const puff = make(1, 'attached', 80);
  const prize = make(2, 'attached', 20);
  const loose = make(3, 'free', null);
  fruit.fruits = new Map([puff, prize, loose].map(f => [f.id, f]));
  fruit.detachAuthoritative = f => { f.state = 'free'; f.attach = null; };
  const system = Object.create(EncounterSystem.prototype);
  system.impactEpoch = 'host-a';
  system.sites = { snapshot: () => [{ id: 'orchard-mimic', plantId: 20 }] };
  system.g = { get: () => fruit, bus: { emit() {} } };
  const impact = { type: 'mimic-impact', id: 1,
    from: [0, 1, 0], to: [0, 1, 3], treePlantId: null };
  system.applyMimicImpact(impact);
  assert.equal(puff.state, 'free');
  assert.equal(puff.pushes, 1);
  assert.equal(prize.state, 'attached');
  assert.equal(loose.pushes, 1);
  system.applyMimicImpact(impact);
  assert.equal(puff.pushes, 1);
  assert.equal(loose.pushes, 1);
});

test('a tree collision drops at most three ordinary fruit and never an authored watermelon', () => {
  const fruit = new FruitSystem();
  const nodes = Array.from({ length: 6 }, (_, i) => ({ fruitId: i + 1 }));
  const tree = { id: 71, type: 'appleTree', nodes };
  fruit.plants = { get: () => tree, shakePlant() {} };
  fruit.fruits = new Map(nodes.map(({ fruitId }) => [fruitId,
    { id: fruitId, state: 'attached', species: fruitId === 6 ? 'watermelon' : 'apple' }]));
  const dropped = [];
  fruit.detachAuthoritative = f => { dropped.push(f.id); f.state = 'free'; };
  const system = Object.create(EncounterSystem.prototype);
  system.g = { get: () => fruit };
  system.shakeMimicTree(71, 1);
  assert.deepEqual(dropped, [1, 2, 3]);
  assert.equal(fruit.get(6).state, 'attached');
});
