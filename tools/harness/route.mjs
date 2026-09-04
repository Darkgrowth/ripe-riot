// The six views this art pass is judged on, captured in FIRST PERSON through
// the real player camera (viewmodel included), from the normal startup path.
//
// Positions are derived from `world.info` rather than written as literals, so
// they follow the dock, shop and melon if those ever move.
//
//   node tools/harness/route.mjs            capture + sheet
//   node tools/harness/route.mjs --tag base  label the output set

import { withGame, ensureOut } from './driver.mjs';
import { contactSheet, statLine, verdict } from './sheet.mjs';
import path from 'node:path';

const tag = (() => {
  const i = process.argv.indexOf('--tag');
  return i > 0 ? process.argv[i + 1] : 'now';
})();
const SUB = path.join('route', tag);

const results = await withGame(async (g) => {
  const info = await g.call('world.info');
  const L = info.landmarks;
  const dir = info.dock.dir, deckTop = info.dock.deckTop;
  const [dockX, , dockZ] = L.dock.pos;
  const s = Math.sin(dir), c = Math.cos(dir);
  /** Dock-local (x,z) -> world, on the planking. */
  const deck = (lx, lz) => [dockX + lx * c + lz * s, deckTop + 0.15, dockZ - lx * s + lz * c];

  const km = info.kingMelon;
  const pad = info.sellPad;
  const counter = info.shopCounter;

  // Approach vector shop -> orchard, so the orchard view stands on the route.
  const orch = L.orchard.pos;
  const ov = norm(pad[0] - orch[0], pad[2] - orch[2]);
  const orchStand = [orch[0] + ov[0] * 21, orch[2] + ov[1] * 21];
  // Sell pad, backed off away from the shop so the whole shed is in frame.
  const sv = norm(pad[0] - counter[0], pad[2] - counter[2]);

  const VIEWS = [
    { id: '1-spawn',      spawn: true },
    { id: '2-dock-mid',   at: deck(0.4, 7.0),  look: counter, air: true },
    // Far enough back that the roof, the gable and the sign are all in frame:
    // at 4.5 m the awning filled the shot and the building behind it did not
    // appear at all.
    { id: '3-shop',       at: [pad[0] + sv[0] * 8.5, 0, pad[2] + sv[1] * 8.5], look: [counter[0], counter[1] + 1.5, counter[2]] },
    // Standing ON the route where it enters the orchard, looking down the
    // avenue. The old vantage was 21 m out on a bearing that happened to land
    // inside a tree, so half the frame was one apple.
    { id: '4-orchard',    at: [-1.5, 0, 33.0], look: [orch[0] - 2, orch[1] + 5, orch[2] + 1] },
    // The basin floor is below sea level, so the sea floods it into a lagoon;
    // standing at (34,-3) put the camera UNDER the water plane and the frame
    // was a pale wash. The south shore at z=6 is the readable vantage.
    { id: '5-waterfall',  at: [37.5, 0, 7.5], look: [34, 8, -25] },
    { id: '6-king-melon', at: [22, 0, 14], look: km },
  ];

  ensureOut(SUB);
  const out = [];
  const st0 = await g.state();
  console.log(`plants ${st0.fruit?.plants}  fruit ${st0.fruit?.total}  ` +
    `draws ${st0.render.drawCalls}  tris ${st0.render.triangles}  ` +
    `geo ${st0.render.geometries}  tex ${st0.render.textures}`);
  console.log(`dressing ${info.dressing.total} pieces, ${info.dressing.tris} tris  ` +
    Object.entries(info.dressing.counts).map(([k, v]) => `${k}:${v}`).join(' '));

  for (const v of VIEWS) {
    if (v.spawn) {
      await g.call('world.respawn');
    } else {
      const y = v.air ? v.at[1] : await g.terrainHeight(v.at[0], v.at[2]) + 0.4;
      await g.tp(v.at[0], y, v.at[2]);
      await faceTo(g, v.look);
    }
    await g.wait(0.5);
    const stats = await g.stats();
    const st = await g.state();
    const file = await g.shot(v.id, SUB);
    const note = `${stats.mean.toFixed(2)}/${stats.contrast.toFixed(2)}/${stats.hueSpread}h ${st.render.drawCalls}d`;
    console.log(`${v.id.padEnd(14)} ${statLine(stats)}  draws ${String(st.render.drawCalls).padStart(3)} ` +
      `tris ${String(st.render.triangles).padStart(7)} -> ${verdict(stats)}`);
    out.push({ file, label: v.id, note, stats });
  }
  return out;
}, { width: 1280, height: 720, headless: true, quiet: true });

const sheet = await contactSheet(results, path.join('capture', 'route', `_sheet-${tag}.png`), {
  cols: 3, thumbW: 460, title: `RIPE RIOT — route views [${tag}]  (mean/contrast/hues, draws)`,
});
console.log('\nsheet:', sheet);

function norm(x, z) { const d = Math.hypot(x, z) || 1; return [x / d, z / d]; }

async function faceTo(g, target) {
  const st = await g.state();
  const [px, py, pz] = st.player.pos;
  const dx = target[0] - px, dy = target[1] - (py + 1.6), dz = target[2] - pz;
  await g.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
}
