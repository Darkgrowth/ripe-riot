// Fixed, repeatable gameplay-camera evidence in an isolated headless browser.
// Teleports are visual fixtures, not a claim of a normal-input playthrough.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withGame, ROOT } from './driver.mjs';

const stage = process.argv[2] || 'candidate';
const out = path.join(ROOT, 'docs/evidence/sunpatch-finish', stage);
mkdirSync(out, { recursive: true });
const width = Number(process.env.RIPE_VIEW_WIDTH || 3440);
const height = Number(process.env.RIPE_VIEW_HEIGHT || 1440);
if (!(width > 0 && height > 0)) throw new Error('RIPE_VIEW_WIDTH/HEIGHT must be positive');
const manifest = { stage, viewport: [width, height], mode: null, frames: [], errors: [] };
await withGame(async g => {
  await g.pause(true);
  await g.call('encounters.suspend', true);
  await g.page.evaluate(() => {
    document.querySelector('.entry-hint')?.remove();
  });
  manifest.mode = await g.page.evaluate(() => window.__RIPE_VISUAL_MODE);
  const capture = async name => {
    await g.idleFrames(3);
    await g.page.screenshot({ path: path.join(out, `${name}.png`), timeout: 30000 });
    manifest.frames.push({ name, player: (await g.state()).player,
      render: await g.page.evaluate(() => window.__GAME.renderer.info) });
  };
  await capture('00-dock');
  for (const [name, x, z, tx, ty, tz] of [
    ['01-orchard', -20, 29, -24, 9, 16],
    ['02-palms', 17, 48, 12.5, 9, 45.5],
    ['03-shop', 42, 55, 49, 5, 47],
    ['04-hill', -30, -16, -36, 24, -30],
    ['05-ravine', -21, -34, 8, 30, -62],
    ['06-waterfall', 35, 20, 34, 13, -2],
    ['07-grove', 57, 3, 60, 6, -17],
  ]) {
    const y = await g.terrainHeight(x,z);
    await g.tp(x,y + .15,z);
    await g.look(Math.atan2(-(tx-x),-(tz-z)), Math.atan2(ty-y-1.7,Math.hypot(tx-x,tz-z)));
    await g.advance(2);
    await capture(name);
  }
  // Actual fixed-step swing lifecycle at the normal camera. Synthetic input
  // holds the same active control state as pointer lock while sampling phases.
  const y = await g.terrainHeight(-20,29);
  await g.tp(-20,y+.15,29); await g.look(.2985,-.0147);
  await g.input({}); await g.advance(45);
  await capture('08-mallet-ready');
  await g.call('tool.fire');
  await g.advance(5); await capture('09-mallet-windup');
  await g.advance(6); await capture('10-mallet-contact');
  await g.advance(10); await capture('11-mallet-recovery');
  await g.advance(30); await g.call('tool.select','basket');
  await g.advance(40); await capture('12-basket-switch');
  await g.clearInput();
  manifest.errors = g.consoleErrors;
}, { width, height, headless: true, quiet: true });
writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest,null,2));
console.log(JSON.stringify({out, frames:manifest.frames.length,errors:manifest.errors}));
