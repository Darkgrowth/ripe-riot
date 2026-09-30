import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { IslandDirector } = await importBundled('src/systems/IslandDirector.ts', 'harvest-agitation-director');
const { IslandEventView } = await importBundled('src/ui/IslandEventView.ts', 'harvest-agitation-view');
const orchard = new THREE.Vector3(-24, 2, 22);
const hill = new THREE.Vector3(-36, 2, -30);

function fixture(fruitCount = 4) {
  const events = [];
  const progress = { chapterState: 'active' };
  const fruit = { authoritative: true, fruits: new Map(), plants: new Map(),
    get(id) { return this.fruits.get(id); },
    detach(f) { f.state = 'free'; } };
  fruit.plants.all = () => fruit.plants.values();
  for (let i = 0; i < fruitCount; i++) {
    const position = orchard.clone().add(new THREE.Vector3(i, 2, 1));
    fruit.fruits.set(i + 1, { id: i + 1, species: 'apple', state: 'attached', position,
      attach: { plantId: i + 1 } });
    fruit.plants.set(i + 1, { position, shake: 0 });
  }
  const world = { shopCounter: new THREE.Vector3(45, 0, 52), sellPad: new THREE.Vector3(58, 0, 62),
    terrain: { height: () => 2 },
    at(id) { return { position: id === 'orchard' ? orchard : hill }; } };
  const director = new IslandDirector();
  director.fruit = fruit; director.world = world;
  director.g = {
    seed: 1, player: { position: orchard.clone(), state: 'active' },
    input: { pointerLocked: true, synthetic: false },
    bus: { emit(name, payload) { events.push({ name, payload }); } },
    has: name => name === 'progress',
    get(name) {
      if (name === 'net') return { connected: false };
      if (name === 'legendary') return { phase: 'prepare', tethers: [] };
      if (name === 'tools') return { owned: new Set() };
      if (name === 'ropes') return { ropes: new Map() };
      if (name === 'progress') return progress;
      throw new Error(`unexpected ${name}`);
    },
  };
  return { director, fruit, progress, events };
}

test('an ordinary first apple and idle time do not schedule a windfall', () => {
  const { director } = fixture();
  director.state.firstPick = true;
  director.fixedStep(30);
  assert.equal(director.getPresentation().phase, 'idle');
  assert.equal(director.getAgitationPresentation().pressure, 0);
});

test('accepted unique local actions warn, then select a real fruit group for a told windfall', () => {
  const { director, fruit, events } = fixture();
  assert.equal(director.acceptAgitation('site:1', 'site-disturbance', orchard), true);
  assert.equal(director.acceptAgitation('site:1', 'site-disturbance', orchard), false);
  assert.equal(director.getAgitationPresentation().warning, true);
  assert.equal(director.getPresentation().phase, 'idle');
  director.frameUpdate(0.016);
  assert.ok([...fruit.plants.values()].some(plant => plant.shake > 0));
  assert.ok(events.some(event => event.name === 'audio:sfx' && event.payload.name === 'rustle'));
  assert.equal(director.acceptAgitation('shake:1', 'tree-shaker', orchard), true);
  director.fixedStep(0.016);
  assert.equal(director.getPresentation().kind, 'windfall');
  assert.equal(director.getPresentation().phase, 'warning');
  assert.equal(director.getPresentation().targets.length, 4);
  assert.equal(director.getAgitationPresentation().pressure, 0);
});

test('remote, dock, invalid and duplicate actions cannot raise pressure', () => {
  const { director, fruit } = fixture();
  fruit.authoritative = false;
  assert.equal(director.acceptAgitation('remote:1', 'site-disturbance', orchard), false);
  fruit.authoritative = true;
  assert.equal(director.acceptAgitation('dock:1', 'site-disturbance', new THREE.Vector3(58, 0, 62)), false);
  assert.equal(director.acceptAgitation('', 'site-disturbance', orchard), false);
  assert.equal(director.acceptAgitation('bad:1', 'site-disturbance', new THREE.Vector3(NaN, 0, 0)), false);
  assert.equal(director.getAgitationPresentation().pressure, 0);
});

test('hill farm pressure selects nearby hill fruit rather than a distant orchard group', () => {
  const { director, fruit } = fixture();
  director.g.player.position.copy(hill);
  for (const node of fruit.fruits.values()) node.position.copy(hill).add(new THREE.Vector3(node.id, 2, 1));
  assert.equal(director.acceptAgitation('hill:site', 'site-disturbance', hill), true);
  assert.equal(director.acceptAgitation('hill:shake', 'tree-shaker', hill), true);
  director.fixedStep(0.016);
  assert.equal(director.getPresentation().kind, 'windfall');
  assert.deepEqual(director.getPresentation().targets, [1, 2, 3, 4]);
});

test('a rush order keeps its timer and defers the agitation cue and windfall until it ends', () => {
  const { director, events } = fixture();
  assert.equal(director.start('order', true), true);
  assert.equal(director.acceptAgitation('site:1', 'site-disturbance', orchard), true);
  assert.equal(director.acceptAgitation('shake:1', 'tree-shaker', orchard), true);
  director.fixedStep(3);
  assert.equal(director.getPresentation().kind, 'order');
  assert.equal(director.getPresentation().phase, 'active');
  assert.equal(director.getPresentation().remaining, 87);
  assert.equal(director.getAgitationPresentation().warning, false);
  assert.equal(events.filter(event => event.name === 'island:event' && event.payload.kind === 'windfall').length, 0);
  director.fixedStep(87);
  director.fixedStep(6);
  director.fixedStep(0.016);
  assert.equal(director.getPresentation().kind, 'windfall');
  assert.equal(director.getPresentation().phase, 'warning');
});

test('no eligible fruit clears a pending burst instead of showing an invisible hazard', () => {
  const { director } = fixture(0);
  director.acceptAgitation('site:1', 'site-disturbance', orchard);
  director.acceptAgitation('shake:1', 'tree-shaker', orchard);
  director.fixedStep(0.016);
  assert.equal(director.getPresentation().phase, 'idle');
  assert.equal(director.getAgitationPresentation().pressure, 0);
  assert.equal(director.getAgitationPresentation().warning, false);
});

test('pressure decays and a completed burst enforces a quiet cooldown', () => {
  const { director } = fixture();
  director.acceptAgitation('site:1', 'site-disturbance', orchard);
  director.fixedStep(10);
  assert.ok(director.getAgitationPresentation().pressure < 3);
  assert.equal(director.getAgitationPresentation().warning, false);
  director.acceptAgitation('site:2', 'site-disturbance', orchard);
  director.acceptAgitation('shake:1', 'tree-shaker', orchard);
  director.fixedStep(0.016);
  director.fixedStep(8);
  director.fixedStep(18);
  director.fixedStep(6);
  assert.ok(director.netState().cooldown >= 120);
  assert.equal(director.acceptAgitation('site:3', 'site-disturbance', orchard), false);
});

test('finale and old saves clear or default agitation without replaying a warning', () => {
  const { director, progress } = fixture();
  director.acceptAgitation('site:1', 'site-disturbance', orchard);
  const saved = director.serialize();
  assert.ok(saved.agitation.pressure > 0);
  director.deserialize({ sequence: 3 });
  assert.deepEqual(director.getAgitationPresentation(), { pressure: 0, warning: false, at: [0, 0, 0], acceptedIds: [] });
  director.applyNet({ ...director.netState(), agitation: undefined });
  assert.equal(director.getAgitationPresentation().pressure, 0);
  director.deserialize(saved);
  assert.ok(director.getAgitationPresentation().pressure > 0);
  progress.chapterState = 'return';
  director.fixedStep(0.016);
  assert.equal(director.getAgitationPresentation().pressure, 0);
  assert.equal(director.acceptAgitation('site:2', 'site-disturbance', orchard), false);
});

test('the compact warning card appears only while agitation is visible and gives way to an order', () => {
  const { director, progress } = fixture();
  const view = new IslandEventView();
  view.hud = { hidden: true, classList: { toggle() {} } };
  view.title = { textContent: '' }; view.detail = { textContent: '' }; view.timer = { textContent: '' };
  view.marks = { visible: false }; view.leaves = { visible: false };
  view.g = { player: { position: orchard }, has: name => name === 'progress',
    get(name) {
      if (name === 'director') return director;
      if (name === 'progress') return progress;
      if (name === 'shop' || name === 'book') return { open: false };
      if (name === 'ui') return { celebrating: false };
      throw new Error(`unexpected ${name}`);
    } };
  director.acceptAgitation('site:1', 'site-disturbance', orchard);
  view.frameUpdate(0.016);
  assert.equal(view.hud.hidden, false);
  assert.match(view.title.textContent, /STIRRING/);
  assert.equal(view.timer.textContent, '');
  director.start('order', true);
  view.frameUpdate(0.016);
  assert.equal(view.title.textContent, 'MERV’S RUSH ORDER');
  progress.chapterState = 'return';
  view.frameUpdate(0.016);
  assert.equal(view.hud.hidden, true);
});
