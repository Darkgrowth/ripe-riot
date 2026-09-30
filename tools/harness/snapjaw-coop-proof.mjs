/** Two-client visual fixture: physical Snapjaw throw, real Catch Net swing. */
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { startServer, openGame, openSecondClient, sleep } from './driver.mjs';

const args = process.argv.slice(2);
if (!args.includes('--allow-browser-input'))
  throw new Error('Browser pointer input is disabled during active play. Run only after the user says play is over, with --allow-browser-input.');
if (!process.env.RIPE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.RIPE_URL))
  throw new Error('Set RIPE_URL to an isolated local server before running the co-op proof.');
const at = args.indexOf('--out');
const out = path.resolve(at < 0 ? 'capture/sunpatch-chaos/snapjaw-coop' : args[at + 1]);
mkdirSync(out, { recursive: true });
const checks = [], timeline = [];
const started = Date.now();
const log = (kind, data = {}) => {
  const row = { wallSeconds: +((Date.now() - started) / 1000).toFixed(2), kind, ...data };
  timeline.push(row); console.log(JSON.stringify(row));
};
const check = (condition, name, detail = {}) => {
  checks.push({ condition, name, detail }); log(condition ? 'pass' : 'fail', { name, detail });
};
let first, second, host, guest, failure = null;
const server = await startServer();
const read = g => g.page.evaluate(() => {
  const game = window.__GAME;
  const net = game.get('net');
  const encounters = game.get('encounters').snapshot();
  const jaw = encounters.encounters.find(e => e.kind === 'snapjaw');
  const tool = game.get('tools').all.get('net');
  return { me: net.me, host: net.isHost,
    position: game.player.position.toArray(),
    velocity: game.player.velocity.toArray(),
    playerState: game.player.state,
    health: game.get('vitals').health,
    jaw: { ...jaw }, flights: encounters.flights ?? [],
    tool: game.get('tools').activeId,
    netSwings: tool?.swings ?? 0,
    netCaught: tool?.caught ?? 0,
    netMisses: tool?.misses ?? 0,
    toasts: window.__coopProof?.toasts ?? [],
    synthetic: game.input.synthetic !== null,
    pointerLocked: game.input.pointerLocked };
});
const shot = async (g, name) => {
  await g.page.screenshot({ path: path.join(out, `${name}.png`) });
};
try {
  // One full-size rendered rescuer is enough for gameplay-camera evidence.
  // Rendering and recording two WebGL pages made screenshot readback stall the
  // 1.8-second catch window by many seconds in the first attempt.
  first = await openGame({ width: 1712, height: 634, headless: true,
    quiet: true, islandActivities: false, drawFrames: true,
    recordVideoDir: args.includes('--video') ? out : null });
  second = await openSecondClient(first, { drawFrames: false });
  const room = `snapjaw-proof-${Math.floor(Math.random() * 1e9)}`;
  const idA = await first.call('net.connect', room, 0);
  const idB = await second.call('net.connect', room, 0);
  await sleep(2000);
  const aHost = (await first.state()).net.isHost;
  host = aHost ? first : second;
  guest = aHost ? second : first;
  if (host === second) await host.page.evaluate(() => {
    if (window.__RIPE_HARNESS_DRAW)
      window.__GAME.renderer.render = window.__RIPE_HARNESS_DRAW;
  });
  if (guest === first) await guest.page.evaluate(() => {
    window.__GAME.renderer.render = () => {};
  });
  const hostId = aHost ? idA : idB;
  const guestId = aHost ? idB : idA;
  check(!!hostId && !!guestId && hostId !== guestId,
    'two peers connected with one host', { hostId, guestId });
  const anyShell = async g => g.page.locator('.expedition-shell').isVisible();
  for (const g of [host, guest]) if (await anyShell(g)) {
    const continueButton = g.page.locator('[data-expedition-action="continue"]');
    if (await continueButton.isVisible()) await continueButton.click();
  }
  await host.call('tool.give', 'net');
  await host.call('tool.select', 'net');
  check((await read(host)).tool === 'net', 'rescuer has Catch Net equipped');
  await host.page.evaluate(() => {
    window.__coopProof = { toasts: [] };
    window.__GAME.bus.on('ui:toast', payload =>
      window.__coopProof.toasts.push({ text: payload.text,
        at: window.__GAME.clock.elapsed }));
  });
  const jaw = (await read(host)).jaw.position;
  const hx = jaw[0] + 4.5, hz = jaw[2] + 3.5;
  const vx = jaw[0] + 1.2, vz = jaw[2] + 1.2;
  const hy = await host.terrainHeight(hx, hz);
  const vy = await guest.terrainHeight(vx, vz);
  await host.tp(hx, hy + .15, hz);
  await guest.tp(vx, vy + .15, vz);
  await host.look(Math.atan2(-(vx - hx), -(vz - hz)), 0);
  await guest.look(Math.atan2(-(jaw[0] - vx), -(jaw[2] - vz)), 0);
  // The first real click locks the rescuer's pointer before the bite. Its
  // opening swing has plenty of time to recover before the airborne catch.
  await host.page.mouse.click(850, 315);
  await sleep(350);
  await shot(host, '01-host-setup');
  const holdUntil = Date.now() + 12000;
  let held = null;
  while (Date.now() < holdUntil) {
    const s = await read(host);
    if (s.jaw.capturedVictimId === guestId) { held = s; break; }
    await sleep(40);
  }
  if (!held) throw new Error('The remote player was not captured by the live jaw');
  check(held.jaw.captureAim?.[0] > jaw[0] + 2,
    'jaw targets the active teammate', { aim: held.jaw.captureAim, teammate: [hx, hy, hz] });
  log('held', { host: held, victim: await read(guest) });
  // Video records the held pose. A synchronous screenshot here can consume
  // most of the short flight while two WebGL clients share one browser.
  // Face the expected flight from the actual rescuer view. This is fixture
  // positioning; the catch itself remains a normal mouse swing.
  await host.look(Math.atan2(-(vx - hx), -(vz - hz)), 0);
  let startedSwing = false, sawFlight = false;
  const flightUntil = Date.now() + 60000;
  while (Date.now() < flightUntil) {
    const s = await read(host);
    const flight = s.flights.find(f => f.victimId === guestId);
    if (flight && !sawFlight) {
      sawFlight = true;
      log('flight-visible', { flight, rescuer: s.position, victim: (await read(guest)).position });
    }
    if (flight && !startedSwing) {
      startedSwing = true;
      await host.page.mouse.down(); await sleep(80); await host.page.mouse.up();
      log('real-net-swing', { flightId: flight.flingId });
    }
    if (startedSwing && !s.flights.some(f => f.victimId === guestId)) break;
    await sleep(15);
  }
  await sleep(300);
  const afterHost = await read(host), afterGuest = await read(guest);
  log('after-catch-window', { host: afterHost, victim: afterGuest });
  await shot(host, '05-after-net-window');
  check(sawFlight, 'host observed a numbered teammate flight');
  check(startedSwing && afterHost.netSwings >= 2,
    'rescuer made a real timed Catch Net swing', { swings: afterHost.netSwings });
  check(afterHost.flights.every(f => f.victimId !== guestId)
    && afterGuest.playerState === 'active' && afterGuest.health > 0,
  'flight ended with the victim active', { health: afterGuest.health,
    velocity: afterGuest.velocity });
  check(afterHost.toasts.some(toast => toast.text === 'Teammate caught!'),
    'host confirmed the timed Catch Net interception',
    { toasts: afterHost.toasts, caught: afterHost.netCaught,
      victimVelocity: afterGuest.velocity });
} catch (error) {
  failure = String(error.stack || error);
  log('runner-error', { failure });
} finally {
  const videos = [];
  const aVideo = first?.page.video(), bVideo = second?.page.video();
  if (first) await first.close().catch(() => {});
  for (const [video, name] of [[aVideo, 'peer-a.webm'], [bVideo, 'peer-b.webm']]) if (video) {
    const file = path.join(out, name);
    try { copyFileSync(await video.path(), file); videos.push(file); } catch { /* preserve report */ }
  }
  if (server.proc) server.proc.kill();
  const report = { passed: !failure && checks.every(c => c.condition), failure,
    checks, timeline, videos,
    errors: [...(first?.consoleErrors ?? []), ...(second?.consoleErrors ?? [])],
    viewport: [1712, 634] };
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, failure, out,
    checks: checks.map(c => [c.name, c.condition]), errors: report.errors }));
  if (!report.passed) process.exitCode = 1;
}
