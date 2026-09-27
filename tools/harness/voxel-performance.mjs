/**
 * Reproducible, headless baseline/voxel performance comparison.
 *
 * Start an isolated Vite server yourself, then run:
 *   RIPE_URL=http://127.0.0.1:5218 node tools/harness/voxel-performance.mjs
 *
 * This is a scripted camera route plus an active Mimic encounter. It does not
 * claim to be a normal-input playtest. rAF intervals include browser pacing;
 * Game.profile timings are CPU work/submission, not GPU timer-query results.
 * The geometry inventory is unculled scene geometry, not submitted triangles.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const base = process.env.RIPE_URL;
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base))
  throw new Error('RIPE_URL must point to an isolated loopback server (for example :5218).');
const out = path.resolve(root, option('--out',
  'docs/evidence/voxel-performance-pass'));
const width = Number(option('--width', '1280'));
const height = Number(option('--height', '720'));
const seconds = Number(option('--seconds', '7'));
const warmupSeconds = Number(option('--warmup-seconds', '30'));
const order = option('--order', 'baseline,voxel').split(',');
const gpuTimer = args.includes('--gpu-timer');
const keepRaw = args.includes('--raw') || process.env.RIPE_PERF_RAW === '1';
if (![width, height, seconds].every(Number.isFinite) || width < 320 || height < 180
  || seconds < 2 || seconds > 60 || !Number.isFinite(warmupSeconds)
  || warmupSeconds < 2 || warmupSeconds > 60
  || order.length !== 2 || new Set(order).size !== 2
  || !order.includes('baseline') || !order.includes('voxel'))
  throw new Error('Use width >= 320, height >= 180, and --seconds between 2 and 60.');

const response = await fetch(base, { signal: AbortSignal.timeout(3000) });
const html = await response.text();
if (!response.ok || !/<title>\s*RIPE RIOT\s*<\/title>/i.test(html))
  throw new Error(`${base} is not serving RIPE RIOT; refusing to benchmark a foreign server.`);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', headless: true,
  args: ['--disable-dev-shm-usage', '--mute-audio', '--enable-gpu',
    '--ignore-gpu-blocklist', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])] });
const context = await browser.newContext({ viewport: { width, height },
  deviceScaleFactor: 1, reducedMotion: 'no-preference' });
const metadata = {
  base, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDirtyFiles: execFileSync('git', ['diff', '--name-only', '--', 'src'],
    { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean),
  sourceDiffSha256: createHash('sha256').update(execFileSync('git',
    ['diff', '--binary', '--', 'src'], { cwd: root })).digest('hex'),
  platform: process.platform, browser: browser.version(), viewport: [width, height],
  dpr: 1, chromiumFlags: ['--enable-gpu', '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])],
  routeXZ: [[58, 62], [55.5, 61], [50.5, 61.5], [44, 62.5],
    [37.2, 58.2], [30, 54], [25, 46], [11, 38.6], [-3.5, 31.4], [-7.5, 29.5]],
  secondsPerPhase: seconds, warmupSeconds, order, gpuTimer, rawSamples: keepRaw,
  created: new Date().toISOString(),
  caveat: 'Scripted matched camera motion and active encounter. rAF is wall-clock pacing; '
    + 'Game.profile is CPU time. Scene inventory ignores frustum culling. No GPU timer queries.',
};
const runs = [];

function summary(rows, key) {
  const values = rows.map(r => r[key]).filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = p => values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))];
  return values.length ? { n: values.length, mean: +(values.reduce((a, b) => a + b, 0)
    / values.length).toFixed(2), p50: +percentile(.5).toFixed(2),
  p95: +percentile(.95).toFixed(2), p99: +percentile(.99).toFixed(2),
  max: +values.at(-1).toFixed(2) } : null;
}

async function open(mode, errors) {
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto(`${base}/?fresh=1${mode === 'voxel' ? '&voxelPilot=1' : ''}`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR,
    null, { timeout: 90000 });
  const boot = await page.evaluate(() => window.__RIPE_ERROR ?? null);
  if (boot) throw new Error(`${mode} boot: ${boot}`);
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'),
    null, { timeout: 30000 });
  await page.evaluate(gpuTimer => {
    const g = window.__GAME;
    const gl = g.renderer.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const timer = gpuTimer ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    window.__voxelPerf = {
      gpu: { renderer: renderer || gl.getParameter(gl.RENDERER),
        vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        webgl: gl.getParameter(gl.VERSION),
        timerQuery: !!gl.getExtension('EXT_disjoint_timer_query_webgl2') },
      rows: [], collecting: false, previous: null, motion: null,
      gpuMs: [], gpuDisjoint: 0, gpuTimerExt: timer, pending: [], timerFrame: 0,
      events: [],
      start() { this.rows = []; this.previous = null; this.gpuMs = [];
        this.gpuDisjoint = 0; this.collecting = true; },
      stop() { this.collecting = false; return { rows: this.rows.splice(0),
        gpuMs: this.gpuMs.splice(0), gpuDisjoint: this.gpuDisjoint }; },
      setMotion(points, durationMs) {
        const terrain = g.get('world').terrain;
        this.motion = { start: performance.now(), durationMs,
          points: points.map(([x, z]) => [x, terrain.height(x, z) + 1.7, z]) };
      },
      clearMotion() { this.motion = null; },
    };
    for (const name of ['encounter:attack', 'player:ragdoll', 'player:downed'])
      g.bus.on(name, payload => window.__voxelPerf.events.push({
        name, gameSeconds: g.clock.elapsed,
        payload: JSON.parse(JSON.stringify(payload)) }));
    if (gpuTimer && !timer) throw new Error('EXT_disjoint_timer_query_webgl2 unavailable');
    if (timer) {
      const originalRender = g.renderer.render.bind(g.renderer);
      g.renderer.render = () => {
        const perf = window.__voxelPerf;
        const queryThisFrame = perf.collecting && ++perf.timerFrame % 3 === 0
          && perf.pending.length < 8;
        const query = queryThisFrame ? gl.createQuery() : null;
        if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
        try { originalRender(); }
        finally {
          if (query) {
            gl.endQuery(timer.TIME_ELAPSED_EXT);
            perf.pending.push(query);
          }
        }
        while (perf.pending.length && gl.getQueryParameter(perf.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
          const done = perf.pending.shift();
          const nanoseconds = gl.getQueryParameter(done, gl.QUERY_RESULT);
          if (gl.getParameter(timer.GPU_DISJOINT_EXT)) perf.gpuDisjoint++;
          else perf.gpuMs.push(nanoseconds / 1e6);
          gl.deleteQuery(done);
        }
      };
    }
    const original = g.tick.bind(g);
    g.tick = now => {
      const perf = window.__voxelPerf;
      if (perf.motion) {
        const { points, start, durationMs } = perf.motion;
        const t = Math.min(1, (performance.now() - start) / durationMs);
        const u = t * (points.length - 1), i = Math.min(points.length - 2, Math.floor(u));
        const a = points[i], b = points[i + 1], f = u - i;
        const p = a.map((v, k) => v + (b[k] - v) * f);
        const look = points[Math.min(i + 1, points.length - 1)];
        window.__RIPE.freeCam(...p, look[0], look[1], look[2]);
      }
      original(now);
      if (perf.collecting) {
        perf.rows.push({ dt: perf.previous === null ? null : now - perf.previous,
          ...g.profile, ...g.renderer.info, pos: g.player.position.toArray() });
        perf.previous = now;
      }
    };
  }, gpuTimer);
  await page.waitForTimeout(warmupSeconds * 1000);
  return page;
}

async function measure(page, name, duration = seconds) {
  await page.bringToFront(); // the second co-op tab must not throttle its host
  const visibility = await page.evaluate(() => document.visibilityState);
  if (visibility !== 'visible') throw new Error(`${name}: host page is ${visibility}`);
  await page.evaluate(() => window.__voxelPerf.start());
  await page.waitForTimeout(duration * 1000);
  await page.evaluate(() => { window.__voxelPerf.collecting = false; });
  await page.waitForTimeout(gpuTimer ? 250 : 0); // let queued GPU queries resolve
  const { rows, gpuMs, gpuDisjoint } = await page.evaluate(() => window.__voxelPerf.stop());
  const usable = rows.slice(Math.min(rows.length, Math.round(rows.length * .1)));
  const result = { name, wallSeconds: duration, frames: usable.length,
    frameMs: summary(usable, 'dt'), cpuTotalMs: summary(usable, 'total'),
    cpuRenderMs: summary(usable, 'render'), cpuFixedMs: summary(usable, 'fixed'),
    cpuPhysicsMs: summary(usable, 'physics'),
    drawCalls: summary(usable, 'drawCalls'), triangles: summary(usable, 'triangles'),
    gpuRenderMs: summary(gpuMs.map(value => ({ value })), 'value'),
    gpuDisjoint, lastPosition: usable.at(-1)?.pos,
    ...(keepRaw ? { raw: usable } : {}) };
  result.averagePacedFps = result.frameMs ? +(1000 / result.frameMs.mean).toFixed(2) : null;
  result.over16_67MsPct = +(usable.filter(r => r.dt > 16.67).length
    / Math.max(1, usable.filter(r => Number.isFinite(r.dt)).length) * 100).toFixed(1);
  console.log(`${name}: ${result.frames} frames, p95 rAF ${result.frameMs?.p95} ms, `
    + `p95 CPU ${result.cpuTotalMs?.p95} ms, ${result.triangles?.p50} triangles`);
  return result;
}

async function inventory(page) {
  return page.evaluate(() => {
    const scene = window.__GAME.renderer.scene;
    const groups = new Map(), meshes = [];
    scene.updateMatrixWorld(true);
    scene.traverse(object => {
      if (!object.isMesh || !object.geometry) return;
      const geo = object.geometry;
      const raw = geo.index?.count ?? geo.attributes.position?.count ?? 0;
      const triangles = Math.floor(raw / 3) * (object.isInstancedMesh ? object.count : 1);
      const root = (() => {
        let node = object;
        while (node.parent && node.parent !== scene) node = node.parent;
        return node.name || node.type;
      })();
      const current = groups.get(root) ?? { root, meshes: 0, triangles: 0,
        shadowCasters: 0, shadowTriangles: 0 };
      current.meshes++;
      current.triangles += triangles;
      if (object.castShadow) { current.shadowCasters++; current.shadowTriangles += triangles; }
      groups.set(root, current);
      meshes.push({ name: object.name || object.parent?.name || object.type,
        root, triangles, castShadow: object.castShadow,
        geometry: geo.uuid, material: Array.isArray(object.material)
          ? object.material.map(m => m.name || m.type).join(',')
          : object.material?.name || object.material?.type });
    });
    return { caveat: 'Whole scene inventory: includes off-screen meshes and does not '
      + 'multiply for scene and shadow passes.',
    groups: [...groups.values()].sort((a, b) => b.triangles - a.triangles).slice(0, 30),
    largestMeshes: meshes.sort((a, b) => b.triangles - a.triangles).slice(0, 30) };
  });
}

try {
  for (const mode of order) {
    const errors = [];
    const page = await open(mode, errors);
    const run = { mode, errors, gpu: await page.evaluate(() => window.__voxelPerf.gpu),
      phases: [], shadow: null, inventory: null, encounter: null,
      remoteWorker: null };
    run.gpu.softwareRenderer = /swiftshader|llvmpipe|software|basic render/i.test(run.gpu.renderer);
    run.settings = await page.evaluate(() => {
      const r = window.__GAME.renderer;
      return { canvasPixels: [r.canvas.width, r.canvas.height],
        pixelRatio: r.renderer.getPixelRatio(), antialias: r.renderer.getContextAttributes()?.antialias,
        shadow: window.__RIPE.shadowInfo(), outputColorSpace: r.renderer.outputColorSpace,
        toneMapping: r.renderer.toneMapping, exposure: r.renderer.toneMappingExposure };
    });
    runs.push(run);
    const dock = [58, 62], orchard = [-7.5, 29.5];
    const route = metadata.routeXZ;
    await page.evaluate(([x, z]) => {
      const y = window.__RIPE.terrainHeight(x, z);
      window.__RIPE.freeCam(x, y + 1.7, z, 45, window.__RIPE.terrainHeight(45, 52) + 1.7, 52);
    }, dock);
    await page.waitForTimeout(800);
    run.phases.push(await measure(page, 'dock-static'));
    await page.evaluate(([points, ms]) => window.__voxelPerf.setMotion(points, ms),
      [route, seconds * 1000]);
    run.phases.push(await measure(page, 'dock-to-orchard-scripted-motion'));
    await page.evaluate(() => window.__voxelPerf.clearMotion());
    await page.waitForTimeout(500);
    run.inventory = await inventory(page);
    const shadowsOn = await measure(page, 'orchard-shadows-on');
    await page.evaluate(() => window.__RIPE.setShadows(false));
    await page.waitForTimeout(400);
    const shadowsOff = await measure(page, 'orchard-shadows-off');
    run.shadow = { on: shadowsOn, off: shadowsOff,
      medianDraws: +(shadowsOn.drawCalls.p50 - shadowsOff.drawCalls.p50).toFixed(2),
      medianTriangles: +(shadowsOn.triangles.p50 - shadowsOff.triangles.p50).toFixed(2) };
    await page.evaluate(() => window.__RIPE.setShadows(true));
    await page.evaluate(([x, z]) => {
      const y = window.__RIPE.terrainHeight(x, z);
      window.__RIPE.attachCam(); window.__RIPE.tp(x, y + .2, z);
      window.__RIPE.look(2.0, -.05);
    }, [-12.5, 27.2]);
    await page.waitForTimeout(500);
    run.encounterBefore = await page.evaluate(() => window.__GAME.get('encounters').snapshot());
    run.phases.push(await measure(page, 'active-mimic-encounter'));
    run.encounterAfter = await page.evaluate(() => ({
      encounters: window.__GAME.get('encounters').snapshot(),
      health: window.__GAME.get('vitals').health,
      events: window.__voxelPerf.events }));
    run.encounterActive = run.encounterAfter.health < 100
      || run.encounterAfter.events.some(e => e.name === 'encounter:attack');
    if (!run.encounterActive) errors.push('Mimic encounter did not become active');

    // Same-origin BroadcastChannel co-op. The small client remains running,
    // so these numbers represent two simultaneous browser canvases.
    const client = await open(mode, errors);
    try {
      const room = `voxel-perf-${Date.now()}-${mode}`;
      await page.evaluate(r => window.__RIPE.call('net.connect', r, 0), room);
      await client.evaluate(r => window.__RIPE.call('net.connect', r, 1), room);
      await client.setViewportSize({ width: 320, height: 180 });
      await client.evaluate(() => {
        const y = window.__RIPE.terrainHeight(15, 40);
        window.__RIPE.tp(15, y + .15, 40);
      });
      await page.waitForFunction(() => window.__GAME.get('net').remotes.size > 0,
        null, { timeout: 15000 });
      await page.evaluate(() => {
        const y = window.__RIPE.terrainHeight(15, 40);
        window.__RIPE.freeCam(15, y + 1.8, 36.2, 15, y + 1.25, 40);
      });
      await page.waitForTimeout(800);
      const remoteCount = await page.evaluate(() => window.__GAME.get('net').remotes.size);
      run.remoteWorker = { remoteCount,
        measuredWithSecondCanvasRunning: true,
        phase: await measure(page, 'two-worker-presentation') };
      await page.screenshot({ path: path.join(out, `${mode}-two-worker.png`) });
    } finally { await client.close(); }
    await page.close();
  }
} finally {
  await context.close();
  await browser.close();
  writeFileSync(path.join(out, 'report.json'), JSON.stringify({ metadata, runs }, null, 2));
}
const bad = runs.flatMap(r => r.errors.map(e => `${r.mode}: ${e}`));
const renderers = runs.map(r => `${r.mode}: ${r.gpu.renderer}`);
console.log(`GPU identity: ${renderers.join(' | ')}`);
console.log(`Report: ${path.join(out, 'report.json')}`);
if (bad.length) { console.error(bad.join('\n')); process.exitCode = 1; }
