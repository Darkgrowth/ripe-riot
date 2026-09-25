/** Matched static-render A/B samples; no video encoder or gameplay timing. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const base = process.env.RIPE_URL;
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base))
  throw new Error('Set RIPE_URL to the dedicated local comparison server.');
const out = path.resolve('capture/mimic-comparison/metrics.json');
const browser = await chromium.launch({ headless: true,
  args: ['--disable-dev-shm-usage', '--disable-frame-rate-limit'] });
const percentile = (a, p) => a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))];
const stats = values => {
  const a = values.toSorted((x, y) => x - y);
  return { median: percentile(a, .5), p95: percentile(a, .95), min: a[0], max: a.at(-1) };
};
const rows = [];
try {
  for (const [width, height] of [[1920, 1080], [3434, 1270]]) {
    for (const style of ['A', 'B']) {
      const context = await browser.newContext({ viewport: { width, height },
        deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${base}/?mimicCompare=${style}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR,
        null, { timeout: 90000 });
      const bootError = await page.evaluate(() => window.__RIPE_ERROR ?? null);
      if (bootError) throw new Error(bootError);
      const renderer = await page.evaluate(() => {
        const gl = document.querySelector('#view').getContext('webgl2');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable';
      });
      // Fixed rendered pose/location on both styles. This is an instrumented
      // metrics fixture, distinct from the untouched normal-input fight video.
      await page.evaluate(() => {
        window.__RIPE.pause(true);
        const e = window.__GAME.get('encounters').model.get('mimic');
        e.phase = 'warn'; e.timeLeft = .2;
        e.heading = Math.atan2(12, 2);
      });
      await page.waitForTimeout(1200);
      const samples = [];
      for (let n = 0; n < 72; n++) {
        samples.push(await page.evaluate(() => window.__RIPE.state()));
        await page.waitForTimeout(55);
      }
      const row = { style, width, height, renderer,
        softwareRenderer: /swiftshader|software/i.test(renderer), samples: samples.length,
        drawCalls: stats(samples.map(s => s.render.drawCalls)),
        triangles: stats(samples.map(s => s.render.triangles)),
        geometries: stats(samples.map(s => s.render.geometries)),
        textures: stats(samples.map(s => s.render.textures)),
        renderMs: stats(samples.map(s => s.profile.render)),
        totalMs: stats(samples.map(s => s.profile.total)), errors };
      rows.push(row);
      console.log(JSON.stringify(row));
      await context.close();
    }
  }
} finally {
  await browser.close();
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ method: 'Paused identical Mimic windup at comparison entry; 72 sequential rendered frame snapshots per cell, no video encoding.', rows }, null, 2) + '\n');
}
