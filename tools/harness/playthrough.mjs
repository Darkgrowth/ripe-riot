// A fresh save, played the way a new player would, with a stopwatch.
//
//   node tools/harness/playthrough.mjs
//
// The world is advanced in SIMULATED time (see run-tests.mjs), so the
// stopwatch is the game clock: every pick, every sale and every wait costs
// what it costs the game. Walking is the one thing a script cannot do
// honestly across trees and fences, so travel is charged by distance at walk
// speed plus a look-around allowance, and the player is teleported to the
// destination. Every OTHER action goes through the same entry points the
// keys use — `interact` is E, `pickup` is what E calls, `shop.buy` is a click
// on the counter — so what the timeline measures is the game's pacing, not
// the script's optimism.
//
// It prints a timeline and never asserts. Read it before and after tuning a
// price or a habitat.

import { withGame } from './driver.mjs';

const WALK = 5.4;          // m/s, the controller's walk speed
const LOOK = 2.5;          // seconds per stop, for looking at where you are
const PICK_STEP = 0.35;    // seconds per apple: reach, click, next
const LADDER = 6.0;        // seconds per coconut: place, climb, pick, descend

await withGame(async (raw) => {
  const g = raw;
  await g.pause(true);
  const sim = (s) => g.simulate(s);
  const marks = [];
  const t = async () => (await g.state()).elapsed;
  const mark = async (what, detail = '') => {
    const at = await t();
    marks.push({ at, what, detail });
    console.log(`  ${mmss(at)}  ${what}${detail ? '  — ' + detail : ''}`);
  };

  // Fresh.
  await g.call('save.clear');
  await g.call('progress.reset');
  await g.call('legendary.reset');
  await g.call('economy.set', 0);
  await g.call('world.respawn');
  await sim(0.5);
  const world = await g.call('world.info');
  const at = { x: 0, z: 0 };
  { const s = await g.state(); at.x = s.player.pos[0]; at.z = s.player.pos[2]; }

  /** Walk somewhere: charge the time, then stand there. */
  async function walkTo(x, z, why) {
    const d = Math.hypot(x - at.x, z - at.z);
    const secs = d / WALK + LOOK;
    const h = await g.terrainHeight(x, z);
    await g.tp(x, h + 1.0, z);
    await g.look(0, 0);
    await sim(secs);
    at.x = x; at.z = z;
    if (why) console.log(`      walked ${d.toFixed(0)} m to ${why}`);
  }
  const money = async () => (await g.state()).economy.money;
  const lm = (id) => world.landmarks[id].pos;

  /** Fill the basket with the nearest hand-pickable fruit of a species. */
  async function pickRun(species, want, from) {
    let got = 0;
    for (let i = 0; i < want * 3 && got < want; i++) {
      const f = await g.call('fruit.nearest', from[0], from[1] + 2, from[2], species, 'attached');
      if (!f || f.dist > 40) break;
      // Reach: stand under it. Anything more than 3.4 m up needs the ladder.
      const h = await g.terrainHeight(f.pos[0], f.pos[2]);
      const up = f.pos[1] - h;
      const walk = Math.hypot(f.pos[0] - at.x, f.pos[2] - at.z) / WALK;
      at.x = f.pos[0]; at.z = f.pos[2];
      await g.tp(f.pos[0] + 0.9, h + 1.0, f.pos[2] + 0.9);
      await sim(walk + (up > 3.2 ? LADDER : PICK_STEP));
      const ok = await g.call('pickup', f.id);
      if (ok) got++;
      await sim(0.1);
    }
    return got;
  }
  async function sellAtPad() {
    await walkTo(world.sellPad[0] + 0.5, world.sellPad[2] + 0.5, 'the sell pad');
    await sim(0.4);
    const before = await money();
    await g.call('sell');
    await sim(0.5);
    return (await money()) - before;
  }
  async function buy(id) {
    await walkTo(world.shopCounter[0] + 1.2, world.shopCounter[2] + 1.2, 'the shed');
    const r = await g.call('shop.buy', id);
    await sim(1.0);
    return r;
  }
  const priceOf = async (id) => (await g.call('shop.list')).find((e) => e.id === id)?.cost ?? Infinity;
  const owned = async (id) => (await g.state()).tools.owned.includes(id);

  console.log('\n== fresh save playthrough ==');
  await mark('spawn on the dock', 'King Melon and the shed in the opening frame');
  await walkTo(world.shopCounter[0] + 2, world.shopCounter[2] + 3, 'the shed (reads the bounty poster and the island board)');
  await mark('bounty poster read', 'WANTED: THE KING MELON — $9,500 — BRING ROPE');

  // --- first loop: apples
  const orchard = lm('orchard');
  await walkTo(orchard[0] + 6, orchard[2] + 8, 'the orchard');
  const apples = await pickRun('apple', 9, [at.x, orchard[1], at.z]);
  await mark('first basket', `${apples} apples`);
  // The first funny thing: an orange rolls, a watermelon objects to being dropped.
  const orange = await g.call('fruit.nearest', at.x, orchard[1] + 2, at.z, 'orange', 'attached');
  if (orange) {
    const h = await g.terrainHeight(orange.pos[0], orange.pos[2]);
    await g.tp(orange.pos[0] + 0.9, h + 1.0, orange.pos[2] + 0.9);
    await sim(1.0);
    await g.call('pickup', orange.id);
    await sim(0.3);
    await g.call('throw', 0.8);
    await sim(3.0);
    const o = await g.call('fruit.info', orange.id);
    if (o) console.log(`      threw an orange: it went ${o.travelled} m`);
  }
  const melon = await g.call('fruit.nearest', at.x, orchard[1] + 1, at.z, 'watermelon', 'attached');
  if (melon) {
    const h = await g.terrainHeight(melon.pos[0], melon.pos[2]);
    await g.tp(melon.pos[0] + 0.9, h + 1.0, melon.pos[2] + 0.9);
    await sim(1.5);
    await g.call('pickup', melon.id);
    await sim(0.5);
    // Carry it up the ladder and drop it, the way everybody does once.
    await g.tp(melon.pos[0] + 0.9, h + 4.5, melon.pos[2] + 0.9);
    await sim(0.1);
    await g.call('drop');
    await sim(2.5);
    const m = await g.call('fruit.info', melon.id);
    if (m) console.log(`      dropped a watermelon off a ladder: ${m.quality}, worth $${m.value}`);
    else console.log('      dropped a watermelon off a ladder: it burst');
  }
  const prog1 = (await g.state()).progress.milestones;
  if (prog1.firstBruise !== undefined || prog1.firstBurst !== undefined) {
    await mark('first physics failure', prog1.firstBurst !== undefined ? 'a watermelon burst' : 'a watermelon bruised');
  }
  let earned = await sellAtPad();
  await mark('first sale', `$${earned}, balance $${await money()}`);

  // --- earn the net
  let loops = 1;
  while ((await money()) < await priceOf('net') && loops < 8) {
    await walkTo(orchard[0] - 4, orchard[2] + 4, null);
    const n = await pickRun('apple', 9, [at.x, orchard[1], at.z]);
    if (!n) break;
    earned = await sellAtPad();
    loops++;
  }
  let r = await buy('net');
  if (r.ok) await mark('first purchase', `Catch Net after ${loops} orchard runs, balance $${await money()}`);

  // --- coconuts: the palms by the shed. A ladder, a friend, a bonk.
  const palm = await g.call('plant.nearest', 53, 3, 46, 'palm', true);
  if (palm) {
    await walkTo(palm.pos[0] + 1.5, palm.pos[2] + 1.5, 'the coconut palm by the shed');
    // Stand under it while a coconut comes down: the first knockdown.
    const nut = await g.call('fruit.nearest', palm.pos[0], palm.pos[1] + 8, palm.pos[2], 'coconut', 'attached');
    if (nut) {
      await g.tp(nut.pos[0], (await g.terrainHeight(nut.pos[0], nut.pos[2])) + 1.0, nut.pos[2]);
      await sim(LADDER);
      await g.call('fruit.detach', nut.id);
      await sim(2.5);
      const ms = (await g.state()).progress.milestones;
      if (ms.firstKnockdown !== undefined) await mark('first knockdown', 'a coconut, from the palm by the shed');
      await g.call('ragdoll.recover');
      await sim(1.0);
    }
    const nuts = await pickRun('coconut', 6, [palm.pos[0], palm.pos[1] + 8, palm.pos[2]]);
    earned = await sellAtPad();
    console.log(`      sold ${nuts} coconuts for $${earned}, balance $${await money()}`);
  }

  // --- the shaker, then the beach for real money
  while ((await money()) < await priceOf('shaker') && loops < 14) {
    await walkTo(orchard[0], orchard[2], null);
    if (!(await pickRun('apple', 9, [at.x, orchard[1], at.z]))) break;
    await sellAtPad();
    loops++;
  }
  r = await buy('shaker');
  if (r.ok) await mark('second purchase', `Tree Shaker, balance $${await money()}`);

  const beach = lm('palmBeach');
  await walkTo(beach[0], beach[2], 'palm beach');
  for (let round = 0; round < 3; round++) {
    const p2 = await g.call('plant.nearest', at.x, beach[1], at.z, 'palm', true);
    if (!p2) break;
    await g.tp(p2.pos[0] + 1.7, (await g.terrainHeight(p2.pos[0], p2.pos[2])) + 1.0, p2.pos[2]);
    await sim(1.0);
    await g.call('plant.shake', p2.id, 1.75);
    await sim(2.5);
    // Pick the windfall up off the sand.
    for (let i = 0; i < 9; i++) {
      const f = await g.call('fruit.nearest', p2.pos[0], p2.pos[1], p2.pos[2], null, 'free');
      if (!f || f.dist > 9) break;
      await g.tp(f.pos[0] + 0.6, (await g.terrainHeight(f.pos[0], f.pos[2])) + 1.0, f.pos[2] + 0.6);
      await sim(0.8);
      if (!(await g.call('pickup', f.id))) break;
    }
    at.x = p2.pos[0]; at.z = p2.pos[2];
  }
  const bananas = await pickRun('banana', 3, [at.x, beach[1] + 2, at.z]);
  earned = await sellAtPad();
  await mark('beach haul sold', `$${earned} (${bananas} bananas among it), balance $${await money()}, tier ${(await g.state()).economy.tier}`);

  // --- the waterfall: the first strange fruit
  const falls = lm('waterfall');
  await walkTo(falls[0] - 6, falls[2] + 10, 'the waterfall basin');
  for (const sp of ['gluefruit', 'puffmelon']) {
    const f = await g.call('fruit.nearest', at.x, falls[1] + 2, at.z, sp, 'attached');
    if (!f) continue;
    await g.tp(f.pos[0] + 0.9, (await g.terrainHeight(f.pos[0], f.pos[2])) + 1.0, f.pos[2] + 0.9);
    await sim(Math.hypot(f.pos[0] - at.x, f.pos[2] - at.z) / WALK + 1.0);
    at.x = f.pos[0]; at.z = f.pos[2];
    await g.call('fruit.detach', f.id);
    await sim(1.5);
  }
  const ms2 = (await g.state()).progress.milestones;
  if (ms2.firstStrangeFruit !== undefined) await mark('first strange fruit', `discovered at the waterfall, tier ${(await g.state()).economy.tier}`);

  // --- the rope gun. Coconuts the way the palm by the shed taught: up the
  // ladder, picked Perfect, nine at a time. (Shaking them down onto the
  // beach and chasing them was measured at about $40 a trip — half roll
  // into the sea — and put the gun eight minutes away. The ladder is the
  // strategy a player has already learned by now.)
  while ((await money()) < await priceOf('ropegun') && loops < 24) {
    await walkTo(beach[0] - 6, beach[2] + 4, 'palm beach');
    const got = await pickRun('coconut', 9, [at.x, beach[1] + 8, at.z]);
    if (!got) break;
    const made = await sellAtPad();
    console.log(`      ladder-picked ${got} coconuts, sold for $${made}, balance $${await money()}`);
    loops++;
  }
  const tierNow = (await g.state()).economy.tier;
  r = await buy('ropegun');
  await mark(r.ok ? 'rope gun bought' : `rope gun refused (${r.reason})`,
    `balance $${await money()}, tier ${tierNow}, ${loops} harvest runs so far`);
  if (r.ok) await mark('legendary readiness', 'the King Melon opens to TETHER the moment the gun is owned');

  // --- the hill farm and the ridge: boulder plums, spikefruit, the melon in view
  const hill = lm('hillFarm');
  await walkTo(hill[0], hill[2], 'the hill farm (up the second worn track)');
  const seen = (await g.state()).progress.milestones.kingMelonSeen;
  if (seen !== undefined) await mark('King Melon explained', 'first sight within 70 m: 2,600 kg, $9,500, four vines');
  const plum = await g.call('fruit.nearest', at.x, hill[1] + 1, at.z, 'boulderplum', 'attached');
  if (plum) {
    await g.tp(plum.pos[0] + 0.9, (await g.terrainHeight(plum.pos[0], plum.pos[2])) + 1.0, plum.pos[2] + 0.9);
    await sim(2.0);
    await g.call('fruit.detach', plum.id);
    await sim(6.0);
    const p = await g.call('fruit.info', plum.id);
    await mark('boulder plum found', p ? `it rolled ${p.travelled} m before anyone touched it` : 'it rolled off the island');
  }

  // --- the King Melon, solo, the way the tests do it
  const info = await g.call('legendary.info');
  await walkTo(info.home[0] + 18, info.home[2] + 16, 'the ravine rim');
  await g.call('legendary.tether');
  await walkTo(info.home[0] - 16, info.home[2] + 14, 'the far rim');
  await g.call('legendary.tether');
  await sim(1.0);
  await mark('two tethers on the King Melon', `${(await g.state()).legendary.tethers} tethers`);
  await g.call('legendary.cut', 4);
  await sim(0.5);
  await mark('last vine cut', 'the drop');
  let ph = (await g.state()).legendary.phase;
  for (let i = 0; i < 40 && (ph === 'drop'); i++) { await sim(0.5); ph = (await g.state()).legendary.phase; }
  for (let i = 0; i < 20 && ph === 'recover'; i++) {
    const s = (await g.state()).legendary;
    const dx = info.pad[0] - s.pos[0], dz = info.pad[2] - s.pos[2], d = Math.hypot(dx, dz) || 1;
    await g.call('legendary.nudge', (dx / d) * 4, 1.2, (dz / d) * 4);
    await sim(0.9);
    ph = (await g.state()).legendary.phase;
  }
  if (ph === 'recover') {
    await g.call('legendary.place', info.pad[0], info.pad[1] + 5.8, info.pad[2]);
    await sim(3.0);
    ph = (await g.state()).legendary.phase;
  }
  await mark(`King Melon ${ph}`, `payout $${(await g.state()).legendary.paid}, balance $${await money()}`);
  await sim(4.0);
  const fin = (await g.state()).progress;
  await mark(fin.nextIsland ? 'GALE GROVE UNLOCKED' : 'next island still locked', `islands ${fin.islands.join(', ')}`);

  // --- the report
  console.log('\n== timeline ==');
  for (const m of marks) console.log(`  ${mmss(m.at).padEnd(6)} ${m.what}`);
  const ms = (await g.state()).progress.milestones;
  console.log('\n== milestones the game itself recorded ==');
  for (const [k, v] of Object.entries(ms).sort((x, y) => x[1] - y[1])) console.log(`  ${mmss(v).padEnd(6)} ${k}`);
  console.log(`\n  ${loops} harvest runs, ${(await g.state()).economy.sold} fruit sold, lifetime $${(await g.state()).economy.lifetime}`);
}, { width: 320, height: 180, headless: true, quiet: true });

function mmss(s) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}
