// What the player actually sees when they press play.
//
// Everything else in this harness either drives the player somewhere first or
// looks at the world through a free camera. Both hid a startup that was 92% flat
// clear-colour: `frameStats` re-renders the scene into its own target, so it
// never saw the canvas the player was looking at, and the contact sheets all
// detached the camera before capturing.
//
// So this one reads the REAL canvas, through the REAL player camera, in the
// state the game boots into. It prints numbers and writes three frames.
//
//   node tools/harness/startup-check.mjs
//   node tools/harness/startup-check.mjs --shots-only

import { withGame, ensureOut } from './driver.mjs';

const SUB = 'startup';

/**
 * Classify the real canvas by row. `sky` is bright and blue-dominant, which on
 * Sunpatch means sky or open sea; everything else is island, dock or tool.
 */
const composition = (g) => g.page.evaluate(() => {
  const src = document.getElementById('view');
  const c = document.createElement('canvas');
  c.width = 128; c.height = 72;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0, 128, 72);
  const d = x.getImageData(0, 0, 128, 72).data;
  const N = 128 * 72;
  let sky = 0, clear = 0;
  const rows = [];
  for (let y = 0; y < 72; y++) {
    let n = 0;
    for (let px = 0; px < 128; px++) {
      const i = (y * 128 + px) * 4;
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      if (b > gg + 8 && b > r + 18 && b > 140) n++;
      // The renderer's clear colour, 0xbfe9f5. A frame made of it is a frame
      // where the world was drawn and then wiped.
      if (Math.abs(r - 191) < 3 && Math.abs(gg - 233) < 3 && Math.abs(b - 245) < 3) clear++;
    }
    rows.push(n);
    sky += n;
  }
  // The horizon is the LAST row with any appreciable sky in it, not the first
  // row that dips below half.
  //
  // Measured at the spawn pose: rows 0-31 all sit between 41% and 58% sky,
  // because palm fronds, the ridge and the shop roof all break the upper half
  // of the frame; sky then falls to 2% at row 32 and 0% below it. "First row
  // under 50%" therefore reported the first frond at 9.7% of frame height and
  // called the composition broken, when the horizon is in fact at 44% --
  // exactly where this check wants it. Scanning up from the bottom still
  // catches both things it exists to catch: a camera buried in the terrain has
  // sky in no row and reports 0%, and a camera pointed at the sky has sky in
  // every row and reports 100%.
  let horizon = 0;
  for (let y = 71; y >= 0; y--) {
    if (rows[y] >= 128 * 0.10) { horizon = y + 1; break; }
  }
  return {
    sky: +(sky / N).toFixed(3),
    clearColour: +(clear / N).toFixed(3),
    horizonPct: +((horizon / 72) * 100).toFixed(1),
    rows,
  };
});

/** Screen-space extent of the equipped viewmodel, through the real view camera. */
const viewmodel = (g) => g.page.evaluate(() => {
  const r = window.__GAME.renderer;
  const V3 = Object.getPrototypeOf(r.camera.position).constructor;
  const group = r.viewScene.children.find((o) => o.name && o.name.startsWith('ViewModel'));
  if (!group) return { error: 'no viewmodel in scene' };
  group.updateMatrixWorld(true);
  const cam = r.viewCamera;
  cam.updateMatrixWorld(true);
  let minX = 9, maxX = -9, minY = 9, maxY = -9, near = 9;
  group.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.getAttribute('position');
    const v = new V3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      o.localToWorld(v);
      near = Math.min(near, -v.z);
      v.project(cam);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
  });
  const clip = (v) => Math.max(-1, Math.min(1, v));
  return {
    id: group.name.replace('ViewModel:', ''),
    // Percentages of the visible frame, not of the model: geometry that runs
    // off the bottom edge is framing, geometry that runs off the right edge is
    // a mistake.
    heightPct: +(((clip(maxY) - clip(minY)) / 2) * 100).toFixed(1),
    widthPct: +(((clip(maxX) - clip(minX)) / 2) * 100).toFixed(1),
    topPct: +(((clip(maxY) + 1) / 2) * 100).toFixed(1),
    leftPct: +(((clip(minX) + 1) / 2) * 100).toFixed(1),
    rightPct: +(((clip(maxX) + 1) / 2) * 100).toFixed(1),
    offRight: +(maxX > 1),
    nearest: +near.toFixed(3),
    camNear: cam.near,
  };
});

const shotsOnly = process.argv.includes('--shots-only');
let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  if (!ok || process.env.RIPE_VERBOSE) {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  }
};

await withGame(async (g) => {
  ensureOut(SUB);

  // ---- the first frame, untouched ----------------------------------------
  const st = await g.state();
  const world = await g.call('world.info');
  const cam = await g.page.evaluate(() => {
    const c = window.__GAME.renderer.camera;
    const dir = c.getWorldDirection(new (Object.getPrototypeOf(c.position).constructor)());
    return {
      y: +c.position.y.toFixed(3),
      pitchDeg: +(Math.asin(dir.y) * 180 / Math.PI).toFixed(2),
      fovV: +c.fov.toFixed(1),
      fovH: +(2 * Math.atan(Math.tan(c.fov * Math.PI / 360) * c.aspect) * 180 / Math.PI).toFixed(1),
    };
  });
  const comp = await composition(g);
  const look = await g.probeLook(300);
  const vm = await viewmodel(g);

  console.log('--- spawn ---');
  console.log('player      ', JSON.stringify(st.player));
  console.log('deck top    ', world.dock.deckTop, ' spawn', JSON.stringify(world.spawn));
  console.log('camera      ', JSON.stringify(cam));
  console.log('eye ray     ', look.hit ? `${look.distance} m -> ${JSON.stringify(look.point)}` : 'NOTHING IN RANGE');
  console.log('composition ', `sky ${comp.sky}  horizon at ${comp.horizonPct}%  clearColour ${comp.clearColour}`);
  console.log('viewmodel   ', JSON.stringify(vm));
  console.log('frameStats  ', JSON.stringify(await g.stats(96, 54)));

  console.log('\n--- checks ---');
  check(comp.clearColour < 0.02, 'the world is actually on the canvas',
    `${(comp.clearColour * 100).toFixed(1)}% of the frame is the raw clear colour`);
  check(comp.sky < 0.5, 'the opening frame is not mostly sky', `sky ${comp.sky}`);
  check(comp.horizonPct > 15 && comp.horizonPct < 60, 'horizon sits in the upper-middle of the frame',
    `${comp.horizonPct}%`);
  check(st.player.pitch <= 0.001, 'the camera never starts pitched up', `pitch ${st.player.pitch}`);
  check(st.player.pitch > -0.35, 'and is not staring at its own toes', `pitch ${st.player.pitch}`);
  check(st.player.grounded, 'the player spawns standing on something');
  check(Math.abs(st.player.pos[1] - world.dock.deckTop) < 0.15, 'and that something is the dock deck',
    `player y ${st.player.pos[1]} vs deck ${world.dock.deckTop}`);
  check(look.hit && look.distance < 40, 'there is playable scenery straight ahead',
    look.hit ? `${look.distance} m` : 'nothing within 300 m');
  check(cam.fovH >= 85 && cam.fovH <= 105, 'horizontal FOV is in the sane band', `${cam.fovH} deg`);
  check(vm.heightPct <= 22, 'the viewmodel does not fill the lower screen', `${vm.heightPct}% of frame height`);
  check(vm.topPct <= 32, 'the viewmodel stays out of the middle of the frame', `top at ${vm.topPct}%`);
  check(!vm.offRight, 'the viewmodel does not run off the right edge');
  check(vm.nearest > vm.camNear * 4, 'the viewmodel cannot clip the near plane',
    `nearest ${vm.nearest} m, near plane ${vm.camNear}`);

  await g.shot('01-spawn', SUB);

  // ---- and after walking off the dock ------------------------------------
  await g.input({ moveZ: 1 });
  await g.wait(5.0);
  await g.clearInput();
  await g.wait(0.4);
  const walked = await g.state();
  const comp2 = await composition(g);
  console.log('\n--- after 5 s of walking forward ---');
  console.log('player      ', JSON.stringify(walked.player.pos), 'grounded', walked.player.grounded);
  console.log('composition ', `sky ${comp2.sky}  horizon ${comp2.horizonPct}%  clearColour ${comp2.clearColour}`);
  check(walked.player.grounded, 'still on the ground after walking off the dock');
  check(comp2.clearColour < 0.02, 'the world is still on the canvas');
  check(comp2.sky < 0.5, 'still not mostly sky', `sky ${comp2.sky}`);
  await g.shot('02-walked', SUB);

  // ---- respawn must reproduce the opening frame exactly -------------------
  // Deliberately from a mess: somewhere else entirely, looking at the sky, and
  // knocked down. A respawn that only works from a tidy state is not a respawn.
  await g.tp(-24, 34, 22);
  await g.look(2.4, 1.2);
  await g.wait(1.6);
  await g.call('ragdoll.trigger', 20, 'startup-check').catch(() => {});
  await g.wait(0.4);
  const back = await g.call('world.respawn');
  await g.wait(0.6);
  const again = await g.state();
  const comp3 = await composition(g);
  console.log('\n--- after respawn (from 34 m up, looking at the sky, ragdolled) ---');
  console.log('player      ', JSON.stringify(again.player));
  check(again.player.state === 'active', 'respawn stands the player back up', again.player.state);
  check(Math.abs(again.player.yaw - st.player.yaw) < 1e-3, 'respawn restores the spawn yaw',
    `${again.player.yaw} vs ${st.player.yaw}`);
  check(Math.abs(again.player.pitch - st.player.pitch) < 1e-3, 'respawn restores the spawn pitch');
  check(Math.abs(again.player.pos[0] - st.player.pos[0]) < 0.05
    && Math.abs(again.player.pos[2] - st.player.pos[2]) < 0.05, 'respawn restores the spawn position');
  check(Math.abs(comp3.sky - comp.sky) < 0.05, 'respawn reproduces the opening composition',
    `sky ${comp3.sky} vs ${comp.sky}`);
  void back;

  // ---- every tool, framed --------------------------------------------------
  console.log('\n--- viewmodel framing, per tool ---');
  const tools = await g.call('tool.list');
  for (const t of tools) {
    await g.call('tool.give', t.id).catch(() => {});
    await g.call('tool.select', t.id);
    // The swap animation stows and redraws; give it time to settle.
    await g.wait(0.7);
    const m = await viewmodel(g);
    console.log(`  ${t.id.padEnd(10)} h ${String(m.heightPct).padStart(5)}%  w ${String(m.widthPct).padStart(5)}%` +
      `  top ${String(m.topPct).padStart(5)}%  x ${m.leftPct}..${m.rightPct}%  nearest ${m.nearest} m`);
    // A hand tool must stay small; a hoop, a barrel and a basket are large
    // objects and pretending otherwise would mean shrinking them until they
    // read as toys. What none of them may do is block the crosshair, clip the
    // near plane, or leave the frame sideways.
    const LARGE = new Set(['net', 'aircannon', 'basket']);
    const cap = LARGE.has(t.id) ? 32 : 24;
    check(m.heightPct <= cap, `${t.id}: sane screen height`, `${m.heightPct}% (cap ${cap}%)`);
    check(m.topPct <= 42, `${t.id}: clear of the crosshair`, `top at ${m.topPct}%`);
    check(m.nearest > m.camNear * 4, `${t.id}: clear of the near plane`, `${m.nearest} m`);
    check(!m.offRight, `${t.id}: inside the right edge`);
  }
  await g.call('tool.select', 'hand');
  await g.wait(0.7);
  await g.shot('03-hand-picker', SUB);

  // ---- framing must survive a resize --------------------------------------
  console.log('\n--- other aspect ratios ---');
  for (const [w, h] of [[1920, 1080], [1280, 800], [1366, 768], [2560, 1080], [1024, 1366]]) {
    await g.page.evaluate(([w, h]) => window.__RIPE.resize(w, h), [w, h]);
    await g.wait(0.35);
    const m = await viewmodel(g);
    const fov = await g.page.evaluate(() => {
      const c = window.__GAME.renderer.camera;
      return +(2 * Math.atan(Math.tan(c.fov * Math.PI / 360) * c.aspect) * 180 / Math.PI).toFixed(1);
    });
    console.log(`  ${String(`${w}x${h}`).padEnd(10)} fovH ${String(fov).padStart(5)}  ` +
      `vm h ${String(m.heightPct).padStart(5)}%  top ${String(m.topPct).padStart(5)}%  right ${m.rightPct}%`);
    check(!m.offRight, `${w}x${h}: viewmodel inside the frame`);
    check(m.topPct <= 42, `${w}x${h}: viewmodel clear of the crosshair`, `top ${m.topPct}%`);
  }
  await g.page.evaluate(() => window.__RIPE.resize(1280, 720));

  if (g.consoleErrors.length) {
    console.log('\n--- console ---');
    for (const e of g.consoleErrors.slice(0, 8)) console.log('  ', e);
  }
}, { headless: true, width: 1280, height: 720 });

if (shotsOnly) process.exit(0);
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nOK');
process.exit(failures ? 1 : 0);
