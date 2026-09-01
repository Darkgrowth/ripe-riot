// Validates every procedural geometry: NaN positions, attribute mismatches,
// triangle counts. Pure numbers, no images.

import { withGame } from './driver.mjs';

const report = await withGame(async (g) => {
  return g.page.evaluate(async () => {
    const pg = await import('/src/plants/PlantGeometry.ts');
    const fg = await import('/src/fruit/FruitGeometry.ts');
    const out = [];

    const inspect = (name, geo, extra = {}) => {
      const pos = geo.getAttribute('position');
      let nan = 0;
      for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) nan++;
      const attrs = Object.keys(geo.attributes).sort().join(',');
      out.push({ name, verts: pos.count, tris: Math.round(pos.count / 3), nan, attrs, ...extra });
    };

    const types = ['appleTree', 'orangeTree', 'palm', 'bananaPlant', 'melonVine', 'puffBush', 'vinebombVine'];
    for (const t of types) {
      for (let v = 0; v < pg.SHAPE_VARIANTS; v++) {
        const s = pg.plantShape(t, v);
        inspect(`plant:${t}:${v}`, s.geometry, { attach: s.attachPoints.length, height: +s.height.toFixed(2) });
      }
    }
    for (const f of ['apple', 'orange', 'coconut', 'watermelon', 'puffmelon', 'vinebomb', 'banana']) {
      inspect(`fruit:${f}`, fg.fruitGeometry(f));
    }
    return out;
  });
}, { headless: true, quiet: true });

let bad = 0;
let totalTris = 0;
for (const r of report) {
  const flag = r.nan > 0 ? '  <-- NaN' : '';
  if (r.nan > 0) bad++;
  totalTris += r.tris;
  console.log(
    `${r.name.padEnd(22)} tris ${String(r.tris).padStart(6)}  nan ${String(r.nan).padStart(4)}` +
    `  attrs[${r.attrs}]${r.attach !== undefined ? `  attach ${r.attach}` : ''}${flag}`);
}
console.log(`\ntotal unique triangles: ${totalTris}`);
if (bad) { console.error(`FAIL: ${bad} geometries contain NaN`); process.exit(1); }
console.log('OK');
