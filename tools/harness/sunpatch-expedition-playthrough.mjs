/**
 * Full ordinary-input expedition: title -> authored harvest -> three threats ->
 * King Vine -> four reachable ties -> physical extraction -> dock settlement.
 * Reads game state for navigation and evidence only. Every action uses trusted
 * Playwright keyboard/mouse input; no debug actions, state writes or fixture.
 *
 * After the user's play session ends, serve a frozen build on an isolated
 * port, then set RIPE_URL and pass --allow-browser-input explicitly.
 * RIPE_URL=http://127.0.0.1:5244 node tools/harness/sunpatch-expedition-playthrough.mjs \
 *   --allow-browser-input --width 1720 --height 720 --seconds 1800 --video
 * Add --video for a full session WebM, then inspect screenshots and report.
 * Uses a separate replay slot through the title menu in a fresh browser context.
 * Captures during combat come from video to keep input timing reliable.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { fightKingVineWithMallet } from './king-vine-controls.mjs';

const args = process.argv.slice(2);
if (!args.includes('--allow-browser-input'))
  throw new Error('Browser pointer input is disabled during active play. Run only after the user says play is over, with --allow-browser-input.');
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1];
};
const width = Number(option('--width', '1720'));
const height = Number(option('--height', '720'));
const maxSeconds = Number(option('--seconds', '1800'));
const buyCannon = true;
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 180
  || !Number.isFinite(maxSeconds) || maxSeconds < 30 || maxSeconds > 3600)
  throw new Error('Use a viewport of at least 320x180 and --seconds from 30 to 3600.');
const base = process.env.RIPE_URL;
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base))
  throw new Error('Set RIPE_URL to an isolated local pilot server, such as http://127.0.0.1:5205.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(root, option('--out',
  `capture/sunpatch-expedition/normal-loop/${width}x${height}`));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage',
  '--mute-audio', ...(process.platform === 'win32'
    ? ['--use-gl=angle', '--use-angle=d3d11'] : [])] });
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1,
  ...(args.includes('--video') ? { recordVideo: { dir: out, size: { width, height } } } : {}) });
const page = await context.newPage();
const videoPageCreatedAt = Date.now();
const errors = [], warnings = [], timeline = [], beats = {
  title: false, dock: false, cropWarning: false, cropActivated: false, warning: false,
  mimicDefeated: false, physicalPrize: false, carriedPrize: false,
  reachedRealPad: false, soldWithE: false,
  ...(buyCannon ? { browsedWithE: false, boughtCannon: false, firedCannon: false } : {}),
  snapjawDefeated: false, snapjawHarvested: false, spitterDefeated: false,
  plumReleased: false, kingVineSubdued: false,
  fourVinesCutWithE: false, physicalDrop: false, extracted: false,
  returnedToDock: false, settledWithE: false, resultsVisible: false,
  reloadPreservedSettlement: false, noRepeatPayout: false,
};
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => {
  if (m.type() === 'error') errors.push(m.text());
  if (m.type() === 'warning') warnings.push(m.text());
});
const start = Date.now(), deadline = start + maxSeconds * 1000;
let stage = 'boot', mouseX = width / 2, mouseY = height / 2;
let lastState = null, warningShot = false;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const angleDelta = a => Math.atan2(Math.sin(a), Math.cos(a));
const alive = () => Date.now() < deadline;
function log(kind, data = {}) {
  const row = { wallSeconds: +((Date.now() - start) / 1000).toFixed(2), stage, kind, ...data };
  timeline.push(row); console.log(JSON.stringify(row));
}
async function shot(name) {
  await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 20000 });
}
async function read() {
  const s = await page.evaluate(() => {
    const g = window.__GAME, p = g.player, i = g.get('interaction');
    const encounters = g.get('encounters').snapshot().encounters;
    const e = encounters.find(x => x.kind === 'mimic');
    const v = g.get('vitals'), w = g.get('world'), t = g.get('tools');
    const leg = g.get('legendary'), progress = g.get('progress');
    const gl = g.renderer.renderer.getContext();
    const debugRenderer = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      gameSeconds: g.clock.elapsed,
      visualMode: window.__RIPE_VISUAL_MODE,
      pos: p.position.toArray(), eye: p.eyePosition.toArray(), yaw: p.yaw, pitch: p.pitch,
      playerState: p.state, health: v.health, downed: v.downed,
      synthetic: g.input.synthetic !== null, locked: g.input.pointerLocked,
      sensitivity: g.input.sensitivity, invertY: g.input.invertY,
      mimic: e && { pos: e.position, phase: e.phase, health: e.health,
        timeLeft: e.timeLeft },
      activeTool: t.activeId, slots: [...t.slots], cooldown: t.activeTool?.cooldown ?? null,
      cannonCharge: t.all.get('aircannon')?.recharge ?? 0,
      encounters, sites: g.get('encounters').siteState?.() ?? null,
      kingVine: g.get('kingVine').snapshot(),
      legendary: { phase: leg.phase, position: leg.position.toArray(),
        speed: leg.body ? Math.hypot(...Object.values(leg.body.linvel())) : 0,
        cut: leg.cutVines, cutPoints: leg.cutPoints(),
        pad: leg.extractionPad.toArray(), padRadius: leg.extractionRadius,
        paid: leg.lastPayout, inPad: leg.inExtraction() },
      chapter: progress.chapterState,
      objective: progress.objective,
      grounded: p.grounded,
      carried: i.carried?.fruit.id ?? null,
      carriedSpecies: i.carried?.fruit.species ?? null,
      basket: i.basket.items.map(item => item.id),
      targetKind: i.targetKind, targetId: i.target?.id ?? null, prompt: i.promptText,
      nearSellPad: i.nearSellPad, sellPad: w.sellPad.toArray(),
      shopCounter: w.shopCounter.toArray(), shopOpen: g.get('shop').open,
      cannonFires: t.all.get('aircannon')?.fires ?? 0,
      spawn: w.spawnPoint.toArray(),
      money: g.get('economy').money,
      prize: [...g.get('fruit').fruits.values()]
        .filter(f => f.species === 'watermelon' && f.state === 'free')
        .map(f => ({ id: f.id, pos: f.position.toArray(), speed: f.speed, radius: f.radius })),
      render: g.renderer.info,
      gpu: debugRenderer ? gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL) : 'unavailable',
      fruit: [...g.get('fruit').fruits.values()].filter(f => f.state !== 'gone')
        .map(f => ({id:f.id, species:f.species, pos:f.position.toArray(),state:f.state,speed:f.speed,radius:f.radius})),
      events: window.__expeditionLoop?.events.splice(0) ?? [],
    };
  });
  if (s.synthetic) throw new Error('Synthetic input was active; normal-input proof invalid.');
  if (s.visualMode !== 'voxel') throw new Error(`Unexpected visual mode ${s.visualMode}`);
  beats.warning ||= s.mimic?.phase === 'warn';
  beats.mimicDefeated ||= s.mimic?.health === 0;
  beats.physicalPrize ||= s.prize.length > 0;
  beats.carriedPrize ||= s.carriedSpecies === 'watermelon';
  for (const event of s.events) log('event', event);
  if (beats.warning && !warningShot) {
    warningShot = true;
    // Capturing synchronously here can use most of the 0.8 s warning window
    // under software rendering. A video run records it without delaying input.
    if (args.includes('--capture-warning')) await shot('02-warning');
    log('warning-observed', {
      pos: s.pos, mimic: s.mimic, health: s.health });
  }
  if (s.health < (lastState?.health ?? 100))
    log('damage-observed', { pos: s.pos, mimic: s.mimic, health: s.health });
  lastState = s;
  return s;
}
async function observe(label) {
  const s = await read();
  log(label, { pos: s.pos, health: s.health, playerState: s.playerState,
    mimic: s.mimic, tool: s.activeTool, carried: s.carried,
    targetKind: s.targetKind, targetId: s.targetId, money: s.money,
    render: s.render });
  return s;
}
async function lock() {
  if (await page.evaluate(() => !!document.pointerLockElement)) return;
  await page.mouse.click(width / 2, height / 2);
  await page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 5000 });
  await page.mouse.move(++mouseX, mouseY);
  await sleep(100);
}
async function aim(point, readState = read) {
  await lock();
  for (let n = 0; n < 18 && alive(); n++) {
    const s = await readState(), dx = point[0] - s.eye[0], dz = point[2] - s.eye[2];
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(point[1] - s.eye[1], Math.hypot(dx, dz));
    const dyaw = angleDelta(yaw - s.yaw), dpitch = pitch - s.pitch;
    if (Math.abs(dyaw) < .018 && Math.abs(dpitch) < .018) return true;
    const sensitivity = s.sensitivity || .0022;
    mouseX += Math.max(-160, Math.min(160, -dyaw / sensitivity));
    mouseY += Math.max(-120, Math.min(120,
      -dpitch / (sensitivity * (s.invertY ? -1 : 1))));
    await page.mouse.move(mouseX, mouseY);
    await sleep(80);
  }
  return false;
}
async function press(key) {
  await page.keyboard.down(key); await sleep(100); await page.keyboard.up(key);
}
async function click() {
  await page.mouse.down(); await sleep(110); await page.mouse.up();
}
async function go(point, radius = 1.15, seconds = 60, stepMs = 480,
  sprint = true, interruptOnHit = false, interruptOnWarning = false) {
  stage = 'walk'; log('waypoint', { point, radius });
  const until = Math.min(deadline, Date.now() + seconds * 1000);
  let previous = null, stuck = 0;
  while (alive() && Date.now() < until) {
    const s = await read(), d = dist(point, s.pos);
    if (interruptOnHit && s.health < 100) return true;
    if (interruptOnWarning && s.mimic.phase === 'warn') return true;
    if (d <= radius) return true;
    if (s.playerState !== 'active') { await sleep(250); continue; }
    if (!await aim([point[0], s.eye[1] - .045 * d, point[2]])) {
      log('aim-failed', { pos: s.pos, point }); return false;
    }
    await page.keyboard.down('w');
    if (sprint) await page.keyboard.down('Shift');
    await sleep(Math.min(stepMs, 260, Math.max(70, (d - radius) / (sprint ? 8.4 : 5.4) * 1000)));
    await Promise.all([page.keyboard.up('w'), ...(sprint ? [page.keyboard.up('Shift')] : [])]);
    const next = await read();
    // A slow render can carry the real player past a waypoint between reads.
    // Recognize crossing its approach disc rather than turning back and forth.
    const vx=next.pos[0]-s.pos[0],vz=next.pos[2]-s.pos[2],lengthSq=vx*vx+vz*vz;
    const along=lengthSq>0?Math.max(0,Math.min(1,((point[0]-s.pos[0])*vx+(point[2]-s.pos[2])*vz)/lengthSq)):0;
    const crossed=Math.hypot(point[0]-s.pos[0]-vx*along,point[2]-s.pos[2]-vz*along);
    if(crossed<=radius)return true;
    if (interruptOnHit && next.health < 100) return true;
    if (interruptOnWarning && next.mimic.phase === 'warn') return true;
    if (previous && dist(previous, next.pos) < .22) stuck++; else stuck = 0;
    previous = next.pos;
    if (dist(point,next.pos)>d+2) log('walk-overshoot',{before:s.pos,after:next.pos,point,distance:d});
    if (stuck >= 2) {
      log('obstacle-recovery', { pos: next.pos });
      await page.keyboard.down(stuck % 2 ? 'a' : 'd');
      await press('Space'); await sleep(300);
      await page.keyboard.up(stuck % 2 ? 'a' : 'd');
      if (stuck > 5) break;
    }
  }
  log('waypoint-missed', { point, pos: (await read()).pos });
  return false;
}
const toOrchard = [[60, 65], [55.5, 61], [50.5, 61.5], [44, 62.5],
  [37.2, 58.2], [30, 54], [25, 46], [11, 38.6], [-3.5, 31.4],
  [-7.5, 29.5]];
async function route(points) {
  for (const [x, z] of points) {
    if (!alive() || !await go([x, 0, z], 1.4, 60)) return false;
  }
  return true;
}
async function waitFor(predicate, seconds, label) {
  const until = Math.min(deadline, Date.now() + seconds * 1000);
  while (alive() && Date.now() < until) {
    const s = await read();
    if (predicate(s)) return s;
    await sleep(110);
  }
  log('wait-timeout', { label, state: lastState });
  return lastState;
}
async function fight() {
  stage = 'mimic-fight';
  // The second harvest press has brought the Mimic to life at close range.
  // Start swinging normally, then follow any knockback while reading its pose.
  for (let n = 0; n < 2; n++) {
    await sleep(700);
    await click();
    log('rapid-mallet-click', { index: n + 2 });
  }
  let opening = await observe('rapid-mallet-result');
  if (dist(opening.pos, opening.spawn) < 3 && opening.mimic.health > 0)
    throw new Error('Player evacuated to dock before defeating Mimic');
  if (opening.mimic.health === 0) {
    beats.mimicDefeated = true;
    await shot('05-mimic-defeated');
    return true;
  }
  const until = Math.min(deadline, Date.now() + 70_000);
  let swings = 0;
  while (alive() && Date.now() < until) {
    let s = await read();
    if (s.mimic.health === 0) break;
    if (dist(s.pos, s.spawn) < 3)
      throw new Error('Player evacuated to dock during Mimic fight');
    if (s.playerState !== 'active') { await sleep(300); continue; }
    const d = dist(s.pos, s.mimic.pos);
    if (d > 2.7) {
      const dx = s.pos[0] - s.mimic.pos[0], dz = s.pos[2] - s.mimic.pos[2];
      const stand = [s.mimic.pos[0] + dx / d * 2.25, 0,
        s.mimic.pos[2] + dz / d * 2.25];
      if (!await go(stand, 0.5, 12, 250, false)) log('mimic-approach-missed', { d });
      s = await read();
    }
    if (!await aim([s.mimic.pos[0], s.mimic.pos[1] + 1.15,
      s.mimic.pos[2]])) log('strike-aim-inexact');
    if (s.cooldown > 0) await sleep(Math.ceil(s.cooldown * 1000) + 90);
    const before = await read();
    await click(); swings++;
    const after = await observe('mallet-swing');
    log('strike-result', { swings, beforeHealth: before.mimic.health,
      afterHealth: after.mimic.health, distance: dist(after.pos, after.mimic.pos) });
    if (after.mimic.health === 0) break;
    await sleep(430);
  }
  const s = await observe('fight-end');
  if (s.mimic.health === 0) {
    beats.mimicDefeated = true;
    await shot('05-mimic-defeated');
  }
  return s.mimic.health === 0;
}
async function recoverPrize() {
  stage = 'recover-prize';
  let s = await waitFor(x => x.prize.some(f => f.speed < 2.5), 8, 'free-watermelon');
  if (!s.prize.length) return false;
  const id = s.prize.sort((a, b) => dist(a.pos, s.pos) - dist(b.pos, s.pos))[0].id;
  for (let attempt = 0; attempt < 8 && alive(); attempt++) {
    s = await read();
    const fruit = s.prize.find(f => f.id === id);
    if (!fruit) break;
    const d = Math.max(0.01, dist(s.pos, fruit.pos));
    if (d > 2.1) {
      const stand = [fruit.pos[0] + (s.pos[0] - fruit.pos[0]) / d * 1.6,
        0, fruit.pos[2] + (s.pos[2] - fruit.pos[2]) / d * 1.6];
      if (!await go(stand, .7, 20, 330, false)) continue;
      s = await read();
    }
    const target = s.prize.find(f => f.id === id);
    if (!target) break;
    await aim(target.pos);
    await sleep(130);
    s = await observe('prize-target');
    if (s.targetKind === 'fruit' && s.targetId === id) {
      await press('e');
      s = await observe('prize-E');
      if (s.carried === id) {
        beats.carriedPrize = true; await shot('06-prize-carried'); return true;
      }
    }
    await sleep(250);
  }
  return false;
}
async function deliver() {
  stage = 'carry-to-real-pad';
  // The normal pad is at the dock-side shop. The comparison-only orchard pad
  // is deliberately unavailable in this run.
  const back = [...toOrchard].reverse().slice(0, 7);
  if (!await route(back)) return false;
  const s = await read();
  if (!await go(s.sellPad, 2.2, 60)) return false;
  const near = await observe('real-sell-pad');
  beats.reachedRealPad = near.targetKind === 'sell';
  await shot('07-real-sell-pad');
  if (near.targetKind !== 'sell') return false;
  const before = near.money;
  await press('e');
  const sold = await observe('sale-E');
  beats.soldWithE = sold.money > before && sold.carried === null;
  await shot('08-sold');
  return beats.soldWithE;
}

async function tryFirstUpgrade() {
  let s = await read();
  if (!await go(s.shopCounter, 2, 45)) return false;
  stage = 'first-upgrade';
  await aim([s.shopCounter[0], s.shopCounter[1] + 1.2, s.shopCounter[2]]);
  s = await observe('at-supply-shed');
  await press('e');
  await page.locator('.shop-panel').waitFor({ state: 'visible', timeout: 5000 });
  beats.browsedWithE = (await read()).shopOpen;
  await shot('09-supply-shed');
  const before = (await read()).money;
  await page.locator('.shop-item[data-id="aircannon"]').click();
  s = await waitFor(state => state.activeTool === 'aircannon', 5, 'cannon-equipped');
  beats.boughtCannon = s.activeTool === 'aircannon' && before - s.money === 110;
  await press('Escape');
  await lock();
  // Face the open route and fire with the newly taught hold/release control.
  await aim([s.shopCounter[0] - 12, s.eye[1] + 1, s.shopCounter[2] - 12]);
  const fires = (await read()).cannonFires;
  await page.mouse.down(); await sleep(450); await page.mouse.up();
  s = await waitFor(state => state.cannonFires > fires, 5, 'cannon-fired');
  beats.firedCannon = s.cannonFires > fires;
  await sleep(4600);
  await observe('first-upgrade-in-use');
  await shot('10-cannon-in-use');
  return beats.browsedWithE && beats.boughtCannon && beats.firedCannon;
}

async function selectTool(id) {
  const s = await read(), slot = s.slots.indexOf(id);
  if (slot < 0) throw new Error(`Normal inventory has no slot for ${id}`);
  await press(String(slot + 1));
}

async function harvestOrchard() {
  stage = 'suspicious-harvest';
  const s = await read(), site = s.sites?.find(site => site.id === 'orchard-mimic');
  if (!site) throw new Error('Authored orchard site is missing');
  const fruit = s.fruit.filter(f => site.fruitIds.includes(f.id) && f.state === 'attached')
    .sort((a, b) => a.pos[1] - b.pos[1])[0];
  if (!fruit) throw new Error('Suspicious harvest has no attached physical crop');
  const d = Math.max(.01, dist(s.pos, fruit.pos));
  const stand = [fruit.pos[0] + (s.pos[0] - fruit.pos[0]) / d * 2,
    0, fruit.pos[2] + (s.pos[2] - fruit.pos[2]) / d * 2];
  if (!await go(stand, .45, 45, 260, false)) return false;
  await aim(fruit.pos); await sleep(100); await press('e');
  let next = await waitFor(v => v.sites.find(site => site.id === 'orchard-mimic').phase === 'warning',
    3, 'crop-warning');
  beats.cropWarning = next.sites.find(site => site.id === 'orchard-mimic').phase === 'warning';
  await shot('03-suspicious-crop-warning');
  await sleep(750); await press('e');
  next = await waitFor(v => v.sites.find(site => site.id === 'orchard-mimic').phase === 'active',
    3, 'crop-wakes-mimic');
  beats.cropActivated = next.sites.find(site => site.id === 'orchard-mimic').phase === 'active';
  if (next.carried !== null) await press('q');
  await aim([next.mimic.pos[0], next.mimic.pos[1] + 1.2, next.mimic.pos[2]]);
  return beats.cropWarning && beats.cropActivated;
}

async function shoot(point, hold = 100) {
  await selectTool('aircannon');
  await aim(point);
  await waitFor(s => s.cannonCharge >= .34, 6, 'cannon-recharged');
  await page.mouse.down(); await sleep(hold); await page.mouse.up();
  await sleep(100);
}

async function defeatSnapjaw() {
  if (!await route([[-17,25],[-23,22],[-24.4,14.5]])) return false;
  stage = 'snapjaw';
  await selectTool('aircannon');
  let s = await read(), jaw = s.encounters.find(e => e.kind === 'snapjaw');
  // Enter the warning radius while remaining outside the short bite. A real
  // recovery window, not a fixture phase, decides when the cannon may damage it.
  if (!await go([jaw.position[0] + 3.6,0,jaw.position[2]], .35, 25, 180, false)) return false;
  await aim([jaw.position[0],jaw.position[1]+1.45,jaw.position[2]]);
  await shot('11-snapjaw-guarding-harvest');
  for (let attempt = 0; attempt < 5 && alive(); attempt++) {
    s = await waitFor(v => v.encounters.find(e => e.kind === 'snapjaw').phase === 'recover',
      5, 'snapjaw-real-opening');
    jaw = s.encounters.find(e => e.kind === 'snapjaw');
    if (jaw.health <= 0) break;
    if (jaw.phase !== 'recover') continue;
    await shoot([jaw.position[0],jaw.position[1]+1.45,jaw.position[2]]);
    s = await waitFor(v => v.encounters.find(e => e.kind === 'snapjaw').health < jaw.health,
      1, 'snapjaw-hit');
    if (s.encounters.find(e => e.kind === 'snapjaw').health <= 0) break;
    await go([jaw.position[0]+3.6,0,jaw.position[2]], .4, 15, 180, false);
  }
  beats.snapjawDefeated = (await read()).encounters.find(e => e.kind === 'snapjaw').health <= 0;
  await shot('12-snapjaw-subdued');
  if (!beats.snapjawDefeated) return false;
  return harvestCache();
}

async function harvestCache() {
  stage = 'snapjaw-harvest';
  let s = await read();
  const site = s.sites.find(site => site.id === 'snapjaw-cache');
  const fruit = s.fruit.filter(f => site.fruitIds.includes(f.id)
    && ['attached','free'].includes(f.state)).sort((a,b) => dist(a.pos,s.pos)-dist(b.pos,s.pos))[0];
  if (!fruit) throw new Error('Snapjaw cache has no recoverable crop');
  const d = Math.max(.01,dist(s.pos,fruit.pos));
  const stand = [fruit.pos[0]+(s.pos[0]-fruit.pos[0])/d*2.4,0,
    fruit.pos[2]+(s.pos[2]-fruit.pos[2])/d*2.4];
  if (!await go(stand,.45,35,220,false)) return false;
  await selectTool('hand');
  s = await read();
  await aim(s.fruit.find(f=>f.id===fruit.id).pos); await sleep(120);
  await shot('12a-snapjaw-crop-ready');
  const before = await read();
  await press('e');
  s = await waitFor(v=>v.carried===fruit.id||v.basket.includes(fruit.id),3,'snapjaw-crop-picked');
  beats.snapjawHarvested=s.carried===fruit.id||s.basket.includes(fruit.id);
  log('snapjaw-crop-picked',{id:fruit.id,before:before.fruit.find(f=>f.id===fruit.id),
    carried:s.carried,basket:s.basket,prompt:before.prompt});
  await shot('12b-snapjaw-crop-in-hands');
  if(s.carried!==null)await press('q');
  return beats.snapjawHarvested;
}

async function defeatSpitter() {
  if (!await route([[-27,12],[-29,2]])) return false;
  stage = 'spitter';
  for (let attempt = 0; attempt < 6 && alive(); attempt++) {
    const s = await read(), enemy = s.encounters.find(e => e.kind === 'spitter');
    if (enemy.health <= 0) { beats.spitterDefeated = true; break; }
    await shoot([enemy.position[0],enemy.position[1]+1.9,enemy.position[2]]);
    await page.keyboard.down(attempt % 2 ? 'a' : 'd'); await sleep(550);
    await page.keyboard.up(attempt % 2 ? 'a' : 'd');
    const after = await observe('spitter-shot');
    if (after.encounters.find(e => e.kind === 'spitter').health <= 0) {
      beats.spitterDefeated = true; break;
    }
    await go([-29 + (attempt % 2 ? -1.5 : 1.5),0,-2], .8, 20, 220, false);
  }
  await shot('13-spitter-subdued'); return beats.spitterDefeated;
}

/** Terrain-only navigation planning is read-only. Movement still goes through
 * keyboard collision, so trees/crags can block a path and fail the run. */
async function terrainRoute(target) {
  const startState = await read(), spacing = 1;
  const minX = Math.floor((Math.min(startState.pos[0],target[0])-20)/spacing)*spacing;
  const minZ = Math.floor((Math.min(startState.pos[2],target[2])-20)/spacing)*spacing;
  const nx = Math.ceil((Math.max(startState.pos[0],target[0])+20-minX)/spacing)+1;
  const nz = Math.ceil((Math.max(startState.pos[2],target[2])+20-minZ)/spacing)+1;
  const {heights,normals} = await page.evaluate(({minX,minZ,nx,nz,spacing}) => {
    const terrain = window.__GAME.get('world').terrain, heights=[],normals=[];
    for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
      const px=minX+x*spacing,pz=minZ+z*spacing;
      heights.push(terrain.height(px,pz));normals.push(terrain.normal(px,pz).y);
    }
    return {heights,normals};
  }, {minX,minZ,nx,nz,spacing});
  const key = (x,z)=>z*nx+x;
  const cell = p=>[Math.round((p[0]-minX)/spacing),Math.round((p[2]-minZ)/spacing)];
  const a=cell(startState.pos), b=cell(target), from=key(...a), goal=key(...b);
  const open=new Set([from]), cost=new Map([[from,0]]), previous=new Map();
  const heuristic=id=>Math.hypot(id%nx-b[0],Math.floor(id/nx)-b[1]);
  for(let n=0;open.size&&n<nx*nz;n++) {
    let current=-1,best=Infinity;
    for(const id of open){const value=cost.get(id)+heuristic(id);if(value<best){best=value;current=id;}}
    if(current===goal)break;open.delete(current);
    const x=current%nx,z=Math.floor(current/nx);
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const xx=x+dx,zz=z+dz;if(xx<0||xx>=nx||zz<0||zz>=nz)continue;
      const id=key(xx,zz),length=Math.hypot(dx,dz),rise=Math.abs(heights[id]-heights[current]);
      if(heights[id]<1||normals[id]<Math.cos(48*Math.PI/180)||rise>length*spacing)continue;
      const value=cost.get(current)+length+rise*.55;
      if(value<(cost.get(id)??Infinity)){cost.set(id,value);previous.set(id,current);open.add(id);}
    }
  }
  if(!previous.has(goal)&&goal!==from){log('no-terrain-path',{from:startState.pos,target});return false;}
  const ids=[goal];while(ids.at(-1)!==from)ids.push(previous.get(ids.at(-1)));
  ids.reverse();const points=[];
  for(let i=1;i<ids.length;i++){
    const id=ids[i],last=ids[i-1],next=ids[i+1];
    if(next!==undefined&&id-last===next-id&&i%3!==0)continue;
    points.push([minX+(id%nx)*spacing,minZ+Math.floor(id/nx)*spacing]);
  }
  log('terrain-walk-plan',{target,points});
  if(!await route(points))return false;
  return go(target,.75,30,240,false);
}

async function defeatKingVine() {
  if(!await route([[-31,-8]]))return false;
  if(!await go([-32,0,-13],.6,25,240,false))return false;
  const hillViewY=await page.evaluate(()=>window.__GAME.get('world').terrain.height(-33,-18)+1);
  await aim([-33,hillViewY,-18]);
  await shot('13c-walkable-hill-approach');
  if(!await route([[-33,-18]]))return false;
  if(!await releaseHillPlum())return false;
  if(!await route([[-36,-30],[-27,-30],[-26,-35]]))return false;
  stage='king-vine';
  let s=await read(),boss=s.kingVine;
  const stand=[boss.center[0]-3.1,0,boss.center[2]];
  await selectTool('hand');
  await aim([boss.center[0],boss.center[1]+1.7,boss.center[2]]);
  await shot('14-king-vine-arena');
  if(!await go(stand,.4,25,180,false))return false;
  const readCombat=()=>page.evaluate(()=>{const g=window.__GAME,p=g.player;return{
    pos:p.position.toArray(),eye:p.eyePosition.toArray(),yaw:p.yaw,pitch:p.pitch,
    sensitivity:g.input.sensitivity,invertY:g.input.invertY,health:g.get('vitals').health,
    playerState:p.state,boss:g.get('kingVine').snapshot()}});
  // The optional cannon is owned, but every boss hit uses the starter mallet.
  // A down is handled by the game's normal revive/checkpoint flow.
  for(let attempt=0;attempt<3&&alive();attempt++) {
    const result=await fightKingVineWithMallet(page,{read:readCombat,
      aim:point=>aim(point,readCombat),onEvent:(kind,data)=>log(kind,data)});
    if(result.subdued)break;
    if(!result.downed)return false;
    s=await waitFor(v=>v.playerState==='active',55,'normal-solo-recovery');
    if(s.playerState!=='active')return false;
    log('normal-boss-retry',{attempt:attempt+1,position:s.pos,health:s.health,boss:s.kingVine});
    if(dist(s.pos,s.spawn)<8){
      if(!await route([...toOrchard,[-24,22],[-27,12],[-29,2],[-31,-8],[-33,-18],
        [-36,-30],[-27,-30],[-26,-35]]))return false;
      if(!await go(stand,.4,25,180,false))return false;
    }
    await selectTool('hand');
  }
  beats.kingVineSubdued=(await read()).kingVine.phase==='subdued';
  await shot('15-king-vine-subdued');return beats.kingVineSubdued;
}

async function releaseHillPlum() {
  stage='spitter-hillside-harvest';
  let s=await read();
  const site=s.sites.find(site=>site.id==='spitter-slope');
  const fruit=s.fruit.find(f=>site.fruitIds.includes(f.id));
  if(!fruit)throw new Error('Authored hillside plum is missing');
  // Approach from the farm above it, then fire downhill into the real body.
  if(!await go([fruit.pos[0],0,fruit.pos[2]-5.5],.6,35,220,false))return false;
  await aim(fruit.pos); await shot('13a-hillside-plum-guarded-crop');
  const startPosition=[...fruit.pos];
  for(let attempt=0;attempt<3;attempt++){
    s=await read();const current=s.fruit.find(f=>f.id===fruit.id);
    if(current?.state==='free'&&(dist(current.pos,startPosition)>.3||current.speed>.3)){
      beats.plumReleased=true;break;
    }
    if(!current)break;
    await shoot(current.pos,1500);
    await sleep(650);
  }
  s=await read();const after=s.fruit.find(f=>f.id===fruit.id);
  beats.plumReleased ||= after?.state==='free'&&(dist(after.pos,startPosition)>.3||after.speed>.3);
  log('hillside-plum-physical-release',{id:fruit.id,before:fruit,after,
    site:s.sites.find(site=>site.id==='spitter-slope')});
  if(after)await aim(after.pos);await shot('13b-hillside-plum-rolling');
  return beats.plumReleased;
}

async function cutAndExtract() {
  const firstTie=(await read()).legendary.cutPoints[0].position;
  if(!await terrainRoute([firstTie[0],0,firstTie[2]+2.05]))return false;
  stage='cut-vine-ties';
  await selectTool('hand');
  for(let index=0;index<4;index++) {
    const s=await read(),point=s.legendary.cutPoints.find(p=>p.vine===index);
    if(!point?.remaining)throw new Error(`Vine ${index+1} was not intact before the E cut`);
    if(!await go([point.position[0],0,point.position[2]+2.05],.4,30,200,false))return false;
    await aim(point.position);await sleep(120);
    await shot(`16-vine-${index+1}-before-cut`);
    await press('e');
    const after=await waitFor(v=>v.legendary.cut===index+1,3,`vine-${index+1}-cut-with-E`);
    if(after.legendary.cut!==index+1)return false;
    log('cut-with-E',{index:index+1,phase:after.legendary.phase});
  }
  beats.fourVinesCutWithE=true;
  let s=await read();beats.physicalDrop=['drop','recover','complete'].includes(s.legendary.phase);
  await aim(s.legendary.position);await shot('17-king-melon-dropped');
  // Follow the actual landing, not a predetermined fruit position. If it comes
  // to rest in the marked extraction zone, physics has already done the haul.
  s=await waitFor(v=>v.legendary.phase!=='drop',15,'melon-landed');
  if(s.legendary.phase!=='complete') {
    if(s.legendary.position[1]>30&&s.legendary.position[2]<-64) {
      if(!await terrainRoute([-27,0,-30]))return false;
      if(!await route([[-36,-30],[-35,-44],[-30,-53],[-31,-60],[-28,-69],
        [-22,-75],[-15,-77],[0,-78]]))return false;
      s=await read();await aim(s.legendary.position);
      await shot('17a-marked-ridge-recovery-approach');
    }
    const m=s.legendary.position,pad=s.legendary.pad,d=Math.max(.01,dist(m,pad));
    const behind=[m[0]+(m[0]-pad[0])/d*6.1,0,m[2]+(m[2]-pad[2])/d*6.1];
    if(!await terrainRoute(behind))return false;
    const readHaul=()=>page.evaluate(()=>{const g=window.__GAME,p=g.player,leg=g.get('legendary');
      return{pos:p.position.toArray(),eye:p.eyePosition.toArray(),yaw:p.yaw,pitch:p.pitch,
        sensitivity:g.input.sensitivity,invertY:g.input.invertY,
        phase:leg.phase,melon:leg.position.toArray(),pad:leg.extractionPad.toArray(),inPad:leg.inExtraction(),
        speed:Math.hypot(...Object.values(leg.body.linvel()))}});
    const until=Date.now()+90000;
    let nextSample=0, downhillRoll=false;
    while(alive()&&Date.now()<until){
      const h=await readHaul();if(h.phase==='complete')break;if(h.phase==='failed')return false;
      // Short walking pulses keep contact behind the sphere. Stop adding force
      // once it is rolling downhill; the visible receiver must do the catching.
      if(h.melon[1]<35.5&&h.speed>2)downhillRoll=true;
      if(!downhillRoll&&!h.inPad){
        const d=Math.max(.01,dist(h.melon,h.pad));
        const behind=[h.melon[0]-(h.pad[0]-h.melon[0])/d*3.15,h.eye[1],
          h.melon[2]-(h.pad[2]-h.melon[2])/d*3.15];
        const target=dist(h.pos,behind)<.35?[h.pad[0],h.eye[1],h.pad[2]]:behind;
        await aim(target,readHaul);
        await page.keyboard.down('w');await sleep(150);await page.keyboard.up('w');
      }else await sleep(150);
      if(Date.now()>nextSample){log('physical-melon-push',h);nextSample=Date.now()+1500;}
    }
    s=await read();
  }
  beats.extracted=s.legendary.phase==='complete'&&s.legendary.paid>0;
  await shot('18-king-melon-extracted');return beats.extracted;
}

async function returnAndSettle() {
  let s=await read();
  if(s.pos[1]>25&&s.pos[2]<-64){
    if(!await route([[8,-76],[0,-78],[-15,-77],[-22,-75],[-28,-69],[-31,-60],
      [-30,-53],[-35,-44],[-36,-30]]))return false;
  }else{
    if(!await terrainRoute([-22,0,-44]))return false;
    if(!await route([[-30,-38],[-36,-30]]))return false;
  }
  // Inspect the physical receiving timbers and ground marks from the authored
  // rim path at normal eye height, then retrace the same marked route home.
  if(!await route([[-30,-38],[-22,-44],[-13,-49],[-5,-51.5]]))return false;
  await aim([11,13,-44]);await shot('18a-receiver-and-apron-from-rim');
  if(!await route([[-13,-49],[-22,-44],[-30,-38],[-36,-30],[-33,-18],[-31,-8],
    [-29,2],[-27,12],[-24,22]]))return false;
  if(!await route([...toOrchard].reverse()))return false;
  s=await read();
  if(!await go(s.spawn,1.5,45,250,false))return false;
  stage='dock-settlement';beats.returnedToDock=dist((await read()).pos,s.spawn)<3;
  await shot('19-return-to-dock');
  await press('e');
  s=await waitFor(v=>v.chapter==='settled',6,'settle-with-E');
  beats.settledWithE=s.chapter==='settled';
  beats.resultsVisible=await page.locator('[data-expedition-action="continue-exploring"]').isVisible();
  await shot('20-expedition-results');
  if(!beats.settledWithE||!beats.resultsVisible)return false;
  // Additional native ultrawide layout proof uses the same earned result.
  await page.setViewportSize({width:3440,height:1440});await sleep(250);
  await shot('20a-earned-results-native-ultrawide');
  const earnedMoney=s.money;
  await page.locator('[data-expedition-action="continue-exploring"]').click();
  await sleep(300);await shot('20b-earned-dock-native-ultrawide');
  await page.setViewportSize({width,height});
  await sleep(1300);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__RIPE_READY||window.__RIPE_ERROR,null,{timeout:90000});
  await page.locator('[data-expedition-action="continue"]').click();
  await page.locator('.expedition-shell').waitFor({state:'hidden',timeout:5000});
  await lock();
  s=await read();
  beats.reloadPreservedSettlement=s.chapter==='settled'&&s.legendary.phase==='complete'
    &&s.legendary.cut===4&&s.kingVine.health===0&&s.money===earnedMoney;
  await press('e');await sleep(600);s=await read();
  beats.noRepeatPayout=s.money===earnedMoney&&s.chapter==='settled';
  log('earned-settlement-reload',{earnedMoney,afterMoney:s.money,chapter:s.chapter,
    legendary:s.legendary,kingVine:s.kingVine,beats:{reload:beats.reloadPreservedSettlement,dedupe:beats.noRepeatPayout}});
  await shot('21-earned-settlement-reloaded');
  return beats.reloadPreservedSettlement&&beats.noRepeatPayout;
}

let failure = null;
try {
  await page.goto(`${base}/?voxelPilot=1`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR,
    null, { timeout: 90000 });
  const bootError = await page.evaluate(() => window.__RIPE_ERROR ?? null);
  if (bootError) throw new Error(`Boot failed: ${bootError}`);
  const newExpedition = page.locator('[data-expedition-action="new-replay"]');
  log('title-state', await page.evaluate(() => {
    const shell = window.__GAME?.has('expeditionShell')
      ? window.__GAME.get('expeditionShell') : null;
    const root = document.querySelector('.expedition-shell');
    const button = root?.querySelector('[data-expedition-action="new-replay"]');
    return { url: location.href, shellOpen: shell?.open,
      shellMode: shell?.mode, shellHidden: root?.hidden,
      buttonPresent: !!button,
      buttonDisplay: button ? getComputedStyle(button).display : null,
      rootDisplay: root ? getComputedStyle(root).display : null,
      clockPaused: window.__GAME?.clock.paused };
  }));
  await newExpedition.waitFor({state:'visible',timeout:10000});
  beats.title = true; await shot('00-title');
  await newExpedition.click(); await sleep(1500);
  await page.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR,
    null, { timeout: 90000 });
  await page.locator('[data-expedition-action="continue"]').click();
  await page.locator('.expedition-shell').waitFor({state:'hidden',timeout:5000});
  await page.evaluate(() => {
    const g = window.__GAME;
    const observer = window.__expeditionLoop = { events: [] };
    for (const name of ['encounter:attack', 'encounter:defeated', 'fruit:grabbed',
      'fruit:sold', 'player:ragdoll', 'player:recovered', 'player:downed',
      'player:revived', 'money:changed', 'tool:swing', 'shop:purchased', 'ui:toast',
      'harvest:site', 'legendary:phase', 'legendary:complete'])
      g.bus.on(name, payload => observer.events.push({ name, gameSeconds: g.clock.elapsed,
        payload: JSON.parse(JSON.stringify(payload)) }));
  });
  const entry = await observe('fresh-dock');
  beats.dock = dist(entry.pos, entry.spawn) < 2;
  await shot('01-fresh-dock');
  await lock();
  if (!await route(toOrchard)) throw new Error('Normal walking missed the orchard route');
  await shot('02-orchard-entry');
  if (!await harvestOrchard()) throw new Error('The suspicious harvest did not warn then wake on two real E presses');
  if (!await fight()) throw new Error('Starter Picking Mallet did not defeat Mimic');
  if (!await recoverPrize()) throw new Error('Could not pick physical watermelon with E');
  if (!await deliver()) throw new Error('Could not walk to real sell pad and sell with E');
  if (buyCannon && !await tryFirstUpgrade()) throw new Error('Could not buy and fire first upgrade using normal inputs');
  if (!await route(toOrchard.slice(6))) throw new Error('Could not return to orchard from the shed');
  if (!await defeatSnapjaw()) throw new Error('Could not subdue Snapjaw during a real opening');
  if (!await defeatSpitter()) throw new Error('Could not subdue Spitter using real cannon shots');
  if (!await defeatKingVine()) throw new Error('Could not walk to and subdue King Vine');
  if (!await cutAndExtract()) throw new Error('Could not cut all vines with E and physically extract King Melon');
  if (!await returnAndSettle()) throw new Error('Could not walk back to dock and settle the expedition');
} catch (e) {
  failure = String(e.stack || e);
  log('runner-error', { failure });
} finally {
  try { await page.keyboard.up('w'); await page.keyboard.up('Shift');
    await page.keyboard.up('a'); await page.keyboard.up('d'); } catch { /* preserve prior result */ }
  try { await observe('final'); } catch (e) { errors.push(`Final observation: ${e.message}`); }
  const video = page.video();
  await context.close();
  if (video) {
    try {
      const source = await video.path();
      const target = path.join(out, 'sunpatch-expedition.webm');
      if (source !== target) { copyFileSync(source, target); unlinkSync(source); }
    } catch (e) { errors.push(`Video finalization: ${e.message}`); }
  }
  await browser.close();
  const report = { url: `${base}/?voxelPilot=1`, viewport: [width, height],
    maxSeconds, durationSeconds: +((Date.now() - start) / 1000).toFixed(2),
    videoPageCreatedOffsetSeconds: +((start - videoPageCreatedAt) / 1000).toFixed(3),
    gpu: lastState?.gpu ?? null, beats, failure, errors, warnings,
    final: lastState, timeline };
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ out, durationSeconds: report.durationSeconds,
    beats, failure, errors }, null, 2));
  if (failure || errors.length || Object.values(beats).some(v => !v)) process.exitCode = 1;
}
