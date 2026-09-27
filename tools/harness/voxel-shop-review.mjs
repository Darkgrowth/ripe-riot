/** Isolated, pointer-lock-free gameplay-camera captures of Merv's shop hub. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.RIPE_URL;
if (!base) throw new Error('Set RIPE_URL to this worktree\'s isolated preview');
const out = path.resolve(process.env.RIPE_OUT || 'docs/evidence/voxel-shop-dock');
const views = [
  { name: 'dock-arrival', from: [58, 62], to: [45, 52] },
  { name: 'shop-approach', from: [53, 58], to: [44, 53] },
  { name: 'shop-front', from: [36, 60], to: [43, 54] },
  { name: 'buy-counter', from: [39.5, 57], to: [43, 54.3] },
  { name: 'sell-pad', from: [34, 62], to: [41, 55] },
];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--mute-audio', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=d3d11'] });
const captures = [];
try {
  for (const mode of ['baseline', 'voxel']) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1 });
    await context.addInitScript(() => {
      window.__SHOP_POINTER_LOCK_CALLS = 0;
      Element.prototype.requestPointerLock = () => {
        window.__SHOP_POINTER_LOCK_CALLS++;
        throw new Error('Pointer lock is forbidden in the shop review harness');
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`${base}/?fresh=1${mode === 'voxel' ? '&voxelPilot=1' : ''}`,
      { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR,
      null, { timeout: 90_000 });
    const bootError = await page.evaluate(() => window.__RIPE_ERROR ?? null);
    if (bootError) throw new Error(`${mode}: ${bootError}`);
    await page.addStyleTag({ content: '.entry-hint { display: none !important; }' });
    const dir = path.join(out, mode);
    mkdirSync(dir, { recursive: true });
    for (const view of views) {
      await page.evaluate(({ from, to }) => {
        const h = (x, z) => window.__RIPE.terrainHeight(x, z);
        window.__RIPE.freeCam(from[0], h(...from) + 1.72, from[1],
          to[0], h(...to) + 1.85, to[1]);
      }, view);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(dir, `${view.name}.png`) });
      const state = await page.evaluate(() => ({ render: window.__RIPE.state().render,
        pointerLockCalls: window.__SHOP_POINTER_LOCK_CALLS,
        pointerLocked: !!document.pointerLockElement }));
      captures.push({ mode, view: view.name, ...state, errors: [...errors] });
      if (state.pointerLockCalls || state.pointerLocked || errors.length)
        throw new Error(`${mode} ${view.name}: pointer lock or page error`);
      console.log(`${mode} ${view.name}: ${state.render.drawCalls} calls, ${state.render.triangles} triangles`);
    }
    await context.close();
  }
} finally {
  await browser.close();
  writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ base, views, captures }, null, 2));
}
