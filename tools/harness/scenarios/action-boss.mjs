export const name = 'action-boss';

export async function run(g, t) {
  const boss = await g.call('kingVine.info');
  const [x, y, z] = boss.center;
  await g.standAt(x, z - 3.2);
  await g.faceTo(x, y + 1.7, z);
  await g.wait(1.72);
  const exposed = await g.call('kingVine.info');
  t.eq(exposed.phase, 'recover', 'King Vine warns and attacks before exposing its stem');
  await g.call('tool.give', 'aircannon');
  await g.call('tool.select', 'aircannon');
  await g.call('tool.fire');
  const hit = await g.call('kingVine.info');
  t.lt(hit.health, exposed.health, 'a player-fired Air Cannon damages the exposed stem');
  t.ok(!hit.subdued, 'the guardian survives the first hit and demands another opening');
}
