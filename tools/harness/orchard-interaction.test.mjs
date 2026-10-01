import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';
const { InteractionSystem } = await importBundled('src/interaction/InteractionSystem.ts', 'orchard-interaction');

test('empty hands at the crate expose the actual E extraction action', () => {
  const system = new InteractionSystem();
  let finished = 0;
  const run = { finished: false, banked: 192, finish() { finished++; return true; } };
  system.g = { player: { eyePosition: new THREE.Vector3(), lookDir: dir => dir.set(1, 0, 0) },
    has: name => name === 'extraction', get: () => run };
  system.fruitSys = { renderer: { highlightId: -1 } };
  system.nearSellPad = true;
  system.updateTarget();
  assert.equal(system.targetKind, 'finish');
  assert.match(system.promptText, /E.*Finish run.*192/);
  assert.equal(system.tryInteract(), true);
  assert.equal(finished, 1);
});

test('a finished co-op world cannot pay loose cargo or held sales after results', () => {
  const system = new InteractionSystem();
  system.g = { has: name => name === 'extraction', get: () => ({ finished: true }) };
  system.padFruit.set(4, 0);
  system.updateSellPad(1 / 60);
  assert.equal(system.padFruit.size, 0);
  assert.deepEqual(system.sellAll(), { count: 0, total: 0 });
});
