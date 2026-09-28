import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { ImpactFX } = await importBundled('src/fx/ImpactFX.ts', 'melee-impact-fx');

test('melee contact emits a brief world cue while an air swing emits none', () => {
  const listeners = new Map();
  const scene = new THREE.Scene();
  const fx = new ImpactFX();
  fx.init({
    get: name => name === 'world' ? { terrain: { height: () => 0 } } : { get: () => null },
    renderer: { scene },
    bus: { on: (name, listener) => listeners.set(name, listener) },
    debug: null,
  });
  const onMelee = listeners.get('tool:meleeResult');
  assert.equal(typeof onMelee, 'function');
  onMelee({ swingId: 1, outcome: 'whoosh' });
  assert.equal(fx.spawned, 0);
  onMelee({ swingId: 2, outcome: 'hit', point: new THREE.Vector3(2, 1.5, 3) });
  const ordinary = fx.spawned;
  assert.ok(ordinary >= 4 && ordinary <= 12);
  onMelee({ swingId: 3, outcome: 'hit', defeated: true,
    point: new THREE.Vector3(2, 1.5, 3) });
  assert.ok(fx.spawned > ordinary, 'defeat gets a stronger local burst');
  fx.frameUpdate();
  assert.ok(scene.children.length > 0);
  fx.dispose();
});
