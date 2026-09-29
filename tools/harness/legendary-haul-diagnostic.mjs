// Diagnostic only: guardian and initial player pose are seeded; all melon
// motion thereafter comes from actual timed constraints and walking contact.
import {mkdirSync,writeFileSync} from 'node:fs';
import {withGame} from './driver.mjs';
const out='capture/sunpatch-expedition/haul-diagnostic';mkdirSync(out,{recursive:true});
const reports=await withGame(async g=>{
  await g.pause(true);await g.input({});
  const reports=[];
  for(const goal of [[20,-58],[16,-55],[10,-45]]){
    await g.call('legendary.reset');
    await g.page.evaluate(()=>window.__GAME.get('kingVine').restoreSubdued());
    await g.simulate(.2);
    for(let i=0;i<4;i++){await g.call('legendary.cut',1);await g.simulate(3);}
    await g.simulate(3);
    const landed=(await g.state()).legendary;
    const m=landed.pos,d=Math.hypot(goal[0]-m[0],goal[1]-m[2]);
    const start=[m[0]-(goal[0]-m[0])/d*6.1,m[2]-(goal[1]-m[2])/d*6.1];
    const y=await g.page.evaluate(([x,z])=>window.__GAME.get('world').terrain.height(x,z),start);
    await g.tp(start[0],y+.1,start[1]);await g.simulate(.4);
    const samples=[];
    for(let i=0;i<240;i++){
      const s=await g.state(),m=s.legendary.pos,p=s.player.pos;
      if(['complete','failed'].includes(s.legendary.phase))break;
      const d=Math.max(.01,Math.hypot(goal[0]-m[0],goal[1]-m[2]));
      const behind=[m[0]-(goal[0]-m[0])/d*4.2,m[2]-(goal[1]-m[2])/d*4.2];
      const target=Math.hypot(behind[0]-p[0],behind[1]-p[2])<.45?goal:behind;
      if(m[1]>30||s.legendary.speed<1.2){
        await g.look(Math.atan2(-(target[0]-p[0]),-(target[1]-p[2])),0);
        await g.input({moveZ:1,sprint:false});
      }
      await g.simulate(.15);await g.clearInput();
      if(i%10===0)samples.push({melon:(await g.state()).legendary,player:(await g.state()).player.pos});
    }
    await g.simulate(3);
    reports.push({goal,landed,start,samples,final:(await g.state()).legendary});
    console.log(JSON.stringify(reports.at(-1)));
  }
  return {reports,errors:g.consoleErrors};
},{width:320,height:180,headless:true,quiet:true,islandActivities:false,drawFrames:false});
writeFileSync(`${out}/report.json`,JSON.stringify(reports,null,2));
