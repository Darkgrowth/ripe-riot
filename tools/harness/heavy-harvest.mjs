// One real Sunpatch Boulder Plum harvest, exercised through the game controls.
// Debug setup only positions the player and grants already-existing tools;
// picking, throwing, roping, pinning, winching and firing use keyboard/mouse.
import { withGame, ensureOut } from './driver.mjs';
import { contactSheet } from './sheet.mjs';
import path from 'node:path';

const visual = process.argv.includes('--visual');
const ultra = process.argv.includes('--ultrawide');
const viewport = ultra ? [3436, 1270] : visual ? [1920, 1080] : [320, 180];
const shots = [];

let failed = 0;
function check(ok, label, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed++;
}

await withGame(async (g) => {
  const shot = async (name, label, note) => {
    if (!visual && !ultra) return;
    const file = path.join(ensureOut('heavy-harvest'), `${viewport[0]}-${name}.png`);
    await g.page.screenshot({ path: file });
    shots.push({ file, label, note });
  };
  const site = [-35, -11.5];
  const plant = await g.call('plant.nearest', site[0], 21, site[1], 'boulderBush', true);
  const fruitId = async () => g.call('fruit.nodeOf', plant.id, 0);
  const info = async () => g.call('fruit.info', await fruitId());
  const aim = async (point) => {
    const s = await g.state();
    const dx = point[0] - s.player.pos[0], dz = point[2] - s.player.pos[2];
    const dy = point[1] - (s.player.pos[1] + s.player.height - 0.19);
    await g.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    await g.idleFrames(2);
  };
  const at = async (x, z) => g.tp(x, await g.terrainHeight(x, z) + 0.12, z);
  const key = async (name) => { await g.page.keyboard.down(name); await g.simulate(0.08); await g.page.keyboard.up(name); await g.simulate(0.05); };
  const regrow = async () => {
    await g.call('fruit.despawnAllFree');
    const n = await g.call('fruit.regrowNow');
    const next = await info();
    check(n > 0 && next?.species === 'boulderplum' && next?.mass === 48 && next?.value === first.value,
      'emptied nest regrows the same catchable plum for another attempt',
      JSON.stringify({ regrown: n, mass: next?.mass, value: next?.value }));
  };

  check(plant?.pos[0] === site[0] && plant?.pos[2] === site[1], 'authored nest sits at the hill-farm lip', JSON.stringify(plant?.pos));
  const first = await info();
  check(first?.species === 'boulderplum' && first.mass === 48 && first.value >= 300,
    'one ordinary valuable Boulder Plum is attached', JSON.stringify({ mass: first?.mass, value: first?.value }));
  await g.page.click('#view', { position: { x: 30, y: 30 } });
  // Keep the world clock held between explicit input steps. Full-resolution
  // screenshots can take seconds, but must not give a rolling fruit extra time.
  await g.pause(true);

  // Unassisted mistake: lift it, set it down on the slope, watch it escape.
  await at(first.pos[0], first.pos[2] - 2.4);
  await aim(first.pos);
  await shot('attached', 'Slope lip · attached Boulder Plum', 'Ordinary E pick, or prepare a rope first');
  await key('KeyE');
  check((await g.state()).interaction.carrying?.id === first.id, 'E detaches and lifts the heavy fruit');
  await key('KeyQ');
  check((await g.call('fruit.info', first.id))?.state === 'free', 'Q releases it onto the slope');
  await g.simulate(3.0);
  const runaway = await g.call('fruit.info', first.id);
  check(runaway?.state === 'free' && runaway.travelled > 10 && runaway.pos[1] < first.pos[1] - 10,
    'missed fruit rolls down the hill instead of stopping on the plateau',
    JSON.stringify({ pos: runaway?.pos, travelled: runaway?.travelled }));
  check(runaway?.quality === 'Perfect' && runaway.value === first.value,
    'a missed catch keeps its value and can be recovered');

  // Set up the interception spot while paused; the actual grab and delivery
  // remain normal E presses. It is not a claim of a full traversal playthrough.
  await g.pause(true);
  await g.tp(runaway.pos[0], runaway.pos[1] - 0.25, runaway.pos[2] - 1.5);
  await aim(runaway.pos);
  await g.idleFrames(2);
  await shot('intercept', 'After a miss · recover below', `Free fruit travelled ${runaway.travelled.toFixed(1)} m`);
  await key('KeyE');
  await g.simulate(0.08);
  check((await g.state()).interaction.carrying?.id === first.id, 'E catches the escaped plum below the slope');
  const world = await g.call('world.info');
  await g.tp(world.sellPad[0] + 0.7, world.sellPad[1] + 0.1, world.sellPad[2] + 0.7);
  await g.simulate(0.15); // let the normal sell-pad target update after teleport
  const moneyBefore = (await g.state()).economy.money;
  await key('KeyE');
  const sold = await g.state();
  check(sold.economy.money > moneyBefore && !sold.interaction.carrying,
    'caught fruit sells through the normal E action',
    JSON.stringify({ before: moneyBefore, after: sold.economy.money, target: sold.interaction.targetKind, carrying: sold.interaction.carrying?.id }));
  await regrow();

  // Restraint plan: rope the attached fruit, pin the line to nearby ground,
  // then shake the nest. Carrying parks the physical body, so the player
  // deliberately detaches it without lifting it into their hands.
  const second = await info();
  await g.call('tool.give', 'ropegun');
  await at(second.pos[0], second.pos[2] - 2.6);
  await aim(second.pos);
  await key('Digit2');
  await g.page.mouse.down();
  await g.simulate(0.05);
  await g.page.mouse.up();
  await g.simulate(0.05);
  check((await g.call('rope.on', second.id)).length === 1, 'left click ropes the attached fruit');
  const pin = [second.pos[0], await g.terrainHeight(second.pos[0], second.pos[2] - 2.4), second.pos[2] - 2.4];
  await aim(pin);
  await g.page.mouse.down({ button: 'right' });
  await g.simulate(0.05);
  await g.page.mouse.up({ button: 'right' });
  await g.simulate(0.05);
  const pinned = (await g.state()).ropes.list.find(r => r.b === second.id || r.a === second.id);
  check(pinned?.ak === 'world' && pinned?.bk === 'fruit', 'right click pins the near end to terrain', JSON.stringify(pinned));
  await g.call('tool.give', 'shaker');
  await at(second.pos[0], second.pos[2] - 1.0);
  await key('Digit3');
  for (let i = 0; i < 2 && (await g.call('fruit.info', second.id))?.state === 'attached'; i++) {
    await g.page.mouse.down({ button: 'right' });
    await g.simulate(0.05);
    await g.page.mouse.up({ button: 'right' });
    await g.simulate(2.5);
  }
  check((await g.call('fruit.info', second.id))?.state === 'free', 'normal shaker input releases the pre-roped plum');
  await g.simulate(0.8);
  const restrained = await g.call('fruit.info', second.id);
  check(restrained?.state === 'free' && (await g.call('rope.on', second.id)).length === 1,
    'the rope follows the loose fruit after the stem releases');
  await aim(restrained.pos);
  await shot('rope', 'Rope plan · pin then shake', 'The physical fruit remains tied to terrain');
  const ropeBefore = (await g.state()).ropes.list.find(r => r.b === second.id || r.a === second.id);
  await key('Digit2');
  await g.page.mouse.down({ button: 'right' });
  await g.simulate(0.7);
  await g.page.mouse.up({ button: 'right' });
  await g.simulate(0.1);
  const ropeAfter = (await g.state()).ropes.list.find(r => r.b === second.id || r.a === second.id);
  check(ropeAfter && ropeBefore && ropeAfter.len < ropeBefore.len - 0.4,
    'holding right click winches the restrained fruit', `${ropeBefore?.len} -> ${ropeAfter?.len}`);
  console.log('restrained fruit:', restrained?.pos, 'travel:', restrained?.travelled);
  await g.call('rope.clear');
  await regrow();

  // Redirect plan: release the same plum, then aim and fire a charged cannon
  // from an interception spot. No per-fruit or encounter-specific blast rule.
  const third = await info();
  await g.call('tool.give', 'aircannon');
  await at(third.pos[0], third.pos[2] - 2.4);
  await aim(third.pos);
  await key('Digit1');
  await key('KeyE');
  await g.page.mouse.down();
  await g.simulate(0.13);
  await g.page.mouse.up();
  await g.simulate(0.45);
  await g.pause(true);
  let moving = await g.call('fruit.info', third.id);
  await at(moving.pos[0] + 3.2, moving.pos[2] + 0.3);
  await key('Digit3');
  await g.page.mouse.down();
  await g.simulate(0.7);
  moving = await g.call('fruit.info', third.id);
  await aim(moving.pos);
  const velocityBefore = moving.vel;
  await g.page.mouse.up();
  await g.simulate(0.12);
  const redirected = await g.call('fruit.info', third.id);
  const cannon = await g.call('tool.debug', 'aircannon');
  await shot('cannon', 'Air Cannon · redirect the loose plum', `Fruit velocity ${velocityBefore.join(', ')} → ${redirected.vel.join(', ')}`);
  check(cannon.fires > 0 && cannon.lastPushed > 0, 'normal charged cannon shot reaches the loose plum',
    JSON.stringify({ fires: cannon.fires, pushed: cannon.lastPushed, blocked: cannon.lastBlocked }));
  check(redirected.state === 'free' && Math.hypot(...redirected.vel.map((v, i) => v - velocityBefore[i])) > 2,
    'blast redirects it without changing fruit state', `${velocityBefore} -> ${redirected.vel}`);
  const errors = g.consoleErrors.filter(e => !/GPU stall due to ReadPixels/.test(e));
  check(errors.length === 0, 'encounter has no browser console errors', errors.join(' | '));
}, { width: viewport[0], height: viewport[1], headless: true, quiet: true, drawFrames: visual || ultra });

if (shots.length) {
  const sheet = path.join(ensureOut('heavy-harvest'), `${viewport[0]}-evidence.png`);
  await contactSheet(shots, sheet, { cols: 2, thumbW: 720, title: 'RIPE RIOT · one heavy harvest' });
  console.log(`evidence: ${sheet}`);
}

console.log(failed ? `${failed} CHECKS FAILED` : 'OK');
process.exit(failed ? 1 : 0);
