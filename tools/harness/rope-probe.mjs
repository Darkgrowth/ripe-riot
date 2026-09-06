// Two clients, one watermelon, two ropes, a gentle winch from both sides:
// prints what the host's solver sees every 200 ms until a line parts.
// Diagnostic only; never asserts.

import { startServer, openGame, openSecondClient, sleep } from './driver.mjs';

const server = await startServer();
let a, b;
try {
  a = await openGame({ width: 400, height: 225, headless: true, quiet: true });
  b = await openSecondClient(a);
  const room = 'probe' + Math.floor(Math.random() * 1e6);
  await a.call('net.connect', room, 0);
  await b.call('net.connect', room, 0);
  await sleep(2600);
  const host = (await a.state()).net.isHost ? a : b;
  const client = host === a ? b : a;
  const stand = async (page, x, z) => {
    await page.call('ragdoll.recover').catch(() => {});
    await page.tp(x, (await page.terrainHeight(x, z)) + 1.2, z);
    await sleep(900);
  };
  const faceTo = async (page, x, y, z) => {
    const s = await page.state();
    const [px, py, pz] = s.player.pos;
    await page.look(Math.atan2(-(x - px), -(z - pz)), Math.atan2(y - (py + 1.6), Math.hypot(x - px, z - pz)));
  };
  await host.call('rope.clear'); await client.call('rope.clear');
  await host.call('fruit.despawnAllFree');
  await sleep(600);
  const melon = await host.call('fruit.spawn', 'watermelon', -24, 9, 22);
  await sleep(1400);
  const m = (await host.call('fruit.info', melon)).pos;
  console.log('melon at', m);
  await stand(client, m[0] + 4.5, m[2]);
  await stand(host, m[0] - 4.5, m[2]);
  for (const p of [host, client]) { await p.call('tool.give', 'ropegun'); await p.call('tool.select', 'ropegun'); }
  await faceTo(client, m[0], m[1], m[2]); await faceTo(host, m[0], m[1], m[2]);
  await sleep(300);
  await client.call('tool.fire'); await sleep(600);
  await host.call('tool.fire'); await sleep(1400);
  const dump = async (label) => {
    const hs = await host.state(); const cs = await client.state();
    const hr = hs.ropes.list.map((r) => `#${r.id}${r.mirror ? 'm' : ''} ${r.ak}-${r.bk} len ${r.len} dist ${r.dist} T ${r.tension}`).join(' | ');
    const cr = cs.ropes.list.map((r) => `#${r.id}${r.mirror ? 'm' : ''} ${r.ak}-${r.bk} len ${r.len} dist ${r.dist} T ${r.tension}`).join(' | ');
    const fi = await host.call('fruit.info', melon);
    console.log(`${label}\n   host: ${hr}\n   client: ${cr}\n   melon ${fi?.pos.map((v) => v.toFixed(2)).join(',')} v ${fi?.speed}  hostP ${hs.player.pos.map((v) => v.toFixed(2)).join(',')} spd ${hs.player.speed} ${hs.player.state}  clientP ${cs.player.pos.map((v) => v.toFixed(2)).join(',')} spd ${cs.player.speed} ${cs.player.state}`);
  };
  await dump('before winch');
  const mine = (await client.call('net.ropes')).find((r) => r.mine);
  const hostId = await host.call('net.id');
  const hostMine = (await host.call('net.ropes')).find((r) => r.owner === hostId);
  await client.call('rope.reel', mine.cid, -0.7);
  await host.call('rope.reel', hostMine.cid, -0.7);
  for (let i = 0; i < 10; i++) { await sleep(200); await dump(`t+${(i + 1) * 200} ms`); }
  await client.call('rope.reel', mine.cid, 0);
  await host.call('rope.reel', hostMine.cid, 0);
  await sleep(800);
  await dump('after');
} finally {
  await b?.closePage().catch(() => {});
  await a?.close().catch(() => {});
  if (server.proc) server.proc.kill();
}
