// Three close-range frames, for the judgements that genuinely need pixels:
// plank seams and hands at arm's length, the shop's near silhouette, and how
// fruit reads against the canopy. Everything else is triaged from numbers.
import { withGame, ensureOut } from './driver.mjs';
import { contactSheet, statLine } from './sheet.mjs';
import path from 'node:path';

const results = await withGame(async (g) => {
  const info = await g.call('world.info');
  const dir = info.dock.dir, deckTop = info.dock.deckTop;
  const [dockX, , dockZ] = info.landmarks.dock.pos;
  const s = Math.sin(dir), c = Math.cos(dir);
  const deck = (lx, lz) => [dockX + lx * c + lz * s, deckTop + 0.15, dockZ - lx * s + lz * c];
  const counter = info.shopCounter;

  const VIEWS = [
    { id: 'a-deck-and-hands', at: deck(0.2, 12.0), air: true, look: deck(0.2, 4.0), pitch: -0.42 },
    { id: 'b-shop-close', at: [null], world: [40.0, 0, 57.0], look: [counter[0], counter[1] + 0.9, counter[2]] },
    { id: 'c-orchard-fruit', world: [-13.5, 0, 27.0], look: [-19, 9.6, 24] },
  ];
  ensureOut('detail');
  const out = [];
  for (const v of VIEWS) {
    if (v.air) {
      await g.tp(v.at[0], v.at[1], v.at[2]);
      await g.look(Math.atan2(-(v.look[0] - v.at[0]), -(v.look[2] - v.at[2])), v.pitch);
    } else {
      const y = await g.terrainHeight(v.world[0], v.world[2]) + 0.4;
      await g.tp(v.world[0], y, v.world[2]);
      const st = await g.state();
      const [px, py, pz] = st.player.pos;
      await g.look(Math.atan2(-(v.look[0] - px), -(v.look[2] - pz)),
        Math.atan2(v.look[1] - (py + 1.6), Math.hypot(v.look[0] - px, v.look[2] - pz)));
    }
    await g.wait(0.5);
    const stats = await g.stats();
    const file = await g.shot(v.id, 'detail');
    console.log(`${v.id.padEnd(18)} ${statLine(stats)}`);
    out.push({ file, label: v.id, note: `${stats.mean.toFixed(2)}/${stats.contrast.toFixed(2)}` });
  }
  return out;
}, { width: 1280, height: 720, headless: true, quiet: true });

console.log('\nsheet:', await contactSheet(results, path.join('capture', 'detail', '_sheet.png'),
  { cols: 3, thumbW: 430, title: 'RIPE RIOT - close range: deck & hands / shop / orchard fruit' }));
