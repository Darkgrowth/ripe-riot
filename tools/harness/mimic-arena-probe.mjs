// Exploratory fixed-view probe only. Acceptance recordings use ordinary input.
import { startServer, openGame } from './driver.mjs';
import { mkdirSync } from 'node:fs';

const server = await startServer();
let g;
try {
  g = await openGame({ width: 1280, height: 720, headless: true });
  if (process.env.MIMIC_STYLE) {
    await g.page.goto(`${process.env.RIPE_URL}/?mimicCompare=${process.env.MIMIC_STYLE}`,
      { waitUntil: 'domcontentloaded' });
    await g.page.waitForFunction(() => window.__RIPE_READY, null, { timeout: 90000 });
  }
  await g.pause(true);
  mkdirSync('capture/mimic-arena', { recursive: true });
  for (const [name, px, pz, mx, mz, phase, timeLeft] of [
    ['entry', -11, 24, -23, 22, 'idle', 0],
    ['lane', -17, 23, -23, 22, 'idle', 0],
    ['side', -23, 26, -23, 22, 'idle', 0],
    ['warn', -17, 23, -23, 22, 'warn', 0.22],
    ['attack', -17, 23, -23, 22, 'attack', 0.62],
    ['stagger', -17, 23, -23, 22, 'stagger', 0.4],
    ['recover', -17, 23, -23, 22, 'recover', 0.8],
    ['defeated', -17, 23, -23, 22, 'defeated', 0],
  ]) {
    await g.call('encounters.reset');
    const py = await g.terrainHeight(px, pz);
    const my = await g.terrainHeight(mx, mz);
    await g.tp(px, py + 1.2, pz);
    await g.look(Math.atan2(-(mx - px), -(mz - pz)),
      Math.atan2(my + 1.15 - py - 2.83, Math.hypot(mx - px, mz - pz)));
    await g.page.evaluate(([phase, timeLeft, px, pz, mx, mz]) => {
      const mimic = window.__GAME.get('encounters').model.get('mimic');
      mimic.phase = phase;
      mimic.timeLeft = timeLeft;
      mimic.heading = Math.atan2(px - mx, pz - mz);
      if (phase === 'defeated') mimic.health = 0;
    }, [phase, timeLeft, px, pz, mx, mz]);
    await g.idleFrames(3);
    await g.page.screenshot({ path: `capture/mimic-arena/${process.env.MIMIC_STYLE ?? 'A'}-${name}.png`, timeout: 15000 });
    console.log(name, (await g.state()).player.pos);
  }
} finally {
  await g?.close();
  if (server.proc) server.proc.kill();
}
