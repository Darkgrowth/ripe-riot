// The first fifteen seconds.
//
// Every other scenario drives the player somewhere before it starts measuring,
// and every visual check either renders its own frame or detaches the camera —
// which is exactly why a startup that showed nothing but the clear colour with
// two enormous forearms in front of it survived a green test suite. This
// scenario asserts on the state the game BOOTS into, and on the real canvas.

export const name = 'startup';

/** Fraction of the actual presented frame that is the raw clear colour. Nonzero
 *  means the world was drawn and then wiped by a later pass. */
async function clearColourFraction(g) {
  return g.page.evaluate(() => {
    const src = document.getElementById('view');
    const c = document.createElement('canvas');
    c.width = 96; c.height = 54;
    const x = c.getContext('2d');
    x.drawImage(src, 0, 0, 96, 54);
    const d = x.getImageData(0, 0, 96, 54).data;
    let n = 0;
    for (let i = 0; i < 96 * 54; i++) {
      // 0xbfe9f5, the renderer's clear colour.
      if (Math.abs(d[i * 4] - 191) < 3 && Math.abs(d[i * 4 + 1] - 233) < 3
        && Math.abs(d[i * 4 + 2] - 245) < 3) n++;
    }
    return +(n / (96 * 54)).toFixed(4);
  });
}

/** Fraction of the frame that is bright and blue-dominant: sky or open sea. */
async function skyFraction(g) {
  return g.page.evaluate(() => {
    const src = document.getElementById('view');
    const c = document.createElement('canvas');
    c.width = 96; c.height = 54;
    const x = c.getContext('2d');
    x.drawImage(src, 0, 0, 96, 54);
    const d = x.getImageData(0, 0, 96, 54).data;
    let n = 0;
    for (let i = 0; i < 96 * 54; i++) {
      const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
      if (b > gg + 8 && b > r + 18 && b > 140) n++;
    }
    return +(n / (96 * 54)).toFixed(4);
  });
}

export async function run(g, t) {
  await g.call('world.respawn');
  await g.wait(0.6);

  const world = await g.call('world.info');
  let s = await g.state();

  // --- the spawn transform
  t.ok(s.player.grounded, 'spawns standing, not falling');
  t.near(s.player.pos[1], world.dock.deckTop, 0.15, 'spawns on the dock deck, not beside it');
  t.near(s.player.yaw, world.spawnYaw, 1e-3, 'spawn sets a yaw, not just a position');
  t.lte(s.player.pitch, 0, 'the camera never starts pitched up into the sky');
  t.gt(s.player.pitch, -0.35, 'and never starts staring at the deck');

  // --- what is actually in front of the player
  const look = await g.probeLook(300);
  t.ok(look.hit, 'the eye ray finds something rather than open sky');
  t.lt(look.hit ? look.distance : 999, 40, 'and it is close enough to be scenery, not a horizon');

  // --- the shop, the sign and the legendary all have to be in the opening shot
  const inView = await g.page.evaluate(() => {
    const gm = window.__GAME;
    const c = gm.renderer.camera;
    c.updateMatrixWorld(true);
    const V3 = Object.getPrototypeOf(c.position).constructor;
    const w = gm.get('world');
    const test = (p) => {
      const v = new V3(p.x, p.y, p.z).project(c);
      return v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
    };
    return {
      shop: test(w.shopCounter),
      kingMelon: test(w.kingMelonPos),
    };
  });
  t.ok(inView.shop, 'the shop is on screen from the spawn');
  t.ok(inView.kingMelon, 'so is the King Melon, from the very first frame');

  // --- the frame the player is actually looking at
  const clear = await clearColourFraction(g);
  t.lt(clear, 0.02, 'the world survives to the canvas (clear-colour wipe regression)');
  const sky = await skyFraction(g);
  t.lt(sky, 0.5, 'the opening frame is not mostly sky');
  t.gt(sky, 0.05, 'but there is still a sky, so the camera is not buried');
  t.note(`opening frame: ${(sky * 100).toFixed(0)}% sky, ${(clear * 100).toFixed(1)}% clear colour`);

  // --- camera height and FOV
  const cam = await g.page.evaluate(() => {
    const c = window.__GAME.renderer.camera;
    return {
      y: c.position.y,
      fovV: c.fov,
      fovH: 2 * Math.atan(Math.tan(c.fov * Math.PI / 360) * c.aspect) * 180 / Math.PI,
    };
  });
  t.near(cam.y - s.player.pos[1], 1.63, 0.05, 'the eye sits at standing head height');
  t.between(cam.fovH, 85, 105, 'horizontal FOV is neither fisheye nor a telescope');

  // --- moving around the spawn: the dock has to hold the player up
  await g.input({ moveZ: 1 });
  await g.wait(1.4);
  s = await g.state();
  t.between(s.player.speed, 4.6, 6.2, 'can walk off the spawn at normal speed');
  // `grounded` is a per-step flag, and a capsule walking a flat deck genuinely
  // loses contact for the odd step: sampled eight times across one walk it came
  // back false once, at deck height, mid-stride, at full speed. So a single
  // instantaneous read of it is a coin toss rather than a fact about the dock.
  // What the deck actually has to do is hold the player at deck height the
  // whole way across, which is what this measures.
  let held = 0;
  for (let i = 0; i < 6; i++) {
    await g.wait(0.12);
    const w = (await g.state()).player;
    if (w.grounded && Math.abs(w.pos[1] - world.dock.deckTop) < 0.25) held++;
  }
  t.gte(held, 5, 'the deck holds while walking');

  await g.input({ moveZ: 1, sprint: true });
  await g.wait(1.2);
  s = await g.state();
  t.between(s.player.speed, 7.2, 9.4, 'and sprint');
  await g.clearInput();
  await g.wait(0.5);

  // --- jump and crouch on the deck
  await g.call('world.respawn');
  await g.wait(0.6);
  const deckY = (await g.state()).player.pos[1];
  await g.input({ jumpPressed: true, jump: true });
  let peak = deckY;
  for (let i = 0; i < 26; i++) {
    await g.wait(0.033);
    peak = Math.max(peak, (await g.state()).player.pos[1]);
  }
  await g.clearInput();
  t.between(peak - deckY, 1.0, 1.7, 'jumps normally on the deck');
  await g.wait(0.8);
  s = await g.state();
  t.near(s.player.pos[1], deckY, 0.12, 'and lands back on it rather than through it');

  await g.input({ crouch: true });
  await g.wait(0.5);
  s = await g.state();
  t.lt(s.player.height, 1.3, 'crouches on the deck');
  const crouchCam = await g.page.evaluate(() => window.__GAME.renderer.camera.position.y);
  t.lt(crouchCam, deckY + 1.4, 'and the camera comes down with it');
  await g.clearInput();
  await g.wait(0.7);
  t.gt((await g.state()).player.height, 1.7, 'stands back up');

  // --- mouse look moves the view, and only by what it was given
  await g.call('world.respawn');
  await g.wait(0.4);
  const base = (await g.state()).player;
  const applied = await g.page.evaluate(() => {
    const p = window.__GAME.player;
    const before = { yaw: p.yaw, pitch: p.pitch };
    p.applyLook(0.25, 0.1);
    const after = { yaw: p.yaw, pitch: p.pitch };
    p.applyLook(-0.25, -0.1);
    return { before, after, restored: { yaw: p.yaw, pitch: p.pitch } };
  });
  t.near(applied.after.yaw, base.yaw - 0.25, 1e-4, 'mouse X turns the view');
  t.near(applied.after.pitch, base.pitch - 0.1, 1e-4, 'mouse Y pitches the view');
  t.near(applied.restored.yaw, base.yaw, 1e-4, 'look is a pure accumulation, with no drift');

  // --- pitch clamp: you can look up, but the game must never START there
  await g.look(base.yaw, 9);
  const clampedUp = (await g.state()).player.pitch;
  await g.look(base.yaw, -9);
  const clampedDown = (await g.state()).player.pitch;
  t.note(`pitch clamps to ${clampedDown.toFixed(3)} .. ${clampedUp.toFixed(3)} rad`);
  t.lt(clampedUp, Math.PI / 2, 'looking up stops short of straight up');
  t.gt(clampedDown, -Math.PI / 2, 'looking down stops short of straight down');

  // --- and a respawn from a mess reproduces the opening frame exactly
  await g.tp(-24, 34, 22);
  await g.look(2.4, 1.3);
  await g.wait(1.5);
  await g.call('ragdoll.trigger', 20, 'startup-scenario').catch(() => {});
  await g.wait(0.4);
  await g.call('world.respawn');
  await g.wait(0.7);
  const again = await g.state();
  t.eq(again.player.state, 'active', 'respawn stands the player back up');
  t.near(again.player.yaw, world.spawnYaw, 1e-3, 'respawn restores the spawn yaw');
  t.near(again.player.pitch, world.spawnPitch, 1e-3, 'respawn restores the spawn pitch');
  t.near(again.player.pos[0], base.pos[0], 0.05, 'respawn restores the spawn position (x)');
  t.near(again.player.pos[2], base.pos[2], 0.05, 'respawn restores the spawn position (z)');
  t.near(await skyFraction(g), sky, 0.05, 'and reproduces the opening composition');
}
