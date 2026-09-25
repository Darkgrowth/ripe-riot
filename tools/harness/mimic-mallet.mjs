/** Ordinary-input mallet hit followed by the existing Air Cannon alternative. */
import { chromium } from 'playwright';
import { copyFileSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const base = process.env.RIPE_URL;
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base))
  throw new Error('Set RIPE_URL to the dedicated local comparison server.');
const style = process.argv[2] ?? 'A';
if (!['A', 'B'].includes(style)) throw new Error('Choose A or B');
const out = path.resolve(`capture/mimic-comparison/mallet-plus-air-${style}`);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: out, size: { width: 1920, height: 1080 } } });
const page = await context.newPage(), timeline = [], errors = [];
page.on('pageerror', e => errors.push(e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function read(label) {
  const s = await page.evaluate(() => {
    const g = window.__GAME, p = g.player, e = g.get('encounters').snapshot().encounters[0];
    return { time: g.clock.elapsed, player: p.position.toArray(), yaw: p.yaw,
      health: g.get('vitals').health, enemy: { pos: e.position, phase: e.phase,
        health: e.health }, tool: g.get('tools').activeId,
      synthetic: g.input.synthetic !== null };
  });
  if (s.synthetic) throw new Error('Synthetic input invalidates this proof');
  if (label) { timeline.push({ label, ...s }); console.log(label, s); }
  return s;
}
let result = null;
try {
  await page.goto(`${base}/?mimicCompare=${style}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR,
    null, { timeout: 90000 });
  const bootError = await page.evaluate(() => window.__RIPE_ERROR ?? null);
  if (bootError) throw new Error(bootError);
  await read('start');
  await page.mouse.click(960, 540);
  await page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 5000 });
  await page.mouse.move(961, 540);
  await page.keyboard.down('w'); await sleep(650); await page.keyboard.up('w');
  await read('advanced');
  let inRange = null;
  const until = Date.now() + 7000;
  while (Date.now() < until) {
    const s = await read();
    const dx = s.enemy.pos[0] - s.player[0], dz = s.enemy.pos[2] - s.player[2];
    if (dx < 0 && Math.hypot(dx, dz) < 2.75) { inRange = s; break; }
    await sleep(60);
  }
  if (!inRange) throw new Error('Mimic never entered the frontal mallet reach');
  await page.mouse.down(); await sleep(100); await page.mouse.up();
  const struck = await read('mallet-strike');
  if (struck.enemy.health !== 2) throw new Error(`Mallet failed: health ${struck.enemy.health}`);
  await page.keyboard.press('Digit2');
  await sleep(150);
  // The knockback leaves the target on the same authored sightline.
  await page.mouse.down(); await sleep(230); await page.mouse.up();
  const finished = await read('air-finish');
  if (finished.enemy.health !== 0) throw new Error(`Air Cannon failed: health ${finished.enemy.health}`);
  result = { normalInput: true, malletDamage: 1, airDamage: 2,
    defeated: true, timeline, errors };
} catch (e) {
  result = { failure: String(e.stack || e), timeline, errors };
} finally {
  const video = page.video();
  await context.close();
  if (video) {
    const source = await video.path();
    copyFileSync(source, path.join(out, 'mallet-plus-air.webm'));
    unlinkSync(source);
  }
  await browser.close();
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ out, result }, null, 2));
  if (result?.failure || !result?.defeated || errors.length) process.exitCode = 1;
}
