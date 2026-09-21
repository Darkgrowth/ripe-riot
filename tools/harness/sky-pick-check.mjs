// Event-level scoring regression. No browser or GPU: exercise the real
// fruit:detached listener with controlled fruit and local-ground fixtures.
// Run: node tools/harness/sky-pick-check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../../src/systems/HarvestScoring.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { HarvestScoring, STUNTS } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function fixture() {
  const handlers = new Map(), emitted = [], fruits = new Map(), heights = new Map();
  const bus = {
    on(name, callback) { handlers.set(name, callback); },
    emit(name, payload) {
      emitted.push({ name, payload });
      handlers.get(name)?.(payload);
    },
  };
  const systems = {
    fruit: { get: id => fruits.get(id) },
    ropes: { attachedTo: () => [] },
    world: { terrain: { height: (x, z) => {
      assert.equal(z, -x, 'terrain queried at the fruit release location');
      assert.ok(heights.has(x), 'terrain queried at a known release location');
      return heights.get(x);
    } } },
  };
  const scoring = new HarvestScoring();
  scoring.init({ bus, clock: { elapsed: 0 }, get: name => systems[name] });
  function detach(ground, releaseY, cause = 'hand') {
    const id = fruits.size + 1;
    const fruit = { id, detachPosition: { x: id, y: releaseY, z: -id } };
    fruits.set(id, fruit);
    heights.set(id, ground);
    bus.emit('fruit:detached', { fruitId: id, cause, playerId: 27 });
    return fruit;
  }
  return { scoring, bus, emitted, detach };
}

let checked = 0;
for (const [label, ground, release, expected, cause = 'hand'] of [
  ['ordinary lowland branch', 2, 6, false],
  ['ordinary hill branch', 24, 28, false],
  ['ordinary ridge pick', 38, 39.5, false],
  ['lowland elevated harvest', 2, 11, true],
  ['hill elevated harvest', 24, 33, true],
  ['exact eight-metre boundary', 24, 32, false],
  ['just above eight metres', 24, 32.01, true],
  ['submerged terrain does not add height', -12, 4, false],
  ['elevated harvest over water', -12, 9, true],
  ['tall fruit shaken free', 2, 11, true, 'shake'],
  ['ordinary hillside shake', 24, 28, false, 'shake'],
]) {
  const f = fixture();
  const fruit = f.detach(ground, release, cause);
  assert.equal(f.scoring.stuntsFor(fruit).includes('skyPick'), expected, label);
  assert.equal(f.emitted.filter(e => e.name === 'stunt:awarded').length, expected ? 1 : 0,
    `${label}: award event count`);
  checked++;
}

const f = fixture();
const high = f.detach(30, 39);
f.bus.emit('fruit:detached', { fruitId: high.id, cause: 'hand', playerId: 27 });
assert.deepEqual(f.scoring.stuntsFor(high), ['skyPick'], 'duplicate detach cannot stack SKY PICK');
assert.equal(f.scoring.totalAwarded, 1, 'one award for repeated notification');
assert.equal(f.scoring.bestMultiplier, 1.35, 'existing bonus is preserved');
assert.equal(STUNTS.skyPick.bonus, 0.35);
assert.equal(f.emitted.filter(e => e.name === 'stunt:awarded').length, 1);
// Stunt history still uses the established save shape.
const saved = f.scoring.serialize();
const restored = fixture().scoring;
restored.deserialize(saved);
assert.deepEqual(restored.serialize(), saved, 'save history round-trip stays compatible');
checked += 2;

console.log(`SKY PICK: ${checked} regression cases passed (local height, tools, water, deduplication, save history).`);
