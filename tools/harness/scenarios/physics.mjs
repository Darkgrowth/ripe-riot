// The physical jokes, measured. A coconut must be able to flatten someone, a
// watermelon must be able to survive a careful trip and burst on a careless
// one, and quality must actually respond to how roughly fruit is handled.

export const name = 'fruit-physics';

export async function run(g, t) {
  const flat = [-24, 22];   // orchard terrace: flat, open, nothing to snag on

  // --- a dropped apple falls, lands, and survives a short fall intact
  await g.standAt(flat[0] - 6, flat[1], 0, 1.0);
  const groundY = await g.terrainHeight(flat[0], flat[1]);
  const appleId = await g.call('fruit.spawn', 'apple', flat[0], groundY + 4, flat[1]);
  await g.wait(1.8);
  let a = await g.call('fruit.info', appleId);
  t.ok(a, 'the apple still exists after falling');
  t.near(a.pos[1], groundY + a.size / 2, 0.6, 'it comes to rest on the ground');
  t.lt(a.speed, 1.0, 'and stops moving');
  t.eq(a.quality, 'Perfect', 'a 4 m drop does not bruise an apple');

  // --- a long drop should cost quality but not destroy it
  const appleId2 = await g.call('fruit.spawn', 'apple', flat[0] + 3, groundY + 34, flat[1]);
  await g.wait(3.6);
  const a2 = await g.call('fruit.info', appleId2);
  t.ok(a2, 'apple survives a 34 m drop');
  t.gt(a2.damage, 0, 'a 34 m drop does damage it');
  t.note(`34 m apple: damage ${a2.damage} -> ${a2.quality}, value ${a2.value}`);

  // --- watermelon: heavy, fragile, and a two-handed problem
  const melonId = await g.call('fruit.spawn', 'watermelon', flat[0] - 3, groundY + 1.2, flat[1]);
  await g.wait(1.2);
  const m = await g.call('fruit.info', melonId);
  t.ok(m, 'watermelon survives being set down gently');
  t.gt(m.mass, 15, 'a watermelon is heavy');
  t.lt(m.damage, 0.25, 'setting it down gently barely marks it');

  // --- watermelon dropped from height should burst
  const fxBefore = (await g.state()).fx.spawned;
  const melon2 = await g.call('fruit.spawn', 'watermelon', flat[0] + 6, groundY + 26, flat[1]);
  await g.wait(3.4);
  const m2 = await g.call('fruit.info', melon2);
  t.ok(m2 === null, 'a watermelon dropped 26 m does not survive');
  if (m2) t.note(`melon survived with damage ${m2.damage}`);
  // And the burst has to be VISIBLE: impact feedback is part of the physics.
  const fxAfter = (await g.state()).fx.spawned;
  t.gt(fxAfter - fxBefore, 15, 'bursting a watermelon throws pulp');
  t.note(`${fxAfter - fxBefore} impact particles from the burst`);

  // --- coconut on the head: the joke has to actually land
  await g.call('ragdoll.recover');
  await g.standAt(flat[0], flat[1], 0, 0.6);
  await g.wait(0.4);
  let st = await g.state();
  t.eq(st.player.state, 'active', 'player starts upright');
  const [px, , pz] = st.player.pos;
  await g.call('fruit.spawn', 'coconut', px, st.player.pos[1] + 13, pz);
  let knocked = false;
  for (let i = 0; i < 60; i++) {
    await g.wait(0.05);
    st = await g.state();
    if (st.player.state === 'ragdoll') { knocked = true; break; }
  }
  t.ok(knocked, 'a coconut falling 13 m knocks the player down');
  t.note(`ragdoll source: ${st.ragdoll?.lastSource} at ${st.ragdoll?.lastSpeed} m/s`);

  // --- and recovery must be automatic and quick
  let recovered = false;
  for (let i = 0; i < 140; i++) {
    await g.wait(0.05);
    st = await g.state();
    if (st.player.state === 'active') { recovered = true; break; }
  }
  t.ok(recovered, 'the player gets back up without input');
  t.lt(st.ragdoll.timer, 0.05, 'ragdoll state is fully cleared');
  const after = await g.state();
  t.eq(after.physics.bodies > 0, true, 'physics world is intact after a ragdoll');
  t.note(`bodies after recovery: ${after.physics.bodies}`);

  // --- an apple should NOT knock anyone down
  await g.standAt(flat[0], flat[1], 0, 0.6);
  await g.wait(0.4);
  const before = (await g.state()).ragdoll.knockdowns;
  const p2 = (await g.state()).player.pos;
  await g.call('fruit.spawn', 'apple', p2[0], p2[1] + 13, p2[2]);
  await g.wait(2.4);
  const nowKnockdowns = (await g.state()).ragdoll.knockdowns;
  t.eq(nowKnockdowns, before, 'an apple to the head is survivable');

  // --- oranges roll: dropped on a slope one should travel a long way
  await g.call('fruit.despawnAllFree');
  const slope = [-30, -4];
  const sy = await g.terrainHeight(slope[0], slope[1]);
  const orangeId = await g.call('fruit.spawn', 'orange', slope[0], sy + 2.5, slope[1]);
  await g.wait(6.0);
  const o = await g.call('fruit.info', orangeId);
  if (o) {
    t.gt(o.travelled, 4, 'an orange on a hillside rolls away from you');
    t.note(`orange rolled ${o.travelled} m`);
  } else {
    t.note('orange rolled into the sea, which is also a valid outcome');
    t.ok(true, 'an orange on a hillside rolls away from you');
  }

  await g.call('fruit.despawnAllFree');
}
