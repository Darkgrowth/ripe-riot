// Reach the southern rim using ordinary movement, without any rescue action.
import assert from 'node:assert/strict';
import { withGame } from './driver.mjs';

await withGame(async g => {
  await g.pause(true);
  for (const route of [
    { name: 'east', x: 15.8, z: -57, yaw: Math.PI - 0.1 },
    { name: 'west', x: -20, z: -62, yaw: -2.72 },
  ]) {
    const y = await g.terrainHeight(route.x, route.z);
    await g.tp(route.x, y + 0.1, route.z);
    await g.look(route.yaw, 0);
    await g.simulate(0.3);
    await g.input({ moveZ: 1 });
    await g.simulate(4.5);
    await g.clearInput();
    const p = (await g.state()).player;
    const ground = await g.terrainHeight(p.pos[0], p.pos[2]);
    assert.ok(p.pos[2] > -44, `${route.name}: walking south reaches the exit: ${p.pos}`);
    assert.ok(p.pos[1] > 7, `${route.name}: exit rises to higher ground: ${p.pos}`);
    assert.ok(p.pos[1] >= ground - 0.1, `${route.name}: player stays above the terrain: ${p.pos}, ground ${ground}`);
    assert.equal(p.state, 'active', `${route.name}: player stays in control`);
    console.log(`${route.name} ravine walk: exited at (${p.pos.map(v => v.toFixed(1)).join(', ')})`);
  }
  const errors = g.consoleErrors.filter(s => !s.includes('GPU stall due to ReadPixels'));
  assert.deepEqual(errors, [], 'no browser errors');
}, { headless: true, quiet: true, islandActivities: false, drawFrames: false });
process.exit(0);
