import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { FruitSystem } = await importBundled('src/fruit/FruitSystem.ts', 'chaos-fruit');

function fruit(id, state, x, z, mass = 2) {
  const calls = [];
  return { id, state, mass, position: new THREE.Vector3(x, 1, z), calls,
    applyImpulse(v) { calls.push({ state: this.state, impulse: v.clone() }); } };
}

test('host sweep detaches approved attached fruit before pushing it, and pushes nearby loose fruit', () => {
  const system = new FruitSystem();
  const puff = fruit(1, 'attached', 1.5, .25);
  const apple = fruit(2, 'free', 2, -.25);
  const prize = fruit(3, 'attached', 1.5, .35);
  const far = fruit(4, 'free', 1, 5);
  system.fruits = new Map([puff, apple, prize, far].map(f => [f.id, f]));
  system.net = { authoritative: true };
  system.detachAuthoritative = (f, cause, _player, _vel, approved) => {
    assert.equal(cause, 'chaos-impact');
    assert.equal(approved, true);
    f.state = 'free';
  };
  const impact = { epoch: 'host-a', id: 1, kind: 'mimic-charge',
    from: [0, 1, 0], to: [3, 1, 0], radius: .8, horizontalSpeed: 8, lift: 2 };
  assert.deepEqual(system.applyChaosImpact(impact, new Set([1])), [1, 2]);
  assert.equal(puff.calls.length, 1);
  assert.equal(puff.calls[0].state, 'free', 'detach must precede impulse');
  assert.deepEqual(puff.calls[0].impulse.toArray(), [16, 4, 0]);
  assert.equal(apple.calls.length, 1);
  assert.equal(prize.state, 'attached');
  assert.equal(far.calls.length, 0);
});

test('a repeated impact and a non-host call cannot move fruit twice', () => {
  const system = new FruitSystem();
  const apple = fruit(1, 'free', 1, 0);
  system.fruits = new Map([[1, apple]]);
  system.net = { authoritative: true };
  const impact = { epoch: 'host-a', id: 4, kind: 'mimic-charge',
    from: [0, 1, 0], to: [2, 1, 0], radius: 1, horizontalSpeed: 6, lift: 1 };
  assert.deepEqual(system.applyChaosImpact(impact), [1]);
  assert.deepEqual(system.applyChaosImpact(impact), []);
  system.net = { authoritative: false };
  assert.deepEqual(system.applyChaosImpact({ ...impact, id: 5 }), []);
  assert.equal(apple.calls.length, 1);
});
