// Movement feel is the foundation everything else sits on, so it gets measured
// rather than eyeballed: speeds, jump apex, slope climbing, and the guarantee
// that the player never ends up inside the terrain.
//
// Note: speed must be sampled WHILE the input is held. Ground friction is
// ~13/s, so a reading taken after clearing input is always ~0 and tells you
// nothing.

export const name = 'movement';

export async function run(g, t) {
  // --- flat ground walk speed
  await g.standAt(-24, 22, 0);            // orchard terrace, flat and open
  await g.input({ moveZ: 1 });
  await g.wait(1.5);
  let s = await g.state();
  t.between(s.player.speed, 4.6, 6.2, 'walk speed settles near 5.4 m/s');
  t.ok(s.player.grounded, 'stays grounded while walking');
  const walkPos = s.player.pos;

  // --- sprint
  await g.input({ moveZ: 1, sprint: true });
  await g.wait(1.4);
  s = await g.state();
  t.between(s.player.speed, 7.2, 9.4, 'sprint speed settles near 8.4 m/s');
  t.gt(dist2(s.player.pos, walkPos), 4, 'sprinting actually covers ground');
  await g.clearInput();

  // --- stopping should be quick but not instant
  await g.wait(0.5);
  s = await g.state();
  t.lt(s.player.speed, 0.4, 'comes to a stop within half a second');

  // --- crouch
  await g.input({ crouch: true });
  await g.wait(0.5);
  s = await g.state();
  t.lt(s.player.height, 1.3, 'crouch shrinks the capsule');
  await g.clearInput();
  await g.wait(0.6);
  s = await g.state();
  t.gt(s.player.height, 1.7, 'stands back up when there is headroom');

  // --- jump apex
  await g.standAt(-24, 22, 0);
  const groundY = (await g.state()).player.pos[1];
  await g.input({ jumpPressed: true, jump: true });
  let peak = groundY;
  for (let i = 0; i < 26; i++) {
    await g.wait(0.033);
    peak = Math.max(peak, (await g.state()).player.pos[1]);
  }
  await g.clearInput();
  t.between(peak - groundY, 1.0, 1.7, 'full jump clears about 1.3 m');

  // --- short hop: releasing early must cut the arc
  await g.wait(1.0);
  const g2 = (await g.state()).player.pos[1];
  await g.input({ jumpPressed: true, jump: true });
  await g.wait(0.07);
  await g.input({ jump: false });
  let peak2 = g2;
  for (let i = 0; i < 20; i++) {
    await g.wait(0.033);
    peak2 = Math.max(peak2, (await g.state()).player.pos[1]);
  }
  await g.clearInput();
  t.lt(peak2 - g2, (peak - groundY) * 0.94, 'tapping jump gives a lower hop than holding');

  // --- slopes: aim straight at the hilltop and check we gain height
  const hill = [-32, -18];
  await g.standAt(hill[0] + 26, hill[1] + 20, 0, 1.0);
  await g.faceTo(hill[0], 0, hill[1]);
  const before = await g.state();
  await g.input({ moveZ: 1, sprint: true });
  await g.wait(3.0);
  const after = await g.state();
  await g.clearInput();
  t.gt(after.player.pos[1], before.player.pos[1] + 1.5, 'can walk up the central hill');
  // Not "grounded": cresting a rise at sprint speed legitimately launches the
  // player for a few frames. What matters is staying with the terrain.
  const climbGround = await g.terrainHeight(after.player.pos[0], after.player.pos[2]);
  t.lt(Math.abs(after.player.pos[1] - climbGround), 2.5, 'stays with the terrain while climbing');
  t.note(`climbed ${(after.player.pos[1] - before.player.pos[1]).toFixed(1)} m in 3 s`);

  // --- never inside the ground: sample the whole island
  const samples = [
    [-24, 22], [-36, -30], [-58, 58], [34, -14], [0, -78], [58, 62], [62, -8], [20, 40], [-70, -10],
  ];
  const sunk = [];
  for (const [x, z] of samples) {
    await g.standAt(x, z, 0, 2.0);
    await g.wait(0.7);
    const st = await g.state();
    const h = await g.terrainHeight(st.player.pos[0], st.player.pos[2]);
    if (st.player.pos[1] < h - 0.35) sunk.push(`${x},${z}`);
  }
  t.eq(sunk.length, 0, `player never settles below the terrain (sunk at: ${sunk.join(' ')})`);

  // --- a long fall must resolve into a ragdoll, then recover on its own
  await g.tp(-24, 60, 22);
  let ragdolled = false;
  for (let i = 0; i < 90; i++) {
    await g.wait(0.05);
    if ((await g.state()).player.state === 'ragdoll') { ragdolled = true; break; }
  }
  t.ok(ragdolled, 'a 50 m fall knocks the player down rather than being shrugged off');
  let up = false;
  for (let i = 0; i < 140; i++) {
    await g.wait(0.05);
    if ((await g.state()).player.state === 'active') { up = true; break; }
  }
  t.ok(up, 'and the player gets back up unaided');
  const landed = await g.state();
  const h = await g.terrainHeight(landed.player.pos[0], landed.player.pos[2]);
  t.lt(Math.abs(landed.player.pos[1] - h), 2.0, 'recovers standing on the ground, not inside it');
}

function dist2(a, b) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}
