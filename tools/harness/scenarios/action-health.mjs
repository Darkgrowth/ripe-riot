export const name = 'action-health';

export async function run(g, t) {
  const vitals = () => g.page.evaluate(() => {
    const v = window.__GAME.get('vitals');
    return { health: v.health, downed: v.downed, wiped: v.wiped, state: window.__GAME.player.state };
  });
  const initial = await vitals();
  t.eq(initial.health, 100, 'the player enters Sunpatch at full health');

  const fruitId = await g.call('fruit.spawn', 'apple', -24, 11, 22);
  await g.wait(0.4);
  t.ok(await g.call('pickup', fruitId), 'the player can secure a small harvest');
  await g.call('stow');
  const haul = (await g.state()).interaction.basket;
  t.gt(haul, 0, 'the basket contains unsecured fruit');

  await g.page.evaluate(() => window.__GAME.get('vitals').damage(100, 'Snapjaw'));
  await g.wait(0.25);
  const down = await vitals();
  t.ok(down.downed && down.state === 'downed', 'a serious attack downs the player');
  t.eq((await g.state()).interaction.basket, haul, 'downing does not erase the haul before rescue');

  await g.wait(3.3);
  const recovered = await vitals();
  t.ok(!recovered.downed && recovered.health > 0, 'solo recovery returns the player to play');
  t.eq((await g.state()).interaction.basket, haul, 'solo recovery keeps the unsecured haul');
}
