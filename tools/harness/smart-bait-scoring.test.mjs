import test from 'node:test';
import assert from 'node:assert/strict';
import { importBundled } from './import-bundled.mjs';

const { HarvestScoring } = await importBundled('src/systems/HarvestScoring.ts', 'smart-bait-scoring');

function fixture(authoritative = true) {
  const handlers = new Map(), events = [];
  const fruit = { id: 12, state: 'free', destroyed: false, detachedAt: -1 };
  const fruitSys = { authoritative, get: id => id === fruit.id ? fruit : undefined };
  const g = {
    bus: { on: (key, fn) => handlers.set(key, fn), emit: (key, data) => events.push({ key, data }) },
    get: key => key === 'fruit' ? fruitSys : key === 'ropes' ? { attachedTo: () => [] } : {},
    debug: null,
  };
  const scoring = new HarvestScoring();
  scoring.init(g);
  const bait = id => handlers.get('encounter:baited')?.({ kind: 'snapjaw', fruitId: id, actorId: 'crew' });
  return { scoring, fruit, fruitSys, events, bait };
}

test('successful physical bait adds value to that fruit once, including repeated throws', () => {
  const f = fixture();
  f.bait(12); f.bait(12);
  assert.equal(f.scoring.multiplierFor(f.fruit), 1.5);
  assert.deepEqual(f.scoring.stuntsFor(f.fruit), ['smartBait']);
  assert.equal(f.scoring.totalAwarded, 1);
  assert.equal(f.events.filter(e => e.key === 'stunt:awarded').length, 1);
  assert.equal(f.events.some(e => e.key === 'money:changed'), false, 'bank the bonus only on sale');
});

test('client presentation cannot award a local bait multiplier', () => {
  const f = fixture(false);
  f.bait(12);
  assert.equal(f.scoring.multiplierFor(f.fruit), 1);
  assert.equal(f.scoring.totalAwarded, 0);
});

test('missing or removed fruit cannot collect a bait reward', () => {
  const f = fixture();
  f.bait(99);
  f.fruit.state = 'gone'; f.bait(12);
  f.fruit.state = 'free'; f.fruit.destroyed = true; f.bait(12);
  assert.equal(f.scoring.totalAwarded, 0);
});

test('host-confirmed bait value survives promotion without fanfare, money or repeat reward', () => {
  const host = fixture(), client = fixture(false);
  host.bait(12);
  client.scoring.applyBaitState(host.scoring.baitState());
  client.scoring.applyBaitState(host.scoring.baitState());
  assert.equal(client.scoring.multiplierFor(client.fruit), 1.5);
  assert.equal(client.scoring.totalAwarded, 0);
  assert.equal(client.events.length, 0);
  client.fruitSys.authoritative = true;
  client.bait(12);
  assert.equal(client.scoring.multiplierFor(client.fruit), 1.5);
  assert.equal(client.events.length, 0);
  client.scoring.applyBaitState([]);
  assert.equal(client.scoring.multiplierFor(client.fruit), 1.5, 'replicas cannot overwrite the host ledger');
});

test('a new host snapshot removes stale bait credit and accepts only live known fruit IDs', () => {
  const client = fixture(false);
  client.scoring.award(client.fruit, 'midAir');
  client.scoring.applyBaitState([12, 12, 99, '12', null]);
  assert.equal(client.scoring.multiplierFor(client.fruit), 2.05);
  client.scoring.applyBaitState([]);
  assert.equal(client.scoring.multiplierFor(client.fruit), 1.55);
  assert.deepEqual(client.scoring.stuntsFor(client.fruit), ['midAir']);
  client.fruit.state = 'gone';
  client.scoring.applyBaitState([12]);
  assert.deepEqual(client.scoring.baitState(), []);
});
