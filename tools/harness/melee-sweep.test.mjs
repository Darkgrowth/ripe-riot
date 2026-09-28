import test from 'node:test';
import assert from 'node:assert/strict';
import { probeMeleeSweep } from '../../src/enemies/MeleeSweep.ts';

const eye = [0, 1.7, 0];
const forward = [0, 0, 1];
const body = (id, center, radius) => ({ id, center, radius });

test('reach ends at the visible surface, not the enemy centre', () => {
  const edge = probeMeleeSweep(eye, forward, [body('mimic', [0, 1.7, 3.9], 1.2)]);
  assert.equal(edge?.id, 'mimic');
  assert.ok(edge.distance > 2.4 && edge.distance <= 2.9);
  assert.equal(probeMeleeSweep(eye, forward,
    [body('too-far', [0, 1.7, 4.6], 1.2)]), null);
});

test('a close or inside target and one on a slope can still be struck', () => {
  assert.equal(probeMeleeSweep(eye, forward,
    [body('close', [0, 1.7, 0.4], 1)])?.distance, 0);
  assert.equal(probeMeleeSweep(eye, forward,
    [body('slope', [0, 0.7, 2.0], 0.95)])?.id, 'slope');
});

test('the bounded horizontal arc can catch a side surface but not a distant flank', () => {
  assert.equal(probeMeleeSweep(eye, forward,
    [body('near-side', [1.3, 1.7, 2.15], 0.55)])?.id, 'near-side');
  assert.equal(probeMeleeSweep(eye, forward,
    [body('far-side', [2.0, 1.7, 2.15], 0.55)]), null);
});

test('the first reachable surface wins one swing, using current contact positions', () => {
  const movedIn = body('mimic', [0, 1.7, 2.6], 1);
  const movedOut = body('mimic', [0, 1.7, 4.6], 1);
  assert.equal(probeMeleeSweep(eye, forward, [movedOut]), null);
  assert.equal(probeMeleeSweep(eye, forward, [movedIn])?.id, 'mimic');
  assert.equal(probeMeleeSweep(eye, forward,
    [body('rear', [0, 1.7, 3.1], 1), movedIn])?.id, 'mimic');
});
