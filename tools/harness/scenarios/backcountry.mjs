// The three back-country fruit. Each is one rule, stated physically, and each
// rule is the opposite of something the first seven fruit taught:
//
//   Boulder Plum   an apple you can pick up, except it weighs forty-eight
//                  kilos and once it is rolling it does not stop
//   Gluefruit      an orange that does not roll: it stops dead where it lands,
//                  and if it lands on you, you are holding it now
//   Spikefruit     a coconut you cannot touch at all — the net is a hand,
//                  your hands are not
//
// Asserted in forced fixed steps, so the numbers mean the same thing everywhere.

export const name = 'backcountry';

export async function run(g, t) {
  const world = await g.call('world.info');
  const st0 = await g.state();
  const [px, py, pz] = st0.player.pos;

  // ------------------------------------------------------------ the island
  const attached = await g.call('fruit.list', 'attached');
  const count = (sp) => attached.filter((f) => f.species === sp).length;
  t.gt(count('boulderplum'), 0, 'Boulder Plums grow on Sunpatch');
  t.gt(count('gluefruit'), 0, 'so does Gluefruit');
  t.gt(count('spikefruit'), 0, 'and Spikefruit');
  t.note(`attached: ${count('boulderplum')} boulder plums, ${count('gluefruit')} gluefruit, ${count('spikefruit')} spikefruit`);
  const book = await g.call('book.all');
  t.eq(book.length, 10, 'the harvest book has ten species');
  // Where they grow is the escalation: none of the three within the orchard.
  const orchard = world.landmarks.orchard;
  const near = (sp) => attached.filter((f) => f.species === sp).length
    && (async () => {
      const n = await g.call('fruit.nearest', orchard.pos[0], orchard.pos[1], orchard.pos[2], sp, 'attached');
      return n ? n.dist : Infinity;
    })();
  for (const sp of ['boulderplum', 'gluefruit', 'spikefruit']) {
    const d = await near(sp);
    t.gt(d, orchard.radius, `${sp} grows well beyond the orchard`, `${d.toFixed(0)} m from its centre`);
  }
  // The far corners pay better: the ridge rolls rare variants more often.
  const rare = await g.page.evaluate(() => {
    const fs = window.__GAME.get('fruit');
    const w = window.__GAME.get('world');
    const ridge = w.at('ridge'), orchard = w.at('orchard');
    let ridgeAll = 0, ridgeRare = 0, orchAll = 0, orchRare = 0;
    for (const f of fs.fruits.values()) {
      if (f.state !== 'attached') continue;
      const dr = f.position.distanceTo(ridge.position), dO = f.position.distanceTo(orchard.position);
      if (dr < ridge.radius + 4) { ridgeAll++; if (f.variant) ridgeRare++; }
      if (dO < orchard.radius + 4) { orchAll++; if (f.variant) orchRare++; }
    }
    return { ridgeAll, ridgeRare, orchAll, orchRare };
  });
  t.note(`rare variants: ridge ${rare.ridgeRare}/${rare.ridgeAll}, orchard ${rare.orchRare}/${rare.orchAll}`);
  t.gt(rare.ridgeAll, 8, 'the ridge carries fruit to roll variants on');

  // ---------------------------------------------------------- boulder plum
  await g.call('fruit.despawnAllFree');
  const plum = await g.call('fruit.spawn', 'boulderplum', px + 1.2, py + 1.0, pz - 1.2);
  await g.wait(0.8);
  const pi = await g.call('fruit.info', plum);
  t.between(pi.mass, 30, 70, 'a Boulder Plum weighs what a small person weighs');
  t.eq(await g.call('carry.class', 0.5, pi.mass), pi.mass > 60 ? 'oversized' : 'large',
    'and it is a two-handed haul at best');
  t.ok(await g.call('pickup', plum), 'a typical one can still be picked up');
  const carrying = (await g.state()).interaction.carrying;
  t.ok(carrying && carrying.heavy, 'as a heavy haul');
  await g.call('drop');
  await g.call('fruit.despawnAllFree');
  await g.wait(0.3);

  // Rolling: released on the hill farm's shoulder it should go a long way.
  // The slope down from the plateau toward the orchard was measured at 29°;
  // an apple would bounce and stop, a plum keeps going.
  const slopeX = -31, slopeZ = -8;
  const slopeY = await g.terrainHeight(slopeX, slopeZ);
  await g.standAt(slopeX + 4, slopeZ + 4, 0, 1.2);
  const roller = await g.call('fruit.spawn', 'boulderplum', slopeX, slopeY + 0.6, slopeZ);
  await g.wait(7.0);
  const rolled = await g.call('fruit.info', roller);
  if (rolled) {
    t.gt(rolled.travelled, 6, 'let go on a slope, it rolls a long way', `${rolled.travelled} m`);
    t.note(`boulder plum rolled ${rolled.travelled} m, peak ${rolled.peakSpeed} m/s, quality ${rolled.quality}`);
    t.eq(rolled.quality, 'Perfect', 'and does not bruise doing it');
  } else {
    t.note('the boulder plum rolled off the island, which is the warning on the sign');
    t.ok(true, 'let go on a slope, it rolls a long way');
  }
  await g.call('fruit.despawnAllFree');

  // A rolling plum flattens a person. Roll one into the player at speed,
  // from close enough that no trunk can get in the way first.
  await g.standAt(-24, 22, 0, 0.4);
  const s1 = await g.state();
  const [hx, hy, hz] = s1.player.pos;
  const yaw = s1.player.yaw;
  const fwd = [-Math.sin(yaw), -Math.cos(yaw)];
  const kd0 = s1.ragdoll.knockdowns;
  const bowl = await g.call('fruit.spawn', 'boulderplum', hx + fwd[0] * 2.6, hy + 0.3, hz + fwd[1] * 2.6);
  await g.wait(0.05);
  const bm = (await g.call('fruit.info', bowl)).mass;
  await g.call('fruit.impulse', bowl, -fwd[0] * bm * 12, 0, -fwd[1] * bm * 12);
  let flattened = false;
  for (let i = 0; i < 30 && !flattened; i++) {
    await g.wait(0.1);
    flattened = (await g.state()).ragdoll.knockdowns > kd0;
  }
  t.ok(flattened, 'a Boulder Plum rolling at you is a knockdown',
    `ragdoll ${JSON.stringify((await g.state()).ragdoll)}`);
  await g.wait(2.5);
  await g.call('ragdoll.recover');
  await g.call('fruit.despawnAllFree');
  await g.wait(0.3);

  // ------------------------------------------------------------- gluefruit
  await g.standAt(-24, 22, 0, 0.4);
  const s2 = await g.state();
  const [gx, gy, gz] = s2.player.pos;
  const glue = await g.call('fruit.spawn', 'gluefruit', gx + 3, gy + 3.5, gz);
  await g.wait(1.6);
  const gi = await g.call('fruit.info', glue);
  t.ok(gi && gi.state === 'free', 'a dropped gluefruit stays in the world');
  t.ok(gi && gi.stuck, 'and sticks where it lands');
  const gb = await g.call('fruit.body', glue);
  t.eq(gb?.bodyType, 1, 'as a fixed body — it is not going anywhere on its own');
  // A shove peels it off.
  const before = gi.pos.slice();
  await g.faceTo(gi.pos[0], gi.pos[1], gi.pos[2]);
  await g.wait(0.2);
  t.ok(await g.call('shove', glue), 'it can be shoved');
  await g.wait(1.2);
  const after = await g.call('fruit.info', glue);
  t.ok(!after.stuck || Math.hypot(after.pos[0] - before[0], after.pos[2] - before[2]) > 0.2,
    'and a shove unsticks it', `moved ${Math.hypot(after.pos[0] - before[0], after.pos[2] - before[2]).toFixed(2)} m`);
  // Picked up on purpose, it holds the hands for a moment.
  t.ok(await g.call('pickup', glue), 'it can be picked up');
  let inter = (await g.state()).interaction;
  t.gt(inter.stuckHands, 0.5, 'and it sticks to the hands');
  await g.call('throw');
  inter = (await g.state()).interaction;
  t.ok(inter.carrying && inter.carrying.id === glue, 'a throw while it is stuck goes nowhere');
  await g.wait(2.0);
  await g.call('throw');
  await g.wait(0.2);
  inter = (await g.state()).interaction;
  t.ok(!inter.carrying, 'and once it lets go, it throws');
  await g.call('fruit.despawnAllFree');
  await g.wait(0.3);

  // Thrown AT you, it is yours whether you like it or not.
  await g.standAt(-24, 22, 0, 0.4);
  const s3 = await g.state();
  const [ax, ay, az] = s3.player.pos;
  // From 1.6 m, a little upward, so it reaches the chest before gravity
  // has time to put it on the grass (where it would stick to that instead).
  const missile = await g.call('fruit.spawn', 'gluefruit', ax + 1.6, ay + 1.1, az);
  await g.wait(0.05);
  const gm = (await g.call('fruit.info', missile)).mass;
  await g.call('fruit.impulse', missile, -gm * 7, gm * 2.2, 0);
  let caught = null;
  for (let i = 0; i < 20 && !caught; i++) {
    await g.wait(0.05);
    const c = (await g.state()).interaction.carrying;
    if (c && c.id === missile) caught = (await g.state()).interaction;
  }
  t.ok(caught, 'a gluefruit that hits you ends up in your hands');
  if (caught) t.gt(caught.stuckHands, 2, 'for longer than one you picked up yourself');
  await g.call('drop');
  await g.call('fruit.despawnAllFree');
  await g.wait(0.3);

  // ------------------------------------------------------------ spikefruit
  await g.standAt(-24, 22, 0, 0.4);
  const s4 = await g.state();
  const [sx, sy, sz] = s4.player.pos;
  const spike = await g.call('fruit.spawn', 'spikefruit', sx + 2.0, sy + 0.5, sz);
  await g.wait(1.0);
  const si = await g.call('fruit.info', spike);
  await g.faceTo(si.pos[0], si.pos[1], si.pos[2]);
  await g.wait(0.2);
  inter = (await g.state()).interaction;
  t.eq(inter.targetKind, 'spiky', 'looking at a spikefruit offers no pick');
  t.ok((inter.prompt ?? '').includes('spiky'), 'and the prompt says why');
  const pricks0 = inter.pricks;
  t.ok(!(await g.call('interact')), 'E does not pick it up');
  inter = (await g.state()).interaction;
  t.ok(!inter.carrying, 'nothing is in the hands');
  t.eq(inter.pricks, pricks0 + 1, 'and you got pricked for trying');
  t.ok(!(await g.call('pickup', spike)), 'a direct pick is refused the same way');
  // The net is the tool. Its hoop is not a hand.
  t.ok(await g.call('pickup', spike, 'net'), 'the catch net takes it');
  t.ok(await g.call('stow'), 'and it goes in the basket');
  t.eq((await g.state()).interaction.basket, 1, 'where it counts as one fruit');
  await g.call('basket.clear');
  await g.call('fruit.despawnAllFree');
  await g.wait(0.3);

  // It sells, and the book knows it.
  const spikeOnPad = await g.call('fruit.spawn', 'spikefruit', world.sellPad[0], world.sellPad[1] + 2.5, world.sellPad[2]);
  await g.call('economy.set', 0);
  let paid = 0;
  for (let i = 0; i < 50 && !paid; i++) {
    await g.wait(0.1);
    paid = (await g.state()).economy.money;
  }
  t.gt(paid, 0, 'a spikefruit that lands on the pad sells itself', `$${paid}`);
  const rec = await g.call('book.get', 'spikefruit');
  t.ok(rec.discovered && rec.harvested > 0, 'and the harvest book records it');
  void spikeOnPad;

  await g.call('fruit.despawnAllFree');
  await g.call('economy.set', 0);
}
