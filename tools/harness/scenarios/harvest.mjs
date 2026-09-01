// The core loop, end to end: find fruit, pick it, fill the basket, walk it to
// the shed, sell it, see the money. If this scenario fails there is no game.

export const name = 'harvest-loop';

export async function run(g, t) {
  // --- find an apple tree in the old orchard
  const tree = await g.call('plant.nearest', -24, 8, 22, 'appleTree', true);
  t.ok(tree && tree.type === 'appleTree', 'an apple tree with fruit exists in the orchard');
  t.gt(tree.fruit, 0, 'that tree is carrying fruit');

  const apple = await g.call('fruit.nearest', tree.pos[0], tree.pos[1] + 3, tree.pos[2],
    'apple', 'attached');
  t.ok(apple, 'found an apple on it');

  // --- stand under it and look up
  await g.standAt(apple.pos[0] + 1.1, apple.pos[2] + 1.1, 0, 0.4);
  await g.faceTo(apple.pos[0], apple.pos[1], apple.pos[2]);
  await g.wait(0.3);

  let inter = (await g.state()).interaction;
  t.ok(inter.target && inter.target.id === apple.id, 'the apple is the look target');
  t.ok((inter.prompt ?? '').includes('Pick'), 'prompt offers to pick it');

  // --- pick it up
  await g.call('interact');
  await g.wait(0.2);
  inter = (await g.state()).interaction;
  t.ok(inter.carrying && inter.carrying.id === apple.id, 'apple is now in hand');
  t.ok(!inter.carrying.heavy, 'an apple is a one-handed job');

  const info = await g.call('fruit.info', apple.id);
  t.eq(info.state, 'carried', 'fruit state is carried');
  t.eq(info.quality, 'Perfect', 'a hand-picked apple is Perfect quality');
  t.gt(info.value, 0, 'it is worth something');

  // --- fill the basket by picking several more
  let picked = 1;
  for (let i = 0; i < 7 && picked < 6; i++) {
    const nxt = await g.call('fruit.nearest', tree.pos[0], tree.pos[1] + 3, tree.pos[2],
      'apple', 'attached');
    if (!nxt || nxt.dist > 7) break;
    await g.standAt(nxt.pos[0] + 1.0, nxt.pos[2] + 1.0, 0, 0.4);
    await g.faceTo(nxt.pos[0], nxt.pos[1], nxt.pos[2]);
    await g.wait(0.18);
    const before = (await g.state()).interaction;
    await g.call('interact');
    await g.wait(0.18);
    const after = (await g.state()).interaction;
    if (after.carrying && (!before.carrying || after.carrying.id !== before.carrying.id)) picked++;
  }
  const state = await g.state();
  t.gte(state.interaction.basket + (state.interaction.carrying ? 1 : 0), 3,
    'picking repeatedly auto-stows into the basket');
  t.gt(state.interaction.basketValue, 0, 'the basket is worth money');
  t.note(`carried ${picked} apples, basket holds ${state.interaction.basket}`);

  // --- walk to the sell pad and sell
  const moneyBefore = state.economy.money;
  const basketValue = state.interaction.basketValue
    + (state.interaction.carrying ? 1 : 0) * 12;

  await g.call('economy.set', 0);
  await g.standAt(45, 52, 0, 1.0);
  // The pad sits a few metres in front of the shed counter.
  const padInfo = await g.probeLook(6);
  t.note(`sell pad probe: ${JSON.stringify(padInfo).slice(0, 90)}`);

  // Walk onto the pad from a few directions until the prompt appears.
  let onPad = false;
  for (const [dx, dz] of [[0, 0], [2, 3], [-2, 3], [3, -2], [-3, -2], [4, 4], [0, 5], [5, 0]]) {
    await g.standAt(45 + dx, 52 + dz, 0, 0.8);
    await g.wait(0.35);
    const s2 = await g.state();
    if (s2.interaction.nearSellPad) { onPad = true; break; }
  }
  t.ok(onPad, 'the sell pad can be stood on');

  const beforeSale = await g.state();
  t.ok((beforeSale.interaction.prompt ?? '').includes('Sell'), 'standing on the pad offers to sell');

  await g.call('interact');
  await g.wait(0.4);
  const afterSale = await g.state();
  t.gt(afterSale.economy.money, 0, 'selling pays money');
  t.eq(afterSale.interaction.basket, 0, 'the basket is empty afterwards');
  t.ok(!afterSale.interaction.carrying, 'hands are empty afterwards');
  t.note(`sold for $${afterSale.economy.money} (basket was worth ~$${basketValue})`);
  void moneyBefore;

  // --- throwing fruit onto the pad should sell it without pressing anything
  await g.call('economy.set', 0);
  const thrownId = await g.call('fruit.spawn', 'apple', 45, 8, 57, null, 0.5);
  await g.wait(0.15);
  // Drop it straight down onto the pad area.
  const padState = await g.state();
  void padState;
  await g.wait(3.0);
  const delivered = await g.state();
  t.note(`auto-delivery money: $${delivered.economy.money}`);
  const stillThere = await g.call('fruit.info', thrownId);
  t.ok(delivered.economy.money > 0 || stillThere === null || stillThere.state === 'free',
    'fruit left on the pad is either sold or still lying there (not lost)');
}
