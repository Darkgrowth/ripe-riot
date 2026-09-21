export const name = 'island-events';

export async function run(g, t) {
  const info = () => g.page.evaluate(() => window.__GAME.get('director').netState());
  await g.call('legendary.reset');
  await g.call('shop.close'); await g.call('book.close');
  await g.standAt(-24, 22);
  t.ok(await g.call('director.start', 'windfall'), 'windfall selects real orchard fruit');
  const first = await info();
  t.between(first.event.targets.length, 3, 8, 'windfall bounded to eight existing fruit');
  t.eq(first.event.phase, 'warning', 'physical event starts with warning');
  await g.wait(7.8);
  t.eq((await info()).event.released, 0, 'warning does not detach fruit early');
  await g.wait(.3);
  t.eq((await info()).event.phase, 'active', 'eight-second warning enters release phase');
  t.gt((await info()).event.released, 0, 'release begins through real physics');
  await g.wait(6);
  const released = await info();
  t.eq(released.event.released, first.event.targets.length, 'each selected slot released exactly once');
  for (const id of first.event.targets) {
    const f = await g.call('fruit.info', id);
    t.ok(!f || f.state !== 'attached', `target ${id} no longer attached`);
  }
  const seq = (await g.state()).net.nodeSeq;
  await g.page.evaluate(s => { const d = window.__GAME.get('director'); d.applyNet(s); d.applyNet(s); }, released);
  await g.wait(.3);
  t.eq((await g.state()).net.nodeSeq, seq, 'replaying state cannot release targets twice');
  await g.wait(19);
  t.eq((await info()).event.phase, 'idle', 'physical event resolves back to free harvesting');
  t.between((await info()).cooldown, 110, 180, 'quiet interval follows event');

  await g.call('director.reset');
  await g.call('shop.open');
  t.eq(await g.call('director.start', 'windfall'), false, 'shopping excludes new disruptions');
  await g.call('shop.close');
  await g.page.evaluate(() => { window.__GAME.get('legendary').phase = 'drop'; });
  t.eq(await g.call('director.start', 'windfall'), false, 'King Melon drop excludes new events');
  await g.call('legendary.reset');
  await g.standAt(100, 100);
  t.eq(await g.call('director.start', 'windfall'), false, 'no eligible cluster means no fake windfall');

  await g.standAt(-24, 22);
  t.ok(await g.call('director.start', 'order'), 'rush order begins');
  t.eq((await info()).event.goal, 6, 'first order asks for six apples/oranges');
  await g.call('fruit.despawnAllFree'); await g.call('basket.clear');
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const p = (await g.state()).player.pos;
    const id = await g.call('fruit.spawn', i % 2 ? 'orange' : 'apple', p[0] + .65, p[1] + 1, p[2]);
    ids.push(id); t.ok(await g.call('pickup', id), `actual pickup ${i + 1}`);
    await g.wait(.03);
  }
  const world = await g.call('world.info');
  await g.standAt(world.sellPad[0], world.sellPad[2]);
  let total = 0;
  const beforeMoney = (await g.state()).economy.money;
  // Itemized sale value is observed from the same event used by presentation;
  // reward must be separate from, and exactly additive to, ordinary fruit pay.
  await g.page.evaluate(() => {
    window.__islandSaleValue = 0;
    window.__islandSaleOff = window.__GAME.bus.on('fruit:sold', p => window.__islandSaleValue += p.value);
  });
  await g.call('sell'); await g.wait(.2);
  total = await g.page.evaluate(() => window.__islandSaleValue);
  const paid = await info();
  t.eq(paid.event.progress, 6, 'six actual fruit sales fill order');
  t.eq(paid.event.result, 'success', 'order succeeds');
  t.eq(paid.event.paid, true, 'reward latched');
  t.eq((await g.state()).economy.money - beforeMoney, total + 60, 'normal value plus exactly $60 bonus');
  const balance = (await g.state()).economy.money;
  await g.call('sell'); await g.wait(.2);
  t.eq((await g.state()).economy.money, balance, 'repeated sell cannot repeat reward');
  await g.page.evaluate(() => window.__islandSaleOff());
  const saved = await g.page.evaluate(() => window.__GAME.get('director').serialize());
  await g.page.evaluate(s => window.__GAME.get('director').deserialize(s), saved);
  t.eq((await info()).event.phase, 'idle', 'disk load cancels transient event');
  t.gte((await info()).cooldown, 30, 'disk load provides grace period');
  t.eq((await g.state()).economy.money, balance, 'loading director never mutates earned money');

  await g.call('tool.give', 'net');
  t.ok(await g.call('director.start', 'order'), 'later order available with net');
  t.eq((await info()).event.goal, 4, 'later order asks for four coconuts');
  t.eq((await info()).event.remaining, 120, 'coconut order allows two minutes');
  t.eq((await info()).event.reward, 120, 'coconut order bonus is $120');
  await g.standAt(-24, 22);
  for (let i = 0; i < 4; i++) {
    const p = (await g.state()).player.pos;
    const id = await g.call('fruit.spawn', 'coconut', p[0] + .65, p[1] + 1, p[2], null, 0.5);
    t.ok(await g.call('pickup', id), `actual coconut pickup ${i + 1}`);
    await g.wait(.03);
  }
  await g.standAt(world.sellPad[0], world.sellPad[2]);
  await g.page.evaluate(() => {
    window.__islandSaleValue = 0;
    window.__islandSaleOff = window.__GAME.bus.on('fruit:sold', p => window.__islandSaleValue += p.value);
  });
  const coconutBefore = (await g.state()).economy.money;
  await g.call('sell'); await g.wait(.2);
  const coconutValue = await g.page.evaluate(() => window.__islandSaleValue);
  t.eq((await info()).event.progress, 4, 'four real coconut sales complete later order');
  t.eq((await g.state()).economy.money - coconutBefore, coconutValue + 120, 'normal coconut value plus exactly $120');
  await g.page.evaluate(() => window.__islandSaleOff());

  await g.call('director.reset');
  t.ok(await g.call('director.start', 'order'), 'second isolated order begins');
  const original = (await g.state()).economy.money;
  await g.wait(90.2);
  t.eq((await info()).event.result, 'missed', 'unfilled order expires');
  t.eq((await g.state()).economy.money, original, 'missed order removes no money');
  await g.call('director.reset');
  await g.standAt(52.5, 63.5);
  await g.call('tool.give', 'net');
  t.ok(await g.call('director.start', 'coconuts'), 'forecast selects real nearby coconuts');
  t.between((await info()).event.targets.length, 3, 6, 'forecast limited to six coconuts');
  await g.wait(14.1);
  const coconut = await info();
  t.eq(coconut.event.released, coconut.event.targets.length, 'forecast uses staggered physical releases');
  await g.call('director.reset');
}
