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
    async reset() {
      await g.clearInput();
      await g.call('fruit.despawnAllFree').catch(() => {});
      await g.call('basket.clear').catch(() => {});
      await g.call('economy.set', 0).catch(() => {});
      await g.call('wind.set', 1, 0.4, 2.2).catch(() => {});
    },
  });
}

const results = await withGame(async (raw) => {
  const g = enrich(raw);
  const out = [];
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
}, { width: 960, height: 540, headless: true, quiet: true });

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
