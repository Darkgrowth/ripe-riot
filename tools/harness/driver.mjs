// Shared Playwright driver for RIPE RIOT.
// Boots the dev server (or reuses a running one), opens the game in Chromium
// with a real GPU-backed WebGL context, and exposes helpers that talk to
// window.__RIPE.
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

export function ensureOut(sub = '') {
  const dir = sub ? path.join(OUT, sub) : OUT;
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function serverUp() {
  try {
    const res = await fetch(URL_BASE, { method: 'GET', signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch { return false; }
}

export async function startServer() {
  if (await serverUp()) return { proc: null, reused: true };
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const proc = spawn(npmCmd, ['run', 'dev', '--', '--host', '127.0.0.1', '--strictPort'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32',
  });
  proc.stdout.on('data', (d) => { if (process.env.RIPE_VERBOSE) process.stdout.write(`[vite] ${d}`); });
  proc.stderr.on('data', (d) => process.stderr.write(`[vite:err] ${d}`));
  for (let i = 0; i < 120; i++) {
    if (await serverUp()) return { proc, reused: false };
    await sleep(400);
  }
  throw new Error('dev server did not come up');
}

export async function openGame({ width = 1280, height = 720, headless = true, quiet = false } = {}) {
  const browser = await chromium.launch({
    headless,
    // Measured: forcing ANGLE backends is either 50x slower (explicit
    // swiftshader) or renders black (gl-egl). Chromium's own default picks
    // SwANGLE and works. Leave the GL selection alone.
    args: ['--disable-dev-shm-usage', '--disable-frame-rate-limit'],
  });
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') consoleErrors.push(`${t}: ${m.text()}`);
    if (!quiet && t === 'log') console.log('  [page]', m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__RIPE_READY === true || window.__RIPE_ERROR,
    null, { timeout: 90_000 },
  );
  const bootError = await page.evaluate(() => window.__RIPE_ERROR ?? null);
  if (bootError) {
    console.error('\n=== BOOT ERROR ===\n' + bootError + '\n');
    throw new Error('game failed to boot');
  }
  // A few frames so the first render, env map and shader compiles settle.
  await page.evaluate(() => new Promise((r) => setTimeout(r, 600)));

  const api = {
    page, browser, ctx, consoleErrors,
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
    logs: () => page.evaluate(() => window.__RIPE.dumpLogs()),
    clearLogs: () => page.evaluate(() => window.__RIPE.clearLogs()),
    terrainHeight: (x, z) => page.evaluate(([x, z]) => window.__RIPE.terrainHeight(x, z), [x, z]),
    /** Let real time pass (physics runs). */
    wait: async (seconds) => { await page.evaluate((s) => new Promise((r) => setTimeout(r, s * 1000)), seconds); },
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
    close: async () => { await browser.close(); },
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
