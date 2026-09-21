// Isolated, software-rendered screenshots. No desktop or user-browser control.
import { withGame, ensureOut } from './driver.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const out = ensureOut('alive/visual');
const views = [];
await withGame(async g => {
  await g.pause(true);
  await g.call('director.reset', false); await g.call('characters.reset', false);
  await g.page.waitForTimeout(2000);
  const cdp = await g.ctx.newCDPSession(g.page);
  // Retain actual renderer; render once per capture instead of saturating the
  // CPU with SwiftShader while the user plays in their separate browser.
  await g.page.evaluate(() => {
    const r = window.__GAME.renderer;
    window.__qaRender = r.render.bind(r); r.render = () => {};
  });
  async function shot(id) {
    if (process.env.VISUAL_FILTER && !new RegExp(process.env.VISUAL_FILTER).test(id)) return;
    await g.page.waitForTimeout(120);
    await g.page.evaluate(() => window.__qaRender());
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(out, `${id}.png`), Buffer.from(data, 'base64'));
    views.push(id);
  }
  async function walking(feet, target) {
    await g.attachCam(); await g.tp(...feet);
    const dx = target[0] - feet[0], dz = target[2] - feet[2];
    await g.look(Math.atan2(-dx, -dz), Math.atan2(target[1] - feet[1] - 1.63, Math.hypot(dx, dz)));
  }
  const signs = await g.page.evaluate(() => window.__GAME.get('world').built.signs.map(s => {
    const a = s.userData.signAudit;
    const q = s.quaternion, x = 2 * (q.x * q.z + q.w * q.y), z = 1 - 2 * (q.x*q.x + q.y*q.y);
    return { ...a, pos: s.position.toArray(), normal: [x, 0, z] };
  }));
  for (const [index, s] of signs.entries()) {
    const n = s.normal, p = s.pos, dist = Math.max(2.1, s.width * 1.2);
    const x = p[0] + n[0]*dist, z = p[2] + n[2]*dist;
    await walking([x, await g.terrainHeight(x,z) + .02, z], p);
    await shot(`sign-${String(index).padStart(2,'0')}-${s.id}-approach`);
    await g.freeCam([p[0]+n[0]*dist*.75, p[1], p[2]+n[2]*dist*.75], p);
    await shot(`sign-${String(index).padStart(2,'0')}-${s.id}-face`);
    if (!['wanted','shop'].includes(s.id)) {
      const bx = p[0]-n[0]*dist, bz = p[2]-n[2]*dist;
      await walking([bx, await g.terrainHeight(bx,bz)+.02,bz],p);
      await shot(`sign-${String(index).padStart(2,'0')}-${s.id}-back`);
    }
  }
  const config = JSON.parse(readFileSync('capture/zone-repair/qa/repair-qa-config.json','utf8'));
  for (const v of config.exteriorViews) { await walking(v.feet,v.target); await shot(v.id); }
  // The central reverse approach lands inside the shed. Inspect the gantry
  // board from the exterior side lane, behind its face, at walking height.
  const mainBoard = signs.find(s => s.id === 'merv-s-supply');
  if (mainBoard) {
    const x = 45 + 5 * Math.cos(-.9) + 4.5 * Math.sin(-.9);
    const z = 52 - 5 * Math.sin(-.9) + 4.5 * Math.cos(-.9);
    await walking([x, await g.terrainHeight(x,z) + .02, z], mainBoard.pos);
    await shot('shop-main-sign-rear');
  }
  const dockViews = await g.page.evaluate(() => {
    const d=window.__GAME.get('world').built.dock;
    return [[-2.25,1.9],[2.25,.9],[-2.3,3.2]].map(([x,z],i)=>({id:`dock-crates-${i}`,
      feet:d.toWorld(0,z+2).toArray(),target:d.toWorld(x,z,d.deckTop+.55).toArray()}));
  });
  for(const v of dockViews) { await walking(v.feet,v.target); await shot(v.id); }
  const apron = await g.page.evaluate(() => {
    const p=window.__GAME.get('world').built.mesh.geometry.userData.authoredProps.find(p=>p.id==='shop-apron-crate');
    return p ? p.matrix.slice(12,15) : null;
  });
  if(apron) { await walking([apron[0]-2,await g.terrainHeight(apron[0]-2,apron[2]+1.5)+.02,apron[2]+1.5],apron); await shot('shop-apron-crate'); }
  const propViews = [
    ['reported-orchard-crates',[-22.6,29.2],[-21,1,27.4]],
    ['reported-orchard-crates-side',[-17,27],[-21,1,27.4]],
    ['orchard-crates-west',[-29,24],[-27.5,1,21]],
    ['orchard-ladder',[ -15,34],[-13.5,1.5,30]],
    ['orchard-ladder-side',[-10,30],[-13.5,1.5,30]],
    ['hill-workbench',[-16,-21],[-16,0.9,-25.55]],
    ['hill-tray-supports',[-18,-23],[-17.25,0.45,-25.61]],
    ['beach-workbench',[-54,61],[-54,1,57]],
    ['ravine-reel',[-1.5,-33],[-1.5,1.38,-37.5]],
    ['ravine-reel-side',[2,-37.5],[-1.5,1.38,-37.5]],
    ['gull-perch',[-10,36],[-12.5,1.8,32.8]],
  ];
  for (const [id, feet, target] of propViews) {
    const h = await g.terrainHeight(target[0],target[2]);
    await walking([feet[0],await g.terrainHeight(...feet)+.02,feet[1]], [target[0],h+target[1],target[2]]);
    await shot(id);
  }
  const m = await g.page.evaluate(() => window.__GAME.get('characters').merv.position.toArray());
  for (const [id,off] of [['merv-counter',[-3,0,3]],['merv-side',[-4,0,.5]]]) {
    const x=m[0]+off[0], z=m[2]+off[2];
    await walking([x,await g.terrainHeight(x,z)+.02,z],[m[0],m[1]+1.4,m[2]]);
    await g.call('characters.speak',0); await shot(id);
  }
  for (const [kind,x,z] of [['windfall',-24,22],['coconuts',52.5,63.5],['order',40.77,55.36]]) {
    await g.call('director.reset',false);
    const h=await g.terrainHeight(x,z);
    await walking([x,h+.02,z],[x-2,h+2,z-5]);
    await g.call('director.start',kind); await shot(`event-${kind}`);
  }
  writeFileSync(path.join(out,'metadata.json'),JSON.stringify({signs,views,errors:g.consoleErrors},null,2));
}, { width:960,height:540,headless:true,quiet:true });
writeFileSync(path.join(out,'review.html'),`<!doctype html><meta charset="utf-8"><title>Sunpatch staged review</title><style>body{background:#183a31;color:#eee;font:16px system-ui}main{max-width:1200px;margin:auto}img{width:100%}section{margin:24px 0}h2{font-size:18px}</style><main><h1>Sunpatch staged visual review</h1><p>Actual rendered scene. Authored inspection cameras and forced event fixtures; not a normal-input playthrough.</p>${views.map(v=>`<section><h2>${v}</h2><img src="${v}.png"></section>`).join('')}</main>`);
console.log(JSON.stringify({views:views.length,out}));

