// One complete fresh-save solo acceptance: earn and buy a Tree Shaker,
// walk to the existing co-op vine, miss its launch, recover and sell it.
// No gameplay debug mutation is used, including during preliminary harvest.
import { startServer, openGame, ensureOut, sleep } from './driver.mjs';
import { writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

const video = process.argv.includes('--video');
const out = ensureOut('vinebomb-solo');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const checks = [], events = [];
const check = (ok, label, detail = '') => {
  checks.push({ ok: !!ok, label, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) throw new Error(`${label}: ${detail}`);
};
const note = (kind, data = {}) => {
  events.push({ wall: +(performance.now() / 1000).toFixed(2), kind, ...data });
  console.log(kind, JSON.stringify(data));
};
const dist = (a,b) => Math.hypot(a[0]-b[0], a[2]-b[1]);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
let mouseAt = [201, 112], g, server;

async function observed() {
  return g.page.evaluate(() => {
    const game = window.__GAME, p = game.player, i = game.get('interaction');
    return { pos: p.position.toArray(), yaw: p.yaw, pitch: p.pitch,
      eye: p.eyeHeight, state: p.state, locked: game.input.pointerLocked,
      synthetic: game.input.synthetic !== null, sensitivity: game.input.sensitivity,
      invertY: game.input.invertY, carrying: i.carried?.fruit.id ?? -1,
      basket: i.basket.items.map(f=>f.id), targetKind: i.targetKind,
      money: game.get('economy').money, shop: game.get('shop').open,
      owned: [...game.get('tools').owned] };
  });
}
async function press(key, ms=100) {
  await g.page.keyboard.down(key); await sleep(ms); await g.page.keyboard.up(key); await sleep(80);
}
async function lock() {
  if (await g.page.evaluate(() => !!document.pointerLockElement)) return;
  await g.page.locator('#view').focus();
  await g.page.mouse.click(201,112);
  check(await g.page.evaluate(() => !!document.pointerLockElement), 'trusted click obtains pointer lock');
  await g.page.mouse.move(201,112); mouseAt=[201,112]; await sleep(90);
}
async function aim(target, pitch=null) {
  await lock();
  for (let i=0;i<18;i++) {
    const s=await observed();
    if(s.synthetic)throw new Error('synthetic input unexpectedly enabled');
    const yaw=Math.atan2(-(target[0]-s.pos[0]),-(target[2]-s.pos[2]));
    const distance=Math.hypot(target[0]-s.pos[0],target[2]-s.pos[2]);
    const wanted=pitch ?? Math.atan2(target[1]-s.pos[1]-s.eye, Math.max(.05,distance));
    const dyaw=wrap(yaw-s.yaw), dpitch=wanted-s.pitch;
    if (Math.abs(dyaw)<.035 && Math.abs(dpitch)<.045) return;
    const dx=Math.max(-150,Math.min(150,-dyaw/(s.sensitivity||.0022)));
    const dy=Math.max(-100,Math.min(100,-dpitch/((s.sensitivity||.0022)*(s.invertY?-1:1))));
    mouseAt=[mouseAt[0]+dx,mouseAt[1]+dy];
    await g.page.mouse.move(...mouseAt); await sleep(65);
  }
  throw new Error(`trusted mouse aim failed at ${target}`);
}
async function walkTo(target,{radius=1.35,timeout=22,from=null}={}) {
  const deadline=Date.now()+timeout*1000;
  let previous=null,stuck=0;
  const reached=p=> {
    if (dist(p,target)<radius) return true;
    if (!from) return false;
    const dx=target[0]-from[0],dz=target[1]-from[1],len=Math.hypot(dx,dz);
    const px=p[0]-from[0],pz=p[2]-from[1];
    return len>.1 && (px*dx+pz*dz)/len>len+.2 && Math.abs(px*dz-pz*dx)/len<1.8;
  };
  while(Date.now()<deadline) {
    const s=await observed(); if(reached(s.pos)) return;
    if(s.state!=='active') { await sleep(450); continue; }
    await aim([target[0],s.pos[1]+s.eye,target[1]],-.05);
    await g.page.keyboard.down('w'); await g.page.keyboard.down('Shift');
    await sleep(Math.max(120,Math.min(320,(dist(s.pos,target)-radius)*95)));
    await g.page.keyboard.up('Shift'); await g.page.keyboard.up('w');
    const now=(await observed()).pos; if(reached(now)) return;
    if(previous && Math.hypot(now[0]-previous[0],now[2]-previous[2])<.17) stuck++; else stuck=0;
    previous=now;
    if(stuck>=2) {
      await press('Space');
      await g.page.keyboard.down(stuck%2?'a':'d'); await sleep(250);
      await g.page.keyboard.up(stuck%2?'a':'d');
    }
  }
  throw new Error(`walk missed ${target} from ${(await observed()).pos}`);
}
async function terrainRoute(from,to) {
  const xmin=-20,xmax=80,zmin=-64,zmax=74,stride=2;
  const nx=(xmax-xmin)/stride+1,nz=(zmax-zmin)/stride+1;
  const heights=await g.page.evaluate(({xmin,xmax,zmin,zmax,stride})=>{
    const t=window.__GAME.get('world').terrain, rows=[];
    for(let z=zmin;z<=zmax;z+=stride){const row=[];for(let x=xmin;x<=xmax;x+=stride)row.push(t.height(x,z));rows.push(row);}
    return rows;
  },{xmin,xmax,zmin,zmax,stride});
  const ix=x=>Math.max(0,Math.min(nx-1,Math.round((x-xmin)/stride)));
  const iz=z=>Math.max(0,Math.min(nz-1,Math.round((z-zmin)/stride)));
  const key=(x,z)=>z*nx+x,start=[ix(from[0]),iz(from[1])],goal=[ix(to[0]),iz(to[1])];
  const q=[start],seen=new Set([key(...start)]),back=new Map();
  const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
  let found=false;
  for(let head=0;head<q.length;head++){
    const [x,z]=q[head]; if(x===goal[0]&&z===goal[1]){found=true;break;}
    for(const [dx,dz] of dirs){const xx=x+dx,zz=z+dz;
      if(xx<0||xx>=nx||zz<0||zz>=nz)continue;
      const k=key(xx,zz),y=heights[z][x],yy=heights[zz][xx];
      if(seen.has(k)||yy<.4||Math.abs(yy-y)>Math.hypot(dx,dz)*stride*.65)continue;
      seen.add(k);back.set(k,key(x,z));q.push([xx,zz]);
    }
  }
  if(!found)throw new Error(`no moderate-slope terrain route ${from} to ${to}`);
  const points=[];let k=key(...goal);
  while(k!==key(...start)){points.push([xmin+(k%nx)*stride,zmin+Math.floor(k/nx)*stride]);k=back.get(k);}
  points.push([xmin+start[0]*stride,zmin+start[1]*stride]);points.reverse();
  return points.filter((p,i)=>i===0||i===points.length-1||p[1]<=-50||i%3===0);
}
async function travel(to,label,{radius=1.5}={}) {
  for(let attempt=0;attempt<5;attempt++){
    const p=(await observed()).pos;
    const route=await terrainRoute([p[0],p[2]],to);
    note('route',{label,attempt,count:route.length,from:p,to});
    try{
      for(let i=0;i<route.length;i++){
        if(dist((await observed()).pos,to)<radius)break;
        await walkTo(route[i],{radius:1.25,timeout:22,from:i?route[i-1]:[p[0],p[2]]});
      }
      await walkTo(to,{radius,timeout:22});
      note('arrived',{label,pos:(await observed()).pos});return;
    }catch(e){note('route-replan',{label,attempt,error:String(e),pos:(await observed()).pos});
      if(attempt===4)throw e;}
  }
}
async function fruitInfo(id){return g.call('fruit.info',id);}
async function harvest(id){
  const f=await fruitInfo(id);check(f?.state==='attached','preliminary fruit exists',JSON.stringify(f));
  await travel([f.pos[0],f.pos[2]],`approach fruit ${id}`,{radius:1.8});
  await aim(f.pos);await press('e');
  const picked=(await observed()).carrying,got=await fruitInfo(picked);
  check(got?.state==='carried'&&got.species===f.species,
    `ordinary E harvests ${f.species}`,JSON.stringify({aimed:id,got,player:await observed()}));
  note('picked',{aimed:id,actual:picked,value:got.value,pos:(await observed()).pos});
  return picked;
}
async function stow(id){
  await sleep(1800); // natural sticky-hands interval on a picked Gluefruit
  await press('4');await sleep(250);
  await g.page.mouse.click(201,112);
  for(let i=0;i<30;i++){if((await observed()).basket.includes(id))break;await sleep(200);}
  check((await observed()).basket.includes(id),`ordinary basket stows ${id}`);
  await press('1');
}
async function recover(id){
  await press('1'); await sleep(1200);
  for(let i=0;i<8;i++){
    const f=await fruitInfo(id);
    check(f?.state==='free','missed vinebomb remains free',JSON.stringify(f));
    try{await travel([f.pos[0],f.pos[2]],'pursue missed vinebomb',{radius:2.2});}
    catch(e){note('recovery-repath',{i,error:String(e)});continue;}
    const now=await fruitInfo(id);await aim(now.pos);
    note('recovery-sight',{i,player:(await observed()).pos,fruit:now.pos,target:(await observed()).targetKind});
    if((await observed()).targetKind!=='fruit'){await sleep(250);continue;}
    await press('e');if((await observed()).carrying===id)return;
  }
  throw new Error(`could not manually recover missed vinebomb ${id}`);
}
async function descendFromRim(){
  // The lower ravine is a one-way drop from the north rim. A normal jump
  // lands on its dry eastern shelf; knockdown recovery is automatic gameplay.
  await travel([20,-48],'walk from shop to ravine rim',{radius:1.2});
  const before=await observed();
  await aim([28,before.pos[1]+before.eye,-56],-.05);
  await g.page.keyboard.down('w');await g.page.keyboard.down('Shift');
  await g.page.keyboard.down('Space');await sleep(1500);
  await g.page.keyboard.up('Space');await g.page.keyboard.up('Shift');
  await g.page.keyboard.up('w');
  await sleep(4000);
  const landed=await observed(),rag=(await g.state()).ragdoll;
  check(landed.state==='active'&&landed.pos[1]<10&&landed.pos[2]<-53,
    'normal jump descends to dry lower ravine and recovers',JSON.stringify({before,landed,rag}));
  note('rim-descent',{from:before.pos,to:landed.pos,knockdowns:rag.knockdowns});
  await travel([24,-56],'follow lower shelf to Vinebomb release side',{radius:1.8});
}

try{
  server=await startServer();
  g=await openGame({width:video?640:400,height:video?360:225,
    quiet:true,islandActivities:true,drawFrames:video,recordVideoDir:video?out:null});
  const start=await observed();
  check(start.money===0&&!start.owned.includes('shaker')&&!start.synthetic,
    'fresh ordinary solo start, no Tree Shaker or debug equipment',JSON.stringify(start));
  const world=await g.call('world.info');
  await lock();
  await walkTo([58,62],{radius:3,timeout:30});
  await travel([world.sellPad[0],world.sellPad[2]],'spawn deck to dock sale pad',{radius:3.4});
  // Four ordinary attached Gluefruit on the dry east coast total >$380.
  // Distinct aimed nodes may overlap in the reticle; use the fruit actually
  // carried by the player and keep collecting until the basket funds the buy.
  for(const id of [542,543,544,545]){
    const picked=await harvest(id);await stow(picked);
  }
  // The direct east-coast grid shortcut clips a palm collider around (72, 0).
  // Walk inland around it before heading back to the shed.
  await travel([61,-10],'leave east-coast gum tree inland',{radius:1.8});
  await walkTo([61,8],{radius:2,timeout:28});
  note('arrived',{label:'walk between two palm colliders',pos:(await observed()).pos});
  // Return to the dock approach before heading to the counter; the direct
  // east-side diagonal clips Merv's solid shed at (45,52).
  await travel([59,63],'return via open dock approach',{radius:3});
  await travel([world.sellPad[0],world.sellPad[2]],'carry earned fruit to dock',{radius:3.4});
  const before=await g.state();check(before.interaction.nearSellPad,'preliminary fruit reaches sale pad');
  await press('e');await sleep(350);
  const earned=await g.state();
  check(earned.economy.money>=380&&earned.economy.sold>=3,
    'ordinary preliminary sale funds Tree Shaker',JSON.stringify(earned.economy));
  note('earned',{money:earned.economy.money,sold:earned.economy.sold});
  if(!(await observed()).shop)await press('e');
  check((await observed()).shop,'shop opened with normal E at counter');
  await g.page.locator('.shop-item[data-id="shaker"]').click();
  check((await observed()).owned.includes('shaker'),'Tree Shaker bought through ordinary shop click');
  note('bought-shaker',{money:(await observed()).money});
  await press('Escape');await lock();
  await descendFromRim();
  const site=await g.call('fruit.nearest',22,4,-56,'vinebomb','attached');
  check(site?.species==='vinebomb','existing Vinebomb is attached at site',JSON.stringify(site));
  await press('2');await aim([22,4.13,-56]);
  await g.page.mouse.click(201,112,{button:'right'});
  let free=null;for(let i=0;i<30;i++){const f=await fruitInfo(site.id);if(f?.state==='free'){free=f;break;}await sleep(100);}
  check(free,'normal Tree Shaker right-click releases Vinebomb',JSON.stringify(await fruitInfo(site.id)));
  note('released',{id:site.id,pos:free.pos,player:(await observed()).pos});
  await sleep(3000);
  const landed=await fruitInfo(site.id);
  const ground=await g.terrainHeight(landed.pos[0],landed.pos[2]);
  check(landed.state==='free'&&ground>.4&&landed.pos[1]>=ground-.5,
    'deliberately missed fruit rests on dry reachable shelf',JSON.stringify({landed,ground}));
  note('missed',{id:site.id,pos:landed.pos,ground});
  await recover(site.id);
  note('recovered',{id:site.id,pos:(await observed()).pos});
  await stow(site.id);
  check((await fruitInfo(site.id))?.state==='stowed',
    'ordinary basket secures recovered Vinebomb for walk home');
  await travel([world.sellPad[0],world.sellPad[2]],'walk recovered Vinebomb to sale pad',{radius:3.4});
  const pre=await g.state();check(pre.interaction.nearSellPad&&pre.interaction.basketIds.includes(site.id),
    'recovered fruit brought to sale pad by normal movement',
    JSON.stringify({interaction:pre.interaction,fruit:await fruitInfo(site.id)}));
  await press('e');await sleep(350);
  const sold=await g.state();
  check(sold.economy.sold===pre.economy.sold+1&&sold.economy.money>pre.economy.money,
    'solo Vinebomb sale pays exactly once',JSON.stringify({before:pre.economy,after:sold.economy}));
  check(await fruitInfo(site.id)===null,'sold Vinebomb removed from world');
  await press('e');await sleep(300);
  check((await g.state()).economy.money===sold.economy.money,'repeat E cannot pay twice');
  if((await observed()).shop)await press('Escape');
  note('complete',{id:site.id,earned:earned.economy.money,payout:sold.economy.money-pre.economy.money,
    money:sold.economy.money,sold:sold.economy.sold});
}catch(e){note('error',{message:String(e.stack??e)});process.exitCode=1;}
finally{
  let videoFile=null;
  if(g){
    try{if(video){const v=g.page.video();await g.ctx.close();
      if(v){videoFile=path.join(out,`solo-${runId}.webm`);renameSync(await v.path(),videoFile);}}}
    catch(e){note('video-error',{message:String(e)});process.exitCode=1;}
    await g.browser.close().catch(()=>{});
  }
  if(server?.proc)server.proc.kill();
  const report={mode:'solo fresh save',input:'trusted keyboard/mouse only, no gameplay debug mutation',
    checks,events,errors:g?.consoleErrors??[],videoFile};
  writeFileSync(path.join(out,`report-${runId}.json`),JSON.stringify(report,null,2)+'\n');
}
