// CPU graph/lifecycle regression. This verifies routing and automation, not
// the browser's codec or the subjective sound; decoded-file checks are Python.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..',import.meta.url));
const compiled = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
export { AudioManager, SOUND_NAMES } from './src/audio/AudioManager';
export { EventBus } from './src/core/Events';
` }, bundle:true,platform:'node',format:'cjs',packages:'external',write:false });
const mod={exports:{}};
new Function('require','module','exports',compiled.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const {AudioManager,SOUND_NAMES,EventBus}=mod.exports;
const THREE=await import('three');
class Param {
  value=1; events=[];
  setValueAtTime(value,time){this.value=value;this.events.push(['set',value,time]);}
  setTargetAtTime(value,time){this.value=value;this.events.push(['target',value,time]);}
  linearRampToValueAtTime(value,time){this.value=value;this.events.push(['linear',value,time]);}
  exponentialRampToValueAtTime(value,time){this.value=value;this.events.push(['exponential',value,time]);}
  cancelScheduledValues(time){this.events=this.events.filter(e=>e[2]<time);}
}
class Node {
  connections=new Set(); gain=new Param();frequency=new Param();Q=new Param();pan=new Param();
  threshold=new Param();knee=new Param();ratio=new Param();attack=new Param();release=new Param();
  started=false;stopped=false;stopAt=Infinity;
  constructor(ctx){this.ctx=ctx;ctx.nodes.push(this);}
  connect(node){this.connections.add(node);return node;}
  disconnect(){this.connections.clear();}
  start(time=0,offset=0){this.started=true;this.startAt=time;this.offset=offset;}
  stop(time=this.ctx.currentTime){this.stopAt=time;if(time<=this.ctx.currentTime)this.end();}
  end(){if(this.stopped)return;this.stopped=true;this.onended?.();}
}
class Context {
  nodes=[];currentTime=0;sampleRate=32000;state='suspended';destination={};
  createGain(){return new Node(this);}createDynamicsCompressor(){return new Node(this);}
  createStereoPanner(){return new Node(this);}createBufferSource(){return new Node(this);}
  createBiquadFilter(){return new Node(this);}createOscillator(){return new Node(this);}
  createBuffer(channels,length,sampleRate){return {duration:length/sampleRate,sampleRate,getChannelData:()=>new Float32Array(length)};}
  async decodeAudioData(){return {duration:120};}
  async resume(){this.state='running';}async suspend(){this.state='suspended';}async close(){this.state='closed';}
  advance(seconds){this.currentTime+=seconds;for(const node of this.nodes)if(node.stopAt<=this.currentTime)node.end();
    for(const [id,timer] of [...timers])if(timer.at<=this.currentTime){timers.delete(id);timer.fn();}}
}
const handlers=new Map(),storage=new Map(),timers=new Map();let timerId=0,live;
const add=(name,fn)=>{let set=handlers.get(name);if(!set)handlers.set(name,set=new Set());set.add(fn);};
const remove=(name,fn)=>handlers.get(name)?.delete(fn);
globalThis.window={AudioContext:Context,addEventListener:add,removeEventListener:remove,
  setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,at:live.ctx.currentTime+ms/1000});return id;},clearTimeout:id=>timers.delete(id)};
globalThis.document={hidden:false,addEventListener:add,removeEventListener:remove};
globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});
const bus=new EventBus(),probes=new Map();
let legendary=null,world=null,fruit=null;
const game={bus,renderer:{camera:new THREE.PerspectiveCamera()},player:{speed:0},
  has:name=>({legendary,world,fruit})[name]!=null,get:name=>({legendary,world,fruit})[name],
  debug:{addProbe:(name,fn)=>probes.set(name,fn),addAction(){}}};
live=new AudioManager();live.init(game);
assert.equal(live.ctx,null,'no context before a gesture');
live.play('pick');assert.equal(live.ctx,null,'game events cannot silently unlock audio');
await live.unlock();await new Promise(resolve=>setTimeout(resolve,0));
const ctx=live.ctx,probe=()=>probes.get('audio')();
assert.equal(probe().music.sources,3);assert.equal(probe().ambienceSources,4);
const musicSources=ctx.nodes.filter(n=>n.loop&&n.buffer?.duration===120);
assert.equal(new Set(musicSources.map(n=>n.startAt)).size,1,'stems share one epoch');
assert.ok(musicSources.every(n=>n.loopEnd===120));
live.setVolume('music',.23);live.setMuted(true);
assert.equal(probe().masterGain,0,'master mute silences all buses including loops');
const played=live.played;live.play('coconutClack');assert.equal(live.played,played);
live.setMuted(false);assert.equal(probe().masterGain,.7);
live.setEventDirector({getPresentation:()=>({kind:'coconuts',phase:'active',remaining:30})});
live.frameUpdate(.016);const transition=probe().music.transitionAt;
assert.equal((transition-probe().music.epoch)%2.5,0,'transition is on the shared bar grid');
live.play('eventWarning');
assert.equal(live.musicBus.gain.value,.115,'warning briefly halves the music bus');
live.setVolume('music',.4);assert.equal(live.musicBus.gain.value,.2,'volume changes respect the temporary duck');
live.setMuted(true);assert.equal(probe().masterGain,0,'ducking cannot bypass mute');live.setMuted(false);
ctx.advance(3);live.frameUpdate(.016);assert.equal(live.musicBus.gain.value,.4,'music restores the current saved level after warning');
live.setVolume('music',.23);
legendary={phase:'detach'};game.renderer.camera.position.set(8,20,-62);
live.frameUpdate(.016);assert.equal(probe().music.mood,'legendary','restored active legendary phase builds without a new bus event');
ctx.advance(6);legendary.phase='complete';live.setEventDirector(null);live.frameUpdate(.016);
assert.equal(probe().music.mood,'calm','finished legendary sequence releases the build');
legendary=null;game.renderer.camera.position.set(0,0,0);
// Spatial material cue: rotated crate sphere/OBB contact, not broad proximity.
const crateMatrix=new THREE.Matrix4().makeRotationY(Math.PI/4).setPosition(4,2,7);
const orchardMatrix=new THREE.Matrix4().makeTranslation(-4,1,2);
world={built:{mesh:{geometry:{userData:{authoredProps:[
  {matrix:crateMatrix.toArray(),details:{kind:'crate',size:1}},
  {matrix:orchardMatrix.toArray(),details:{kind:'crate',width:1,height:.6}},
  {matrix:new THREE.Matrix4().makeTranslation(20,0,0).toArray(),details:{kind:'crate',size:1,support:'crate below'}},
  {matrix:new THREE.Matrix4().makeTranslation(30,0,0).toArray(),details:{kind:'barrel',size:1}},
]}}}}};
let fruitRadius=.2;fruit={get:()=>({radius:fruitRadius})};
const realPlay=live.play,cues=[];live.play=(name,opts)=>cues.push({name,opts});
function impact(point,onPlayer=false){cues.length=0;bus.emit('fruit:impact',{fruitId:1,species:'apple',speed:7,point,onPlayer});return cues.some(c=>c.name==='woodKnock');}
const contact=new THREE.Vector3(.7,0,0).applyMatrix4(crateMatrix);
assert.ok(impact(contact),'rotated crate face contact adds wood knock');
assert.ok(cues.find(c=>c.name==='woodKnock').opts.position.equals(contact),'wood knock is spatial at impact');
assert.equal(impact(new THREE.Vector3(.7,0,.7).applyMatrix4(crateMatrix)),false,'outside rounded OBB corner is not a crate hit');
assert.equal(impact(new THREE.Vector3(.8,0,0).applyMatrix4(crateMatrix)),false,'nearby ground impact does not count');
assert.equal(impact(contact,true),false,'player impacts do not add crate sounds');
assert.ok(impact(new THREE.Vector3(-4,1.8,2)),'orchard base-origin crate top is detected');
assert.equal(impact(new THREE.Vector3(20.7,0,0)),false,'noncolliding upper dock crate excluded');
assert.equal(impact(new THREE.Vector3(30.7,0,0)),false,'arbitrary noncrate wood excluded');
fruitRadius=.4;assert.ok(impact(new THREE.Vector3(.9,0,0).applyMatrix4(crateMatrix)),'actual inflated fruit radius participates');
live.play=realPlay;world=null;fruit=null;
for(let i=0;i<100;i++){ctx.currentTime+=.036;live.play(SOUND_NAMES[i%SOUND_NAMES.length],{position:new THREE.Vector3(1,2,3)});}
assert.ok(probe().activeVoices<=32,'voice count remains bounded');
ctx.advance(4);assert.equal(probe().activeVoices,0,'one-shot graphs release after their tails');
const connectedAfterTails=ctx.nodes.filter(n=>n.connections.size).length;
assert.equal(connectedAfterTails,24,'only 3 music chains,4 ambience chains and buses remain');
live.play('ropeSnap');document.hidden=true;for(const fn of handlers.get('visibilitychange'))fn();
assert.equal(ctx.state,'suspended');assert.equal(probe().activeVoices,0);
document.hidden=false;for(const fn of handlers.get('visibilitychange'))fn();await Promise.resolve();
assert.equal(ctx.state,'running');assert.equal(probe().music.sources,3,'resume creates no duplicate stems');
live.dispose();assert.equal(ctx.nodes.filter(n=>n.connections.size).length,0,'dispose disconnects every node');
assert.equal([...handlers.values()].reduce((n,s)=>n+s.size,0),0,'gesture and visibility listeners are removed');
live=new AudioManager();live.init(game);assert.equal(live.getSettings().music,.23,'volume persists');live.dispose();
console.log(JSON.stringify({pass:true,stems:3,ambienceLoops:4,voiceLimit:32,connectedSteadyNodes:connectedAfterTails,
  connectedAfterDispose:0,barSeconds:2.5,muteAllBuses:true,persistence:true,hiddenSuspendResume:true,
  warningDucksMusic:true,restoredLegendaryBuild:true,spatialCrateImpact:true},null,2));
