// Host migration, driven through the real transport and the real gameplay path.
//
// The question this file exists to answer: WHEN THE HOST LEAVES, CAN A PLAYER
// TELL WHICH MACHINE TOOK OVER BY WATCHING THE FRUIT?
//
// It is a separate file from multiplayer.mjs because a migration is the one
// thing worth running SEVERAL TIMES — the peer that gets promoted alternates
// as the departed one rejoins, and a bug that only bites when the promoted
// peer is the one that was carrying something is exactly the bug that ships.
//
//   node tools/harness/migration.mjs        # three loose-fruit runs + legendary
//   node tools/harness/migration.mjs 5      # five
//
// Nothing here calls a promotion method directly. The migration is caused the
// way a player causes one — the host's page disconnects — and everything after
// it is read back through the same debug surface the multiplayer suite uses.

import { startServer, openGame, openSecondClient, sleep } from './driver.mjs';

const RUNS = Math.max(1, Number(process.argv[2] ?? 3));
const server = await startServer();
const checks = [];
const ok = (cond, label, detail = '') => {
  checks.push({ ok: !!cond, label, detail });
  if (!cond) console.log(`    FAIL ${label}${detail ? `  (${detail})` : ''}`);
  return !!cond;
};

/** Long enough for an intent to reach the host and its answer to come back. */
const ROUND_TRIP = 900;
/** Long enough for a 15 Hz snapshot and a 20 Hz player packet to land. */
const SETTLE = 1400;
/**
 * The transport prunes a silent peer after 3.5 s. A clean `bye` should promote
 * the survivor long before that, and this budget is what asserts it: if the
 * promotion ever falls back to the liveness timeout, the island stands still
 * for three and a half seconds and this check fails.
 */
const PROMOTE_BUDGET = 2500;

let a, b;
try {
  console.log('opening two clients...');
  a = await openGame({ width: 400, height: 225, headless: true, quiet: true });
  b = await openSecondClient(a);

  const room = 'mig' + Math.floor(Math.random() * 1e6);
  await a.call('net.connect', room, 0);
  await b.call('net.connect', room, 0);
  await sleep(2600);

  const pages = new Map([['A', a], ['B', b]]);

  // ---- helpers ----------------------------------------------------------
  /** Poll until `fn` is truthy or the budget runs out. Returns the ms taken. */
  async function until(fn, budget, step = 120) {
    const t0 = Date.now();
    for (;;) {
      if (await fn()) return Date.now() - t0;
      if (Date.now() - t0 > budget) return -1;
      await sleep(step);
    }
  }

  /**
   * Put a peer somewhere and let its packet get out. Recovery runs BEFORE the
   * teleport: it stands the player up wherever the torso came to rest, which
   * would otherwise undo it. The settle matters as much as the pose — the host
   * validates every zone against the position a client REPORTS at 20 Hz.
   */
  async function place(page, x, y, z) {
    await page.call('ragdoll.recover').catch(() => {});
    await page.tp(x, y, z);
    await sleep(ROUND_TRIP);
  }

  /** The same, on the terrain: dropping a player in from a height ragdolls
   *  them, and a ragdolled player drops whatever they were carrying. */
  async function stand(page, x, z, lift = 1.2) {
    await place(page, x, (await page.terrainHeight(x, z)) + lift, z);
  }

  /** Turn a peer to look at a world point, from where it stands. */
  async function faceTo(page, x, y, z) {
    const [px, py, pz] = (await page.state()).player.pos;
    await page.look(Math.atan2(-(x - px), -(z - pz)),
      Math.atan2(y - (py + 1.6), Math.hypot(x - px, z - pz)));
  }

  /** Which page is hosting right now, and which is not. */
  async function sides() {
    const st = new Map();
    for (const [k, p] of pages) st.set(k, (await p.state()).net);
    const hostKey = [...st].find(([, n]) => n.isHost)?.[0];
    const clientKey = [...pages.keys()].find((k) => k !== hostKey);
    return {
      host: pages.get(hostKey), client: pages.get(clientKey),
      hostKey, clientKey,
      hostId: st.get(hostKey).id, clientId: st.get(clientKey).id,
      agree: st.get(hostKey).hostId === st.get(clientKey).hostId,
    };
  }

  /** Which bucket(s) of a peer's census a fruit id is in. Exactly one is the
   *  invariant; two is a duplicate and none is a fruit that was lost. */
  const bucketsOf = (census, id) =>
    ['attached', 'loose', 'carried', 'basket'].filter((k) => census[k].includes(id));

  /** Every id in a census, with duplicates kept, so they can be counted. */
  const allIds = (c) => [...c.attached, ...c.loose, ...c.carried, ...c.basket];

  const dup = (ids) => {
    const seen = new Set(); const out = [];
    for (const id of ids) { if (seen.has(id)) out.push(id); seen.add(id); }
    return out;
  };

  const why = async (p) => `last refusal "${(await p.state()).net.lastDeny}"`;

  /** Ropes on a peer that end on a given fruit id. */
  const ropesOn = async (page, fruitId) =>
    (await page.state()).ropes.list.filter((r) =>
      (r.ak === 'fruit' && r.a === fruitId) || (r.bk === 'fruit' && r.b === fruitId));

  // =====================================================================
  // THE LOOSE-FRUIT MIGRATION
  // =====================================================================
  async function migrationRun(run) {
    const s0 = await sides();
    console.log(`\n--- run ${run + 1}/${RUNS}: ${s0.hostKey} hosts, ${s0.clientKey} is promoted`);
    ok(s0.agree, `run ${run + 1}: both peers agree who is hosting before the migration`);
    const { host, client, hostId, clientId } = s0;

    // A clean board: nothing loose, no ropes, no money.
    await host.call('rope.clear');
    await client.call('rope.clear');
    await host.call('drop');
    await client.call('drop');
    await host.call('fruit.despawnAllFree');
    await sleep(SETTLE);
    await host.call('economy.set', 0);
    await sleep(SETTLE);

    const world = await host.call('world.info');
    const pad = world.sellPad;

    // ---- the fixture --------------------------------------------------
    // Everything below is built through the ordinary game paths so the
    // migration has real state to inherit rather than a staged one.

    // The client stands in the orchard; the host stands at the drop-off.
    const orchard = [-24, 22];
    await stand(client, orchard[0], orchard[1]);
    await place(host, pad[0], pad[1] + 1.2, pad[2]);
    const padPos = (await host.state()).player.pos;

    // SD — a fruit the host sells BEFORE it leaves. Its tombstone has to
    // outlive the machine that made it, or the next session pays for it again.
    const toSell = await host.call('fruit.spawn', 'watermelon', padPos[0], padPos[1] + 1.2, padPos[2]);
    await sleep(SETTLE);
    await host.call('pickup', toSell);
    await sleep(ROUND_TRIP);
    await host.call('sell');
    await sleep(SETTLE);
    const soldValue = (await host.state()).economy.money;

    // CB / CC — one apple in the client's basket, one in its hands, both taken
    // the way the E key takes them: an intent the host answers. Done from ONE
    // standing spot, because the client fires a rope from it in a moment and
    // walking off with a line out is a different test.
    const clientPos = (await client.state()).player.pos;
    const appleA = await host.call('fruit.nearest',
      clientPos[0], clientPos[1], clientPos[2], 'apple', 'attached');
    await stand(client, appleA.pos[0], appleA.pos[2]);
    await client.call('pickup', appleA.id);
    await sleep(ROUND_TRIP);
    await client.call('stow');
    await sleep(ROUND_TRIP);
    const basketed = appleA.id;
    const stood = (await client.state()).player.pos;
    const groundY = await host.terrainHeight(stood[0], stood[2]);

    // R — a melon the CLIENT ropes with its own gun. Its near end is the
    // client's own hands, which stay in the session; the rope must come
    // through the migration unchanged, still its own and no longer waiting
    // for anybody to acknowledge it.
    const ropedAt = [stood[0] + 4.5, stood[2]];
    const roped = await host.call('fruit.spawn', 'watermelon',
      ropedAt[0], (await host.terrainHeight(ropedAt[0], ropedAt[1])) + 1.2, ropedAt[1]);
    await client.call('tool.give', 'ropegun');
    await client.call('tool.select', 'ropegun');
    // Let it stop rolling before aiming at it. A melon dropped onto flat-shaded
    // terrain picks up a slow roll off the facet seams, and in the real seconds
    // between reading its position and pulling the trigger it can leave the aim
    // cone — at which point the gun ropes the ground behind it and every check
    // below is about a rope that is not there.
    await until(async () => ((await host.call('fruit.info', roped))?.speed ?? 9) < 0.08, 6000, 250);
    for (let shot = 0; shot < 3; shot++) {
      const rpos = (await host.call('fruit.info', roped)).pos;
      await faceTo(client, rpos[0], rpos[1], rpos[2]);
      await client.call('tool.fire');
      await sleep(SETTLE);
      if ((await ropesOn(client, roped)).some((r) => !r.mirror)) break;
      await client.call('rope.clear');
      await sleep(SETTLE);
    }

    // The second apple, off the same tree, without moving.
    const appleB = await host.call('fruit.nearest', stood[0], stood[1], stood[2], 'apple', 'attached');
    await client.call('pickup', appleB.id);
    await sleep(ROUND_TRIP);
    const carriedByClient = appleB.id;

    // H — a melon hanging on a rope the HOST made, from a point above it, at
    // exactly the rest length so it hangs from the first frame. If the rope
    // does not survive the migration it lands; if the fruit's body does not,
    // it hangs there with no tension on the line and nothing holding it up.
    const hungAt = [stood[0] - 7, stood[2] + 2];
    const hungGround = await host.terrainHeight(hungAt[0], hungAt[1]);
    const hung = await host.call('fruit.spawn', 'watermelon',
      hungAt[0], hungGround + 9, hungAt[1]);
    await host.call('rope.tieFruit', hung, hungAt[0], hungGround + 13.5, hungAt[1], 4.5);
    await sleep(SETTLE);

    // HC — a fruit in the HOST's own hands as it walks out. Nobody will be
    // left who can claim it, so it has to come back to the world.
    //
    // The host leaves the drop-off first, and has to: fruit that comes to rest
    // on the pad SELLS ITSELF, which is a feature, and a spill at the pad is
    // therefore a sale rather than an orphan. Measured the hard way.
    await stand(host, stood[0] + 13, stood[2] - 7);
    const hostPos = (await host.state()).player.pos;
    const carriedByHost = await host.call('fruit.spawn', 'apple', hostPos[0], hostPos[1] + 1.2, hostPos[2]);
    await sleep(SETTLE);
    await host.call('pickup', carriedByHost);
    await sleep(SETTLE);

    // L — a coconut, thrown. The single clearest test of "physics resumed",
    // because gravity is not a matter of opinion and a frozen replica keeps
    // its altitude forever.
    //
    // Thrown straight UP rather than dropped from a height, because the two
    // things that end this fruit's usefulness are both speed: a 0.2 m ball
    // arriving at 44 m/s moves 0.73 m per fixed step and tunnels through the
    // island, and once it is down it is a coconut lying in the grass. Up is
    // the only direction that buys airtime without buying arrival speed.
    const falling = await host.call('fruit.spawn', 'coconut',
      stood[0] + 3, groundY + 6, stood[2] + 3);
    await sleep(SETTLE);

    // ---- what the world looked like a moment before ---------------------
    // Everything that does not need the fruit to be moving is read FIRST. A
    // page call costs the better part of a third of a second with two clients
    // rendering, so six of them between the throw and the disconnect is two
    // seconds of flight spent on bookkeeping — enough, measured, for a
    // ballistic fruit to land before the check that says it should not have.
    const beforeHost = await host.call('net.census');
    const beforeClient = await client.call('net.census');
    const hungHostBefore = await host.call('fruit.info', hung);
    const ropesBefore = (await host.state()).ropes.list.length;

    // Now the clock starts.
    await host.call('fruit.impulse', falling, 3.4 * 2.2, 3.4 * 26, 3.4 * 1.2);
    await sleep(250);
    const fallHost = await host.call('fruit.info', falling);
    const fallClient = await client.call('fruit.info', falling);

    ok(soldValue > 0, `run ${run + 1}: the host banks a sale before it leaves`, `$${soldValue}`);
    ok(fallHost.hasBody && fallHost.speed > 1,
      `run ${run + 1}: the loose fruit is moving on the host`, `${fallHost.speed} m/s`);
    ok(fallClient !== null && fallClient.hasBody === false,
      `run ${run + 1}: and is a body-less replica on the client`,
      `hasBody ${fallClient?.hasBody}`);
    // The half of the packet that did not exist before this pass. Without it
    // the reconstruction below has nothing to rebuild the motion from.
    const netGap = fallClient ? Math.hypot(
      fallClient.netVel[0] - fallHost.vel[0], fallClient.netVel[2] - fallHost.vel[2]) : 99;
    ok(netGap < 1.2,
      `run ${run + 1}: the client is told how fast the host says it is going`,
      `client netVel ${fallClient?.netVel.join(', ')} vs host vel ${fallHost.vel.join(', ')}`);
    ok(beforeClient.carried.includes(carriedByClient),
      `run ${run + 1}: the client is carrying a fruit`);
    ok(beforeClient.basket.includes(basketed), `run ${run + 1}: and has one in its basket`);
    ok(beforeHost.carried.includes(carriedByHost),
      `run ${run + 1}: the departing host is carrying one too`);
    ok((await host.call('net.sold', toSell)) === true,
      `run ${run + 1}: the sold fruit is tombstoned on the host`);
    ok(ropesBefore >= 2, `run ${run + 1}: two shared ropes are out`, `${ropesBefore} ropes`);

    // ---- 6, 7: the host leaves and the client is promoted ---------------
    await host.call('net.disconnect');
    const promoteMs = await until(async () => (await client.state()).net.isHost, PROMOTE_BUDGET);
    ok(promoteMs >= 0,
      `run ${run + 1}: the client is promoted without waiting for the liveness timeout`,
      promoteMs >= 0 ? `${promoteMs} ms` : `still not host after ${PROMOTE_BUDGET} ms`);
    // Let the promoted host actually simulate for a moment.
    await sleep(900);

    const promo = await client.call('net.promotion');
    const after = await client.call('net.census');

    // ---- 8: the fruit exists, has a body, and is falling -----------------
    ok(promo && promo.rebuilt > 0,
      `run ${run + 1}: the promotion rebuilt bodies for the loose fruit`,
      JSON.stringify(promo));
    ok(after.frozen.length === 0,
      `run ${run + 1}: no loose fruit on the new host is a body-less picture`,
      `frozen: ${after.frozen.join(', ')}`);

    const fallNow = await client.call('fruit.info', falling);
    const fallBody = await client.call('fruit.body', falling);
    ok(fallNow !== null, `run ${run + 1}: the loose fruit still exists after the migration`);
    ok(fallBody?.hasBody === true && fallBody.bodyType === 0,
      `run ${run + 1}: with a real dynamic body on the machine that took over`,
      JSON.stringify(fallBody));
    ok(fallBody && Math.abs(fallBody.mass - fallHost.mass) < 0.05,
      `run ${run + 1}: rebuilt at the mass the old host had for it`,
      `${fallBody?.mass} kg vs ${fallHost.mass} kg`);
    // Horizontal velocity is the honest continuity test: gravity changes the
    // vertical component during the second the migration takes, drag barely
    // touches the other two.
    const hBefore = Math.hypot(fallHost.vel[0], fallHost.vel[2]);
    const hAfter = Math.hypot(fallNow?.vel[0] ?? 0, fallNow?.vel[2] ?? 0);
    ok(hAfter > hBefore * 0.4,
      `run ${run + 1}: and still travelling, not restarted from rest`,
      `${hBefore.toFixed(2)} m/s before, ${hAfter.toFixed(2)} m/s after`);
    const posSample = fallNow?.pos ?? [0, 0, 0];
    await sleep(700);
    const fallLater = await client.call('fruit.info', falling);
    ok(fallLater === null || fallLater.pos[1] < posSample[1] - 0.4
      || fallLater.travelled > (fallNow?.travelled ?? 0) + 0.4,
      `run ${run + 1}: physics resumes — it keeps moving under the new host`,
      `y ${posSample[1]} -> ${fallLater?.pos[1]}`);

    // ---- 9: the ropes still resolve --------------------------------------
    const hungNow = await client.call('fruit.info', hung);
    const hungRopes = await ropesOn(client, hung);
    ok(hungRopes.length === 1,
      `run ${run + 1}: the departed host's world rope survives, exactly once`,
      `${hungRopes.length} ropes on the hanging fruit`);
    ok(hungNow && hungNow.pos[1] > hungGround + 5,
      `run ${run + 1}: and is still holding the fruit off the ground`,
      `y ${hungNow?.pos[1]} vs ground ${hungGround.toFixed(1)}`);
    ok(hungRopes[0] && hungRopes[0].tension > 1,
      `run ${run + 1}: tension resumes on the reconstructed body`,
      `tension ${hungRopes[0]?.tension} N, dist ${hungRopes[0]?.dist} / len ${hungRopes[0]?.len}`);
    ok(hungRopes[0] && !hungRopes[0].mirror,
      `run ${run + 1}: no rope on the new host is still a cosmetic mirror`);
    const ropedRopes = await ropesOn(client, roped);
    ok(ropedRopes.length === 1 && ropedRopes[0].owner === clientId,
      `run ${run + 1}: the promoted peer's own rope-gun line comes through unchanged`,
      JSON.stringify(ropedRopes));
    ok((await client.state()).ropes.list.every((r) => r.owner !== hostId),
      `run ${run + 1}: and nothing still claims to belong to the peer that left`);

    // ---- carried, basket, spilled, sold ---------------------------------
    ok(bucketsOf(after, carriedByClient).join() === 'carried',
      `run ${run + 1}: what the survivor was carrying stays in its hands`,
      bucketsOf(after, carriedByClient).join() || 'nowhere');
    ok((await client.call('net.ownerOf', carriedByClient)) === clientId,
      `run ${run + 1}: and the new ledger still says so`,
      String(await client.call('net.ownerOf', carriedByClient)));
    ok(bucketsOf(after, basketed).join() === 'basket',
      `run ${run + 1}: its basket survives the migration`,
      bucketsOf(after, basketed).join() || 'nowhere');
    ok((await client.call('net.ownerOf', basketed)) === clientId,
      `run ${run + 1}: with the basketed fruit still booked to it`);
    ok(bucketsOf(after, carriedByHost).join() === 'loose',
      `run ${run + 1}: what the departing host held is spilled back into the world`,
      bucketsOf(after, carriedByHost).join() || 'nowhere');
    ok((await client.call('net.ownerOf', carriedByHost)) === null,
      `run ${run + 1}: and belongs to nobody`,
      String(await client.call('net.ownerOf', carriedByHost)));
    const spilled = await client.call('fruit.info', carriedByHost);
    ok(spilled && spilled.hasBody
      && Math.hypot(spilled.pos[0] - hostPos[0], spilled.pos[2] - hostPos[2]) < 8,
      `run ${run + 1}: it lands where they were standing, simulating`,
      `at ${spilled?.pos.join(', ')}, they were at ${hostPos.map((v) => v.toFixed(1)).join(', ')}`);
    ok(bucketsOf(after, toSell).length === 0,
      `run ${run + 1}: the sold fruit does not come back`,
      bucketsOf(after, toSell).join());
    ok((await client.call('net.sold', toSell)) === true,
      `run ${run + 1}: its tombstone is inherited by the new host`);

    // ---- conservation ----------------------------------------------------
    const ids = allIds(after);
    ok(dup(ids).length === 0,
      `run ${run + 1}: no fruit id is in two places at once`, dup(ids).join(', '));
    const wasDisturbed = [...beforeHost.loose, ...beforeHost.carried, ...beforeHost.basket]
      .filter((id) => id !== toSell).sort((x, y) => x - y);
    const nowDisturbed = [...after.loose, ...after.carried, ...after.basket].sort((x, y) => x - y);
    ok(JSON.stringify(wasDisturbed) === JSON.stringify(nowDisturbed),
      `run ${run + 1}: every fruit off its branch before the migration is off its branch after, and no others`,
      `${wasDisturbed.length} before -> ${nowDisturbed.length} after`);

    // ---- 10, 11: pick it up, sell it, and be paid once --------------------
    // Every rope assertion is made, so the lines come down before anybody
    // walks anywhere: a player still tethered to a rock is YANKED by the
    // teleport below, and a yanked player is a ragdoll that drops what it is
    // holding — which would be this test failing at something it is not about.
    await client.call('rope.clear');
    await sleep(SETTLE);
    const loot = await client.call('fruit.info', carriedByHost);
    if (!loot) ok(false, `run ${run + 1}: the spilled fruit is there to pick up`, 'it is gone');
    await stand(client, loot?.pos[0] ?? 0, loot?.pos[2] ?? 0);
    const took = await client.call('pickup', carriedByHost);
    await sleep(ROUND_TRIP);
    ok(took !== false && (await client.state()).interaction.carriedId === carriedByHost,
      `run ${run + 1}: the promoted host can pick the spilled fruit up`, await why(client));
    await client.call('drop');
    await sleep(ROUND_TRIP);
    ok((await client.call('fruit.info', carriedByHost))?.state === 'free',
      `run ${run + 1}: and drop it again`);
    await client.call('pickup', carriedByHost);
    await sleep(ROUND_TRIP);
    await place(client, pad[0], pad[1] + 1.2, pad[2]);
    await sleep(SETTLE);
    const moneyBefore = (await client.state()).economy;
    await client.call('sell');
    await sleep(SETTLE);
    const moneyAfter = (await client.state()).economy;
    const paid = moneyAfter.money - moneyBefore.money;
    ok(paid > 0, `run ${run + 1}: selling it pays`, `$${paid}`);
    ok(moneyAfter.lifetime - moneyBefore.lifetime === paid,
      `run ${run + 1}: exactly once`,
      `+$${moneyAfter.lifetime - moneyBefore.lifetime} lifetime vs +$${paid} balance`);
    await client.call('sell');
    await sleep(SETTLE);
    ok((await client.state()).economy.money === moneyAfter.money,
      `run ${run + 1}: and a second attempt pays nothing`,
      `$${(await client.state()).economy.money} vs $${moneyAfter.money}`);

    // ---- 12: the peer that left comes back and sees the same world -------
    await host.call('net.connect', room, 0);
    await sleep(3400);
    const rejoined = await sides();
    ok(rejoined.agree, `run ${run + 1}: the returning peer and the incumbent agree who hosts`);
    ok(rejoined.hostId === clientId,
      `run ${run + 1}: and the incumbent keeps the session it was promoted into`,
      `host is ${rejoined.hostId}, promoted peer is ${clientId}`);
    const lateCensus = await host.call('net.census');
    const liveCensus = await client.call('net.census');
    const lateDisturbed = [...lateCensus.loose, ...lateCensus.carried, ...lateCensus.basket]
      .sort((x, y) => x - y);
    const liveDisturbed = [...liveCensus.loose, ...liveCensus.carried, ...liveCensus.basket]
      .sort((x, y) => x - y);
    const onlyLate = lateDisturbed.filter((id) => !liveDisturbed.includes(id));
    const onlyLive = liveDisturbed.filter((id) => !lateDisturbed.includes(id));
    ok(JSON.stringify(lateDisturbed) === JSON.stringify(liveDisturbed),
      `run ${run + 1}: a late joiner sees exactly the fruit the host has`,
      `late ${lateDisturbed.length}, host ${liveDisturbed.length}`
      + `; only the joiner has ${onlyLate.join(', ') || 'none'}`
      + `; only the host has ${onlyLive.join(', ') || 'none'}`);
    ok(dup(allIds(lateCensus)).length === 0,
      `run ${run + 1}: and none of it twice`, dup(allIds(lateCensus)).join(', '));
    const lateMoney = (await host.state()).economy.money;
    const liveMoney = (await client.state()).economy.money;
    ok(lateMoney === liveMoney,
      `run ${run + 1}: and the same balance the host has`, `$${lateMoney} vs $${liveMoney}`);
    ok(liveMoney >= moneyAfter.money,
      `run ${run + 1}: with no money destroyed by the rejoin`,
      `$${liveMoney} vs $${moneyAfter.money} at the sale`);

    // A returning peer naming a fruit the PREVIOUS host sold: the tombstone
    // crossed the migration, so this pays nothing.
    const beforeTheft = (await client.state()).economy.money;
    await host.page.evaluate((id) => {
      window.__GAME.get('net').requestSell([id]);
    }, toSell);
    await sleep(SETTLE);
    ok((await client.state()).economy.money === beforeTheft,
      `run ${run + 1}: a sell intent for a fruit the OLD host sold is refused`,
      `$${(await client.state()).economy.money} vs $${beforeTheft}`);
  }

  for (let i = 0; i < RUNS; i++) await migrationRun(i);

  // =====================================================================
  // MIGRATION DURING THE LEGENDARY
  // =====================================================================
  console.log('\n--- the King Melon, mid-encounter');
  {
    const { host, client, clientId } = await sides();
    await host.call('rope.clear');
    await client.call('rope.clear');
    await host.call('fruit.despawnAllFree');
    await host.call('legendary.reset');
    await sleep(SETTLE);
    await host.call('economy.set', 0);
    await host.call('progress.reset');
    await client.call('progress.reset');
    await sleep(SETTLE);

    const leg = await host.call('legendary.info');
    // The CLIENT does the work: it is the one that will still be here.
    await client.call('tool.give', 'ropegun');
    await sleep(SETTLE);
    ok((await client.state()).legendary.phase === 'tether',
      'legendary: the encounter opens for the client', (await client.state()).legendary.phase);

    await stand(client, leg.home[0] + 18, leg.home[2] + 16);
    await client.call('legendary.tether');
    await sleep(ROUND_TRIP);
    await stand(client, leg.home[0] - 16, leg.home[2] + 14);
    await client.call('legendary.tether');
    await sleep(SETTLE);
    ok((await host.state()).legendary.tethers === 2, 'legendary: the host builds both tethers',
      `${(await host.state()).legendary.tethers}, ${await why(host)}`);

    await client.call('legendary.cut', 4);
    await sleep(SETTLE);
    await client.call('legendary.cut', 4);
    await sleep(SETTLE);
    const cutOnHost = (await host.state()).legendary;
    ok(cutOnHost.vines === 0, 'legendary: all four vines cut through the client',
      `${cutOnHost.vines} left, ${await why(host)}`);
    await sleep(1200);

    const beforeLeg = (await host.state()).legendary;
    const clientLegBefore = (await client.state()).legendary;
    ok(['drop', 'recover'].includes(beforeLeg.phase), 'legendary: the host is running the drop',
      beforeLeg.phase);
    ok(clientLegBefore.fixed === true, 'legendary: and the client holds the melon fixed');
    // Read on the CLIENT, because that is the machine that will pay: lifetime
    // earnings are a per-peer statistic and are not replicated, only the
    // shared balance is.
    const lifetimeBefore = (await client.state()).economy.lifetime;

    // The host walks out mid-drop.
    await host.call('net.disconnect');
    const ms = await until(async () => (await client.state()).net.isHost, PROMOTE_BUDGET);
    ok(ms >= 0, 'legendary: the client is promoted mid-encounter', `${ms} ms`);
    await sleep(1200);

    const legNow = (await client.state()).legendary;
    ok(legNow.fixed === false,
      'legendary: the promoted host stops holding the melon fixed and simulates it',
      `fixed ${legNow.fixed}, phase ${legNow.phase}`);
    ok(legNow.cut === beforeLeg.cut && legNow.vines === beforeLeg.vines,
      'legendary: the cuts survive the migration',
      `${legNow.cut} cut / ${legNow.vines} left vs ${beforeLeg.cut} / ${beforeLeg.vines}`);
    ok(['drop', 'recover', 'complete'].includes(legNow.phase),
      'legendary: the phase survives it', `${beforeLeg.phase} -> ${legNow.phase}`);
    const moved = Math.hypot(...legNow.pos.map((v, i) => v - beforeLeg.pos[i]));
    ok(moved < 12, 'legendary: and the melon is where the old host had it',
      `${moved.toFixed(1)} m from ${beforeLeg.pos.join(', ')}`);
    ok(legNow.tethers >= 1 || legNow.phase !== 'drop',
      'legendary: the tethers come through the migration',
      `${legNow.tethers} tethers in phase ${legNow.phase}`);
    ok(legNow.paid === beforeLeg.paid, 'legendary: and nothing has been paid twice',
      `$${legNow.paid} vs $${beforeLeg.paid}`);

    // Finish it on the machine that took over.
    for (let i = 0; i < 14; i++) {
      const s = (await client.state()).legendary;
      if (s.phase === 'recover' || s.phase === 'complete' || s.phase === 'failed') break;
      await sleep(700);
    }
    if ((await client.state()).legendary.phase === 'recover') {
      await client.call('legendary.place', leg.pad[0], leg.pad[1] + 5.8, leg.pad[2]);
    }
    await sleep(4000);
    const done = (await client.state()).legendary;
    ok(done.phase === 'complete', 'legendary: the promoted host completes it', `phase ${done.phase}`);
    if (done.phase === 'complete') {
      const econ = (await client.state()).economy;
      ok(done.paid > 5000, 'legendary: and it pays a legendary amount', `$${done.paid}`);
      ok(econ.lifetime - lifetimeBefore === done.paid,
        'legendary: credited exactly once, on the machine that took over',
        `+$${econ.lifetime - lifetimeBefore} vs $${done.paid}`);
      const islands = (await client.call('progress.info')).islands;
      ok(islands.includes('galegrove'), 'legendary: Gale Grove unlocks on the new host',
        islands.join(', '));

      // And the peer that walked out comes back to a finished encounter.
      await host.call('net.connect', room, 0);
      await sleep(3400);
      const back = await host.state();
      ok(back.net.isHost === false, 'legendary: the returning peer joins as a client');
      ok(back.net.hostId === clientId, 'legendary: under the peer that was promoted');
      ok(back.legendary.phase === 'complete', 'legendary: and sees it completed',
        back.legendary.phase);
      ok(back.economy.money === econ.money,
        'legendary: with one payout in the shared pot', `$${back.economy.money} vs $${econ.money}`);
      ok(back.economy.tier === econ.tier, 'legendary: and the tier it earned',
        `${back.economy.tier} vs ${econ.tier}`);
    }
  }

  const errs = [...a.consoleErrors, ...b.consoleErrors]
    .filter((e) => !/DevTools|deprecat|ReadPixels|GPU stall/i.test(e));
  ok(errs.length === 0, 'no console errors across either client', errs.slice(0, 3).join(' | '));
} finally {
  await b?.closePage().catch(() => {});
  await a?.close().catch(() => {});
  if (server.proc) server.proc.kill();
}

console.log('');
let failed = 0;
for (const c of checks) {
  if (!c.ok) failed++;
  console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.detail ? `  (${c.detail})` : ''}`);
}
console.log(`\n${checks.length - failed}/${checks.length} host-migration checks passed`
  + ` (${RUNS} loose-fruit run${RUNS > 1 ? 's' : ''} + the legendary)`);
process.exit(failed ? 1 : 0);
