// Actual capsule movement through short service/workstation approach lanes.
// Numerical evidence only: no camera captures and no GPU draws after boot.
import { withGame, ensureOut } from './driver.mjs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const report = await withGame(async g => {
  await g.pause(true);
  const shop = (x, z) => [45 + x * Math.cos(-0.9) + z * Math.sin(-0.9),
    52 - x * Math.sin(-0.9) + z * Math.cos(-0.9)];
  const routes = [
    { name: 'shop sell pad to service counter', from: shop(0, 10), to: shop(0, 5.2) },
    { name: 'orchard path between solid rails', from: [-3.5,31.4], to: [-10.5,28] },
    { name: 'orchard gate crossing', from: [-9.686,35.934], to: [-8.314,33.266] },
    { name: 'Hill Farm sorting shelter approach', from: [-16, -20], to: [-16, -23.3] },
    { name: 'Palm Beach shelter approach', from: [-54, 61], to: [-54, 58] },
  ];
  const results = [];
  for (const route of routes) {
    await g.clearInput(); await g.call('ragdoll.recover');
    await g.tp(route.from[0], (await g.terrainHeight(...route.from)) + 0.45, route.from[1]);
    await g.simulate(0.6);
    const start = (await g.state()).player.pos, samples = [];
    let distance = Infinity;
    for (let i = 0; i < 36; i++) {
      const p = (await g.state()).player.pos;
      const dx = route.to[0] - p[0], dz = route.to[1] - p[2];
      distance = Math.hypot(dx, dz);
      if (distance < 0.42) break;
      await g.look(Math.atan2(-dx, -dz), 0);
      await g.input({ moveZ: 1 }); await g.simulate(0.1);
      const state = (await g.state()).player;
      samples.push({ pos: state.pos, grounded: state.grounded, state: state.state });
    }
    await g.clearInput();
    const end = (await g.state()).player;
    distance = Math.hypot(route.to[0] - end.pos[0], route.to[1] - end.pos[2]);
    results.push({ ...route, start, end, samples, distance,
      passed: distance < 0.55 && end.state === 'active' && samples.every(s => s.state === 'active') });
  }
  return { evidence: 'numerical capsule traversal only', drawFrames: false, routes: results,
    consoleErrors: g.consoleErrors.filter(e => !/DevTools|deprecat|ReadPixels|GPU stall/i.test(e)) };
}, { width: 320, height: 180, headless: true, quiet: true, islandActivities: false, drawFrames: false });
const out = ensureOut('shop-water-feedback');
writeFileSync(path.join(out, 'worksite-routes.json'), JSON.stringify(report, null, 2));
for (const route of report.routes) console.log(`${route.passed ? 'PASS' : 'FAIL'} ${route.name}: ${route.distance.toFixed(3)} m remaining`);
if (report.consoleErrors.length) console.log(JSON.stringify(report.consoleErrors));
process.exitCode = report.routes.every(r => r.passed) && report.consoleErrors.length === 0 ? 0 : 1;
