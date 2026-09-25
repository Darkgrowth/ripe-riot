// The boss is the gate; ropes are optional help for a controlled drop.
export const name = 'legendary-no-rope-extraction';

export async function run(g, t) {
  await g.call('legendary.reset');
  await g.call('kingVine.reset');
  await g.wait(0.2);
  let state = await g.state();
  t.eq(state.legendary.phase, 'prepare', 'King Vine keeps the melon sealed');
  t.eq(state.legendary.tethers, 0, 'the run starts without ropes');
  t.eq(state.legendary.vines, 4, 'all holding vines are intact');

  // Exercise the boss's direct-hit contract without importing tools into the
  // harvest test. Action-combat tests cover actual input and tool routing.
  const won = await g.page.evaluate(() => {
    const boss = window.__GAME.get('kingVine');
    boss.phase = 'recover';
    boss.timeLeft = 10;
    const [x, y, z] = boss.center;
    const hits = [];
    for (let i = 0; i < 3; i++) {
      hits.push(boss.tryHit([x, y + 1.7, z - 10], [0, 0, 1], 'air', 'test-player'));
      boss.fixedStep(0.5);
    }
    return { subdued: boss.subdued, hits: hits.map(h => h?.kind) };
  });
  t.ok(won.subdued, 'direct air hits subdue King Vine');
  t.ok(won.hits.every(kind => kind === 'stem'), 'all hits reached exposed stem');
  await g.wait(0.1);
  state = await g.state();
  t.eq(state.legendary.phase, 'tether', 'boss victory opens the existing cut phase without gear');

  for (let i = 0; i < 4; i++) await g.call('legendary.cut', 1);
  state = await g.state();
  t.eq(state.legendary.vines, 0, 'all four vines can be cut with no tethers');
  t.eq(state.legendary.phase, 'drop', 'the unroped melon enters the drop');
  t.eq(state.legendary.dropTetherCount, 0, 'no-rope route has no tether payout bonus');

  for (let i = 0; i < 50; i++) {
    await g.wait(0.35);
    state = await g.state();
    if (state.legendary.phase !== 'drop') break;
  }
  t.ok(['recover', 'complete'].includes(state.legendary.phase),
    'no-rope drop lands in a recoverable state', `phase ${state.legendary.phase}`);
  t.lt(state.legendary.distanceToPad, 24,
    'no-rope landing is within a short haul of extraction');
  t.note(`no-rope landing ${state.legendary.distanceToPad.toFixed(1)} m from extraction, phase ${state.legendary.phase}`);
}
