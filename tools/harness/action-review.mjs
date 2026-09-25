// Gameplay-camera review frames for the action-harvest route.
import path from 'node:path';
import { withGame, ensureOut, sleep } from './driver.mjs';

const dir = ensureOut('action-review');
await withGame(async (g) => {
  await g.page.evaluate(() => {
    for (const selector of ['.entry-hint', '.celebrate', '.toasts'])
      document.querySelector(selector).style.display = 'none';
  });
  await g.page.screenshot({ path: path.join(dir, '00-spawn.png'), timeout: 10_000 });
  const place = async (name, x, z, atX, atY, atZ, distance = 0) => {
    const y = await g.terrainHeight(x, z);
    await g.tp(x, y + 1.2, z);
    const yaw = Math.atan2(-(atX - x), -(atZ - z));
    const pitch = Math.atan2(atY - y - 1.7,
      Math.max(0.05, Math.hypot(atX - x, atZ - z)));
    await g.look(yaw, pitch);
    await sleep(distance || 350);
    const file = path.join(dir, `${name}.png`);
    await g.page.screenshot({ path: file, timeout: 10_000 });
    console.log(`${name} ${file}`);
  };

  await place('01-route', 31, 50, 15, 6, 42);
  const enemies = await g.call('encounters.info');
  for (const [name, offset] of [['spitter', 7], ['mimic', 7], ['snapjaw', 6]]) {
    await g.call('encounters.reset');
    const [x, y, z] = enemies.threats[name].pos;
    await place(`0${name === 'spitter' ? 2 : name === 'mimic' ? 3 : 4}-${name}`,
      name === 'mimic' ? -24 : x, name === 'mimic' ? 22 : z + offset,
      x, y + 1.3, z);
  }
  const boss = await g.call('kingVine.info');
  const [bx, by, bz] = boss.center;
  await place('05-king-vine', bx + 8, bz + 12, bx, by + 1.7, bz, 2200);
}, { width: 1280, height: 720, headless: true, quiet: true, islandActivities: false });
