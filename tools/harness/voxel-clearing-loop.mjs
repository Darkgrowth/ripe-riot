/**
 * Ordinary-input Stage 1 clearing walk: dock -> Mimic -> prize -> real sell pad.
 * Reads game state for navigation and evidence only. Every action uses trusted
 * Playwright keyboard/mouse input; no debug actions, state writes or fixture.
 *
 * RIPE_URL=http://127.0.0.1:5203 node tools/harness/voxel-clearing-loop.mjs \
 *   --width 320 --height 180
 * Add --video for a full session WebM, then inspect screenshots and report.
 * --capture-warning and --capture-hit attempt synchronous stills during combat;
 * use the WebM frame fallback if they cost too much time at the chosen size.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1];
};
const width = Number(option('--width', '320'));
const height = Number(option('--height', '180'));
const maxSeconds = Number(option('--seconds', '600'));
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 180
  || !Number.isFinite(maxSeconds) || maxSeconds < 30 || maxSeconds > 600)
  throw new Error('Use a viewport of at least 320x180 and --seconds from 30 to 600.');
const base = process.env.RIPE_URL;
if (base !== 'http://127.0.0.1:5203')
  throw new Error('Set RIPE_URL=http://127.0.0.1:5203 (isolated pilot server).');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(root, option('--out',
  `docs/evidence/detailed-voxel-clearing/normal-loop/${width}x${height}`));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage',
  '--mute-audio', '--use-gl=angle', '--use-angle=d3d11'] });
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1,
  ...(args.includes('--video') ? { recordVideo: { dir: out, size: { width, height } } } : {}) });
const page = await context.newPage();
const videoPageCreatedAt = Date.now();
const errors = [], warnings = [], timeline = [], beats = {
  dock: false, warning: false, hit: false, continuedAfterHit: false,
  mimicDefeated: false, physicalPrize: false, carriedPrize: false,
  reachedRealPad: false, soldWithE: false,
};
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => {
  if (m.type() === 'error') errors.push(m.text());
  if (m.type() === 'warning') warnings.push(m.text());
});
const start = Date.now(), deadline = start + maxSeconds * 1000;
let stage = 'boot', mouseX = width / 2, mouseY = height / 2;
let lastState = null, warningShot = false;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const angleDelta = a => Math.atan2(Math.sin(a), Math.cos(a));
const alive = () => Date.now() < deadline;
function log(kind, data = {}) {
  const row = { wallSeconds: +((Date.now() - start) / 1000).toFixed(2), stage, kind, ...data };
  timeline.push(row); console.log(JSON.stringify(row));
}
async function shot(name) {
  await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 20000 });
}
async function read() {
  const s = await page.evaluate(() => {
    const g = window.__GAME, p = g.player, i = g.get('interaction');
    const e = g.get('encounters').snapshot().encounters.find(x => x.kind === 'mimic');
    const v = g.get('vitals'), w = g.get('world'), t = g.get('tools');
    const gl = g.renderer.renderer.getContext();
    const debugRenderer = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      gameSeconds: g.clock.elapsed,
      visualMode: window.__RIPE_VISUAL_MODE,
      pos: p.position.toArray(), eye: p.eyePosition.toArray(), yaw: p.yaw, pitch: p.pitch,
      playerState: p.state, health: v.health, downed: v.downed,
      synthetic: g.input.synthetic !== null, locked: g.input.pointerLocked,
      sensitivity: g.input.sensitivity, invertY: g.input.invertY,
      mimic: e && { pos: e.position, phase: e.phase, health: e.health,
        timeLeft: e.timeLeft },
      activeTool: t.activeId, cooldown: t.activeTool?.cooldown ?? null,
      carried: i.carried?.fruit.id ?? null,
      carriedSpecies: i.carried?.fruit.species ?? null,
      targetKind: i.targetKind, targetId: i.target?.id ?? null, prompt: i.promptText,
      nearSellPad: i.nearSellPad, sellPad: w.sellPad.toArray(),
      spawn: w.spawnPoint.toArray(),
      money: g.get('economy').money,
      prize: [...g.get('fruit').fruits.values()]
        .filter(f => f.species === 'watermelon' && f.state === 'free')
        .map(f => ({ id: f.id, pos: f.position.toArray(), speed: f.speed, radius: f.radius })),
      render: g.renderer.info,
      gpu: debugRenderer ? gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL) : 'unavailable',
      events: window.__voxelLoop.events.splice(0),
    };
  });
  if (s.synthetic) throw new Error('Synthetic input was active; normal-input proof invalid.');
  if (s.visualMode !== 'voxel') throw new Error(`Unexpected visual mode ${s.visualMode}`);
  beats.warning ||= s.mimic?.phase === 'warn';
  beats.hit ||= s.health < 100;
  beats.mimicDefeated ||= s.mimic?.health === 0;
  beats.physicalPrize ||= s.prize.length > 0;
  beats.carriedPrize ||= s.carriedSpecies === 'watermelon';
  for (const event of s.events) log('event', event);
  if (beats.warning && !warningShot) {
    warningShot = true;
    // Capturing synchronously here can use most of the 0.8 s warning window
    // under software rendering. A video run records it without delaying input.
    if (args.includes('--capture-warning')) await shot('02-warning');
    log('warning-observed', {
      pos: s.pos, mimic: s.mimic, health: s.health });
  }
  if (s.health < (lastState?.health ?? 100))
    log('damage-observed', { pos: s.pos, mimic: s.mimic, health: s.health });
  lastState = s;
  return s;
}
async function observe(label) {
  const s = await read();
  log(label, { pos: s.pos, health: s.health, playerState: s.playerState,
    mimic: s.mimic, tool: s.activeTool, carried: s.carried,
    targetKind: s.targetKind, targetId: s.targetId, money: s.money,
    render: s.render });
  return s;
}
async function lock() {
  if (await page.evaluate(() => !!document.pointerLockElement)) return;
  await page.mouse.click(width / 2, height / 2);
  await page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 5000 });
  await page.mouse.move(++mouseX, mouseY);
  await sleep(100);
}
async function aim(point) {
  await lock();
  for (let n = 0; n < 18 && alive(); n++) {
    const s = await read(), dx = point[0] - s.eye[0], dz = point[2] - s.eye[2];
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(point[1] - s.eye[1], Math.hypot(dx, dz));
    const dyaw = angleDelta(yaw - s.yaw), dpitch = pitch - s.pitch;
    if (Math.abs(dyaw) < .018 && Math.abs(dpitch) < .018) return true;
    const sensitivity = s.sensitivity || .0022;
    mouseX += Math.max(-160, Math.min(160, -dyaw / sensitivity));
    mouseY += Math.max(-120, Math.min(120,
      -dpitch / (sensitivity * (s.invertY ? -1 : 1))));
    await page.mouse.move(mouseX, mouseY);
    await sleep(80);
  }
  return false;
}
async function press(key) {
  await page.keyboard.down(key); await sleep(100); await page.keyboard.up(key);
}
async function click() {
  await page.mouse.down(); await sleep(110); await page.mouse.up();
}
async function go(point, radius = 1.15, seconds = 60, stepMs = 480,
  sprint = true, interruptOnHit = false, interruptOnWarning = false) {
  stage = 'walk'; log('waypoint', { point, radius });
  const until = Math.min(deadline, Date.now() + seconds * 1000);
  let previous = null, stuck = 0;
  while (alive() && Date.now() < until) {
    const s = await read(), d = dist(point, s.pos);
    if (interruptOnHit && s.health < 100) return true;
    if (interruptOnWarning && s.mimic.phase === 'warn') return true;
    if (d <= radius) return true;
    if (s.playerState !== 'active') { await sleep(250); continue; }
    if (!await aim([point[0], s.eye[1] - .045 * d, point[2]])) {
      log('aim-failed', { pos: s.pos, point }); return false;
    }
    await page.keyboard.down('w');
    if (sprint) await page.keyboard.down('Shift');
    await sleep(Math.min(stepMs, Math.max(110, (d - radius) / 5 * 1000)));
    await page.keyboard.up('w');
    if (sprint) await page.keyboard.up('Shift');
    const next = await read();
    if (interruptOnHit && next.health < 100) return true;
    if (interruptOnWarning && next.mimic.phase === 'warn') return true;
    if (previous && dist(previous, next.pos) < .22) stuck++; else stuck = 0;
    previous = next.pos;
    if (stuck >= 2) {
      log('obstacle-recovery', { pos: next.pos });
      await page.keyboard.down(stuck % 2 ? 'a' : 'd');
      await press('Space'); await sleep(300);
      await page.keyboard.up(stuck % 2 ? 'a' : 'd');
      if (stuck > 5) break;
    }
  }
  log('waypoint-missed', { point, pos: (await read()).pos });
  return false;
}
const toOrchard = [[60, 65], [55.5, 61], [50.5, 61.5], [44, 62.5],
  [37.2, 58.2], [30, 54], [25, 46], [11, 38.6], [-3.5, 31.4],
  [-7.5, 29.5]];
async function route(points) {
  for (const [x, z] of points) {
    if (!alive() || !await go([x, 0, z], 1.4, 60)) return false;
  }
  return true;
}
async function waitFor(predicate, seconds, label) {
  const until = Math.min(deadline, Date.now() + seconds * 1000);
  while (alive() && Date.now() < until) {
    const s = await read();
    if (predicate(s)) return s;
    await sleep(110);
  }
  log('wait-timeout', { label, state: lastState });
  return lastState;
}
async function takeHit() {
  stage = 'warning-and-hit';
  let s = await observe('orchard-entry');
  await aim([s.mimic.pos[0], s.mimic.pos[1] + 1.15, s.mimic.pos[2]]);
  await shot('02-mallet-view');
  // Stop at the first warning, then stay on the Mimic's charge line. The
  // movement target is nearly collinear with the enemy, so the mallet remains
  // aimed after the lunge. Do not spend the recovery window taking a shot.
  if (!await go([-12.5, 0, 27.2], .5, 20, 160, false, false, true))
    return false;
  await page.waitForFunction(() => window.__GAME.get('vitals').health < 100,
    null, { timeout: 7000 });
  beats.hit = true;
  log('first-hit-observed');
  if (args.includes('--capture-hit')) await shot('03-after-hit');
  // This is the same physical left click used by a player. The first swing
  // begins immediately after impact, before round trips for state inspection.
  await click();
  log('immediate-mallet-click-after-hit');
  return true;
}
async function fight() {
  stage = 'mimic-fight';
  // Continue the close-range three-hit mallet sequence during stagger. The
  // initial impact positions the enemy 1.7 m away; each strike pushes it 0.55
  // m along the same line, inside the 3.2 m melee reach through the third hit.
  for (let n = 0; n < 2; n++) {
    await sleep(700);
    await click();
    log('rapid-mallet-click', { index: n + 2 });
  }
  let opening = await observe('rapid-mallet-result');
  if (dist(opening.pos, opening.spawn) < 3 && opening.mimic.health > 0)
    throw new Error('Player evacuated to dock before defeating Mimic');
  beats.continuedAfterHit = beats.hit && opening.health > 0
    && opening.playerState === 'active';
  if (opening.mimic.health === 0) {
    beats.mimicDefeated = true;
    await shot('05-mimic-defeated');
    return true;
  }
  const until = Math.min(deadline, Date.now() + 70_000);
  let swings = 0;
  while (alive() && Date.now() < until) {
    let s = await read();
    if (s.mimic.health === 0) break;
    if (dist(s.pos, s.spawn) < 3)
      throw new Error('Player evacuated to dock during Mimic fight');
    if (s.playerState !== 'active') { await sleep(300); continue; }
    const d = dist(s.pos, s.mimic.pos);
    if (d > 2.7) {
      const dx = s.pos[0] - s.mimic.pos[0], dz = s.pos[2] - s.mimic.pos[2];
      const stand = [s.mimic.pos[0] + dx / d * 2.25, 0,
        s.mimic.pos[2] + dz / d * 2.25];
      if (!await go(stand, 0.5, 12, 250, false)) log('mimic-approach-missed', { d });
      s = await read();
    }
    if (!await aim([s.mimic.pos[0], s.mimic.pos[1] + 1.15,
      s.mimic.pos[2]])) log('strike-aim-inexact');
    if (s.cooldown > 0) await sleep(Math.ceil(s.cooldown * 1000) + 90);
    const before = await read();
    await click(); swings++;
    const after = await observe('mallet-swing');
    log('strike-result', { swings, beforeHealth: before.mimic.health,
      afterHealth: after.mimic.health, distance: dist(after.pos, after.mimic.pos) });
    if (after.mimic.health === 0) break;
    await sleep(430);
  }
  const s = await observe('fight-end');
  if (s.mimic.health === 0) {
    beats.mimicDefeated = true;
    beats.continuedAfterHit ||= beats.hit && s.playerState === 'active' && !s.downed;
    await shot('05-mimic-defeated');
  }
  return s.mimic.health === 0;
}
async function recoverPrize() {
  stage = 'recover-prize';
  let s = await waitFor(x => x.prize.some(f => f.speed < 2.5), 8, 'free-watermelon');
  if (!s.prize.length) return false;
  const id = s.prize.sort((a, b) => dist(a.pos, s.pos) - dist(b.pos, s.pos))[0].id;
  for (let attempt = 0; attempt < 8 && alive(); attempt++) {
    s = await read();
    const fruit = s.prize.find(f => f.id === id);
    if (!fruit) break;
    const d = Math.max(0.01, dist(s.pos, fruit.pos));
    if (d > 2.1) {
      const stand = [fruit.pos[0] + (s.pos[0] - fruit.pos[0]) / d * 1.6,
        0, fruit.pos[2] + (s.pos[2] - fruit.pos[2]) / d * 1.6];
      if (!await go(stand, .7, 20, 330, false)) continue;
      s = await read();
    }
    const target = s.prize.find(f => f.id === id);
    if (!target) break;
    await aim(target.pos);
    await sleep(130);
    s = await observe('prize-target');
    if (s.targetKind === 'fruit' && s.targetId === id) {
      await press('e');
      s = await observe('prize-E');
      if (s.carried === id) {
        beats.carriedPrize = true; await shot('06-prize-carried'); return true;
      }
    }
    await sleep(250);
  }
  return false;
}
async function deliver() {
  stage = 'carry-to-real-pad';
  // The normal pad is at the dock-side shop. The comparison-only orchard pad
  // is deliberately unavailable in this run.
  const back = [...toOrchard].reverse().slice(0, 7);
  if (!await route(back)) return false;
  const s = await read();
  if (!await go(s.sellPad, 2.2, 60)) return false;
  const near = await observe('real-sell-pad');
  beats.reachedRealPad = near.targetKind === 'sell';
  await shot('07-real-sell-pad');
  if (near.targetKind !== 'sell') return false;
  const before = near.money;
  await press('e');
  const sold = await observe('sale-E');
  beats.soldWithE = sold.money > before && sold.carried === null;
  await shot('08-sold');
  return beats.soldWithE;
}

let failure = null;
try {
  await page.goto(`${base}/?fresh=1&voxelPilot=1`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR,
    null, { timeout: 90000 });
  const bootError = await page.evaluate(() => window.__RIPE_ERROR ?? null);
  if (bootError) throw new Error(`Boot failed: ${bootError}`);
  await page.evaluate(() => {
    const g = window.__GAME;
    const observer = window.__voxelLoop = { events: [] };
    for (const name of ['encounter:attack', 'encounter:defeated', 'fruit:grabbed',
      'fruit:sold', 'player:ragdoll', 'player:recovered', 'player:downed',
      'player:revived', 'money:changed', 'tool:swing'])
      g.bus.on(name, payload => observer.events.push({ name, gameSeconds: g.clock.elapsed,
        payload: JSON.parse(JSON.stringify(payload)) }));
  });
  const entry = await observe('fresh-dock');
  beats.dock = dist(entry.pos, entry.spawn) < 2;
  await shot('01-fresh-dock');
  await lock();
  if (!await route(toOrchard)) throw new Error('Normal walking missed the orchard route');
  await shot('02-orchard-entry');
  if (!await takeHit()) throw new Error('Mimic did not land the planned warning hit');
  if (!await fight()) throw new Error('Starter Picking Mallet did not defeat Mimic');
  if (!await recoverPrize()) throw new Error('Could not pick physical watermelon with E');
  if (!await deliver()) throw new Error('Could not walk to real sell pad and sell with E');
} catch (e) {
  failure = String(e.stack || e);
  log('runner-error', { failure });
} finally {
  try { await page.keyboard.up('w'); await page.keyboard.up('Shift');
    await page.keyboard.up('a'); await page.keyboard.up('d'); } catch { /* preserve prior result */ }
  try { await observe('final'); } catch (e) { errors.push(`Final observation: ${e.message}`); }
  const video = page.video();
  await context.close();
  if (video) {
    try {
      const source = await video.path();
      const target = path.join(out, 'normal-loop.webm');
      if (source !== target) { copyFileSync(source, target); unlinkSync(source); }
    } catch (e) { errors.push(`Video finalization: ${e.message}`); }
  }
  await browser.close();
  const report = { url: `${base}/?fresh=1&voxelPilot=1`, viewport: [width, height],
    maxSeconds, durationSeconds: +((Date.now() - start) / 1000).toFixed(2),
    videoPageCreatedOffsetSeconds: +((start - videoPageCreatedAt) / 1000).toFixed(3),
    gpu: lastState?.gpu ?? null, beats, failure, errors, warnings,
    final: lastState, timeline };
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ out, durationSeconds: report.durationSeconds,
    beats, failure, errors }, null, 2));
  if (failure || errors.length || Object.values(beats).some(v => !v)) process.exitCode = 1;
}
