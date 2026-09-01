// Island tour: frames every landmark, records numeric frame stats, and emits
// ONE contact sheet. Per the project's cost rules, triage from the numbers
// printed here and only open the sheet (a single image) when they look off.

import { withGame, ensureOut } from './driver.mjs';
import { contactSheet, statLine, verdict } from './sheet.mjs';
import path from 'node:path';

const SHOTS = [
  // label,           camera pos,             look-at target
  ['dock',            [72, 12, 82],           [52, 2, 56]],
  ['orchard',         [-6, 20, 44],           [-26, 7, 20]],
  ['palm-beach',      [-40, 16, 78],          [-60, 3, 56]],
  ['hill-farm',       [-16, 34, -8],          [-38, 20, -30]],
  ['waterfall-basin', [56, 22, 6],            [34, 4, -14]],
  ['ravine-ridge',    [30, 44, -30],          [4, 22, -66]],
  ['cave-orchard',    [82, 18, 12],           [62, 4, -8]],
  ['island-wide',     [150, 95, 165],         [-8, 6, -10]],
  ['sea-level',       [96, 3.2, 96],          [20, 10, 10]],
];

const results = await withGame(async (g) => {
  const out = [];
  ensureOut('tour');
  const st0 = await g.state();
  console.log(`plants ${st0.fruit?.plants}  fruit ${st0.fruit?.total}  ` +
    `attached ${st0.fruit?.attached}  draws ${st0.render.drawCalls}  tris ${st0.render.triangles}`);

  for (const [label, pos, target] of SHOTS) {
    await g.freeCam(pos, target);
    await g.wait(0.25);
    const stats = await g.stats();
    const file = await g.shot(label, 'tour');
    const v = verdict(stats);
    console.log(`${label.padEnd(17)} ${statLine(stats)}  black ${stats.black.toFixed(2)} -> ${v}`);
    out.push({ file, label, note: `${stats.mean.toFixed(2)}/${stats.contrast.toFixed(2)}/${stats.hueSpread}`, stats, verdict: v });
  }
  await g.attachCam();
  return out;
}, { width: 960, height: 540, headless: true, quiet: true });

const sheet = await contactSheet(results, path.join('capture', 'tour', '_sheet.png'), {
  cols: 3, thumbW: 440, title: 'RIPE RIOT — Sunpatch landmark tour (mean/contrast/hues)',
});
console.log('\nsheet:', sheet);

const bad = results.filter((r) => r.verdict !== 'ok');
if (bad.length) {
  console.error('\nsuspect frames: ' + bad.map((b) => `${b.label} (${b.verdict})`).join(', '));
  process.exit(1);
}
console.log('all frames pass numeric triage');
