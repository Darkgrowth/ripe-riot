import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerVitals } from '../../src/player/PlayerVitals.ts';

function fixture(options = {}) {
  const events = [];
  const handlers = new Map();
  const losses = [];
  const rescues = [];
  const vitals = new PlayerVitals({
    ...options,
    onLoseUnsecured: (source) => losses.push(source),
    onGeometryRescue: () => rescues.push(true),
  });
  const game = {
    player: { id: 7, state: 'active' },
    bus: {
      emit: (name, payload) => {
        events.push([name, payload]);
        for (const handler of handlers.get(name) ?? []) handler(payload);
      },
      on: (name, handler) => {
        const group = handlers.get(name) ?? new Set();
        group.add(handler);
        handlers.set(name, group);
        return () => group.delete(handler);
      },
    },
    debug: null,
  };
  vitals.init(game);
  return { vitals, game, events, losses, rescues };
}

test('solo player recovers after a short down and keeps unsecured haul', () => {
  const { vitals, game, events, losses } = fixture({ maxHealth: 80, soloRecoverySeconds: 2 });
  assert.equal(vitals.damage(100, 'spikefruit'), true);
  assert.equal(vitals.health, 0);
  assert.equal(vitals.downed, true);
  assert.equal(game.player.state, 'downed');
  assert.deepEqual(losses, []);
  assert.deepEqual(events[0], ['player:downed', { playerId: 7 }]);
  vitals.fixedStep(1.9);
  assert.equal(vitals.downed, true);
  vitals.fixedStep(0.1);
  assert.equal(vitals.downed, false);
  assert.equal(vitals.health, 40);
  assert.equal(game.player.state, 'active');
  assert.deepEqual(losses, []);
});

test('a second solo down evacuates and forfeits unsecured haul', () => {
  const { vitals, losses } = fixture({ soloRecoverySeconds: 2 });
  vitals.damage(100, 'mimic');
  vitals.fixedStep(2);
  assert.equal(vitals.soloRecoveries, 1);
  vitals.damage(100, 'king vine');
  vitals.fixedStep(2);
  assert.equal(vitals.wiped, true);
  assert.deepEqual(losses, ['king vine']);
  vitals.restoreAtCheckpoint();
  assert.equal(vitals.soloRecoveries, 0);
  assert.equal(vitals.health, vitals.maxHealth);
});

test('co-op revive requires continuous progress and avoids loss', () => {
  const { vitals, losses, events } = fixture({ mode: 'coop', reviveSeconds: 3 });
  vitals.damage(200, 'thorn');
  vitals.setReviveAttempt('peer-12');
  vitals.fixedStep(1.5);
  assert.equal(vitals.reviveProgress, 0.5);
  vitals.setReviveAttempt(null);
  assert.equal(vitals.reviveProgress, 0);
  vitals.setReviveAttempt('peer-12');
  vitals.fixedStep(3);
  assert.equal(vitals.downed, false);
  assert.equal(vitals.health, 50);
  assert.deepEqual(losses, []);
  assert.deepEqual(events.at(-1), ['player:revived', { playerId: 7, byId: 'peer-12' }]);
});

test('co-op bleedout evacuates after 15 seconds and loses haul once', () => {
  const { vitals, losses } = fixture({ mode: 'coop' });
  vitals.damage(100, 'king vine sweep');
  vitals.fixedStep(14.9);
  assert.equal(vitals.wiped, false);
  assert.deepEqual(losses, []);
  vitals.fixedStep(0.1);
  assert.equal(vitals.wiped, true);
  assert.deepEqual(losses, ['king vine sweep']);
  vitals.fixedStep(10);
  assert.deepEqual(losses, ['king vine sweep']);
});

test('evacuation loses unsecured haul once and checkpoint restores health', () => {
  const { vitals, game, losses } = fixture({ mode: 'coop' });
  vitals.damage(100, 'boss slam');
  assert.equal(vitals.evacuate(), true);
  assert.equal(vitals.evacuate(), false);
  assert.equal(vitals.wiped, true);
  assert.equal(vitals.downed, true);
  assert.deepEqual(losses, ['boss slam']);
  assert.equal(vitals.revive('peer-12'), false);
  vitals.restoreAtCheckpoint();
  assert.equal(vitals.wiped, false);
  assert.equal(vitals.downed, false);
  assert.equal(vitals.health, vitals.maxHealth);
  assert.equal(game.player.state, 'active');
});

test('geometry rescue does not cause health or haul loss and cannot bypass downed', () => {
  const { vitals, losses, rescues } = fixture();
  vitals.damage(25, 'thorn');
  assert.equal(vitals.rescueFromGeometry(), true);
  assert.equal(vitals.health, 75);
  assert.deepEqual(rescues, [true]);
  assert.deepEqual(losses, []);
  vitals.damage(100, 'thorn');
  assert.equal(vitals.rescueFromGeometry(), false);
});

test('ragdoll recovery event cannot leave a downed player active for a frame', () => {
  const { vitals, game } = fixture({ mode: 'coop' });
  vitals.damage(100, 'boss slam');
  game.player.state = 'active'; // the existing ragdoll recover method does this
  game.bus.emit('player:recovered', { playerId: game.player.id });
  assert.equal(game.player.state, 'downed');
});

test('client ignores local damage but accepts explicit host attack and newer snapshots', () => {
  const { vitals, game } = fixture({ authoritative: false, mode: 'coop' });
  assert.equal(vitals.damage(40, 'local fruit collision'), false);
  assert.equal(vitals.health, 100);
  assert.equal(vitals.applyHostAttack(40, 'boss wave', 'attack-1'), true);
  assert.equal(vitals.applyHostAttack(40, 'boss wave', 'attack-1'), false);
  assert.equal(vitals.health, 60);
  const state = vitals.serializeNetState();
  assert.equal(state.health, 60);
  vitals.applyNetState({ ...state, revision: state.revision + 1, health: 0, downed: true });
  assert.equal(vitals.downed, true);
  assert.equal(game.player.state, 'downed');
  vitals.applyNetState({ ...state, health: 100, downed: false });
  assert.equal(vitals.downed, true);
});
