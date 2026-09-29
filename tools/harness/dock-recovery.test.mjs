import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';
const { DockRecovery } = await importBundled('src/player/DockRecovery.ts', 'dock-recovery');

function fixture() {
  const events = [];
  const vitals = { health: 40, maxHealth: 100, downed: false, wiped: false,
    heal(amount) { const n = Math.min(amount, this.maxHealth - this.health); this.health += n; return n; } };
  const g = { player: { state: 'active', position: new THREE.Vector3(), velocity: new THREE.Vector3() },
    get: key => key === 'vitals' ? vitals : { spawnPoint: new THREE.Vector3(), shopCounter: new THREE.Vector3(20, 0, 0) },
    bus: { emit: (name, payload) => events.push({ name, payload }) } };
  const system = new DockRecovery(); system.init(g);
  return { system, g, vitals, events, step: seconds => { for (let i = 0; i < seconds * 60; i++) system.fixedStep(1 / 60); } };
}

test('resting at the dock restores health without spending money or repeating its cue', () => {
  const f = fixture(); f.step(1);
  assert.equal(f.vitals.health, 40);
  f.step(5);
  assert.equal(f.vitals.health, 100);
  assert.equal(f.events.filter(e => e.name === 'ui:toast').length, 1);
  assert.equal(f.events.some(e => e.name === 'money:changed'), false);
});

test('running, distant terrain and being downed do not provide free field healing', () => {
  const f = fixture();
  f.g.player.velocity.x = 5; f.step(5);
  f.g.player.velocity.x = 0; f.g.player.position.set(40, 0, 30); f.step(5);
  f.g.player.position.set(0, 0, 0); f.g.player.state = 'downed'; f.vitals.downed = true; f.step(5);
  assert.equal(f.vitals.health, 40);
});
