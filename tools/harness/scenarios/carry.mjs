// The rules about what you can pick up, and what happens when it stops fitting.
//
// `carry-check.mjs` measures the CAMERA — how much of the frame a held fruit
// occupies — and needs a real render size to do it. This is the other half:
// the rules themselves, asserted in forced fixed steps so they mean the same
// thing on every machine.
//
// The bug this exists for: a Puff Melon triples in size in the two thirds of a
// second after it leaves the bush, which is normally IN YOUR HANDS, and nothing
// in the game had an opinion about that.

export const name = 'carry';

export async function run(g, t) {
  const st0 = await g.state();
  const [px, py, pz] = st0.player.pos;
  const spawn = (species, variant = null, roll = 0.5) =>
    g.call('fruit.spawn', species, px + 0.9, py + 1.0, pz - 0.9, variant, roll);

  // ---- the classification table itself ------------------------------------
  // Pure function of diameter and mass, so it can be checked exhaustively
  // without spawning anything.
  const cls = (d, m) => g.call('carry.class', d, m);
  t.eq(await cls(0.34, 1.1), 'small', 'an apple is a one-handed pick');
  t.eq(await cls(0.40, 3.4), 'small', 'so is a coconut');
  t.eq(await cls(0.62, 2.6), 'medium', 'a banana bunch needs two hands for its size');
  t.eq(await cls(0.65, 57.8), 'large', 'a Huge Coconut needs them for its weight');
  t.eq(await cls(0.80, 22), 'large', 'a watermelon is a haul');
  t.eq(await cls(1.74, 1.9), 'oversized', 'an inflated puff melon cannot be hand-carried');
  t.eq(await cls(1.30, 374), 'oversized', 'nor can a Huge Watermelon');
  t.eq(await cls(0.73, 82), 'oversized', 'weight alone is enough to rule it out');

  // ---- picking up, by class ----------------------------------------------
  const apple = await spawn('apple');
  await g.wait(0.5);
  const drawnBefore = (await g.state()).fruit.drawn;
  t.ok(await g.call('pickup', apple), 'an apple can be picked up');
  // Presentation uses wall-clock frame time while waits below force physics
  // time. Exclusivity must hold on the next rendered frame, without waiting
  // for either real-time stow ramp to finish on a fast or slow renderer.
  await g.idleFrames(1);
  t.eq((await g.state()).viewmodel.toolShown, false,
    'pickup hides the equipped tool on the next rendered frame');
  await g.wait(0.4);
  let s = await g.state();
  t.eq(s.interaction.carrying?.cls, 'small', 'and is carried as a small fruit');
  // The local copy comes out of the world batch: the first-person rig draws it
  // instead, at a framed size. Remote clients still get the real thing.
  t.eq(s.fruit.drawn, drawnBefore - 1,
    'the carried fruit is not also drawn in the world at full size');
  t.eq(s.viewmodel.carryShown, true, 'the carry rig is on screen');
  t.eq(s.viewmodel.toolShown, false, 'and the equipped tool is not');
  await g.call('drop');
  await g.idleFrames(1);
  t.eq((await g.state()).viewmodel.carryShown, false,
    'drop hides the fruit proxy on the next rendered frame');
  await g.wait(0.5);
  s = await g.state();
  t.eq(s.fruit.drawn, drawnBefore, 'dropping puts it back in the world batch');
  t.eq(s.viewmodel.toolShown, true, 'and gives the tool back');
  await g.call('fruit.despawnAllFree');

  const melon = await spawn('watermelon');
  await g.wait(0.5);
  t.ok(await g.call('pickup', melon), 'a watermelon can be picked up');
  await g.wait(0.3);
  s = await g.state();
  t.eq(s.interaction.carrying?.cls, 'large', 'as a heavy two-handed haul');
  t.ok(s.interaction.carrying?.heavy, 'and it still counts as heavy for movement');
  await g.call('drop');
  await g.call('fruit.despawnAllFree');
  await g.wait(0.4);

  // ---- a puff melon that inflates in your hands ---------------------------
  const puff = await spawn('puffmelon');
  await g.call('fruit.inflate', puff, 1.0);
  await g.wait(0.4);
  t.ok(await g.call('pickup', puff), 'a deflated puff melon carries normally');
  s = await g.state();
  t.eq(s.interaction.carrying?.cls, 'medium', 'as a medium fruit');

  // Step it up to the last size two hands will close around.
  await g.call('fruit.inflate', puff, 1.9);
  await g.wait(0.2);
  s = await g.state();
  t.ok(s.interaction.carrying, 'at 1.06 m across it is still in hand');
  t.eq(s.interaction.carrying?.cls, 'large', 'though now as a heavy haul');

  // …and one notch past it.
  await g.call('fruit.inflate', puff, 2.1, true);
  await g.wait(0.2);
  s = await g.state();
  t.ok(!s.interaction.carrying, 'past 1.10 m it leaves the hands by itself');
  const gone = await g.call('fruit.info', puff);
  t.eq(gone?.state, 'free', 'and becomes a physics object again');
  const away = Math.hypot(gone.pos[0] - s.player.pos[0], gone.pos[2] - s.player.pos[2]);
  t.gt(away, 0.9, 'clear of the player rather than inside them');
  t.eq(s.player.state, 'active', 'who is not flattened by the handover');
  t.eq(s.viewmodel.toolShown, true, 'the tool comes back');
  t.eq(s.viewmodel.carryShown, false, 'and the carry rig goes away');

  // It should be LEAVING, not loitering in front of the camera.
  await g.wait(0.5);
  const later = await g.call('fruit.info', puff);
  if (later) {
    const s2 = await g.state();
    const then = Math.hypot(later.pos[0] - s2.player.pos[0], later.pos[2] - s2.player.pos[2]);
    t.gt(Math.hypot(then, later.pos[1] - s2.player.pos[1]), away,
      'and it keeps going, rather than hanging in front of you');
  } else {
    t.note('the puff melon left the island, which is on-brand');
  }
  await g.call('fruit.despawnAllFree');
  await g.wait(0.3);

  // ---- oversized fruit is refused, and shoved instead ---------------------
  const big = await spawn('puffmelon');
  await g.call('fruit.inflate', big, 3.1);
  await g.wait(0.8);
  const before = (await g.call('fruit.info', big)).pos.slice();
  t.ok(!(await g.call('pickup', big)), 'a fully inflated puff melon cannot be picked up');
  s = await g.state();
  t.ok(!s.interaction.carrying, 'and nothing ends up in the hands');
  t.ok(!!s.interaction.lastRefusal, 'the refusal has a reason attached');
  await g.wait(0.4);
  const after = await g.call('fruit.info', big);
  t.gt(Math.hypot(after.pos[0] - before[0], after.pos[2] - before[2]), 0.15,
    'leaning on it shoves it instead of doing nothing');

  // Aiming at it must teach the verb, or "E does nothing" is all the player
  // learns. An Ancient Apple is used for this rather than the melon because it
  // is oversized by WEIGHT and therefore stays where it is put.
  await g.call('fruit.despawnAllFree');
  const heavy = await spawn('apple', 'ancient');
  await g.wait(1.2);
  const hi = await g.call('fruit.info', heavy);
  t.gt(hi.mass, 60, 'an Ancient Apple weighs more than a person will lift');
  await g.faceTo(hi.pos[0], hi.pos[1], hi.pos[2]);
  await g.wait(0.2);
  s = await g.state();
  t.eq(s.interaction.targetKind, 'shove', 'aiming at it offers a shove');
  t.ok((s.interaction.prompt ?? '').includes('Shove'), 'and the prompt says so');
  const restBefore = (await g.call('fruit.info', heavy)).pos.slice();
  await g.call('interact');
  await g.wait(0.5);
  const restAfter = await g.call('fruit.info', heavy);
  t.ok(!(await g.state()).interaction.carrying, 'E does not put it in your hands');
  t.gt(Math.hypot(restAfter.pos[0] - restBefore[0], restAfter.pos[2] - restBefore[2]), 0.1,
    'E shoves it');

  // ---- aiming at ordinary fruit lights it up ------------------------------
  await g.call('fruit.despawnAllFree');
  const lit = await spawn('orange');
  await g.wait(0.6);
  const li = await g.call('fruit.info', lit);
  await g.faceTo(li.pos[0], li.pos[1], li.pos[2]);
  await g.wait(0.2);
  s = await g.state();
  t.eq(s.interaction.target?.id, lit, 'the orange is the look target');
  const glow = await g.page.evaluate(() => window.__GAME.get('fruit').renderer.highlightId);
  t.eq(glow, lit, 'and the renderer is lighting that instance');
  await g.look(0, 1.2);
  await g.wait(0.2);
  const off = await g.page.evaluate(() => window.__GAME.get('fruit').renderer.highlightId);
  t.eq(off, -1, 'looking away puts it out again');
  await g.call('fruit.despawnAllFree');
}
