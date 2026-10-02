// Shared Playwright driver for RIPE RIOT.
// Boots the dev server (or reuses a running one), opens the game in Chromium
// with a WebGL context, and exposes helpers that talk to window.__RIPE.
// Numerical fixtures may suppress draws after boot; visual checks must not.
//
// Design note: helpers here return NUMBERS wherever possible. Screenshots are
// expensive to look at; frame statistics are not.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT = path.join(ROOT, 'capture');
// 127.0.0.1, not localhost: Node's fetch tries ::1 first on Windows and stalls
// for seconds when Vite is bound to IPv4 only.
const URL_BASE = process.env.RIPE_URL || 'http://127.0.0.1:5173';
// A copied staging harness must never attach to the user's live play session.
if (/RIPE-RIOT-staging/i.test(ROOT) && new URL(URL_BASE).port === '5188') {
  throw new Error('Staging tests cannot use the live play port 5188. Set RIPE_URL to the staging server.');
}

export function ensureOut(sub = '') {
  const dir = sub ? path.join(OUT, sub) : OUT;
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Is the thing on that port OUR dev server?
 *
 * "Something answers on 5173" is not the same question, and answering the wrong
 * one costs 90 seconds per stage: another project's Vite took the port, every
 * harness run happily reused it, and each one sat waiting for a `__RIPE_READY`
 * that was never going to arrive on somebody else's index.html.
 *
 * Returns 'ours', 'foreign' or 'down'.
 */
async function serverKind() {
  try {
    const res = await fetch(URL_BASE, { method: 'GET', signal: AbortSignal.timeout(1500) });
    if (!res.ok) return 'down';
    const html = await res.text();
    const gameShell = /<title>\s*RIPE RIOT\s*<\/title>/i.test(html)
      && /<canvas\b[^>]*\bid=["']view["']/i.test(html) && html.includes('id="ui-root"');
    const entry = html.includes('/src/main.ts')
      || /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["'][^"']*\/assets\/[^"']+\.js["']/i.test(html);
    return gameShell && entry ? 'ours' : 'foreign';
  } catch { return 'down'; }
}

export async function startServer() {
  const kind = await serverKind();
  if (kind === 'ours') return { proc: null, reused: true };
  if (kind === 'foreign') {
    throw new Error(
      `${URL_BASE} is serving a different project. Free the port, or point the ` +
      'harness elsewhere with RIPE_URL (and start Vite there yourself).');
  }
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const proc = spawn(npmCmd, ['run', 'dev', '--', '--host', '127.0.0.1', '--strictPort'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32',
  });
  proc.stdout.on('data', (d) => { if (process.env.RIPE_VERBOSE) process.stdout.write(`[vite] ${d}`); });
  proc.stderr.on('data', (d) => process.stderr.write(`[vite:err] ${d}`));
  for (let i = 0; i < 120; i++) {
    if (await serverKind() === 'ours') return { proc, reused: false };
    await sleep(400);
  }
  throw new Error('dev server did not come up');
}

export async function openGame({ width = 1280, height = 720, headless = true, quiet = false,
  islandActivities = true, drawFrames = true, recordVideoDir = null, frameRateLimit = false } = {}) {
  // Opt-in hardware review on the desktop. Playwright's headless shell uses
  // SwiftShader here; full Chromium with D3D11 was verified on the RTX 4070 Ti.
  // Keep the historical default for reproducible software-rendered checks.
  const hardware = process.env.RIPE_HARDWARE === '1';
  const browser = await chromium.launch({
    headless,
    ...(hardware ? { channel: 'chromium' } : {}),
    // Measured: forcing ANGLE backends is either 50x slower (explicit
    // swiftshader) or renders black (gl-egl). Chromium's own default picks
    // SwANGLE and works. Leave the GL selection alone.
    args: ['--disable-dev-shm-usage', ...(frameRateLimit ? [] : ['--disable-frame-rate-limit']),
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      ...(hardware ? ['--enable-gpu', '--ignore-gpu-blocklist',
        ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])] : [])],
  });
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
    ...(recordVideoDir ? { recordVideo: { dir: recordVideoDir, size: { width, height } } } : {}),
  });
  return attachPage(browser, ctx, quiet, islandActivities, drawFrames);
}

/**
 * A second (third, fourth) client inside the SAME browser context as an
 * existing one. Required for multiplayer tests: BroadcastChannel is scoped to
 * an origin within one browser, so clients launched as separate Chromium
 * processes can never see each other.
 */
export async function openSecondClient(api, { quiet = true, islandActivities = api.islandActivities ?? true,
  drawFrames = api.drawFrames ?? true } = {}) {
  return attachPage(api.browser, api.ctx, quiet, islandActivities, drawFrames);
}

async function attachPage(browser, ctx, quiet, islandActivities, drawFrames) {
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') {
      const source = m.location().url;
      consoleErrors.push(`${t}: ${m.text()}${source ? ` (${source})` : ''}`);
    }
    if (!quiet && t === 'log') console.log('  [page]', m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  // `?fresh`: never resume a save. A page that saved on close would otherwise
  // hand its money and tools to the next page in the same browser context.
  const visualQuery = process.env.RIPE_VOXEL_PILOT === '1' ? '&voxelPilot=1' : '';
  await page.goto(`${URL_BASE}/?fresh=1${visualQuery}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__RIPE_READY === true || window.__RIPE_ERROR,
    null, { timeout: 90_000 },
  );
  const bootError = await page.evaluate(() => window.__RIPE_ERROR ?? null);
  if (bootError) {
    console.error('\n=== BOOT ERROR ===\n' + bootError + '\n');
    throw new Error('game failed to boot');
  }
  if (!drawFrames) await page.evaluate(() => {
    // Numerical fixtures still run the real rAF, fixed steps, physics, camera,
    // frameUpdate and UI. Only the final GPU draw is suppressed after boot.
    // These runs are neither visual acceptance nor performance measurements.
    window.__RIPE_HARNESS_DRAW = window.__GAME.renderer.render.bind(window.__GAME.renderer);
    window.__GAME.renderer.render = () => {};
  });
  if (!islandActivities) await page.evaluate(() => {
    // Explicit fixture isolation only. Runtime defaults and end-to-end island
    // tests retain the director and gull, including their presentation.
    const g = window.__GAME;
    if (g.has('director')) window.__RIPE.call('director.reset', false);
    if (g.has('characters')) window.__RIPE.call('characters.reset', false);
  });
  // A few frames so the first render, env map and shader compiles settle.
  await page.evaluate(() => new Promise((r) => setTimeout(r, 600)));

  const api = {
    page, browser, ctx, consoleErrors, islandActivities, drawFrames,
    // Explicit one-frame draw for the startup scenario's pixel assertions.
    renderFrame: () => page.evaluate(() => window.__RIPE_HARNESS_DRAW?.()),
    state: () => page.evaluate(() => window.__RIPE.state()),
    stats: (w, h) => page.evaluate(([w, h]) => window.__RIPE.frameStats(w, h), [w, h]),
    call: (name, ...args) => page.evaluate(
      ([n, a]) => window.__RIPE.call(n, ...a), [name, args]),
    actions: () => page.evaluate(() => window.__RIPE.listActions()),
    tp: (x, y, z) => page.evaluate(([x, y, z]) => window.__RIPE.tp(x, y, z), [x, y, z]),
    look: (yaw, pitch) => page.evaluate(([y, p]) => window.__RIPE.look(y, p), [yaw, pitch]),
    freeCam: (p, t) => page.evaluate(([p, t]) => window.__RIPE.freeCam(...p, ...t), [p, t]),
    orbitCam: (t, r, yaw, pitch) => page.evaluate(
      ([t, r, y, p]) => window.__RIPE.orbitCam(t[0], t[1], t[2], r, y, p), [t, r, yaw, pitch]),
    attachCam: () => page.evaluate(() => window.__RIPE.attachCam()),
    input: (patch) => page.evaluate((p) => window.__RIPE.input(p), patch),
    clearInput: () => page.evaluate(() => window.__RIPE.clearInput()),
    pause: (on = true) => page.evaluate((o) => window.__RIPE.pause(o), on),
    advance: (n) => page.evaluate((n) => window.__RIPE.advance(n), n),
    probeLook: (d) => page.evaluate((d) => window.__RIPE.probeLook(d), d),
    setShadows: (on) => page.evaluate((o) => window.__RIPE.setShadows(o), on),
    shadowInfo: () => page.evaluate(() => window.__RIPE.shadowInfo()),
    explode: (x, y, z, r, s) => page.evaluate(
      ([x, y, z, r, s]) => window.__RIPE.explode(x, y, z, r, s), [x, y, z, r, s]),
    overlap: (x, y, z, r) => page.evaluate(
      ([x, y, z, r]) => window.__RIPE.overlap(x, y, z, r), [x, y, z, r]),
    logs: () => page.evaluate(() => window.__RIPE.dumpLogs()),
    clearLogs: () => page.evaluate(() => window.__RIPE.clearLogs()),
    terrainHeight: (x, z) => page.evaluate(([x, z]) => window.__RIPE.terrainHeight(x, z), [x, z]),
    /** Let real time pass (physics runs at whatever rate the machine manages). */
    wait: async (seconds) => { await page.evaluate((s) => new Promise((r) => setTimeout(r, s * 1000)), seconds); },
    /**
     * Advance the SIMULATION by a number of seconds, deterministically: the
     * clock is held paused and exactly round(seconds * 60) fixed steps are
     * forced, a few per rendered frame. Wall-clock cost is whatever the
     * renderer costs; the amount of world that elapses is fixed. The scenario
     * runner substitutes this for `wait`.
     */
    simulate: async (seconds) => { await page.evaluate((s) => window.__RIPE.simulate(s), seconds); },
    /** Render N frames with the clock paused: zero fixed steps, real time passes. */
    idleFrames: async (n) => { await page.evaluate((n) => window.__RIPE.idleFrames(n), n); },
    /**
     * Read the WebGL canvas directly rather than using page.screenshot(): the
     * game never stops animating, so Playwright's stability wait never settles.
     * The renderer keeps preserveDrawingBuffer on so this is always valid.
     */
    shot: async (name, sub = '') => {
      const dir = ensureOut(sub);
      const file = path.join(dir, `${name}.png`);
      const data = await page.evaluate(() => {
        const c = document.getElementById('view');
        return c.toDataURL('image/png');
      });
      writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
      return file;
    },
    /** Same, but at reduced size — use for triage sheets. */
    shotSmall: async (name, sub = '', scale = 0.5) => {
      const dir = ensureOut(sub);
      const file = path.join(dir, `${name}.png`);
      const data = await page.evaluate((k) => {
        const src = document.getElementById('view');
        const c = document.createElement('canvas');
        c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
        c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
        return c.toDataURL('image/png');
      }, scale);
      writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
      return file;
    },
    /**
     * Screen-space extent of a group in the VIEWMODEL scene, through the real
     * view camera, as percentages of the visible frame.
     *
     * This is the instrument the whole first-person framing argument rests on.
     * "The melon is too big" is an opinion; "the melon's top edge is at 71% of
     * frame height, 21 points above the crosshair" is a number that can fail a
     * build. `topPct` and `bottomPct` are measured UP FROM THE BOTTOM edge, so
     * the crosshair sits at 50 and anything below that is out of the way.
     */
    viewExtent: (prefix) => page.evaluate((prefix) => {
      const r = window.__GAME.renderer;
      const V3 = Object.getPrototypeOf(r.camera.position).constructor;
      // Search the whole view scene, not just its top level: the cap that
      // matters is on the FRUIT, and the hands deliberately run off the bottom
      // edge of the frame the way every viewmodel's forearms do.
      let group = null;
      r.viewScene.traverse((o) => {
        if (!group && o.name && o.name.startsWith(prefix)) group = o;
      });
      if (!group) return { error: `no ${prefix} in view scene` };
      group.updateMatrixWorld(true);
      const cam = r.viewCamera;
      cam.updateMatrixWorld(true);
      let minX = 9, maxX = -9, minY = 9, maxY = -9, near = 9, verts = 0;
      group.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        let p = o;
        while (p) { if (!p.visible) return; p = p.parent; }
        const pos = o.geometry.getAttribute('position');
        const v = new V3();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          o.localToWorld(v);
          near = Math.min(near, -v.z);
          v.project(cam);
          minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
          minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
          verts++;
        }
      });
      if (!verts) return { visible: false, name: group.name };
      const clip = (v) => Math.max(-1, Math.min(1, v));
      const pct = (ndc) => ((clip(ndc) + 1) / 2) * 100;
      return {
        visible: group.visible,
        name: group.name,
        heightPct: +(pct(maxY) - pct(minY)).toFixed(1),
        widthPct: +(pct(maxX) - pct(minX)).toFixed(1),
        topPct: +pct(maxY).toFixed(1),
        bottomPct: +pct(minY).toFixed(1),
        leftPct: +pct(minX).toFixed(1),
        rightPct: +pct(maxX).toFixed(1),
        offRight: maxX > 1,
        offLeft: minX < -1,
        nearest: +near.toFixed(3),
        camNear: cam.near,
      };
    }, prefix),
    close: async () => { await browser.close(); },
    closePage: async () => { await page.close(); },
  };
  return api;
}

export async function withGame(fn, opts) {
  const server = await startServer();
  let game;
  try {
    game = await openGame(opts);
    return await fn(game);
  } finally {
    if (game) await game.close().catch(() => {});
    if (server.proc) server.proc.kill();
  }
}

export { sleep, existsSync, path };
