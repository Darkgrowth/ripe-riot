import test from 'node:test';
import assert from 'node:assert/strict';
import { EncounterModel } from '../../src/enemies/EncounterModel.ts';

const modelAt = (kind) => new EncounterModel([{ kind, position: [0, 0, 0] }]);

test('mimic warns before charging and damages a target once per charge', () => {
  const model = modelAt('mimic');
  model.setTargets([{ id: 'peer-7', position: [5, 0, 0] }]);
  model.step(0.02);
  assert.equal(model.get('mimic').phase, 'warn');
  assert.deepEqual(model.step(0.9), []);
  assert.equal(model.get('mimic').phase, 'attack');
  const hits = [];
  for (let i = 0; i < 80; i++) hits.push(...model.step(0.02));
  assert.deepEqual(hits.filter((event) => event.type === 'damage'), [
    { type: 'damage', kind: 'mimic', victimId: 'peer-7', amount: 28 },
  ]);
});

test('mimic impact stops before its body passes through the player camera', () => {
  const model = modelAt('mimic');
  model.setTargets([{ id: 'fighter', position: [0, 0, 5] }]);
  model.step(0.02);
  model.step(0.9);
  let hit = false;
  for (let i = 0; i < 70; i++) {
    if (model.step(0.02).some(e => e.type === 'damage')) { hit = true; break; }
  }
  assert.equal(hit, true);
  assert.equal(model.get('mimic').phase, 'recover', 'bite commits then visibly recovers');
  assert.ok(Math.hypot(model.get('mimic').position[0],
    model.get('mimic').position[2] - 5) >= 2.35,
  'the full visible shell stays readable outside the player camera');
});

test('mimic stops at a solid orchard rail and cannot hit through it', () => {
  // A rail at x=4 blocks a 0.85 m-wide enemy. The player stands beyond it.
  const blocked = (from, to, radius) => from[0] + radius < 4 && to[0] + radius >= 4;
  const model = new EncounterModel([{ kind: 'mimic', position: [0, 0, 0] }], null, 0, blocked);
  model.setTargets([{ id: 'beyond-rail', position: [5, 0, 0] }]);
  model.step(0.02);
  model.step(0.9);
  const events = [];
  for (let i = 0; i < 70; i++) events.push(...model.step(0.02));
  assert.ok(model.get('mimic').position[0] < 4, 'body stays on its side of the rail');
  assert.equal(events.some(e => e.type === 'damage'), false, 'the rail blocks the bite too');
  assert.equal(model.get('mimic').phase, 'recover');
});

test('nonlethal Mimic hit interrupts its attack with knockback and recovery', () => {
  const model = modelAt('mimic');
  model.setTargets([{ id: 'fighter', position: [0, 0, 5] }]);
  model.step(0.02);
  model.step(0.9);
  const before = model.get('mimic').position[2];
  assert.equal(model.tryHit([0, 1.2, -2], [0, 0, 1], 'melee', 'fighter')?.damage, 1);
  assert.equal(model.get('mimic').phase, 'stagger');
  assert.ok(model.get('mimic').position[2] > before + 0.25);
  model.step(0.55);
  assert.equal(model.get('mimic').phase, 'recover');
});

test('snapjaw bait starts a telegraphed snap away from the player, then exposes recovery', () => {
  const model = modelAt('snapjaw');
  model.setTargets([{ id: 'peer-3', position: [-4, 0, 0] }]);
  assert.equal(model.offerBait([4, 0, 0]), true);
  assert.equal(model.get('snapjaw').phase, 'warn');
  assert.equal(model.get('snapjaw').baited, true);
  model.step(0.8);
  assert.equal(model.get('snapjaw').phase, 'attack');
  model.step(0.4);
  assert.equal(model.get('snapjaw').phase, 'recover');
  assert.equal(model.tryHit([0, 1.2, -2], [0, 0, 1], 'melee', 'peer-3')?.damage, 1);
});

test('bait redirects a snapjaw warning already aimed at a nearby player', () => {
  const model = modelAt('snapjaw');
  model.setTargets([{ id: 'peer-3', position: [-4, 0, 0] }]);
  model.step(0.02);
  assert.equal(model.get('snapjaw').phase, 'warn');
  assert.equal(model.offerBait([4, 0, 0]), true);
  assert.equal(model.get('snapjaw').baited, true);
  model.step(0.8);
  assert.ok(model.get('snapjaw').heading > 1);
});

test('snapjaw cannot be damaged outside recovery and defeat reports only once', () => {
  const model = modelAt('snapjaw');
  assert.equal(model.tryHit([0, 1.2, -2], [0, 0, 1], 'air', 'peer-1'), null);
  model.offerBait([2, 0, 0]);
  model.step(0.8);
  model.step(0.4);
  const hit = model.tryHit([0, 1.2, -2], [0, 0, 1], 'air', 'peer-1');
  assert.equal(hit?.defeated, true);
  assert.equal(model.tryHit([0, 1.2, -2], [0, 0, 1], 'air', 'peer-1'), null);
});

test('mallet contact on a closed jaw explains protection and an open mouth takes a hit', () => {
  const model = modelAt('snapjaw');
  const origin = [0, 1.7, -2.1], direction = [0, 0, 1];
  const closed = model.resolveMelee(origin, direction, 'fighter', () => false);
  assert.equal(closed.outcome, 'protected');
  assert.equal(model.get('snapjaw').health, 2);
  model.offerBait([2, 0, 0]);
  model.step(0.8);
  model.step(0.4);
  const open = model.resolveMelee(origin, direction, 'fighter', () => false);
  assert.equal(open.outcome, 'hit');
  assert.equal(open.hit.damage, 1);
  assert.equal(model.get('snapjaw').health, 1);
});

test('a solid obstruction stops melee before health or reward changes', () => {
  const model = modelAt('mimic');
  const seen = [];
  const result = model.resolveMelee([0, 1.7, -2.2], [0, 0, 1], 'fighter',
    contact => { seen.push(contact); return true; });
  assert.equal(result.outcome, 'blocked');
  assert.equal(model.get('mimic').health, 3);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].distance < 2.9);
});

test('melee reaches a nearby surface but respects its bounded reach', () => {
  const near = modelAt('mimic');
  assert.equal(near.resolveMelee([0, 1.7, -2.2], [0, 0, 1], 'fighter', () => false).outcome,
    'hit');
  const far = modelAt('mimic');
  assert.equal(far.resolveMelee([0, 1.7, -4.8], [0, 0, 1], 'fighter', () => false).outcome,
    'whoosh');
  assert.equal(far.get('mimic').health, 3);
});

test('one held melee swing cannot drain the mimic in successive fixed steps', () => {
  const model = modelAt('mimic');
  assert.equal(model.tryHit([0, 1.2, -2], [0, 0, 1], 'melee', 'fighter')?.damage, 1);
  model.step(0.02);
  assert.equal(model.tryHit([0, 1.2, -2], [0, 0, 1], 'melee', 'fighter'), null);
  assert.equal(model.get('mimic').health, 2);
  model.step(0.5);
  assert.equal(model.tryHit([0, 1.2, -2], [0, 0, 1], 'melee', 'fighter')?.damage, 1);
});

test('snapjaw capture deals a heavy hit and holds one victim briefly', () => {
  const model = modelAt('snapjaw');
  model.setTargets([{ id: 'victim', position: [0, 0, 2] }]);
  model.step(0.02);
  model.step(0.8);
  const events = model.step(0.05);
  assert.deepEqual(events, [
    { type: 'damage', kind: 'snapjaw', victimId: 'victim', amount: 38 },
    { type: 'capture', kind: 'snapjaw', victimId: 'victim' },
  ]);
  assert.equal(model.get('snapjaw').capturedVictimId, 'victim');
  assert.ok(model.get('snapjaw').captureTimeLeft > 2);
  assert.equal(model.tryEscape('victim'), false);
  model.step(0.4);
  assert.equal(model.tryEscape('victim'), true);
  assert.equal(model.get('snapjaw').capturedVictimId, null);
});

test('nearby teammate can rescue a captured peer, and timeout releases them', () => {
  const model = modelAt('snapjaw');
  model.setTargets([
    { id: 'victim', position: [0, 0, 2] },
    { id: 'friend', position: [2.5, 0, 0] },
    { id: 'far', position: [8, 0, 0] },
  ]);
  model.step(0.02);
  model.step(0.8);
  model.step(0.05);
  assert.equal(model.tryRescue('victim', 'far'), false);
  assert.equal(model.tryRescue('victim', 'friend'), true);
  assert.equal(model.get('snapjaw').capturedVictimId, null);

  const other = modelAt('snapjaw');
  other.setTargets([{ id: 'victim', position: [0, 0, 2] }]);
  other.step(0.02);
  other.step(0.8);
  other.step(0.05);
  const released = other.step(2.5);
  assert.deepEqual(released.filter(e => e.type === 'release'), [
    { type: 'release', kind: 'snapjaw', victimId: 'victim', reason: 'timeout' },
  ]);
  assert.equal(other.get('snapjaw').capturedVictimId, null);
});

test('older network snapshots cannot revive a defeated encounter', () => {
  const host = modelAt('snapjaw');
  const client = modelAt('snapjaw');
  const stale = host.snapshot();
  host.offerBait([2, 0, 0]);
  host.step(0.8);
  host.step(0.4);
  host.tryHit([0, 1.2, -2], [0, 0, 1], 'air', 'peer-1');
  assert.equal(client.applySnapshot(host.snapshot()), true);
  assert.equal(client.applySnapshot(stale), false);
  assert.equal(client.get('snapjaw').phase, 'defeated');
});

test('client snapshot exposes the captured victim and remaining rescue window', () => {
  const host = modelAt('snapjaw');
  const client = modelAt('snapjaw');
  host.setTargets([{ id: 'peer-4', position: [0, 0, 2] }]);
  host.step(0.02);
  host.step(0.8);
  host.step(0.05);
  assert.equal(client.applySnapshot(host.snapshot()), true);
  assert.equal(client.get('snapjaw').capturedVictimId, 'peer-4');
  assert.ok(client.get('snapjaw').captureTimeLeft > 2);
});

test('spitter warns before launching one dodgeable projectile that deals 24 damage', () => {
  const model = modelAt('spitter');
  model.setTargets([{ id: 'target', position: [0, 0, 10] }]);
  model.step(0.02);
  assert.equal(model.get('spitter').phase, 'warn');
  assert.equal(model.snapshot().projectiles.length, 0);
  model.step(0.95);
  assert.equal(model.snapshot().projectiles.length, 1);
  const events = [];
  for (let i = 0; i < 90; i++) events.push(...model.step(0.02));
  assert.deepEqual(events.filter(e => e.type === 'damage'), [
    { type: 'damage', kind: 'spitter', victimId: 'target', amount: 24 },
  ]);
  assert.equal(model.snapshot().projectiles.length, 0);
});

test('moving sideways during the spitter warning avoids its committed shot', () => {
  const model = modelAt('spitter');
  model.setTargets([{ id: 'target', position: [0, 0, 10] }]);
  model.step(0.02);
  model.step(0.95);
  model.setTargets([{ id: 'target', position: [5, 0, 10] }]);
  const events = [];
  for (let i = 0; i < 90; i++) events.push(...model.step(0.02));
  assert.equal(events.some(e => e.type === 'damage'), false);
});

test('melee staggers a nearby spitter and Air Cannon defeats it from range', () => {
  const near = modelAt('spitter');
  near.setTargets([{ id: 'fighter', position: [0, 0, -2] }]);
  near.step(0.02);
  assert.equal(near.tryHit([0, 1.2, -2], [0, 0, 1], 'melee', 'fighter')?.damage, 1);
  assert.equal(near.get('spitter').phase, 'recover');
  const far = modelAt('spitter');
  assert.equal(far.tryHit([0, 1.2, -12], [0, 0, 1], 'air', 'fighter')?.defeated, true);
  assert.equal(far.get('spitter').phase, 'defeated');
});

test('Air Cannon can deflect a spitter shot before it reaches the player', () => {
  const model = modelAt('spitter');
  model.setTargets([{ id: 'target', position: [0, 0, 12] }]);
  model.step(0.02);
  model.step(0.95);
  model.step(0.3);
  const projectile = model.snapshot().projectiles[0];
  const origin = [0, 1.4, 12];
  const direction = projectile.position.map((n, i) => n - origin[i]);
  assert.equal(model.tryHit(origin, direction, 'air', 'target')?.deflectedProjectileId, projectile.id);
  assert.equal(model.snapshot().projectiles.length, 1);
  assert.equal(model.snapshot().projectiles[0].reflectedBy, 'target');
});

test('read-only strike query sees enemy silhouettes without damaging them', () => {
  const model = modelAt('snapjaw');
  assert.equal(model.canStrike([0, 1.2, -2], [0, 0, 1], 'melee'), true);
  assert.equal(model.canStrike([0, 1.2, -10], [0, 0, 1], 'melee'), false);
  assert.equal(model.get('snapjaw').health, 2);
});

test('client snapshots show the host projectile and reject an older empty volley', () => {
  const host = modelAt('spitter');
  const client = modelAt('spitter');
  const beforeShot = host.snapshot();
  host.setTargets([{ id: 'target', position: [0, 0, 10] }]);
  host.step(0.02);
  host.step(0.95);
  assert.equal(client.applySnapshot(host.snapshot()), true);
  assert.equal(client.snapshot().projectiles.length, 1);
  assert.equal(client.applySnapshot(beforeShot), false);
  assert.equal(client.snapshot().projectiles.length, 1);
});
