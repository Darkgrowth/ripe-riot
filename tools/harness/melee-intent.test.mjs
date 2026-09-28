import test from 'node:test';
import assert from 'node:assert/strict';
import { MeleeIntentGuard, validMeleeOrigin } from '../../src/net/MeleeIntentGuard.ts';

test('each peer gets one accepted result for each increasing swing ID', () => {
  const guard = new MeleeIntentGuard();
  assert.deepEqual(guard.accept('alice', 1, 10, true), { ok: true, reason: 'accepted' });
  assert.deepEqual(guard.accept('alice', 1, 11, true), { ok: false, reason: 'stale' });
  assert.deepEqual(guard.accept('alice', 0, 12, true), { ok: false, reason: 'invalid-id' });
  assert.deepEqual(guard.accept('alice', 2, 12, true), { ok: true, reason: 'accepted' });
  assert.deepEqual(guard.accept('bob', 1, 12, true), { ok: true, reason: 'accepted' });
});

test('a rejected fast swing cannot be replayed when the cadence gap has passed', () => {
  const guard = new MeleeIntentGuard();
  assert.deepEqual(guard.accept('alice', 10, 5, true), { ok: true, reason: 'accepted' });
  assert.deepEqual(guard.accept('alice', 11, 5.2, true), { ok: false, reason: 'cadence' });
  assert.deepEqual(guard.accept('alice', 11, 6, true), { ok: false, reason: 'stale' });
  assert.deepEqual(guard.accept('alice', 12, 6, true), { ok: true, reason: 'accepted' });
});

test('inactive swings are consumed so they cannot be replayed after recovery', () => {
  const guard = new MeleeIntentGuard();
  assert.deepEqual(guard.accept('alice', 1, 1, false), { ok: false, reason: 'inactive' });
  assert.deepEqual(guard.accept('alice', 1, 2, true), { ok: false, reason: 'stale' });
  assert.deepEqual(guard.accept('alice', 2, 2, true), { ok: true, reason: 'accepted' });
});

test('invalid IDs and clocks never enter the replay ledger', () => {
  const guard = new MeleeIntentGuard();
  for (const id of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(guard.accept('alice', id, 1, true), { ok: false, reason: 'invalid-id' });
  }
  assert.deepEqual(guard.accept('', 1, 1, true), { ok: false, reason: 'invalid-id' });
  assert.deepEqual(guard.accept('alice', 1, Number.NaN, true), { ok: false, reason: 'invalid-id' });
  assert.deepEqual(guard.accept('alice', 1, 1, true), { ok: true, reason: 'accepted' });
});

test('departures and host migration clear only the intended replay state', () => {
  const guard = new MeleeIntentGuard();
  guard.accept('alice', 1, 1, true);
  guard.accept('bob', 1, 1, true);
  guard.clearPeer('alice');
  assert.deepEqual(guard.accept('alice', 1, 2, true), { ok: true, reason: 'accepted' });
  assert.deepEqual(guard.accept('bob', 1, 2, true), { ok: false, reason: 'stale' });
  guard.clear();
  assert.deepEqual(guard.accept('bob', 1, 3, true), { ok: true, reason: 'accepted' });
});

test('melee origin must stay near the actor eye, including vertical offset', () => {
  assert.equal(validMeleeOrigin([1.29, 2.7, 0], [0, 0, 0], 1.8), true);
  assert.equal(validMeleeOrigin([1.31, 1.8, 0], [0, 0, 0], 1.8), false);
  assert.equal(validMeleeOrigin([0, 2.81, 0], [0, 0, 0], 1.8), false);
  assert.equal(validMeleeOrigin([0, 0.79, 0], [0, 0, 0], 1.8), false);
  assert.equal(validMeleeOrigin([Number.NaN, 1.8, 0], [0, 0, 0], 1.8), false);
  assert.equal(validMeleeOrigin([0, 1.8, 0], [0, Number.POSITIVE_INFINITY, 0], 1.8), false);
  assert.equal(validMeleeOrigin([0, 1.8, 0], [0, 0, 0], Number.NaN), false);
});
