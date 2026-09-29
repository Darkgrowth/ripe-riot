/** Focused shell QA on an isolated local preview; never opens a headed page. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const base = process.env.RIPE_URL;
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base))
  throw new Error('Set RIPE_URL to an isolated local preview.');
const out = process.env.RIPE_CAPTURE ?? 'capture/sunpatch-expedition/shell-qa';
const width = Number(process.env.RIPE_WIDTH ?? 3440);
const height = Number(process.env.RIPE_HEIGHT ?? 1440);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: [
  '--disable-dev-shm-usage', '--mute-audio', '--use-gl=angle', '--use-angle=d3d11',
] });
const context = await browser.newContext({ viewport: { width, height } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
async function press(name) {
  const rect = await page.getByRole('button', { name }).boundingBox();
  assert.ok(rect, `${name} button visible`);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

async function state(label) {
  const value = await page.evaluate(() => {
    const g = window.__GAME;
    const shell = g.get('expeditionShell');
    const save = g.get('save');
    const rect = document.querySelector('.expedition-card').getBoundingClientRect();
    return { label: '', open: shell.open, mode: shell.mode, paused: g.clock.paused,
      inputEnabled: g.input.enabled, pointerLocked: g.input.pointerLocked,
      slot: save.slot, saved: save.exists(), activeSlot: localStorage.getItem('riperiot.save.activeSlot'),
      soundOpen: document.querySelector('.audio-settings').open,
      card: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom },
      chapter: g.get('progress').chapterState,
      title: document.querySelector('.expedition-card h1').textContent,
      build: document.querySelector('.expedition-build').textContent };
  });
  value.label = label;
  console.log(JSON.stringify(value));
  assert.ok(value.card.x >= 0 && value.card.y >= 0
    && value.card.right <= width && value.card.bottom <= height, `${label} card fits viewport`);
  return value;
}

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__RIPE_READY && window.__GAME?.has('expeditionShell')), { timeout: 60_000 });
  await page.waitForTimeout(200);
  let s = await state('title');
  assert.equal(s.open, true); assert.equal(s.mode, 'title');
  assert.equal(s.paused, true); assert.equal(s.inputEnabled, false);
  assert.match(s.build, /DEVELOPMENT BUILD/);
  await page.screenshot({ path: `${out}/title-3440x1440.png` });

  await press('Sound settings');
  s = await state('sound'); assert.equal(s.soundOpen, true);
  await press('Controls');
  assert.equal(await page.locator('.expedition-controls').isVisible(), true);
  await press(s.saved ? 'Continue expedition' : 'Begin expedition');
  await page.waitForTimeout(600);
  s = await state('begun');
  if (!s.pointerLocked) console.log(JSON.stringify({ label: 'pointer-lock-errors', errors }));
  assert.equal(s.open, false); assert.equal(s.paused, false); assert.equal(s.inputEnabled, true);
  assert.equal(s.pointerLocked, true);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  s = await state('paused');
  assert.equal(s.open, true); assert.equal(s.mode, 'pause'); assert.equal(s.paused, true);
  await page.screenshot({ path: `${out}/pause-3440x1440.png` });
  await press('Resume expedition');
  await page.waitForTimeout(200);
  s = await state('resumed');
  assert.equal(s.open, false); assert.equal(s.paused, false); assert.equal(s.pointerLocked, true);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await press('Expedition menu');
  s = await state('menu'); assert.equal(s.mode, 'title');
  await page.evaluate(() => window.__GAME.get('save').save('auto'));
  await press('New expedition · separate save');
  await page.waitForURL(/saveSlot=replay-/);
  await page.waitForFunction(() => Boolean(window.__RIPE_READY && window.__GAME?.has('expeditionShell')), { timeout: 60_000 });
  s = await state('new-replay');
  assert.match(s.slot, /^replay-/); assert.equal(s.activeSlot, s.slot);
  assert.equal(s.saved, false);
  assert.equal(await page.evaluate(() => window.__GAME.get('save').exists('auto')), true);
  assert.equal(await page.getByRole('button', { name: 'Original expedition' }).isVisible(), true);
  await press('Original expedition');
  await page.waitForURL(/saveSlot=auto/);
  await page.waitForFunction(() => Boolean(window.__RIPE_READY && window.__GAME?.has('expeditionShell')), { timeout: 60_000 });
  s = await state('original'); assert.equal(s.slot, 'auto'); assert.equal(s.saved, true);

  await page.evaluate(() => {
    const p = window.__GAME.get('progress');
    p.applyChapterState({ state: 'return', results: null });
    p.applyChapterState({ state: 'settled', results: { payout: 9500, money: 10000,
      lifetimeEarned: 12000, fruitSold: 21, discovered: 7, bestSale: 850,
      playtime: 1800, settledAt: 1700 } });
  });
  s = await state('results'); assert.equal(s.mode, 'results');
  assert.equal(s.chapter, 'settled');
  assert.match(await page.locator('.expedition-results').innerText(), /9,500/);
  await page.screenshot({ path: `${out}/results-3440x1440.png` });
  assert.deepEqual(errors, []);
  console.log('expedition-shell-runtime: PASS');
} finally {
  await browser.close();
}
