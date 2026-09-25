/**
 * Normal-input Mimic comparison. Reads state for navigation/observations, but
 * never calls debug actions, changes game objects, or injects synthetic input.
 * Example: RIPE_URL=http://127.0.0.1:5197 node tools/harness/mimic-fight.mjs A 1280 720
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [style = 'A', widthText = '1280', heightText = '720', strategy = 'mixed'] = process.argv.slice(2);
if (!['A', 'B'].includes(style)) throw new Error('Choose A or B');
if (!['mixed', 'air'].includes(strategy)) throw new Error('Choose mixed or air');
const width = Number(widthText), height = Number(heightText);
const base = process.env.RIPE_URL;
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base))
  throw new Error('Set RIPE_URL to the dedicated local comparison server.');
const dir = path.resolve('capture/mimic-comparison',
  `${style}-${width}x${height}${strategy === 'air' ? '-air-only' : ''}`);
mkdirSync(dir, { recursive: true });
const video = process.env.MIMIC_VIDEO === '1';
const browser = await chromium.launch({ headless: true,
  args: ['--disable-dev-shm-usage', '--disable-frame-rate-limit'] });
const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1,
  ...(video ? { recordVideo: { dir, size: { width, height } } } : {}) });
const page = await ctx.newPage();
const errors = [], warnings = [], timeline = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => {
  if (m.type() === 'error') errors.push(m.text());
  if (m.type() === 'warning') warnings.push(m.text());
});
let mouseX = width / 2, mouseY = height / 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const delta = a => Math.atan2(Math.sin(a), Math.cos(a));
const log = (kind, data = {}) => {
  const entry = { wall: new Date().toISOString(), kind, ...data };
  timeline.push(entry); console.log(JSON.stringify(entry));
};
async function snap(name) {
  await page.screenshot({ path: path.join(dir, `${name}.png`), timeout: 20000 });
}
async function read() {
  return page.evaluate(() => {
    const g = window.__GAME, p = g.player, e = g.get('encounters').snapshot().encounters[0];
    const i = g.get('interaction'), v = g.get('vitals');
    return { time: g.clock.elapsed, pos: p.position.toArray(), eye: p.eyePosition.toArray(),
      yaw: p.yaw, pitch: p.pitch, state: p.state, health: v.health,
      enemy: { pos: e.position, phase: e.phase, health: e.health, timeLeft: e.timeLeft },
      activeTool: g.get('tools').activeId, carried: i.carried?.fruit.id ?? null,
      carriedSpecies: i.carried?.fruit.species ?? null,
      basket: i.basket.items.map(f => f.id), targetKind: i.targetKind,
      targetId: i.target?.id ?? null, nearSellPad: i.nearSellPad,
      sellPad: g.get('world').sellPad.toArray(),
      money: g.get('economy').money,
      prize: [...g.get('fruit').fruits.values()]
        .filter(f => f.species === 'watermelon' && f.state === 'free')
        .map(f => ({ id: f.id, pos: f.position.toArray(), radius: f.radius,
          speed: f.speed })),
      synthetic: g.input.synthetic !== null, locked: g.input.pointerLocked,
      sensitivity: g.input.sensitivity, invertY: g.input.invertY,
      events: window.__mimicFight.events.splice(0) };
  });
}
async function observe(label) {
  const s = await read();
  if (s.synthetic) throw new Error('Synthetic input active; invalid normal-input proof');
  log(label, s); return s;
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
  for (let n = 0; n < 18; n++) {
    const s = await read(), dx = point[0] - s.eye[0], dz = point[2] - s.eye[2];
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(point[1] - s.eye[1], Math.hypot(dx, dz));
    const dyaw = delta(yaw - s.yaw), dpitch = pitch - s.pitch;
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
  await page.keyboard.down(key); await sleep(90); await page.keyboard.up(key);
}
async function walkForward(ms) {
  await page.keyboard.down('w'); await sleep(ms); await page.keyboard.up('w');
}
async function go(point, radius = 1.2, seconds = 25) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const s = await read();
    const d = Math.hypot(point[0] - s.pos[0], point[2] - s.pos[2]);
    if (d <= radius) return true;
    if (s.state !== 'active') { await sleep(250); continue; }
    if (!await aim([point[0], s.eye[1] - .07 * d, point[2]])) {
      log('navigation-aim-failed', { pos: s.pos, yaw: s.yaw,
        target: point, mouseX, mouseY, state: await read() });
      return false;
    }
    await walkForward(Math.min(550, Math.max(120, (d - radius) / 5 * 1000)));
  }
  const final = await read();
  if (Math.hypot(point[0] - final.pos[0], point[2] - final.pos[2]) <= radius)
    return true;
  log('navigation-timeout', { target: point, state: final });
  return false;
}
async function recoverPrize() {
  let s = await waitFor(x => x.prize.some(f => f.speed < 2.5), 5500);
  const prize = s.prize.sort((a, b) =>
    Math.hypot(a.pos[0] - s.pos[0], a.pos[2] - s.pos[2])
      - Math.hypot(b.pos[0] - s.pos[0], b.pos[2] - s.pos[2]))[0];
  if (!prize) return { recovered: false, sold: false, reason: 'no free reward watermelon' };
  let carried = false;
  for (let attempt = 0; attempt < 7; attempt++) {
    s = await read();
    const live = s.prize.find(f => f.id === prize.id);
    if (!live) return { recovered: false, sold: false, reason: 'prize disappeared' };
    const dx = s.pos[0] - live.pos[0], dz = s.pos[2] - live.pos[2];
    const d = Math.hypot(dx, dz) || 1;
    if (d > 2.1) {
      const stand = [live.pos[0] + dx / d * 1.6, 0,
        live.pos[2] + dz / d * 1.6];
      if (!await go(stand, .75)) return { recovered: false, sold: false,
        reason: 'could not walk to rolling prize' };
      s = await read();
    }
    const target = s.prize.find(f => f.id === prize.id);
    if (!target) return { recovered: false, sold: false, reason: 'prize disappeared' };
    await aim(target.pos);
    await sleep(130);
    s = await observe('prize-target');
    if (s.targetKind === 'fruit' && s.targetId === prize.id) {
      await press('e');
      s = await observe('prize-carried');
      if (s.carried === prize.id) { carried = true; break; }
    }
    await sleep(250);
  }
  if (!carried) return { recovered: false, sold: false,
    reason: 'E did not carry the moving prize after seven attempts' };
  await snap('05-prize');
  if (!await go(s.sellPad, 2.4, 90))
    return { recovered: true, sold: false, reason: 'could not reach orchard sell pad' };
  s = await observe('at-sell-pad');
  if (s.targetKind !== 'sell') return { recovered: true, sold: false,
    reason: `sell prompt absent: ${s.targetKind}` };
  const before = s.money;
  await press('e');
  s = await observe('sold');
  await snap('06-sold');
  return { recovered: true, sold: s.money > before && s.carried === null,
    saleDelta: s.money - before };
}
async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await read();
    if (predicate(s)) return s;
    await sleep(120);
  }
  return observe('wait-timeout');
}

let result = null;
try {
  await page.goto(`${base}/?mimicCompare=${style}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR,
    null, { timeout: 90000 });
  const bootError = await page.evaluate(() => window.__RIPE_ERROR ?? null);
  if (bootError) throw new Error(bootError);
  await page.evaluate(() => {
    const g = window.__GAME;
    const observer = window.__mimicFight = { events: [] };
    for (const name of ['encounter:attack', 'encounter:defeated', 'money:changed',
      'fruit:grabbed', 'fruit:stowed', 'fruit:sold', 'tool:fired'])
      g.bus.on(name, payload => observer.events.push({ name, time: g.clock.elapsed,
        payload: JSON.parse(JSON.stringify(payload)) }));
  });
  await observe('start');
  await snap('01-entry');
  await lock();
  let tookHit = false;
  if (strategy === 'mixed') {
    // Advance with the starter mallet into the committed lunge, accept one
    // mistake/hit, then interrupt the recovery with a direct melee strike.
    await walkForward(650);
    const inRange = await waitFor(x => {
      const dx = x.enemy.pos[0] - x.pos[0], dz = x.enemy.pos[2] - x.pos[2];
      return dx < 0 && Math.hypot(dx, dz) < 2.75;
    }, 7000);
    if (!(inRange.enemy.pos[0] < inRange.pos[0]
      && Math.hypot(inRange.enemy.pos[0] - inRange.pos[0],
        inRange.enemy.pos[2] - inRange.pos[2]) < 2.75))
      throw new Error('Mimic never entered frontal mallet reach');
    await page.mouse.down(); await sleep(100); await page.mouse.up();
    const struck = await observe('mallet-strike');
    if (struck.enemy.health !== 2) throw new Error('Normal-input mallet strike missed');
    tookHit = struck.health < 100;
    await press('Digit2');
    await page.mouse.down(); await sleep(230); await page.mouse.up();
  } else {
    // The fresh fixture faces the Mimic down the open lane. Fire from that
    // starting sightline, then retarget after recoil for the second shot.
    await press('Digit2');
    await page.mouse.down(); await sleep(230); await page.mouse.up();
    const first = await observe('air-opening');
    if (first.enemy.health !== 1) throw new Error('First normal-input Air Cannon shot missed');
    await waitFor(x => x.time >= first.time + 0.65, 6000);
    const enemy = await read();
    if (!await aim([enemy.enemy.pos[0], enemy.enemy.pos[1] + 1.15,
      enemy.enemy.pos[2]])) throw new Error('Could not aim second ranged shot');
    await page.mouse.down(); await sleep(230); await page.mouse.up();
    tookHit = enemy.health < 100;
  }
  const s = await observe('fight-end');
  if (s.enemy.health !== 0) throw new Error('Normal-input Air Cannon finish missed');
  await snap('04-defeat');
  const delivery = s.enemy.health === 0 ? await recoverPrize() : null;
  result = { strategy, tookHit, defeated: s.enemy.health === 0, delivery, money: s.money,
    errors, warnings, final: s, timeline };
} catch (e) {
  log('runner-error', { error: String(e.stack || e) });
  result = { failure: String(e.stack || e), errors, warnings, timeline };
} finally {
  const v = page.video();
  await ctx.close();
  if (v) {
    const tmp = await v.path();
    const { copyFileSync, unlinkSync } = await import('node:fs');
    copyFileSync(tmp, path.join(dir, 'fight.webm'));
    unlinkSync(tmp);
  }
  await browser.close();
  writeFileSync(path.join(dir, 'report.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ out: dir, tookHit: result?.tookHit,
    defeated: result?.defeated, delivery: result?.delivery,
    failure: result?.failure, errors }, null, 2));
  if (result?.failure || !result?.defeated || !result?.delivery?.sold || errors.length)
    process.exitCode = 1;
}
