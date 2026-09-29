import test from 'node:test';
import assert from 'node:assert/strict';
import { HarvestSites } from '../../src/enemies/HarvestSites.ts';
const defs = [{ id: 'orchard-mimic', kind: 'mimic', plantId: 20, fruitIds: [21, 22, 23], position: [0, 0, 0] },
  { id: 'snapjaw-cache', kind: 'snapjaw', plantId: 30, fruitIds: [31], position: [0, 0, 8] }];

test('ordinary apples remain allowed; authored crop warns before a distinct second action', () => {
  const sites = new HarvestSites(defs);
  assert.equal(sites.disturb(99, 1).allow, true);
  assert.deepEqual(sites.disturb(20, 1), { allow: false, changed: true, phase: 'warning', activate: false });
  for (let i = 0; i < 8; i++) assert.equal(sites.disturb(20, 1).allow, false);
  assert.deepEqual(sites.disturb(20, 1.8), { allow: true, changed: true, phase: 'active', activate: true });
  assert.equal(sites.disturb(20, 2).activate, false);
});

test('site save/migration retains released and consumed prizes without replaying activation', () => {
  const sites = new HarvestSites(defs);
  sites.disturb(20, 1); sites.disturb(20, 2);
  sites.release(21); sites.consume(21);
  const next = new HarvestSites(defs);
  next.apply(sites.snapshot());
  assert.equal(next.disturb(20, 10).activate, false);
  assert.deepEqual(next.snapshot()[0].consumed, [21]);
  next.clear('mimic');
  assert.equal(next.snapshot()[0].phase, 'cleared');
  assert.equal(next.disturb(20, 20).activate, false);
});

test('malformed saves cannot inject arbitrary fruit IDs or skip a site from invalid phases', () => {
  const sites = new HarvestSites(defs);
  sites.apply([{ id: 'orchard-mimic', phase: 'nonsense', released: [21, 999], consumed: [NaN, 999] }, null]);
  assert.equal(sites.snapshot()[0].phase, 'quiet');
  assert.deepEqual(sites.snapshot()[0].consumed, []);
});
