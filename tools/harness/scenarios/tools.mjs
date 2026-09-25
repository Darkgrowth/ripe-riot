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
  //
  // The net is a SWING with a short active window, not a volume you hold
  // open — so this is a timing test. Swing as the apple arrives and it is
  // caught; swing while it is still five metres up and it goes straight past
  // during the recovery, which is a MISS the tool has to say out loud; a press
  // during recovery is not a swing; holding the button flails, which still
  // works on a shower of fruit but never gets a wider window for it.
  await g.call('fruit.despawnAllFree');
  await g.call('basket.clear');
  await g.call('tool.select', 'net');
  await g.wait(0.2);
  const st = await g.state();
  await g.look(st.player.yaw, 1.15);
  await g.wait(0.1);
  const rest = await g.call('tool.debug', 'net');
  t.ok(rest.phase === 'ready' && !rest.active, 'the net starts ready and cannot catch until swung');
  const [ax, ay, az] = rest.hoop;
  const dropApple = (h) => g.call('fruit.spawn', 'apple', ax, ay + h, az);
  const press = async () => { await g.call('tool.primary', true); await g.call('tool.primary', false); };
  const G = 22;   // world gravity (PhysicsWorld.gravity), not 9.81
  /** Seconds until a fruit `above` metres up, falling at `v`, reaches the hoop. */
  const eta = (above, v) => (-v + Math.sqrt(v * v + 2 * G * Math.max(0, above))) / G;
  // Press-to-middle-of-window lead.
  const lead = (rest.window[0] + rest.window[1]) / 2;

  // 1. Timed: swing when the apple is `lead` seconds from the hoop.
  let apple = await dropApple(9);
  let swungAt = null;
  for (let i = 0; i < 60 && swungAt === null; i++) {
    await g.wait(0.05);
    const f = await g.call('fruit.info', apple);
    if (!f) break;
    const above = f.pos[1] - ay;
    if (eta(above, Math.max(1, f.speed)) <= lead + 0.02) { await press(); swungAt = above; }
  }
  await g.wait(0.6);
  const s1 = await g.state();
  const net1 = await g.call('tool.debug', 'net');
  t.ok(swungAt !== null, 'the harness found a moment to swing');
  t.eq(s1.interaction.basket, 1, 'a swing timed to the apple\'s arrival catches it');
  t.eq(net1.misses, 0, 'and that is not a miss');
  t.note(`swung with the apple ${swungAt?.toFixed(2)} m above the hoop; swings ${net1.swings}, caught ${net1.caught}`);
  t.ok((s1.scoring?.seen ?? []).includes('midAir'), 'catching in mid-air awards MID-AIR HARVEST');

  // 2. Early: swing with the apple still ~6 m up. The window has closed and
  //    the net is recovering when the apple goes through the hoop.
  await g.call('basket.clear');
  await g.call('fruit.despawnAllFree');
  await g.wait(0.7);
  apple = await dropApple(9);
  let early = null;
  for (let i = 0; i < 60 && early === null; i++) {
    await g.wait(0.05);
    const f = await g.call('fruit.info', apple);
    if (!f) break;
    const above = f.pos[1] - ay;
    if (above <= 6.2) { await press(); early = above; }
  }
  const mid = await g.call('tool.debug', 'net');
  t.eq(mid.phase, 'swing', 'the press starts a swing');
  // 3. Recovery: pressing again right after the swing does not swing again.
  await g.wait(0.36);
  const rec = await g.call('tool.debug', 'net');
  t.eq(rec.phase, 'recover', 'after the swing the net is recovering');
  await press();
  await g.wait(0.05);
  const rec2 = await g.call('tool.debug', 'net');
  t.eq(rec2.swings, rec.swings, 'a press during recovery is not a swing');
  await g.wait(0.8);
  const s2 = await g.state();
  const net2 = await g.call('tool.debug', 'net');
  t.eq(s2.interaction.basket, 0, 'a swing made too early catches nothing');
  t.eq(net2.misses, 1, 'and the apple going past the hoop registers as a MISS');
  t.note(`early swing with the apple ${early?.toFixed(2)} m up: swings ${net2.swings}, misses ${net2.misses}`);

  // 4. Flailing: holding the button swings again and again, on the same clock.
  await g.call('fruit.despawnAllFree');
  await g.wait(0.7);
  const swingsBefore = (await g.call('tool.debug', 'net')).swings;
  await g.call('tool.primary', true);
  await g.input({ primary: true });
  await g.wait(1.6);
  await g.clearInput();
  await g.call('tool.primary', false);
  const flail = await g.call('tool.debug', 'net');
  t.between(flail.swings - swingsBefore, 2, 3,
    'holding the button flails: repeated swings, each with the same window');
  await g.wait(0.8);

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
  // A blast that moves things but leaves no mark reads as a physics cheat
  // rather than as a tool, so the puff at the blast centre is part of the
  // contract, not decoration.
  const fxBefore = armed.fx.spawned;
  const kickBefore = (await g.state()).viewmodel.kick;
  await g.call('tool.fire');
  // Recoil starts as velocity; the arm pose changes on the next rendered frame.
  await g.idleFrames(2);
  const fired = await g.state();
  t.gt(fired.fx.spawned, fxBefore, 'firing the cannon puts a visible blast in the world');
  t.ok(fired.viewmodel.kick !== kickBefore, 'and it moves the arms');
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
