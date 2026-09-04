// What carrying a fruit does to the frame.
//
// The failure this exists to catch was found by a human playing the game, not
// by any check in the suite: a Puff Melon inflating in your hands filled the
// screen with a sphere while the tool viewmodel, its gloves and the basket were
// all still drawn on top of it. Every existing check passed, because they all
// measured the world and this is a fact about the CAMERA.
//
// So this measures the camera. For each carry class it reports how much of the
// frame the fruit occupies, where its top edge falls relative to the crosshair,
// whether the tool is drawn at the same time, and whether the view of the
// island survives — and it writes one contact sheet.
//
//   node tools/harness/carry-check.mjs
//   node tools/harness/carry-check.mjs --shots-only

import path from 'node:path';
import { withGame, ensureOut } from './driver.mjs';
import { contactSheet } from './sheet.mjs';

const SUB = 'carry';
const shotsOnly = process.argv.includes('--shots-only');

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  if (!ok || process.env.RIPE_VERBOSE) {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  }
};

/**
 * Composition of the REAL canvas: how much of it is sky, and how much is one
 * flat colour. A fruit welded to the lens shows up here as a collapse in sky
 * and a spike in flatness, whatever the geometry claims.
 */
const composition = (g) => g.page.evaluate(() => {
  const src = document.getElementById('view');
  const c = document.createElement('canvas');
  c.width = 128; c.height = 72;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0, 128, 72);
  const d = x.getImageData(0, 0, 128, 72).data;
  const N = 128 * 72;
  let sky = 0;
  // Fraction of the frame occupied by its single commonest colour bucket. A
  // 24-bucket-per-channel quantisation is coarse enough to survive shading and
  // fine enough that "the whole screen is one melon" is unmistakable.
  const hist = new Map();
  for (let i = 0; i < N * 4; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    if (b > gg + 8 && b > r + 18 && b > 140) sky++;
    const k = ((r >> 5) << 10) | ((gg >> 5) << 5) | (b >> 5);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  let top = 0;
  for (const v of hist.values()) if (v > top) top = v;
  return { sky: +(sky / N).toFixed(3), dominant: +(top / N).toFixed(3) };
});

/** Everything worth knowing about the current carry, in one round trip. */
async function measure(g) {
  const st = await g.state();
  return {
    carry: await g.viewExtent('CarryFruit'),
    rig: await g.viewExtent('CarryModel'),
    tool: await g.viewExtent('ViewModel'),
    comp: await composition(g),
    inter: st.interaction,
    vm: st.viewmodel,
  };
}

const line = (label, m) => {
  const c = m.carry;
  return `${label.padEnd(22)} h ${String(c.heightPct ?? '-').padStart(5)}%  ` +
    `top ${String(c.topPct ?? '-').padStart(5)}%  bot ${String(c.bottomPct ?? '-').padStart(5)}%  ` +
    `x ${String(c.leftPct ?? '-').padStart(5)}..${String(c.rightPct ?? '-').padStart(5)}%  ` +
    `near ${c.nearest ?? '-'}  tool ${m.vm.toolShown ? 'SHOWN' : 'hidden'}  ` +
    `sky ${m.comp.sky}  dom ${m.comp.dominant}`;
};

/**
 * The framing contract, asserted identically for every carry class.
 *
 * `topPct <= 44` is the one that matters: the crosshair is at 50, so the fruit
 * must stop below it. The rest stop the fix from being "shrink it until it is
 * not a problem" — a carried fruit still has to be visible and still has to be
 * lit by a scene the player can see past.
 */
function assertFraming(label, m, cap) {
  const c = m.carry;
  check(c.visible !== false && c.heightPct > 0, `${label}: the fruit is actually drawn`);
  if (!c.heightPct) return;
  check(c.heightPct <= cap, `${label}: does not dominate the frame`,
    `${c.heightPct}% of frame height (cap ${cap}%)`);
  check(c.heightPct >= 9, `${label}: is still big enough to read`, `${c.heightPct}%`);
  check(c.topPct <= 44, `${label}: keeps the crosshair clear`, `top at ${c.topPct}%`);
  check(!c.offRight && !c.offLeft, `${label}: stays inside the frame sideways`,
    `${c.leftPct}..${c.rightPct}%`);
  check(c.nearest > c.camNear * 4, `${label}: cannot clip the near plane`,
    `nearest ${c.nearest} m, near plane ${c.camNear}`);
  check(!m.rig.offRight && !m.rig.offLeft, `${label}: the grip hands stay inside the frame`,
    `${m.rig.leftPct}..${m.rig.rightPct}%`);
  check(!m.vm.toolShown, `${label}: the equipped tool is not drawn as well`);
  check(m.comp.dominant < 0.45, `${label}: the world is still visible past it`,
    `${(m.comp.dominant * 100).toFixed(0)}% of the frame is one colour`);
}

/** Hold a synthetic input for a while, then let go. */
async function hold(g, patch, seconds) {
  await g.input(patch);
  await g.wait(seconds);
  await g.clearInput();
}

/** Look from the player toward a world point. */
async function faceTo(g, x, y, z) {
  const s = await g.state();
  const [px, py, pz] = s.player.pos;
  const dx = x - px, dy = y - (py + 1.6), dz = z - pz;
  await g.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
}

const results = [];

await withGame(async (g) => {
  ensureOut(SUB);

  // A clear, flat, well-lit spot with the island in front of it, so the
  // composition numbers mean something. The hill farm looks out over the
  // orchard and the sea.
  await g.call('tool.give', 'basket').catch(() => {});
  const h = await g.terrainHeight(-6, 26);
  await g.tp(-6, h + 1.4, 26);
  await g.look(0.6, -0.05);
  await g.wait(0.6);

  const base = await measure(g);
  console.log('--- empty handed ---');
  console.log(`  tool ${base.vm.tool}  shown ${base.vm.toolShown}  ` +
    `sky ${base.comp.sky}  dominant ${base.comp.dominant}`);
  check(base.carry.visible === false || !base.carry.heightPct,
    'nothing is drawn in the hands when the hands are empty');
  check(base.vm.toolShown, 'the equipped tool IS drawn when the hands are empty');
  results.push({ file: await g.shot('00-empty', SUB), label: 'empty hands',
    note: `sky ${base.comp.sky}` });

  // ---- one fruit per carry class -----------------------------------------
  console.log('\n--- carrying, by class ---');
  const CASES = [
    { species: 'apple', label: 'apple (small)', cls: 'small', cap: 27 },
    { species: 'coconut', label: 'coconut (small)', cls: 'small', cap: 27 },
    { species: 'banana', label: 'banana (medium)', cls: 'medium', cap: 31 },
    { species: 'puffmelon', label: 'puff, deflated (medium)', cls: 'medium', cap: 31 },
    { species: 'watermelon', label: 'watermelon (large)', cls: 'large', cap: 35 },
  ];

  const st0 = await g.state();
  const [px, py, pz] = st0.player.pos;
  const spawnAt = async (species, variant = null) =>
    g.call('fruit.spawn', species, px, py + 1.2, pz - 1.2, variant, 0.5);

  for (const c of CASES) {
    const id = await spawnAt(c.species);
    if (c.species === 'puffmelon') await g.call('fruit.inflate', id, 1.0);
    const got = await g.call('pickup', id);
    check(got, `${c.label}: picked up`);
    await g.wait(0.8);
    const m = await measure(g);
    console.log(' ', line(c.label, m));
    check(m.inter.carrying?.cls === c.cls, `${c.label}: classified ${c.cls}`,
      `got ${m.inter.carrying?.cls}`);
    assertFraming(c.label, m, c.cap);
    // The sky must not collapse: if the fruit were still being drawn at world
    // scale 0.9 m from the eye, this is the number that would give it away.
    check(Math.abs(m.comp.sky - base.comp.sky) < 0.16, `${c.label}: the view ahead survives`,
      `sky ${m.comp.sky} vs ${base.comp.sky} empty-handed`);
    results.push({ file: await g.shot(`0${results.length}-${c.species}`, SUB),
      label: c.label, note: `h ${m.carry.heightPct}% top ${m.carry.topPct}%` });

    // ---- and it must survive being moved and aimed --------------------
    for (const [what, yaw, pitch] of [['up', 0.6, 1.15], ['down', 0.6, -1.3]]) {
      await g.look(yaw, pitch);
      await g.wait(0.35);
      const mm = await measure(g);
      check((mm.carry.heightPct ?? 0) <= c.cap + 2, `${c.label}: looking ${what} keeps it framed`,
        `${mm.carry.heightPct}%`);
      check((mm.carry.topPct ?? 0) <= 46, `${c.label}: looking ${what} keeps the crosshair clear`,
        `top ${mm.carry.topPct}%`);
    }
    await g.look(0.6, -0.05);
    await hold(g, { moveZ: 1, sprint: true }, 0.9);
    const ms = await measure(g);
    check((ms.carry.heightPct ?? 0) <= c.cap + 2, `${c.label}: sprinting keeps it framed`,
      `${ms.carry.heightPct}%`);
    check((ms.carry.topPct ?? 0) <= 46, `${c.label}: sprinting keeps the crosshair clear`,
      `top ${ms.carry.topPct}%`);

    await g.call('drop');
    await g.wait(0.6);
    const after = await g.viewExtent('CarryFruit');
    check(after.visible === false || !after.heightPct, `${c.label}: dropping clears the hands`);
    await g.call('fruit.despawnAllFree');
    await g.tp(px, py, pz);
    await g.look(0.6, -0.05);
    await g.wait(0.3);
  }

  // ---- swapping tools while carrying --------------------------------------
  console.log('\n--- tools while carrying ---');
  const heldId = await spawnAt('coconut');
  await g.call('pickup', heldId);
  await g.wait(0.4);
  for (const t of await g.call('tool.list')) {
    await g.call('tool.give', t.id).catch(() => {});
    await g.call('tool.select', t.id);
    await g.wait(0.7);
    const m = await measure(g);
    check(!m.vm.toolShown, `${t.id}: stays stowed while carrying`);
    check((m.carry.heightPct ?? 0) > 0, `${t.id}: the fruit is still the thing on screen`);
  }
  await g.call('tool.select', 'hand');
  await g.call('drop');
  await g.call('fruit.despawnAllFree');
  await g.wait(0.4);
  const afterTools = await measure(g);
  check(afterTools.vm.toolShown, 'the tool comes back once the hands are free');

  // ---- the Puff Melon, which is the whole reason for this file ------------
  console.log('\n--- puff melon ---');
  const puff = await spawnAt('puffmelon');
  await g.call('fruit.inflate', puff, 1.0);
  check(await g.call('pickup', puff), 'a deflated puff melon can be carried normally');
  await g.wait(0.3);
  const small = await measure(g);
  console.log(' ', line('puff @ x1.0', small));
  assertFraming('puff deflated', small, 31);

  // Inflate it in the hands, one pinned size at a time.
  //
  // Letting it inflate freely and sampling as fast as the harness can round-trip
  // does NOT work: real inflation is over in two thirds of a second and a single
  // canvas readback costs most of a tenth, so the first sample already caught a
  // fruit that had grown, been rejected and left. The check passed and had
  // observed nothing. Pinning the size is the only way to stand still inside the
  // transition and look at it.
  let worstHeight = small.carry.heightPct;
  let worstTop = small.carry.topPct;
  console.log('  inflating, pinned:');
  for (const v of [1.25, 1.5, 1.75, 1.95]) {
    await g.call('fruit.inflate', puff, v);
    await g.wait(0.45);
    const m = await measure(g);
    const d = +(0.56 * v).toFixed(2);
    console.log(' ', line(`puff @ x${v} (${d} m)`, m));
    check(!!m.inter.carrying, `puff x${v}: still in hand`);
    if (m.carry.heightPct) {
      worstHeight = Math.max(worstHeight, m.carry.heightPct);
      worstTop = Math.max(worstTop, m.carry.topPct);
    }
    check((m.carry.heightPct ?? 0) <= 35, `puff x${v}: framed`, `${m.carry.heightPct}%`);
    check((m.carry.topPct ?? 0) <= 44, `puff x${v}: crosshair clear`, `top ${m.carry.topPct}%`);
    if (v === 1.75) {
      results.push({ file: await g.shot('90-puff-inflating', SUB),
        label: 'puff inflating in hand', note: `x${v} = ${d} m, h ${m.carry.heightPct}%` });
    }
  }
  console.log(`  worst height ${worstHeight}%  worst top ${worstTop}%`);
  check(worstHeight <= 35, 'an inflating puff melon never dominates the frame',
    `peaked at ${worstHeight}% of frame height`);
  check(worstTop <= 44, 'an inflating puff melon never crosses the crosshair',
    `peaked at ${worstTop}%`);
  // A 1.09 m ball is the last thing two hands will close around; 1.12 m is not.
  const pre = (await g.state()).interaction;
  check(pre.carrying?.cls === 'large', 'at 1.09 m across it is a heavy two-hand haul',
    String(pre.carrying?.cls));
  await g.call('fruit.inflate', puff, 2.05, true);
  await g.wait(0.4);
  const post = (await g.state()).interaction;
  check(!post.carrying, 'and one step past the limit it leaves the hands');

  // How much of the frame it owns on the way out, as an angle rather than a
  // picture: a sphere of radius r at distance d subtends 2·asin(r/d), and the
  // vertical FOV is 68°. Anything over about half the frame is the original bug
  // wearing a hat, so this is sampled while it is still leaving.
  const subtends = async () => {
    const f = await g.call('fruit.info', puff);
    if (!f) return { gone: true, pct: 0, dist: 0 };
    const s = await g.state();
    const d = Math.hypot(f.pos[0] - s.player.pos[0], f.pos[1] - (s.player.pos[1] + 1.6),
      f.pos[2] - s.player.pos[2]);
    const r = f.size / 2;
    const deg = d <= r ? 180 : 2 * Math.asin(Math.min(1, r / d)) * 180 / Math.PI;
    return { gone: false, pct: +(deg / 68 * 100).toFixed(1), dist: +d.toFixed(2), r };
  };
  const leaving = [];
  for (let i = 0; i < 3; i++) { leaving.push(await subtends()); await g.wait(0.25); }
  console.log('  leaving: ' + leaving.map((l) => `${l.dist} m / ${l.pct}% of FOV`).join('  ->  '));
  check(leaving.every((l) => l.gone || l.pct < 62), 'the escaping melon never owns the frame',
    leaving.map((l) => `${l.pct}%`).join(', '));
  check(leaving[2].gone || leaving[2].dist > leaving[0].dist,
    'and it is going away, not hanging about',
    `${leaving[0].dist} m -> ${leaving[2].dist} m`);

  const escaped = await g.call('fruit.info', puff);
  const st1 = await g.state();
  if (escaped) {
    const dist = Math.hypot(escaped.pos[0] - st1.player.pos[0], escaped.pos[2] - st1.player.pos[2]);
    check(escaped.state === 'free', 'and is a physics object again', escaped.state);
    check(dist > 0.6, 'the escaped melon is clear of the player', `${dist.toFixed(2)} m away`);
  }
  // The real risk of handing a 1.7 m ball back to the solver next to a person
  // is not that it looks wrong, it is that one of them gets fired off the
  // island. This is the assertion that would catch it.
  check(st1.player.state === 'active', 'the player is not flattened by the escape',
    st1.player.state);
  check(st1.player.speed < 9, 'and is not launched by it', `${st1.player.speed} m/s`);
  const afterPuff = await measure(g);
  check(!afterPuff.inter.carrying, 'nothing is left in the hands');
  check(afterPuff.vm.toolShown, 'the tool comes back after the melon escapes');
  results.push({ file: await g.shot('91-puff-escaped', SUB), label: 'puff escaped',
    note: escaped ? `x${escaped.inflate} at ${escaped.pos[1].toFixed(1)} m` : 'gone' });

  // ---- and it may not be picked up again ---------------------------------
  const big = await spawnAt('puffmelon');
  await g.call('fruit.inflate', big, 3.1);
  const bigInfo = await g.call('fruit.info', big);
  const beforeShove = bigInfo.pos.slice();
  await g.wait(0.4);
  const cls = await g.call('carry.class', bigInfo.size, bigInfo.mass);
  check(cls === 'oversized', 'a fully inflated puff melon classifies as oversized', cls);
  const took = await g.call('pickup', big);
  check(!took, 'picking it up is refused');
  const refused = (await g.state()).interaction;
  check(!refused.carrying, 'and nothing ends up in the hands');
  check(!!refused.lastRefusal, 'with a reason the player can read', refused.lastRefusal ?? '');
  await g.wait(0.5);
  const moved = await g.call('fruit.info', big);
  const shoved = moved ? Math.hypot(moved.pos[0] - beforeShove[0], moved.pos[2] - beforeShove[2]) : 0;
  check(shoved > 0.2, 'but leaning on it shoves it', `moved ${shoved.toFixed(2)} m`);

  // ---- aiming at something oversized teaches the verb ---------------------
  //
  // Deliberately NOT the Puff Melon: it is buoyant, so it is still moving while
  // the prompt is being read, and a flaky check about a floating target proves
  // nothing about prompts. An Ancient Apple is oversized by WEIGHT (82 kg in a
  // 0.73 m package), sits exactly where it lands, and exercises the same rule.
  await g.call('fruit.despawnAllFree');
  const heavy = await g.call('fruit.spawn', 'apple', px + 1.4, py + 0.6, pz - 1.6, 'ancient', 0.5);
  await g.wait(1.4);
  const hInfo = await g.call('fruit.info', heavy);
  check(await g.call('carry.class', hInfo.size, hInfo.mass) === 'oversized',
    'an Ancient Apple is oversized by weight alone', `${hInfo.mass} kg, ${hInfo.size} m`);
  await faceTo(g, hInfo.pos[0], hInfo.pos[1], hInfo.pos[2]);
  await g.wait(0.35);
  const aim = (await g.state()).interaction;
  check(aim.targetKind === 'shove', 'aiming at it offers a shove', String(aim.targetKind));
  check((aim.prompt ?? '').toLowerCase().includes('shove'), 'and says so', aim.prompt ?? '');
  const restBefore = (await g.call('fruit.info', heavy)).pos.slice();
  await g.call('interact');
  await g.wait(0.7);
  const restAfter = await g.call('fruit.info', heavy);
  check(!(await g.state()).interaction.carrying, 'pressing E does not put it in your hands');
  check(Math.hypot(restAfter.pos[0] - restBefore[0], restAfter.pos[2] - restBefore[2]) > 0.15,
    'pressing E shoves it instead');
  results.push({ file: await g.shot('92-oversized', SUB), label: 'oversized, refused',
    note: aim.prompt ? aim.prompt.replace(/<[^>]+>/g, '') : '' });

  // ---- highlight ----------------------------------------------------------
  console.log('\n--- aiming ---');
  await g.call('fruit.despawnAllFree');
  const lit = await g.page.evaluate(() => {
    const fs = window.__GAME.get('fruit');
    return { highlight: fs.renderer.highlightId, hidden: fs.renderer.hiddenId };
  });
  check(lit.hidden === -1, 'nothing is suppressed from the world batch when empty-handed');

  // Reading the canvas back for the composition numbers makes Chromium's GL
  // layer complain about pipeline stalls. That is a fact about the instrument,
  // not about the game, so it does not count.
  const real = g.consoleErrors.filter((e) => !/GPU stall due to ReadPixels|GL Driver Message/.test(e));
  if (g.consoleErrors.length) {
    console.log('\n--- console ---');
    for (const e of g.consoleErrors.slice(0, 8)) console.log('  ', e);
  }
  check(real.length === 0, 'no console errors', `${real.length} logged`);
}, { headless: true, width: 1280, height: 720, quiet: true });

const sheet = await contactSheet(results, path.join('capture', SUB, '_sheet.png'), {
  cols: 3, thumbW: 420, title: 'RIPE RIOT — first-person carry states',
});
console.log('\nsheet:', sheet);

if (shotsOnly) process.exit(0);
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nOK');
process.exit(failures ? 1 : 0);
