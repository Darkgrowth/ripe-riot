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
    netPhase: tool?.phase ?? null,
    netPhaseT: tool?.phaseT ?? 0,
    netHoop: tool?.hoop?.toArray() ?? null,
    samples: window.__coopProof?.samples ?? [],
    localFlingId: game.player.catchableFlingId,
    peerFlingIds: [...net.remotes.values()].map(peer => [peer.id, peer.flingId]),
    peerPositions: [...net.remotes.values()].map(peer => [peer.id,
      peer.targetPos.toArray()]),
    catchRequests: window.__coopProof?.requests ?? [],
    catchValidations: window.__coopProof?.validations ?? [],
    catchAcks: window.__coopProof?.acks ?? [],
    toasts: window.__coopProof?.toasts ?? [],
    synthetic: game.input.synthetic !== null,
    pointerLocked: game.input.pointerLocked };
});
const shot = async (g, name) => {
  await g.page.screenshot({ path: path.join(out, `${name}.png`), timeout: 15000 });
};
try {
  // Both peers must advance at comparable rates. A render-suppressed victim
  // can finish the whole flight while the rendered host is still on its first
  // swing, leaving a stale host encounter window and an already-landed peer.
  first = await openGame({ width: 1712, height: 634, headless: true,
    quiet: true, islandActivities: false, drawFrames: true,
    recordVideoDir: args.includes('--video') ? out : null });
  second = await openSecondClient(first, { drawFrames: true });
  const room = `snapjaw-proof-${Math.floor(Math.random() * 1e9)}`;
  const idA = await first.call('net.connect', room, 0);
  const idB = await second.call('net.connect', room, 0);
  await sleep(2000);
  const aHost = (await first.state()).net.isHost;
  host = aHost ? first : second;
  guest = aHost ? second : first;
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
    const game = window.__GAME;
    const net = game.get('net');
    const proof = window.__coopProof = {
      toasts: [], requests: [], validations: [], acks: [], samples: [],
    };
    const tool = game.get('tools').all.get('net');
    const originalSweep = tool.sweep.bind(tool);
    tool.sweep = () => {
      const flight = game.get('encounters').snapshot().flights?.[0];
      if (flight && proof.samples.length < 80) {
        const victim = flight && net.remotes.get(flight.victimId);
        const eye = game.player.eyePosition.clone();
        const aim = game.player.lookDir(new game.player.position.constructor()).clone();
        const target = eye.addScaledVector(aim, tool.catchDistance);
        proof.samples.push({ at: game.clock.elapsed,
          phaseT: tool.phaseT, hoop: tool.hoop.toArray(), target: target.toArray(),
          victim: victim?.targetPos.toArray(), flingId: victim?.flingId,
          flightRemaining: flight?.remaining,
          distance: victim ? Math.hypot(victim.targetPos.x - target.x,
            victim.targetPos.y + .9 - target.y,
            victim.targetPos.z - target.z) : null });
      }
      return originalSweep();
    };
    game.bus.on('ui:toast', payload =>
      proof.toasts.push({ text: payload.text, at: game.clock.elapsed }));
    const requestCatch = net.requestNetCatch.bind(net);
    net.requestNetCatch = (...args) => {
      proof.requests.push({ at: game.clock.elapsed, victimId: args[0],
        flingId: args[1], swingId: args[2],
        peerFlingId: net.remotes.get(args[0])?.flingId ?? 0 });
      return requestCatch(...args);
    };
    const tryCatch = net.hostTryNetCatch.bind(net);
    net.hostTryNetCatch = (from, request) => {
      const peerFlingId = net.remotes.get(request.victimId)?.flingId ?? 0;
      const victimPos = net.remotes.get(request.victimId)?.targetPos
        ?? game.player.position;
      const rescuerPos = net.remotes.get(from)?.targetPos ?? game.player.position;
      const swing = net.netCatchGuard.swings.get(from);
      const ok = tryCatch(from, request);
      proof.validations.push({ at: game.clock.elapsed, from,
        victimId: request.victimId, flingId: request.flingId,
        swingId: request.swingId, peerFlingId,
        origin: request.origin, aim: request.aim,
        victimPos: victimPos.toArray(), rescuerPos: rescuerPos.toArray(),
        swing: swing ? { ...swing } : null, ok });
      return ok;
    };
    const handleMessage = net.onMessage.bind(net);
    net.onMessage = message => {
      if (message.t === 'netCatchAck')
        proof.acks.push({ at: game.clock.elapsed, from: message.from,
          catchId: message.catchId, flingId: message.flingId,
          stopped: message.stopped });
      return handleMessage(message);
    };
  });
  const jaw = (await read(host)).jaw.position;
  const hx = jaw[0] + 8, hz = jaw[2] + 7;
  const vx = jaw[0] + 1.0, vz = jaw[2] + 1.0;
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
  // A synchronous GPU readback stalled the shared two-client Linux renderer
  // before the jaw had even bitten. Preserve the timed input window first.
  if (!args.includes('--no-setup-shot')) await shot(host, '01-host-setup');
  const holdUntil = Date.now() + 30000;
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
  // Set the ordinary held input from the in-game countdown rather than a
  // wall-clock delay; CI and desktop software WebGL advance at different rates.
  const swingDeadline = Date.now() + 30000;
  while (Date.now() < swingDeadline) {
    const state = await read(host);
    if (state.jaw.captureTimeLeft <= .52 || state.jaw.capturedVictimId !== guestId) break;
    await sleep(20);
  }
  await host.page.mouse.down();
  let startedSwing = true, sawFlight = false, firstFlight = null;
  const flightUntil = Date.now() + 60000;
  while (Date.now() < flightUntil) {
    const s = await read(host);
    const flight = s.flights.find(f => f.victimId === guestId);
    // Snapshot the host's last peer packet now. Reading the guest page before
    // mouse-down can spend the entire short interception window on IPC.
    if (flight && !sawFlight) {
      sawFlight = true;
      firstFlight = { observedAtWallSeconds: +((Date.now() - started) / 1000).toFixed(2),
        flight, rescuer: s.position,
        victim: s.peerPositions.find(([id]) => id === guestId)?.[1] ?? null,
        hostPeerFlingId: s.peerFlingIds.find(([id]) => id === guestId)?.[1] ?? 0 };
    }
    if (flight && firstFlight && !timeline.some(row => row.kind === 'flight-visible'))
      log('flight-visible', firstFlight);
    if (sawFlight && !s.flights.some(f => f.victimId === guestId)) break;
    await sleep(15);
  }
  await host.page.mouse.up();
  await sleep(300);
  const afterHost = await read(host), afterGuest = await read(guest);
  log('after-catch-window', { host: afterHost, victim: afterGuest });
  try { await shot(host, '05-after-net-window'); }
  catch (error) { log('capture-error', { error: String(error) }); }
  check(sawFlight, 'host observed a numbered teammate flight');
  check(startedSwing && afterHost.netSwings >= 2,
    'rescuer made a real timed Catch Net swing', { swings: afterHost.netSwings });
  check(afterHost.flights.every(f => f.victimId !== guestId)
    && afterGuest.playerState === 'active' && afterGuest.health > 0,
  'flight ended with the victim active', { health: afterGuest.health,
    velocity: afterGuest.velocity });
  check(afterHost.catchRequests.length > 0,
    'net hoop nominated the flying teammate',
    { requests: afterHost.catchRequests, validations: afterHost.catchValidations,
      acknowledgements: afterHost.catchAcks });
  check(afterHost.toasts.some(toast => toast.text === 'Teammate caught!'),
    'host confirmed the timed Catch Net interception',
    { toasts: afterHost.toasts, caught: afterHost.netCaught,
      requests: afterHost.catchRequests, validations: afterHost.catchValidations,
      acknowledgements: afterHost.catchAcks,
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
