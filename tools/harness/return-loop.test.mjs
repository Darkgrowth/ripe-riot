import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const [{ Progression }, { Shop }, { IslandDirector }] = await Promise.all([
  importBundled('src/systems/Progression.ts', 'return-loop-progression'),
  importBundled('src/systems/Shop.ts', 'return-loop-shop'),
  importBundled('src/systems/IslandDirector.ts', 'return-loop-director'),
]);

function progressFixture() {
  const handlers = new Map();
  const actions = new Map();
  const emitted = [];
  const owned = new Set();
  const economy = { money: 80 };
  const net = { hostId: 'host-a' };
  const g = {
    clock: { elapsed: 0 },
    bus: {
      on(name, fn) { const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list); },
      emit(name, payload) { emitted.push({ name, payload }); for (const fn of handlers.get(name) ?? []) fn(payload); },
    },
    debug: { addProbe() {}, addAction(name, fn) { actions.set(name, fn); } },
    has(name) { return name === 'tools' || name === 'net'; },
    get(name) {
      if (name === 'tools') return { owned };
      if (name === 'net') return net;
      if (name === 'economy') return economy;
      if (name === 'world') return { setNextIslandOpen() {} };
      throw new Error(`unexpected system ${name}`);
    },
  };
  const progress = new Progression();
  progress.init(g);
  const toasts = () => emitted.filter(e => e.name === 'ui:toast').map(e => e.payload);
  return { g, progress, owned, economy, net, actions, toasts };
}

test('Mimic victory offers an optional prize-to-cannon loop after the route update', () => {
  const { g, progress, toasts } = progressFixture();
  g.bus.emit('encounter:defeated', { kind: 'mimic' });
  assert.match(progress.objective, /Snapjaw/);
  assert.equal(toasts().length, 1);
  g.clock.elapsed = 4.2;
  progress.fixedStep(0.1);
  assert.match(toasts().at(-1).sub, /sell.*prize.*Air Cannon/i);
  assert.match(toasts().at(-1).text, /optional/i);
  g.clock.elapsed = 20;
  progress.fixedStep(0.1);
  assert.equal(toasts().length, 2);
});

test('a live client Mimic transition gets the same optional cue once', () => {
  const { g, progress, toasts } = progressFixture();
  progress.applyHostThreats([]); // first host snapshot is the session baseline
  progress.applyHostThreats(['mimic']);
  progress.applyHostThreats(['mimic']);
  assert.match(progress.objective, /Snapjaw/);
  g.clock.elapsed = 4.2;
  progress.fixedStep(0.1);
  assert.equal(toasts().filter(t => /^OPTIONAL/.test(t.text)).length, 1);
  g.clock.elapsed = 20;
  progress.fixedStep(0.1);
  assert.equal(toasts().filter(t => /^OPTIONAL/.test(t.text)).length, 1);
});

test('joining or changing hosts with Mimic already cleared does not replay its supply cue', () => {
  const { g, progress, net, toasts } = progressFixture();
  progress.applyHostThreats(['mimic']); // joined an already-progressed session
  g.clock.elapsed = 5;
  progress.fixedStep(0.1);
  assert.equal(toasts().filter(t => /^OPTIONAL/.test(t.text)).length, 0);

  progress.applyHostThreats([]);
  net.hostId = 'host-b';
  progress.applyHostThreats(['mimic']); // first picture from another host
  g.clock.elapsed = 10;
  progress.fixedStep(0.1);
  assert.equal(toasts().filter(t => /^OPTIONAL/.test(t.text)).length, 0);
});

test('buying the cannon suppresses stale Mimic advice and teaches ranged combat plus fruit freight', () => {
  const { g, progress, owned, toasts } = progressFixture();
  g.bus.emit('encounter:defeated', { kind: 'mimic' });
  owned.add('aircannon');
  g.bus.emit('shop:purchased', { itemId: 'aircannon' });
  g.clock.elapsed = 8;
  progress.fixedStep(0.1);
  assert.equal(toasts().filter(t => /prize.*sell/i.test(t.sub ?? '')).length, 0);
  assert.match(toasts().at(-1).sub, /Spitter|King Vine/i);
  assert.match(toasts().at(-1).sub, /deflect|shot/i);
  assert.match(toasts().at(-1).sub, /fruit|sell pad/i);
  assert.match(toasts().at(-1).sub, /LMB.*release.*RMB.*launch/i);
});

test('an already affordable cannon gets a buy cue, and cleared Spitter suppresses late supply advice', () => {
  const affordable = progressFixture();
  affordable.g.bus.emit('encounter:defeated', { kind: 'mimic' });
  affordable.economy.money = 185;
  affordable.g.clock.elapsed = 4.2;
  affordable.progress.fixedStep(0.1);
  assert.match(affordable.toasts().at(-1).sub, /Air Cannon.*shed/i);
  assert.doesNotMatch(affordable.toasts().at(-1).sub, /sell.*prize/i);

  const cleared = progressFixture();
  cleared.g.bus.emit('encounter:defeated', { kind: 'mimic' });
  cleared.g.bus.emit('encounter:defeated', { kind: 'spitter' });
  cleared.g.clock.elapsed = 4.2;
  cleared.progress.fixedStep(0.1);
  assert.equal(cleared.toasts().filter(t => /^OPTIONAL/.test(t.text)).length, 0);
});

test('separate queued guidance survives a nearby purchase and loaded saves discard pending cues', () => {
  const { g, progress, toasts } = progressFixture();
  g.bus.emit('encounter:defeated', { kind: 'mimic' });
  g.bus.emit('shop:purchased', { itemId: 'net' });
  g.clock.elapsed = 5;
  progress.fixedStep(0.1);
  assert.equal(toasts().filter(t => /^TRY THIS|^OPTIONAL/i.test(t.text)).length, 1);
  g.clock.elapsed = 13;
  progress.fixedStep(0.1);
  assert.equal(toasts().filter(t => /^TRY THIS|^OPTIONAL/i.test(t.text)).length, 2);

  const saved = progress.serialize();
  g.bus.emit('shop:purchased', { itemId: 'shaker' });
  progress.deserialize(saved);
  g.clock.elapsed = 30;
  progress.fixedStep(0.1);
  assert.equal(toasts().filter(t => /stand under a palm/i.test(t.text)).length, 0);
});

test('a purchase near the scheduled Mimic cue leaves its equipped toast room to finish', () => {
  const { g, progress, toasts } = progressFixture();
  g.bus.emit('encounter:defeated', { kind: 'mimic' });
  g.clock.elapsed = 3;
  g.bus.emit('shop:purchased', { itemId: 'net' });
  g.clock.elapsed = 4.2;
  progress.fixedStep(0.1);
  assert.equal(toasts().filter(t => /^OPTIONAL|^TRY THIS/.test(t.text)).length, 0);
  g.clock.elapsed = 7.5;
  progress.fixedStep(0.1);
  assert.equal(toasts().filter(t => /^OPTIONAL|^TRY THIS/.test(t.text)).length, 1);
});

test('a scenario reset drops pending guidance from the prior attempt', () => {
  const { g, progress, actions, toasts } = progressFixture();
  g.bus.emit('encounter:defeated', { kind: 'mimic' });
  actions.get('progress.reset')();
  g.clock.elapsed = 8;
  progress.fixedStep(0.1);
  assert.equal(toasts().filter(t => /^OPTIONAL/.test(t.text)).length, 0);
});

test('shop unlock states actual discovery points and both ways to earn them', () => {
  const shop = new Shop();
  shop.economy = { discoveryPoints: 68 };
  assert.match(shop.unlockText(1), /32.*POINT/i);
  assert.match(shop.unlockText(1), /fruit/i);
  assert.match(shop.unlockText(1), /variant/i);
  shop.economy.discoveryPoints = 100;
  assert.equal(shop.unlockText(1), 'UNLOCKED');
});

function directorFixture(position) {
  const director = new IslandDirector();
  director.fruit = { authoritative: true };
  director.world = {
    at() { return { position: new THREE.Vector3(-24, 0, 22) }; },
    sellPad: new THREE.Vector3(58, 0, 62),
    shopCounter: new THREE.Vector3(58, 0, 62),
  };
  director.g = {
    seed: 1,
    bus: { emit() {} },
    has() { return false; },
    player: { position, state: 'active' },
    get(name) {
      if (name === 'legendary') return { phase: 'idle', tethers: [] };
      if (name === 'tools') return { owned: new Set() };
      throw new Error(`unexpected system ${name}`);
    },
  };
  director.state.firstSale = true;
  return director;
}

test('automatic rush orders wait for an active crew member near orchard or dock; forced debug can start anywhere', () => {
  const ridge = directorFixture(new THREE.Vector3(0, 0, -78));
  assert.equal(ridge.start('order'), false);
  assert.equal(ridge.start('order', true), true);
  const orchard = directorFixture(new THREE.Vector3(-24, 0, 22));
  assert.equal(orchard.start('order'), true);
  const dock = directorFixture(new THREE.Vector3(58, 0, 62));
  assert.equal(dock.start('order'), true);
  const coop = directorFixture(new THREE.Vector3(0, 0, -78));
  coop.g.has = name => name === 'net';
  coop.g.get = name => name === 'net' ? { activityCrew: () => [
    { position: new THREE.Vector3(0, 0, -78), busy: false, hasNet: false },
    { position: new THREE.Vector3(-24, 0, 22), busy: false, hasNet: false },
  ] } : { phase: 'idle', tethers: [] };
  assert.equal(coop.start('order'), true);
});
