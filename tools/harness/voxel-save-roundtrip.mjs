/** Isolated browser profile: one saved slot survives baseline -> pilot -> baseline. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.RIPE_URL || 'http://127.0.0.1:5203';
if (base !== 'http://127.0.0.1:5203')
  throw new Error('Use the isolated pilot server on port 5203.');
const out = path.resolve('docs/evidence/detailed-voxel-clearing/save-roundtrip.json');
const browser = await chromium.launch({ headless: true,
  args: ['--use-gl=angle', '--use-angle=d3d11'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
const errors = [], visits = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
});

async function visit(query, expectedMode, expectedMoney, expectedResumed) {
  const response = await page.goto(`${base}/${query}`, { waitUntil: 'domcontentloaded' });
  assert.equal(response?.status(), 200);
  await page.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR,
    null, { timeout: 90000 });
  const state = await page.evaluate(() => ({
    error: window.__RIPE_ERROR ?? null,
    mode: window.__RIPE_VISUAL_MODE,
    money: window.__GAME.get('economy').money,
    resumed: window.__GAME.get('save').resumed,
    saved: window.__GAME.get('save').exists('auto'),
  }));
  assert.equal(state.error, null);
  assert.equal(state.mode, expectedMode);
  assert.equal(state.money, expectedMoney);
  assert.equal(state.resumed, expectedResumed);
  visits.push({ query, ...state });
}

try {
  await visit('?fresh=1', 'baseline', 0, false);
  const baselineBlob = await page.evaluate(() => {
    window.__RIPE.call('economy.set', 321);
    if (!window.__RIPE.call('save.write', 'auto')) throw new Error('baseline save failed');
    const blob = JSON.parse(localStorage.getItem('riperiot.save.auto'));
    window.__RIPE.call('save.enable', false);
    return blob;
  });
  assert.equal(baselineBlob.version, 1);
  assert.equal(baselineBlob.systems.economy.money, 321);
  await visit('?voxelPilot=1', 'voxel', 321, true);
  const pilotBlob = await page.evaluate(() => {
    window.__RIPE.call('economy.set', 654);
    if (!window.__RIPE.call('save.write', 'auto')) throw new Error('pilot save failed');
    const blob = JSON.parse(localStorage.getItem('riperiot.save.auto'));
    window.__RIPE.call('save.enable', false);
    return blob;
  });
  assert.equal(pilotBlob.version, 1);
  assert.equal(pilotBlob.systems.economy.money, 654);
  assert.deepEqual(Object.keys(pilotBlob.systems), Object.keys(baselineBlob.systems));
  await visit('', 'baseline', 654, true);
  assert.deepEqual(errors, []);
  const report = { base, visits, schemaVersion: pilotBlob.version,
    systemKeys: Object.keys(pilotBlob.systems), errors };
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
