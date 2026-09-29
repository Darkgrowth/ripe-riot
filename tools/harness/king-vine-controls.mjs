// Shared ordinary keyboard/mouse fighter; all supplied reads are observational.
import {setTimeout as sleep} from 'node:timers/promises';
export async function fightKingVineWithMallet(page,{read,aim,onEvent=()=>{},seconds=75}){
  const until=Date.now()+seconds*1000;
  let dodged=false,lastPhase='',lastHealth=null;
  const move=async(keys,ms)=>{
    await Promise.all(keys.map(key=>page.keyboard.down(key)));
    await sleep(ms);
    await Promise.all(keys.map(key=>page.keyboard.up(key)));
  };
  while(Date.now()<until){
    const s=await read(),b=s.boss;
    if(b.health!==lastHealth){lastHealth=b.health;onEvent('king-vine-health',{bossHealth:b.health,playerHealth:s.health,position:s.pos})}
    if(b.phase==='subdued')return{subdued:true,state:s};
    if(s.playerState==='downed')return{subdued:false,downed:true,state:s};
    if(s.playerState!=='active'){await sleep(100);continue}
    if(b.phase==='telegraph'&&lastPhase!=='telegraph')dodged=false;
    if(b.phase==='recover')dodged=false;
    lastPhase=b.phase;
    const core=[b.center[0],b.center[1]+1.7,b.center[2]];
    // Telegraph direction is fixed. Move out of that lane and remain there
    // through the attack; chasing the old stand point would re-enter it.
    if(['telegraph','sweep','seed'].includes(b.phase)){
      if(!dodged){
        await aim(core);
        // Sprint only applies with forward input; the diagonal runs around
        // the stem, while a short pure sidestep is enough for the seed lane.
        await move(b.attack==='sweep'?['a','w','Shift']:['a'],b.attack==='sweep'?550:350);
        dodged=true;
        const after=await read();
        onEvent('king-vine-dodge',{attack:b.attack,before:s.pos,after:after.pos,health:after.health});
      }else await sleep(80);
      continue;
    }
    if(b.phase!=='recover'){await sleep(80);continue}
    const distance=Math.hypot(s.pos[0]-b.center[0],s.pos[2]-b.center[2]);
    await aim(core);
    if(distance>3.5){await move(['w','Shift'],Math.min(180,Math.max(70,(distance-3.1)/8.4*1000)));continue}
    if(distance<2.6){await move(['s'],120);continue}
    const contact=await read();
    if(contact.boss.phase!=='recover')continue;
    await page.mouse.down();await sleep(80);await page.mouse.up();await sleep(330);
  }
  return{subdued:false,timedOut:true,state:await read()};
}
