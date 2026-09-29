import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { Progression } = await importBundled('src/systems/Progression.ts', 'chapter-flow');

function fixture() {
  const handlers = new Map();
  const events = [];
  const dock = new THREE.Vector3(60, 2, 70);
  const flags = [];
  const world = { spawnPoint: dock, setNextIslandOpen: open => flags.push(open),
    setExpeditionStage: stage => flags.push(stage) };
  const legendary = { phase: 'prepare', lastPayout: 9500, position: new THREE.Vector3(-6, 7, -69) };
  const economy = { money: 10400, lifetimeEarned: 11200, fruitSold: 32, bestSale: 480 };
  const save = { enabled: true, playtime: 1800, writes: 0, save() { this.writes++; return true; } };
  const net = { connected: false, authoritative: true, hostId: 'host-a', requests: 0,
    requestSettlement() { this.requests++; } };
  const encounters = { restored: [], restoreCleared(kinds) { this.restored.push([...kinds]); } };
  const kingVine = { subdued: false, restores: 0, restoreSubdued() { this.subdued = true; this.restores++; } };
  const g = {
    clock: { elapsed: 1620 }, player: { position: new THREE.Vector3(0, 2, 0), state: 'active' },
    bus: {
      on(name, fn) { const fns = handlers.get(name) ?? []; fns.push(fn); handlers.set(name, fns); },
      emit(name, payload) { events.push({ name, payload }); for (const fn of handlers.get(name) ?? []) fn(payload); },
    },
    has(name) { return ['legendary', 'save', 'net', 'book', 'encounters', 'tools', 'kingVine'].includes(name); },
    get(name) {
      if (name === 'world') return world;
      if (name === 'legendary') return legendary;
      if (name === 'economy') return economy;
      if (name === 'save') return save;
      if (name === 'net') return net;
      if (name === 'book') return { discoveredCount: 6 };
      if (name === 'encounters') return encounters;
      if (name === 'kingVine') return kingVine;
      if (name === 'tools') return { owned: new Set() };
      throw new Error(`unexpected ${name}`);
    },
  };
  const progress = new Progression(); progress.init(g);
  return { progress, g, world, legendary, economy, save, net, encounters, kingVine, events, flags, dock };
}

test('King Melon extraction asks for a real dock return without claiming a second island', () => {
  const f = fixture();
  f.legendary.phase = 'complete';
  f.g.bus.emit('legendary:complete', { id: 'kingMelon', payout: 9500 });
  assert.equal(f.progress.chapterState, 'return');
  assert.match(f.progress.objective, /return.*dock/i);
  assert.doesNotMatch(f.progress.objective, /Gale Grove|next island/i);
  assert.equal(f.economy.money, 10400);
  assert.equal(f.progress.serialize().chapterState, 'return');
  assert.equal(f.flags.at(-1), 'return');
});

test('only an explicit dock interaction settles once, saves results and leaves the bank unchanged', () => {
  const f = fixture();
  f.legendary.phase = 'complete';
  f.g.bus.emit('legendary:complete', { id: 'kingMelon', payout: 9500 });
  assert.equal(f.progress.settleAtDock(), false);
  f.g.player.position.copy(f.dock).add(new THREE.Vector3(-5, 0, 0));
  assert.equal(f.progress.isAtDock(f.g.player.position), true);
  assert.equal(f.progress.settleAtDock(), true);
  assert.equal(f.progress.settleAtDock(), false);
  assert.equal(f.progress.chapterState, 'settled');
  assert.equal(f.progress.results.payout, 9500);
  assert.equal(f.progress.results.fruitSold, 32);
  assert.equal(f.progress.results.discovered, 6);
  assert.equal(f.economy.money, 10400);
  assert.equal(f.save.writes, 1);
  assert.equal(f.flags.at(-1), 'settled');
  assert.equal(f.events.filter(e => e.name === 'expedition:settled').length, 1);
  assert.match(f.progress.objective, /complete|settled/i);
});

test('old extracted saves migrate to return phase and silently restore defeated encounters', () => {
  const f = fixture();
  f.legendary.phase = 'complete';
  f.progress.deserialize({ islands: ['sunpatch', 'galegrove'], threatsCleared: ['mimic', 'snapjaw'] });
  assert.equal(f.progress.chapterState, 'return');
  assert.deepEqual(f.encounters.restored, [['mimic', 'snapjaw']]);
  assert.equal(f.kingVine.restores, 1);
  assert.equal(f.save.writes, 0);
  assert.equal(f.events.filter(e => e.name === 'expedition:settled').length, 0);
  assert.match(f.progress.objective, /return.*dock/i);
});

test('saved King Vine victory remains subdued after reload without paying or emitting a new win', () => {
  const f = fixture();
  f.progress.deserialize({ kingVineDefeated: true });
  assert.equal(f.kingVine.restores, 1);
  assert.equal(f.kingVine.subdued, true);
  assert.equal(f.events.filter(e => e.name === 'kingVine:subdued').length, 0);
  assert.equal(f.save.writes, 0);
  assert.equal(f.progress.serialize().kingVineDefeated, true);
});

test('client dock action requests the host; live settled snapshot opens results but joined state does not', () => {
  const f = fixture();
  f.net.connected = true; f.net.authoritative = false;
  f.legendary.phase = 'complete';
  f.g.bus.emit('legendary:complete', { id: 'kingMelon', payout: 9500 });
  f.g.player.position.copy(f.dock);
  assert.equal(f.progress.settleAtDock(), false);
  assert.equal(f.net.requests, 1);
  assert.equal(f.progress.chapterState, 'return');
  f.progress.applyChapterState({ state: 'settled', results: { payout: 9500, fruitSold: 32, discovered: 6 } });
  assert.equal(f.progress.chapterState, 'settled');
  assert.equal(f.events.filter(e => e.name === 'expedition:settled').length, 0);

  const live = fixture();
  live.net.connected = true; live.net.authoritative = false;
  live.legendary.phase = 'complete';
  live.progress.applyChapterState({ state: 'return', results: null });
  live.progress.applyChapterState({ state: 'settled', results: { payout: 9500, fruitSold: 32, discovered: 6 } });
  live.progress.applyChapterState({ state: 'settled', results: { payout: 9500, fruitSold: 32, discovered: 6 } });
  assert.equal(live.events.filter(e => e.name === 'expedition:settled').length, 1);
});
