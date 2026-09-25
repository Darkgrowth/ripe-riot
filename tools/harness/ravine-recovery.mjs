// Headless gameplay check: a trapped player can recover without losing cargo
// or dismantling ropes that support somebody else's haul.
import assert from 'node:assert/strict';
import { withGame } from './driver.mjs';

await withGame(async g => {
  await g.pause(true);
  const start = (await g.state()).player.pos;
  await g.call('economy.set', 123);
  const apple = await g.call('fruit.spawn', 'apple', start[0] + 1, start[1] + 1, start[2]);
  assert.equal(await g.call('pickup', apple), true, 'setup: apple is held');
  const before = (await g.state()).interaction;
  assert.equal(before.carrying.id, apple);

  const floor = await g.terrainHeight(15.8, -57);
  await g.tp(15.8, floor + 0.1, -57);
  const ids = await g.page.evaluate(() => {
    const game = window.__GAME, ropes = game.get('ropes');
    const V = game.player.position.constructor;
    const world = (x, y, z) => ({ kind: 'world', local: new V(x, y, z), ownerId: -1 });
    const player = { kind: 'player', local: new V(), ownerId: game.player.id };
    const connected = ropes.create(player, world(15.8, 2.5, -57), 4, { shared: false });
    const slack = ropes.create(player, world(15.8, 2.5, -57), 150, { shared: false });
    const independent = ropes.create(world(8, 30, -62), world(24, 30, -62), 20,
      { shared: false });
    return { connected: connected.id, slack: slack.id, independent: independent.id };
  });

  await g.page.keyboard.down('h');
  await g.simulate(1.6);
  await g.page.keyboard.up('h');
  const after = await g.state();
  assert.equal(after.player.state, 'active', 'rescue returns player to active control');
  assert.ok(after.player.pos[2] > -47 || Math.abs(after.player.pos[0] - 15.8) > 22,
    `rescue reaches safe ground outside the lower ravine: ${after.player.pos}`);
  assert.equal(after.interaction.carrying?.id, apple, 'fruit in hands survives rescue');
  assert.equal(after.economy.money, 123, 'earned money survives rescue');
  const ropeIds = await g.page.evaluate(() => [...window.__GAME.get('ropes').ropes.keys()]);
  assert.ok(!ropeIds.includes(ids.connected), 'player-connected rope is released');
  assert.ok(ropeIds.includes(ids.slack), 'non-conflicting player rope stays connected');
  assert.ok(ropeIds.includes(ids.independent), 'independent King Melon restraint survives');

  // Automatic stand-up must also reject a torso that came to rest in the pit.
  await g.tp(15.8, floor + 0.1, -57);
  assert.equal(await g.call('ragdoll.trigger', 16, 'fall'), true, 'setup: player ragdolled');
  await g.simulate(4.2);
  const automatic = await g.state();
  assert.equal(automatic.player.state, 'active', 'ragdoll stands up automatically');
  assert.ok(automatic.player.pos[2] > -47 || Math.abs(automatic.player.pos[0] - 15.8) > 22,
    `automatic recovery also avoids the lower ravine: ${automatic.player.pos}`);
  const dropped = await g.call('fruit.info', apple);
  assert.equal(dropped.state, 'free', 'ordinary ragdoll spills fruit without deleting it');
  assert.equal(automatic.economy.money, 123, 'automatic recovery leaves progress intact');

  const westFloor = await g.terrainHeight(-20, -62);
  await g.tp(-20, westFloor + 0.1, -62);
  await g.page.keyboard.down('h');
  await g.simulate(1.6);
  await g.page.keyboard.up('h');
  const west = (await g.state()).player;
  assert.ok(west.pos[2] > -47 || west.pos[0] >= -8 || west.pos[0] <= -35,
    `west pocket rescue also reaches safe ground: ${west.pos}`);
  assert.equal(west.state, 'active', 'west rescue returns player to active control');

  const errors = g.consoleErrors.filter(s => !s.includes('GPU stall due to ReadPixels'));
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('ravine rescue: active, safe, cargo/progress kept, only connected rope released');
}, { headless: true, quiet: true, islandActivities: false, drawFrames: false });
process.exit(0);
