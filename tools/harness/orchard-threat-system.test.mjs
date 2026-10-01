import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../../src/core/Events.ts';
import { importBundled } from './import-bundled.mjs';

const [{ PhysicsWorld }, { Fruit }, { FruitSystem }, { EncounterSystem }, { EncounterVisual }] = await Promise.all([
  importBundled('src/physics/PhysicsWorld.ts', 'orchard-contact-physics'),
  importBundled('src/fruit/Fruit.ts', 'orchard-contact-fruit'),
  importBundled('src/fruit/FruitSystem.ts', 'orchard-contact-fruits'),
  importBundled('src/enemies/EncounterSystem.ts', 'orchard-contact-system'),
  importBundled('src/enemies/EncounterVisuals.ts', 'orchard-contact-visual'),
]);
await PhysicsWorld.load();

function fixture() {
  const physics = new PhysicsWorld(); physics.init();
  const fruits = new FruitSystem();
  fruits.harvestSites = [{ id: 'orchard-mimic', kind: 'mimic', plantId: 20,
    fruitIds: [21], position: [-23, 0, 22] }];
  const world = { orchardRun: true, terrain: { height: () => 0 },
    groundAt: (x, z) => new THREE.Vector3(x, 0, z) };
  const bus = new EventBus();
  const g = { physics, clock: { elapsed: 0 }, bus,
    renderer: { scene: new THREE.Scene() },
    player: { state: 'active', body: null, position: new THREE.Vector3(30, 0, 30) },
    has: () => false, get: name => name === 'world' ? world : fruits };
  fruits.g = g;
  const encounters = new EncounterSystem(null, true); encounters.init(g);
  const ctx = { dt: 1 / 60, elapsed: 0, emit: (name, payload) => bus.emit(name, payload),
    explode() {}, wind: new THREE.Vector3(), gravity: -22 };
  return { encounters, fruits, physics, g, ctx,
    cargo(species, position, velocity) {
      const f = new Fruit(physics, 101, species, null, .5);
      f.position.copy(position); f.detach(ctx, 'throw', 0, velocity);
      fruits.fruits.set(f.id, f); return f;
    },
    close() { encounters.dispose(); physics.world.free(); },
  };
}

test('the clearing starts with two sleeping threats and permits the first real harvest', () => {
  const f = fixture();
  try {
    const threats = f.encounters.snapshot().encounters;
    assert.deepEqual(threats.map(t => t.kind), ['mimic', 'snapjaw']);
    assert.ok(threats.every(t => t.dormant));
    assert.equal(f.fruits.beforeHarvest(20, 'hand'), true);
    assert.equal(f.encounters.harvestPrompt(21), null);
  } finally { f.close(); }
});

test('local and remote players on the extraction apron cannot start a threat attack', () => {
  for (const remote of [false, true]) {
    const f = fixture();
    try {
      f.encounters.setHarvestAwake(true);
      if (remote) f.encounters.setTargets([{ id: 'guest', position: [-13, 0, 27] }]);
      else f.g.player.position.set(-13, 0, 27);
      f.encounters.fixedStep(.016); f.encounters.fixedStep(1);
      assert.equal(f.encounters.snapshot().encounters.find(t => t.kind === 'mimic').phase, 'idle');
    } finally { f.close(); }
  }
});

test('committed movement stops outside the safe crate and its loose cargo', () => {
  const f = fixture();
  try {
    const stop = f.encounters.mimicBlocked([-23, 0, 27], [-7, 0, 27], .85);
    assert.ok(stop, 'safe-zone boundary is a swept obstruction');
    assert.ok(stop.point[0] < -14.2, 'the impact radius stays outside the six metre apron');
    assert.equal(stop.treePlantId, null);
  } finally { f.close(); }
});

test('the host bridge uses a real free Boulder body and leaves damaged cargo recoverable', () => {
  const f = fixture();
  try {
    f.encounters.setHarvestAwake(true);
    const plum = f.cargo('boulderplum', new THREE.Vector3(-27, .6, 22), new THREE.Vector3(30, 0, 0));
    f.encounters.fixedStep(.016);
    plum.body.setTranslation({ x: -21, y: .6, z: 22 }, true); plum.position.set(-21, .6, 22);
    f.encounters.fixedStep(.016);
    assert.equal(f.encounters.snapshot().encounters.find(t => t.kind === 'mimic').health, 2);
    assert.equal(plum.state, 'free'); assert.ok(plum.body);
    assert.ok(plum.body.linvel().x < 30, 'the collision removes some projectile momentum');
    assert.ok(plum.value() > 0, 'the same physical cargo can still be banked');
  } finally { f.close(); }
});

test('a guest cannot apply physical fruit contact to its local enemy model', () => {
  const f = fixture();
  try {
    f.encounters.setHarvestAwake(true);
    const plum = f.cargo('boulderplum', new THREE.Vector3(-27, .6, 22), new THREE.Vector3(30, 0, 0));
    f.encounters.net = { authoritative: false };
    f.encounters.fixedStep(.016);
    plum.position.set(-21, .6, 22); f.encounters.fixedStep(.016);
    assert.equal(f.encounters.snapshot().encounters.find(t => t.kind === 'mimic').health, 3);
  } finally { f.close(); }
});

test('Gluefruit attaches as physical cargo and drops again after the gum expires', () => {
  const f = fixture();
  try {
    f.encounters.setHarvestAwake(true);
    const glue = f.cargo('gluefruit', new THREE.Vector3(-27, 1.1, 22), new THREE.Vector3(8, 0, 0));
    f.encounters.fixedStep(.016);
    glue.position.set(-22, 1.1, 22); glue.body.setTranslation(glue.position, true);
    f.encounters.fixedStep(.016);
    assert.equal(glue.stuck, true);
    assert.equal(f.encounters.snapshot().encounters.find(t => t.kind === 'mimic').gumFruitId, 101);
    f.encounters.fixedStep(3); f.encounters.fixedStep(.016);
    assert.equal(glue.stuck, false);
    assert.equal(glue.state, 'free'); assert.ok(glue.body);
  } finally { f.close(); }
});

test('sticky cargo is released after host promotion using the replicated attachment', () => {
  const old = fixture(), promoted = fixture();
  try {
    old.encounters.setHarvestAwake(true);
    const original = old.cargo('gluefruit', new THREE.Vector3(-27, 1.1, 22), new THREE.Vector3(8, 0, 0));
    old.encounters.fixedStep(.016);
    original.position.set(-22, 1.1, 22); original.body.setTranslation(original.position, true);
    old.encounters.fixedStep(.016);
    const glue = promoted.cargo('gluefruit', original.position, new THREE.Vector3()); glue.stick();
    promoted.encounters.net = { authoritative: false };
    assert.equal(promoted.encounters.applySnapshot(old.encounters.snapshot()), true);
    promoted.encounters.net = { authoritative: true };
    promoted.encounters.fixedStep(3); promoted.encounters.fixedStep(.016);
    assert.equal(glue.stuck, false);
  } finally { old.close(); promoted.close(); }
});

test('replicated gum creates a visible world cue and removes the attack warning', () => {
  const scene = new THREE.Scene();
  const visual = new EncounterVisual('snapjaw', scene, 'voxel');
  try {
    const state = { kind: 'snapjaw', position: [0, 0, 0], heading: 0, phase: 'recover',
      timeLeft: 2, health: 2, baited: false, capturedVictimId: null,
      captureTimeLeft: 0, gumTimeLeft: 2 };
    visual.update(state, 0, .016);
    const gum = visual.root.getObjectByName('Gluefruit gum');
    assert.ok(gum?.visible, 'the stuck effect is apparent without HUD text');
    assert.equal(visual.danger.material.opacity, 0);
    visual.update({ ...state, gumTimeLeft: 0 }, 0, .016);
    assert.equal(gum.visible, false);
  } finally { visual.dispose(); }
});
