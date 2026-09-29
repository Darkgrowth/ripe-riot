// Authoring fixture: rendered reach/visibility inspection, not expedition proof.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withGame, ROOT } from './driver.mjs';
const out = path.join(ROOT, 'capture/sunpatch-expedition/cut-ties');
mkdirSync(out,{recursive:true});
const report = { evidence:'authoring fixture; pose and boss completion seeded',frames:[],errors:[] };
await withGame(async g=>{
  const face=async(x,y,z)=>{
    const eye=await g.page.evaluate(()=>window.__GAME.player.eyePosition.toArray());
    await g.look(Math.atan2(-(x-eye[0]),-(z-eye[2])),Math.atan2(y-eye[1],Math.hypot(x-eye[0],z-eye[2])));
  };
  await g.pause(true);await g.input({});
  await g.page.evaluate(()=>{
    const game=window.__GAME,boss=game.get('kingVine');boss.phase='subdued';boss.health=0;
    document.querySelector('.entry-hint')?.remove();
  });
  const points=await g.page.evaluate(()=>window.__GAME.get('legendary').cutPoints());
  await g.tp(-7.4,(await g.terrainHeight(-7.4,-29.8))+.1,-29.8);
  await face(-7.4,points[1].position[1],-36);await g.advance(2);
  await g.page.screenshot({path:path.join(out,'01-worksite-overview.png')});
  for(const p of points){
    await g.tp(p.position[0],(await g.terrainHeight(p.position[0],p.position[2]+2.05))+.1,p.position[2]+2.05);
    await g.advance(30);await face(...p.position);await g.advance(2);
    const contact=await g.page.evaluate(vine=>{
      const game=window.__GAME,p=game.player;
      const point=game.get('legendary').cutPoints()[vine].position;
      const target=p.position.clone().set(...point),eye=p.eyePosition.clone(),delta=target.sub(eye);
      const distance=delta.length(),hit=game.physics.raycast(eye,delta.normalize(),distance,undefined,p.body);
      return {valid:game.get('legendary').validateCutAim(vine,eye,p.lookDir(p.position.clone())),
        eye:eye.toArray(),distance,hit:hit?{distance:hit.distance,point:hit.point.toArray(),kind:hit.owner?.kind}:null};
    },p.vine);
    report.frames.push({vine:p.vine,contact,point:p.position});
    await g.page.screenshot({path:path.join(out,`02-tie-${p.vine+1}-reachable.png`)});
    console.log(JSON.stringify({vine:p.vine,contact}));
    assert.equal(contact.valid,true,`real terrain/colliders allow aimed tie ${p.vine+1}`);
  }
  report.errors=g.consoleErrors;
},{width:3440,height:1440,headless:true,quiet:true,islandActivities:false});
writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report));
