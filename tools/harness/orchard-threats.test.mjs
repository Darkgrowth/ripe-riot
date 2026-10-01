import test from 'node:test';
import assert from 'node:assert/strict';
import { EncounterModel } from '../../src/enemies/EncounterModel.ts';

function model(blocked = null, prototype = true) {
  return new EncounterModel([
    { kind: 'mimic', position: [10, 0, 0], dormant: true },
    { kind: 'snapjaw', position: [0, 0, 0], dormant: true },
  ], () => 0, 0, blocked, null, { harvestChaos: prototype });
}

function awake(m) {
  assert.equal(typeof m.setHarvestAwake, 'function', 'harvest pressure must control threat dormancy');
  m.setHarvestAwake(true);
  return m;
}

const contact = (species = 'boulderplum', kind = 'mimic') => ({
  fruitId: 101, species, kind, point: [9, 1, 0], direction: [1, 0, 0], speed: 8,
});

test('a rolling Boulder Plum damages once and physically moves a live threat', () => {
  const m = awake(model());
  const hit = m.applyFruitContact(contact());
  assert.equal(hit.damage, 1);
  assert.equal(m.get('mimic').health, 2);
  assert.ok(m.get('mimic').position[0] > 10.5, 'the enemy moves away from the rolling cargo');
  assert.equal(m.get('mimic').phase, 'stagger');
});

test('physical knockback cannot move an enemy through orchard boards', () => {
  const m = awake(model(() => true));
  assert.equal(m.applyFruitContact(contact()).damage, 1);
  assert.deepEqual(m.get('mimic').position, [10, 0, 0]);
});

function capturedModel() {
  const m = awake(model());
  m.setTargets([{ id: 'picker', position: [0, 0, 2] }]);
  m.step(.02); m.step(.72); m.step(.02);
  assert.equal(m.isCaptured('picker'), true);
  return m;
}

test('Gluefruit interrupts a jaw hold without killing it and later wears off', () => {
  const m = capturedModel();
  const hit = m.applyFruitContact({ ...contact('gluefruit', 'snapjaw'), point: [0, 1, 1] });
  assert.equal(hit.damage, 0);
  assert.equal(hit.releasedVictimId, 'picker');
  assert.equal(m.isCaptured('picker'), false);
  assert.equal(m.get('snapjaw').health, 2);
  assert.ok(m.get('snapjaw').gumTimeLeft >= 2);
  assert.equal(m.step(1).some(e => e.type === 'fling' || e.type === 'capture'), false);
  m.setTargets([]); m.step(3);
  assert.equal(m.get('snapjaw').gumTimeLeft, 0);
});

test('resting pressure releases a captive and cancels committed attacks', () => {
  const m = capturedModel();
  const events = m.setHarvestAwake(false);
  assert.ok(events.some(e => e.type === 'release' && e.victimId === 'picker' && e.reason === 'rest'));
  assert.equal(m.isCaptured('picker'), false);
  assert.equal(m.get('snapjaw').dormant, true);
  assert.equal(m.step(5).some(e => ['damage', 'capture', 'fling'].includes(e.type)), false);
  awake(m);
  assert.equal(m.get('snapjaw').dormant, false);
  assert.equal(m.get('snapjaw').health, 2);
});

test('an Orchard Run air shot redirects live jaws without their closed-shell protection or HP loss', () => {
  const m = awake(model());
  const hit = m.tryHit([0, 1.15, -4], [0, 0, 1], 'air', 'picker');
  assert.equal(hit?.damage, 0);
  assert.equal(m.get('snapjaw').health, 2);
  assert.ok(m.get('snapjaw').position[2] > .5);
  assert.equal(m.get('snapjaw').phase, 'recover');
});

test('gum duration survives an encounter snapshot and host promotion', () => {
  const m = awake(model());
  m.applyFruitContact(contact('gluefruit'));
  m.step(.5);
  const promoted = model();
  assert.equal(promoted.applySnapshot(m.snapshot()), true);
  assert.ok(promoted.get('mimic').gumTimeLeft >= 1.5);
  promoted.step(.5);
  assert.ok(promoted.get('mimic').gumTimeLeft < m.get('mimic').gumTimeLeft);
});

test('a second Gluefruit cannot replace and orphan the current physical attachment', () => {
  const m = awake(model());
  m.applyFruitContact(contact('gluefruit'));
  assert.equal(m.applyFruitContact({ ...contact('gluefruit'), fruitId: 102 }), null);
  assert.equal(m.get('mimic').gumFruitId, 101);
});

test('an Orchard Run air shot cannot redirect a threat behind solid cover', () => {
  const m = new EncounterModel([{ kind: 'snapjaw', position: [0, 0, 0] }],
    () => 0, 0, null, () => .3, { harvestChaos: true });
  assert.equal(m.tryHit([0, 1.15, -4], [0, 0, 1], 'air', 'picker'), null);
  assert.deepEqual(m.get('snapjaw').position, [0, 0, 0]);
});

test('physical fruit cannot mutate the original expedition or malformed/sleeping threats', () => {
  const original = model(null, false);
  assert.equal(typeof original.applyFruitContact, 'function');
  assert.equal(original.applyFruitContact(contact()), null);
  const m = model();
  assert.equal(m.applyFruitContact(contact()), null, 'quiet harvest threats cannot be hit while asleep');
  awake(m);
  assert.equal(m.applyFruitContact({ ...contact(), speed: NaN }), null);
  assert.equal(m.applyFruitContact({ ...contact(), point: [Infinity, 0, 0] }), null);
  assert.equal(m.applyFruitContact({ ...contact(), speed: .1 }), null);
  assert.equal(m.get('mimic').health, 3);
});
