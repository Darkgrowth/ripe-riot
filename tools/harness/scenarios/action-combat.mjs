export const name = 'action-combat';

export async function run(g, t) {
  // The shared scenario reset settles the player inside the relocated orchard
  // ambush. Start this combat contract before that proximity moves the Mimic.
  await g.call('encounters.reset');
  const before = await g.call('encounters.info');
  const mimic = before.threats.mimic;
  t.ok(mimic && mimic.health > 0, 'a suspicious harvest is present on Sunpatch');

  const [x, y, z] = mimic.pos;
  const startingMoney = (await g.state()).economy.money;
  await g.standAt(x, z - 2.2);
  await g.faceTo(x, y + 1.15, z);
  await g.call('tool.select', 'hand');
  await g.call('tool.fire');
  await g.wait(0.22); // contact arrives during the visible mallet arc
  const struck = await g.call('encounters.info');
  t.lt(struck.threats.mimic.health, mimic.health,
    'the starting picking tool can directly defend against a Mimic Melon');

  await g.call('tool.give', 'aircannon');
  await g.call('tool.select', 'aircannon');
  await g.wait(0.45); // let the mallet recovery and Mimic reaction settle
  await g.call('tool.fire');
  const blasted = await g.call('encounters.info');
  t.lt(blasted.threats.mimic.health, struck.threats.mimic.health,
    'the early Air Cannon also damages the threatening harvest');

  if (blasted.threats.mimic.phase !== 'defeated') {
    await g.wait(0.55);
    await g.call('tool.fire');
  }
  const defeated = await g.call('encounters.info');
  t.eq(defeated.threats.mimic.phase, 'defeated', 'the starter and early tool can finish the encounter');
  t.gt((await g.state()).economy.money, startingMoney,
    'a dangerous harvest gives a dependable base reward');
  await g.call('encounters.reset');
}
