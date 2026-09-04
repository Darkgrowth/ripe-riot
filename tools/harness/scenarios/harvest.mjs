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

  // --- stand under it and look up. Stand on the OUTSIDE of the fruit, away
  // from the trunk: a fixed offset put the player inside the trunk collider
  // whenever the nearest apple happened to hang on the far side of the tree.
  const outward = (f, dist) => {
    const dx = f.pos[0] - tree.pos[0], dz = f.pos[2] - tree.pos[2];
    const d = Math.hypot(dx, dz) || 1;
    return [f.pos[0] + (dx / d) * dist, f.pos[2] + (dz / d) * dist];
  };
  const [sx, sz] = outward(apple, 1.5);
  await g.standAt(sx, sz, 0, 0.4);
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
  const stuntsBefore = (await g.state()).scoring.totalAwarded;
  let picked = 1;
  for (let i = 0; i < 7 && picked < 6; i++) {
    const nxt = await g.call('fruit.nearest', tree.pos[0], tree.pos[1] + 3, tree.pos[2],
      'apple', 'attached');
    if (!nxt || nxt.dist > 7) break;
    const [nx, nz] = outward(nxt, 1.4);
    await g.standAt(nx, nz, 0, 0.4);
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

  // --- reaching up and taking an apple is not a stunt.
  //
  // It used to award one on every single pick: banking an undamaged fruit
  // scored ZERO DAMAGE at x1.30, and since a hand-picked apple has by
  // definition never been damaged, the most routine action in the game threw
  // a gold chip and a fanfare. A reward that fires every time is how you
  // teach somebody to stop reading the reward layer.
  t.eq(state.scoring.totalAwarded, stuntsBefore,
    'filling a basket by hand off a branch earns no stunts at all');

  // --- walk to the sell pad and sell
  const moneyBefore = state.economy.money;
  const basketValue = state.interaction.basketValue
    + (state.interaction.carrying ? 1 : 0) * 12;

  await g.call('economy.set', 0);
  const world = await g.call('world.info');
  const [padX, , padZ] = world.sellPad;
  t.note(`sell pad at ${world.sellPad.join(', ')} radius ${world.sellRadius}`);

  await g.standAt(padX, padZ, 0, 0.8);
  await g.wait(0.4);
  let onPad = (await g.state()).interaction.nearSellPad;
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

  // --- fruit that lands on the pad should sell itself, so that firing produce
  //     at the shop from a hilltop is a legitimate way to play
  await g.call('economy.set', 0);
  await g.call('fruit.despawnAllFree');
  await g.call('fruit.spawn', 'apple', world.sellPad[0], world.sellPad[1] + 4, world.sellPad[2]);
  let delivered = 0;
  for (let i = 0; i < 60; i++) {
    await g.wait(0.05);
    delivered = (await g.state()).economy.money;
    if (delivered > 0) break;
  }
  t.gt(delivered, 0, 'an apple dropped on the pad sells itself');
  t.note(`auto-delivery paid $${delivered}`);
  await g.call('fruit.despawnAllFree');

  // --- the same pick, on the left mouse button.
  //
  // This is the first button every player presses and with empty hands it used
  // to do nothing at all; picking is on E and on right-click. It has to work
  // through the real latched-edge input path, and — the part that is easy to
  // get wrong — releasing the click that picked something must not
  // immediately throw it, because the same button is also the throw.
  await g.call('drop');
  const lmbTree = await g.call('plant.nearest', -24, 8, 22, 'appleTree', true);
  const lmbApple = lmbTree && await g.call('fruit.nearest',
    lmbTree.pos[0], lmbTree.pos[1] + 3, lmbTree.pos[2], 'apple', 'attached');
  t.ok(lmbApple, 'an apple is still growing for the left-click test');
  if (lmbApple) {
    const dx = lmbApple.pos[0] - lmbTree.pos[0], dz = lmbApple.pos[2] - lmbTree.pos[2];
    const d = Math.hypot(dx, dz) || 1;
    await g.standAt(lmbApple.pos[0] + (dx / d) * 1.5, lmbApple.pos[2] + (dz / d) * 1.5, 0, 0.4);
    await g.faceTo(lmbApple.pos[0], lmbApple.pos[1], lmbApple.pos[2]);
    await g.wait(0.3);
    await g.input({ primary: true, primaryPressed: true });
    await g.wait(1 / 60);
    await g.input({ primary: true });
    await g.wait(0.35);
    const held = (await g.state()).interaction.carrying;
    t.ok(held && held.id === lmbApple.id, 'left-click picks with empty hands');
    await g.input({ primary: false, primaryReleased: true });
    await g.wait(1 / 60);
    await g.clearInput();
    await g.wait(0.3);
    const still = (await g.state()).interaction.carrying;
    t.ok(still && still.id === lmbApple.id,
      'and releasing that same click does not throw it straight back');
  }
  await g.call('drop');
  await g.call('fruit.despawnAllFree');
}
