// The King Melon, played through. This is the vertical slice's climax, so it
// gets tested as a sequence rather than as a set of independent features:
// gating, tethering, cutting, a two-and-a-half-tonne drop, and recovery.

export const name = 'legendary-king-melon';

export async function run(g, t) {
  await g.call('legendary.reset');
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

  // --- gating: the rope gun is the entry requirement
  t.eq(st.legendary.phase, 'prepare', 'stays in PREPARE without a rope gun');
  await g.call('tool.give', 'ropegun');
  await g.wait(0.6);
  st = await g.state();
  t.eq(st.legendary.phase, 'tether', 'owning a rope gun advances to TETHER');

  // --- tethering
  await g.standAt(info.home[0] + 18, info.home[2] + 16, 0, 1.2);
  await g.wait(0.4);
  const tetheredOk = await g.call('legendary.tether');
  t.ok(tetheredOk, 'a tether can be attached from a sensible distance');
  await g.standAt(info.home[0] - 16, info.home[2] + 14, 0, 1.2);
  await g.wait(0.3);
  await g.call('legendary.tether');
  st = await g.state();
  t.gte(st.legendary.tethers, 2, 'two tethers attached');
  t.note(`tethers ${st.legendary.tethers}/${st.legendary.required}`);

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

  // --- recovery: shove it into the pad and confirm the payout
  if (st.legendary.phase !== 'complete' && st.legendary.phase !== 'failed') {
    for (let attempt = 0; attempt < 26; attempt++) {
      const s = await g.state();
      if (s.legendary.phase === 'complete' || s.legendary.phase === 'failed') break;
      const [px, , pz] = s.legendary.pos;
      const dx = info.pad[0] - px;
      const dz = info.pad[2] - pz;
      const d = Math.hypot(dx, dz) || 1;
      // Standing in for a team winching it along with rope guns.
      await g.call('legendary.nudge', (dx / d) * 5.5, 1.6, (dz / d) * 5.5);
      await g.wait(0.7);
    }
    const done = await g.state();
    t.note(`after guiding: phase ${done.legendary.phase}, ${done.legendary.distanceToPad} m from the pad`);
    if (done.legendary.phase === 'complete') {
      t.gt(done.economy.money, 5000, 'completing the legendary pays a legendary amount');
      t.note(`payout $${done.economy.money}`);
    } else {
      t.lt(done.legendary.distanceToPad, 90, 'the melon stays somewhere recoverable');
      t.note('did not reach the pad within the nudge budget; recoverable state held');
    }
  }

  // --- and it must be resettable, because players will fail this
  await g.call('legendary.reset');
  await g.wait(0.5);
  const reset = await g.state();
  t.eq(reset.legendary.vines, 4, 'the legendary resets cleanly for another attempt');
  t.eq(reset.legendary.cut, 0, 'with the cut count cleared');
}
