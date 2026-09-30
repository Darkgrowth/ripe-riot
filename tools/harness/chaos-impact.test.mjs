import assert from 'node:assert/strict';
import { test } from 'node:test';
import { impulseForChaosImpact } from '../../src/enemies/ChaosImpact.ts';

const charge = {
  epoch: 'host-a:3', id: 7, kind: 'mimic-charge',
  from: [0, 1, 0], to: [8, 1, 0],
  radius: 1, horizontalSpeed: 11, lift: 3,
};

test('sweep reaches attached and free fruit positions regardless of height', () => {
  const attachedHigh = impulseForChaosImpact(charge, [3, 5, 0.5]);
  const freeLow = impulseForChaosImpact(charge, [7, 0.2, -0.8]);
  assert.deepEqual(attachedHigh, [11, 3, 0]);
  assert.deepEqual(freeLow, [11, 3, 0]);
});

test('sweep excludes targets beyond the horizontal capsule', () => {
  assert.equal(impulseForChaosImpact(charge, [4, 1, 1.01]), null);
  assert.equal(impulseForChaosImpact(charge, [-1.01, 1, 0]), null);
});

test('capsule includes its endpoint and the rounded end cap', () => {
  assert.deepEqual(impulseForChaosImpact(charge, [8, 2, 1]), [11, 3, 0]);
  assert.deepEqual(impulseForChaosImpact(charge, [8.6, 2, 0.8]), [11, 3, 0]);
});

test('zero-length charge uses a deterministic radial direction', () => {
  const impact = { ...charge, from: [4, 0, 4], to: [4, 0, 4] };
  assert.deepEqual(impulseForChaosImpact(impact, [4, 0, 4.5]), [0, 3, 11]);
  assert.deepEqual(impulseForChaosImpact(impact, [4, 0, 4]), [11, 3, 0]);
  assert.equal(impulseForChaosImpact(impact, [4, 0, 5.01]), null);
});

test('impulse magnitude, lift and radius are bounded without mutating the event', () => {
  const event = { ...charge, radius: 1e9, horizontalSpeed: 1e9, lift: 1e9 };
  const original = structuredClone(event);
  const impulse = impulseForChaosImpact(event, [0, 0, 0]);
  assert.ok(impulse);
  assert.ok(Math.hypot(impulse[0], impulse[2]) <= 18);
  assert.ok(impulse[1] <= 8);
  assert.equal(impulseForChaosImpact(event, [100, 0, 0]), null, 'oversized radius cannot reach across the map');
  assert.deepEqual(event, original);
});

test('nonfinite positions and strengths never produce NaN or infinity', () => {
  assert.equal(impulseForChaosImpact(charge, [NaN, 0, 0]), null);
  assert.equal(impulseForChaosImpact({ ...charge, from: [Infinity, 0, 0] }, [0, 0, 0]), null);
  for (const value of [NaN, Infinity, -Infinity]) {
    const impulse = impulseForChaosImpact({ ...charge, horizontalSpeed: value, lift: value, radius: value }, [0, 0, 0]);
    if (impulse) assert.ok(impulse.every(Number.isFinite));
  }
});
