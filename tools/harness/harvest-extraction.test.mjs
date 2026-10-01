import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';
const { HarvestExtraction } = await importBundled('src/systems/HarvestExtraction.ts', 'harvest-extraction');
const { EventBus } = await importBundled('src/core/Events.ts', 'extraction-event-bus');

function fixture(authoritative = true) {
  const bus = new EventBus(), fruit = { authoritative, fruits: new Map(), get(id) { return this.fruits.get(id); },
    restoreRunFruitIds(ids) { for (const id of ids) this.fruits.delete(id); } };
  const world = { sellPad: new THREE.Vector3(-7, 1, 27), sellRadius: 3.2 };
  const interaction = { carried: null, basket: { items: [] } };
  const net = { authoritative, requestExtractionFinish() { return true; } };
  const systems = { world, fruit, interaction, net };
  const g = { bus, player: { state: 'active', position: new THREE.Vector3(-7, 1, 27) },
    input: { enabled: true }, clock: { paused: false }, has: n => n in systems, get: n => systems[n] };
  const extraction = new HarvestExtraction(); extraction.init(g);
  const sale = (id, value) => bus.emit('fruit:sold', { fruitId: id, value, species: 'apple', quality: 'Good', mass: 1 });
  return { extraction, bus, fruit, g, interaction, sale, net };
}

test('quota counts accepted fruit sale IDs once and ignores cash grants and malformed values', () => {
  const { extraction, bus, sale } = fixture();
  bus.emit('money:changed', { money: 9000, delta: 9000, reason: 'defeat:mimic' });
  sale(1, 100); sale(1, 100); sale(2, 0); sale(3, NaN); sale(-1, 40);
  assert.equal(extraction.banked, 100);
  assert.equal(extraction.fruitCount, 1);
});

test('exact quota keeps play active and partial extraction requires empty hands at the crate', () => {
  const { extraction, sale, g, interaction } = fixture();
  sale(1, 499); assert.equal(extraction.targetReached, false);
  sale(2, 1); assert.equal(extraction.targetReached, true); assert.equal(extraction.finished, false);
  interaction.basket.items.push({ id: 3 }); assert.equal(extraction.finish(), false);
  interaction.basket.items = []; g.player.position.x = 40; assert.equal(extraction.finish(), false);
  g.player.position.x = -7; assert.equal(extraction.finish(), true); assert.equal(extraction.finish(), false);
  const partial = fixture(); partial.sale(8, 50);
  assert.equal(partial.extraction.finish(), true); assert.equal(partial.extraction.banked, 50);
});

test('guest confirmation events cannot mint team cargo and host state survives promotion', () => {
  const host = fixture(); host.sale(1, 100); host.sale(2, 125);
  const guest = fixture(false); guest.sale(2, 125);
  assert.equal(guest.extraction.banked, 0);
  assert.equal(guest.extraction.applyNet(host.extraction.netState()), true);
  assert.equal(guest.extraction.banked, 225);
  guest.fruit.authoritative = true; guest.net.authoritative = true;
  guest.sale(1, 100); guest.sale(3, 50);
  assert.equal(guest.extraction.banked, 275);
});

test('saved cargo removes harvested IDs before they can pay again on reload', () => {
  const first = fixture(); first.sale(1, 120);
  first.bus.emit('fruit:destroyed', { fruitId: 2, species: 'apple', value: 10 });
  const reload = fixture(); reload.fruit.fruits.set(1, { id: 1 }); reload.fruit.fruits.set(2, { id: 2 });
  reload.fruit.fruits.set(3, { id: 3 });
  reload.extraction.deserialize(first.extraction.serialize());
  assert.equal(reload.extraction.banked, 120);
  assert.deepEqual([...reload.fruit.fruits.keys()], [3]);
  reload.sale(1, 120); assert.equal(reload.extraction.banked, 120);
});

test('malformed or stale snapshots cannot alter banked cargo or completion', () => {
  const f = fixture(); f.sale(1, 100); const state = f.extraction.netState();
  for (const bad of [{ ...state, banked: 9999 }, { ...state, secured: [[1, NaN]] },
    { ...state, secured: [[1, 100], [1, 100]] }, { ...state, elapsed: -1 },
    { ...state, revision: -1 }, { ...state, lost: [1] }]) {
    assert.equal(f.extraction.applyNet(bad), false);
    assert.equal(f.extraction.banked, 100);
  }
  f.sale(2, 20); assert.equal(f.extraction.applyNet(state), false);
});

test('run time stops in solo menus and after explicit extraction', () => {
  const { extraction, g } = fixture();
  extraction.frameUpdate(10); g.clock.paused = true; extraction.frameUpdate(20);
  assert.equal(extraction.elapsed, 10);
  g.clock.paused = false; extraction.finish(); extraction.frameUpdate(10);
  assert.equal(extraction.elapsed, 10);
});
