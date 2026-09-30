/**
 * Fresh title -> ordinary walking -> Snapjaw bite, hold, fling and recovery.
 * Reads state for navigation/evidence. All movement uses real Playwright input;
 * no debug action, teleport or synthetic input enters the route.
 *
 * RIPE_URL=http://127.0.0.1:5278 node tools/harness/snapjaw-solo-proof.mjs \
 *   --out C:/path/to/evidence --video --allow-browser-input
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
if (!args.includes('--allow-browser-input'))
  throw new Error('Browser pointer input is disabled during active play. Run only after the user says play is over, with --allow-browser-input.');
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1];
};
const base = process.env.RIPE_URL;
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base))
  throw new Error('Set RIPE_URL to an isolated local server.');
const width = Number(option('--width', '1712'));
const height = Number(option('--height', '634'));
const out = path.resolve(option('--out', 'capture/sunpatch-chaos/snapjaw-solo'));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage',
  '--mute-audio', '--use-gl=angle', '--use-angle=d3d11'] });
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1,
  ...(args.includes('--video') ? { recordVideo: { dir: out, size: { width, height } } } : {}) });
const page = await context.newPage();
const started = Date.now(), deadline = started + 180000;
const timeline = [], errors = [], shots = [];
let mouseX = width / 2, mouseY = height / 2, failure = null;
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const angleDelta = a => Math.atan2(Math.sin(a), Math.cos(a));
const alive = () => Date.now() < deadline;
const log = (kind, data = {}) => {
  const row = { wallSeconds: +((Date.now() - started) / 1000).toFixed(2),
    kind, ...data }; timeline.push(row); console.log(JSON.stringify(row));
};
const shot = async name => { await page.screenshot({ path: path.join(out, `${name}.png`) });
  shots.push(name); };
async function read() {
  const value = await page.evaluate(() => {
    const g = window.__GAME;
    const p = g.player, jaw = g.get('encounters').snapshot();
    return { pos: p.position.toArray(), eye: p.eyePosition.toArray(),
      yaw: p.yaw, pitch: p.pitch, state: p.state,
      speed: p.velocity.toArray(), health: g.get('vitals').health,
      downed: g.get('vitals').downed,
      synthetic: g.input.synthetic !== null,
      visualMode: window.__RIPE_VISUAL_MODE,
      sensitivity: g.input.sensitivity, invertY: g.input.invertY,
      snapjaw: jaw.encounters.find(e => e.kind === 'snapjaw'),
      flights: jaw.flights ?? [], revision: jaw.revision,
      events: window.__snapjawProof?.events ?? [] };
  });
  if (value.synthetic || value.visualMode !== 'voxel')
    throw new Error('Ordinary voxel input was not active.');
  return value;
}
async function lock() {
  if (await page.evaluate(() => !!document.pointerLockElement)) return;
  await page.mouse.click(width / 2, height / 2);
  await page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 5000 });
  await page.mouse.move(++mouseX, mouseY);
  await sleep(80);
}
async function aim(point) {
  await lock();
  for (let n = 0; n < 18 && alive(); n++) {
    const s = await read(), dx = point[0] - s.eye[0], dz = point[2] - s.eye[2];
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(point[1] - s.eye[1], Math.hypot(dx, dz));
    const dyaw = angleDelta(yaw - s.yaw), dpitch = pitch - s.pitch;
    if (Math.abs(dyaw) < .02 && Math.abs(dpitch) < .02) return true;
    const sensitivity = s.sensitivity || .0022;
    mouseX += Math.max(-160, Math.min(160, -dyaw / sensitivity));
    mouseY += Math.max(-120, Math.min(120,
      -dpitch / (sensitivity * (s.invertY ? -1 : 1))));
    await page.mouse.move(mouseX, mouseY); await sleep(70);
  }
  return false;
}
async function go(point, radius = 1.4, seconds = 40) {
  const until = Math.min(deadline, Date.now() + seconds * 1000);
  let previous = null, stuck = 0;
  log('waypoint', { point, radius });
  while (alive() && Date.now() < until) {
    const s = await read(), d = dist(s.pos, point);
    if (d <= radius) return true;
    if (s.state !== 'active') { await sleep(120); continue; }
    await aim([point[0], s.eye[1] - .04 * d, point[2]]);
    await page.keyboard.down('w'); await page.keyboard.down('Shift');
    await sleep(Math.min(250, Math.max(80, (d - radius) / 8.4 * 1000)));
    await page.keyboard.up('w'); await page.keyboard.up('Shift');
    const next = await read();
    if (dist(next.pos, point) <= radius) return true;
    const vx = next.pos[0] - s.pos[0], vz = next.pos[2] - s.pos[2];
    const lengthSq = vx * vx + vz * vz;
    const along = lengthSq > 0 ? Math.max(0, Math.min(1,
      ((point[0] - s.pos[0]) * vx + (point[2] - s.pos[2]) * vz) / lengthSq)) : 0;
    if (Math.hypot(point[0] - s.pos[0] - vx * along,
      point[2] - s.pos[2] - vz * along) <= radius) return true;
    if (previous && dist(previous, next.pos) < .22) stuck++; else stuck = 0;
    previous = next.pos;
    if (stuck >= 2) {
      await page.keyboard.down(stuck % 2 ? 'a' : 'd');
      await page.keyboard.press('Space'); await sleep(250);
      await page.keyboard.up(stuck % 2 ? 'a' : 'd');
      if (stuck > 6) break;
    }
  }
  log('waypoint-missed', { point, pos: (await read()).pos });
  return false;
}

try {
  await page.goto(`${base}/?voxelPilot=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR,
    null, { timeout: 90000 });
  const bootError = await page.evaluate(() => window.__RIPE_ERROR ?? null);
  if (bootError) throw new Error(`Boot failed: ${bootError}`);
  await page.locator('[data-expedition-action="new-replay"]').click();
  await sleep(1200);
  await page.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR,
    null, { timeout: 90000 });
  await page.locator('[data-expedition-action="continue"]').click();
  await page.locator('.expedition-shell').waitFor({ state: 'hidden', timeout: 5000 });
  await page.evaluate(() => {
    const g = window.__GAME;
    window.__snapjawProof = { events: [] };
    for (const name of ['encounter:attack', 'encounter:capture', 'encounter:release',
      'player:landed', 'player:ragdoll', 'player:recovered', 'player:downed'])
      g.bus.on(name, payload => window.__snapjawProof.events.push({ name,
        at: g.clock.elapsed, payload: JSON.parse(JSON.stringify(payload)) }));
  });
  await shot('00-fresh-dock'); await lock();
  for (const [x, z] of [[60,65],[55.5,61],[50.5,61.5],[44,62.5],[37.2,58.2],
    [30,54],[25,46],[11,38.6],[-3.5,31.4],[-7.5,29.5],
    [-17,25],[-23,22],[-24.4,14.5]])
    if (!await go([x, 0, z])) throw new Error(`Walking route failed near ${x},${z}`);
  await shot('01-hill-approach');
  let s = await read();
  const jaw = s.snapjaw.position;
  log('jaw-approach', { pos: s.pos, jaw });
  if (!await go([jaw[0] + 1.0, 0, jaw[2] + 1.2], .65, 18))
    throw new Error('Could not enter the real jaw bite radius');
  // Face the enemy from ordinary first-person view and wait for its own bite.
  await aim([jaw[0], jaw[1] + 1.5, jaw[2]]);
  const captureUntil = Date.now() + 12000;
  while (Date.now() < captureUntil && alive()) {
    s = await read();
    if (s.snapjaw.capturedVictimId || s.state === 'captured') break;
    await sleep(60);
  }
  if (!s.snapjaw.capturedVictimId) throw new Error('Snapjaw did not capture the player');
  log('captured', { pos: s.pos, health: s.health, state: s.state,
    aim: s.snapjaw.captureAim, timeLeft: s.snapjaw.captureTimeLeft });
  await shot('02-captured');
  await sleep(850); s = await read();
  log('held', { pos: s.pos, health: s.health, state: s.state,
    aim: s.snapjaw.captureAim, timeLeft: s.snapjaw.captureTimeLeft });
  await shot('03-held-aim');
  let fling = null;
  const flingUntil = Date.now() + 4000;
  while (Date.now() < flingUntil && alive()) {
    s = await read();
    fling = s.flights.find(f => f.victimId === 'solo');
    if (fling) break;
    await sleep(40);
  }
  if (!fling) throw new Error('Capture did not produce a numbered flight');
  log('flung', { fling, pos: s.pos, velocity: s.speed, state: s.state,
    health: s.health, jaw: s.snapjaw });
  await shot('04-flung');
  await sleep(900); s = await read();
  log('recovery', { pos: s.pos, velocity: s.speed, state: s.state,
    health: s.health, downed: s.downed });
  await shot('05-recovery');
  await sleep(1200); s = await read();
  log('after-recovery', { pos: s.pos, velocity: s.speed,
    state: s.state, health: s.health, downed: s.downed });
  await shot('06-after-recovery');
  if (s.downed || s.health <= 0) throw new Error('The solo throw was not recoverable');
} catch (error) {
  failure = String(error.stack || error);
  log('runner-error', { failure });
} finally {
  try { await page.keyboard.up('w'); await page.keyboard.up('Shift');
    await page.keyboard.up('a'); await page.keyboard.up('d'); } catch { /* page may have closed */ }
  let videoPath = null;
  const video = page.video();
  await context.close();
  if (video) {
    videoPath = path.join(out, 'snapjaw-solo.webm');
    copyFileSync(await video.path(), videoPath);
  }
  await browser.close();
  const report = { passed: !failure, failure, viewport: [width, height],
    durationSeconds: +((Date.now() - started) / 1000).toFixed(2),
    shots, videoPath, errors, timeline };
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, failure,
    durationSeconds: report.durationSeconds, out, errors }));
  if (failure) process.exitCode = 1;
}
