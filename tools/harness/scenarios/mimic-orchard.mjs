export const name = 'mimic-orchard';

export async function run(g, t) {
  const start = (await g.call('encounters.info')).threats.mimic;
  t.between(start.pos[0], -26, -21, 'Mimic waits in the open center orchard lane');
  t.between(start.pos[2], 20, 24, 'the center lane leaves lateral dodge room');

  // The lower rail is near z=17 at x=-23. The player starts outside it.
  await g.standAt(-23, 14.5);
  const beforeHealth = (await g.state()).vitals.health;
  await g.wait(1.6);
  const after = (await g.call('encounters.info')).threats.mimic;
  t.gt(after.pos[2], 17.2, 'the charge stops before the solid lower rail');
  t.eq((await g.state()).vitals.health, beforeHealth,
    'the Mimic cannot damage a player through the rail');
}
