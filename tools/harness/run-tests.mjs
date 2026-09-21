// Scenario runner. Boots the game once, runs every scenario against it, and
// reports pass/fail purely from numbers. No screenshots: a scenario that needs
// a picture to decide whether it passed is not a test.
//
//   node tools/harness/run-tests.mjs            # all scenarios
//   node tools/harness/run-tests.mjs harvest    # only matching names

import { withGame } from './driver.mjs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// fileURLToPath, not url.pathname: the project path contains a space, which
// pathname leaves percent-encoded.
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scenarios');
const filter = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const files = readdirSync(DIR).filter((f) => f.endsWith('.mjs')).sort();
const chosen = filter.length ? files.filter((f) => filter.some((k) => f.includes(k))) : files;
if (!chosen.length) { console.error('no scenarios matched', filter); process.exit(1); }

/** Assertion helpers handed to every scenario. */
function makeCtx(name) {
  const checks = [];
  const fmt = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(3)) : JSON.stringify(v));
  const push = (ok, label, detail) => { checks.push({ ok, label, detail }); return ok; };
  return {
    name, checks,
    ok: (cond, label, detail = '') => push(!!cond, label, detail),
    eq: (a, b, label) => push(a === b, label, `got ${fmt(a)} want ${fmt(b)}`),
    near: (a, b, tol, label) => push(Math.abs(a - b) <= tol, label, `got ${fmt(a)} want ${fmt(b)}±${tol}`),
    gt: (a, b, label) => push(a > b, label, `got ${fmt(a)} want > ${fmt(b)}`),
    gte: (a, b, label) => push(a >= b, label, `got ${fmt(a)} want >= ${fmt(b)}`),
    lt: (a, b, label) => push(a < b, label, `got ${fmt(a)} want < ${fmt(b)}`),
    lte: (a, b, label) => push(a <= b, label, `got ${fmt(a)} want <= ${fmt(b)}`),
    between: (a, lo, hi, label) => push(a >= lo && a <= hi, label, `got ${fmt(a)} want ${lo}..${hi}`),
    note: (msg) => checks.push({ ok: true, label: msg, detail: '', info: true }),
  };
}

/** Extra helpers layered on the raw driver, shared by every scenario. */
function enrich(g) {
  return Object.assign(g, {
    /**
     * Scenarios advance SIMULATED time, never wall-clock time. The game clock
     * is paused for the whole run and every wait forces an exact number of
     * fixed steps, so a check that says "within 3.6 s" means 216 steps whether
     * the harness renders at 320x180 or 1920x1080, on a fast machine or a
     * busy one. Wall-clock waits made the suite a fill-rate benchmark: an art
     * pass that touched no gameplay code failed three physics scenarios.
     */
    wait: (seconds) => g.simulate(seconds),
    /** Hold a synthetic input for `seconds` of real time, then clear it. */
    async hold(patch, seconds) {
      await g.input(patch);
      await g.wait(seconds);
      await g.clearInput();
    },
    /** Put the player at a spot on the ground, facing a yaw. */
    async standAt(x, z, yaw = 0, lift = 1.2) {
      const h = await g.terrainHeight(x, z);
      await g.tp(x, h + lift, z);
      await g.look(yaw, 0);
      await g.wait(0.35);
      return h;
    },
    /** Look from the player toward a world point. */
    async faceTo(x, y, z) {
      const s = await g.state();
      const [px, py, pz] = s.player.pos;
      const dx = x - px, dy = y - (py + 1.6), dz = z - pz;
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));
      await g.look(yaw, pitch);
    },
    /**
     * Full isolation between scenarios. Without this a test that leaves the
     * player ragdolled, mid-fall, or holding a watermelon silently corrupts
     * every scenario after it.
     */
    async reset() {
      await g.call('director.reset', false).catch(() => {});
      await g.call('characters.reset', false).catch(() => {});
      await g.clearInput();
      await g.call('ragdoll.recover').catch(() => {});
      await g.call('drop').catch(() => {});
      await g.call('fruit.despawnAllFree').catch(() => {});
      await g.call('basket.clear').catch(() => {});
      await g.call('economy.set', 0).catch(() => {});
      // Discovery is progression, and progression leaked: a scenario that
      // found three new species raised the tier for every scenario after it,
      // which quietly skipped the shed's tier-gating check.
      await g.call('economy.resetDiscovery').catch(() => {});
      await g.call('book.reset').catch(() => {});
      await g.call('progress.reset').catch(() => {});
      // Purchases and debug grants belong to one scenario. In particular the
      // island order fixture grants a net before progression tests buying it.
      await g.page.evaluate(() => window.__GAME.get('tools').deserialize(window.__RIPE_INITIAL_TOOLS));
      await g.call('wind.set', 1, 0.4, 2.2).catch(() => {});
      await g.attachCam();
      // Park on the flat orchard terrace and let the player settle.
      const h = await g.terrainHeight(-24, 22);
      await g.tp(-24, h + 1.2, 22);
      await g.look(0, 0);
      await g.wait(0.5);
      await g.call('ragdoll.recover').catch(() => {});
      await g.call('fruit.despawnAllFree').catch(() => {});
      await g.wait(0.2);
    },
  });
}

const results = await withGame(async (raw) => {
  await raw.page.evaluate(() => { window.__RIPE_INITIAL_TOOLS = window.__GAME.get('tools').serialize(); });
  const g = enrich(raw);
  const out = [];
  // Hold the clock for the entire run: see `wait` above. UI, camera and
  // viewmodel still update; GPU draws are suppressed except explicit startup
  // pixel checks. The world only moves when a scenario asks it to.
  await g.pause(true);
  for (const file of chosen) {
    const mod = await import(pathToFileURL(path.join(DIR, file)).href);
    const name = mod.name ?? file.replace(/\.mjs$/, '');
    const ctx = makeCtx(name);
    const t0 = Date.now();
    let error = null;
    try {
      await g.reset();
      await mod.run(g, ctx);
    } catch (e) {
      error = e;
    }
    out.push({ name, ctx, error, ms: Date.now() - t0 });
  }
  return out;
// Forced fixed steps keep simulation independent of drawing. Preserve 16:9
// for the horizontal FOV checks. Only startup's explicit pixel samples draw;
// visual harnesses retain their own larger sizes and normal rendering.
}, { width: 320, height: 180, headless: true, quiet: true, islandActivities: false, drawFrames: false });

let failed = 0;
for (const r of results) {
  const bad = r.ctx.checks.filter((c) => !c.ok);
  const status = r.error ? 'ERROR' : bad.length ? 'FAIL' : 'PASS';
  if (status !== 'PASS') failed++;
  console.log(`\n[${status}] ${r.name}  (${r.ms}ms, ${r.ctx.checks.length} checks)`);
  for (const c of r.ctx.checks) {
    if (c.info) { console.log(`    · ${c.label}`); continue; }
    if (!c.ok) console.log(`    ✗ ${c.label}  ${c.detail}`);
  }
  if (process.env.RIPE_VERBOSE) {
    for (const c of r.ctx.checks) if (c.ok && !c.info) console.log(`    ✓ ${c.label}`);
  }
  if (r.error) console.log('   ', String(r.error.stack ?? r.error).split('\n').slice(0, 6).join('\n    '));
}

console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
process.exit(failed ? 1 : 0);
