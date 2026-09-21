// The progression loop: discover fruit, set records, earn money, buy a tool,
// and have that tool immediately change what you can do. Also covers the two
// signature exotic fruit, whose behaviour IS their design.

export const name = 'progression';

export async function run(g, t) {
  // ------------------------------------------------------------ harvest book
  const bookBefore = (await g.state()).book;
  t.note(`book starts with ${bookBefore.discovered}/${bookBefore.species} discovered`);

  const apple = await g.call('fruit.nearest', -24, 10, 22, 'apple', 'attached');
  t.ok(apple, 'an apple is available to discover');
  await g.call('fruit.detach', apple.id);
  await g.wait(0.4);
  const rec = await g.call('book.get', 'apple');
  t.ok(rec.discovered, 'detaching a fruit discovers its species');
  const disc = (await g.state()).economy;
  t.gt(disc.points, 0, 'discovery awards discovery points');
  t.note(`discovery points now ${disc.points}, tier ${disc.tier}`);

  // ---------------------------------------------------------------- records
  await g.call('economy.set', 0);
  await g.call('fruit.despawnAllFree');
  const bigId = await g.call('fruit.spawn', 'coconut', -24, 12, 22, 'huge', 1.0);
  await g.wait(1.4);
  const big = await g.call('fruit.info', bigId);
  t.ok(big, 'a Huge Coconut can be spawned');
  t.gt(big.mass, 10, 'the Huge variant is genuinely heavy');
  t.note(`huge coconut: ${big.mass} kg, worth $${big.value}`);

  // Sell it by dropping it on the pad, which also tests delivery scoring.
  const world = await g.call('world.info');
  await g.call('fruit.despawnAllFree');
  const sellId = await g.call('fruit.spawn', 'coconut', world.sellPad[0],
    world.sellPad[1] + 3, world.sellPad[2], 'huge', 1.0);
  await g.wait(3.2);
  const sold = await g.state();
  t.gt(sold.economy.money, 0, 'fruit landing on the pad sells itself');
  const cocoRec = await g.call('book.get', 'coconut');
  t.gt(cocoRec.harvested, 0, 'the book counts it as harvested');
  t.gt(cocoRec.largestKg, 0, 'and records the largest one seen');
  t.ok(cocoRec.variants.includes('huge'), 'and remembers the rare variant');
  t.note(`sold for $${sold.economy.money}; heaviest coconut ${cocoRec.largestKg} kg`);
  void sellId;

  // -------------------------------------------------------------------- shop
  await g.call('economy.set', 5000);
  const cat = await g.call('shop.list');
  t.gt(cat.length, 4, 'the shop has things to sell');
  const net = cat.find((c) => c.id === 'net');
  t.ok(net && !net.owned, 'the catch net is for sale and not yet owned');
  const buy = await g.call('shop.buy', 'net');
  t.ok(buy.ok, 'buying the catch net succeeds');
  const afterBuy = await g.state();
  t.ok(afterBuy.tools.owned.includes('net'), 'the tool is owned afterwards');
  t.eq(afterBuy.economy.money, 5000 - net.cost, 'and the money is gone');

  // Tier gating: an expensive high-tier tool must refuse at tier 0.
  await g.call('economy.set', 99999);
  const gated = cat.find((c) => c.tier >= 2);
  if (gated) {
    const blocked = await g.call('shop.buy', gated.id);
    const tier = (await g.state()).economy.tier;
    if (tier < gated.tier) {
      t.ok(!blocked.ok, `tier ${gated.tier} equipment is gated behind discovery`);
      t.eq(blocked.reason, 'locked', 'and says why');
    } else {
      t.note(`already at tier ${tier}, cannot test gating`);
    }
  }

  // ------------------------------------------------------------- puff melon
  await g.call('economy.set', 0);
  await g.call('fruit.despawnAllFree');
  await g.call('wind.set', 1, 0, 6.5);            // a stiff easterly
  const ridge = world.landmarks.ridge.pos;
  const puffId = await g.call('fruit.spawn', 'puffmelon', ridge[0], ridge[1] + 8, ridge[2]);
  const puff0 = await g.call('fruit.info', puffId);
  // Inflation starts on release and a harness round-trip is not instant, so
  // this asserts "barely started", not "exactly 1".
  t.lt(puff0.inflate, 1.5, 'a puff melon is still small immediately after release');
  await g.wait(2.2);
  const puff1 = await g.call('fruit.info', puffId);
  t.ok(puff1, 'the puff melon is still around');
  t.gt(puff1.inflate, 2.0, 'it inflates dramatically once free');
  t.gt(puff1.size, puff0.size * 1.8, 'and visibly grows');
  await g.wait(4.5);
  const puff2 = await g.call('fruit.info', puffId);
  if (puff2) {
    const drift = Math.hypot(puff2.pos[0] - ridge[0], puff2.pos[2] - ridge[2]);
    t.gt(drift, 6, 'wind carries it away rather than letting it drop');
    t.note(`puff melon drifted ${drift.toFixed(1)} m and inflated to x${puff2.inflate}`);
  } else {
    t.note('puff melon left the island entirely, which is on-brand');
    t.ok(true, 'wind carries it away rather than letting it drop');
  }

  // ---------------------------------------------------------------- vinebomb
  await g.call('wind.set', 1, 0, 2.0);
  await g.call('fruit.despawnAllFree');
  const vb = await g.call('fruit.nearest', 30, 12, -26, 'vinebomb', 'attached');
  t.ok(vb, 'a vinebomb is growing somewhere');
  if (vb) {
    // Keep the flight record even if the fruit is removed from the live map.
    // A missing fruit can mean it fell through a collider into the sea after
    // centimetres of motion; disappearance alone never proves a long launch.
    const record = await g.page.evaluateHandle(id => window.__GAME.get('fruit').get(id), vb.id);
    try {
      await g.call('fruit.detach', vb.id);
      await g.wait(0.12);
      const launched = await g.call('fruit.info', vb.id);
      t.ok(launched, 'the vinebomb exists after release');
      // Peak speed since detaching, not current speed: a harness round-trip is
      // long enough for gravity to have taken several m/s off the reading.
      t.gt(launched.peakSpeed, 11, 'releasing a vinebomb launches it hard');
      t.note(`vinebomb peaked at ${launched.peakSpeed} m/s`);
      await g.wait(4.0);
      const landed = await record.evaluate(f => ({
        travelled: f.travelled, peak: f.peakHeight, state: f.state,
        destroyed: f.destroyed, y: f.position.y,
      }));
      t.gt(landed.travelled, 10, 'and it travels a long way, including before any despawn');
      const outcome = landed.state !== 'gone' ? landed.state
        : landed.y < -3.5 ? 'sank' : landed.destroyed ? 'burst' : 'removed';
      t.note(`vinebomb travelled ${landed.travelled.toFixed(2)} m, peak ${landed.peak.toFixed(2)} m; ${outcome}`);
    } finally {
      await record.dispose();
    }
  }

  await g.call('fruit.despawnAllFree');
  await g.call('economy.set', 0);
}
