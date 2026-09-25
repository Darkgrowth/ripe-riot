export const name = 'action-quest';

export async function run(g, t) {
  const initial = await g.call('progress.info');
  t.ok(initial.objective?.includes('orchard'), 'the opening objective sends players to a nearby harvest');
  const visible = await g.page.evaluate(() => document.querySelector('.objective')?.textContent);
  t.ok(visible?.includes('orchard'), 'the current goal is visible without opening a menu');

  await g.page.evaluate(() => window.__GAME.bus.emit('encounter:defeated', {
    kind: 'snapjaw', position: window.__GAME.player.position.clone(), actorId: '',
  }));
  const early = await g.call('progress.info');
  t.ok(!early.objective?.includes('King'), 'skipping the first encounter does not make the boss the next objective');

  await g.page.evaluate(() => window.__GAME.bus.emit('encounter:defeated', {
    kind: 'mimic', position: window.__GAME.player.position.clone(), actorId: '',
  }));
  const after = await g.call('progress.info');
  t.ok(after.objective?.includes('Spitter'), 'the third distinct threat is next on the route');

  await g.page.evaluate(() => window.__GAME.bus.emit('encounter:defeated', {
    kind: 'spitter', position: window.__GAME.player.position.clone(), actorId: '',
  }));
  const cleared = await g.call('progress.info');
  t.ok(cleared.objective?.includes('King'), 'clearing all three threats points to King Vine');

  await g.call('progress.reset');
}
