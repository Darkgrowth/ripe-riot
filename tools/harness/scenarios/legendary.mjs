// The King Melon, played through. This is the vertical slice's climax, so it
// gets tested as a sequence rather than as a set of independent features:
// boss gating, optional tethering, cutting, a two-and-a-half-tonne drop, and recovery.

export const name = 'legendary-king-melon';

export async function run(g, t) {
  await g.call('legendary.reset');
  await g.call('kingVine.reset');
  await g.wait(0.6);
  const info = await g.call('legendary.info');
  t.note(`melon at ${info.home.map((v) => v.toFixed(0)).join(', ')}, pad at ${info.pad.map((v) => v.toFixed(0)).join(', ')}`);

  let st = await g.state();
  t.eq(st.legendary.phase, 'prepare', 'starts in the PREPARE phase');
  t.eq(st.legendary.vines, 4, 'hangs from four cuttable vines');
  t.eq(st.legendary.cut, 0, 'nothing cut yet');
  t.note(`melon mass ${st.legendary.mass} kg, fixed=${st.legendary.fixed}`);

  // --- it must hang still until something is cut
  const restA = st.legendary.pos;
  await g.wait(2.5);
  st = await g.state();
  const drift = Math.hypot(st.legendary.pos[0] - restA[0], st.legendary.pos[2] - restA[2]);
  t.lt(drift, 3.0, 'the vines hold it in place before anything is cut');
  t.lt(st.legendary.speed, 1.5, 'and it is not thrashing on its constraints');
  t.note(`idle drift ${drift.toFixed(2)} m at ${st.legendary.speed} m/s`);

  // --- gating: King Vine, not a shop purchase, opens the melon.
  t.eq(st.legendary.phase, 'prepare', 'stays in PREPARE while King Vine guards it');
  await g.call('legendary.cut', 1);
  t.eq((await g.state()).legendary.vines, 4, 'a vine cannot be cut before the guardian falls');
  await g.call('tool.give', 'ropegun');
  await g.wait(0.6);
  st = await g.state();
  t.eq(st.legendary.phase, 'prepare', 'owning a Rope Gun does not bypass King Vine');
  const won = await g.page.evaluate(() => {
    const boss = window.__GAME.get('kingVine');
    boss.phase = 'recover';
    boss.timeLeft = 10;
    const [x, y, z] = boss.center;
    for (let i = 0; i < 3; i++) {
      boss.tryHit([x, y + 1.7, z - 10], [0, 0, 1], 'air', 'test-player');
      boss.fixedStep(0.5);
    }
    return boss.subdued;
  });
  t.ok(won, 'direct hits subdue the guardian');
  await g.wait(0.1);
  t.eq((await g.state()).legendary.phase, 'tether', 'boss victory opens vine cutting');

  // --- tethering, the way a player does it: rope gun, then pin the near end.
  //
  // This path was broken in the shipped slice. The legendary kept its own
  // tether list that only the debug action below ever appended to, so a
  // player could rope the melon four times and still be told to restrain
  // it; and because the melon hangs FIXED until the first cut, the rope gun
  // anchored its line to a point in the air where the surface had been, so
  // when the melon fell the rope stayed up there holding nothing.
  await g.standAt(info.home[0] + 18, info.home[2] + 4, 0, 1.2);
  await g.call('tool.select', 'ropegun');
  await g.faceTo(info.home[0], info.home[1], info.home[2]);
  await g.wait(0.3);
  await g.call('tool.fire');
  await g.wait(0.3);
  st = await g.state();
  t.eq(st.legendary.held, 1, 'a rope fired at the melon is in the player\'s hands');
  t.eq(st.legendary.tethers, 0, 'and a rope in your hands is not a tether');
  const ropeToMelon = await g.page.evaluate(() => {
    const ropes = window.__GAME.get('ropes');
    const leg = window.__GAME.get('legendary');
    for (const r of ropes.ropes.values()) {
      if (r.b.ownerId === leg.id && r.heldByPlayer) return r.b.kind === 'legendary';
    }
    return null;
  });
  t.eq(ropeToMelon, true, 'the rope is tied to the melon itself, not to a point in the air');
  // Pin the near end to the ground: a tap of the secondary button.
  await g.look((await g.state()).player.yaw, -1.25);
  await g.wait(0.1);
  await g.call('tool.secondary', true);
  await g.wait(0.05);
  await g.call('tool.secondary', false);
  await g.wait(0.3);
  st = await g.state();
  t.eq(st.legendary.tethers, 1, 'pinning the near end turns the rope into a tether');
  t.eq(st.legendary.held, 0, 'and it leaves the player\'s hands');

  // --- one rope helps control the fall but does not gate later cuts.
  await g.call('legendary.cut', 2);
  await g.wait(1.5);
  st = await g.state();
  t.eq(st.legendary.vines, 2, 'two vines cut on one tether');
  t.eq(st.legendary.tethers, 1, 'and the pinned rope survives the melon sagging onto it');
  // Float the player 3 m under a point a third of the way along a remaining
  // vine and look at it, the way someone on the ravine wall would. The aim
  // needs the vine within 7 m; the anchors sit far above the ground.
  const aimAt = await g.page.evaluate(() => {
    const leg = window.__GAME.get('legendary');
    const ropes = window.__GAME.get('ropes');
    const V = Object.getPrototypeOf(leg.extractionPad).constructor;
    const a = new V(), b = new V();
    ropes.endpoints(leg.vines[0], a, b);
    const p = a.clone().lerp(b, 0.33);
    return [p.x, p.y, p.z];
  });
  await g.tp(aimAt[0], aimAt[1] - 3, aimAt[2] + 2);
  await g.faceTo(aimAt[0], aimAt[1], aimAt[2]);
  await g.wait(0.1);
  const gate = await g.call('legendary.cutLooking');
  st = await g.state();
  t.eq(gate, null, 'a third vine can be cut without a second tether');
  t.eq(st.legendary.vines, 1, 'and the cut takes effect');

  // A second tether, from the debug path, which builds the same rope a pin does.
  await g.standAt(info.home[0] - 16, info.home[2] + 14, 0, 1.2);
  await g.wait(0.3);
  const tetheredOk = await g.call('legendary.tether');
  t.ok(tetheredOk, 'a tether can be attached from a sensible distance');
  st = await g.state();
  t.gte(st.legendary.tethers, 2, 'two tethers attached');
  t.note(`tethers ${st.legendary.tethers}/${st.legendary.required}`);
  // Put the vines back so the sequence below reads the same as before.
  await g.call('legendary.reset');
  await g.wait(0.5);
  await g.standAt(info.home[0] + 18, info.home[2] + 16, 0, 1.2);
  await g.wait(0.3);
  await g.call('legendary.tether');
  await g.standAt(info.home[0] - 16, info.home[2] + 14, 0, 1.2);
  await g.wait(0.3);
  await g.call('legendary.tether');
  st = await g.state();
  t.gte(st.legendary.tethers, 2, 'two tethers attached for the run');

  // --- cutting: each cut must actually remove a vine
  await g.call('legendary.cut', 1);
  st = await g.state();
  t.eq(st.legendary.vines, 3, 'cutting removes a vine');
  t.eq(st.legendary.phase, 'detach', 'and moves to the DETACH phase');

  // Three vines must hold two and a half tonnes. Watch what they do.
  const hold = [];
  for (let i = 0; i < 8; i++) {
    await g.wait(0.15);
    const s2 = await g.state();
    hold.push(`[${s2.legendary.pos.map((v) => v.toFixed(0)).join(',')}] ${
      s2.ropes.list.map((r) => `${r.dist.toFixed(1)}/${r.len.toFixed(1)}`).join(' ')}`);
  }
  t.note(`after first cut: ${hold.join('  ')}`);
  const held = await g.state();
  t.gt(held.legendary.pos[1], 30, 'three remaining vines hold the melon up');

  await g.call('legendary.cut', 1);
  await g.call('legendary.cut', 1);
  st = await g.state();
  t.eq(st.legendary.vines, 1, 'three cut, one holding');
  await g.wait(1.0);

  // --- the drop
  // Zero the economy BEFORE cutting: the melon can complete at any moment once
  // it is falling, and resetting money afterwards raced with the payout.
  await g.call('economy.set', 0);
  const beforeDrop = (await g.state()).legendary.pos;
  await g.call('legendary.cut', 1);
  st = await g.state();
  t.eq(st.legendary.vines, 0, 'the last vine is cut');
  t.eq(st.legendary.phase, 'drop', 'which starts the DROP phase');
  t.eq(st.legendary.dropTetherCount, 2, 'two pinned ropes count for the optional drop bonus');

  let maxSpeed = 0;
  const trace = [];
  for (let i = 0; i < 60; i++) {
    await g.wait(0.05);
    const s = await g.state();
    maxSpeed = Math.max(maxSpeed, s.legendary.speed);
    trace.push(`${s.legendary.pos[1].toFixed(1)}/${s.legendary.speed.toFixed(1)}${s.legendary.phase[0]}`);
    if (s.legendary.phase === 'recover' || s.legendary.phase === 'complete') break;
  }
  t.note(`drop trace y/speed/phase: ${trace.join(' ')}`);
  st = await g.state();
  const fell = beforeDrop[1] - st.legendary.pos[1];
  t.gt(fell, 4, 'it actually falls when nothing is holding it');
  t.gt(maxSpeed, 5, 'and picks up real speed on the way down');
  t.note(`fell ${fell.toFixed(1)} m, peak ${maxSpeed.toFixed(1)} m/s, now ${st.legendary.phase}`);
  t.note(`landed at ${st.legendary.pos.join(', ')}, ${st.legendary.distanceToPad} m from the pad`);
  t.ok(['drop', 'recover', 'complete', 'failed'].includes(st.legendary.phase),
    'the sequence reaches a settled phase');

  // --- it comes to rest, and the encounter says so.
  //
  // The drop used to need a full second of stillness before it would call
  // the melon landed, and anything that kept it moving — a team already
  // shoving it, a swing on a low tether, this very loop nudging it every
  // 0.7 s — held the phase at DROP with the tethers still on. Down is down
  // now: a grounded melon is in RECOVER within eight seconds regardless.
  let phase = (await g.state()).legendary.phase;
  for (let i = 0; i < 40 && phase === 'drop'; i++) {
    await g.wait(0.4);
    phase = (await g.state()).legendary.phase;
  }
  t.ok(phase !== 'drop', 'a landed melon leaves the DROP phase on its own', `phase ${phase}`);
  t.eq((await g.state()).legendary.tethers, 0, 'and the tethers are cut loose for the haul');

  // --- recovery: shove it into the pad and confirm the payout
  if (phase === 'recover') {
    for (let attempt = 0; attempt < 20; attempt++) {
      const s = await g.state();
      if (s.legendary.phase === 'complete' || s.legendary.phase === 'failed') break;
      const [px, , pz] = s.legendary.pos;
      const dx = info.pad[0] - px;
      const dz = info.pad[2] - pz;
      const d = Math.hypot(dx, dz) || 1;
      // Standing in for a team shoving and winching it along.
      await g.call('legendary.nudge', (dx / d) * 4.0, 1.2, (dz / d) * 4.0);
      await g.wait(0.9);
    }
    const guided = await g.state();
    t.note(`after guiding: phase ${guided.legendary.phase}, ${guided.legendary.distanceToPad} m from the pad`);
  }
  if ((await g.state()).legendary.phase === 'recover') {
    // The haul itself is physics and terrain; the payout is a rule. Stand the
    // melon on the pad, which is what a successful haul ends with.
    t.note('placing the melon on the pad to stand in for the last of the haul');
    await g.call('legendary.place', info.pad[0], info.pad[1] + 5.8, info.pad[2]);
    await g.wait(3.0);
  }
  const done = await g.state();
  t.eq(done.legendary.phase, 'complete', 'the King Melon completes');
  t.gt(done.economy.money, 5000, 'completing the legendary pays a legendary amount');
  t.eq(done.economy.money, 11780, 'two controlled tethers add a 24% bonus');
  t.note(`payout $${done.economy.money}`);

  // --- the payoff: the next island. Announced a beat after the banner.
  await g.wait(4.0);
  const prog = (await g.state()).progress;
  t.ok(prog.nextIsland, 'completing the King Melon unlocks the next island');
  t.ok(prog.islands.includes('galegrove'), 'by name: Gale Grove');
  const flag = await g.page.evaluate(() => window.__GAME.get('world').built.boatFlag.visible);
  t.ok(flag, 'and the flag goes up on the boat');
  // …and it is progress, so it survives a save.
  await g.call('save.write', 'legendary-test');
  await g.call('progress.reset');
  await g.call('legendary.reset');
  t.ok(!(await g.state()).progress.nextIsland, 'a reset locks it again');
  t.ok(!(await g.page.evaluate(() => window.__GAME.get('world').built.boatFlag.visible)),
    'and takes the flag down');
  await g.call('save.read', 'legendary-test');
  t.ok((await g.state()).progress.nextIsland, 'and a save round-trip restores the unlock');
  const restored = (await g.state()).legendary;
  t.eq(restored.phase, 'complete', 'a save round-trip restores the completed harvest');
  t.eq(restored.vines, 0, 'completed harvest does not regrow holding vines');
  t.eq(restored.paid, done.legendary.paid, 'completed payout stays visible without paying again');
  t.lt(Math.hypot(restored.pos[0] - done.legendary.pos[0],
    restored.pos[2] - done.legendary.pos[2]), 0.1,
  'the extracted melon stays at the pad after loading');
  await g.call('save.clear', 'legendary-test');
  await g.call('progress.reset');

  // --- and it must be resettable, because players will fail this
  await g.call('legendary.reset');
  await g.wait(0.5);
  const reset = await g.state();
  t.eq(reset.legendary.vines, 4, 'the legendary resets cleanly for another attempt');
  t.eq(reset.legendary.cut, 0, 'with the cut count cleared');
  t.eq(reset.ropes.count, 4, 'and nothing but the four vines is left on the melon');
}
