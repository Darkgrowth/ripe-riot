// Two real browser pages, two real game instances, one real message bus.
//
// BroadcastChannel is the same-machine transport the game actually ships for
// local co-op, so this is an end-to-end test rather than a mock: host election,
// peer discovery, player replication, fruit replication, the shared economy and
// every authority decision go over the wire they will use in a living room.
//
// The rule this file exists to prove: IF TWO PLAYERS DISAGREE ABOUT A FRUIT,
// THE HOST DECIDES WHAT IS TRUE.
//
// Nothing here calls an authority method directly. Every action goes through
// the same entry point the game uses — `pickup` is `InteractionSystem.pickUp`,
// which is what the E key calls; `interact` is the E key; `fruit.detach` is
// what the shaker and the hand call. On a client all four of those are gated
// into intents by the code under test, and if that gating ever comes off,
// these checks fail rather than quietly passing on local mutation.

import { startServer, openGame, openSecondClient, sleep } from './driver.mjs';

const server = await startServer();
const checks = [];
const ok = (cond, label, detail = '') => {
  checks.push({ ok: !!cond, label, detail });
  return !!cond;
};

/** Long enough for an intent to reach the host and its answer to come back. */
const ROUND_TRIP = 900;
/** Long enough for a 15 Hz snapshot and a 20 Hz player packet to land. */
const SETTLE = 1400;

let a, b;
try {
  console.log('opening two clients...');
  // Two clients render in the SAME browser, so this is the slowest thing the
  // harness runs and the one most exposed to render cost: a 900 ms wait for a
  // teleport to replicate is 900 ms of wall clock, and the avatar interpolates
  // in simulation time. At 640x360 x2 the host's avatar was still 6 m short of
  // the client's new position when the check read it. Same calibration as
  // run-tests.mjs, and the same reason.
  a = await openGame({ width: 400, height: 225, headless: true, quiet: true });
  // Same browser context as A, or BroadcastChannel cannot reach between them.
  b = await openSecondClient(a);

  const room = 'test' + Math.floor(Math.random() * 1e6);
  const idA = await a.call('net.connect', room, 0);
  const idB = await b.call('net.connect', room, 0);
  console.log(`peer A ${idA}  peer B ${idB}`);

  // Discovery runs on a ~900 ms heartbeat.
  await sleep(2600);

  const netA = (await a.state()).net;
  const netB = (await b.state()).net;
  console.log('A:', JSON.stringify(netA));
  console.log('B:', JSON.stringify(netB));

  ok(netA.peers >= 1 && netB.peers >= 1, 'both peers discover each other',
    `A saw ${netA.peers}, B saw ${netB.peers}`);
  ok(netA.isHost !== netB.isHost, 'exactly one peer is the host',
    `A=${netA.isHost} B=${netB.isHost}`);
  ok(netA.hostId === netB.hostId, 'both agree on who the host is',
    `${netA.hostId} vs ${netB.hostId}`);

  const host = netA.isHost ? a : b;
  const client = netA.isHost ? b : a;
  const hostId = netA.isHost ? idA : idB;
  const clientId = netA.isHost ? idB : idA;
  console.log(`host is ${netA.isHost ? 'A' : 'B'}`);

  // --- player replication
  await client.tp(-24, 12, 22);
  // Remote avatars DAMP toward the position the snapshot reports rather than
  // snapping to it, so this settle time is counted in frames, not seconds, and
  // how many frames fit in a second here depends on what the harness happens to
  // be rendering. At 900 ms the baseline avatar was already 1.3 m short of the
  // teleport it was chasing — inside the 4 m tolerance by luck rather than by
  // margin — and adding scenery to the island took the same wait to 6.5 m and
  // failed the check with replication working perfectly. Give the damp time to
  // finish; the tolerance below is what is actually being asserted.
  await sleep(2600);
  const remotesOnHost = await host.call('net.remotes');
  ok(remotesOnHost.length >= 1, 'the host renders a remote avatar for the client');
  if (remotesOnHost.length) {
    const r = remotesOnHost[0];
    const near = Math.hypot(r.pos[0] - (-24), r.pos[2] - 22) < 4;
    ok(near, 'the remote avatar is at the client\'s reported position',
      `avatar at ${r.pos.join(', ')}`);
  }

  // --- fruit replication: the host drops one, the client must see it
  await host.call('fruit.despawnAllFree');
  await client.call('fruit.despawnAllFree');
  await sleep(400);
  const fruitId = await host.call('fruit.spawn', 'watermelon', -24, 14, 22);
  await sleep(SETTLE);
  const onClient = await client.call('fruit.info', fruitId);
  ok(onClient !== null, 'a fruit spawned on the host appears on the client');
  if (onClient) {
    console.log('client sees fruit at', onClient.pos.join(', '), 'state', onClient.state);
    ok(onClient.species === 'watermelon', 'with the right species', onClient.species);
    // The replica is rebuilt from species + variant + roll, so it is the same
    // fruit and not an average one. Mass is the number every carry rule, throw
    // curve and price depends on, so it is the one worth asserting.
    const onHost = await host.call('fruit.info', fruitId);
    ok(Math.abs(onClient.mass - onHost.mass) < 0.01,
      'and the replica weighs exactly what the host\'s copy weighs',
      `client ${onClient.mass} kg vs host ${onHost.mass} kg`);
    ok(Math.abs(onClient.size - onHost.size) < 0.001, 'and is the same size',
      `${onClient.size} vs ${onHost.size}`);
  }

  // --- shared economy
  await host.call('economy.set', 0);
  await sleep(500);
  await host.call('economy.add', 250);
  await sleep(SETTLE);
  const clientMoney = (await client.state()).economy.money;
  ok(clientMoney === 250, 'money is shared across the session', `client sees $${clientMoney}`);

  // --- intents: a client asks the host to shake a tree
  const tree = await client.call('plant.nearest', -24, 8, 22, 'appleTree', true);
  const freeBefore = (await host.state()).fruit.free;
  await client.call('net.peers');
  await client.page.evaluate((plantId) => {
    const net = window.__GAME.get('net');
    net.requestIntent({ kind: 'shake', plantId });
  }, tree.id);
  await sleep(SETTLE);
  const freeAfter = (await host.state()).fruit.free;
  ok(freeAfter > freeBefore, 'a client intent makes the host shake the tree',
    `${freeBefore} -> ${freeAfter} loose fruit`);

  // =====================================================================
  // AUTHORITY
  // =====================================================================
  await host.call('fruit.despawnAllFree');
  await client.call('fruit.despawnAllFree');
  await host.call('basket.clear');
  await client.call('basket.clear');
  await host.call('economy.set', 0);
  await sleep(SETTLE);

  /**
   * Every fruit that is no longer on its branch, by id.
   *
   * The right population to count when asking "did rejoining duplicate
   * anything". Counting only LOOSE fruit answers a different question and gets
   * a different answer, because whether a given apple is loose or in somebody's
   * hands legitimately depends on who ends up hosting.
   */
  async function disturbedIds(page) {
    const out = [];
    for (const st of ['free', 'carried', 'stowed']) {
      for (const f of await page.call('fruit.list', st)) out.push(f.id);
    }
    return out.sort((x, y) => x - y);
  }

  /**
   * Put a peer's player somewhere, upright and settled.
   *
   * Recovery runs BEFORE the teleport, for the reason the scenario runner
   * gives: it stands the player up wherever the torso came to rest, which
   * would otherwise undo the teleport. And the settle matters as much as the
   * pose — the host validates reach against the position a client REPORTS at
   * 20 Hz, so a check that reads the world before the packet has left is
   * testing the harness, not the game.
   */
  async function place(page, x, y, z) {
    await page.call('ragdoll.recover').catch(() => {});
    await page.tp(x, y, z);
    await sleep(ROUND_TRIP);
  }

  /** The same, on the ground: dropping a player in from a height ragdolls
   *  them, and a ragdolled player drops whatever they just picked up. */
  async function stand(page, x, z, lift = 1.2) {
    await place(page, x, (await page.terrainHeight(x, z)) + lift, z);
  }

  /** Why the host last said no. Empty when it has not refused anything. */
  const whyRefused = async () => `last refusal "${(await host.state()).net.lastDeny}"`;

  /** An attached apple both peers already agree about, by id. */
  async function findAttachedApple(near = [-24, 8, 22]) {
    const n = await host.call('fruit.nearest', ...near, 'apple', 'attached');
    if (!n) throw new Error('no attached apple near the orchard');
    return n;
  }

  // --- 1 & 2: a client detaches, and the host is the one who decides
  const apple = await findAttachedApple();
  const beforeOnClient = await client.call('fruit.info', apple.id);
  ok(beforeOnClient !== null && beforeOnClient.state === 'attached',
    'both peers know the same attached fruit by the same id',
    `id ${apple.id} is ${beforeOnClient?.state} on the client`);

  // `fruit.detach` calls FruitSystem.detach — the same method the shaker, the
  // hand and every tool call. On a client that method must NOT break the stem.
  await client.call('fruit.detach', apple.id);
  await sleep(120);
  const rightAfter = await host.call('fruit.info', apple.id);
  await sleep(ROUND_TRIP);
  const detachedHost = await host.call('fruit.info', apple.id);
  const detachedClient = await client.call('fruit.info', apple.id);
  ok(detachedHost.state === 'free', 'a client detach request frees the fruit on the host',
    `host says ${detachedHost.state} (was ${rightAfter.state} 120 ms in)`
    + `, last refusal "${(await host.state()).net.lastDeny}"`);
  ok(detachedClient.state === 'free', 'and the client sees the host\'s version of it',
    `client says ${detachedClient.state}`);

  // --- reach: the host refuses a claim from the other side of the island.
  // The dock, ~89 m from the orchard. The client predicts the pick and reports
  // a carried fruit from there; the host moves nothing and refuses.
  await stand(client, 55, 64);
  await client.call('pickup', apple.id);
  await sleep(ROUND_TRIP);
  ok((await host.call('net.ownerOf', apple.id)) === null,
    'the host refuses a claim made from 90 m away', await whyRefused());
  ok((await client.state()).interaction.carriedId !== apple.id,
    'and the client\'s prediction is rolled back');

  // --- 3: the client walks up and picks it up for real
  // Re-read the position: a detached apple rolls, and the host measures reach
  // against where the fruit is NOW.
  const pos = (await host.call('fruit.info', apple.id)).pos;
  await stand(client, pos[0], pos[2]);
  ok((await client.state()).player.state === 'active',
    'the client is on its feet before it reaches for anything',
    (await client.state()).player.state);
  await client.call('pickup', apple.id);
  await sleep(ROUND_TRIP);
  const ownerAfterPick = await host.call('net.ownerOf', apple.id);
  ok(ownerAfterPick === clientId, 'the host books the fruit out to the peer that asked',
    `owner ${ownerAfterPick} (client is ${clientId}), ${await whyRefused()}`);
  ok((await client.state()).interaction.carriedId === apple.id,
    'and the client has it in hand');
  ok((await host.call('fruit.info', apple.id)).state === 'carried',
    'the host\'s own copy is carried, not lying on the grass');

  // --- 4: the other player cannot also have it
  await stand(host, pos[0] + 1, pos[2]);
  await host.call('pickup', apple.id);
  await sleep(ROUND_TRIP);
  ok((await host.call('net.ownerOf', apple.id)) === clientId,
    'a second player cannot take a fruit that is already claimed');
  ok((await host.state()).interaction.carriedId !== apple.id,
    'and the host does not end up holding it either',
    `host carries ${(await host.state()).interaction.carriedId}`);

  // --- 4b: the same contention the other way round. Here the client's own
  // mirror of the ledger already says the fruit is spoken for, so the refusal
  // happens before a single byte goes out — which is the cheap half of
  // contention. The expensive half, where a prediction has to be undone, is 4c.
  const apple2 = await findAttachedApple([pos[0], pos[1], pos[2]]);
  const a2 = await host.call('fruit.info', apple2.id);
  await stand(host, a2.pos[0], a2.pos[2]);
  await stand(client, a2.pos[0] + 1, a2.pos[2]);
  await host.call('pickup', apple2.id);
  await sleep(ROUND_TRIP);
  await client.call('pickup', apple2.id);
  await sleep(ROUND_TRIP);
  ok((await host.call('net.ownerOf', apple2.id)) === hostId,
    'the host keeps a fruit it claimed first');
  ok((await client.state()).interaction.carriedId !== apple2.id,
    'and the client that predicted otherwise gives it back',
    `client carries ${(await client.state()).interaction.carriedId}`);
  await host.call('drop');
  await sleep(ROUND_TRIP);

  // --- 4c: a genuine race. Both peers reach for the same fruit in the same
  // tick, before either has seen a snapshot mentioning the other's claim.
  const apple3 = await findAttachedApple([pos[0], pos[1], pos[2]]);
  const a3 = await host.call('fruit.info', apple3.id);
  await stand(host, a3.pos[0], a3.pos[2]);
  await stand(client, a3.pos[0] + 1, a3.pos[2]);
  await Promise.all([
    host.call('pickup', apple3.id),
    client.call('pickup', apple3.id),
  ]);
  await sleep(SETTLE);
  const raceOwner = await host.call('net.ownerOf', apple3.id);
  const hostHas = (await host.state()).interaction.carriedId === apple3.id;
  const clientHas = (await client.state()).interaction.carriedId === apple3.id;
  ok(raceOwner === hostId || raceOwner === clientId,
    'a simultaneous grab leaves the fruit owned by somebody', `owner ${raceOwner}`);
  ok(hostHas !== clientHas, 'and by exactly one of them',
    `host ${hostHas}, client ${clientHas}`);
  ok((raceOwner === hostId) === hostHas,
    'the peer holding it is the peer the host says holds it');
  // Hand it back so it cannot confuse the sale.
  await (raceOwner === hostId ? host : client).call('drop');
  await sleep(ROUND_TRIP);

  // --- a shared physics transition: shoving something you cannot lift.
  // The client has no body for this melon at all — the host is simulating it —
  // so if the impulse lands, it landed because the host applied it.
  const bigId = await host.call('fruit.spawn', 'watermelon', -22, 10, 22, 'huge');
  await sleep(SETTLE);
  // Two metres away, not on top of it: a kinematic capsule spawned inside a
  // 374 kg ball is resolved by the solver launching the ball, which would make
  // the control measurement below meaningless.
  await stand(client, -24, 22);
  await sleep(SETTLE);
  const restA = (await host.call('fruit.info', bigId)).pos;
  await sleep(SETTLE);
  const restB = (await host.call('fruit.info', bigId)).pos;
  const drift = Math.hypot(restB[0] - restA[0], restB[2] - restA[2]);
  await client.call('shove', bigId);
  await sleep(SETTLE * 2);
  const shoved = (await host.call('fruit.info', bigId)).pos;
  const moved = Math.hypot(shoved[0] - restB[0], shoved[2] - restB[2]);
  ok(moved > Math.max(0.25, drift * 3),
    'a client can shove a melon it cannot lift, and the host is what moves it',
    `moved ${moved.toFixed(2)} m against ${drift.toFixed(2)} m of drift`);
  const shovedOnClient = (await client.call('fruit.info', bigId)).pos;
  ok(Math.hypot(shovedOnClient[0] - shoved[0], shovedOnClient[2] - shoved[2]) < 1.5,
    'and both peers agree where it ended up',
    `client ${shovedOnClient.join(', ')} vs host ${shoved.join(', ')}`);
  await host.call('fruit.despawnAllFree');
  await sleep(SETTLE);

  // --- 5 to 8: the client sells what it is carrying, through the E key
  const world = await host.call('world.info');
  const [padX, padY, padZ] = world.sellPad;
  const value = (await host.call('fruit.info', apple.id)).value;
  await host.call('economy.set', 0);
  await sleep(SETTLE);
  const econBefore = (await host.state()).economy;

  // Stand on the pad. The host validates the zone from the position the client
  // REPORTS, so the packet has to get there before the sell does.
  await place(client, padX, padY + 1.2, padZ);
  await sleep(SETTLE);
  const sellPrompt = (await client.state()).interaction;
  ok(sellPrompt.nearSellPad, 'the client is standing on the drop-off pad');
  ok((sellPrompt.prompt ?? '').includes('Sell'), 'and is offered the sale',
    sellPrompt.prompt ?? 'no prompt');

  await client.call('interact');
  await sleep(SETTLE);
  const econAfter = (await host.state()).economy;
  const moneyHost = econAfter.money;
  const moneyClient = (await client.state()).economy.money;
  ok(moneyHost > 0, 'selling through the client pays out', `$${moneyHost}`);
  // The base value is the floor and the stunt multiplier is the only thing
  // above it, so an apple that fell out of a tree is worth its price and
  // possibly a bonus — never nothing, and never a second apple's worth.
  ok(moneyHost >= value && moneyHost <= value * 4,
    'and pays the host\'s own valuation of that one fruit',
    `$${moneyHost} for a $${value} apple`);
  ok(econAfter.sold - econBefore.sold === 1, 'exactly one fruit is banked',
    `${econAfter.sold - econBefore.sold} banked`);
  ok(econAfter.lifetime - econBefore.lifetime === moneyHost,
    'and the money is credited exactly once',
    `lifetime +$${econAfter.lifetime - econBefore.lifetime} vs balance $${moneyHost}`);
  ok(moneyClient === moneyHost, 'both peers agree on the money',
    `client $${moneyClient} vs host $${moneyHost}`);
  ok((await host.call('fruit.info', apple.id)) === null,
    'the fruit is gone on the host');
  ok((await client.call('fruit.info', apple.id)) === null,
    'and gone on the client');
  ok((await host.call('net.sold', apple.id)) === true,
    'the host tombstones it so no snapshot can bring it back');
  ok((await client.state()).interaction.carriedId === -1,
    'the client\'s hands are empty');

  // --- 6: exactly once. Asking again for the same fruit must pay nothing.
  await client.page.evaluate((id) => {
    window.__GAME.get('net').requestSell([id]);
  }, apple.id);
  await sleep(SETTLE);
  const econRepeat = (await host.state()).economy;
  ok(econRepeat.money === moneyHost,
    'a repeated sell request for the same fruit pays nothing the second time',
    `$${econRepeat.money} vs $${moneyHost}`);
  ok(econRepeat.lifetime === econAfter.lifetime && econRepeat.sold === econAfter.sold,
    'and does not count as a second sale either',
    `lifetime $${econRepeat.lifetime}, sold ${econRepeat.sold}`);

  // --- selling what you do not own
  const apple4 = await findAttachedApple([pos[0], pos[1], pos[2]]);
  const a4 = await host.call('fruit.info', apple4.id);
  await stand(host, a4.pos[0], a4.pos[2]);
  await host.call('pickup', apple4.id);
  await sleep(ROUND_TRIP);
  const moneyBeforeTheft = (await host.state()).economy.money;
  await client.page.evaluate((id) => {
    window.__GAME.get('net').requestSell([id]);
  }, apple4.id);
  await sleep(SETTLE);
  ok((await host.state()).economy.money === moneyBeforeTheft,
    'a client cannot sell a fruit somebody else is carrying',
    `$${(await host.state()).economy.money} vs $${moneyBeforeTheft}`);
  ok((await host.state()).interaction.carriedId === apple4.id,
    'and the owner still has it in their hands');
  await host.call('drop');
  await sleep(ROUND_TRIP);

  // --- 9: leaving while carrying
  const apple5 = await findAttachedApple([pos[0], pos[1], pos[2]]);
  const a5 = await host.call('fruit.info', apple5.id);
  await stand(client, a5.pos[0], a5.pos[2]);
  await client.call('pickup', apple5.id);
  await sleep(ROUND_TRIP);
  ok((await host.call('net.ownerOf', apple5.id)) === clientId,
    'the client is carrying a fruit when it disconnects');
  const moneyBeforeLeave = (await host.state()).economy.money;
  const carriedIntoTheDark = apple5.id;

  await client.call('net.disconnect');
  await sleep(2600);
  const afterLeave = (await host.state()).net;
  ok(afterLeave.remotes === 0, 'the host drops the avatar when a peer leaves',
    `${afterLeave.remotes} remotes remain`);
  const orphan = await host.call('fruit.info', apple5.id);
  ok(orphan !== null && orphan.state === 'free',
    'the fruit they were carrying comes back to the world rather than vanishing',
    `state ${orphan?.state}`);
  ok((await host.call('net.ownerOf', apple5.id)) === null,
    'and nobody owns it any more');
  const spillNear = orphan
    && Math.hypot(orphan.pos[0] - a5.pos[0], orphan.pos[2] - a5.pos[2]) < 6;
  ok(spillNear, 'it lands where they were standing',
    `dropped at ${orphan?.pos.join(', ')}, they were at ${a5.pos.join(', ')}`);
  ok((await host.call('net.holdings')).every((h) => h.peer !== clientId),
    'the host forgets the peer entirely');
  // The world gained exactly the fruit they were carrying, and nothing else:
  // a spill is a carried fruit becoming a loose one, not a new apple.
  const freeAfterLeave = (await host.call('fruit.list', 'free')).map((f) => f.id).sort();
  ok(freeAfterLeave.includes(carriedIntoTheDark),
    'the spilled fruit is loose in the world and countable');
  const disturbedAfterLeave = await disturbedIds(host);

  // --- 10: rejoining duplicates neither fruit nor money
  //
  // A rejoining peer gets a NEW random id, and host selection is "lowest id
  // wins" — so about half of all rejoins hand the session to the peer that
  // just walked back in. That is the design working, not a fault, and it is
  // why the checks below are written to hold whichever way it lands: they
  // assert conservation and agreement, never who happens to be holding what.
  await client.call('net.connect', room, 0);
  await sleep(3200);
  const rejoinedIsHost = (await client.state()).net.isHost;
  const nowHost = rejoinedIsHost ? client : host;
  const nowClient = rejoinedIsHost ? host : client;
  console.log(`after the rejoin, the host is the ${rejoinedIsHost ? 'returning peer' : 'peer that stayed'}`);

  const moneyAfterRejoin = (await nowHost.state()).economy.money;
  ok(moneyAfterRejoin === moneyBeforeLeave,
    'rejoining creates no money', `$${moneyAfterRejoin} vs $${moneyBeforeLeave}`);
  ok((await nowClient.state()).economy.money === moneyAfterRejoin,
    'and both peers are told the same balance',
    `$${(await nowClient.state()).economy.money}`);

  const disturbedHost = await disturbedIds(nowHost);
  const disturbedClient = await disturbedIds(nowClient);
  ok(JSON.stringify(disturbedHost) === JSON.stringify(disturbedAfterLeave),
    'rejoining creates and loses no fruit',
    `${disturbedHost.length} off the branch vs ${disturbedAfterLeave.length} before the rejoin`);
  ok(JSON.stringify(disturbedHost) === JSON.stringify(disturbedClient),
    'and both peers hold exactly the same set of fruit, by id',
    `host ${disturbedHost.length}, client ${disturbedClient.length}`);
  ok(new Set(disturbedHost).size === disturbedHost.length,
    'with no id appearing twice');

  // Whoever ends up holding the fruit that went into the dark, the ledger and
  // the hands must be the same story on both machines.
  const ledgerOwner = await nowHost.call('net.ownerOf', carriedIntoTheDark);
  const hostHolds = (await nowHost.state()).interaction.carriedId === carriedIntoTheDark;
  const clientHolds = (await nowClient.state()).interaction.carriedId === carriedIntoTheDark;
  ok(!(hostHolds && clientHolds), 'the fruit it left with is in at most one pair of hands',
    `host ${hostHolds}, client ${clientHolds}`);
  ok((ledgerOwner === null) === !(hostHolds || clientHolds),
    'and the ledger agrees about whether anybody has it',
    `owner ${ledgerOwner}, held ${hostHolds || clientHolds}`);
  const stateOnHost = (await nowHost.call('fruit.info', carriedIntoTheDark)).state;
  const stateOnClient = (await nowClient.call('fruit.info', carriedIntoTheDark)).state;
  ok(stateOnHost === stateOnClient, 'and both peers agree what state it is in',
    `${stateOnHost} vs ${stateOnClient}`);

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
console.log(`\n${checks.length - failed}/${checks.length} multiplayer checks passed`);
process.exit(failed ? 1 : 0);
