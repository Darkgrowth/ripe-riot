// Ropes carry the whole late game — tethering, winching, the legendary — so
// the constraint itself gets tested in isolation, not only through the systems
// built on top of it.

export const name = 'ropes';

export async function run(g, t) {
  await g.call('rope.clear');
  await g.call('fruit.despawnAllFree');

  const groundY = await g.terrainHeight(-24, 22);
  const anchorY = groundY + 20;

  // A heavy fruit hung from a fixed point well above it must NOT reach the
  // ground: that is the entire contract of a rope.
  const id = await g.call('fruit.spawn', 'watermelon', -24, anchorY - 2, 22);
  await g.wait(0.1);
  // Ends are tied BY IDENTITY: a world point and a fruit id, never a body.
  const roped = await g.call('rope.tieFruit', id, -24, anchorY, 22, 4.0, 1e9);
  t.ok(roped !== null, 'a rope can be created between a fixed point and a fruit');

  await g.wait(2.5);
  const hung = await g.call('fruit.info', id);
  t.ok(hung, 'the roped fruit still exists');
  const drop = anchorY - hung.pos[1];
  t.lt(drop, 5.5, 'a 4 m rope stops a watermelon within about 4 m of its anchor');
  t.gt(hung.pos[1], groundY + 8, 'and it is left hanging well clear of the ground');
  t.note(`hung ${drop.toFixed(2)} m below a 4 m rope, ${(hung.pos[1] - groundY).toFixed(1)} m above ground`);

  const ropeState = (await g.state()).ropes;
  t.gt(ropeState.list[0].tension, 100, 'the rope reports real tension while loaded');
  t.note(`tension ${ropeState.list[0].tension.toFixed(0)} N holding ${hung.mass} kg`);

  // Winching in must lift it.
  const beforeWinch = (await g.call('fruit.info', id)).pos[1];
  await g.page.evaluate((ropeId) => {
    window.__GAME.get('ropes').setReel(ropeId, -1.2);
  }, roped);
  await g.wait(2.0);
  await g.page.evaluate((ropeId) => {
    window.__GAME.get('ropes').setReel(ropeId, 0);
  }, roped);
  const afterWinch = (await g.call('fruit.info', id)).pos[1];
  t.gt(afterWinch, beforeWinch + 0.6, 'winching the rope in lifts the load');
  t.note(`winched from ${beforeWinch.toFixed(1)} to ${afterWinch.toFixed(1)} m`);

  // Paying out must lower it.
  await g.page.evaluate((ropeId) => {
    window.__GAME.get('ropes').setReel(ropeId, 2.0);
  }, roped);
  await g.wait(2.0);
  await g.page.evaluate((ropeId) => {
    window.__GAME.get('ropes').setReel(ropeId, 0);
  }, roped);
  const afterPayout = (await g.call('fruit.info', id)).pos[1];
  t.lt(afterPayout, afterWinch - 0.6, 'paying the rope out lowers the load');
  t.note(`paid out to ${afterPayout.toFixed(1)} m`);

  // A rope under more load than it can bear must part.
  await g.call('rope.clear');
  await g.call('fruit.despawnAllFree');
  const heavyId = await g.call('fruit.spawn', 'watermelon', -24, anchorY - 2, 22, 'ancient');
  await g.wait(0.1);
  await g.call('rope.tieFruit', heavyId, -24, anchorY, 22, 4.0, 600);
  await g.wait(2.5);
  const snapped = (await g.state()).ropes.count;
  t.eq(snapped, 0, 'a rope past its rated tension snaps');

  // --- a rope follows the fruit it is tied to, on and off the branch.
  //
  // The first rope system tied a line fired at an apple on the tree to a
  // point in the air where the apple's surface was; when the apple came
  // down the rope stayed up. Ends are resolved by fruit id every step now, so
  // the same rope holds the same apple before and after the stem breaks.
  await g.call('rope.clear');
  await g.call('fruit.despawnAllFree');
  const onTree = await g.call('fruit.nearest', -24, 10, 22, 'apple', 'attached');
  t.ok(onTree, 'an apple is still on a branch');
  if (onTree) {
    const [fx, fy, fz] = onTree.pos;
    // Anchor a short rope from well above the apple, then break the stem.
    const followId = await g.call('rope.tieFruit', onTree.id, fx, fy + 3.0, fz, 2.4, 1e9);
    await g.wait(0.2);
    const before = (await g.state()).ropes.list.find((r) => r.id === followId);
    t.ok(before && before.bk === 'fruit', 'the rope is tied to the fruit, not to a point in the air');
    await g.call('fruit.detach', onTree.id);
    await g.wait(2.0);
    const after = (await g.state()).ropes.list.find((r) => r.id === followId);
    const fallen = await g.call('fruit.info', onTree.id);
    t.ok(after, 'the rope survives the stem breaking');
    t.ok(fallen && fallen.state === 'free', 'and the apple is loose');
    if (fallen) {
      t.lt(fy + 3.0 - fallen.pos[1], 3.6, 'and hangs from the rope instead of hitting the ground');
      t.note(`apple hangs ${(fy + 3.0 - fallen.pos[1]).toFixed(2)} m below a 2.4 m rope`);
    }
  }

  await g.call('rope.clear');
  await g.call('fruit.despawnAllFree');
}
