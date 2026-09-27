import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.RIPE_URL || 'http://127.0.0.1:5205';
const out = path.resolve(process.env.RIPE_OUT || 'docs/evidence/voxel-art-polish');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--use-gl=angle', '--use-angle=d3d11'] });
const captures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning')
      errors.push(`${message.type()}: ${message.text()}`);
  });
  await page.goto(`${base}/?fresh=1&voxelPilot=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR,
    null, { timeout: 90000 });
  const bootError = await page.evaluate(() => window.__RIPE_ERROR ?? null);
  if (bootError) throw new Error(bootError);
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'),
    null, { timeout: 30000 });
  await page.mouse.click(960, 540);
  await page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 5000 });
  const views = [
    ['orchard-path', [-14, 32, -25, 23]],
    ['orchard-crowns', [-30, 30, -19, 19]],
    ['orchard-return', [-23, 17, -11, 30]],
  ];
  for (const [name, [x, z, tx, tz]] of views) {
    await page.evaluate(([x, z, tx, tz]) => window.__RIPE.freeCam(
      x, window.__RIPE.terrainHeight(x, z) + 2.0, z,
      tx, window.__RIPE.terrainHeight(tx, tz) + 2.5, tz), [x, z, tx, tz]);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    const state = await page.evaluate(() => window.__RIPE.state());
    captures.push({ name, render: state.render, errors: [...errors] });
    console.log(name, state.render.drawCalls, state.render.triangles, errors.length);
  }
  await page.close();
} finally {
  await browser.close();
  writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ base, captures }, null, 2));
}
