// Numerical diagnostic: timed cuts use real constraints; only guardian state
// and the player pose used to isolate pushing are seeded. Not expedition proof.
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {withGame} from './driver.mjs';
const out='capture/sunpatch-expedition/slow-drop';mkdirSync(out,{recursive:true});
const report=await withGame(async g=>{
  await g.pause(true);await g.input({});
  await g.page.evaluate(()=>window.__GAME.get('kingVine').restoreSubdued());
  await g.simulate(.2);
  const cuts=[];
  for(let i=0;i<4;i++){
    await g.call('legendary.cut',1);await g.simulate(3);
    cuts.push((await g.state()).legendary);
  }
  await g.simulate(3);
  const landed=(await g.state()).legendary;
  const route=await g.page.evaluate(()=>{
    const g=window.__GAME,t=g.get('world').terrain,leg=g.get('legendary');
    const melon=leg.position.clone(),pad=leg.extractionPad,d=Math.hypot(melon.x-pad.x,melon.z-pad.z);
    const target=[melon.x+(melon.x-pad.x)/d*6.1,melon.z+(melon.z-pad.z)/d*6.1];
    const minX=-90,minZ=-105,nx=171,nz=126,heights=[],walk=[];
    for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
      const xx=minX+x,zz=minZ+z,h=t.height(xx,zz);heights.push(h);
      walk.push(h>1&&t.normal(xx,zz).y>=Math.cos(48*Math.PI/180));
    }
    const key=(x,z)=>(Math.round(z)-minZ)*nx+Math.round(x)-minX;
    const from=key(-4.5,-34),goal=key(...target),q=[from],seen=new Uint8Array(nx*nz);seen[from]=1;
    for(let head=0;head<q.length&&!seen[goal];head++){
      const a=q[head],x=a%nx,z=Math.floor(a/nx);
      for(const[dx,dz]of[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
        const xx=x+dx,zz=z+dz;if(xx<0||xx>=nx||zz<0||zz>=nz)continue;
        const b=zz*nx+xx;if(seen[b]||!walk[b]||Math.abs(heights[b]-heights[a])>Math.hypot(dx,dz))continue;
        seen[b]=1;q.push(b);
      }
    }
    return{reachable:!!seen[goal],target:[target[0],t.height(...target)+.1,target[1]],visited:q.length};
  });
  const pad=await g.page.evaluate(()=>window.__GAME.get('legendary').extractionPad.toArray());
  await g.tp(...route.target);await g.simulate(.4);
  const pushes=[];
  for(let i=0;i<400;i++){
    const s=await g.state(),m=s.legendary.pos,p=s.player.pos;
    if(s.legendary.phase==='complete')break;
    const d=Math.max(.01,Math.hypot(pad[0]-m[0],pad[2]-m[2]));
    const behind=[m[0]-(pad[0]-m[0])/d*3.15,m[2]-(pad[2]-m[2])/d*3.15];
    const target=Math.hypot(behind[0]-p[0],behind[1]-p[2])<.35?[pad[0],pad[2]]:behind;
    if(m[1]>30||s.legendary.speed<1.2){
      await g.look(Math.atan2(-(target[0]-p[0]),-(target[1]-p[2])),0);
      await g.input({moveZ:1,sprint:false});
    }
    await g.simulate(.15);await g.clearInput();
    if(i%10===0)pushes.push({legendary:(await g.state()).legendary,player:(await g.state()).player.pos});
    if(p[1]<20&&m[1]>30)break;
  }
  await g.clearInput();await g.simulate(3);
  return{evidence:'numerical timed-cut and physical push diagnostic, seeded guardian/player pose',
    cuts,landed,route,pushes,final:(await g.state()).legendary,errors:g.consoleErrors};
},{width:320,height:180,headless:true,quiet:true,islandActivities:false,drawFrames:false});
writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
assert.equal(report.route.reachable,true,'a 3-second-per-vine drop needs a stable reachable recovery approach');
assert.equal(report.final.phase,'complete','walking into the physical melon should recover it to the real pad');
