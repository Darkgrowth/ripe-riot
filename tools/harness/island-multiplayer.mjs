// Real transport coverage for the island director and resident gull.
// Fixtures use public debug actions and deterministic world steps. While a
// phase is frozen, ONLY the ordinary network tick runs: no applyNet, authority
// claim, synthetic sale event, promotion method or snapshot injection is used.
// Run alone against the isolated staging server; never use the live play port.
// Set RIPE_URL to that server and RIPE_HARDWARE=0 for the background software run.
import { startServer, openGame, openSecondClient, sleep, ensureOut } from './driver.mjs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const checks = [], phases = [], pages = [];
const room = `island-${Date.now()}`;
const blastOnly = process.argv.includes('--remote-blast-only');
const ok = (condition, label, detail = '') => {
  checks.push({ ok: !!condition, label, detail });
  if (!condition) console.log(`FAIL ${label}: ${detail}`);
  return !!condition;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let owner, host, server, fatal;

async function instrument(p) {
  await p.pause(true);
  await p.page.evaluate(() => {
    const g = window.__GAME;
    if (!g.has('director') || !g.has('characters')) throw new Error('Director/characters not registered');
    window.__ISLAND_QA = { releases: [], rewards: [], sales: [] };
    g.bus.on('fruit:detached', e => {
      if (g.get('fruit').authoritative && e.cause === 'island-event') window.__ISLAND_QA.releases.push(e.fruitId);
    });
    g.bus.on('money:changed', e => {
      if (g.get('fruit').authoritative && e.reason === 'rush-order') window.__ISLAND_QA.rewards.push(e.delta);
    });
    g.bus.on('fruit:sold', e => {
      if (g.get('fruit').authoritative) window.__ISLAND_QA.sales.push(e.fruitId);
    });
  });
}
async function read(p) {
  return p.page.evaluate(() => {
    const g = window.__GAME, fruit = g.get('fruit');
    return { island: g.get('director').netState(), residents: g.get('characters').netState(),
      pecks: g.get('characters').stats.pecks, nodeSeq: fruit.nodeSeq,
      money: g.get('economy').money, net: window.__RIPE.state().net,
      ids: [...fruit.fruits.values()].filter(f => f.state !== 'gone').map(f => f.id),
      bodies: [...fruit.fruits.values()].filter(f => f.state === 'free').map(f => ({ id: f.id, body: !!f.body })),
      log: JSON.parse(JSON.stringify(window.__ISLAND_QA)) };
  });
}
async function pump(list, count = 6) {
  for (let i = 0; i < count; i++) {
    for (const p of list) await p.page.evaluate(() => window.__GAME.get('net').fixedStep(0.1));
    await sleep(70);
  }
}
async function until(list, predicate, budget = 5000) {
  const begin = Date.now();
  do { await pump(list, 1); if (await predicate()) return Date.now() - begin; } while (Date.now() - begin < budget);
  return -1;
}
async function stand(p, x, z) {
  await p.call('ragdoll.recover');
  await p.tp(x, (await p.terrainHeight(x, z)) + 0.04, z);
}
async function reset(p) {
  await p.pause(true);
  await p.call('director.reset', false);
  await p.call('characters.reset', false);
  await p.call('drop'); await p.call('basket.clear'); await p.call('rope.clear');
  await p.call('fruit.despawnAllFree'); await p.call('economy.set', 0);
  await p.page.evaluate(() => {
    window.__ISLAND_QA.releases.length = 0; window.__ISLAND_QA.rewards.length = 0;
    window.__ISLAND_QA.sales.length = 0;
  });
}
async function join(label, around) {
  const client = await openSecondClient(owner); pages.push(client); await instrument(client);
  await client.call('net.connect', room, 0);
  const connected = await until([host, client], async () => {
    const [a, b] = await Promise.all([read(host), read(client)]);
    return a.net.peers === 1 && b.net.peers === 1 && a.net.isHost && !b.net.isHost && a.net.hostId === b.net.hostId;
  }, 6500);
  if (!ok(connected >= 0, `${label}: late join agrees on incumbent host`)) throw new Error('Late join failed');
  if (around) await stand(client, around[0], around[1]);
  await pump([host, client]);
  return client;
}
async function migrate(client, label) {
  await pump([host, client]);
  const before = await read(host), mirror = await read(client);
  const outgoing = host;
  await outgoing.call('net.disconnect');
  const promoted = await until([client], async () => (await read(client)).net.isHost, 2500);
  ok(promoted >= 0, `${label}: clean disconnect promotes within 2500 ms`, `${promoted} ms`);
  const after = await read(client);
  ok(same(after.island, before.island), `${label}: director state survives promotion exactly`);
  ok(after.nodeSeq === before.nodeSeq, `${label}: promotion does not release another node`, `${before.nodeSeq} -> ${after.nodeSeq}`);
  ok(after.money === before.money, `${label}: promotion preserves shared money`, `${before.money} -> ${after.money}`);
  ok(after.bodies.every(f => f.body), `${label}: all loose replicas have physical bodies`);
  ok(new Set(after.ids).size === after.ids.length, `${label}: no duplicate fruit IDs`);
  await outgoing.closePage(); host = client;
  return { before, mirror, after };
}
async function targetFixture(kind) {
  const point = await host.page.evaluate(kind => {
    const g = window.__GAME, orchard = g.get('world').at('orchard').position;
    const fruits = [...g.get('fruit').fruits.values()].filter(f => f.state === 'attached'
      && (kind === 'windfall' ? ['apple', 'orange'].includes(f.species) : f.species === 'coconut'));
    for (const f of fruits) {
      const x = f.position.x + 2, z = f.position.z;
      if (kind === 'windfall' && Math.hypot(x - orchard.x, z - orchard.z) >= 30) continue;
      if (fruits.filter(q => Math.hypot(q.position.x - x, q.position.z - z) < 15).length >= 3) return [x, z];
    }
    return null;
  }, kind);
  if (!point) throw new Error(`No remaining ${kind} fixture cluster`);
  await stand(host, ...point);
  if (!await host.call('director.start', kind)) throw new Error(`${kind} did not start`);
}
async function clientIntroCase() {
  const label = 'client-only-intro-and-gather'; console.log(`\n${label}`);
  await reset(host); await stand(host, 45, 52);
  const client = await join(label, [-24, 22]);
  await host.call('director.enable', true);
  const y = await host.terrainHeight(-24, 22);
  const id = await host.call('fruit.spawn', 'apple', -23.7, y + 1.1, 22, null, 0.5);
  await pump([host, client]);
  ok(!(await read(host)).island.firstPick, `${label}: host has not picked anything`);
  await client.call('pickup', id); await pump([host, client]);
  ok((await client.state()).interaction.carriedId === id, `${label}: client owns its actual pickup`);
  ok((await read(host)).island.firstPick, `${label}: accepted remote claim arms host intro`);
  await host.simulate(12.2); await pump([host, client]);
  const warning = await read(host), e = warning.island.event;
  if (!ok(e.kind === 'windfall' && e.phase === 'warning', `${label}: client-only first pick schedules real windfall`, JSON.stringify(e)))
    throw new Error('Client-only intro did not schedule');
  const target = await host.call('fruit.info', e.targets[0]);
  await stand(client, target.pos[0], target.pos[2]); await pump([host, client]);
  await client.call('pickup', target.id); await pump([host, client]);
  const gathered = await read(host);
  ok((await client.state()).interaction.carriedId === target.id, `${label}: client claims an actual event target`);
  ok(gathered.island.event.progress === 1 && same(gathered.island.event.counted, [target.id]),
    `${label}: accepted client gather increments once`);
  await client.page.evaluate(id => window.__GAME.get('net').requestIntent({ kind: 'pick', fruitId: id, cause: 'hand' }), target.id);
  await pump([host, client]);
  const repeated = await read(host);
  ok(repeated.island.event.progress === 1 && same(repeated.island.event.counted, [target.id])
    && repeated.nodeSeq === gathered.nodeSeq, `${label}: duplicate accepted claim cannot count/release again`);
  await client.call('drop'); await client.call('basket.clear'); await pump([host, client]);
  const moved = await migrate(client, label);
  phases.push({ label, warning, gathered, repeated, promoted: moved.after });
}
async function weatherCase(kind, phase) {
  const label = `${kind}/${phase}`; console.log(`\n${label}`);
  await reset(host); await targetFixture(kind);
  const initial = await read(host), baselineNodes = initial.nodeSeq;
  if (phase === 'active') await host.simulate(9.0);
  if (phase === 'result') await host.simulate(26.1);
  const fixture = await read(host), e = fixture.island.event;
  if (!ok(e.phase === phase, `${label}: reached intended phase`, e.phase)) throw new Error('Wrong phase fixture');
  const client = await join(label, [e.at[0] + 9, e.at[2] + 2]);
  const mirrored = await read(client);
  ok(same(mirrored.island, fixture.island), `${label}: late join receives exact phase/targets/cursor`);
  ok(mirrored.nodeSeq === fixture.nodeSeq, `${label}: late join receives exact node sequence`);
  ok(e.targets.length > 0 && new Set(e.targets).size === e.targets.length, `${label}: target IDs unique`);
  const { before, after } = await migrate(client, label);
  if (phase === 'warning') await host.simulate(14.2);
  else if (phase === 'active') await host.simulate(6.0);
  else await host.simulate(0.6);
  const done = await read(host), end = done.island.event;
  ok(end.released === e.targets.length, `${label}: release cursor reaches target count once`, `${end.released}/${e.targets.length}`);
  ok(done.nodeSeq - baselineNodes === e.targets.length, `${label}: exactly one node release per target`, `${done.nodeSeq - baselineNodes}`);
  const released = [...before.log.releases, ...done.log.releases];
  ok(released.length === e.targets.length && new Set(released).size === released.length,
    `${label}: no duplicated physical detach across machines`, released.join(','));
  ok(done.money === before.money && done.log.rewards.length === 0, `${label}: weather does not mint money`);
  ok(done.bodies.every(f => f.body), `${label}: promoted host keeps released fruit physical`);
  phases.push({ label, initial, fixture, mirrored, promoted: after, done });
}
async function sellOne(seller, authority, label) {
  const world = await authority.call('world.info'), pad = world.sellPad;
  // Spawn beside the player away from the pad, claim through the ordinary
  // pickup path, then move the owner to the pad and submit a real sell intent.
  await stand(seller, -24, 22);
  await pump(seller === authority ? [authority] : [authority, seller]);
  const y = await seller.terrainHeight(-24, 22);
  const id = await authority.call('fruit.spawn', 'apple', -23.7, y + 1.1, 22, null, 0.5);
  await pump(seller === authority ? [authority] : [authority, seller]);
  await seller.call('pickup', id);
  await pump(seller === authority ? [authority] : [authority, seller]);
  const held = (await seller.state()).interaction.carriedId;
  if (!ok(held === id, `${label}: ordinary pickup owns fruit`, `${held} vs ${id}`)) throw new Error('Claim failed');
  const ownerId = await seller.call('net.id');
  ok((await authority.call('net.ownerOf', id)) === ownerId, `${label}: host ledger confirms actual claim`);
  await seller.tp(pad[0], pad[1] + 0.25, pad[2]);
  await pump(seller === authority ? [authority] : [authority, seller]);
  // Ordinary game steps expire the previous sale cooldown and update the
  // player's pad presence. A client still cannot tick the host's director.
  await seller.simulate(0.3);
  await pump(seller === authority ? [authority] : [authority, seller]);
  await seller.call('sell');
  await pump(seller === authority ? [authority] : [authority, seller]);
  ok(await authority.call('net.sold', id), `${label}: actual sale creates a tombstone`);
  return id;
}
async function orderCase(paid) {
  const label = paid ? 'order/paid-result' : 'order/progress'; console.log(`\n${label}`);
  await reset(host); await stand(host, -24, 22);
  if (!await host.call('director.start', 'order')) throw new Error('Order did not start');
  const goal = (await read(host)).island.event.goal;
  for (let i = 0; i < (paid ? goal : 2); i++) await sellOne(host, host, `${label}/host-sale-${i + 1}`);
  const fixture = await read(host), client = await join(label, [-24, 22]);
  const mirror = await read(client);
  ok(same(mirror.island, fixture.island), `${label}: late join retains order counted IDs/progress/paid latch`);
  ok(mirror.money === fixture.money, `${label}: late join sees one shared cash pot`);
  if (!paid) {
    // Malicious presentation packets still cross the real transport, but may
    // never be turned into authoritative sale notifications by the host.
    const clean = await read(host);
    await client.page.evaluate(() => {
      const net = window.__GAME.get('net');
      for (let i = 0; i < 8; i++) net.transport.send({ t: 'event', name: 'fruit:sold', payload: {
        fruitId: 90000000 + i, species: 'apple', value: 500, quality: 'pristine', mass: 1,
      } }, net.hostId);
    });
    await pump([host, client]);
    const protectedState = await read(host);
    ok(protectedState.money === clean.money && same(protectedState.island, clean.island)
      && same(protectedState.log.rewards, clean.log.rewards), `${label}: forged sale events cannot pay or advance host order`);
    const previous = (await read(host)).island.event.progress;
    const sold = await sellOne(client, host, `${label}/client-sale`);
    const afterSale = await read(host);
    ok(afterSale.island.event.progress === previous + 1, `${label}: actual client sale advances host order once`);
    await client.page.evaluate(id => window.__GAME.get('net').requestSell([id]), sold);
    await pump([host, client]);
    const repeat = await read(host);
    ok(repeat.money === afterSale.money && repeat.island.event.progress === afterSale.island.event.progress,
      `${label}: duplicate client sale pays/advances nothing`);
  }
  const moved = await migrate(client, label);
  if (!paid) for (let i = 0; i < goal; i++) {
    if ((await read(host)).island.event.phase !== 'active') break;
    await sellOne(host, host, `${label}/finish-${i + 1}`);
  }
  const result = await read(host), e = result.island.event;
  ok(e.phase === 'result' && e.paid && e.progress === e.goal, `${label}: order completes with paid latch`);
  const rewards = [...moved.before.log.rewards, ...result.log.rewards];
  ok(rewards.length === 1 && rewards[0] === e.reward, `${label}: exact single order reward across migration`, JSON.stringify(rewards));
  const cash = result.money;
  await host.simulate(1); await pump([host]);
  ok((await read(host)).money === cash, `${label}: paid result cannot repay itself`);
  phases.push({ label, fixture, mirror, promoted: moved.after, result });
}
const residentCore = s => ({ phase: s.phase, target: s.target, pecked: s.pecked, cycle: s.cycle,
  from: s.from, to: s.to, duration: s.duration, enabled: s.enabled });
async function gullCase(afterPeck) {
  const label = afterPeck ? 'gull/after-peck' : 'gull/before-peck'; console.log(`\n${label}`);
  await reset(host); await stand(host, -31, 22);
  const y = await host.terrainHeight(-20, 25);
  const id = await host.call('fruit.spawn', 'apple', -20, y + 0.15, 25, null, 0.5);
  await host.simulate(0.7);
  await host.call('characters.reset', true);
  if (!await host.call('characters.gull', id)) throw new Error('Gull fixture fruit was not eligible');
  if (afterPeck) await host.simulate(3.3);
  else await host.simulate(0.5);
  const fixture = await read(host), client = await join(label, [-31, 22]), mirrored = await read(client);
  ok(same(residentCore(mirrored.residents), residentCore(fixture.residents)), `${label}: late join sees exact gull target/phase/latch`);
  ok(fixture.residents.pecked === afterPeck, `${label}: fixture has requested peck boundary`);
  const moved = await migrate(client, label);
  ok(same(residentCore(moved.after.residents), residentCore(moved.before.residents)), `${label}: promotion preserves gull target/phase/latch`);
  await host.simulate(4.0);
  const result = await read(host), totalPecks = moved.before.pecks + result.pecks;
  ok(totalPecks === 1, `${label}: exactly one authoritative physical peck`, `${totalPecks}`);
  ok(result.residents.pecked && result.residents.cycle === fixture.residents.cycle, `${label}: latch/cycle remain stable`);
  const body = await host.call('fruit.body', id);
  ok(body?.hasBody, `${label}: target remains a physical fruit after promotion`);
  ok(result.money === fixture.money, `${label}: gull does not create money`);
  phases.push({ label, fixture, mirrored, promoted: moved.after, result });
}

async function remoteBlastCase() {
  const label = 'gull/remote-blast'; console.log(`\n${label}`);
  await reset(host); await host.call('characters.reset', true);
  const resident = await host.call('characters.info'), target = resident.gull;
  const client = await join(label, [target[0] + 2, target[2] + 2]);
  await stand(host, target[0] + 4, target[2] + 4); await pump([host, client]);
  const initial = await read(host);
  const request = (point) => client.page.evaluate(at => {
    const g = window.__GAME, center = g.player.position.clone().fromArray(at);
    g.get('net').requestBlast(center, 4, 22, 0.3);
  }, point);
  await request([target[0] + 200, target[1], target[2] + 200]); await pump([host, client]);
  const rejected = await host.call('characters.info');
  ok(rejected.scares === 0 && rejected.phase === 'perched', `${label}: distant rejected blast cannot scare gull`);
  await request(target); await pump([host, client]);
  const scared = await host.call('characters.info'), mirror = await read(client);
  ok(scared.scares === 1 && scared.phase === 'scared', `${label}: accepted client blast scares authoritative gull once`);
  ok(scared.target === -1 && scared.pecked, `${label}: scare clears target and latches physical peck`);
  ok(mirror.residents.phase === 'scared' && mirror.residents.cycle === scared.cycle,
    `${label}: real snapshot carries scared phase and cycle to client`);
  ok((await read(host)).money === initial.money && (await read(host)).nodeSeq === initial.nodeSeq,
    `${label}: resident reaction does not manufacture fruit or money`);
  const moved = await migrate(client, label);
  ok(moved.after.residents.phase === 'scared' && moved.after.residents.cycle === scared.cycle,
    `${label}: scared phase survives promotion`);
  phases.push({ label, initial, rejected, scared, mirrored: mirror, promoted: moved.after });
}

try {
  server = await startServer();
  owner = await openGame({ width: 400, height: 225, headless: true, quiet: true, drawFrames: false });
  pages.push(owner); host = owner; await instrument(host); await host.call('net.connect', room, 0);
  if (!blastOnly) {
    await clientIntroCase();
    for (const kind of ['windfall', 'coconuts']) for (const phase of ['warning', 'active', 'result'])
      await weatherCase(kind, phase);
    await orderCase(false); await orderCase(true);
    await gullCase(false); await gullCase(true);
  }
  await remoteBlastCase();
  const errors = pages.flatMap(p => p.consoleErrors).filter(e => !/DevTools|deprecat|ReadPixels|GPU stall/i.test(e));
  ok(errors.length === 0, 'all island multiplayer pages have no console errors', errors.slice(0, 5).join(' | '));
} catch (error) { fatal = String(error?.stack ?? error); ok(false, 'harness completed every phase fixture', fatal); }
finally {
  await owner?.close().catch(() => {});
  if (server?.proc) server.proc.kill();
  const failed = checks.filter(c => !c.ok).length;
  const out = ensureOut('alive/qa');
  writeFileSync(path.join(out, blastOnly ? 'island-remote-blast.json' : 'island-multiplayer.json'), JSON.stringify({ checks, phases, fatal,
    passed: checks.length - failed, failed, drawFrames: false, evidence: 'numerical gameplay and transport only', hardware: process.env.RIPE_HARDWARE === '1' }, null, 2));
  console.log(`\n${checks.length - failed}/${checks.length} island multiplayer checks passed; ${phases.length}/${blastOnly ? 1 : 12} phase fixtures completed.`);
  process.exitCode = failed ? 1 : 0;
}
