// Headless contract for the playable A/B fixture. Uses a dedicated Vite URL.
// This deliberately does not use driver.openGame(), which always adds ?fresh.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.env.RIPE_URL || 'http://127.0.0.1:5197';
const sentinel = JSON.stringify({ doNotTouch: 'real-player-auto-save' });
const browser = await chromium.launch({ headless: true,
  args: ['--disable-dev-shm-usage', '--disable-frame-rate-limit'] });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(({ sentinel }) => {
  const key = 'riperiot.save.auto';
  if (localStorage.getItem(key) === null) localStorage.setItem(key, sentinel);
  const originals = {
    getItem: Storage.prototype.getItem,
    setItem: Storage.prototype.setItem,
    removeItem: Storage.prototype.removeItem,
  };
  window.__previewAutoOps = [];
  for (const method of Object.keys(originals)) {
    Storage.prototype[method] = function (target, ...args) {
      if (target === key) window.__previewAutoOps.push(method);
      return originals[method].call(this, target, ...args);
    };
  }
}, { sentinel });

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
mkdirSync('capture/mimic-preview', { recursive: true });

async function ready(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__RIPE_READY === true || window.__RIPE_ERROR,
    null, { timeout: 90_000 });
  const failed = await page.evaluate(() => window.__RIPE_ERROR || null);
  assert.equal(failed, null, `preview boot: ${failed}`);
  await page.waitForTimeout(800);
}

async function state() {
  return page.evaluate(() => {
    const g = window.__GAME;
    const e = g.get('encounters').snapshot();
    const inv = g.get('tools');
    const v = g.get('vitals');
    return {
      player: [g.player.position.x, g.player.position.z, g.player.yaw, g.player.pitch],
      health: v.health, money: g.get('economy').money,
      owned: [...inv.owned].sort(), slots: [...inv.slots], active: inv.activeId,
      encounter: e.encounters.map(x => ({ kind: x.kind, pos: x.position,
        heading: x.heading, phase: x.phase, health: x.health, timeLeft: x.timeLeft })),
      projectiles: e.projectiles.length,
      hasSaveSystem: g.has('save'),
      sellPad: [g.get('world').sellPad.x, g.get('world').sellPad.z],
      saveValue: localStorage.getItem('riperiot.save.auto'),
      autoOps: [...window.__previewAutoOps],
      selector: document.querySelector('.mimic-compare')?.textContent,
      selected: document.querySelector('.mimic-compare [aria-current="page"]')?.textContent,
    };
  });
}

function fixture(s, label) {
  assert.equal(s.hasSaveSystem, false, `${label}: no SaveSystem in comparison`);
  assert.equal(s.saveValue, sentinel, `${label}: normal auto save untouched`);
  // state() itself reads the sentinel; exclude that one deliberate test read.
  assert.deepEqual(s.autoOps, ['getItem'], `${label}: game never accessed auto save`);
  assert.equal(s.health, 100, `${label}: full health`);
  assert.equal(s.money, 0, `${label}: empty bank`);
  assert.deepEqual(s.encounter.map(x => x.kind), ['mimic'], `${label}: only Mimic active`);
  assert.equal(s.encounter[0].health, 3, `${label}: full Mimic health`);
  assert.equal(s.encounter[0].phase, 'idle', `${label}: waiting for pointer lock`);
  assert.ok(s.owned.includes('hand') && s.owned.includes('aircannon'),
    `${label}: mallet and Air Cannon available`);
  assert.equal(s.active, 'hand', `${label}: same starting tool`);
  assert.equal(s.projectiles, 0);
  assert.deepEqual(s.sellPad, [-7.5, 27.5], `${label}: nearby orchard delivery`);
  assert.ok(Math.abs(s.player[0] + 11) < .2 && Math.abs(s.player[1] - 24) < .2,
    `${label}: fixed orchard start ${s.player}`);
}

try {
  await ready(`${base}/?mimicCompare=A`);
  let a = await state();
  fixture(a, 'A');
  assert.match(a.selected, /Polygonal/);
  await page.screenshot({ path: 'capture/mimic-preview/selector-A.png' });
  await page.waitForTimeout(1100);
  assert.equal((await state()).encounter[0].phase, 'idle', 'Mimic waits before first pointer lock');
  await page.locator('#view').click({ position: { x: 640, y: 360 } });
  await page.waitForFunction(() => window.__GAME.get('encounters').snapshot()
    .encounters[0].phase !== 'idle', null, { timeout: 5000 });
  console.log('PASS A starts only after pointer lock');

  // Disturb every reset invariant, then use the visible comparison shortcut.
  await page.evaluate(() => {
    const g = window.__GAME;
    g.get('vitals').damage(24, 'comparison-test');
    g.get('economy').add(91, 'comparison-test');
    g.get('tools').give('ropegun');
  });
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.keyboard.press('KeyR')]);
  await page.waitForFunction(() => window.__RIPE_READY === true, null, { timeout: 90_000 });
  a = await state();
  fixture(a, 'A reset');
  assert.match(a.selected, /Polygonal/);
  console.log('PASS reset restores health, money, tools, pose and Mimic');

  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.keyboard.press('KeyV')]);
  await page.waitForFunction(() => window.__RIPE_READY === true, null, { timeout: 90_000 });
  const b = await state();
  fixture(b, 'B');
  assert.match(b.selected, /Block built/);
  await page.screenshot({ path: 'capture/mimic-preview/selector-B.png' });
  assert.deepEqual({ ...a, selected: null, selector: null },
    { ...b, selected: null, selector: null }, 'A and B start from identical model/player/gear state');
  console.log('PASS A/B matched fixture and unchanged real auto save');

  // Place a prize through the normal FruitSystem/InteractionSystem ownership
  // path, then use the actual E key on the orchard pad to complete the sale.
  await page.locator('#view').click({ position: { x: 640, y: 360 } });
  const held = await page.evaluate(() => {
    const g = window.__GAME;
    const spot = g.get('world').groundAt(-7.5, 27.5, 0.15);
    g.player.teleport(spot);
    const fruit = g.get('fruit').spawnFree('watermelon', spot.clone().add({ x: 0, y: 1.2, z: 0 }));
    return g.get('interaction').pickUp(fruit);
  });
  assert.equal(held, true, 'prize is carried using ordinary pickup ownership');
  await page.waitForFunction(() => window.__GAME.get('interaction').targetKind === 'sell',
    null, { timeout: 4000 });
  await page.screenshot({ path: 'capture/mimic-preview/orchard-sale.png' });
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__GAME.get('economy').money > 0,
    null, { timeout: 4000 });
  assert.equal(await page.evaluate(() => window.__GAME.get('interaction').carried), null,
    'ordinary E sale releases the carried prize');
  console.log('PASS orchard pad accepts carried watermelon through normal E sale');

  // A real solo failure first self-recovers, then evacuates. The comparison
  // route must return to this same orchard pose instead of the normal dock.
  await page.evaluate(() => window.__GAME.get('vitals').damage(100, 'comparison-test'));
  await page.waitForFunction(() => {
    const v = window.__GAME.get('vitals');
    return !v.downed && v.soloRecoveries === 1;
  }, null, { timeout: 8000 });
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }),
    page.evaluate(() => window.__GAME.get('vitals').damage(100, 'comparison-test'))]);
  await page.waitForFunction(() => window.__RIPE_READY === true, null, { timeout: 90_000 });
  fixture(await state(), 'B after evacuation');
  console.log('PASS failed solo fight returns to the fixed orchard fixture');
  assert.deepEqual(errors, [], `no page errors: ${errors.join('; ')}`);
} finally {
  await browser.close();
}
