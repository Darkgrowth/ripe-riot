import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.RIPE_URL || 'http://127.0.0.1:5203';
const out = path.resolve('docs/evidence/detailed-voxel-clearing/first-look');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--use-gl=angle', '--use-angle=d3d11'] });
const captures = [];
try {
  for (const [width, height] of [[1920, 1080], [3434, 1270]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
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
    await page.bringToFront();
    await page.mouse.click(width / 2, height / 2);
    await page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 5000 });
    const threat = await page.evaluate(() => window.__RIPE.call('encounters.info').threats.mimic.pos);
    const orchard = await page.evaluate(() => ({
      entry: window.__RIPE.terrainHeight(-7, 29),
      centre: window.__RIPE.terrainHeight(-24, 22),
      near: window.__RIPE.terrainHeight(-4, 30),
    }));
    const capture = async (name) => {
      await page.waitForTimeout(450);
      const id = `${name}-${width}x${height}`;
      await page.screenshot({ path: path.join(out, `${id}.png`) });
      const state = await page.evaluate(() => window.__RIPE.state());
      captures.push({ id, viewport: [width, height], camera: state.player,
        viewmodel: state.viewmodel, render: state.render, profile: state.profile,
        errors: [...errors] });
      console.log(`${id}: ${state.render.drawCalls} calls, ${state.render.triangles} triangles`);
    };
    await page.evaluate(([y]) => window.__RIPE.freeCam(-1, y + 4.6, 38,
      -18, window.__RIPE.terrainHeight(-18, 25) + 1.9, 25), [orchard.entry]);
    await capture('orchard-approach');
    await page.evaluate(([x, y, z]) => window.__RIPE.freeCam(x + 5, y + 3.2, z + 6,
      x, y + 1.0, z), threat);
    await capture('mimic-near');
    await page.evaluate(([y]) => {
      window.__RIPE.attachCam();
      window.__RIPE.tp(-4, y + 0.18, 30);
      window.__RIPE.look(Math.atan2(11, 4), -0.08);
    }, [orchard.near]);
    await capture('mallet-first-person');
    await page.evaluate(() => {
      window.__RIPE.call('tool.give', 'aircannon');
      window.__RIPE.call('tool.select', 'aircannon');
    });
    await capture('aircannon-first-person');
    await page.close();
  }
} finally {
  await browser.close();
  writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ base, captures }, null, 2));
}
