import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { EncounterSystem } = await importBundled('src/enemies/EncounterSystem.ts',
  'encounter-melee-system');

function fixture(obstructed) {
  const scene = new THREE.Scene();
  const obstacles = [];
  const world = {
    groundAt: (x, z) => new THREE.Vector3(x, 0, z),
    terrain: { height: () => 0 },
  };
  const game = {
    renderer: { scene }, debug: null, input: { pointerLocked: true },
    bus: { emit() {} },
    player: { position: new THREE.Vector3(-23, 0, 19.8), body: {} },
    physics: { raycast: (origin, direction, reach) => {
      obstacles.push({ origin: origin.clone(), direction: direction.clone(), reach });
      return obstructed ? { distance: 0.3 } : null;
    } },
    get: name => name === 'world' ? world : null,
  };
  const system = new EncounterSystem();
  system.init(game);
  system.fixedStep(1 / 60);
  return { system, obstacles };
}

test('encounter melee follows the actual solid-world obstruction result', () => {
  const { system, obstacles } = fixture(true);
  const origin = new THREE.Vector3(-23, 1.7, 19.8);
  const direction = new THREE.Vector3(0, 0, 1);
  const before = system.snapshot().encounters.find(s => s.kind === 'mimic').health;
  assert.equal(system.resolveMelee(origin, direction, 'solo').outcome, 'blocked');
  assert.equal(system.snapshot().encounters.find(s => s.kind === 'mimic').health, before);
  assert.ok(obstacles.length > 0);
});

test('unobstructed contact applies host damage during the swing', () => {
  const { system } = fixture(false);
  const result = system.resolveMelee(new THREE.Vector3(-23, 1.7, 19.8),
    new THREE.Vector3(0, 0, 1), 'solo');
  assert.equal(result.outcome, 'hit');
  assert.equal(system.snapshot().encounters.find(s => s.kind === 'mimic').health, 2);
});

test('a melee defeat pays through the existing once-only callback', () => {
  const { system } = fixture(false);
  let payouts = 0;
  system.onDefeated = () => payouts++;
  const origin = new THREE.Vector3(-23, 1.7, 19.8);
  const direction = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < 4; i++) system.resolveMelee(origin, direction, 'solo');
  assert.equal(system.snapshot().encounters.find(s => s.kind === 'mimic').phase, 'defeated');
  assert.equal(payouts, 1);
});
