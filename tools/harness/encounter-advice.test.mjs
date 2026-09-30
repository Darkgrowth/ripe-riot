import test from 'node:test';
import assert from 'node:assert/strict';
import { importBundled } from './import-bundled.mjs';
const { encounterAdvice } = await importBundled('src/ui/EncounterAdvice.ts', 'encounter-advice');
const state = (kind, phase, extra = {}) => ({kind, phase, health: 2, baited: false,
  capturedVictimId: null, ...extra});

test('Snapjaw distinguishes bait, incoming bite and the real damage opening', () => {
  assert.match(encounterAdvice(state('snapjaw', 'idle'), false, false).text, /Toss fruit/);
  assert.match(encounterAdvice(state('snapjaw', 'idle'), true, false).text, /release/);
  assert.equal(encounterAdvice(state('snapjaw', 'warn', {baited: true}), false, false).tone, 'bait');
  assert.equal(encounterAdvice(state('snapjaw', 'attack'), false, false).tone, 'danger');
  assert.equal(encounterAdvice(state('snapjaw', 'recover'), false, false).tone, 'opening');
});

test('rescue takes priority over attacking and defeated enemies give no advice', () => {
  const rescue = encounterAdvice(state('snapjaw', 'recover', {capturedVictimId: 'friend'}), false, true);
  assert.match(rescue.text, /E.*free/);
  assert.match(rescue.text, /Catch Net.*throw/);
  assert.equal(encounterAdvice(state('snapjaw', 'defeated', {health: 0}), false, true), null);
});

test('combat advice follows the phase and the tools actually owned', () => {
  assert.equal(encounterAdvice(state('mimic', 'idle', { dormant: true }), false, false), null);
  assert.match(encounterAdvice(state('mimic', 'warn'), false, false).text, /sidestep/i);
  assert.equal(encounterAdvice(state('mimic', 'stagger'), false, false).tone, 'opening');
  assert.doesNotMatch(encounterAdvice(state('spitter', 'warn'), false, false).text, /blast/);
  assert.match(encounterAdvice(state('spitter', 'warn'), false, true).text, /blast/);
});
