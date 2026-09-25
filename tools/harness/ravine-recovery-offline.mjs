// Analytic terrain contract for the on-foot escape below the King Melon.
// Runs without Vite, a browser, or a game session.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['src/world/Terrain.ts'], bundle: true, platform: 'node',
  format: 'esm', write: false, tsconfig: 'tsconfig.json',
});
const url = `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`;
const { Terrain } = await import(url);
const terrain = new Terrain();

function walkout(label, fromZ, toZ, pathX) {
  let worstAngle = 0;
  let worstStep = 0;
  for (const offset of [-0.8, 0, 0.8]) {
    let previous = null;
    for (let z = fromZ; z <= toZ; z += 0.5) {
      const x = pathX(z) + offset;
      const y = terrain.height(x, z);
      const angle = Math.acos(1 - terrain.slope(x, z)) * 180 / Math.PI;
      worstAngle = Math.max(worstAngle, angle);
      if (previous !== null) worstStep = Math.max(worstStep, Math.abs(y - previous));
      previous = y;
    }
  }
  assert.ok(worstAngle < 45, `${label} must be walkable across its width; worst slope ${worstAngle.toFixed(1)}°`);
  assert.ok(worstStep < 0.55, `${label} cannot contain an abrupt half-metre step; worst ${worstStep.toFixed(2)} m`);
  console.log(`${label}: worst slope ${worstAngle.toFixed(1)}°, worst half-metre step ${worstStep.toFixed(2)} m`);
}

walkout('east ravine exit', -57, -44, z => 15.8 - (z + 57) * 0.1);
walkout('west ravine exit', -62, -44, z => -20 + (z + 62) * (8 / 18));
assert.ok(terrain.height(14.5, -44) > terrain.height(15.8, -57) + 6,
  'escape route reaches higher ground');
assert.ok(terrain.height(-12, -44) > terrain.height(-20, -62) + 6,
  'western escape route reaches higher ground');
assert.ok(Math.abs(terrain.height(8, -62) - 24.2535) < 0.02,
  'King Melon drop site and vine geometry remain at their authored height');
