// The catch net as the player sees it: one contact sheet of the swing.
//
//   node tools/harness/net-check.mjs
//
// Four first-person frames in simulated time — the hoop at rest, the hoop
// glowing as a fruit closes on it, the middle of a swing, and the droop after a
// miss — plus the King Melon from the ravine vantage, which is the frame that
// decides whether the legendary reads as a landmark. Numbers are printed for
// each; open the sheet only if they look wrong.
import { withGame, ensureOut } from './driver.mjs';
import { contactSheet, statLine, verdict } from './sheet.mjs';
import path from 'node:path';

const SUB = 'net';
const tag = process.argv[2] ?? 'now';

const results = await withGame(async (g) => {
  ensureOut(SUB);
  await g.pause(true);
  await g.call('tool.give', 'net');
  const info = await g.call('world.info');
  const km = info.kingMelon;
  const out = [];
  const frame = async (id, note) => {
    const stats = await g.stats();
    const file = await g.shot(id, SUB);
    const d = await g.call('tool.debug', 'net');
    console.log(`${id.padEnd(12)} ${statLine(stats)} -> ${verdict(stats)}  net ${d.phase} t=${d.phaseT} lock=${d.lock} caught=${d.caught} misses=${d.misses}`);
    out.push({ file, label: id, note: note ?? `${d.phase} lock ${d.lock}`, stats });
  };

  // Stand in the orchard clearing looking slightly up, so the hoop is against
  // canopy rather than sky and the ring's glow has something to read against.
  const h = await g.terrainHeight(-24, 22);
  await g.tp(-24, h + 0.4, 22);
  await g.look(0, 0.35);
  await g.call('tool.select', 'net');
  await g.simulate(0.6);
  await frame('1-rest', 'ready, nothing near');

  const rest = await g.call('tool.debug', 'net');
  const [ax, ay, az] = rest.hoop;
  // A fruit two metres above the hoop and falling: the telegraph should be lit,
  // and the swing below, pressed 0.16 s later, meets it in the middle of the window.
  await g.call('fruit.spawn', 'apple', ax, ay + 2.1, az);
  await g.simulate(0.16);
  await frame('2-telegraph', 'fruit closing: ring glows');

  // Swing at it and freeze at the middle of the active window.
  await g.call('tool.primary', true);
  await g.call('tool.primary', false);
  await g.simulate(0.17);
  await frame('3-mid-swing', 'active window, hoop on the aim point');
  await g.simulate(0.6);
  await g.call('fruit.despawnAllFree');
  await g.call('basket.clear');
  await g.simulate(0.6);

  // Swing far too early and let the fruit go past: the miss droop.
  await g.call('fruit.spawn', 'apple', ax, ay + 7.5, az);
  await g.simulate(0.4);   // fruit falls at more than 1 g here; it arrives during the recovery below
  await g.call('tool.primary', true);
  await g.call('tool.primary', false);
  await g.simulate(0.55);
  await frame('4-miss', 'too early: droop and recovery');
  await g.call('fruit.despawnAllFree');
  await g.call('tool.select', 'hand');

  // The legendary from the ravine, the same vantage route.mjs uses.
  const y = await g.terrainHeight(22, 14) + 0.4;
  await g.tp(22, y, 14);
  const st = await g.state();
  const [px, py, pz] = st.player.pos;
  const dx = km[0] - px, dy = km[1] - (py + 1.6), dz = km[2] - pz;
  await g.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  await g.simulate(0.4);
  await frame('5-king-melon', 'from the ravine vantage');
  return out;
}, { width: 960, height: 540, headless: true, quiet: true, islandActivities: false });

const sheet = await contactSheet(results, path.join('capture', SUB, `_sheet-${tag}.png`), {
  cols: 3, thumbW: 440, title: `RIPE RIOT — catch net swing [${tag}]`,
});
console.log('\nsheet:', sheet);
