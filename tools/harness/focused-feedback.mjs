// Four one-frame inspection views in an isolated software browser.
import {withGame,ensureOut} from './driver.mjs';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
const out=ensureOut('focused-feedback');
await withGame(async g=>{
  await g.pause(true);
  await g.call('director.reset',false);await g.call('characters.reset',false);
  const cdp=await g.ctx.newCDPSession(g.page);
  await g.page.evaluate(()=>{const r=window.__GAME.renderer;window.__focusedDraw=r.render.bind(r);r.render=()=>{};});
  const vines=await g.page.evaluate(()=>[...window.__GAME.get('fruit').plants.all()]
    .filter(p=>p.type==='vinebombVine').map(p=>({id:p.id,pos:p.position.toArray(),fruit:p.nodes[0].world.toArray()})));
  async function shot(name,eye,target){
    await g.freeCam(eye,target);await g.page.waitForTimeout(120);await g.page.evaluate(()=>window.__focusedDraw());
    writeFileSync(path.join(out,`${name}.png`),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  for(const [index,v] of vines.slice(0,3).entries()){
    const [x,y,z]=v.pos;
    await shot(`vine-${index}`,[x+5,y-2.4,z+5],[x,y-1.4,z]);
  }
  const v=vines[0], [x,y,z]=v.fruit;
  await shot('fruit-skin',[x+1.1,y+.1,z+1.5],[x,y,z]);
  await shot('shop-floor',[41,4.1,60],[42,2.65,55]);
  const audit=await g.page.evaluate(()=>{
    const g=window.__GAME,r=g.renderer,s=g.renderer.scene.getObjectByName('Rooted vine supports');
    const supports=s.userData.supports.map(p=>({...p,burial:g.get('world').terrain.height(p.root[0],p.root[2])-p.root[1]}));
    const focus=g.player.position.clone(),forward=g.player.lookDir(focus.clone());
    r.updateSunFollow(focus,forward);
    const right=r.shadowRight.clone(),up=r.shadowUp.clone(),first=r.sun.target.position.clone();
    const texel=2*r.shadowRadius/r.sun.shadow.mapSize.x;
    const grid=[first.dot(right)/texel,first.dot(up)/texel];
    return {supports,triangles:s.geometry.attributes.position.count/3,shadowGrid:grid,
      gridAligned:grid.every(x=>Math.abs(x-Math.round(x))<1e-5),vines:window.__GAME.get('fruit').plants.count};
  });
  writeFileSync(path.join(out,'visual-audit.json'),JSON.stringify({...audit,errors:g.consoleErrors},null,2));
  if(!audit.gridAligned||audit.supports.some(p=>Math.abs(p.burial-.12)>1e-4))throw new Error('Support/shadow invariant failed');
  console.log(JSON.stringify({views:5,supports:audit.supports.length,gridAligned:audit.gridAligned,errors:g.consoleErrors.length}));
},{width:960,height:540,headless:true,quiet:true,drawFrames:true,islandActivities:false});
