import test from 'node:test';
import assert from 'node:assert/strict';
import { importBundled } from './import-bundled.mjs';

const { NetCatchGuard, validNetCatchGeometry } = await importBundled('src/net/NetCatchGuard.ts', 'net-catch-guard');

test('a numbered swing catches once only inside its host-timed window', () => {
  const guard = new NetCatchGuard();
  assert.equal(guard.start('rescuer', 1, 10, true), true);
  assert.equal(guard.catch('rescuer', 1, 10.04, true), false);
  assert.equal(guard.catch('rescuer', 1, 10.12, true), true);
  assert.equal(guard.catch('rescuer', 1, 10.14, true), false);
  assert.equal(guard.start('rescuer', 1, 11, true), false);
  assert.equal(guard.start('rescuer', 2, 11, true), true);
  assert.equal(guard.catch('rescuer', 1, 11.12, true), false);
  assert.equal(guard.catch('rescuer', 2, 11.29, true), false);
});

test('wrong state, malformed IDs, and invalid catch geometry cannot be promoted later', () => {
  const guard = new NetCatchGuard();
  assert.equal(guard.start('rescuer', 1, 1, false), false);
  assert.equal(guard.start('rescuer', 1, 1.1, true), false);
  assert.equal(guard.start('rescuer', 2, 1.5, true), true);
  assert.equal(guard.catch('rescuer', 2, 1.62, false), false);
  assert.equal(guard.catch('rescuer', 2, 1.65, true), true);
  assert.equal(guard.start('rescuer', NaN, 2, true), false);
  assert.equal(guard.catch('rescuer', 2, Infinity, true), false);
});

test('capture cancels a swing and peer epochs are isolated', () => {
  const guard = new NetCatchGuard();
  assert.equal(guard.start('one', 1, 5, true), true);
  assert.equal(guard.start('two', 1, 5, true), true);
  guard.cancel('one');
  assert.equal(guard.catch('one', 1, 5.1, true), false);
  assert.equal(guard.catch('two', 1, 5.1, true), true);
  guard.clearPeer('one');
  assert.equal(guard.start('one', 1, 6, true), true);
});

test('catch geometry validates the reported eye, aim, and flying torso', () => {
  const eye = [0, 1.7, 0], actor = [0, 0, 0], aim = [0, 0, 1];
  assert.equal(validNetCatchGeometry(eye, aim, actor, 1.7, [0, .8, 2.8]), true);
  assert.equal(validNetCatchGeometry([9, 1.7, 0], aim, actor, 1.7, [0, .8, 2.8]), false);
  assert.equal(validNetCatchGeometry(eye, aim, actor, 1.7, [3, .8, 2.8]), false);
  assert.equal(validNetCatchGeometry(eye, aim, actor, 1.7, [0, .8, 8]), false);
  assert.equal(validNetCatchGeometry(eye, [0, 0, 10], actor, 1.7, [0, .8, 2.8]), false);
  assert.equal(validNetCatchGeometry(eye, [0, NaN, 1], actor, 1.7, [0, .8, 2.8]), false);
});
