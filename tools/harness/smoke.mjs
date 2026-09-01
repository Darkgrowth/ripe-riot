// Fast boot check: does the game start, render something non-trivial, and stay
// error-free? Prints numbers only — no images. Run this before anything else.

import { withGame } from './driver.mjs';
import { verdict, statLine } from './sheet.mjs';

const res = await withGame(async (g) => {
  const s0 = await g.state();
  const st = await g.stats();
  await g.wait(1.2);
  const s1 = await g.state();

  console.log('--- boot ---');
  console.log('player     ', JSON.stringify(s1.player));
  console.log('physics    ', JSON.stringify(s1.physics));
  console.log('render     ', JSON.stringify(s1.render));
  console.log('profile ms ', JSON.stringify(s1.profile));
  console.log('fps        ', s1.fps);
  console.log('frameStats ', statLine(st), '->', verdict(st));
  console.log('ticks      ', s0.tick, '->', s1.tick);

  const look = await g.probeLook(80);
  console.log('look probe ', JSON.stringify(look));

  const errs = g.consoleErrors.filter((e) => !/DevTools|Autofill|deprecat/i.test(e));
  if (errs.length) { console.log('--- console ---'); errs.slice(0, 20).forEach((e) => console.log('  ', e)); }

  await g.shot('smoke', 'smoke');
  return { st, s1, errs };
}, { headless: true });

const bad = verdict(res.st);
if (bad !== 'ok') { console.error(`\nFAIL: frame looks wrong -> ${bad}`); process.exit(1); }
if (res.s1.tick < 30) { console.error('\nFAIL: simulation not advancing'); process.exit(1); }
console.log('\nOK');
