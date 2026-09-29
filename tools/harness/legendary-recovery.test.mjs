import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {importBundled} from './import-bundled.mjs';
const {LegendaryHarvest,buildExtractionApronGeometry}=await importBundled('src/systems/LegendaryHarvest.ts','legendary-recovery');
const {Terrain}=await importBundled('src/world/Terrain.ts','legendary-recovery-terrain');
const {KingVine}=await importBundled('src/boss/KingVine.ts','legendary-recovery-guardian');

function fixture(){
  const harvest=new LegendaryHarvest(),events=[];
  const body={at:{x:10,y:10,z:-56},speed:0,translation(){return this.at},
    linvel(){return{x:this.speed,y:0,z:0}},rotation(){return{x:0,y:0,z:0,w:1}}};
  const g={clock:{elapsed:0},player:{state:'active',position:new THREE.Vector3(0,12,-34)},
    input:{enabled:false},bus:{emit:(name,payload)=>events.push({name,payload})}};
  harvest.g=g;harvest.body=body;harvest.phase='recover';
  harvest.world={terrain:{height:()=>4}};
  harvest.mesh={position:new THREE.Vector3(),quaternion:new THREE.Quaternion()};
  harvest.syncTethers=()=>{};
  harvest.economy={add:()=>{},addDiscovery:()=>{}};
  harvest.extractionPad.set(10,4,-56);
  const tick=(time)=>{g.clock.elapsed=time;harvest.fixedStep(1/60)};
  return{harvest,body,g,events,tick};
}

test('extraction requires continuous settled contact rather than accumulated visits',()=>{
  const{harvest,body,tick}=fixture();
  tick(1);tick(2);
  body.at.x=40;tick(3);
  body.at.x=10;tick(6);
  assert.equal(harvest.phase,'recover','returning to the pad starts a fresh dwell');
  body.speed=3;tick(6.5);
  body.speed=0;tick(8);tick(9);
  assert.equal(harvest.phase,'recover','a fast roll also interrupts the dwell');
  tick(9.5);assert.equal(harvest.phase,'complete');
});

test('drop still settles outside the extraction area while payout uses its own dwell',()=>{
  const{harvest,body,tick}=fixture();
  harvest.phase='drop';harvest.dropStart=0;harvest.ropes={remove:()=>{}};
  body.at={x:8,y:35.6,z:-70};
  tick(1);tick(2.1);
  assert.equal(harvest.phase,'recover');
});

test('a settled mostly submerged melon fails fairly and regrows on game time',()=>{
  const{harvest,body,tick,events}=fixture();
  body.at={x:35,y:1.4,z:-14};harvest.world.terrain.height=()=>-4.2;
  tick(1);tick(4);
  assert.equal(harvest.phase,'recover','brief wet landings have time to escape');
  tick(5.1);
  assert.equal(harvest.phase,'failed','a sphere resting in water cannot reach center y<-6');
  assert.equal(harvest.lastPayout,0);
  assert.match(events.find(e=>e.name==='ui:toast'&&e.payload.kind==='bad').payload.sub,/regrow|try again/i);
  let resets=0;harvest.reset=()=>resets++;
  tick(29);assert.equal(resets,0);
  tick(30.2);assert.equal(resets,1,'retry follows game time, including a promoted host');
});

test('a client promoted from a failed snapshot retries once without reviving the guardian or paying',()=>{
  const host=fixture();
  host.body.at={x:35,y:1.4,z:-14};host.harvest.world.terrain.height=()=>-4.2;
  host.tick(1);host.tick(5.1);
  assert.equal(host.harvest.phase,'failed');

  const {harvest,body,g,events,tick}=fixture();
  let rewards=0,rebuilds=0,removedBodies=0;
  const guardian=new KingVine({onSubdued:()=>rewards++});
  guardian.restoreSubdued();harvest.boss=guardian;
  harvest.economy={add:()=>rewards++,addDiscovery:()=>rewards++};
  harvest.net={authoritative:false};
  Object.assign(body,{setTranslation(p){this.at={...p}},setRotation(){},
    isFixed:()=>true,setBodyType(){},wakeUp(){}});
  harvest.vines=[1,2,3,4].map(id=>({id}));harvest.vineIdx=[0,1,2,3];
  harvest.ropes={remove(){},attachedTo:()=>[]};
  g.physics={removeBody:()=>removedBodies++};
  // Scene and physics allocation stay outside this state-transition fixture;
  // applyNet, adoptAuthority, fixedStep and reset all execute their real code.
  harvest.build=()=>{rebuilds++;harvest.body=body};

  harvest.applyNet(host.harvest.netState());
  assert.equal(harvest.phase,'failed');
  assert.equal(harvest.cutVines,4);
  assert.deepEqual(body.translation(),host.body.translation());
  assert.deepEqual(events,[],'joining failure is silent history, not fresh cuts');
  tick(1000);
  assert.equal(rebuilds,0,'a client cannot regrow the host-owned melon');

  harvest.net.authoritative=true;harvest.adoptAuthority();
  const generation=harvest.generation;
  tick(1000);tick(1024.999);
  assert.equal(harvest.phase,'failed','promotion grants the full game-time retry window');
  assert.equal(rebuilds,0);
  tick(1025);
  assert.equal(harvest.phase,'prepare');
  assert.equal(harvest.generation,generation+1);
  assert.equal(harvest.cutVines,0);
  assert.equal(removedBodies,1);
  assert.equal(rebuilds,1);
  assert.equal(guardian.subdued,true);
  assert.equal(guardian.health,0);
  tick(1025.1);tick(1100);
  assert.equal(harvest.phase,'tether','the crew can cut again without another boss fight');
  assert.equal(rebuilds,1,'one failed attempt regrows only once');
  assert.equal(rewards,0);
  assert.equal(harvest.lastPayout,0);
  assert.equal(events.some(e=>e.name==='legendary:complete'),false);
});

test('a wet moving melon and a low dry landing do not count as a lost harvest',()=>{
  const{harvest,body,tick}=fixture();
  body.at={x:35,y:1.4,z:-14};body.speed=3;harvest.world.terrain.height=()=>-4.2;
  tick(1);tick(20);assert.equal(harvest.phase,'recover');
  body.speed=0;harvest.world.terrain.height=()=>1;
  tick(21);tick(30);assert.equal(harvest.phase,'recover');
});

test('a high ridge landing explains the marked walking recovery once',()=>{
  const{harvest,body,events}=fixture();body.at={x:8,y:35.6,z:-70};
  harvest.frameUpdate(.016);harvest.frameUpdate(.016);
  const hints=events.filter(e=>e.name==='ui:toast'&&/ridge/i.test(e.payload.text));
  assert.equal(hints.length,1);
  assert.match(hints[0].payload.sub,/behind the hill farm/i);
});

test('leaving vine cutting clears the last aimed tie prompt',()=>{
  const{harvest,events}=fixture();
  harvest.phase='detach';harvest.lookingAtVine={id:4};
  harvest.setPhase('drop');harvest.frameUpdate(.016);
  assert.equal(events.some(e=>e.name==='ui:prompt'&&/Cut the vine tie/.test(e.payload.text)),false);
});

test('receiving marks follow actual apron terrain instead of vanishing under ravine walls',()=>{
  const terrain=new Terrain();
  const geometry=buildExtractionApronGeometry((x,z)=>terrain.height(x,z));
  const p=geometry.attributes.position;
  assert.ok(p.count>50);
  for(let i=0;i<p.count;i++){
    const offset=p.getY(i)-terrain.height(p.getX(i),p.getZ(i));
    assert.ok(offset>.06&&offset<.25,`marker must remain visibly on ground: ${offset}`);
    assert.ok(Math.hypot(p.getX(i)-10.42774,p.getZ(i)+56.520406)<15,
      'receiving markings stay within the original extraction radius');
  }
});
