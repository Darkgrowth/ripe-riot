// Rendered fixtures for combat advice visibility; separate from real-input bait proof.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withGame, ROOT } from './driver.mjs';
const out = path.join(ROOT, 'capture/sunpatch-playful/cues');
mkdirSync(out, {recursive: true});
const report = {viewport: [3440,1440], frames: [], errors: []};
await withGame(async g => {
  await g.pause(true); await g.call('encounters.suspend', true); await g.input({});
  await g.page.evaluate(() => document.querySelector('.entry-hint')?.remove());
  const [x,y,z] = (await g.call('encounters.info')).threats.snapjaw.pos;
  const py = await g.terrainHeight(x,z+7);
  await g.tp(x,py+.15,z+7);
  await g.look(0,Math.atan2(y+1.3-py-1.7,7)); await g.advance(2);
  const shot = async name => {
    await g.page.waitForTimeout(130);
    const cue = await g.page.locator('.encounter-cue').evaluate(el => ({
      hidden:el.hidden, text:el.textContent, tone:el.dataset.tone, target:el.dataset.target,
      rect:el.getBoundingClientRect().toJSON(),
    }));
    await g.page.screenshot({path:path.join(out,`${name}.png`)});
    report.frames.push({name,...cue}); return cue;
  };
  const idle = await shot('01-guarded');
  assert.equal(idle.hidden,false); assert.equal(idle.target,'snapjaw');
  assert.match(idle.text,/Toss fruit/);
  await g.call('encounters.bait');
  assert.equal((await shot('02-baited')).tone,'bait');
  await g.call('encounters.suspend',false); await g.advance(70);
  assert.equal((await shot('03-opening')).tone,'opening');
  await g.look(Math.PI,0); await g.advance(1);
  assert.equal((await shot('04-look-away')).hidden,true);
  await g.look(0,Math.atan2(y+1.3-py-1.7,7)); await g.advance(1);
  // Inject the obstruction result for this visibility-only fixture; this
  // checks UI hiding, not the world's collider placement.
  await g.page.evaluate(() => {
    window.__cueRaycast = window.__GAME.physics.raycast;
    window.__GAME.physics.raycast = () => ({distance:.4});
  });
  assert.equal((await shot('05-obstructed')).hidden,true);
  await g.page.evaluate(() => { window.__GAME.physics.raycast = window.__cueRaycast; });
  await g.page.evaluate(() => { window.__GAME.get('shop').open = true; });
  assert.equal((await shot('06-menu')).hidden,true);
  await g.page.evaluate(() => { window.__GAME.get('shop').open = false; });
  await g.clearInput();
  report.errors = g.consoleErrors;
}, {width:3440,height:1440,headless:true,quiet:true,islandActivities:false});
writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
assert.deepEqual(report.errors,[]);
console.log(JSON.stringify(report));
