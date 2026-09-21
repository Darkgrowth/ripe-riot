// The HUD is HTML, not canvas.
//
// Every other capture in this harness reads the WebGL canvas directly, which
// is correct for the world and blind to the overlay: `carry`, the prompt, the
// slots and the toasts are DOM, and none of them appear in a single existing
// screenshot. This reads the overlay's own markup and writes one composited
// image of canvas + HUD so a change to either can actually be looked at.
//
//   node tools/harness/hud-check.mjs

import { withGame, ensureOut } from './driver.mjs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const SUB = 'hud';
let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
};

const hud = (g) => g.page.evaluate(() => ({
  carry: document.querySelector('.carry')?.innerHTML ?? '',
  prompt: document.querySelector('.prompt')?.innerHTML ?? '',
}));

/**
 * Composite the canvas and the HUD into one PNG.
 *
 * `page.screenshot()` is banned in this project because the game never stops
 * animating and Playwright's stability wait never settles. Painting the canvas
 * into an offscreen 2D context and then drawing the overlay's own text on top
 * sidesteps that entirely — it is the same trick `shot()` uses, with the DOM
 * layer added.
 */
async function composite(g, name) {
  const data = await g.page.evaluate(() => {
    const src = document.getElementById('view');
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    const draw = (el, align) => {
      if (!el || !el.textContent.trim()) return;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      x.save();
      x.fillStyle = 'rgba(12,22,32,0.62)';
      x.beginPath();
      const rad = Math.min(14, r.height / 2);
      x.roundRect(r.left, r.top, r.width, r.height, rad);
      x.fill();
      x.fillStyle = cs.color || '#fff';
      x.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      x.textAlign = align;
      x.textBaseline = 'middle';
      x.fillText(el.textContent.replace(/\s+/g, ' ').trim(),
        align === 'center' ? r.left + r.width / 2 : r.left + 8, r.top + r.height / 2);
      x.restore();
    };
    draw(document.querySelector('.carry'), 'center');
    draw(document.querySelector('.prompt'), 'center');
    return c.toDataURL('image/png');
  });
  const file = path.join(ensureOut(SUB), `${name}.png`);
  writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
  return file;
}

await withGame(async (g) => {
  const h = await g.terrainHeight(-6, 26);
  await g.tp(-6, h + 1.4, 26);
  await g.look(0.6, -0.05);
  await g.wait(0.6);

  const empty = await hud(g);
  check(empty.carry === '', 'the carry readout is empty when the hands are empty', empty.carry);

  const st = await g.state();
  const [px, py, pz] = st.player.pos;
  for (const [species, label] of [['apple', 'apple'], ['watermelon', 'watermelon']]) {
    const id = await g.call('fruit.spawn', species, px, py + 1.2, pz - 1.2, null, 0.5);
    await g.call('pickup', id);
    await g.wait(0.6);
    const now = await hud(g);
    console.log(`  ${label.padEnd(11)} ${now.carry.replace(/<[^>]+>/g, '')}`);
    check(now.carry.includes('Q</b> drop'), `${label}: says how to put it down`);
    check(now.carry.includes('LMB</b> throw'), `${label}: says how to throw it`);
    check(now.carry.includes('both hands') === (species === 'watermelon'),
      `${label}: says whether it takes both hands`);
    console.log('  shot:', await composite(g, label));
    await g.call('drop');
    await g.call('fruit.despawnAllFree');
    await g.wait(0.5);
  }
  const after = await hud(g);
  check(after.carry === '', 'and goes away again on drop', after.carry);
}, { headless: true, width: 1280, height: 720, quiet: true, islandActivities: false });

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nOK');
process.exit(failures ? 1 : 0);
