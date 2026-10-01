/** Two-client visual fixture: physical Snapjaw throw, real Catch Net swing. */
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { startServer, openGame, openSecondClient, sleep } from './driver.mjs';

const args = process.argv.slice(2);
const logicOnly = args.includes('--logic-only');
const freezeCatchFrame = args.includes('--freeze-catch-frame');
const guestRescuer = args.includes('--guest-rescuer');
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
let first, second, rescuer, victim, failure = null;
const server = await startServer();
const read = g => g.page.evaluate(() => {
  const game = window.__GAME;
  const net = game.get('net');
  const encounters = game.get('encounters').snapshot();
  const jaw = encounters.encounters.find(e => e.kind === 'snapjaw');
  const tool = game.get('tools').all.get('net');
  return { me: net.me, isHost: net.isHost,
    position: game.player.position.toArray(),
    yaw: game.player.yaw, pitch: game.player.pitch,
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
    frozenCatch: window.__coopProof?.frozenCatch ?? null,
    synthetic: game.input.synthetic !== null,
    pointerLocked: game.input.pointerLocked };
});
const shot = async (g, name) => {
  await g.page.screenshot({ path: path.join(out, `${name}.png`), timeout: 15000 });
};
try {
  // Both peers must advance at comparable rates. A render-suppressed victim
  // can finish the whole flight while the rendered rescuer is still on its first
  // swing, leaving a stale rescuer encounter window and an already-landed peer.
  first = await openGame({ width: 1712, height: 634, headless: true,
    quiet: true, islandActivities: false, drawFrames: !logicOnly,
    recordVideoDir: args.includes('--video') ? out : null });
  second = await openSecondClient(first, { drawFrames: !logicOnly });
  const room = `snapjaw-proof-${Math.floor(Math.random() * 1e9)}`;
  const idA = await first.call('net.connect', room, 0);
  const idB = await second.call('net.connect', room, 0);
  await sleep(2000);
  const aHost = (await first.state()).net.isHost;
  const authority = aHost ? first : second;
  const other = aHost ? second : first;
  rescuer = guestRescuer ? other : authority;
  victim = guestRescuer ? authority : other;
  await rescuer.page.bringToFront();
  const authorityId = aHost ? idA : idB;
  const otherId = aHost ? idB : idA;
  const rescuerId = guestRescuer ? otherId : authorityId;
  const victimId = guestRescuer ? authorityId : otherId;
  check(!!rescuerId && !!victimId && rescuerId !== victimId,
    'two peers connected with one host', { rescuerId, victimId, guestRescuer });
  const anyShell = async g => g.page.locator('.expedition-shell').isVisible();
  for (const g of [rescuer, victim]) if (await anyShell(g)) {
    const continueButton = g.page.locator('[data-expedition-action="continue"]');
    if (await continueButton.isVisible()) await continueButton.click();
  }
  await rescuer.call('tool.give', 'net');
  await rescuer.call('tool.select', 'net');
  check((await read(rescuer)).tool === 'net', 'rescuer has Catch Net equipped');
  // Lock and finish the opening swing at the safe dock. Pointer setup and a
  // read of the other page must not consume the short jaw/flight sequence.
  await rescuer.page.mouse.click(850, 315);
  await sleep(800);
  for (const client of [rescuer, victim]) await client.page.evaluate(freezeCatchFrame => {
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
          yaw: game.player.yaw, pitch: game.player.pitch,
          victim: victim?.targetPos.toArray(), flingId: victim?.flingId,
          flightRemaining: flight?.remaining,
          distance: victim ? Math.hypot(victim.targetPos.x - target.x,
            victim.targetPos.y + .9 - target.y,
            victim.targetPos.z - target.z) : null });
      }
      return originalSweep();
    };
    game.bus.on('ui:toast', payload => {
      proof.toasts.push({ text: payload.text, at: game.clock.elapsed });
      if (freezeCatchFrame && payload.text === 'Teammate caught!') {
        // Freeze only after the victim's stop acknowledgement produces the
        // real success cue. Preserve that gameplay view for a single draw;
        // GPU readback must not spend the short interception window.
        proof.frozenCatch = { at: game.clock.elapsed,
          position: game.player.position.toArray(),
          yaw: game.player.yaw, pitch: game.player.pitch };
        game.clock.paused = true;
        game.stop();
      }
    });
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
  }, freezeCatchFrame);
  const jaw = (await read(rescuer)).jaw.position;
  // Stand beyond bite range but close enough that the first airborne player
  // packet crosses the visible hoop during this swing, even on slow CI frames.
  const hx = jaw[0] + 3.8, hz = jaw[2] + 3.8;
  const vx = jaw[0] + 1.0, vz = jaw[2] + 1.0;
  const hy = await rescuer.terrainHeight(hx, hz);
  const vy = await victim.terrainHeight(vx, vz);
  await rescuer.tp(hx, hy + .15, hz);
  await victim.tp(vx, vy + .15, vz);
  await rescuer.look(Math.atan2(-(vx - hx), -(vz - hz)), 0);
  await victim.look(Math.atan2(-(jaw[0] - vx), -(jaw[2] - vz)), 0);
  log('capture-setup', { rescuer: await read(rescuer), victimId,
    victimPosition: [vx, vy + .15, vz] });
  // A synchronous GPU readback stalled the shared two-client Linux renderer
  // before the jaw had even bitten. Preserve the timed input window first.
  if (!args.includes('--no-setup-shot')) await shot(rescuer, '01-rescuer-setup');
  const holdUntil = Date.now() + 30000;
  let held = null;
  while (Date.now() < holdUntil) {
    const s = await read(rescuer);
    if (s.jaw.capturedVictimId === victimId) { held = s; break; }
    await sleep(40);
  }
  if (!held) {
    log('capture-timeout', { rescuer: await read(rescuer), victim: await read(victim) });
    throw new Error('The victim was not captured by the live jaw');
  }
  check(held.jaw.captureAim?.[0] > jaw[0] + 2,
    'jaw targets the active teammate', { aim: held.jaw.captureAim, teammate: [hx, hy, hz] });
  log('held', { rescuer: held, victimId });
  // Video records the held pose. A synchronous screenshot here can consume
  // most of the short flight while two WebGL clients share one browser.
  // Face the expected flight from the actual rescuer view. This is fixture
  // positioning; the catch itself remains a normal mouse swing.
  await rescuer.look(Math.atan2(-(vx - hx), -(vz - hz)), 0);
  // Set the ordinary held input from the in-game countdown rather than a
  // wall-clock delay; CI and desktop software WebGL advance at different rates.
  const swingDeadline = Date.now() + 30000;
  while (Date.now() < swingDeadline) {
    const state = await read(rescuer);
    if (state.jaw.captureTimeLeft <= .52 || state.jaw.capturedVictimId !== victimId) break;
    await sleep(20);
  }
  await rescuer.page.mouse.down();
  // Pointer-lock mouse-down can apply a virtual recenter movement on Linux,
  // shifting the proof fixture's yaw and pitch before the active net slice.
  // Restore the staged view after that real press; the net swing itself is
  // still caused by the browser input and must pass host validation.
  await rescuer.look(Math.atan2(-(vx - hx), -(vz - hz)), 0);
  let startedSwing = true, sawFlight = false, firstFlight = null;
  const flightUntil = Date.now() + 60000;
  while (Date.now() < flightUntil) {
    const s = await read(rescuer);
    const flight = s.flights.find(f => f.victimId === victimId);
    // Snapshot the rescuer's last peer packet now. Reading the victim page before
    // mouse-down can spend the entire short interception window on IPC.
    if (flight && !sawFlight) {
      sawFlight = true;
      firstFlight = { observedAtWallSeconds: +((Date.now() - started) / 1000).toFixed(2),
        flight, rescuer: s.position,
        victim: s.peerPositions.find(([id]) => id === victimId)?.[1] ?? null,
        peerFlingId: s.peerFlingIds.find(([id]) => id === victimId)?.[1] ?? 0 };
    }
    if (flight && firstFlight && !timeline.some(row => row.kind === 'flight-visible'))
      log('flight-visible', firstFlight);
    if (s.frozenCatch) break;
    if (sawFlight && !s.flights.some(f => f.victimId === victimId)) break;
    await sleep(15);
  }
  await rescuer.page.mouse.up();
  await sleep(300);
  const afterRescuer = await read(rescuer), afterVictim = await read(victim);
  log('after-catch-window', { rescuer: afterRescuer, victim: afterVictim });
  try {
    if (logicOnly) await rescuer.renderFrame();
    await shot(rescuer, '05-after-net-window');
  }
  catch (error) { log('capture-error', { error: String(error) }); }
  check(sawFlight || [...afterRescuer.catchValidations, ...afterVictim.catchValidations]
    .some(v => v.ok && v.flingId > 0),
    'rescuer observed a numbered teammate flight');
  check(startedSwing && afterRescuer.netSwings >= 2,
    'rescuer made a real timed Catch Net swing', { swings: afterRescuer.netSwings });
  check(afterRescuer.flights.every(f => f.victimId !== victimId)
    && afterVictim.playerState === 'active' && afterVictim.health > 0,
  'flight ended with the victim active', { health: afterVictim.health,
    velocity: afterVictim.velocity });
  check(afterRescuer.catchRequests.length > 0,
    'net hoop nominated the flying teammate',
    { requests: afterRescuer.catchRequests, validations: [...afterRescuer.catchValidations, ...afterVictim.catchValidations],
      acknowledgements: afterRescuer.catchAcks });
  check([...afterRescuer.catchValidations, ...afterVictim.catchValidations].some(v => v.ok)
    && afterVictim.localFlingId === 0
    && (guestRescuer || afterRescuer.catchAcks.some(ack => ack.stopped)),
    'host accepted the catch and the victim confirmed its flight stopped');
  check(afterRescuer.toasts.some(toast => toast.text === 'Teammate caught!'),
    'rescuer confirmed the timed Catch Net interception',
    { toasts: afterRescuer.toasts, caught: afterRescuer.netCaught,
      requests: afterRescuer.catchRequests, validations: [...afterRescuer.catchValidations, ...afterVictim.catchValidations],
      acknowledgements: afterRescuer.catchAcks,
      victimVelocity: afterVictim.velocity });
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
  const report = { guestRescuer, logicOnly, freezeCatchFrame, passed: !failure && checks.every(c => c.condition), failure,
    checks, timeline, videos,
    errors: [...(first?.consoleErrors ?? []), ...(second?.consoleErrors ?? [])],
    viewport: [1712, 634] };
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, failure, out,
    checks: checks.map(c => [c.name, c.condition]), errors: report.errors }));
  if (!report.passed) process.exitCode = 1;
}
