import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('docs/evidence/block-worker-world-proof');
const base = process.env.BLOCK_PROOF_URL || 'http://127.0.0.1:5201/block-proof.html';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [view, width, height, name] of [
    ['normal', 1920, 1080, 'scene-distance-1920x1080.png'],
    ['close', 1920, 1080, 'worker-close-1920x1080.png'],
    ['wide', 1920, 1080, 'whole-patch-1920x1080.png'],
    ['normal', 3434, 1270, 'scene-distance-3434x1270.png'],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const response = await page.goto(`${base}?view=${view}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__blockProofReady === true);
    await page.waitForTimeout(300);
    const metrics = await page.evaluate(() => window.__blockProof);
    await page.screenshot({ path: resolve(output, name), fullPage: true });
    if (view === 'normal' && width === 1920) {
      await page.locator('[data-view="close"]').click();
      const switched = await page.evaluate(() =>
        new URLSearchParams(location.search).get('view') === 'close'
        && document.querySelector('[data-view="close"]')?.classList.contains('active'));
      if (!switched) errors.push('camera selector failed to activate the close view');
      const compare = await page.locator('.compare').getAttribute('href');
      if (compare !== '/voxel-proof.html') errors.push('comparison link is missing');
    }
    results.push({ name, view, width, height, status: response?.status(), errors, metrics: {
      workerComponents: metrics.workerComponents,
      workerVoxels: metrics.workerVoxels,
      terrainVoxels: metrics.terrainVoxels,
      drawObjects: metrics.drawObjects,
    } });
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(resolve(output, 'capture-results.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
if (results.some(result => result.status !== 200 || result.errors.length)) process.exitCode = 1;
