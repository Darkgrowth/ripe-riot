import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { importBundled } from './import-bundled.mjs';
await RAPIER.init();
const { FruitSystem } = await importBundled('src/fruit/FruitSystem.ts', 'orchard-join-fruit');
const { PhysicsWorld } = await importBundled('src/physics/PhysicsWorld.ts', 'orchard-join-physics');
const { OrchardTerrain } = await importBundled('src/world/OrchardClearing.ts', 'orchard-join-terrain');
const { HarvestExtraction } = await importBundled('src/systems/HarvestExtraction.ts', 'orchard-join-extraction');
const { EventBus } = await importBundled('src/core/Events.ts', 'orchard-join-events');

function fixture() {
  const physics = new PhysicsWorld(); physics.init();
  const terrain = new OrchardTerrain();
  const world = { orchardRun: true, terrain,
    groundAt(x, z, offset = 0) { return new THREE.Vector3(x, terrain.height(x, z) + offset, z); } };
  let nextId = 1;
  const net = { authoritative: true };
  const systems = { world, net };
  const g = { physics, clock: { elapsed: 0 }, bus: new EventBus(),
    renderer: { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera() },
    newId: () => nextId++, reserveId(id) { nextId = Math.max(nextId, id + 1); },
    get: key => systems[key], has: key => key in systems };
  const fruit = new FruitSystem('voxel'); fruit.init(g); fruit.net = net; systems.fruit = fruit;
  const extraction = new HarvestExtraction(); extraction.init(g);
  return { physics, fruit, extraction, net, g };
}

test('saved guest joining a fresh host restores seed fruit and remains complete on promotion', () => {
  const host = fixture(), guest = fixture();
  try {
    const apple = [...host.fruit.fruits.values()].find(f => f.species === 'apple');
    guest.g.bus.emit('fruit:sold', { fruitId: apple.id, value: 20, species: 'apple' });
    guest.extraction.deserialize(guest.extraction.serialize());
    assert.equal(guest.fruit.get(apple.id), undefined);
    guest.net.authoritative = false;
    const manifest = host.fruit.nodeManifest();
    guest.fruit.applyNodeManifest(manifest.seq, manifest.changes);
    guest.extraction.applyNet(host.extraction.netState(), 'fresh-host');
    assert.equal(guest.extraction.banked, 0);
    assert.equal(guest.fruit.get(apple.id)?.state, 'attached');
    assert.equal(guest.fruit.fruits.size, host.fruit.fruits.size);
    assert.equal(guest.fruit.nodeSeq, host.fruit.nodeSeq);
    guest.net.authoritative = true;
    assert.ok(guest.fruit.get(apple.id));
    assert.deepEqual(guest.fruit.nodeManifest(), host.fruit.nodeManifest());
  } finally { host.physics.world.free(); guest.physics.world.free(); }
});

test('manifest restores untouched seeds while retaining host consumed nodes and subsequent changes', () => {
  const host = fixture(), guest = fixture();
  try {
    const apples = [...host.fruit.fruits.values()].filter(f => f.species === 'apple').slice(0, 3);
    host.fruit.restoreRunFruitIds([apples[0].id]);
    guest.fruit.restoreRunFruitIds([apples[1].id]);
    guest.net.authoritative = false;
    const manifest = host.fruit.nodeManifest();
    guest.fruit.applyNodeManifest(manifest.seq, manifest.changes);
    assert.equal(guest.fruit.get(apples[0].id)?.state, 'free'); // snapshot removes the host tombstone
    assert.equal(guest.fruit.get(apples[1].id)?.state, 'attached');
    host.fruit.restoreRunFruitIds([apples[2].id]);
    assert.equal(guest.fruit.applyNodeChanges(host.fruit.nodeChangesSince(manifest.seq)), true);
    assert.ok(guest.fruit.freedByLog.has(apples[2].id));
    assert.deepEqual(guest.fruit.nodeManifest(), host.fruit.nodeManifest());
  } finally { host.physics.world.free(); guest.physics.world.free(); }
});
