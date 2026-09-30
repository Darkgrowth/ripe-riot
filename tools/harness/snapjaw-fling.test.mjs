import test from 'node:test';
import assert from 'node:assert/strict';
import { importBundled } from './import-bundled.mjs';

const { EncounterModel } = await importBundled('src/enemies/EncounterModel.ts', 'snapjaw-fling');
const { EncounterSystem } = await importBundled('src/enemies/EncounterSystem.ts', 'snapjaw-fling-system');

function capturedModel(withAlly = false) {
  const model = new EncounterModel([{ kind: 'snapjaw', position: [0, 0, 0] }], () => 0);
  model.setTargets([{ id: 'victim', position: [0, 0, 1.6] },
    ...(withAlly ? [{ id: 'ally', position: [2.8, 0, 1.5] }] : [])]);
  let events = [];
  for (let i = 0; i < 32 && !model.isCaptured('victim'); i++) events.push(...model.step(.05));
  assert.equal(model.isCaptured('victim'), true, 'fixture must reach the jaw hold');
  return { model, events };
}

test('a held solo victim gets one numbered fling rather than a silent timeout', () => {
  const { model } = capturedModel();
  const events = [];
  for (let i = 0; i < 70; i++) events.push(...model.step(.05));
  const flings = events.filter(e => e.type === 'fling');
  assert.equal(flings.length, 1);
  assert.equal(flings[0].victimId, 'victim');
  assert.ok(Number.isSafeInteger(flings[0].flingId) && flings[0].flingId > 0);
  assert.equal(model.isCaptured('victim'), false);
  assert.equal(events.some(e => e.type === 'release' && e.victimId === 'victim'), false);
});

test('the hold advertises a teammate aim and restores that aim after promotion', () => {
  const { model } = capturedModel(true);
  const held = model.snapshot();
  const jaw = held.encounters.find(e => e.kind === 'snapjaw');
  assert.equal(jaw.capturedVictimId, 'victim');
  assert.ok(jaw.captureAim?.[0] > 1, 'jaw should visibly point toward the ally');
  const promoted = new EncounterModel([{ kind: 'snapjaw', position: [0, 0, 0] }]);
  assert.equal(promoted.applySnapshot(held), true);
  assert.deepEqual(promoted.get('snapjaw').captureAim, jaw.captureAim);
});

test('escape, rescue, and defeat each prevent the later fling', () => {
  for (const release of ['escape', 'rescue', 'defeat']) {
    const { model } = capturedModel(true);
    model.step(.4);
    if (release === 'escape') assert.equal(model.tryEscape('victim'), true);
    if (release === 'rescue') assert.equal(model.tryRescue('victim', 'ally'), true);
    if (release === 'defeat') {
      const hit = model.tryHit([0, 1.5, -2], [0, 0, 1], 'air', 'ally');
      assert.equal(hit?.defeated, true);
    }
    const later = [];
    for (let i = 0; i < 70; i++) later.push(...model.step(.05));
    assert.equal(later.filter(e => e.type === 'fling').length, 0, release);
  }
});

test('a nonlethal open-jaw strike frees the victim without a fling', () => {
  for (const strike of ['melee', 'air']) {
    const { model } = capturedModel();
    const hit = model.tryHit([0, 1.2, -2], [0, 0, 1], strike, 'ally');
    assert.equal(hit?.releasedVictimId, 'victim');
    assert.equal(hit?.defeated, strike === 'air');
    const later = [];
    for (let i = 0; i < 70; i++) later.push(...model.step(.05));
    assert.equal(later.filter(e => e.type === 'fling').length, 0);
  }
});

test('flight identity and remaining catch window survive host promotion', () => {
  const { model } = capturedModel();
  const events = [];
  for (let i = 0; i < 70; i++) events.push(...model.step(.05));
  const fling = events.find(e => e.type === 'fling');
  const snapshot = model.snapshot();
  assert.deepEqual(snapshot.flights.map(f => [f.victimId, f.flingId]),
    [['victim', fling.flingId]]);
  assert.ok(snapshot.flights[0].remaining > 0 && snapshot.flights[0].remaining <= 2);
  const promoted = new EncounterModel([{ kind: 'snapjaw', position: [0, 0, 0] }]);
  assert.equal(promoted.applySnapshot(snapshot), true);
  assert.equal(promoted.isFlying('victim', fling.flingId), true);
  assert.equal(promoted.finishFlight('victim', fling.flingId + 1), false);
  assert.equal(promoted.finishFlight('victim', fling.flingId), true);
  assert.equal(promoted.finishFlight('victim', fling.flingId), false);
});

test('newer fling release fences out a delayed captured snapshot', () => {
  const { model: host } = capturedModel();
  const stale = host.snapshot();
  const client = new EncounterModel([{ kind: 'snapjaw', position: [0, 0, 0] }]);
  assert.equal(client.applySnapshot(stale), true);
  assert.equal(client.releaseFromFling('victim', 1, stale.revision + 2), true);
  assert.equal(client.isCaptured('victim'), false);
  assert.equal(client.applySnapshot(stale), false);
  assert.equal(client.releaseFromFling('victim', 1, stale.revision + 2), false);
  assert.equal(client.releaseFromFling('victim', 2, stale.revision + 1), false);
});

test('a recent release gives the victim time to land before another bite', () => {
  const { model } = capturedModel();
  for (let i = 0; i < 49; i++) model.step(.05);
  assert.equal(model.isCaptured('victim'), false);
  const during = [];
  for (let i = 0; i < 42; i++) during.push(...model.step(.05));
  assert.equal(during.some(e => e.type === 'capture' && e.victimId === 'victim'), false);
  const snapshot = model.snapshot();
  assert.ok(snapshot.snapjawGrace?.some(g => g.victimId === 'victim'));
});

test('host net catch requires matching live flight and a nearby distinct rescuer', () => {
  const { model } = capturedModel(true);
  let fling;
  for (let i = 0; i < 70; i++) fling ??= model.step(.05).find(e => e.type === 'fling');
  const system = Object.create(EncounterSystem.prototype);
  system.model = model;
  system.currentTargets = [{ id: 'victim', position: [0, 0, 1.6] },
    { id: 'ally', position: [2.8, 0, 1.5] }, { id: 'far', position: [20, 0, 0] }];
  system.net = { authoritative: true };
  assert.equal(system.flyingVictim('victim', fling.flingId + 1), false);
  assert.equal(system.flyingVictim('victim', fling.flingId), true);
  assert.equal(system.tryNetCatch('victim', fling.flingId, 'victim'), false);
  assert.equal(system.tryNetCatch('victim', fling.flingId, 'far'), false);
  assert.equal(system.tryNetCatch('victim', fling.flingId, 'ally'), true);
  assert.equal(system.tryNetCatch('victim', fling.flingId, 'ally'), false);
});

test('the host aims one finite peer launch at checked dry ground', () => {
  const { model } = capturedModel(true);
  let fling;
  for (let i = 0; i < 70; i++) fling ??= model.step(.05).find(e => e.type === 'fling');
  const launched = [];
  const system = Object.create(EncounterSystem.prototype);
  system.model = model;
  system.currentTargets = [{ id: 'victim', position: [0, 0, 1.6] },
    { id: 'ally', position: [2.8, 0, 1.5] }];
  system.world = { terrain: { height: () => 2 } };
  system.g = { physics: { raycast: () => ({ normal: { y: 1 }, point: { y: 2 } }),
    world: { intersectionsWithShape() {} } },
  player: { body: {}, collider: {}, applyChaosLaunch: () => { throw Error('wrong victim'); } },
  bus: { emit() {} } };
  system.net = { authoritative: true, connected: true, me: 'host',
    launchPeer: (...args) => { launched.push(args); return true; } };
  system.launchSnapjawVictim(fling);
  assert.equal(launched.length, 1);
  assert.deepEqual(launched[0].slice(0, 1), ['victim']);
  assert.equal(launched[0][2], 'snapjaw-fling');
  assert.equal(launched[0][3], fling.flingId);
  assert.equal(launched[0][4], model.snapshot().revision);
  const velocity = launched[0][1];
  assert.ok([velocity.x, velocity.y, velocity.z].every(Number.isFinite));
  assert.ok(velocity.lengthSq() <= 400 && velocity.x > 0 && velocity.y >= 8.4,
    'the launch needs a visible arc that can travel toward the checked landing');
});
