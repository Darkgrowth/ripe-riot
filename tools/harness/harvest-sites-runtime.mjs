import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startServer, openGame, openSecondClient, sleep, ROOT } from './driver.mjs';
const out = path.join(ROOT, 'docs/evidence/sunpatch-expedition/harvest-sites');
mkdirSync(out, { recursive: true });
const report = { url: process.env.RIPE_URL, fixture: 'Teleport and aim establish site views; E is real keyboard input. Save/restore and cover cases are explicitly isolated fixtures.', checks: [], errors: [] };
function check(ok, label, detail = '') { report.checks.push({ok: !!ok,label,detail}); console.log(`${ok ? 'PASS':'FAIL'} ${label} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); assert.ok(ok,label); }
let game;
await startServer();
try {
  game = await openGame({ quiet: true, islandActivities: false, headless: true });
  await game.page.mouse.click(640,360); await sleep(100);
  const sites = (await game.call('encounters.info')).sites;
  report.sites = sites;
  const orchard = sites.find(s => s.id === 'orchard-mimic');
  await game.tp(-23, await game.terrainHeight(-23,27.6) + .1, 27.6);
  await sleep(200);
  async function aim(g,id) {
    const angles = await g.page.evaluate(id => { const p=window.__GAME.player.eyePosition,f=window.__GAME.get('fruit').get(id).position;
      const dx=f.x-p.x,dy=f.y-p.y,dz=f.z-p.z; return [Math.atan2(-dx,-dz),Math.atan2(dy,Math.hypot(dx,dz))]; },id);
    await g.look(...angles); await sleep(100);
  }
  await aim(game,orchard.fruitIds[0]);
  report.before = await game.state();
  check(report.before.encounters.threats.mimic.dormant, 'Mimic stays dormant beside ordinary orchard traversal');
  check(orchard.fruitIds.includes(report.before.interaction.target?.id), 'normal E targets authored melon', report.before.interaction);
  await game.page.screenshot({path:path.join(out,'orchard-before.png')});
  await game.page.keyboard.press('KeyE'); await sleep(160);
  report.warning = await game.state();
  check(report.warning.encounters.sites[0].phase === 'warning', 'first real E warns');
  check(await game.page.evaluate(ids => ids.every(id=>window.__GAME.get('fruit').get(id).state==='attached'),orchard.fruitIds), 'first E leaves every prize attached');
  await game.page.screenshot({path:path.join(out,'orchard-warning.png')});
  await sleep(700);
  await game.page.keyboard.press('KeyE'); await sleep(160);
  report.active = await game.state();
  check(report.active.encounters.sites[0].phase === 'active' && !report.active.encounters.threats.mimic.dormant, 'second real E releases harvest and wakes Mimic');
  check(report.active.interaction.carriedId === orchard.fruitIds[0], 'prize is a real carried fruit', report.active.interaction);
  await game.page.screenshot({path:path.join(out,'orchard-active.png')});
  await game.tp(35,await game.terrainHeight(35,55)+.1,55);
  await sleep(1400);
  await game.page.keyboard.press('KeyQ'); await sleep(120);
  report.saved = await game.page.evaluate(() => window.__GAME.get('encounters').serialize());
  const restored = await game.page.evaluate(() => { const e=window.__GAME.get('encounters'),saved=e.serialize(); e.deserialize(saved); return e.serialize(); });
  check(restored.sites[0].phase==='active' && restored.sites[0].released.includes(orchard.fruitIds[0]),'released site survives save restore without another activation');
  // Sale/persistence fixture: put the retrieved prize at the actual sell pad,
  // then use E so the normal authority/economy path records consumption.
  check(await game.call('pickup',orchard.fruitIds[0]), 'restored prize can be retrieved');
  const pad = await game.page.evaluate(()=>window.__GAME.get('world').sellPad.toArray());
  await game.tp(pad[0],pad[1]+.15,pad[2]); await sleep(250);
  await game.page.keyboard.press('KeyE'); await sleep(200);
  const sold = await game.page.evaluate(id=>({
    money:window.__GAME.get('economy').money,
    saved:window.__GAME.get('encounters').serialize(),
    state:window.__GAME.get('fruit').get(id)?.state??'absent'
  }),orchard.fruitIds[0]);
  report.sale=sold;
  check(sold.saved.sites[0].consumed.includes(orchard.fruitIds[0]),'real sale consumes the authored prize ledger');
  const afterSaleRestore=await game.page.evaluate(saved=>{
    const g=window.__GAME,e=g.get('encounters');e.deserialize(saved);e.deserialize(saved);
    return {money:g.get('economy').money,fruit:g.get('fruit').get(saved.sites[0].fruitIds[0])?.state??'absent'};
  },sold.saved);
  check(afterSaleRestore.fruit==='absent' && afterSaleRestore.money===sold.money,
    'repeated restore cannot mint sold prize or pay another reward',afterSaleRestore);
  report.errors = game.consoleErrors.filter(e=>e.startsWith('pageerror:'));
  check(report.errors.length===0,'no runtime exceptions',report.errors);
} finally { writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)); await game?.close(); }
