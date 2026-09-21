/**
 * Uninterrupted, ordinary-input session. No gameplay/debug mutations.
 * RIPE_URL=http://127.0.0.1:5190 node tools/harness/normal-input-session.mjs
 * --duration 30 is a smoke run; default/max is 600 wall-clock seconds.
 * Root must provide an already-running isolated staging server and GPU slot.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const option = (key, fallback) => { const n = args.indexOf(key); return n < 0 ? fallback : args[n + 1]; };
if (args.includes('--help')) {
  console.log('RIPE_URL=<isolated staging URL> node tools/harness/normal-input-session.mjs [--duration 600] [--out capture/staging-qa/normal-input-session]');
  process.exit(0);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = option('--url', process.env.RIPE_URL);
if (!base) throw new Error('Specify --url or RIPE_URL for the isolated staging server. This runner never starts or selects a server.');
const url = new URL(base);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port === '5188')
  throw new Error('Only a local isolated server is allowed; live play port 5188 is prohibited.');
const requested = Number(option('--duration', '600'));
if (!Number.isFinite(requested) || requested <= 0 || requested > 600) throw new Error('--duration must be >0 and <=600 seconds.');
const OUT = path.resolve(ROOT, option('--out', 'capture/staging-qa/normal-input-session'));
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'timeline.jsonl'), '');
const timeline = [], failures = [], samples = [], errors = [], held = new Set();
const beats = { orchard: false, pickedRealFruit: false, firstWindfall: false,
  leftLooseFruit: false, gullPeck: false, soldWithE: false, rushOrder: false, rushOrderCompleted: false };
let page, browser, cdp, start = 0, deadline = Infinity, lastSample = -Infinity, lastShot = 0;
let mouseX = 160, mouseY = 90, finalState = null, recording = null;
let stage = 'boot', finishedPlan = false;
const wall = () => start ? (Date.now() - start) / 1000 : 0;
function log(kind, data = {}) {
  const row = { wallSeconds: +wall().toFixed(3), kind, ...data };
  timeline.push(row); appendFileSync(path.join(OUT, 'timeline.jsonl'), JSON.stringify(row) + '\n');
}
function alive() { return Date.now() < deadline; }
async function wait(ms) { await sleep(Math.max(0, Math.min(ms, deadline - Date.now()))); }
async function key(name, down) {
  if (down === held.has(name)) return;
  if (down) { await page.keyboard.down(name); held.add(name); }
  else { await page.keyboard.up(name); held.delete(name); }
  log('key', { key: name, down });
}
async function release() { for (const name of [...held]) await key(name, false); }
async function press(name) {
  if (!alive()) return;
  await key(name, true); await wait(110); await key(name, false); await wait(140);
}
function delta(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

// Only reads live game state. The queue being drained is our own observer log.
async function read() {
  const s = await page.evaluate(() => {
    const g = window.__GAME, p = g.player, i = g.get('interaction'), w = g.get('world');
    const d = g.get('director'), c = g.get('characters'), a = g.get('audio');
    return { gameSeconds: g.clock.elapsed, pos: p.position.toArray(), yaw: p.yaw, pitch: p.pitch,
      eye: p.eyeHeight, playerState: p.state, grounded: p.grounded,
      locked: g.input.pointerLocked, shopOpen: g.get('shop').open, synthetic: g.input.synthetic !== null,
      sensitivity: g.input.sensitivity, invertY: g.input.invertY,
      carrying: i.carried?.fruit.id ?? -1, basket: i.basket.items.map(f => f.id), capacity: i.basket.capacity,
      target: i.target?.id ?? -1, targetKind: i.targetKind, prompt: i.promptText,
      nearSellPad: i.nearSellPad, pad: w.sellPad.toArray(), money: g.get('economy').money,
      director: d.netState(), characters: { state: c.netState(), stats: { ...c.stats } },
      audio: { state: a.ctx?.state, music: a.music?.getState() ?? null },
      fruit: [...g.get('fruit').fruits.values()].filter(f => ['apple', 'orange'].includes(f.species)
        && ['attached', 'free'].includes(f.state)).map(f => ({ id: f.id, state: f.state, species: f.species,
        pos: f.position.toArray(), radius: f.radius, speed: f.speed,
        ground: w.terrain.height(f.position.x, f.position.z) })),
      events: window.__normalSession.events.splice(0),
      recorderState: window.__normalSession.recorder?.state,
    };
  });
  if (s.synthetic) throw new Error('Synthetic input unexpectedly enabled; ordinary-input proof invalid.');
  for (const e of s.events) {
    log('observed-event', e);
    if (e.name === 'fruit:grabbed') beats.pickedRealFruit = true;
    if (e.name === 'island:event' && e.payload.kind === 'windfall' && e.payload.phase === 'active') beats.firstWindfall = true;
    if (e.name === 'island:event' && e.payload.kind === 'order' && e.payload.phase === 'active') beats.rushOrder = true;
    if (e.name === 'island:event' && e.payload.kind === 'order' && e.payload.result === 'success') beats.rushOrderCompleted = true;
  }
  if (distance(s.pos, [-24, 0, 22]) < 20) beats.orchard = true;
  if (s.characters.stats.pecks > 0) beats.gullPeck = true;
  if (wall() - lastSample >= 5) {
    lastSample = wall(); const { fruit, events, ...compact } = s;
    samples.push({ wallSeconds: wall(), stage, ...compact }); log('state', { stage, ...compact });
  }
  if (wall() - lastShot >= 30 && alive()) {
    lastShot = wall();
    const shot = await cdp.send('Page.captureScreenshot', {format:'png'});
    writeFileSync(path.join(OUT, `frame-${String(Math.floor(wall())).padStart(3, '0')}.png`), Buffer.from(shot.data,'base64'));
  }
  finalState = s; return s;
}

async function lock() {
  const locked = await page.evaluate(() => !!document.pointerLockElement);
  if (locked) return;
  await release();
  if (await page.evaluate(() => window.__GAME.get('shop').open)) {
    log('close-shop-Escape'); await press('Escape');
  }
  await page.mouse.click(160,90);
  await page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 3000 });
  mouseX = 160; mouseY = 90;
  // PlayerInput intentionally swallows the first mousemove after pointer lock.
  await page.mouse.move(++mouseX, mouseY); await wait(100); log('pointer-lock');
}
async function aim(yaw, pitch = -.06) {
  await lock();
  for (let n = 0; n < 14 && alive(); n++) {
    const s = await read(), dyaw = delta(yaw - s.yaw), dpitch = pitch - s.pitch;
    if (Math.abs(dyaw) < .018 && Math.abs(dpitch) < .018) return true;
    const sensitivity = s.sensitivity || .0022;
    const dx = Math.max(-160, Math.min(160, -dyaw / sensitivity));
    const dy = Math.max(-120, Math.min(120, -dpitch / (sensitivity * (s.invertY ? -1 : 1))));
    mouseX += dx; mouseY += dy;
    // Trusted browser pointer input. No DOM dispatchEvent or game look setter.
    await page.mouse.move(mouseX, mouseY); log('mouse', { dx, dy, targetYaw: yaw, targetPitch: pitch });
    await wait(90);
  }
  log('navigation-warning', { detail: 'Aim did not converge using actual pointer input.' }); return false;
}

async function go(point, { radius = 1.4, seconds = 20, sprint = true, sellApproach = false } = {}) {
  const until = Math.min(deadline, Date.now() + seconds * 1000);
  let previous = null, stuck = 0;
  log('waypoint', { point, radius });
  try {
    while (alive() && Date.now() < until) {
      const s = await read();
      if (sellApproach && s.targetKind === 'sell') return true;
      if (distance(s.pos, point) <= radius) return true;
      if (s.playerState !== 'active') { await release(); await wait(500); continue; }
      const yaw = Math.atan2(-(point[0] - s.pos[0]), -(point[2] - s.pos[2]));
      await release();
      if (!await aim(yaw)) { failures.push('Trusted mouse movement failed to orient the player.'); return false; }
      await key('w', true); if (sprint) await key('Shift', true);
      await wait(Math.min(600, Math.max(140, (distance(s.pos, point) - radius) / 8 * 1000)));
      await release();
      const next = await read();
      if (previous && distance(next.pos, previous) < .22) stuck++; else stuck = 0;
      previous = next.pos;
      if (stuck >= 2) {
        log('obstacle-recovery', { pos: next.pos });
        await key(stuck % 2 ? 'a' : 'd', true); await press('Space'); await wait(350); await release();
        if (stuck > 5) break;
      }
    }
    log('waypoint-missed', { point }); return false;
  } finally { await release(); }
}
// The counter has a front service lane. Approach through it, rather than
// attempting to squeeze diagonally between the side crate and the shop wall.
const ROUTE = [[60, 0, 65], [55.5, 0, 61], [50.5, 0, 61.5], [44, 0, 62.5],
  [37.2, 0, 58.2], [30, 0, 54], [25, 0, 46], [11, 0, 38.6], [-3.5, 0, 31.4], [-17, 0, 25]];
async function route(toOrchard) {
  stage = toOrchard ? 'walk-to-orchard' : 'walk-to-pad'; log('stage', { stage });
  const points = toOrchard ? ROUTE : ROUTE.slice(4).reverse();
  // Resume at nearest route point, then follow the authored walking line.
  const s = await read(); let nearest = 0;
  points.forEach((p, n) => { if (distance(p, s.pos) < distance(points[nearest], s.pos)) nearest = n; });
  for (const p of points.slice(nearest)) if (alive() && !await go(p)) return false;
  if (!toOrchard && alive()) return go((await read()).pad, { radius: 1.1, sellApproach: true });
  return alive();
}

async function harvest(goal, budgetSeconds = 65) {
  stage = 'harvest-real-fruit'; log('stage', { stage, goal });
  const until = Math.min(deadline, Date.now() + budgetSeconds * 1000), attempted = new Set();
  while (alive() && Date.now() < until) {
    let s = await read();
    if (s.basket.length + (s.carrying >= 0 ? 1 : 0) >= Math.min(goal, s.capacity + 1)) return true;
    const candidates = s.fruit.filter(f => !attempted.has(f.id) && distance(f.pos, [-24, 0, 22]) < 30
      && f.pos[1] - f.ground < 4.6 && f.speed < 2)
      .sort((a, b) => distance(a.pos, s.pos) - distance(b.pos, s.pos));
    const target = candidates[0];
    if (!target) { attempted.clear(); await wait(1200); continue; }
    attempted.add(target.id);
    const d = Math.max(.01, distance(s.pos, target.pos));
    const stand = [target.pos[0] + (s.pos[0] - target.pos[0]) / d * 1.8, 0,
      target.pos[2] + (s.pos[2] - target.pos[2]) / d * 1.8];
    if (!await go(stand, { radius: .45, seconds: 9, sprint: false })) continue;
    s = await read(); const f = s.fruit.find(f => f.id === target.id); if (!f) continue;
    const dx = f.pos[0] - s.pos[0], dz = f.pos[2] - s.pos[2];
    await aim(Math.atan2(-dx, -dz), Math.atan2(f.pos[1] - s.pos[1] - s.eye, Math.hypot(dx, dz)));
    await wait(180); s = await read();
    if (s.targetKind === 'fruit') {
      log('attempt-pick', { requestedFruit: target.id, actualTarget: s.target }); await press('e');
    } else log('pick-not-reachable', { id: target.id, targetKind: s.targetKind, prompt: s.prompt });
  }
  return false;
}
async function sell() {
  const s = await read();
  if (s.targetKind !== 'sell') { log('sell-unavailable', { nearSellPad: s.nearSellPad, prompt: s.prompt }); return false; }
  log('attempt-sale-E', { basket: s.basket, carrying: s.carrying }); await press('e');
  const after = await read();
  if (after.money > s.money) { beats.soldWithE = true; return true; }
  return false;
}

try {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 320, height: 180 }, deviceScaleFactor: 1 });
  page = await context.newPage();
  cdp = await context.newCDPSession(page);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(`${m.type()}: ${m.text()}`); });
  url.searchParams.set('fresh', '1');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR, null, { timeout: 90000 });
  const bootError = await page.evaluate(() => window.__RIPE_ERROR ?? null); if (bootError) throw new Error(bootError);
  await page.evaluate(() => {
    const g = window.__GAME;
    const observer = window.__normalSession = { events: [], offs: [], recorder: null, blob: null, endedAt: null };
    for (const name of ['fruit:grabbed', 'fruit:stowed', 'fruit:dropped', 'fruit:sold', 'island:event',
      'money:changed', 'ui:toast', 'player:ragdoll', 'audio:sfx']) observer.offs.push(g.bus.on(name, payload => {
      if (name === 'audio:sfx' && !['gullSquawk', 'mervMutter'].includes(payload.name)) return;
      observer.events.push({ name, gameSeconds: g.clock.elapsed, payload: JSON.parse(JSON.stringify(payload)) });
    }));
  });
  await lock();
  await page.waitForFunction(() => window.__GAME.get('audio').ctx?.state === 'running', null, { timeout: 5000 });
  start = Date.now(); deadline = start + requested * 1000;
  recording = await page.evaluate(seconds => {
    const a = window.__GAME.get('audio'), o = window.__normalSession;
    const destination = a.ctx.createMediaStreamDestination();
    // Compressor is after master gain. Keep the actual game's volume mix;
    // --mute-audio suppresses physical output without zeroing this capture.
    a.compressor.connect(destination); o.audioSource = a.compressor; o.destination = destination;
    const stream = document.querySelector('#view').captureStream(8);
    destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
    const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm'].find(MediaRecorder.isTypeSupported);
    if (!mimeType) throw new Error('No supported WebM MediaRecorder format');
    const chunks = [], recorder = o.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 240000, audioBitsPerSecond: 96000 });
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => { o.blob = new Blob(chunks, { type: mimeType }); o.endedAt = performance.now(); };
    recorder.start(1000); o.startedAt = performance.now();
    o.timer = setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, seconds * 1000);
    const gl = document.querySelector('#view').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return { mimeType, build: document.querySelector('script[type="module"][src]')?.getAttribute('src'),
      audioTracks: stream.getAudioTracks().length, videoTracks: stream.getVideoTracks().length,
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable', width: 320, height: 180,
      outputMutedByBrowser: true, audioTap: 'post-master compressor output', canvasOnlyVideo: true };
  }, requested);
  log('session-start', { requestedSeconds: requested, recording });
  await read();
  if (alive() && await route(true)) {
    await harvest(7);
    if (alive() && (await read()).carrying >= 0) {
      stage = 'leave-loose-fruit-for-gull';
      if (await go([-15, 0, 26], { radius: 1, seconds: 15 })) {
        const before = await read(); await aim(0, -.5); await press('q');
        const after = await read(); beats.leftLooseFruit = after.fruit.some(f => f.id === before.carrying && f.state === 'free');
        log('loose-fruit', { id: before.carrying, confirmedFree: beats.leftLooseFruit });
        await go([-7, 0, 32], { radius: 1, seconds: 15 });
        const waitUntil = Math.min(deadline, Date.now() + 18000);
        while (alive() && Date.now() < waitUntil && !beats.gullPeck) { await read(); await wait(700); }
      }
    }
    if (alive() && await route(false)) await sell();
    if (alive() && await route(true)) await harvest(6);
  }
  // Continue in the same uninterrupted world. Normal scheduling chooses when
  // an order arrives; failed/missed beats remain missing in the report.
  while (alive()) {
    const s = await read(), event = s.director.event;
    if (!s.director.firstSale && s.basket.length + (s.carrying >= 0 ? 1 : 0) > 0) {
      // A missed waypoint must not strand the route before order eligibility.
      if (s.targetKind === 'sell' || await route(false)) await sell();
      if (alive()) await route(true);
    } else if (event.kind === 'order' && event.phase === 'active') {
      stage = 'fulfil-natural-rush-order';
      if (s.basket.length + (s.carrying >= 0 ? 1 : 0) < event.goal - event.progress) {
        if (distance(s.pos, [-24, 0, 22]) > 30) await route(true);
        await harvest(event.goal - event.progress, Math.min(45, Math.max(0, event.remaining - 25)));
      }
      if (alive() && await route(false)) await sell();
      if (alive()) await route(true);
    } else if (s.basket.length + (s.carrying >= 0 ? 1 : 0) < 6 && distance(s.pos, [-24, 0, 22]) < 30) {
      await harvest(6, 15);
    } else {
      stage = 'watch-natural-events';
      // Look toward a live event or the nearby orchard without moving fruit.
      const target = event.phase !== 'idle' ? event.at : [-24, s.pos[1] + 2, 22];
      if (alive()) await aim(Math.atan2(-(target[0] - s.pos[0]), -(target[2] - s.pos[2])), -.05);
      await wait(1500);
    }
  }
  finishedPlan = true;
} catch (error) {
  failures.push(String(error.stack || error)); log('runner-error', { error: String(error) });
} finally {
  if (page) {
    try { await release(); } catch { /* preserve first failure */ }
    try { await read(); } catch (e) { failures.push(`Final observation: ${e.message}`); }
    try {
      const media = await page.evaluate(async () => {
        const o = window.__normalSession; if (!o?.recorder) return null;
        clearTimeout(o.timer); if (o.recorder.state !== 'inactive') o.recorder.stop();
        for (let n = 0; !o.blob && n < 100; n++) await new Promise(r => setTimeout(r, 50));
        if (!o.blob) throw new Error('Recorder did not finalize');
        const dataURL = await new Promise((resolve, reject) => { const r = new FileReader();
          r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(o.blob); });
        o.audioSource.disconnect(o.destination); o.recorder.stream.getTracks().forEach(t => t.stop());
        o.offs.forEach(off => off());
        return { dataURL, bytes: o.blob.size, durationSeconds: (o.endedAt - o.startedAt) / 1000 };
      });
      if (media) {
        const marker = media.dataURL.lastIndexOf(';base64,');
        const encoded = marker >= 0 ? media.dataURL.slice(marker + 8) : '';
        if (!encoded || !/^[A-Za-z0-9+/=]+$/.test(encoded)) throw new Error(`Recorder did not return valid base64 (${media.bytes} bytes)`);
        const bytes = Buffer.from(encoded, 'base64');
        if (bytes.length !== media.bytes || bytes.subarray(0, 4).toString('hex') !== '1a45dfa3') throw new Error('Invalid WebM payload');
        writeFileSync(path.join(OUT, 'session.webm'), bytes);
        recording = { ...recording, bytes: bytes.length, recordedSeconds: media.durationSeconds, file: 'session.webm', validBase64AndWebMHeader: true };
      }
    } catch (e) { failures.push(`Recording export: ${e.message}`); }
  }
  const missing = Object.entries(beats).filter(([, ok]) => !ok).map(([name]) => name);
  const report = { requestedSeconds: requested, observedWallSeconds: wall(), completedDuration: finishedPlan,
    fullTenMinuteSession: requested === 600 && finishedPlan, inputPolicy: 'Trusted Playwright keyboard/mouse only; no gameplay mutations or forced events.',
    observationPolicy: 'Read-only game state plus passive bus listeners. Audio graph gets only a recorder output branch.',
    beats, missingBeats: missing, recording, failures, errors, samples,
    final: finalState ? { pos: finalState.pos, gameSeconds: finalState.gameSeconds, money: finalState.money,
      director: finalState.director, characters: finalState.characters } : null,
    limitations: ['320x180 software rendering is behavioral evidence, not visual quality or performance acceptance.',
      'Video captures the game canvas; timestamped PNGs include DOM HUD.',
      'Mock-free input run still uses read-only omniscient navigation, rather than human route discovery.',
      'Natural events or a rushed order may be missed; the runner never forces them.'] };
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ out: OUT, completedDuration: finishedPlan, beats, missingBeats: missing, failures }, null, 2));
  if (browser) await browser.close();
  if (failures.length) process.exitCode = 1;
}

