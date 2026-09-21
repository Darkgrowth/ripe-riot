import {withGame,ensureOut} from './driver.mjs';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
const out=ensureOut('shop-water-feedback');
await withGame(async g=>{
  await g.pause(true);
  await g.simulate(.1);
  const cdp=await g.ctx.newCDPSession(g.page);
  const data=await g.page.evaluate(()=>{
    const g=window.__GAME,r=g.renderer,w=g.get('world');
    window.__reviewDraw=r.render.bind(r);r.render=()=>{};
    const h=w.terrain.height(45,52),s=Math.sin(-.9),c=Math.cos(-.9);
    const point=(x,y,z)=>[45+x*c+z*s,h+y,52-x*s+z*c];
    const ground=[];
    for(let x=-2;x<=2;x+=.5)for(let z=3.4;z<=7.4;z+=.5){const p=point(x,0,z);ground.push(w.terrain.height(p[0],p[2])-h);}
    const rails=w.built.mesh.geometry.userData.authoredProps.filter(p=>p.details.kind==='rail').map(p=>{
      const m=w.built.mesh.matrix.clone().fromArray(p.matrix);
      const v=(x,y,z)=>g.player.position.clone().set(x,y,z);
      const hits=[-1,1].map(side=>{
        const origin=v(side*.6,0,0).applyMatrix4(m),dir=v(-side,0,0).transformDirection(m);
        const hit=g.physics.raycast(origin,dir,1);
        return {side,distance:hit?.distance,passed:!!hit&&Math.abs(hit.distance-.565)<.015};
      });
      return {id:p.id,hits};
    });
    return {rails,shopEye:point(-2.9,1.7,9),shopTarget:point(0,.25,5.4),groundMin:Math.min(...ground),groundMax:Math.max(...ground),shopBase:h};
  });
  async function shot(name,eye,target,shadows=true){
    await g.freeCam(eye,target);await g.page.waitForTimeout(100);
    await g.page.evaluate(on=>{window.__GAME.renderer.renderer.shadowMap.enabled=on;window.__reviewDraw();},shadows);
    writeFileSync(path.join(out,name+'.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  await shot('shop',data.shopEye,data.shopTarget);
  await shot('shop-no-shadow',data.shopEye,data.shopTarget,false);
  await shot('water',[66,3,74],[85,0,95]);
  // Freeze authored poses to inspect the actual gull mesh and inspection arc.
  const home=await g.page.evaluate(()=>window.__GAME.get('characters').home.toArray());
  await g.page.evaluate(()=>{const c=window.__GAME.get('characters');c.state.enabled=true;c.state.phase='perched';c.state.elapsed=2;c.frameUpdate(0);});
  await shot('gull-watch',[home[0]+2,home[1]+.6,home[2]+3],home);
  await g.page.evaluate(()=>{const c=window.__GAME.get('characters');c.state.phase='return';c.state.elapsed=2.1;c.state.duration=4.2;c.state.from=c.home.toArray();c.state.to=c.home.toArray();c.frameUpdate(0);});
  await shot('gull-lap',[home[0]+2,home[1]+.6,home[2]+3],[home[0]+1,home[1]+1.5,home[2]]);
  writeFileSync(path.join(out,'audit.json'),JSON.stringify({data,errors:g.consoleErrors},null,2));
  const checks=data.rails.flatMap(r=>r.hits);
  console.log(JSON.stringify({rails:data.rails.length,rayHits:checks.filter(h=>h.passed).length,total:checks.length,errors:g.consoleErrors}));
  if(!checks.length||checks.some(h=>!h.passed))throw new Error('Rail collider coverage failed');
  if(g.consoleErrors.some(e=>!e.includes('ReadPixels')))throw new Error('Render console errors');
},{width:960,height:540,headless:true,quiet:true,drawFrames:true,islandActivities:false});
