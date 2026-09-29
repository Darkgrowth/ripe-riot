import test from 'node:test';
import assert from 'node:assert/strict';
import { ThrownFruitBait } from '../../src/enemies/ThrownFruitBait.ts';
import { EncounterModel } from '../../src/enemies/EncounterModel.ts';

const fruit = (position, speed = 10, state = 'free') => ({ position, speed, state });
function fixture() {
  const tracker = new ThrownFruitBait();
  const jaw = new EncounterModel([{ kind: 'snapjaw', position: [0, 0, 0] }]);
  const offers = [];
  const step = (at, { dt = .02, blocked = false } = {}) => tracker.step(dt,
    () => at, [0, 0, 0], () => blocked, (candidate, position) => {
      const accepted = jaw.offerBait(position);
      if (accepted) offers.push({ ...candidate, position });
      return accepted;
    });
  return { tracker, jaw, offers, step };
}

test('a real flight crossing the jaw range baits once and remains available to retrieve', () => {
  const { tracker, jaw, offers, step } = fixture();
  tracker.arm(7, 'thrower', [-7, 1, 0]);
  step(fruit([7, 1, 0]));
  assert.equal(jaw.get('snapjaw').baited, true);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].fruitId, 7);
  assert.equal(offers[0].actorId, 'thrower');
  step(fruit([1, 1, 0]));
  assert.equal(offers.length, 1);
  assert.equal(tracker.size, 0);
});

test('unarmed free fruit, slow drops, overhead fruit and occluded throws cannot bait', () => {
  for (const [position, speed, blocked] of [[[1, 1, 0], 0.2, false],
    [[1, 8, 0], 10, false], [[1, 1, 0], 10, true]]) {
    const { tracker, offers, step } = fixture();
    step(fruit(position, speed));
    assert.equal(offers.length, 0);
    tracker.arm(7, 'thrower', [7, position[1], 0]);
    step(fruit(position, speed), { blocked });
    assert.equal(offers.length, 0);
  }
});

test('expiry, pickup and explicit reset discard a pending flight', () => {
  for (const reason of ['expiry', 'pickup', 'reset', 'gone']) {
    const { tracker, offers, step } = fixture();
    tracker.arm(7, 'thrower', [9, 1, 0]);
    if (reason === 'expiry') step(fruit([8, 1, 0]), { dt: 4 });
    if (reason === 'pickup') step(fruit([8, 1, 0], 10, 'carried'));
    if (reason === 'gone') step(null);
    if (reason === 'reset') tracker.clear();
    step(fruit([1, 1, 0]));
    assert.equal(offers.length, 0, reason);
    assert.equal(tracker.size, 0);
  }
});

test('an accepted pickup disarms a flight even if a drop follows before the next fixed step', () => {
  const { tracker, offers, step } = fixture();
  tracker.arm(7, 'thrower', [6, 1, 0]);
  tracker.disarm(7);
  step(fruit([4, 1, 0]));
  assert.equal(offers.length, 0);
});

test('another bait cannot keep restarting an already distracted warning', () => {
  const { tracker, jaw, offers, step } = fixture();
  tracker.arm(7, 'thrower', [6, 1, 0]);
  step(fruit([4, 1, 0]));
  jaw.step(.2);
  const remaining = jaw.get('snapjaw').timeLeft;
  tracker.arm(8, 'other', [-6, 1, 0]);
  step(fruit([-4, 1, 0]));
  assert.equal(jaw.get('snapjaw').timeLeft, remaining);
  assert.equal(offers.length, 1);
});

test('a fruit must be thrown again to arm another flight', () => {
  const { tracker, jaw, offers, step } = fixture();
  tracker.arm(7, 'thrower', [6, 1, 0]);
  step(fruit([4, 1, 0]));
  jaw.step(1); jaw.step(1); jaw.step(2);
  step(fruit([3, 1, 0]));
  assert.equal(offers.length, 1);
  tracker.arm(7, 'thrower', [6, 1, 0]);
  step(fruit([4, 1, 0]));
  assert.equal(offers.length, 2);
});

test('baited warning follows that fruit across the jaws without restarting or extending its timer', () => {
  const { jaw } = fixture();
  jaw.offerBait([0, 1, 5]);
  jaw.step(.2);
  const remaining = jaw.get('snapjaw').timeLeft;
  assert.equal(jaw.followBait([0, 1, -4]), true);
  assert.equal(jaw.get('snapjaw').timeLeft, remaining);
  assert.ok(Math.cos(jaw.get('snapjaw').heading) < -.99);
  assert.equal(jaw.followBait([0, 1, -30]), false);
  jaw.step(1);
  assert.equal(jaw.followBait([4, 1, 0]), false, 'attack commits and stops tracking');
});
