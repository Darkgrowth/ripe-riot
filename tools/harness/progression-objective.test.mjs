import test from 'node:test';
import assert from 'node:assert/strict';
import { importBundled } from './import-bundled.mjs';

const { Progression } = await importBundled('src/systems/Progression.ts',
  'progression-objective');

test('the visible objective follows cutting, falling and extraction after King Vine', () => {
  const progress = new Progression();
  progress.threatsCleared = new Set(['mimic', 'snapjaw', 'spitter']);
  const legendary = { phase: 'tether', vines: [1, 2, 3, 4] };
  progress.g = {
    has: name => name === 'kingVine' || name === 'legendary',
    get: name => name === 'kingVine' ? { subdued: true } : legendary,
  };
  assert.match(progress.objective, /cut.*vine/i);
  legendary.phase = 'drop';
  legendary.vines = [];
  assert.match(progress.objective, /follow.*melon.*ravine/i);
  legendary.phase = 'recover';
  assert.match(progress.objective, /melon.*pad/i);
});
