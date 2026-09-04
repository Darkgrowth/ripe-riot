// Two real browser pages, two real game instances, one real message bus.
//
// BroadcastChannel is the same-machine transport the game actually ships for
// local co-op, so this is an end-to-end test rather than a mock: host election,
// peer discovery, player replication, fruit replication and shared economy all
// go over the wire they will use in a living room.

import { startServer, openGame, openSecondClient, sleep } from './driver.mjs';

const server = await startServer();
const checks = [];
const ok = (cond, label, detail = '') => {
  checks.push({ ok: !!cond, label, detail });
  return !!cond;
};

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
  await sleep(1400);
  const onClient = await client.call('fruit.info', fruitId);
  ok(onClient !== null, 'a fruit spawned on the host appears on the client');
  if (onClient) {
    console.log('client sees fruit at', onClient.pos.join(', '), 'state', onClient.state);
    ok(onClient.species === 'watermelon', 'with the right species', onClient.species);
  }

  // --- shared economy
  await host.call('economy.set', 0);
  await sleep(500);
  await host.call('economy.add', 250);
  await sleep(1200);
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
  await sleep(1200);
  const freeAfter = (await host.state()).fruit.free;
  ok(freeAfter > freeBefore, 'a client intent makes the host shake the tree',
    `${freeBefore} -> ${freeAfter} loose fruit`);

  // --- disconnect cleanly
  await client.call('net.disconnect');
  await sleep(2600);
  const afterLeave = (await host.state()).net;
  ok(afterLeave.remotes === 0, 'the host drops the avatar when a peer leaves',
    `${afterLeave.remotes} remotes remain`);

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
