/** Matched first-person field-of-view captures on an isolated headless page. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.RIPE_URL || 'http://127.0.0.1:5212';
const out = path.resolve(process.env.RIPE_OUT || 'docs/evidence/voxel-route-pass');
const views = [
  ['dock-arrival', 58, 62, 45, 52],
  ['shop-approach', 48, 58, 20, 44],
  ['orchard-entry', -1, 38, -22, 24],
];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--mute-audio', '--use-gl=angle', '--use-angle=d3d11'] });
const captures = [];
try {
  for (const mode of ['baseline', 'voxel']) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const query = mode === 'voxel' ? '&voxelPilot=1' : '';
    await page.goto(`${base}/?fresh=1${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR,
      null, { timeout: 90000 });
    const bootError = await page.evaluate(() => window.__RIPE_ERROR ?? null);
    if (bootError) throw new Error(`${mode}: ${bootError}`);
    await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'),
      null, { timeout: 30000 });
    await page.mouse.click(960, 540);
    await page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 5000 });
    const dir = path.join(out, mode);
    mkdirSync(dir, { recursive: true });
    for (const [name, x, z, tx, tz] of views) {
      await page.evaluate(([x, z, tx, tz]) => window.__RIPE.freeCam(
        x, window.__RIPE.terrainHeight(x, z) + 1.7, z,
        tx, window.__RIPE.terrainHeight(tx, tz) + 1.7, tz), [x, z, tx, tz]);
      await page.waitForTimeout(450);
      await page.screenshot({ path: path.join(dir, `${name}.png`) });
      const state = await page.evaluate(() => window.__RIPE.state());
      captures.push({ mode, name, render: state.render, errors: [...errors] });
      console.log(`${mode} ${name}: ${state.render.drawCalls} calls, `
        + `${state.render.triangles} triangles, ${errors.length} errors`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ base, views, captures }, null, 2));
}
