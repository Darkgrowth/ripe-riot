// Two browser pages over the shipped BroadcastChannel transport. Verifies
// targeted host damage and both directions of teammate revival end to end.
import { startServer, openGame, openSecondClient, sleep } from './driver.mjs';

const server = await startServer();
let first, second;
const checks = [];
const check = (condition, label, detail = '') => {
  checks.push({ condition, label, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
};
const read = (g) => g.page.evaluate(() => {
  const game = window.__GAME;
  const v = game.get('vitals');
  return { health: v.health, downed: v.downed, state: game.player.state,
    mode: v.mode, reviveProgress: v.reviveProgress };
});
const faceTo = async (g, x, y, z) => {
  const [px, py, pz] = (await g.state()).player.pos;
  await g.look(Math.atan2(-(x - px), -(z - pz)),
    Math.atan2(y - py - 1.63, Math.hypot(x - px, z - pz)));
};

try {
  first = await openGame({ width: 400, height: 225, headless: true,
    quiet: true, islandActivities: false, drawFrames: false });
  second = await openSecondClient(first);
  const room = `action-${Math.floor(Math.random() * 1e8)}`;
  const idA = await first.call('net.connect', room, 0);
  const idB = await second.call('net.connect', room, 0);
  await sleep(2600);
  const aHost = (await first.state()).net.isHost;
  const host = aHost ? first : second;
  const client = aHost ? second : first;
  const hostId = aHost ? idA : idB;
  const clientId = aHost ? idB : idA;
  // This authority fixture parks both peers inside the new orchard ambush.
  // Hold enemy AI still while checking targeted damage, revive, and the
  // client's actual host-validated melee intent.
  await host.call('encounters.suspend', true);
  const y = await host.terrainHeight(-24, 22);
  await host.tp(-24, y + 1.2, 22);
  await client.tp(-24, y + 1.2, 23);
  await sleep(1400);
  check((await read(host)).mode === 'coop' && (await read(client)).mode === 'coop',
    'both players enter cooperative failure mode');

  await host.page.evaluate((peer) => window.__GAME.get('net').damagePeer(peer, 24, 'test-spit'), clientId);
  await sleep(300);
  check((await read(client)).health === 76, 'only the targeted client receives host-approved damage');

  await host.page.evaluate(() => window.__GAME.get('vitals').damage(100, 'test-jaw'));
  await sleep(500);
  check((await read(host)).downed && (await client.page.evaluate(() =>
    window.__GAME.get('net').nearbyDowned()?.id)) === hostId,
  'client sees the nearby downed host');
  await client.page.evaluate((peer) => window.__GAME.get('net').requestRevive(peer, true), hostId);
  await sleep(3500);
  check(!(await read(host)).downed && (await read(host)).health === 50,
    'client hold revives the host over the network');
  await client.page.evaluate((peer) => window.__GAME.get('net').requestRevive(peer, false), hostId);

  await client.page.evaluate(() => window.__GAME.get('vitals').damage(100, 'test-jaw'));
  await sleep(500);
  check((await read(client)).downed && (await host.page.evaluate(() =>
    window.__GAME.get('net').nearbyDowned()?.id)) === clientId,
  'host sees the nearby downed client');
  await host.page.evaluate((peer) => window.__GAME.get('net').requestRevive(peer, true), clientId);
  await sleep(3500);
  check(!(await read(client)).downed && (await read(client)).health === 50,
    'host hold revives the client over the network');
  await host.page.evaluate((peer) => window.__GAME.get('net').requestRevive(peer, false), clientId);

  const enemies = await host.call('encounters.info');
  const [mx, my, mz] = enemies.threats.mimic.pos;
  await client.tp(mx, my + 1.2, mz - 2.2);
  await faceTo(client, mx, my + 1.15, mz);
  await client.call('tool.select', 'hand');
  await sleep(950);
  // Debug fire supplies the click; neutral synthetic input keeps the normal
  // swing lifecycle active until its contact frame without pointer lock.
  await client.input({});
  await client.call('tool.fire');
  await sleep(450);
  await client.clearInput();
  const mimicHost = await host.call('encounters.info');
  const mimicClient = await client.call('encounters.info');
  check(mimicHost.threats.mimic.health < 3
    && mimicClient.threats.mimic.health === mimicHost.threats.mimic.health,
  'client melee reaches host authority and returns in encounter snapshots');

  await host.page.evaluate(() => window.__GAME.bus.emit('encounter:defeated', {
    kind: 'mimic', position: window.__GAME.player.position.clone(), actorId: 'test',
  }));
  await sleep(350);
  check((await client.page.evaluate(() => window.__GAME.get('progress').objective))
    .includes('Snapjaw'), 'client objective advances from the host encounter milestone');

  const boss = await host.call('kingVine.info');
  const [bx, by, bz] = boss.center;
  const ground = await client.terrainHeight(bx, bz - 3.2);
  await client.tp(bx, ground + 1.2, bz - 3.2);
  await client.call('tool.give', 'aircannon');
  await client.call('tool.select', 'aircannon');
  await host.page.evaluate(() => {
    const vine = window.__GAME.get('kingVine');
    vine.phase = 'recover'; vine.timeLeft = 10;
  });
  await sleep(1000);
  await faceTo(client, bx, by + 1.7, bz);
  await client.call('tool.fire');
  await sleep(450);
  const afterBoss = await host.call('kingVine.info');
  check(afterBoss.health < boss.health,
    'client Air Cannon damages host-owned King Vine through a validated intent',
    `health ${boss.health} -> ${afterBoss.health}, phase ${afterBoss.phase}`);

  const errors = [...first.consoleErrors, ...second.consoleErrors]
    .filter(e => !/DevTools|deprecat|ReadPixels|GPU stall/i.test(e));
  check(errors.length === 0, 'both clients run without browser errors', errors.slice(0, 2).join(' | '));
} finally {
  await second?.closePage().catch(() => {});
  await first?.close().catch(() => {});
  if (server.proc) server.proc.kill();
}

console.log(`${checks.filter(c => c.condition).length}/${checks.length} checks passed`);
process.exit(checks.every(c => c.condition) ? 0 : 1);
