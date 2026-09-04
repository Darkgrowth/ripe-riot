// Every tool has to do something the hand cannot, and the interesting ones have
// to combine. Measured here rather than asserted in a design document.

export const name = 'tools';

export async function run(g, t) {
  for (const id of ['shaker', 'net', 'ropegun', 'aircannon']) await g.call('tool.give', id);
  const owned = await g.call('tool.list');
  t.eq(owned.length, 7, 'seven tools exist');
  t.eq(owned.filter((x) => x.owned).length, 7,
    'four purchases plus three starters means everything is owned');
  // Only three active slots exist, so selecting a tool has to be able to swap
  // one in rather than quietly failing.

  // ---------------------------------------------------------------- shaker
  const tree = await g.call('plant.nearest', -24, 8, 22, 'appleTree', true);
  t.ok(tree, 'found a loaded apple tree');
  const before = (await g.state()).fruit;
  await g.standAt(tree.pos[0] + 1.7, tree.pos[2], 0, 1.0);
  await g.faceTo(tree.pos[0], tree.pos[1] + 1.5, tree.pos[2]);
  await g.call('tool.select', 'shaker');
  await g.wait(0.2);
  await g.call('tool.fire');
  await g.wait(1.2);
  const after = (await g.state()).fruit;
  t.gt(after.free, before.free, 'the tree shaker knocks fruit loose');
  t.note(`shaker dropped ${after.free - before.free} fruit`);

  // ------------------------------------------------------------------- net
  await g.call('fruit.despawnAllFree');
  await g.call('basket.clear');
  await g.call('tool.select', 'net');
  await g.wait(0.2);
  const st = await g.state();
  const [px, py, pz] = st.player.pos;
  // Aim the net up and drop an apple straight into it.
  await g.look(st.player.yaw, 1.15);
  await g.call('tool.primary', true);          // hold the net open
  await g.call('fruit.spawn', 'apple', px + 0.2, py + 9, pz + 0.1);
  let caught = false;
  for (let i = 0; i < 50; i++) {
    await g.wait(0.05);
    const s = await g.state();
    if (s.interaction.basket > 0) { caught = true; break; }
  }
  await g.call('tool.primary', false);
  t.ok(caught, 'the catch net takes a falling apple out of the air');
  const scoring = await g.state();
  t.note(`stunts seen so far: ${(scoring.scoring?.seen ?? []).join(', ') || 'none'}`);
  t.ok((scoring.scoring?.seen ?? []).includes('midAir'),
    'catching in mid-air awards MID-AIR HARVEST');

  // ------------------------------------------------------------- ground net
  await g.call('basket.clear');
  await g.call('fruit.despawnAllFree');
  await g.look(st.player.yaw, -0.85);           // look at the ground ahead
  await g.call('tool.secondary', true);
  await g.call('tool.secondary', false);
  await g.wait(0.4);
  const netState = await g.state();
  t.ok((netState.tools.status ?? '').includes('laid'), 'a ground net can be laid down');

  // --------------------------------------------------------------- rope gun
  await g.call('rope.clear');
  await g.call('tool.select', 'ropegun');
  await g.wait(0.2);
  await g.look(st.player.yaw, -0.25);
  await g.call('tool.fire');
  await g.wait(0.4);
  const ropes = await g.state();
  t.eq(ropes.ropes.count, 1, 'the rope gun creates exactly one rope per shot');
  t.note(`rope: ${JSON.stringify(ropes.ropes.list[0] ?? null)}`);

  // A tethered player cannot simply walk away. The shot above hit the ground
  // ~6.4 m ahead, so the rope is ~7.4 m long with under a metre of slack:
  // backing off has to stop within a couple of metres, not the 14 m that 2.6 s
  // of walking would otherwise cover. (The old bound here was 26 m, which a
  // player with no rope at all could not have failed.)
  const anchorPos = (await g.state()).player.pos;
  await g.input({ moveZ: -1 });
  await g.wait(2.6);
  const pulled = await g.state();
  await g.clearInput();
  const dist = Math.hypot(pulled.player.pos[0] - anchorPos[0], pulled.player.pos[2] - anchorPos[2]);
  t.between(dist, 0.3, 4.0, 'the rope actually restrains the player');
  t.note(`walked ${dist.toFixed(1)} m against a ${ropes.ropes.list[0]?.len ?? '?'} m rope`);
  await g.call('rope.clear');

  // ------------------------------------------------------------- air cannon
  await g.call('fruit.despawnAllFree');
  const groundY = await g.terrainHeight(-24, 22);
  await g.standAt(-24, 22, 0, 1.0);
  const targetId = await g.call('fruit.spawn', 'apple', -24, groundY + 0.4, 15);
  await g.wait(1.0);
  const restPos = (await g.call('fruit.info', targetId)).pos;
  await g.faceTo(restPos[0], restPos[1], restPos[2]);
  await g.call('tool.select', 'aircannon');
  await g.wait(0.2);
  const armed = await g.state();
  t.note(`active tool before firing: ${armed.tools.active} (${armed.tools.status})`);
  t.eq(armed.tools.active, 'aircannon', 'the air cannon is the equipped tool');
  await g.call('tool.fire');
  const cannon = await g.call('tool.debug', 'aircannon');
  t.note(`cannon after fire: ${JSON.stringify(cannon)}`);
  // Isolate: does a radial impulse work at all, independent of the tool?
  const direct = await g.explode(restPos[0], restPos[1], restPos[2], 4, 12);
  const overlapping = await g.overlap(restPos[0], restPos[1], restPos[2], 4);
  t.note(`direct explode pushed ${direct}; ${overlapping} colliders overlap that sphere`);
  t.note(`target body: ${JSON.stringify(await g.call('fruit.body', targetId))}`);
  await g.wait(0.06);
  const blown = await g.call('fruit.info', targetId);
  t.ok(blown, 'the target survives the blast');
  if (blown) {
    t.gt(blown.speed, 3, 'the air cannon launches fruit');
    t.note(`apple left at ${blown.speed} m/s`);
  }

  // The cannon should also shove the player, which is the whole joke.
  //
  // Sampled from the tool at the instant of the impulse rather than from a
  // later state() read: ground friction is ~13/s and a harness round-trip is
  // long enough (especially under software rendering) that the recoil has
  // always decayed to zero by the time a follow-up read lands.
  await g.standAt(-24, 22, 0, 1.0);
  await g.wait(1.6);
  await g.call('tool.fire');
  const shove = await g.call('tool.debug', 'aircannon');
  t.note(`recoil applied: ${JSON.stringify(shove.lastRecoil)} -> player vel ${JSON.stringify(shove.lastVelAfter)}`);
  t.gt(Math.hypot(...shove.lastVelAfter), 2.0, 'firing the air cannon shoves the player');
  await g.wait(1.5);

  // Self-launch: right-click fires straight down.
  await g.standAt(-24, 22, 0, 1.0);
  await g.wait(0.8);
  const groundLevel = (await g.state()).player.pos[1];
  await g.call('tool.secondary', true);
  await g.call('tool.secondary', false);
  let peak = groundLevel;
  for (let i = 0; i < 30; i++) {
    await g.wait(0.05);
    peak = Math.max(peak, (await g.state()).player.pos[1]);
  }
  t.gt(peak - groundLevel, 2.5, 'the air cannon can launch the player upward');
  t.note(`self-launch reached ${(peak - groundLevel).toFixed(1)} m`);

  await g.call('tool.select', 'hand');
  await g.call('fruit.despawnAllFree');
}
