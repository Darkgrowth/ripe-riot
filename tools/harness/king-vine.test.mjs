import test from 'node:test';
import assert from 'node:assert/strict';
import { KingVine } from '../../src/boss/KingVine.ts';

const target = { id: 'player-1', position: [0, 0, 7] };

test('solo guardian waits for an active player whose recovery grace has ended', () => {
  const boss = new KingVine({ center: [0, 0, 0] });
  const player = { state: 'downed', position: { x: 0, y: 0, z: 7 } };
  const vitals = { downed: true, recoveryGraceRemaining: 0 };
  boss.g = { player, has: name => name === 'vitals', get: () => vitals };
  boss.fixedStep(.1);
  assert.equal(boss.phase, 'idle', 'a downed player is not a new attack target');
  player.state = 'active'; vitals.downed = false; vitals.recoveryGraceRemaining = 2;
  boss.fixedStep(.1);
  assert.equal(boss.phase, 'idle', 'recovery gives time to move clear');
  vitals.recoveryGraceRemaining = 0;
  boss.fixedStep(.1);
  assert.equal(boss.phase, 'telegraph', 'normal danger resumes after grace');
});

test('vine sweep warns before hitting a target, and hits that target once', () => {
  const hits = [];
  const boss = new KingVine({ center: [0, 0, 0], onDamagePlayer: (...args) => hits.push(args) });
  boss.setTargets([target]);
  boss.fixedStep(0.01);
  assert.equal(boss.phase, 'telegraph');
  assert.equal(boss.attack, 'sweep');
  assert.deepEqual(hits, []);
  boss.fixedStep(1.05);
  assert.deepEqual(hits, []);
  boss.fixedStep(0.1);
  assert.equal(hits.length, 1);
  assert.equal(hits[0][0], 'player-1');
  boss.fixedStep(0.2);
  assert.equal(hits.length, 1);
});

test('direct stem hits work during recovery without ropes and subdue exactly once', () => {
  let subduedCalls = 0;
  const boss = new KingVine({ center: [0, 0, 0], onSubdued: () => subduedCalls++ });
  boss.setTargets([target]);
  const origin = [0, 1.7, -10];
  const direction = [0, 0, 1];
  assert.equal(boss.tryHit(origin, direction, 'air', 'player-1'), null);
  boss.fixedStep(0.01);
  boss.fixedStep(1.05);
  boss.fixedStep(0.61);
  assert.equal(boss.phase, 'recover');
  for (let i = 0; i < 3; i++) {
    const hit = boss.tryHit(origin, direction, 'air', 'player-1');
    assert.equal(hit?.kind, 'stem');
    if (i < 2) boss.fixedStep(0.5);
  }
  assert.equal(boss.subdued, true);
  assert.equal(subduedCalls, 1);
  assert.equal(boss.tryHit(origin, direction, 'air', 'player-1'), null);
  boss.reset();
  assert.equal(boss.subdued, false);
  assert.equal(boss.health, boss.maxHealth);
});

test('an air strike can return the seed projectile to hurt the stem', () => {
  const boss = new KingVine({ center: [0, 0, 0] });
  boss.setTargets([target]);
  boss.fixedStep(0.01); // sweep warning
  boss.fixedStep(1.05); // sweep
  boss.fixedStep(0.61); // recovery
  boss.fixedStep(1.81); // idle
  boss.fixedStep(0.01); // seed warning
  assert.equal(boss.attack, 'seed');
  boss.fixedStep(1.05); // projectile launches
  assert.equal(boss.phase, 'seed');
  boss.fixedStep(0.1); // seed leaves the stem
  const before = boss.health;
  const hit = boss.tryHit([0, 1.4, 7], [0, 0, -1], 'air', 'player-1');
  assert.equal(hit?.kind, 'returned-seed');
  for (let i = 0; i < 60 && boss.health === before; i++) boss.fixedStep(0.05);
  assert.ok(boss.health < before);
  assert.equal(boss.phase, 'recover');
});

test('client applies newer snapshots but does not run attacks or accept local hits', () => {
  const host = new KingVine({ center: [0, 0, 0] });
  host.setTargets([target]);
  host.fixedStep(0.01);
  const client = new KingVine({ center: [0, 0, 0], authoritative: false });
  client.setTargets([target]);
  client.fixedStep(10);
  assert.equal(client.phase, 'idle');
  assert.equal(client.tryHit([0, 1.7, -10], [0, 0, 1], 'air', 'player-1'), null);
  const state = host.snapshot();
  assert.equal(client.applySnapshot(state), true);
  assert.equal(client.phase, 'telegraph');
  assert.equal(client.applySnapshot(state), false);
});

test('a saved subdued King Vine restores silently and stays down until explicit reset', () => {
  let paid = 0;
  const boss = new KingVine({ center: [0, 0, 0], onSubdued: () => paid++ });
  boss.restoreSubdued();
  boss.restoreSubdued();
  assert.equal(boss.subdued, true);
  assert.equal(boss.health, 0);
  assert.equal(boss.snapshot().projectile, null);
  assert.equal(paid, 0);
  boss.fixedStep(10);
  assert.equal(boss.subdued, true);
  boss.reset();
  assert.equal(boss.subdued, false);

  const client = new KingVine({ center: [0, 0, 0], authoritative: false });
  client.restoreSubdued();
  assert.equal(client.subdued, false);
});
