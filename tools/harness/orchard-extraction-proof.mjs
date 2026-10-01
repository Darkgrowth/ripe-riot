/**
 * Remote Linux proof of Orchard Run's ordinary harvest / haul / bank loop.
 *
 * Core gameplay uses trusted keyboard/mouse input only. Debug reads observe
 * authored fruit, terrain, targets and the ledger; they never spawn cargo,
 * teleport, change aim, synthesize input, pay money or finish the run.
 *
 * --logic-only suppresses GPU draws between explicit normal-camera captures.
 * The actual rAF, fixed steps, physics, UI and network still run. This mode
 * proves gameplay state, not continuously rendered performance or pacing.
 * --coop adds a separate, explicitly staged room-connect setup, followed by
 * ordinary guest picking, walking and banking of another authored fruit.
 *
 * Never run on the user's Windows desktop, even with --allow-browser-input.
 * Example on an isolated Ubuntu runner with Xvfb:
 * RIPE_URL=http://127.0.0.1:5278 xvfb-run -a node \
 *   tools/harness/orchard-extraction-proof.mjs --allow-browser-input --headed \
 *   --logic-only --coop --out capture/ci/orchard-extraction
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
if (!args.includes('--allow-browser-input'))
  throw new Error('Remote browser input requires --allow-browser-input.');
if (process.platform !== 'linux'
  || !(process.env.GITHUB_ACTIONS === 'true' || process.env.RIPE_REMOTE_LINUX_PROOF === '1'))
  throw new Error('Orchard proof is restricted to an isolated remote Linux runner; Windows pointer input is prohibited.');
if (!args.includes('--headed') || !process.env.DISPLAY)
  throw new Error('Use --headed under Xvfb: Linux headless pointer lock does not supply ordinary look deltas.');
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1];
};
const width = Number(option('--width', '1712'));
const height = Number(option('--height', '634'));
const maxSeconds = Number(option('--seconds', '1800'));
const logicOnly = args.includes('--logic-only');
const withCoop = args.includes('--coop');
const base = process.env.RIPE_URL;
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base))
  throw new Error('Set RIPE_URL to the isolated remote preview server on 127.0.0.1.');
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 180
  || !Number.isFinite(maxSeconds) || maxSeconds < 60 || maxSeconds > 3600)
  throw new Error('Use a viewport of at least 320x180 and --seconds from 60 to 3600.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(root, option('--out', 'capture/ci/orchard-extraction'));
mkdirSync(out, { recursive: true });
const start = Date.now(), deadline = start + maxSeconds * 1000;
const timeline = [], checks = [], errors = [], warnings = [], captures = [];
let stage = 'boot', failure = null, finalState = null;
let ordinaryResult = null, coopResult = null;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const angleDelta = a => Math.atan2(Math.sin(a), Math.cos(a));
const alive = () => Date.now() < deadline;
function log(kind, data = {}) {
  const row = { wallSeconds: +((Date.now() - start) / 1000).toFixed(2), stage, kind, ...data };
  timeline.push(row); console.log(JSON.stringify(row));
}
function check(condition, name, detail = {}) {
  checks.push({ pass: !!condition, name, detail });
  log(condition ? 'pass' : 'fail', { name, detail });
  if (!condition) throw new Error(name);
}

const browser = await chromium.launch({ headless: false, args: [
  '--disable-dev-shm-usage', '--mute-audio', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
] });
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1,
  ...(args.includes('--video') ? { recordVideo: { dir: out, size: { width, height } } } : {}) });
const clients = [];

async function makeClient(label, saveSlot) {
  const page = await context.newPage();
  const client = { page, label, saveSlot, mouseX: width / 2, mouseY: height / 2,
    authoredIds: [], events: [], bankTransactions: [], last: null };
  clients.push(client);
  page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`${label}: ${m.text()}`);
    if (m.type() === 'warning') warnings.push(`${label}: ${m.text()}`);
  });
  // A fresh browser context and never-used slot give a real title/front door.
  // The game's explicit ?fresh=1 shortcut intentionally bypasses that title.
  await boot(client, true, true);
  return client;
}

async function boot(c, fresh, showTitle = false) {
  await c.page.goto(`${base}/?orchardRun=1&saveSlot=${encodeURIComponent(c.saveSlot)}${fresh && !showTitle ? '&fresh=1' : ''}`,
    { waitUntil: 'domcontentloaded', timeout: 45000 });
  await c.page.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR,
    null, { timeout: 120000 });
  const bootError = await c.page.evaluate(() => window.__RIPE_ERROR ?? null);
  if (bootError) throw new Error(`${c.label} boot failed: ${bootError}`);
  if (logicOnly) await c.page.evaluate(() => {
    const renderer = window.__GAME.renderer;
    window.__RIPE_HARNESS_DRAW = renderer.render.bind(renderer);
    renderer.render = () => {};
  });
  await c.page.evaluate(() => {
    const g = window.__GAME;
    const observer = window.__orchardProof = { events: [] };
    for (const name of ['encounter:attack', 'encounter:defeated', 'encounter:capture',
      'fruit:detached', 'fruit:grabbed', 'fruit:claimed', 'fruit:sold', 'fruit:destroyed',
      'player:ragdoll', 'player:recovered', 'player:downed', 'player:revived',
      'money:changed', 'tool:swing', 'tool:fired', 'tool:blast', 'ui:toast', 'plant:shaken'])
      g.bus.on(name, payload => observer.events.push({ name,
        gameSeconds: g.clock.elapsed, payload: JSON.parse(JSON.stringify(payload)) }));
  });
  const s = await read(c);
  if (fresh) c.authoredIds = s.fruit.map(f => f.id);
  log('boot', { client: c.label, fresh, mode: s.orchardRun, extraction: s.extraction,
    save: s.save, shell: s.shell, authoredCount: c.authoredIds.length, gpu: s.gpu });
  return s;
}

async function read(c) {
  const s = await c.page.evaluate(() => {
    const g = window.__GAME, p = g.player, i = g.get('interaction');
    const f = g.get('fruit'), w = g.get('world'), net = g.get('net');
    const gl = g.renderer.renderer.getContext();
    const rendererInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const shell = document.querySelector('.orchard-shell');
    const extraction = g.get('extraction');
    return { pos: p.position.toArray(), eye: p.eyePosition.toArray(), yaw: p.yaw, pitch: p.pitch,
      playerState: p.state, health: g.get('vitals').health, downed: g.get('vitals').downed,
      synthetic: g.input.synthetic !== null, locked: g.input.pointerLocked,
      sensitivity: g.input.sensitivity, invertY: g.input.invertY,
      gameSeconds: g.clock.elapsed, orchardRun: !!w.orchardRun,
      visualMode: window.__RIPE_VISUAL_MODE,
      spawn: w.spawnPoint.toArray(), crate: w.sellPad.toArray(),
      safeRadius: w.safeRadius, sellRadius: w.sellRadius,
      carried: i.carried?.fruit.id ?? null, heavy: i.carried?.heavy ?? false,
      basket: i.basket.items.map(x => x.id), basketCapacity: i.basket.capacity,
      targetKind: i.targetKind, targetId: i.target?.id ?? null,
      targetPlantId: i.targetPlantId, prompt: i.promptText, nearCrate: i.nearSellPad,
      money: g.get('economy').money, activeTool: g.get('tools').activeId,
      cannonFires: g.get('tools').all.get('aircannon')?.fires ?? 0,
      extraction: { ...extraction.netState(), target: extraction.target,
        targetReached: extraction.targetReached, fruitCount: extraction.fruitCount },
      encounters: g.get('encounters').snapshot(),
      agitation: g.get('director').getAgitationPresentation(),
      fruit: [...f.fruits.values()].filter(x => x.state !== 'gone').map(x => ({
        id: x.id, species: x.species, pos: x.position.toArray(), state: x.state,
        speed: x.speed, radius: x.radius, diameter: x.diameter, mass: x.mass,
        value: x.value(), stuckHands: x.stuckHands, inflate: x.inflate,
        plant: x.attach?.plantId ?? null,
      })),
      plants: [...f.plants.all()].map(x => ({ id: x.id, pos: x.position.toArray(), type: x.type })),
      net: { connected: net.connected, isHost: net.isHost, me: net.me,
        authoritative: net.authoritative, remotes: [...net.remotes.keys()] },
      save: window.__RIPE.state().save,
      shell: { visible: shell instanceof HTMLElement && !shell.hidden,
        text: shell?.textContent ?? '', mode: g.get('orchardShell').mode },
      events: window.__orchardProof?.events.splice(0) ?? [],
      gpu: rendererInfo ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL) : 'unavailable',
    };
  });
  if (s.synthetic) throw new Error(`${c.label}: synthetic input invalidates ordinary-input proof`);
  if (!s.orchardRun) throw new Error(`${c.label}: ordinary expedition booted instead of Orchard Run`);
  for (const event of s.events) {
    c.events.push(event);
    if (['fruit:sold', 'encounter:defeated', 'player:downed', 'player:recovered'].includes(event.name))
      log('event', { client: c.label, event });
  }
  c.last = s; return s;
}

async function selectorClick(c, selector) {
  const b = await c.page.evaluate(selector => {
    const e = document.querySelector(selector);
    if (!(e instanceof HTMLElement) || e.hidden || getComputedStyle(e).display === 'none')
      throw new Error(`Missing visible button ${selector}`);
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) throw new Error(`Zero-size button ${selector}`);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  await c.page.mouse.click(b.x, b.y); await sleep(150);
}

async function play(c) {
  await c.page.bringToFront();
  const s = await read(c);
  if (s.shell.visible) {
    const resume = await c.page.locator('[data-orchard-action="resume"]').isVisible();
    await selectorClick(c, `[data-orchard-action="${resume ? 'resume' : 'play'}"]`);
  }
  await c.page.waitForFunction(() => document.querySelector('.orchard-shell')?.hidden,
    null, { timeout: 15000 });
  await lock(c); return read(c);
}

async function lock(c) {
  if (await c.page.evaluate(() => !!document.pointerLockElement)) return;
  await c.page.mouse.click(width / 2, height / 2);
  await c.page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 8000 });
  await c.page.mouse.move(++c.mouseX, c.mouseY); await sleep(80);
}

async function aim(c, point) {
  await lock(c);
  for (let n = 0; n < 20 && alive(); n++) {
    const s = await read(c), dx = point[0] - s.eye[0], dz = point[2] - s.eye[2];
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(point[1] - s.eye[1], Math.hypot(dx, dz));
    const dyaw = angleDelta(yaw - s.yaw), dpitch = pitch - s.pitch;
    if (Math.abs(dyaw) < .019 && Math.abs(dpitch) < .019) return true;
    const sensitivity = s.sensitivity || .0022;
    c.mouseX += Math.max(-150, Math.min(150, -dyaw / sensitivity));
    c.mouseY += Math.max(-110, Math.min(110, -dpitch / (sensitivity * (s.invertY ? -1 : 1))));
    await c.page.mouse.move(c.mouseX, c.mouseY); await sleep(75);
  }
  log('aim-missed', { client: c.label, point, state: { yaw: c.last?.yaw, pitch: c.last?.pitch } });
  return false;
}

async function press(c, key, heldMs = 100) {
  await c.page.keyboard.down(key); await sleep(heldMs); await c.page.keyboard.up(key);
  await sleep(100);
}
async function click(c, heldMs = 120, button = 'left') {
  await c.page.mouse.down({ button }); await sleep(heldMs); await c.page.mouse.up({ button });
  await sleep(150);
}

async function recover(c, s) {
  if (s.playerState === 'captured') { await press(c, 'e', 1600); return; }
  if (s.downed || s.playerState === 'downed') { await press(c, 'h', 5000); return; }
  await sleep(250);
}

async function go(c, point, radius = 1.2, seconds = 40, sprint = true) {
  const until = Math.min(deadline, Date.now() + seconds * 1000);
  let stuck = 0;
  log('waypoint', { client: c.label, point, radius });
  while (alive() && Date.now() < until) {
    const s = await read(c), d = distance(s.pos, point);
    if (d <= radius) return true;
    if (s.playerState !== 'active') { await recover(c, s); continue; }
    if (!await aim(c, [point[0], s.eye[1] - .04 * d, point[2]])) return false;
    await c.page.keyboard.down('w');
    if (sprint && !s.heavy) await c.page.keyboard.down('Shift');
    await sleep(Math.min(240, Math.max(75, (d - radius) / (s.heavy ? 2.6 : sprint ? 8.4 : 5.4) * 1000)));
    await c.page.keyboard.up('w'); await c.page.keyboard.up('Shift');
    const next = await read(c);
    const vx = next.pos[0] - s.pos[0], vz = next.pos[2] - s.pos[2], lengthSq = vx * vx + vz * vz;
    const along = lengthSq > 0 ? Math.max(0, Math.min(1,
      ((point[0] - s.pos[0]) * vx + (point[2] - s.pos[2]) * vz) / lengthSq)) : 0;
    if (Math.hypot(point[0] - s.pos[0] - vx * along, point[2] - s.pos[2] - vz * along) <= radius) return true;
    stuck = distance(s.pos, next.pos) < .15 ? stuck + 1 : 0;
    if (stuck >= 3) {
      const side = stuck % 2 ? 'a' : 'd';
      log('ordinary-obstacle-recovery', { client: c.label, pos: next.pos, point, stuck });
      await c.page.keyboard.down(side); await press(c, 'Space', 180);
      await c.page.keyboard.up(side);
      if (stuck > 10) break;
    }
  }
  log('waypoint-missed', { client: c.label, point, pos: c.last?.pos }); return false;
}

async function shot(c, name, observation = {}) {
  // Freeze only for readback. No pose, camera, interaction or gameplay value
  // changes; the picture uses the same first-person camera as ordinary play.
  const before = await read(c);
  const wasPaused = await c.page.evaluate(() => {
    const g = window.__GAME, paused = g.clock.paused;
    g.clock.paused = true;
    if (window.__RIPE_HARNESS_DRAW) window.__RIPE_HARNESS_DRAW();
    else g.renderer.render();
    return paused;
  });
  try {
    await c.page.screenshot({ path: path.join(out, `${name}.png`), timeout: 45000 });
    captures.push({ name, client: c.label, pos: before.pos, yaw: before.yaw,
      pitch: before.pitch, gameSeconds: before.gameSeconds, extraction: before.extraction,
      camera: 'ordinary first-person', frozenOnlyForReadback: true, ...observation });
    log('capture', { name, client: c.label, pos: before.pos, ...observation });
  } finally {
    await c.page.evaluate(paused => { window.__GAME.clock.paused = paused; }, wasPaused);
  }
}

async function takeFruit(c, id) {
  if (!c.authoredIds.includes(id)) throw new Error(`Non-authored cargo ${id} selected`);
  for (let attempt = 0; attempt < 7 && alive(); attempt++) {
    let s = await read(c);
    if (s.carried === id || s.basket.includes(id)) return true;
    const f = s.fruit.find(x => x.id === id);
    if (!f || !['attached', 'free'].includes(f.state)) return false;
    if (s.playerState !== 'active') { await recover(c, s); continue; }
    if (s.carried !== null) {
      const held = s.fruit.find(x => x.id === s.carried);
      if (held?.stuckHands > 0) await sleep(Math.ceil(held.stuckHands * 1000) + 120);
      if (s.heavy || s.basket.length >= s.basketCapacity) return false;
    }
    const d = Math.max(.01, distance(s.pos, f.pos));
    const approachAngle = Math.atan2(s.pos[2] - f.pos[2], s.pos[0] - f.pos[0])
      + (attempt === 0 ? 0 : (attempt % 2 ? 1 : -1) * Math.ceil(attempt / 2) * .6);
    const standDistance = Math.max(1.35, f.radius + 1);
    const stand = [f.pos[0] + Math.cos(approachAngle) * standDistance,
      0, f.pos[2] + Math.sin(approachAngle) * standDistance];
    if (d > 2.4 || attempt > 0) {
      if (!await go(c, stand, .65, 25, false)) continue;
      s = await read(c);
    }
    const current = s.fruit.find(x => x.id === id);
    if (!current) return false;
    await aim(c, current.pos); await sleep(150);
    s = await read(c);
    if (s.targetKind === 'fruit' && s.targetId === id) {
      await press(c, 'e'); s = await read(c);
      log('ordinary-pick', { client: c.label, id, species: current.species,
        source: current.state, carried: s.carried, basket: s.basket, pos: s.pos });
      if (s.carried === id || s.basket.includes(id)) return true;
    } else {
      log('pick-target-missed', { client: c.label, id, attempt,
        targetKind: s.targetKind, targetId: s.targetId, prompt: s.prompt, pos: s.pos, fruit: current });
    }
  }
  return false;
}

async function bank(c, captureName = null) {
  stage = `${c.label}-haul-bank`;
  let s = await read(c);
  const ids = [...s.basket, ...(s.carried === null ? [] : [s.carried])];
  if (!ids.length) return false;
  check(ids.every(id => c.authoredIds.includes(id)), 'only authored cargo is carried', { client: c.label, ids });
  // Enter the bin through its open +Z side, avoiding its low side boards.
  if (!await go(c, [s.crate[0], 0, s.crate[2] + 3.1], 1.1, 50)) return false;
  if (!await go(c, [s.crate[0], 0, s.crate[2] + 2.5], .45, 15, false)) return false;
  await sleep(180); s = await read(c);
  if (s.targetKind !== 'sell') { log('missing-bank-target', { client: c.label, state: s }); return false; }
  const before = s.extraction.banked, wallet = s.money;
  await aim(c, [s.crate[0], s.crate[1] + 1, s.crate[2]]);
  await press(c, 'e');
  const until = Math.min(deadline, Date.now() + 10000);
  do { await sleep(150); s = await read(c); } while (s.extraction.banked <= before && Date.now() < until);
  const secured = s.extraction.secured.filter(([id]) => ids.includes(id));
  check(s.extraction.banked > before && s.carried === null && !s.basket.length,
    'ordinary E banks physical carried cargo', { client: c.label, ids, before,
      after: s.extraction.banked, walletBefore: wallet, walletAfter: s.money, secured });
  c.bankTransactions.push({ ids, before, after: s.extraction.banked,
    walletBefore: wallet, walletAfter: s.money, secured });
  if (captureName) await shot(c, captureName);
  return true;
}

async function stirAndSubdue(c) {
  stage = 'ordinary-harvest-escalation';
  let s = await read(c);
  const loaded = s.plants.find(p => distance(p.pos, [-23, 0, 27]) < .1);
  if (!loaded) throw new Error('Authored loaded tree missing');
  check(await go(c, [loaded.pos[0] + 2.1, 0, loaded.pos[2]], .5, 50, false),
    'ordinary walking reaches loaded tree');
  await aim(c, [loaded.pos[0], loaded.pos[1] + .65, loaded.pos[2]]);
  let sawShake = false;
  for (let i = 0; i < 8; i++) {
    s = await read(c);
    if (s.targetKind === 'shake' && s.targetPlantId === loaded.id) {
      sawShake = true; await press(c, 'e');
    } else {
      await aim(c, [loaded.pos[0], loaded.pos[1] + .55, loaded.pos[2]]); await sleep(100);
    }
  }
  check(sawShake, 'loaded tree shakes using ordinary E');
  const until = Math.min(deadline, Date.now() + 14000);
  do {
    await sleep(140); s = await read(c);
  } while (!s.encounters.encounters.some(e => !e.dormant && e.kind === 'mimic') && Date.now() < until);
  const mimic = s.encounters.encounters.find(e => e.kind === 'mimic');
  check(mimic && !mimic.dormant, 'harvesting wakes Mimic through the director',
    { agitation: s.agitation, mimic });
  await aim(c, [mimic.position[0], mimic.position[1] + 1.1, mimic.position[2]]);
  await shot(c, '02-harvest-chaos', { encounters: s.encounters, agitation: s.agitation,
    looseFruit: s.fruit.filter(f => f.state === 'free').length });

  stage = 'ordinary-mallet-subdue';
  const bankedBefore = s.extraction.banked, walletBefore = s.money;
  await press(c, '1');
  const fightUntil = Math.min(deadline, Date.now() + 70000);
  let swings = 0;
  while (alive() && Date.now() < fightUntil) {
    s = await read(c);
    const m = s.encounters.encounters.find(e => e.kind === 'mimic');
    if (m.health === 0) break;
    if (s.playerState !== 'active') { await recover(c, s); continue; }
    const d = Math.max(.01, distance(s.pos, m.position));
    if (d > 2.75) {
      const stand = [m.position[0] + (s.pos[0] - m.position[0]) / d * 2.3,
        0, m.position[2] + (s.pos[2] - m.position[2]) / d * 2.3];
      await go(c, stand, .4, 10, false); s = await read(c);
    }
    const target = s.encounters.encounters.find(e => e.kind === 'mimic');
    await aim(c, [target.position[0], target.position[1] + 1.1, target.position[2]]);
    await click(c); swings++; await sleep(520);
    log('ordinary-mallet-swing', { swings, health: (await read(c)).encounters.encounters
      .find(e => e.kind === 'mimic').health });
  }
  s = await read(c);
  check(s.encounters.encounters.find(e => e.kind === 'mimic').health === 0,
    'real Picking Mallet subdues Mimic', { swings });
  check(s.extraction.banked === bankedBefore && s.money === walletBefore,
    'enemy defeat gives neither wallet money nor extracted cargo',
    { bankedBefore, bankedAfter: s.extraction.banked, walletBefore, walletAfter: s.money });
  await shot(c, '03-mimic-subdued-no-cash');
}

async function reachTarget(c) {
  stage = 'ordinary-cargo-target';
  const missed = new Set();
  for (let n = 0; n < 48 && alive(); n++) {
    let s = await read(c);
    if (s.extraction.targetReached) return s;
    if (s.carried !== null || s.basket.length) {
      check(await bank(c, '04-secured-cargo'), 'cargo haul reaches extraction crate');
      s = await read(c);
      if (s.extraction.targetReached) return s;
    }
    const candidates = s.fruit.filter(f => !missed.has(f.id)
      && c.authoredIds.includes(f.id) && ['attached', 'free'].includes(f.state)
      && f.mass <= 60 && f.diameter <= 1.1 && f.value > 0 && f.speed < 4)
      .sort((a, b) => (b.value / (distance(s.pos, b.pos) + 12))
        - (a.value / (distance(s.pos, a.pos) + 12)));
    if (!candidates.length) throw new Error('No reachable authored cargo remains before $500');
    const candidate = candidates[0];
    log('authored-cargo-choice', { candidate });
    if (!await takeFruit(c, candidate.id)) {
      missed.add(candidate.id); log('authored-cargo-missed', { id: candidate.id });
    }
  }
  return read(c);
}

async function ordinaryRun(c) {
  stage = 'ordinary-front-door';
  let s = await read(c);
  check(s.shell.visible && !s.extraction.finished, 'fresh Orchard Run title is visible');
  await play(c); s = await read(c);
  check(distance(s.pos, s.spawn) < 2 && s.extraction.banked === 0,
    'fresh run starts near extraction crate with empty ledger');
  await aim(c, [-23, s.eye[1] - 1.5, 25]); await shot(c, '00-clearing');
  // A quiet ordinary fruit proves the partial-bank path before danger or goal.
  const quiet = s.fruit.filter(f => f.species === 'apple' && distance(f.pos, [-15, 0, 32]) < 4)
    .sort((a, b) => a.pos[1] - b.pos[1]);
  let firstId = null;
  for (const f of quiet) if (await takeFruit(c, f.id)) { firstId = f.id; break; }
  check(firstId !== null, 'ordinary E picks real quiet-pocket fruit');
  check(await bank(c, '01-partial-bank'), 'ordinary walk and E secure a partial haul');
  s = await read(c);
  check(s.extraction.banked > 0 && s.extraction.banked < 500 && !s.extraction.finished,
    'partial bank is kept and harvesting can continue before $500', { extraction: s.extraction });
  await stirAndSubdue(c);
  s = await reachTarget(c);
  check(s.extraction.targetReached && s.extraction.banked >= 500,
    'authored physical cargo reaches the $500 target', { extraction: s.extraction });
  check(!s.extraction.finished, 'reaching $500 does not force departure');
  check(s.carried === null && !s.basket.length && s.nearCrate,
    'banked crew is empty-handed at the crate');
  const settled = { banked: s.extraction.banked, secured: s.extraction.secured,
    lost: s.extraction.lost, money: s.money };
  stage = 'ordinary-finish';
  await press(c, 'e'); await sleep(500); s = await read(c);
  check(s.extraction.finished && s.shell.visible,
    'empty-handed E at crate opens actual run results', { extraction: s.extraction, shell: s.shell });
  await shot(c, '05-results');
  check(s.save.has, 'explicit finish writes the isolated Orchard save', { save: s.save });

  stage = 'ordinary-reload';
  await boot(c, false); s = await read(c);
  check(s.save.resumed && s.extraction.finished && s.shell.visible
    && s.extraction.banked === settled.banked && s.money === settled.money,
  'reload preserves actual banked value, money and finished results', { settled,
    extraction: s.extraction, money: s.money, save: s.save });
  const securedIds = settled.secured.map(([id]) => id);
  check(securedIds.every(id => !s.fruit.some(f => f.id === id))
    && JSON.stringify(s.extraction.secured) === JSON.stringify(settled.secured),
  'reload does not resurrect sold authored cargo', { securedIds });
  await press(c, 'e'); await sleep(450); s = await read(c);
  check(s.extraction.banked === settled.banked && s.money === settled.money,
    'reloaded results and repeated E do not duplicate payout');
  await shot(c, '06-results-reloaded');
  ordinaryResult = { input: 'trusted keyboard/mouse only', authoredIds: c.authoredIds,
    bankTransactions: c.bankTransactions, settled, events: c.events,
    final: { extraction: s.extraction, money: s.money, save: s.save } };
  finalState = s;
}

async function coopBank() {
  stage = 'staged-room-ordinary-guest-bank';
  // Room connection is fixture setup. No fruit, position, aim, ledger, money,
  // tool selection or gameplay interaction is changed through debug actions.
  const id = Date.now().toString(36);
  const first = await makeClient('coop-A', `replay-orchard-proof-A-${id}`);
  const second = await makeClient('coop-B', `replay-orchard-proof-B-${id}`);
  await play(first); await play(second);
  const room = `orchard-proof-${id}`;
  await first.page.evaluate(room => window.__RIPE.call('net.connect', room, 0), room);
  await second.page.evaluate(room => window.__RIPE.call('net.connect', room, 0), room);
  await sleep(1600);
  let a = await read(first), b = await read(second);
  check(a.net.connected && b.net.connected && a.net.isHost !== b.net.isHost
    && a.net.remotes.length === 1 && b.net.remotes.length === 1,
    'staged Orchard co-op setup connects one host and one guest', { a: a.net, b: b.net });
  const host = a.net.isHost ? first : second;
  const guest = a.net.isHost ? second : first;
  await guest.page.bringToFront(); await lock(guest);
  let s = await read(guest);
  const quiet = s.fruit.filter(f => f.species === 'apple' && distance(f.pos, [-15, 0, 32]) < 4)
    .sort((x, y) => x.pos[1] - y.pos[1]);
  let fruitId = null;
  for (const f of quiet) if (await takeFruit(guest, f.id)) { fruitId = f.id; break; }
  check(fruitId !== null, 'guest ordinarily picks authored fruit after room setup');
  check(await bank(guest), 'guest ordinarily hauls and banks authored fruit');
  const until = Math.min(deadline, Date.now() + 12000);
  let h, g;
  do { await sleep(150); h = await read(host); g = await read(guest); }
  while ((h.extraction.banked === 0 || h.extraction.banked !== g.extraction.banked) && Date.now() < until);
  check(h.extraction.banked > 0 && h.extraction.banked === g.extraction.banked
    && h.extraction.secured.some(([id]) => id === fruitId)
    && g.extraction.secured.some(([id]) => id === fruitId),
  'one host-accepted guest sale appears once in both crew ledgers',
  { fruitId, host: h.extraction, guest: g.extraction });
  await shot(guest, '07-coop-guest-cargo', { fixtureSetup: 'room connect only',
    ordinaryGameplay: 'authored pick, walk, bank', hostExtraction: h.extraction });
  const banked = h.extraction.banked;
  await press(guest, 'e'); await sleep(500); h = await read(host); g = await read(guest);
  check(h.extraction.banked === banked && g.extraction.banked === banked,
    'repeated empty-handed guest E cannot count the sale twice');
  coopResult = { setup: 'debug room-connect fixture only', gameplay: 'trusted guest keyboard/mouse',
    fruitId, host: h.extraction, guest: g.extraction, guestTransactions: guest.bankTransactions };
}

try {
  const c = await makeClient('solo', `replay-orchard-proof-${Date.now().toString(36)}`);
  await ordinaryRun(c);
  if (withCoop) await coopBank();
} catch (e) {
  failure = String(e.stack || e); log('runner-error', { failure });
  const c = clients.at(-1);
  if (c) {
    try { finalState = await read(c); await shot(c, 'failure-state'); }
    catch (captureError) { warnings.push(`Failure capture: ${captureError.message}`); }
  }
} finally {
  for (const c of clients) {
    try { for (const key of ['w', 'Shift', 'a', 'd', 'e', 'h']) await c.page.keyboard.up(key); }
    catch { /* preserve the original result */ }
  }
  const videos = clients.map(c => ({ label: c.label, video: c.page.video() })).filter(c => c.video);
  await context.close();
  for (const item of videos) {
    try {
      const source = await item.video.path(), target = path.join(out, `${item.label}-orchard-proof.webm`);
      if (source !== target) { copyFileSync(source, target); unlinkSync(source); }
    } catch (e) { errors.push(`Video finalization: ${e.message}`); }
  }
  await browser.close();
  const report = { url: `${base}/?orchardRun=1`, viewport: [width, height],
    maxSeconds, durationSeconds: +((Date.now() - start) / 1000).toFixed(2),
    platform: process.platform, remoteLinuxOnly: true, logicOnly,
    proofLimits: logicOnly
      ? 'Real ordinary input and physics; GPU draws only for normal-camera captures. No continuous render/performance acceptance.'
      : 'Real ordinary input, physics and continuously rendered gameplay; human fun and pacing remain unverified.',
    capturesFreezeOnlyForReadback: true,
    ordinaryResult, coopResult, captures, checks, failure, errors, warnings, final: finalState, timeline };
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ out, durationSeconds: report.durationSeconds,
    checks: checks.map(({ pass, name }) => ({ pass, name })), failure, errors }, null, 2));
  if (failure || errors.length || checks.some(c => !c.pass)) process.exitCode = 1;
}
