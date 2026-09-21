// Verify that the legendary vine endpoints have continuous physical supports,
// rather than scenery that ends below them or a collider unrelated to the art.
import { withGame, ensureOut } from './driver.mjs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const report = await withGame(async g => {
  await g.page.evaluate(() => window.__RIPE.pause(true));
  await g.simulate(0.1);
  const geometryReport = await g.page.evaluate(() => {
    const game = window.__GAME, world = game.get('world');
    const v = (x, y, z) => game.player.position.clone().set(x, y, z);
    const supports = world.built.kingMelonAnchors.map(a => {
      const base = window.__RIPE.terrainHeight(a.x, a.z);
      const top = game.physics.raycast(v(a.x, a.y + 5, a.z), v(0, -1, 0), 6);
      const sides = [];
      for (const t of [0.25, 0.5, 0.75, 0.95]) {
        const y = base + (a.y - base) * t;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const hit = game.physics.raycast(v(a.x + dx * 8, y, a.z + dz * 8), v(-dx, 0, -dz), 9);
          sides.push({ t, direction: [dx, dz], distance: hit?.distance,
            sameSupport: !!top && hit?.collider.handle === top.collider.handle });
        }
      }
      return { anchor: a.toArray(), base, capY: top?.point.y,
        capped: !!top && top.point.y >= a.y && top.point.y < a.y + 1.5, sides };
    });
    const geometries = new Set(), invalid = [];
    game.renderer.scene.traverse(o => {
      if (!o.geometry || geometries.has(o.geometry)) return;
      geometries.add(o.geometry);
      for (const [name, attr] of Object.entries(o.geometry.attributes)) {
        if (Array.from(attr.array).some(n => !Number.isFinite(n))) invalid.push(`${o.name}:${name}`);
      }
    });
    return { supports, geometryCount: geometries.size, invalid,
      render: window.__RIPE.state().render, physics: window.__RIPE.state().physics };
  });
  // Use the ordinary tool handlers to tether the melon, then pin that rope
  // into a new crag. Debug placement only moves us to the test location.
  await g.call('tool.give', 'ropegun');
  await g.call('tool.select', 'ropegun');
  const a = geometryReport.supports[1].anchor;
  const x = a[0], z = a[2] + 6;
  await g.tp(x, (await g.terrainHeight(x, z)) + 0.2, z);
  await g.simulate(0.3);
  const face = async target => {
    const p = (await g.state()).player.pos;
    const dx = target[0] - p[0], dy = target[1] - p[1] - 1.6, dz = target[2] - p[2];
    await g.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  };
  const info = await g.call('legendary.info');
  await face(info.home);
  await g.simulate(0.1);
  await g.call('tool.fire');
  await g.simulate(0.2);
  const held = (await g.state()).legendary.held;
  const eyeY = (await g.state()).player.pos[1] + 1.6;
  await face([a[0], eyeY, a[2]]);
  await g.simulate(0.1);
  const aimingAtSupport = await g.page.evaluate(() => {
    const game = window.__GAME, a = game.get('world').built.kingMelonAnchors[1];
    const top = game.physics.raycast(a.clone().setY(a.y + 5), a.clone().set(0, -1, 0), 6);
    const eye = game.player.eyePosition.clone();
    const direction = a.clone().setY(eye.y).sub(eye).normalize();
    const aim = game.physics.raycast(eye, direction, 34, undefined, game.player.body);
    return !!top && aim?.collider.handle === top.collider.handle;
  });
  await g.call('tool.secondary', true);
  await g.simulate(0.05);
  await g.call('tool.secondary', false);
  await g.simulate(0.2);
  const legendary = (await g.state()).legendary;
  return { ...geometryReport, ropePin: { heldBeforePin: held, aimingAtSupport,
    tethers: legendary.tethers, heldAfterPin: legendary.held }, consoleErrors: g.consoleErrors };
}, { width: 320, height: 180, headless: true, quiet: true, islandActivities: false, drawFrames: false });
const failures = report.supports.filter(s => !s.capped || s.sides.some(s => !s.sameSupport));
const out = ensureOut('area-design/qa');
writeFileSync(path.join(out, 'worksites.json'), JSON.stringify({ ...report,
  evidence: 'numerical support and rope interaction only', drawFrames: false }, null, 2));
console.log(JSON.stringify({ supports: report.supports.length, sideRays: report.supports.flatMap(s => s.sides).length,
  failedSupports: failures.length, geometryCount: report.geometryCount, invalid: report.invalid,
  render: report.render, physics: report.physics, ropePin: report.ropePin,
  consoleErrors: report.consoleErrors }, null, 2));
if (failures.length || report.invalid.length || report.supports.length !== 4 ||
  !report.ropePin.aimingAtSupport || report.ropePin.heldBeforePin !== 1 ||
  report.ropePin.tethers !== 1 || report.ropePin.heldAfterPin !== 0 ||
  report.consoleErrors.some(e => /error/i.test(e))) process.exitCode = 1;
