// Two real game pages over the shipped same-machine BroadcastChannel transport.
// Debug calls are confined to initial position/equipment setup and read-only
// observations. Both attempts, travel, catching, recovery and sales use trusted
// keyboard/mouse input. --video records the full DOM HUD on both pages.
import { startServer, openGame, openSecondClient, ensureOut, sleep } from './driver.mjs';
import { writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

const video = process.argv.includes('--video');
const probe = process.argv.includes('--probe');
const routeProbe = process.argv.includes('--route-probe');
const returnProbe = process.argv.includes('--return-probe');
const clientStepProbe = process.argv.includes('--client-step-probe');
const lowerReleaseProbe = process.argv.includes('--lower-release-probe');
const recoveryProbe = process.argv.includes('--recovery-probe');
const out = ensureOut('vinebomb-coop');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const videoFiles = [];
const checks = [];
const events = [];
const check = (condition, label, detail = '') => {
  const row = { ok: !!condition, label, detail };
  checks.push(row);
  console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!row.ok) throw new Error(`${label}: ${detail}`);
};
const note = (kind, data = {}) => {
  const row = { wall: +(performance.now() / 1000).toFixed(2), kind, ...data };
  events.push(row);
  console.log(kind, JSON.stringify(data));
};
const horizZ = p => p.length === 2 ? p[1] : p[2];
const dist = (a, b) => Math.hypot(a[0] - b[0], horizZ(a) - horizZ(b));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const mouseAt = new WeakMap();
const SITE = [22, -56];
const RELEASE = [20, -53];
const CATCH = [13, -57.5];
const WAIT = [6, -36];
const EAST_SHOULDER = [36, -56];

/** Observe only; no scene or input mutation. */
async function observed(g) {
  return g.page.evaluate(() => {
    const game = window.__GAME, p = game.player;
    const inter = game.get('interaction'), input = game.input;
    return {
      pos: p.position.toArray(), yaw: p.yaw, pitch: p.pitch, eye: p.eyeHeight,
      playerState: p.state, synthetic: input.synthetic !== null,
      locked: input.pointerLocked, sensitivity: input.sensitivity,
      invertY: input.invertY, carrying: inter.carried?.fruit.id ?? -1,
      basket: inter.basket.items.map(f => f.id), targetKind: inter.targetKind,
      money: game.get('economy').money,
    };
  });
}

async function lock(g) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await g.page.bringToFront();
    // With nothing left to sell, a second ordinary E at the dock can open
    // Merv's shop. Escape closes the modal before gameplay reclaims input.
    if (await g.page.evaluate(() => window.__GAME.get('shop').open)) {
      await press(g, 'Escape');
      await sleep(100);
    }
    if (await g.page.evaluate(() => !!document.pointerLockElement)) return;
    await g.page.locator('#view').focus();
    await g.page.mouse.click(200, 112);
    if (await g.page.evaluate(() => !!document.pointerLockElement)) break;
    await sleep(240);
  }
  if (!await g.page.evaluate(() => !!document.pointerLockElement)) {
    const detail = await g.page.evaluate(() => ({ focus: document.hasFocus(),
      active: document.activeElement?.id, shop: window.__GAME.get('shop').open,
      locked: window.__GAME.input.pointerLocked }));
    throw new Error(`trusted click could not regain pointer lock: ${JSON.stringify(detail)}`);
  }
  // The first mousemove on pointer-lock acquisition is deliberately swallowed.
  await g.page.mouse.move(201, 112);
  mouseAt.set(g, [201, 112]);
  await sleep(90);
}

async function aim(g, target, pitch = null) {
  await lock(g);
  for (let i = 0; i < 18; i++) {
    const s = await observed(g);
    if (s.synthetic) throw new Error('synthetic input unexpectedly enabled');
    const yaw = Math.atan2(-(target[0] - s.pos[0]), -(target[2] - s.pos[2]));
    const wantedPitch = pitch ?? Math.atan2(target[1] - s.pos[1] - s.eye,
      Math.max(0.05, dist(target, s.pos)));
    const dyaw = wrap(yaw - s.yaw), dpitch = wantedPitch - s.pitch;
    if (Math.abs(dyaw) < 0.035 && Math.abs(dpitch) < 0.045) return;
    const dx = Math.max(-150, Math.min(150, -dyaw / (s.sensitivity || .0022)));
    const dy = Math.max(-100, Math.min(100,
      -dpitch / ((s.sensitivity || .0022) * (s.invertY ? -1 : 1))));
    const [x, y] = mouseAt.get(g) ?? [201, 112];
    const next = [x + dx, y + dy];
    await g.page.mouse.move(...next);
    mouseAt.set(g, next);
    await sleep(65);
  }
  throw new Error(`trusted mouse aim failed toward ${target.join(',')}`);
}

async function press(g, key, ms = 110) {
  await g.page.bringToFront();
  await g.page.keyboard.down(key);
  await sleep(ms);
  await g.page.keyboard.up(key);
  await sleep(80);
}

async function closeShopAndCheckHud(g, expectedMoney, label) {
  if (await g.page.evaluate(() => window.__GAME.get('shop').open)) {
    await press(g, 'Escape');
  }
  const ui = await g.page.evaluate(() => ({
    shopOpen: window.__GAME.get('shop').open,
    moneyText: document.querySelector('.money span')?.textContent ?? '',
  }));
  check(!ui.shopOpen && Number(ui.moneyText.replaceAll(',', '')) === expectedMoney,
    label, JSON.stringify(ui));
}

async function walkTo(g, target, { radius = 1.1, timeout = 18, from = null } = {}) {
  const deadline = Date.now() + timeout * 1000;
  let stuck = 0, previous = null;
  const reached = pos => {
    if (dist(pos, target) < radius) return true;
    if (!from) return false;
    const dx = target[0] - from[0], dz = horizZ(target) - horizZ(from);
    const length = Math.hypot(dx, dz);
    if (length <= 0.1) return false;
    const px = pos[0] - from[0], pz = pos[2] - horizZ(from);
    const along = (px * dx + pz * dz) / length;
    const lateral = Math.abs(px * dz - pz * dx) / length;
    return along > length + 0.2 && lateral < 1.8;
  };
  while (Date.now() < deadline) {
    const s = await observed(g);
    if (reached(s.pos)) return;
    // A downhill sprint can pass a short grid waypoint between rendered
    // frames. Count that as traversed only when still close to its segment;
    // turning back toward it would pull the player off the safe shelf.
    if (s.playerState !== 'active') { await sleep(450); continue; }
    await aim(g, [target[0], s.pos[1] + s.eye, horizZ(target)], -0.05);
    await g.page.keyboard.down('w');
    await g.page.keyboard.down('Shift');
    // Short bursts prevent a sprint from skipping a two-metre shelf waypoint
    // when the full-HUD video run renders fewer frames than the numeric run.
    await sleep(Math.max(120, Math.min(320, (dist(s.pos, target) - radius) * 95)));
    await g.page.keyboard.up('Shift');
    await g.page.keyboard.up('w');
    const now = (await observed(g)).pos;
    if (reached(now)) return;
    if (previous && dist(now, previous) < 0.17) stuck++; else stuck = 0;
    previous = now;
    if (stuck >= 2) {
      await press(g, 'Space', 100);
      await g.page.keyboard.down(stuck % 2 ? 'a' : 'd');
      await sleep(250);
      await g.page.keyboard.up(stuck % 2 ? 'a' : 'd');
    }
  }
  throw new Error(`walk missed ${target.join(',')} from ${(await observed(g)).pos.join(',')}`);
}

/** Read-only terrain route; every waypoint is traversed with W/Shift. */
async function terrainRoute(g, from, to) {
  const xmin = -20, xmax = 60, zmin = -62, zmax = 58, stride = 2;
  const nx = (xmax - xmin) / stride + 1;
  const nz = (zmax - zmin) / stride + 1;
  const heights = await g.page.evaluate(({ xmin, xmax, zmin, zmax, stride }) => {
    const terrain = window.__GAME.get('world').terrain;
    const rows = [];
    for (let z = zmin; z <= zmax; z += stride) {
      const row = [];
      for (let x = xmin; x <= xmax; x += stride) row.push(terrain.height(x, z));
      rows.push(row);
    }
    return rows;
  }, { xmin, xmax, zmin, zmax, stride });
  const ix = x => Math.max(0, Math.min(nx - 1, Math.round((x - xmin) / stride)));
  const iz = z => Math.max(0, Math.min(nz - 1, Math.round((z - zmin) / stride)));
  const key = (x, z) => z * nx + x;
  const start = [ix(from[0]), iz(from[1])], goal = [ix(to[0]), iz(to[1])];
  const q = [start], seen = new Set([key(...start)]), back = new Map();
  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
  let found = false;
  for (let head = 0; head < q.length; head++) {
    const [x, z] = q[head];
    if (x === goal[0] && z === goal[1]) { found = true; break; }
    for (const [dx,dz] of dirs) {
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || xx >= nx || zz < 0 || zz >= nz) continue;
      const k = key(xx,zz), y = heights[z][x], yy = heights[zz][xx];
      if (seen.has(k) || yy < 0.4 || Math.abs(yy - y) > Math.hypot(dx,dz) * stride * .65) continue;
      seen.add(k); back.set(k, key(x,z)); q.push([xx,zz]);
    }
  }
  if (!found) throw new Error(`no moderate-slope terrain route ${from} to ${to}`);
  const points = [];
  let k = key(...goal);
  while (k !== key(...start)) {
    points.push([xmin + (k % nx) * stride, zmin + Math.floor(k / nx) * stride]);
    k = back.get(k);
  }
  points.push([xmin + start[0] * stride, zmin + start[1] * stride]);
  points.reverse();
  // Retain every two-metre step near the cliff shelf. On gentler open land,
  // one waypoint every six metres avoids needless pointer-input overhead.
  return points.filter((p, i) => i === 0 || i === points.length - 1
    || p[1] <= -50 || i % 3 === 0);
}

async function travel(g, to, label, { radius = 1.25, carryId = null } = {}) {
  const restoreDroppedCarry = async () => {
    if (carryId === null || (await observed(g)).carrying === carryId) return false;
    const fruit = await g.call('fruit.info', carryId);
    note('carry-dropped-en-route', { label, player: (await observed(g)).pos, fruit });
    check(fruit?.state === 'free', 'dropped carry remains a real recoverable fruit',
      JSON.stringify(fruit));
    await recoverMissedFruit(g, carryId);
    return true;
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    const from = (await observed(g)).pos;
    const route = await terrainRoute(g, [from[0], from[2]], to);
    note('route', { label, attempt, count: route.length, first: route[0], last: route.at(-1) });
    try {
      for (let i = 0; i < route.length; i++) {
        if (await restoreDroppedCarry()) throw new Error('replan after normal dropped-fruit recovery');
        if (dist((await observed(g)).pos, to) < radius) break;
        const point = route[i];
        await walkTo(g, point, { radius: 1.25, timeout: 22,
          from: i ? route[i - 1] : [from[0], from[2]] });
        if (await restoreDroppedCarry()) throw new Error('replan after normal dropped-fruit recovery');
      }
      await walkTo(g, to, { radius, timeout: 22 });
      if (await restoreDroppedCarry()) throw new Error('replan after normal dropped-fruit recovery');
      note('arrived', { label, pos: (await observed(g)).pos });
      return;
    } catch (e) {
      if (await restoreDroppedCarry()) {
        note('route-replan', { label, attempt, message: 'normal dropped-fruit recovery succeeded',
          pos: (await observed(g)).pos });
        continue;
      }
      note('route-replan', { label, attempt, message: String(e), pos: (await observed(g)).pos });
      if (attempt === 4) throw e;
    }
  }
}

async function waitFor(fn, label, timeout = 8000, interval = 100) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(interval);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function recoverMissedFruit(g, id) {
  await press(g, '1'); // bare hands for E recovery
  await sleep(1200); // watch the bounced fruit finish rolling before approaching
  let recovered = false;
  for (let i = 0; i < 7 && !recovered; i++) {
    const target = await g.call('fruit.info', id);
    check(target?.state === 'free', 'missed fruit stays free during pursuit', JSON.stringify(target));
    try {
      await walkTo(g, [target.pos[0], target.pos[2]], { radius: 2.5, timeout: 18 });
    } catch (e) {
      note('recovery-repath', { step: i, message: String(e),
        player: (await observed(g)).pos, fruit: (await g.call('fruit.info', id))?.pos });
      continue;
    }
    const current = await g.call('fruit.info', id);
    await aim(g, current.pos);
    const sight = await observed(g);
    note('recovery-sight', { step: i, player: sight.pos, target: current.pos,
      targetKind: sight.targetKind });
    if (sight.targetKind !== 'fruit') { await sleep(220); continue; }
    await press(g, 'e');
    recovered = (await observed(g)).carrying === id;
  }
  check(recovered, 'host recovers missed fruit by walking and pressing E',
    JSON.stringify({ host: await observed(g), fruit: await g.call('fruit.info', id) }));
}

async function stowRecoveredFruit(g, peer, id) {
  await lock(g);
  await g.page.mouse.click(201, 112, { button: 'right' });
  await waitFor(async () => (await observed(g)).basket.includes(id),
    'ordinary RMB basket stow after manual recovery');
  check((await g.call('fruit.info', id))?.state === 'stowed'
    && (await peer.call('fruit.info', id))?.state === 'stowed',
  'both peers see recovered fruit safely stowed in host basket');
}

let a, b, server;
try {
  server = await startServer();
  a = await openGame({ width: video ? 640 : 400, height: video ? 360 : 225,
    quiet: true, islandActivities: false, drawFrames: video,
    recordVideoDir: video ? out : null });
  b = await openSecondClient(a);
  // SETUP BOUNDARY: only here may a test position players or grant tools.
  for (const g of [a,b]) {
    await g.call('tool.give', 'shaker');
    await g.call('tool.give', 'net');
    await g.call('ragdoll.recover');
  }
  const at = async (g, x, z) => g.tp(x, await g.terrainHeight(x,z) + 0.1, z);
  const room = `vinecoop${Math.floor(Math.random() * 1e8)}`;
  await a.call('net.connect', room, 0);
  await b.call('net.connect', room, 0);
  await sleep(2800);
  const na = (await a.state()).net, nb = (await b.state()).net;
  check(na.isHost !== nb.isHost && na.hostId === nb.hostId,
    'two pages elect one shared host', JSON.stringify({ na, nb }));
  if (!na.isHost) [a,b] = [b,a];
  if (recoveryProbe) {
    // Standalone attempt starts from equivalent shelf/releaser positions;
    // all subsequent release, miss, pursuit and pickup use normal controls.
    await at(a, 11.2, -55.3);
    await at(b, 20, -56);
    const plant = await a.call('plant.nearest', SITE[0], 7, SITE[1], 'vinebombVine', true);
    const id = await a.call('fruit.nodeOf', plant.id, 0);
    await lock(a); await lock(b);
    await aim(a, [15.5, 2.5, -56.9]);
    await press(a, '3'); await press(b, '2');
    check((await a.call('fruit.info', id))?.state === 'attached',
      'recovery probe starts with attached fruit');
    const beforeNet = await a.call('tool.debug', 'net');
    await a.page.bringToFront();
    await a.page.mouse.down(); await sleep(80); await a.page.mouse.up();
    await b.page.bringToFront();
    await b.page.mouse.down({ button: 'right' });
    await sleep(100); await b.page.mouse.up({ button: 'right' });
    await waitFor(async () => (await a.call('fruit.info', id))?.state === 'free',
      'client releases fruit after early host miss', 6000);
    await sleep(1900);
    const landed = await a.call('fruit.info', id);
    const ground = await a.terrainHeight(landed.pos[0], landed.pos[2]);
    check(landed.state === 'free' && (await b.call('fruit.info', id))?.state === 'free'
      && ground > 0.4 && landed.pos[1] >= ground - 0.5,
    'probe miss leaves fruit free and dry on both peers', JSON.stringify({ landed, ground }));
    check((await a.call('tool.debug', 'net')).swings === beforeNet.swings + 1,
      'probe uses exactly one early host net swing');
    await recoverMissedFruit(a, id);
    await waitFor(async () => (await b.call('fruit.info', id))?.state === 'carried',
      'client sees recovered probe fruit carried');
    await stowRecoveredFruit(a, b, id);
    throw new Error('recovery probe stopped after ordinary E pickup');
  }
  if (lowerReleaseProbe) {
    // Independent ordinary-input reach probe from the dry lower shelf.
    await at(a, 20, -56);
    await sleep(1200);
    const plant = await a.call('plant.nearest', SITE[0], 7, SITE[1], 'vinebombVine', true);
    const id = await a.call('fruit.nodeOf', plant.id, 0);
    check((await a.call('fruit.info', id))?.state === 'attached',
      'lower-shelf probe starts attached');
    await lock(a);
    await press(a, '2');
    const before = await observed(a);
    await a.page.mouse.click(201, 112, { button: 'right' });
    await waitFor(async () => (await a.call('fruit.info', id))?.state === 'free',
      'ordinary lower-shelf Tree Shaker release', 6000);
    check((await b.call('fruit.info', id))?.state === 'free',
      'client sees lower-shelf release');
    note('lower-shelf-release', { before: before.pos,
      fruit: await a.call('fruit.info', id) });
    throw new Error('lower-shelf release probe stopped after ordinary RMB');
  }
  if (returnProbe) {
    // This standalone movement probe has a new initial setup boundary. It
    // begins on the dock and uses only ordinary input for the whole return.
    const dock = (await a.call('world.info')).sellPad;
    await at(b, dock[0], dock[2]);
    await sleep(500);
    await travel(b, EAST_SHOULDER, 'probe dock to east shoulder', { radius: 4 });
    await travel(b, RELEASE, 'probe east shoulder to vine', { radius: 4 });
    const plant = await a.call('plant.nearest', SITE[0], 7, SITE[1], 'vinebombVine', true);
    const returned = (await observed(b)).pos;
    check(Math.hypot(returned[0] - plant.pos[0], returned[1] - plant.pos[1],
      returned[2] - plant.pos[2]) < 8,
    'ordinary dock return ends inside real shaker reach', JSON.stringify(returned));
    throw new Error('return probe stopped after ordinary dock-to-vine walk');
  }
  // Position the catcher first. The host's allowed initial setup placement
  // happens last so the north-shoulder releaser has not slid below the shaker
  // force threshold by the time the ordinary RMB release begins.
  await at(b, CATCH[0], CATCH[1]);
  await sleep(700);
  const plant = await a.call('plant.nearest', SITE[0], 7, SITE[1], 'vinebombVine', true);
  check(plant?.pos?.[0] === SITE[0] && plant?.pos?.[2] === SITE[1],
    'authored existing Vinebomb site identified', JSON.stringify(plant));
  const nodeFruit = () => a.call('fruit.nodeOf', plant.id, 0);
  const fruitInfo = (g, id) => g.call('fruit.info', id);
  const firstId = await nodeFruit();
  const firstRecipe = await fruitInfo(a, firstId);
  check(firstId > 0 && firstRecipe?.state === 'attached',
    'attempt 1 starts with attached fruit', String(firstId));
  // Both pages are locked and aimed before a launch; switching tabs does not
  // change either player's yaw. Tool selection itself is a real number key.
  await lock(a); await lock(b);
  await aim(b, [15.5, 2.5, -56.9]);
  await press(a, '2'); // Tree Shaker
  await press(b, '3'); // Catch Net
  await at(a, RELEASE[0], RELEASE[1]);
  await aim(a, [SITE[0], 4, SITE[1]]);
  note('setup-complete', { firstId, host: (await observed(a)).pos, client: (await observed(b)).pos });
  await b.page.evaluate(id => {
    const game = window.__GAME, net = game.get('tools').toolOf('net');
    window.__coopNetOutcomes = [];
    game.bus.on('ui:toast', e => {
      if (e.text === 'CAUGHT' || e.text === 'MISSED') window.__coopNetOutcomes.push(e.text);
    });
    const trace = window.__coopTrace = { rows: [], active: true };
    const sample = () => {
      if (!trace.active) return;
      const f = game.get('fruit').get(id);
      if (f && trace.rows.length < 300) trace.rows.push({
        t: +game.clock.elapsed.toFixed(3), state: f.state,
        f: f.position.toArray().map(x => +x.toFixed(2)),
        h: net.hoop.toArray().map(x => +x.toFixed(2)),
        d: +f.position.distanceTo(net.hoop).toFixed(2),
        phase: net.phase, active: net.active,
      });
      requestAnimationFrame(sample);
    };
    sample();
  }, firstId);

  // Attempt 1: observe the incoming fruit, then swing when it reaches the
  // approach marker. The cue is read-only; release and swing are real mouse
  // inputs, and neither player needs a prescribed series of tool presses.
  // Keep the catcher foreground throughout. Switching tabs between seeing the
  // flight and swinging costs a large, variable slice of a video-rendered run.
  await b.page.bringToFront();
  await a.page.mouse.down({ button: 'right' });
  await a.page.mouse.up({ button: 'right' });
  // Watch inside Chromium's own animation frame, avoiding a slow cross-page
  // round trip for every sample while the fruit closes on the hoop.
  await b.page.waitForFunction(id => {
    const f = window.__GAME.get('fruit').get(id);
    return f?.state === 'free' && f.position.x <= 17.5;
  }, firstId, { polling: 'raf', timeout: 6000 });
  note('net-cue', { id: firstId, thresholdX: 17.5 });
  await b.page.mouse.down();
  await sleep(680);
  await b.page.mouse.up();
  const trace = await b.page.evaluate(() => {
    window.__coopTrace.active = false;
    return window.__coopTrace.rows;
  });
  writeFileSync(path.join(out, `flight-${runId}.json`), JSON.stringify(trace, null, 2));
  note('flight-trace', { rows: trace.length,
    minActive: Math.min(...trace.filter(r => r.active && r.state === 'free').map(r => r.d)),
    minInactive: Math.min(...trace.filter(r => !r.active && r.state === 'free').map(r => r.d)),
    near: trace.filter(r => r.state === 'free' && r.d < 2.2).slice(0, 12) });
  note('first-flight-debug', { hostFruit: await fruitInfo(a, firstId), clientFruit: await fruitInfo(b, firstId),
    net: await b.call('tool.debug', 'net'), hostTool: (await a.state()).tools,
    host: await observed(a), catcher: await observed(b) });
  const held1 = await waitFor(async () => {
    const s = await observed(b);
    return s.basket.includes(firstId) ? s : null;
  }, 'client net catch', 5500);
  note('attempt-1-caught', { id: firstId, holder: 'client', basket: held1.basket });
  await waitFor(async () => (await fruitInfo(a, firstId))?.state === 'stowed'
    && (await fruitInfo(b, firstId))?.state === 'stowed', 'both peers stowed fruit');
  const netOutcome = await b.call('tool.debug', 'net');
  const outcomeToasts = await b.page.evaluate(() => window.__coopNetOutcomes);
  check(netOutcome.caught >= 1 && netOutcome.misses === 0,
    'client net records a catch without miss recovery', JSON.stringify(netOutcome));
  check(outcomeToasts.filter(x => x === 'CAUGHT').length === 1
    && !outcomeToasts.includes('MISSED'),
  'client sees one confirmed CAUGHT cue and no contradictory MISSED cue', JSON.stringify(outcomeToasts));

  if (probe) throw new Error('probe stopped after first catch');
  if (clientStepProbe) {
    await travel(b, RELEASE, 'probe catcher walks into shaker reach', { radius: 4 });
    const position = (await observed(b)).pos;
    check(Math.hypot(position[0] - plant.pos[0], position[1] - plant.pos[1],
      position[2] - plant.pos[2]) < 8,
    'net catcher walks into real shaker reach', JSON.stringify(position));
    throw new Error('client step probe stopped after ordinary shelf walk');
  }

  // The host leaves the vine so its normal 95-190 s regrowth can run. The
  // catcher keeps the first fruit stowed locally, avoiding a forced roundtrip
  // to the distant dock between harvests. No debug regeneration/teleport.
  await travel(a, WAIT, 'host clears vine for regrowth', { radius: 3 });
  check(dist((await observed(a)).pos, SITE) > 18,
    'host genuinely leaves the vine regrowth exclusion radius');
  if (routeProbe) throw new Error('route probe stopped after ordinary host escape');
  await travel(b, RELEASE, 'client takes releaser position', { radius: 4 });
  check((await observed(b)).basket.includes(firstId),
    'client retains first netted fruit while taking the second job');

  // Wait for natural regrowth while the authoritative player is away.
  const secondId = await waitFor(async () => {
    const id = await nodeFruit();
    return id > 0 && id !== firstId ? id : null;
  }, 'natural vine regrowth', 210_000, 1000);
  const secondRecipe = await fruitInfo(a, secondId);
  check(secondRecipe?.species === 'vinebomb' && secondRecipe?.mass === firstRecipe.mass
    && secondRecipe?.variant === firstRecipe.variant && secondRecipe?.value === firstRecipe.value,
  'natural regrowth preserves ordinary catchable recipe',
  JSON.stringify({ first: firstRecipe, second: secondRecipe }));
  note('natural-regrowth', { old: firstId, next: secondId });
  const releaserPos = (await observed(b)).pos;
  check(Math.hypot(releaserPos[0] - plant.pos[0], releaserPos[1] - plant.pos[1],
    releaserPos[2] - plant.pos[2]) < 8,
  'client stays inside real Tree Shaker reach', JSON.stringify(releaserPos));
  await travel(a, CATCH, 'host returns to intercept', { radius: 3 });
  const interceptorPos = (await observed(a)).pos;
  check(dist(interceptorPos, [15.5, -57.8]) < 8
    && await a.terrainHeight(interceptorPos[0], interceptorPos[2]) > 0.4,
  'host returns to dry interception shelf', JSON.stringify(interceptorPos));
  await aim(b, [SITE[0], 4, SITE[1]]);
  await aim(a, [15.5, 2.5, -56.9]);
  await press(b, '2'); // client Tree Shaker
  await press(a, '3'); // host Catch Net
  check((await fruitInfo(a, secondId))?.state === 'attached'
    && (await fruitInfo(b, secondId))?.state === 'attached',
  'attempt 2 starts with matching attached fruit', String(secondId));

  // Attempt 2: an intentionally early single net swing misses. The fruit
  // stays in the world; the host walks to it, grabs with E, and sells it.
  const netBefore = await a.call('tool.debug', 'net');
  await a.page.bringToFront();
  await a.page.mouse.down();
  await sleep(80);
  await a.page.mouse.up();
  await b.page.bringToFront();
  await b.page.mouse.down({ button: 'right' });
  await sleep(100);
  await b.page.mouse.up({ button: 'right' });
  const free2 = await waitFor(async () => {
    const f = await fruitInfo(a, secondId);
    return f?.state === 'free' ? f : null;
  }, 'missed fruit remains free', 5500);
  await sleep(1900);
  const landed = await fruitInfo(a, secondId);
  check(landed?.state === 'free' && (await fruitInfo(b, secondId))?.state === 'free',
    'miss remains recoverable and peers agree on free state', JSON.stringify(landed));
  const recoveryGround = await a.terrainHeight(landed.pos[0], landed.pos[2]);
  check(recoveryGround > 0.4 && landed.pos[1] >= recoveryGround - 0.5,
    'miss lands on dry walkable terrain', JSON.stringify({ ground: recoveryGround, pos: landed.pos }));
  note('attempt-2-missed', { id: secondId, from: free2.pos, landed: landed.pos,
    netMisses: (await a.call('tool.debug', 'net')).misses - netBefore.misses });
  check((await a.call('tool.debug', 'net')).swings === netBefore.swings + 1,
    'host attempted exactly one early net swing before recovering the miss');

  await recoverMissedFruit(a, secondId);
  await waitFor(async () => (await fruitInfo(b, secondId))?.state === 'carried',
    'client sees recovered fruit carried');
  note('attempt-2-recovered', { id: secondId, pos: (await observed(a)).pos });
  await stowRecoveredFruit(a, b, secondId);
  check((await fruitInfo(a, firstId))?.state === 'stowed'
    && (await fruitInfo(b, firstId))?.state === 'stowed'
    && (await observed(b)).basket.includes(firstId),
  'first caught fruit stays separately stowed through second attempt');

  // Both completed harvests take one ordinary one-way trip to the dock. Sell
  // the netted fruit first, then the manually recovered fruit, so each payout
  // has its own before/after authority check and repeat-E duplication check.
  const pad = (await a.call('world.info')).sellPad;
  const before1 = (await a.state()).economy;
  await travel(b, [pad[0], pad[2]], 'client carries first catch to sell pad', { radius: 4 });
  check((await b.state()).interaction.nearSellPad, 'client reaches sell pad by walking');
  await press(b, 'e');
  await waitFor(async () => (await a.state()).economy.sold > before1.sold,
    'first sale on host');
  await sleep(450);
  const after1 = (await a.state()).economy;
  check(after1.sold - before1.sold === 1 && after1.lifetime > before1.lifetime,
    'first sale credits exactly one fruit', JSON.stringify({ before1, after1 }));
  check((await b.state()).economy.money === after1.money
    && (await fruitInfo(a, firstId)) === null && (await fruitInfo(b, firstId)) === null
    && await a.call('net.sold', firstId)
    && (await fruitInfo(a, secondId))?.state === 'stowed'
    && (await observed(a)).basket.includes(secondId),
  'both peers agree first fruit sold while recovered second remains stowed');
  await press(b, 'e');
  await sleep(350);
  check((await a.state()).economy.money === after1.money,
    'repeated normal E press cannot pay first fruit twice');
  await closeShopAndCheckHud(b, after1.money,
    'client closes Merv and shows first shared payout in live HUD');
  note('attempt-1-sold', { id: firstId, credited: after1.lifetime - before1.lifetime });

  const before2 = (await a.state()).economy;
  await travel(a, [pad[0], pad[2]], 'host carries recovered fruit to the sell pad', { radius: 4 });
  check((await a.state()).interaction.nearSellPad, 'host reaches sell pad by walking');
  check((await observed(a)).basket.includes(secondId),
    'host still has recovered fruit stowed at sell pad');
  await press(a, 'e');
  await waitFor(async () => (await a.state()).economy.sold > before2.sold, 'second sale on host');
  await sleep(400);
  const after2 = (await a.state()).economy;
  check(after2.sold - before2.sold === 1 && after2.lifetime > before2.lifetime,
    'recovered fruit pays exactly once', JSON.stringify({ before2, after2 }));
  check((await b.state()).economy.money === after2.money
    && (await fruitInfo(a, secondId)) === null && (await fruitInfo(b, secondId)) === null
    && await a.call('net.sold', secondId),
  'both peers agree on sold recovered fruit and shared money');
  await press(a, 'e'); await sleep(350);
  check((await a.state()).economy.money === after2.money,
    'repeated normal E press cannot pay recovered fruit twice');
  await closeShopAndCheckHud(a, after2.money,
    'host closes Merv and shows final shared payout in live HUD');
  await closeShopAndCheckHud(b, after2.money,
    'client live HUD agrees on final shared payout');
  note('attempt-2-sold', { id: secondId, credited: after2.lifetime - before2.lifetime });
} catch (e) {
  note('error', { message: String(e.stack ?? e) });
  process.exitCode = 1;
} finally {
  const errors = [a?.consoleErrors ?? [], b?.consoleErrors ?? []];
  try {
    if (video && a?.ctx) {
      const videoA = a.page.video(), videoB = b.page.video();
      await a.ctx.close();
      if (videoA) {
        const file = path.join(out, `host-${runId}.webm`);
        renameSync(await videoA.path(), file); videoFiles.push(file);
      }
      if (videoB) {
        const file = path.join(out, `client-${runId}.webm`);
        renameSync(await videoB.path(), file); videoFiles.push(file);
      }
    }
  } catch (e) { note('video-error', { message: String(e) }); process.exitCode = 1; }
  if (a?.browser) await a.browser.close().catch(() => {});
  if (server?.proc) server.proc.kill();
  const report = JSON.stringify({
    transport: 'same-machine BroadcastChannel; internet co-op not tested',
    input: 'debug setup before attempts; trusted keyboard/mouse thereafter',
    checks, events, errors, videoFiles,
  }, null, 2) + '\n';
  writeFileSync(path.join(out, `report-${runId}.json`), report);
  writeFileSync(path.join(out, 'report.json'), report);
}
