import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { IslandDirector } = await importBundled('src/systems/IslandDirector.ts',
  'island-final-events');

function fixture() {
  const progress = { chapterState: 'active' };
  const shell = { open: false };
  const events = [];
  const director = new IslandDirector();
  director.fruit = { authoritative: true };
  director.world = { shopCounter: new THREE.Vector3(58, 0, 62) };
  director.g = {
    seed: 1,
    player: { position: new THREE.Vector3(58, 0, 62), state: 'active' },
    bus: { emit(name, payload) { events.push({ name, payload }); } },
    has: name => name === 'progress' || name === 'expeditionShell',
    get(name) {
      if (name === 'legendary') return { phase: 'prepare', tethers: [] };
      if (name === 'tools') return { owned: new Set() };
      if (name === 'progress') return progress;
      if (name === 'expeditionShell') return shell;
      throw new Error(`unexpected ${name}`);
    },
  };
  return { director, progress, shell, events };
}

test('the final return and its settlement transition block new orders once', () => {
  const { director, progress, shell } = fixture();
  progress.chapterState = 'return';
  assert.equal(director.start('order', true), false);
  director.fixedStep(1 / 60);
  progress.chapterState = 'settled';
  shell.open = true;
  assert.equal(director.start('order', true), false);
  director.fixedStep(1 / 60);
  assert.equal(director.start('order', true), true);
});

test('a settled host opening a local menu does not cancel an order for the crew', () => {
  const { director, progress, shell } = fixture();
  progress.chapterState = 'settled';
  assert.equal(director.start('order', true), true);
  shell.open = true;
  director.fixedStep(1 / 60);
  assert.equal(director.getPresentation().phase, 'active');
});

test('entering the final return clears a side event already in progress', () => {
  const { director, progress, events } = fixture();
  assert.equal(director.start('order', true), true);
  assert.equal(director.getPresentation().phase, 'active');
  progress.chapterState = 'return';
  director.fixedStep(1 / 60);
  assert.equal(director.getPresentation().phase, 'idle');
  assert.equal(events.filter(event => event.name === 'money:changed').length, 0);
});

test('a stale client Windfall warning stays quiet during the final return', () => {
  const { director, progress, events } = fixture();
  director.fruit.plants = new Map();
  director.state.event = { ...director.getPresentation(), id: 2,
    kind: 'windfall', phase: 'warning', remaining: 8, at: [0, 0, 0] };
  progress.chapterState = 'return';
  director.frameUpdate(0.016);
  assert.equal(events.filter(event => event.name === 'audio:sfx').length, 0);
});
