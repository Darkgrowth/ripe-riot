import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.RIPE_URL || 'http://127.0.0.1:5203';
const browser = await chromium.launch({ headless: true });
try {
  for (const [query, expected] of [['', 'baseline'], ['?voxelPilot=1', 'voxel']]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(`${base}/${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__RIPE_READY === true || Boolean(window.__RIPE_ERROR), { timeout: 60000 });
    const state = await page.evaluate(() => ({ ready: window.__RIPE_READY, error: window.__RIPE_ERROR,
      visualMode: window.__RIPE_VISUAL_MODE }));
    assert.equal(response?.status(), 200, `${query} HTTP status`);
    assert.equal(state.error, undefined, `${query} boot error`);
    assert.equal(state.ready, true, `${query} ready`);
    assert.equal(state.visualMode, expected, `${query} visual mode`);
    assert.deepEqual(errors, [], `${query} browser errors`);
    console.log(`${query || 'default'}: ready, ${state.visualMode}, no page errors`);
    await page.close();
  }
} finally {
  await browser.close();
}
