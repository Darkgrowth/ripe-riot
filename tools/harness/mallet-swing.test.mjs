import test from 'node:test';
import assert from 'node:assert/strict';
import { MalletSwing } from '../../src/tools/MalletSwing.ts';

test('a press starts one swing and contact waits for the visible strike', () => {
  const swing = new MalletSwing();
  assert.equal(swing.press(), 1);
  assert.equal(swing.state, 'windup');
  assert.equal(swing.step(0.10).sample, false);
  assert.equal(swing.step(0.08).sample, true);
  assert.equal(swing.currentId, 1);
  swing.markContact();
  assert.equal(swing.step(0.04).sample, false, 'one contact cannot apply twice');
  swing.step(0.30);
  assert.equal(swing.state, 'ready');
});

test('an empty swing reaches recovery and then becomes ready without a target', () => {
  const swing = new MalletSwing();
  swing.press();
  let endCount = 0;
  for (let i = 0; i < 30; i++) if (swing.step(1 / 60).activeEnded) endCount++;
  assert.equal(endCount, 1);
  assert.equal(swing.state, 'ready');
  assert.equal(swing.resolved, false);
});

test('one recovery press buffers a follow-up; rapid presses before contact do not', () => {
  const swing = new MalletSwing();
  assert.equal(swing.press(), 1);
  assert.equal(swing.press(), null);
  swing.step(0.31);
  assert.equal(swing.state, 'recover');
  assert.equal(swing.press(), null, 'recovery press queues rather than restarting early');
  assert.equal(swing.queued, true);
  swing.step(0.04);
  assert.equal(swing.press(), null, 'buffered press does not start early');
  assert.equal(swing.queued, true);
  assert.equal(swing.press(), null, 'a second press does not queue a third swing');
  assert.equal(swing.step(0.10).startedId, 2);
  assert.equal(swing.state, 'windup');
  swing.step(0.50);
  assert.equal(swing.state, 'ready');
});

test('capture, carry, menu or switching can cancel contact and the buffered press', () => {
  const swing = new MalletSwing();
  swing.press();
  swing.step(0.36);
  swing.press();
  assert.equal(swing.queued, true);
  swing.cancel();
  assert.equal(swing.state, 'ready');
  assert.equal(swing.queued, false);
  assert.equal(swing.step(1).startedId, null);
  assert.equal(swing.press(), 2, 'identity stays monotonic after cancellation');
});
