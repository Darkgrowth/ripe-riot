import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { Game } = await importBundled('src/core/Game.ts', 'fixed-step-catch-game');
const { NetCatchGuard } = await importBundled('src/net/NetCatchGuard.ts', 'fixed-step-catch-guard');
const { CatchNet } = await importBundled('src/tools/Tools.ts', 'fixed-step-catch-tool');
const { ToolInventory } = await importBundled('src/tools/ToolInventory.ts', 'fixed-step-catch-inventory');

for (const steps of [1, 6, 15]) test(`the first active net sweep catches with ${steps}-step frames`, () => {
  const game = new Game(), guard = new NetCatchGuard();
  const tool = new CatchNet(), inventory = new ToolInventory();
  // Only rendering, hardware and physics are stubbed. Input dispatch, swing
  // progression, the first candidate nomination and host timing all run live.
  const frame = { lookX: 0, lookY: 0, slot: 0, scroll: 0,
    primaryPressed: true, primary: false };
  game.input = { frame, sample: () => frame,
    consumeEdges() { frame.primaryPressed = false; } };
  game.player = { state: 'active', eyePosition: new THREE.Vector3(0, 1.7, 0),
    lookDir: out => out.set(0, 0, 1), applyLook() {}, step() {} };
  game.physics = { step() {} };
  game.playerCamera = { update() {}, addRecoil() {} };
  game.renderer = { camera: new THREE.PerspectiveCamera(),
    updateCameraFov() {}, updateSunFollow() {}, render() {} };
  let startedAt = null, presentedAt = null;
  const requests = [];
  game.add({ name: 'net', beginNetSwing(id) {
    startedAt = game.clock.elapsed;
    return guard.start('rescuer', id, startedAt, true);
  }, flyingPeerAtHoop() { return { id: 'victim', flingId: 1 }; },
  requestNetCatch(_victimId, _flingId, swingId) {
    const accepted = guard.catch('rescuer', swingId, game.clock.elapsed, true);
    requests.push({ accepted, phase: tool.phaseT,
      sinceStart: game.clock.elapsed - startedAt });
    return accepted;
  } });
  const ctx = { game, fruit: { fruits: new Map() }, interaction: {} };
  tool.ctx = ctx; tool.equipped = true;
  inventory.g = game; inventory.ctx = ctx;
  inventory.all.set('net', tool); inventory.owned.add('net'); inventory.slots[0] = 'net';
  game.add(inventory);
  game.add({ name: 'presentation', frameUpdate() { presentedAt = game.clock.elapsed; } });
  const frames = Math.ceil(15 / steps);
  for (let i = 0; i < frames; i++) {
    game.clock.stepOnce(steps);
    game.tick(1000 + i * 100);
  }
  assert.equal(requests.length, 1, 'one flight is nominated once per swing');
  assert.equal(requests[0].accepted, true,
    'the actual first active sweep must be accepted by host timing');
  assert.ok(Math.abs(requests[0].phase - requests[0].sinceStart) < 1e-10,
    'visible swing and host timing agree');
  assert.ok(Math.abs(presentedAt - frames * steps / 60) < 1e-10,
    'presentation retains the completed frame time');
  assert.equal(game.clock.elapsed, presentedAt);
});
