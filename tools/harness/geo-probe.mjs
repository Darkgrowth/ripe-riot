// Terrain numbers for authoring: heights and slopes along candidate paths and
// at candidate sign positions, so a route can be laid where the ground is
// walkable rather than where a coordinate looked plausible.
//
//   node tools/harness/geo-probe.mjs
//
// Prints tables. Never asserts. Edit the candidates below and re-run.

import { withGame } from './driver.mjs';

const ROUTE2 = [
  [-24, 22], [-27, 12], [-29, 2], [-31, -8], [-33, -18], [-36, -30],
  [-30, -38], [-22, -44], [-13, -49], [-4, -51],
];
const SIGNS = {
  hillFarmEdge: [-24.7, -38.3],
  orchardNorth: [-28.8, 0.7],
  ravineRim: [-4, -51],
  waterfallTurn: [30, 6],
  shopGable: [45, 52],
};

await withGame(async (g) => {
  const at = async (x, z) => ({
    h: await g.terrainHeight(x, z),
    slope: await g.page.evaluate(([x, z]) => +window.__GAME.get('world').terrain.slope(x, z).toFixed(3), [x, z]),
  });
  const deg = (s) => (Math.asin(Math.min(1, s)) * 180 / Math.PI).toFixed(0);

  console.log('\n== route 2: orchard -> hill farm -> ravine rim (sampled every ~3 m) ==');
  for (let i = 0; i < ROUTE2.length - 1; i++) {
    const [x1, z1] = ROUTE2[i], [x2, z2] = ROUTE2[i + 1];
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(1, Math.round(len / 3));
    let worst = 0;
    const row = [];
    for (let k = 0; k <= n; k++) {
      const x = x1 + (x2 - x1) * (k / n), z = z1 + (z2 - z1) * (k / n);
      const s = await at(x, z);
      worst = Math.max(worst, s.slope);
      row.push(`${s.h.toFixed(1)}`);
    }
    console.log(`  [${x1},${z1}] -> [${x2},${z2}]  ${len.toFixed(0)} m  heights ${row.join(' ')}  worst slope ${deg(worst)}°`);
  }

  console.log('\n== sign candidates ==');
  for (const [name, [x, z]] of Object.entries(SIGNS)) {
    const s = await at(x, z);
    console.log(`  ${name.padEnd(14)} (${x}, ${z})  h ${s.h.toFixed(2)}  slope ${deg(s.slope)}°`);
  }

  console.log('\n== king melon: home, anchors, pad, and the floor between ==');
  const info = await g.call('legendary.info');
  console.log('  home', info.home.map((v) => v.toFixed(1)).join(', '), ' pad', info.pad.map((v) => v.toFixed(1)).join(', '), ' padRadius', info.padRadius);
  for (const a of info.anchors) console.log('  anchor', a.join(', '), ' ground', (await at(a[0], a[2])).h.toFixed(1));
  const [hx, , hz] = info.home;
  const [px, , pz] = info.pad;
  console.log('  floor from home to pad:');
  for (let k = 0; k <= 8; k++) {
    const x = hx + (px - hx) * (k / 8), z = hz + (pz - hz) * (k / 8);
    const s = await at(x, z);
    console.log(`    ${(k / 8).toFixed(2)}  (${x.toFixed(1)}, ${z.toFixed(1)})  h ${s.h.toFixed(1)}  slope ${deg(s.slope)}°`);
  }
  console.log('  ravine floor along the trench (x from -20 to 40 at z of the home):');
  const floor = [];
  for (let x = -20; x <= 40; x += 5) floor.push(`${x}:${(await at(x, hz)).h.toFixed(1)}`);
  console.log('   ', floor.join('  '));
  console.log('  and across it (z from -80 to -44 at x of the home):');
  const across = [];
  for (let z = -80; z <= -44; z += 4) across.push(`${z}:${(await at(hx, z)).h.toFixed(1)}`);
  console.log('   ', across.join('  '));
}, { width: 320, height: 180, headless: true, quiet: true });
