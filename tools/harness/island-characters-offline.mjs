/** CPU-only character regression fixtures. Run from the project root. */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const bundle = await build({ entryPoints: ['src/world/IslandCharacters.ts'], bundle: true,
  platform: 'node', format: 'cjs', packages: 'external', write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { IslandCharacters } = module.exports;
const results = [], activeFixtures = [];
function check(name, fn) {
  try { fn(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: String(error.stack || error) }); }
  finally { for (const f of activeFixtures.splice(0)) f.c.dispose(); }
}
function fixture() {
  const events = [], handlers = new Map(), actions = new Map(), impulses = [];
  const candidate = { id: 42, state: 'free', species: 'apple', body: {}, stuck: false,
    stuckHands: 0, heldBy: -1, restraint: 0, mass: 2, speed: 0, destroyed: false,
    radius: .4, position: new THREE.Vector3(-15, 7.9, 26),
    applyImpulse(v) { impulses.push(v.clone()); } };
  const fruit = { authoritative: true, fruits: new Map([[42, candidate]]), get(id) { return this.fruits.get(id); } };
  const player = { position: new THREE.Vector3(-10, 7.5, 20) };
  const director = { presentation: { id: 0, kind: null, phase: 'idle', result: '' },
    crew() { return [{ position: player.position, busy: false }]; }, getPresentation() { return this.presentation; } };
  const systems = { fruit, director, world: { terrain: { height: () => 7.5 },
    sellPad: new THREE.Vector3(40, 7.5, 54), sellRadius: 3.2 }, ropes: { ropes: new Map() } };
  const g = { player, clock: { elapsed: 0 }, renderer: { scene: new THREE.Scene() },
    has: n => n in systems, get: n => systems[n],
    debug: { addProbe() {}, addAction(n, f) { actions.set(n, f); } },
    bus: { on(n, f) { const a = handlers.get(n) || []; a.push(f); handlers.set(n, a);
      return () => handlers.set(n, a.filter(x => x !== f)); },
    emit(n, p) { events.push([n, p]); for (const f of handlers.get(n) || []) f(p); } } };
  const c = new IslandCharacters(); c.init(g);
  function step(seconds) { for (let i = 0; i < Math.ceil(seconds * 60); i++) {
    g.clock.elapsed += 1 / 60; c.fixedStep(1 / 60); c.frameUpdate(1 / 60);
  } }
  const f = { c, g, fruit, player, director, candidate, events, actions, impulses, systems, step };
  activeFixtures.push(f); return f;
}

check('King conclusion precedes arrival greeting', () => {
  const f = fixture(); f.g.bus.emit('legendary:complete', {}); f.player.position.copy(f.c.mervAt);
  f.c.frameUpdate(.016); assert.match(f.c.caption.text, /smaller melon/); assert.deepEqual([...f.c.talkSeen], [10]);
});
for (const result of ['over', 'cancelled']) check(`No stale warning for ${result}`, () => {
  const f = fixture(); f.player.position.copy(f.c.mervAt); f.c.nearBefore = true;
  f.director.presentation = { id: 1, kind: 'windfall', phase: 'result', result };
  f.c.frameUpdate(.016); assert.equal(f.c.caption.text, '');
});
check('Active rush order has contextual Merv line', () => {
  const f = fixture(); f.player.position.copy(f.c.mervAt); f.c.nearBefore = true;
  f.director.presentation = { id: 1, kind: 'order', phase: 'active', result: '' };
  f.c.frameUpdate(.016); assert.match(f.c.caption.text, /Customer says urgent/);
});
check('Tree warning has Merv duck caption', () => {
  const f = fixture(); f.player.position.copy(f.c.mervAt); f.c.nearBefore = true;
  f.director.presentation = { id: 1, kind: 'windfall', phase: 'warning', result: '' };
  f.c.frameUpdate(.016); assert.match(f.c.caption.text, /Duck/);
});
check('Malformed snapshots ignored without throwing', () => {
  const f = fixture(), before = f.c.netState();
  for (const s of [{}, { ...before, from: null }, { ...before, to: [1, 2] },
    { ...before, from: [1, NaN, 2] }, { ...before, cycle: NaN }]) f.c.applyNet(s);
  assert.deepEqual(f.c.netState(), before);
});
check('Single peck bounded below .828 m/s and two transition cues', () => {
  const f = fixture(); assert.equal(f.actions.get('characters.startGull')(42), true); f.step(7);
  assert.equal(f.impulses.length, 1); assert.ok(f.impulses[0].length() / f.candidate.mass < .828);
  assert.equal(f.events.filter(e => e[0] === 'audio:sfx' && e[1].name === 'gullSquawk').length, 2);
});
check('Forty-five second cooldown prevents another automatic approach', () => {
  const f = fixture(); f.actions.get('characters.startGull')(42);
  assert.equal(f.c.netState().cooldown, 45); f.step(44);
  assert.equal(f.impulses.length, 1); assert.equal(f.c.netState().phase, 'perched');
  assert.ok(f.c.netState().cooldown > .99);
  f.step(2); assert.equal(f.c.netState().phase, 'approach');
  f.step(4); assert.equal(f.impulses.length, 2);
});
check('Replica never touches physics', () => {
  const h = fixture(); h.actions.get('characters.startGull')(42);
  const f = fixture(); f.fruit.authoritative = false; f.c.applyNet(h.c.netState()); f.step(7);
  assert.equal(f.impulses.length, 0);
});
check('Mirrored host migration preserves used peck latch', () => {
  const h = fixture(); h.actions.get('characters.startGull')(42); h.step(3.3); assert.equal(h.impulses.length, 1);
  const f = fixture(); f.c.applyNet(h.c.netState()); f.step(7); assert.equal(f.impulses.length, 0);
});
check('Pickup aborts pending peck', () => {
  const f = fixture(); f.actions.get('characters.startGull')(42); f.step(1);
  f.candidate.state = 'carried'; f.step(5);
  assert.equal(f.impulses.length, 0); assert.equal(f.c.stats.aborted, 1);
});
for (const species of ['banana', 'coconut']) check(`Gull excludes ${species}`, () => {
  const f = fixture(); f.candidate.species = species;
  assert.equal(f.actions.get('characters.startGull')(42), false);
});
check('Gull excludes active rope attachments', () => {
  const f = fixture(); f.systems.ropes.ropes.set(1, { a: { kind: 'fruit', ownerId: 42 }, b: { kind: 'world' } });
  assert.equal(f.actions.get('characters.startGull')(42), false);
});
check('Gull yields to approaching player', () => {
  const f = fixture(); f.actions.get('characters.startGull')(42); f.step(1);
  f.player.position.copy(f.candidate.position); f.step(4); assert.equal(f.impulses.length, 0);
});
check('Gull rejects steep rim', () => {
  const f = fixture(); f.systems.world.terrain.height = (x, z) => x > -14 ? 0 : 7.5;
  assert.equal(f.actions.get('characters.startGull')(42), false);
});
check('Twelve session-unique captions each have a mutter', () => {
  const f = fixture();
  for (let i = 0; i < 12; i++) assert.equal(f.actions.get('characters.speak')(i), true);
  for (let i = 0; i < 12; i++) assert.equal(f.actions.get('characters.speak')(i), false);
  assert.equal(f.events.filter(e => e[0] === 'audio:sfx' && e[1].name === 'mervMutter').length, 12);
});
check('Duck animates during speech cooldown', () => {
  const f = fixture(); f.actions.get('characters.speak')(0);
  f.g.bus.emit('tool:blast', { point: f.c.mervAt.clone() }); f.c.frameUpdate(.016);
  assert.ok(f.c.head.position.y < 1.63); assert.ok(f.c.merv.scale.y < .9);
  assert.ok(f.c.arms.every(a => a.rotation.x < -.5));
});
check('Snapshot replay cannot duplicate a squawk', () => {
  const f = fixture(); f.actions.get('characters.startGull')(42); f.c.frameUpdate(.016);
  const s = f.c.netState(); for (let i = 0; i < 4; i++) { f.c.applyNet(s); f.c.frameUpdate(.016); }
  assert.equal(f.events.filter(e => e[0] === 'audio:sfx' && e[1].name === 'gullSquawk').length, 1);
});

check('Exceptional sale line requires an observed valuable batch', () => {
  const f = fixture(); f.player.position.copy(f.c.mervAt);
  f.g.bus.emit('fruit:sold', { value: 80 }); f.g.bus.emit('fruit:sold', { value: 80 });
  f.c.frameUpdate(.016); assert.match(f.c.caption.text, /paid for the sign/);
  const ordinary = fixture(); ordinary.player.position.copy(ordinary.c.mervAt);
  ordinary.g.bus.emit('fruit:sold', { value: 12 }); ordinary.c.frameUpdate(.016);
  assert.match(ordinary.c.caption.text, /Stock that cannot walk/);
});

check('Idle resident watches, hops and preens without moving fruit', () => {
  const f = fixture(); f.fruit.fruits.clear();
  f.step(3.2);
  assert.ok(f.c.gull.position.y > f.c.home.y + .1);
  assert.ok(Math.abs(f.c.gullHead.rotation.y) > .1);
  f.step(8.2); assert.equal(f.c.gullHead.rotation.x, .75);
  assert.equal(f.impulses.length, 0);
});
check('Inspection lap returns to supported perch without consuming theft cooldown', () => {
  const f = fixture(); f.fruit.fruits.clear(); f.step(20);
  assert.equal(f.c.netState().phase, 'return');
  assert.ok(f.c.gull.position.distanceTo(f.c.home) > 1);
  assert.equal(f.c.netState().cooldown, 0);
  f.step(3); assert.equal(f.c.netState().phase, 'perched');
  assert.ok(f.c.gull.position.distanceTo(f.c.home) < .001);
  assert.equal(f.impulses.length, 0);
});
check('Replica and promoted host preserve inspection lap without a fruit peck', () => {
  const host = fixture(); host.fruit.fruits.clear(); host.step(20);
  const replica = fixture(); replica.fruit.authoritative = false; replica.fruit.fruits.clear();
  replica.c.applyNet(host.c.netState()); replica.c.frameUpdate(0);
  assert.ok(replica.c.gull.position.distanceTo(host.c.gull.position) < .0001);
  replica.fruit.authoritative = true; replica.step(3);
  assert.equal(replica.c.netState().phase, 'perched'); assert.equal(replica.impulses.length, 0);
});
check('Nearby player causes a visible retreat with a forty-five second cooldown', () => {
  const f = fixture(); f.fruit.fruits.clear();
  f.player.position.copy(f.c.home); f.step(12.1);
  assert.equal(f.c.netState().phase, 'scared'); assert.equal(f.c.stats.scares, 1);
  assert.ok(f.c.netState().cooldown > 44);
  f.step(8); assert.equal(f.c.stats.scares, 1); assert.equal(f.impulses.length, 0);
});
check('Gull never touches basket fruit or sell-pad stock', () => {
  const f = fixture(); f.candidate.state = 'basket';
  assert.equal(f.actions.get('characters.startGull')(42), false);
  f.candidate.state = 'free'; f.systems.world.sellPad.copy(f.candidate.position);
  assert.equal(f.actions.get('characters.startGull')(42), false);
});

const report = { timestamp: new Date().toISOString(),
  scope: 'CPU fixtures with mock world and physics. No GPU, rendered assessment, or real transport migration.',
  passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results };
await mkdir('capture/staging-qa', { recursive: true });
await writeFile('capture/staging-qa/island-characters-offline.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
