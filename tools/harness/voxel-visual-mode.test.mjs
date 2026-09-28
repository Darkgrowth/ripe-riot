import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectVisualMode } from '../../src/art/voxel/VisualMode.ts';

test('normal launch uses the finished voxel direction with an explicit baseline diagnostic', () => {
  assert.equal(selectVisualMode('', false), 'voxel');
  assert.equal(selectVisualMode('?fresh=1', false), 'voxel');
  assert.equal(selectVisualMode('?voxelPilot=1', false), 'voxel');
  assert.equal(selectVisualMode('?voxelPilot=0', false), 'baseline');
  assert.equal(selectVisualMode('?voxelPilot=true', false), 'voxel');
});

test('Mimic comparison keeps its established A/B presentation', () => {
  assert.equal(selectVisualMode('?voxelPilot=1&mimicCompare=A', true), 'baseline');
  assert.equal(selectVisualMode('?voxelPilot=1&mimicCompare=B', true), 'baseline');
});
