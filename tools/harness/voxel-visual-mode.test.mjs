import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectVisualMode } from '../../src/art/voxel/VisualMode.ts';

test('detailed voxel pilot is explicitly opt-in', () => {
  assert.equal(selectVisualMode('', false), 'baseline');
  assert.equal(selectVisualMode('?voxelPilot=1', false), 'voxel');
  assert.equal(selectVisualMode('?voxelPilot=0', false), 'baseline');
  assert.equal(selectVisualMode('?voxelPilot=true', false), 'baseline');
});

test('Mimic comparison keeps its established A/B presentation', () => {
  assert.equal(selectVisualMode('?voxelPilot=1&mimicCompare=A', true), 'baseline');
  assert.equal(selectVisualMode('?voxelPilot=1&mimicCompare=B', true), 'baseline');
});
