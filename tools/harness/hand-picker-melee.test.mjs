import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { HandPicker } = await importBundled('src/tools/Tools.ts', 'hand-picker-melee');

function fixture() {
  const events = [];
  const calls = [];
  const carried = { fruit: { id: 7 } };
  const interaction = {
    carried: null,
    tryInteract() { calls.push('pick'); return true; },
    throwHeld() { calls.push('throw'); this.carried = null; },
    stowHeld() { calls.push('stow'); this.carried = null; },
    throwCharge: 0,
  };
  const net = { tryMelee(origin, direction, swingId) {
    calls.push({ origin: origin.clone(), direction: direction.clone(), swingId });
    return { outcome: 'whoosh' };
  } };
  const game = {
    bus: { emit: (name, payload) => events.push({ name, payload }) },
    player: { state: 'active', eyePosition: new THREE.Vector3(0, 1.7, 0),
      lookDir: out => out.set(0, 0, 1) },
    input: { enabled: true, pointerLocked: true, synthetic: false },
    has: name => name === 'net', get: name => name === 'net' ? net : null,
  };
  const hand = new HandPicker();
  hand.attach({ game, interaction, fruit: {} });
  hand.onEquip();
  return { hand, game, interaction, events, calls, carried };
}

test('empty-hand LMB always animates and resolves contact after windup without picking', () => {
  const f = fixture();
  f.hand.onPrimary(true);
  f.hand.onPrimary(false);
  assert.equal(f.events.filter(e => e.name === 'tool:swing').length, 1);
  assert.equal(f.calls.length, 0);
  f.hand.step(0.10, { primary: false });
  assert.equal(f.calls.length, 0);
  f.hand.step(0.09, { primary: false });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].swingId, 1);
  assert.equal(f.calls.filter(x => x === 'pick').length, 0);
});

test('carried fruit only throws on a press armed while carrying', () => {
  const f = fixture();
  f.hand.onPrimary(true);
  f.interaction.carried = f.carried;
  f.hand.onPrimary(false);
  assert.deepEqual(f.calls, []);
  f.hand.onPrimary(true);
  f.hand.step(0.1, { primary: true });
  f.hand.onPrimary(false);
  assert.deepEqual(f.calls, ['throw']);
});

test('unequip and inactive state cancel unspent contacts and the buffer', () => {
  const f = fixture();
  f.hand.onPrimary(true);
  f.hand.onUnequip();
  f.hand.step(0.25, { primary: false });
  assert.equal(f.calls.length, 0);
  f.hand.onEquip();
  f.hand.onPrimary(true);
  f.game.player.state = 'captured';
  f.hand.step(0.25, { primary: false });
  assert.equal(f.calls.length, 0);
});
