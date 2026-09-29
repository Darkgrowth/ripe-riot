// Diagnostic authoring fixture: boss location and player pose are seeded.
// Traversal and the complete starter-mallet fight then use real keyboard/mouse.
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import {fightKingVineWithMallet} from './king-vine-controls.mjs';
const url=process.env.RIPE_URL;
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(url??''))throw new Error('Use an isolated RIPE_URL');
const out='capture/sunpatch-expedition/king-vine-worksite';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--mute-audio','--use-gl=angle','--use-angle=d3d11']});
const page=await browser.newPage({viewport:{width:1720,height:720}});
const report={evidence:'diagnostic fixture: seeded boss placement/player pose; real traversal and mallet inputs',events:[],errors:[]};
page.on('pageerror',e=>report.errors.push(e.message));
let mx=860,my=360;
const read=()=>page.evaluate(()=>{const g=window.__GAME,p=g.player;return{pos:p.position.toArray(),eye:p.eyePosition.toArray(),yaw:p.yaw,pitch:p.pitch,sensitivity:g.input.sensitivity,health:g.get('vitals').health,state:p.state,boss:g.get('kingVine').snapshot()}});
async function aim(point){for(let n=0;n<20;n++){const s=await read(),dx=point[0]-s.eye[0],dz=point[2]-s.eye[2],yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(point[1]-s.eye[1],Math.hypot(dx,dz)),dy=Math.atan2(Math.sin(yaw-s.yaw),Math.cos(yaw-s.yaw)),dp=pitch-s.pitch;if(Math.abs(dy)<.025&&Math.abs(dp)<.025)return;mx+=Math.max(-160,Math.min(160,-dy/(s.sensitivity||.0022)));my+=Math.max(-120,Math.min(120,-dp/(s.sensitivity||.0022)));await page.mouse.move(mx,my);await sleep(50)}}
async function walk(point,radius=.55){for(let n=0;n<80;n++){const s=await read(),d=Math.hypot(point[0]-s.pos[0],point[2]-s.pos[2]);if(d<radius)return true;await aim([point[0],s.eye[1],point[2]]);await page.keyboard.down('w');await sleep(Math.min(220,Math.max(60,(d-radius)*140)));await page.keyboard.up('w')}return false}
try{
  await page.goto(`${url}/?voxelPilot=1`);await page.waitForFunction(()=>window.__RIPE_READY);
  await page.locator('[data-expedition-action="continue"]').click();await sleep(600);
  await page.evaluate(()=>{const g=window.__GAME,b=g.get('kingVine'),t=g.get('world').terrain;b.center=[-20,t.height(-20,-35),-35];window.__RIPE.tp(-26,t.height(-26,-35)+.1,-35)});
  await page.mouse.click(860,360);await page.mouse.move(++mx,my);await sleep(250);
  const clearance=await page.evaluate(()=>{const g=window.__GAME,t=g.get('world').terrain,b=g.get('kingVine'),V=g.player.position.constructor,results=[];for(const [x,z]of[[-23.5,-35],[-20,-31.5],[-16.5,-35],[-20,-38.5]]){const y=t.height(x,z),eye=new V(x,y+1.6,z),dir=new V(b.center[0],b.center[1]+1.7,b.center[2]).sub(eye),distance=dir.length(),hit=g.physics.raycast(eye,dir.normalize(),distance,undefined,g.player.body);results.push({point:[x,y,z],slope:Math.acos(t.normal(x,z).y)*180/Math.PI,distance,clear:!hit||hit.distance>distance-.2})}return results});
  report.clearance=clearance;console.log(JSON.stringify({clearance}));
  if(!await walk([-23.1,0,-35]))throw new Error('Capsule cannot approach western worksite');
  report.approach=await read();await page.screenshot({path:`${out}/01-approach.png`});
  await fightKingVineWithMallet(page,{read:async()=>{const s=await read();return{...s,playerState:s.state}},aim,
    onEvent:(kind,data)=>{report.events.push({kind,...data});console.log(JSON.stringify({kind,...data}))}});
  report.final=await read();await page.keyboard.up('a');await page.keyboard.up('Shift');
  await page.screenshot({path:`${out}/02-mallet-result.png`});
  if(report.final.boss.health!==0)throw new Error('Starter mallet did not subdue grounded boss');
}catch(e){report.failure=String(e);console.log(report.failure)}finally{
  await browser.close();writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
}
if(report.failure||report.errors.length)process.exitCode=1;
