import test from 'node:test';
import assert from 'node:assert/strict';
import { EncounterModel } from '../../src/enemies/EncounterModel.ts';

const tick = (m, seconds) => { const events = []; for (let i = 0; i < seconds * 60; i++) events.push(...m.step(1 / 60)); return events; };

test('authored Mimic stays dormant near ordinary harvest until its site activates', () => {
  const m = new EncounterModel([{ kind: 'mimic', position: [0, 0, 0], dormant: true, leashRadius: 12 }]);
  m.setTargets([{ id: 'picker', position: [3, 0, 0] }]);
  tick(m, 3);
  assert.equal(m.get('mimic').phase, 'idle');
  assert.equal(m.activate('mimic'), true);
  m.step(1 / 60);
  assert.equal(m.get('mimic').phase, 'warn');
});

test('abandoned Mimic returns inside its local site without healing', () => {
  const m = new EncounterModel([{ kind: 'mimic', position: [0, 0, 0], leashRadius: 12 }]);
  m.setTargets([{ id: 'picker', position: [6, 0, 0] }]);
  tick(m, 1.2);
  m.tryHit([m.get('mimic').position[0], 1.2, -2], [0, 0, 1], 'melee', 'picker');
  const health = m.get('mimic').health;
  m.setTargets([{ id: 'picker', position: [40, 0, 0] }]);
  assert.equal(tick(m, 8).filter(e => e.type === 'damage').length, 0);
  assert.ok(Math.hypot(m.get('mimic').position[0], m.get('mimic').position[2]) < .2);
  assert.equal(m.get('mimic').health, health);
});

test('solid cover prevents Spitter acquisition and blocks an already flying seed before damage', () => {
  let wall = true;
  const cover = () => wall ? .35 : null;
  const m = new EncounterModel([{ kind: 'spitter', position: [0, 0, 0] }], () => 0, 0, null, cover);
  m.setTargets([{ id: 'behind-cover', position: [0, 0, 9] }]);
  tick(m, 2);
  assert.equal(m.snapshot().projectiles.length, 0);
  assert.equal(m.get('spitter').phase, 'idle');
  wall = false; tick(m, 1);
  assert.ok(m.snapshot().projectiles.length > 0);
  wall = true;
  assert.equal(tick(m, 1).filter(e => e.type === 'damage').length, 0);
  assert.equal(m.snapshot().projectiles.length, 0);
});

test('air reflection preserves a moving seed and only damages Spitter on its return collision', () => {
  const m = new EncounterModel([{ kind: 'spitter', position: [0, 0, 0] }], () => 0);
  m.setTargets([{ id: 'returner', position: [0, 0, 10] }]);
  tick(m, 1.2);
  const seed = m.snapshot().projectiles[0];
  assert.ok(seed);
  const result = m.tryHit([seed.position[0], seed.position[1], seed.position[2] + 1], [0, 0, -1], 'air', 'returner');
  assert.equal(result?.deflectedProjectileId, seed.id);
  assert.equal(m.snapshot().projectiles.length, 1);
  assert.equal(m.get('spitter').health, 2);
  const hits = tick(m, 1).filter(e => e.type === 'reflected-hit');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].hit.attackerId, 'returner');
  assert.equal(m.get('spitter').phase, 'defeated');
});

test('saved clear restoration is silent, permanent and cannot reactivate Mimic', () => {
  const m = new EncounterModel([{ kind: 'mimic', position: [0, 0, 0], dormant: true }]);
  assert.equal(typeof m.restoreCleared, 'function');
  m.restoreCleared(['mimic', 'bogus']);
  assert.equal(m.activate('mimic'), false);
  m.setTargets([{ id: 'picker', position: [2, 0, 0] }]);
  assert.deepEqual(tick(m, 5), []);
  assert.equal(m.get('mimic').phase, 'defeated');
});
