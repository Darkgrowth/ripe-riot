// Isolated real mouse throwing. Spawn/teleport/pickup only establish the fixture;
// no debug throw, bait action, or encounter-state mutation resolves the bait.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startServer, openGame, openSecondClient, sleep, ROOT } from './driver.mjs';
const out = path.join(ROOT, 'docs/evidence/smart-bait');
mkdirSync(out, { recursive: true });
const report = { url: process.env.RIPE_URL, build: 'isolated production snapshot (capture/sunpatch-playful-build)', input: 'Playwright hardware Chromium mouse and keyboard; no synthetic game input', fixtures: 'Teleport, encounter reset, fruit spawn and debug pickup establish focused encounter scenarios. Post-migration fruit reposition is fixture setup.', limits: 'No full island walk, actual sale payout, or real wall LOS integration test. Sale reward verified at multiplier level; blocked LOS has unit callback coverage.', checks: [], samples: [], errors: [] };
const check = (ok, label, detail = '') => {
  report.checks.push({ ok: !!ok, label, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` ${detail}` : ''}`);
  assert.ok(ok, label);
};
await startServer();
let first, second;
try {
  first = await openGame({ width: 1280, height: 720, headless: true, quiet: true,
    islandActivities: false });
  const setup = async (g, host = g, approachSide = false) => {
    await host.call('encounters.reset');
    const [x, y, z] = (await host.call('encounters.info')).threats.snapjaw.pos;
    const sx = x + (approachSide ? 7 : 0), sz = z + (approachSide ? 0 : 7);
    await g.tp(sx, await g.terrainHeight(sx, sz) + .15, sz);
    await g.look(approachSide ? Math.PI / 2 : 0, 0);
    await g.call('tool.select', 'hand');
    await g.wait(.3);
    const pos = (await g.state()).player.pos;
    const id = await host.call('fruit.spawn', 'orange', pos[0] - (approachSide ? 1.1 : 0),
      pos[1] + 1.3, pos[2] - (approachSide ? 0 : 1.1));
    if (host !== g) await sleep(250);
    check(await g.call('pickup', id), 'fixture fruit held', String(id));
    await g.wait(.3);
    await g.page.evaluate(() => {
      window.__BAIT_EVENTS = [];
      if (!window.__BAIT_LISTENING) window.__GAME.bus.on('encounter:baited', e => window.__BAIT_EVENTS.push({
        fruitId: e.fruitId, actorId: e.actorId, at: window.__GAME.clock.elapsed,
      }));
      window.__BAIT_LISTENING = true;
    });
    return { id, x, y, z };
  };
  const throwMouse = async g => {
    await g.page.bringToFront();
    await g.page.mouse.move(640, 360);
    await g.page.mouse.down({ button: 'left' });
    await sleep(430);
    await g.page.mouse.up({ button: 'left' });
    return g.page.evaluate(() => ({ pointerLocked: window.__GAME.input.pointerLocked,
      synthetic: !!window.__GAME.input.synthetic }));
  };
  const fixture = await setup(first);
  const input = await throwMouse(first);
  check(!input.synthetic, 'throw used real mouse without synthetic input');
  for (let i = 0; i < 20; i++) {
    await sleep(80);
    report.samples.push(await first.page.evaluate(id => {
      const g = window.__GAME, f = g.get('fruit').get(id);
      return { time: g.clock.elapsed, encounter: window.__RIPE.call('encounters.info'),
        fruit: f && { state: f.state, pos: f.position.toArray(), speed: f.speed },
        events: window.__BAIT_EVENTS };
    }, fixture.id));
  }
  const events = await first.page.evaluate(() => window.__BAIT_EVENTS);
  check(events.length === 1 && events[0].fruitId === fixture.id,
    'real solo throw triggers exactly one bait event', JSON.stringify(events));
  check(report.samples.some(s => s.encounter.threats.snapjaw.baited), 'jaws enter baited state');
  check(report.samples.some(s => s.encounter.threats.snapjaw.phase === 'attack'
    && Math.cos(s.encounter.threats.snapjaw.heading) < -.7), 'snap follows the real fruit away from its thrower');
  const record = await first.call('scoring.of', fixture.id);
  check(record?.stunts.includes('smartBait'), 'host awards SMART BAIT to the retrievable fruit', JSON.stringify(record));
  await first.page.screenshot({ path: path.join(out, 'solo-after-throw.png') });
  // East side is open. The straight southern line crosses an existing low
  // orchard fence at z≈16, so walking directly through it is not a valid route.
  const approach = await setup(first, first, true);
  await throwMouse(first);
  await first.page.keyboard.down('KeyW');
  await first.page.waitForFunction(([x, z]) => {
    const p = window.__GAME.player.position;
    return Math.hypot(p.x - x, p.z - z) < 3.5;
  }, [approach.x, approach.z], { timeout: 3000 });
  await first.page.keyboard.up('KeyW');
  await first.page.waitForFunction(() => window.__RIPE.call('encounters.info').threats.snapjaw.phase === 'recover',
    null, { timeout: 2500 });
  report.approach = { player: (await first.state()).player,
    jaw: (await first.call('encounters.info')).threats.snapjaw };
  await first.page.mouse.down(); await sleep(270); await first.page.mouse.up();
  await sleep(80);
  check((await first.call('encounters.info')).threats.snapjaw.health < 2,
    'real throw then normal forward movement reaches the existing counterattack window', JSON.stringify(report.approach));
  check(await first.page.evaluate(id => window.__GAME.get('fruit').get(id)?.state === 'free', approach.id),
    'bait fruit survives the distraction and counterattack');
  await first.page.evaluate(() => document.exitPointerLock());

  second = await openSecondClient(first);
  const room = `bait-${Date.now()}`;
  await first.call('net.connect', room, 0);
  await sleep(900);
  await second.call('net.connect', room, 0);
  await sleep(2200);
  const host = (await first.state()).net.isHost ? first : second;
  const client = host === first ? second : first;
  await host.tp(35, await host.terrainHeight(35, 55) + .15, 55);
  const remote = await setup(client, host, true);
  await host.page.evaluate(() => {
    window.__BAIT_EVENTS = [];
    if (!window.__BAIT_LISTENING) window.__GAME.bus.on('encounter:baited', e => window.__BAIT_EVENTS.push({ fruitId: e.fruitId, actorId: e.actorId }));
    window.__BAIT_LISTENING = true;
  });
  await host.page.evaluate(() => {
    const e = window.__GAME.get('encounters');
    window.__BAIT_DIAGNOSTICS = [];
    const track = e.trackThrownFruit.bind(e), blocked = e.baitOccluded.bind(e);
    e.trackThrownFruit = (id, actor) => {
      track(id, actor);
      const f = window.__GAME.get('fruit').get(id);
      window.__BAIT_DIAGNOSTICS.push({ type: 'track', id, actor, position: f?.position.toArray(), speed: f?.speed, pending: e.info().bait });
    };
    e.baitOccluded = (a, b) => {
      const result = blocked(a, b);
      window.__BAIT_DIAGNOSTICS.push({ type: 'los', a, b, blocked: result });
      return result;
    };
  });
  const clientBefore = await client.page.evaluate(() => window.__GAME.get('scoring').totalAwarded);
  await throwMouse(client);
  await sleep(1250);
  const hostEvents = await host.page.evaluate(() => window.__BAIT_EVENTS);
  const clientEvents = await client.page.evaluate(() => window.__BAIT_EVENTS);
  report.baitDiagnostics = await host.page.evaluate(() => window.__BAIT_DIAGNOSTICS);
  report.coop = { host: await host.state(), client: await client.state(), hostEvents, clientEvents,
    hostFruit: await host.call('fruit.info', remote.id), clientFruit: await client.call('fruit.info', remote.id) };
  check(hostEvents.filter(e => e.fruitId === remote.id).length === 1,
    'client mouse throw produces one host-confirmed bait', JSON.stringify(hostEvents));
  check(clientEvents.filter(e => e.fruitId === remote.id).length === 1,
    'client receives one confirmed cue', JSON.stringify(clientEvents));
  check((await host.call('scoring.of', remote.id))?.stunts.includes('smartBait'), 'host scores client bait');
  check(await client.page.evaluate(n => window.__GAME.get('scoring').totalAwarded === n, clientBefore),
    'client cue does not award independent scoring');
  await client.page.screenshot({ path: path.join(out, 'coop-client-after-throw.png') });
  await host.call('net.disconnect');
  await client.page.waitForFunction(() => window.__GAME.get('net').isHost, null, { timeout: 3000 });
  report.promoted = (await client.state()).net;
  const beforeRepeat = await client.page.evaluate(id => ({
    record: window.__RIPE.call('scoring.of', id), total: window.__GAME.get('scoring').totalAwarded,
  }), remote.id);
  check(beforeRepeat.record?.stunts.includes('smartBait') && beforeRepeat.record.multiplier >= 1.5,
    'promoted host retains earned SMART BAIT multiplier', JSON.stringify(beforeRepeat));
  // Valid same-fruit rethrow after promotion, using a new accepted pickup and
  // real mouse release; the opening can repeat but the fruit reward cannot.
  await client.call('encounters.reset');
  await client.tp(remote.x + 7, await client.terrainHeight(remote.x + 7, remote.z) + .15, remote.z);
  await client.look(Math.PI / 2, 0);
  await client.page.evaluate(id => {
    const g = window.__GAME, f = g.get('fruit').get(id);
    f.position.copy(g.player.eyePosition).add({ x: -1, y: -.3, z: 0 });
    f.body?.setTranslation(f.position, true);
  }, remote.id);
  check(await client.call('pickup', remote.id), 'same bait fruit remains retrievable after host migration');
  await sleep(250);
  await throwMouse(client);
  await sleep(700);
  check(await client.page.evaluate(id => window.__BAIT_EVENTS.filter(e => e.fruitId === id).length >= 2, remote.id),
    'promoted host accepts a new real throw of the same fruit');
  const afterRepeat = await client.call('scoring.of', remote.id);
  check(afterRepeat.stunts.filter(s => s === 'smartBait').length === 1
    && afterRepeat.multiplier === beforeRepeat.record.multiplier,
    'same fruit rethrow after migration cannot award SMART BAIT twice', JSON.stringify(afterRepeat));
  report.errors = [...first.consoleErrors, ...second.consoleErrors].filter(e => e.startsWith('pageerror:'));
  check(report.errors.length === 0, 'no runtime exceptions', JSON.stringify(report.errors));
} finally {
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await first?.close();
}
