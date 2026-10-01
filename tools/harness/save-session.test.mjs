import test from 'node:test';
import assert from 'node:assert/strict';
import { importBundled } from './import-bundled.mjs';

const { SaveSystem } = await importBundled('src/save/SaveSystem.ts', 'save-session');

function fixture(search = '') {
  const data = new Map();
  const listeners = new Map();
  globalThis.localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  };
  globalThis.window = {
    location: { search },
    addEventListener: (name, fn) => listeners.set(name, fn),
  };
  const system = {
    name: 'economy', value: 0,
    serialize() { return { money: this.value }; },
    deserialize(d) { this.value = d.money ?? 0; },
  };
  const g = { systems: [system], clock: { paused: false }, bus: { emit() {} } };
  return { data, listeners, system, g };
}

test('legacy auto save remains the default continue slot', () => {
  const f = fixture();
  f.data.set('riperiot.save.auto', JSON.stringify({ version: 1, savedAt: 1,
    playtime: 12, island: 'sunpatch', systems: { economy: { money: 230 } } }));
  const save = new SaveSystem();
  save.init(f.g);
  assert.equal(save.slot, 'auto');
  assert.equal(save.resumed, true);
  assert.equal(f.system.value, 230);
  f.system.value = 250;
  f.listeners.get('beforeunload')();
  assert.equal(JSON.parse(f.data.get('riperiot.save.auto')).systems.economy.money, 250);
});

test('diagnostic fresh boots cannot auto-write the primary slot, but explicit fixture saves work', () => {
  const f = fixture('?fresh');
  f.data.set('riperiot.save.auto', JSON.stringify({ version: 1, savedAt: 1,
    playtime: 0, island: 'sunpatch', systems: { economy: { money: 500 } } }));
  const save = new SaveSystem();
  save.init(f.g);
  assert.equal(save.resumed, false);
  assert.equal(f.system.value, 0);
  f.system.value = 12;
  save.frameUpdate(90);
  f.listeners.get('beforeunload')();
  assert.equal(JSON.parse(f.data.get('riperiot.save.auto')).systems.economy.money, 500);
  assert.equal(save.save('fixture'), true);
  assert.equal(JSON.parse(f.data.get('riperiot.save.fixture')).systems.economy.money, 12);
});

test('new replay is a unique active slot and never replaces auto or an earlier replay', () => {
  const f = fixture();
  f.data.set('riperiot.save.auto', JSON.stringify({ version: 1, savedAt: 1,
    playtime: 2, island: 'sunpatch', systems: { economy: { money: 700 } } }));
  const first = new SaveSystem(); first.init(f.g);
  const replayA = first.createReplaySlot();
  assert.match(replayA, /^replay-/);
  assert.equal(first.activateSlot(replayA), true);
  assert.equal(first.slot, 'auto'); // current tab still saves its own run on unload
  f.system.value = 0;
  const second = new SaveSystem(); second.init(f.g);
  assert.equal(second.slot, replayA);
  assert.equal(second.resumed, false);
  f.system.value = 42;
  assert.equal(second.save(), true);
  const replayB = second.createReplaySlot();
  assert.notEqual(replayB, replayA);
  assert.equal(second.activateSlot(replayB), true);
  f.system.value = 0;
  const third = new SaveSystem(); third.init(f.g);
  assert.equal(third.slot, replayB);
  assert.equal(third.resumed, false);
  assert.equal(JSON.parse(f.data.get(`riperiot.save.${replayA}`)).systems.economy.money, 42);
  assert.equal(JSON.parse(f.data.get('riperiot.save.auto')).systems.economy.money, 700);
  assert.equal(third.activateSlot('auto'), true);
  f.system.value = 0;
  const original = new SaveSystem(); original.init(f.g);
  assert.equal(original.resumed, true);
  assert.equal(f.system.value, 700);
});

test('a solo title or pause menu does not count playtime or autosave', () => {
  const f = fixture();
  const save = new SaveSystem(); save.init(f.g);
  f.g.clock.paused = true;
  f.system.value = 15;
  save.frameUpdate(90);
  assert.equal(save.playtime, 0);
  assert.equal(f.data.has('riperiot.save.auto'), false);
  f.g.clock.paused = false;
  save.frameUpdate(45);
  assert.equal(save.playtime, 45);
  assert.equal(f.data.has('riperiot.save.auto'), true);
});

test('closing a first-visit title does not create a fake Continue save', () => {
  const f = fixture();
  const save = new SaveSystem(); save.init(f.g);
  f.g.clock.paused = true;
  save.frameUpdate(1);
  f.listeners.get('beforeunload')();
  assert.equal(f.data.has('riperiot.save.auto'), false);

  f.g.clock.paused = false;
  save.frameUpdate(0.016);
  f.listeners.get('beforeunload')();
  assert.equal(f.data.has('riperiot.save.auto'), true);
});

test('orchard storage and replay selection cannot read or overwrite the expedition namespace', () => {
  const f = fixture();
  f.data.set('riperiot.save.auto', JSON.stringify({ version: 1, savedAt: 1, playtime: 20,
    systems: { economy: { money: 9500 } } }));
  f.data.set('riperiot.save.activeSlot', 'replay-expedition-existing');
  const orchard = new SaveSystem({ namespace: 'orchard-v1' }); orchard.init(f.g);
  assert.equal(orchard.resumed, false);
  assert.equal(orchard.slot, 'auto');
  assert.equal(f.system.value, 0);
  f.system.value = 125;
  orchard.save();
  const replay = orchard.createReplaySlot(); orchard.activateSlot(replay);
  assert.equal(f.data.get('riperiot.save.activeSlot'), 'replay-expedition-existing');
  assert.equal(JSON.parse(f.data.get('riperiot.save.auto')).systems.economy.money, 9500);
  assert.equal(JSON.parse(f.data.get('riperiot.orchard-v1.save.auto')).systems.economy.money, 125);
  const reload = new SaveSystem({ namespace: 'orchard-v1' }); reload.init(f.g);
  assert.equal(reload.slot, replay);
});
