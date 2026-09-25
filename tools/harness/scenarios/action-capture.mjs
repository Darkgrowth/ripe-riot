export const name = 'action-capture';

export async function run(g, t) {
  const before = await g.call('encounters.info');
  const [x, , z] = before.threats.snapjaw.pos;
  await g.standAt(x, z - 1.9);
  await g.wait(1.1);
  const bitten = await g.page.evaluate(() => {
    const game = window.__GAME;
    return { captured: game.get('encounters').isCaptured('solo'),
      state: game.player.state, health: game.get('vitals').health };
  });
  t.ok(bitten.captured, 'Snapjaw closes on a player who ignores its warning');
  t.eq(bitten.state, 'captured', 'a caught player cannot walk away');
  t.lt(bitten.health, 100, 'the bite applies real health damage');

  await g.page.evaluate(() => { window.__GAME.input.synthetic = { interact: true }; });
  await g.wait(0.65);
  await g.clearInput();
  const freed = await g.page.evaluate(() => {
    const game = window.__GAME;
    return { captured: game.get('encounters').isCaptured('solo'), state: game.player.state };
  });
  t.ok(!freed.captured, 'holding E pries the jaw open after the bite settles');
  t.eq(freed.state, 'active', 'escaping returns movement without evacuation');
}
