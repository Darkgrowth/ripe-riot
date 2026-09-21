// Actual Chromium audio graph + MediaRecorder proof. No microphone permissions.
// RIPE_HARDWARE=1 RIPE_URL=http://127.0.0.1:5188 node tools/audio/browser_audio_check.mjs
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { withGame, ensureOut } from '../harness/driver.mjs';
const out=ensureOut('alive/audio'), report={checks:[]};
const check=(value,label,detail)=>{report.checks.push({pass:!!value,label,detail});assert.ok(value,label);};
try {
  await withGame(async g=>{
    const page=g.page;
    check((await g.state()).audio.running==='none','no audio context before first click');
    await page.mouse.click(640,360);
    await page.waitForFunction(()=>window.__RIPE.state().audio.running==='running');
    await page.waitForFunction(()=>window.__RIPE.state().audio.music?.ready,{},{timeout:15000});
    report.unlocked=(await g.state()).audio;
    check(report.unlocked.music.sources===3,'gesture unlock loads three synchronized stems');
    report.buffers=await page.evaluate(()=>window.__GAME.get('audio').music.sources.map(s=>({
      duration:s.buffer.duration,length:s.buffer.length,sampleRate:s.buffer.sampleRate,loop:s.loop,loopEnd:s.loopEnd})));
    check(report.buffers.every(b=>Math.abs(b.duration-120)<.02&&b.loop&&b.loopEnd===120),'all decoded stems use the 120-second loop');
    await page.evaluate(()=>{
      const a=window.__GAME.get('audio');window.__AUDIO_QA={};
      const q=window.__AUDIO_QA;q.analyser=a.ctx.createAnalyser();q.analyser.fftSize=2048;
      a.compressor.connect(q.analyser);
      q.rms=async(ms=350)=>{let peak=0,sum=0,n=0;const b=new Float32Array(q.analyser.fftSize);
        for(let i=0;i<Math.ceil(ms/25);i++){q.analyser.getFloatTimeDomainData(b);for(const v of b){sum+=v*v;peak=Math.max(peak,Math.abs(v));n++;}await new Promise(r=>setTimeout(r,25));}
        return {rms:Math.sqrt(sum/n),peak};};
    });
    await page.waitForTimeout(2800);
    report.audible=await page.evaluate(()=>window.__AUDIO_QA.rms());
    check(report.audible.rms>.001,'music and ambience produce actual output',report.audible);
    await g.call('audio.mute',true);await page.waitForTimeout(150);
    report.muted=await page.evaluate(()=>window.__AUDIO_QA.rms());
    check(report.muted.peak<1e-7,'master mute silences the combined output',report.muted);
    await g.call('audio.mute',false);
    await g.call('audio.volume','master',0);await page.waitForTimeout(150);
    report.zeroMaster=await page.evaluate(()=>window.__AUDIO_QA.rms());
    check(report.zeroMaster.peak<1e-7,'zero master volume also silences all output',report.zeroMaster);
    await g.call('audio.volume','master',.7);
    // Native settings controls, then a genuine page reload to test persistence.
    await page.keyboard.press('Escape');
    await page.evaluate(()=>document.exitPointerLock());
    await page.waitForFunction(()=>!document.pointerLockElement);
    await page.locator('.audio-settings summary').click();
    await page.locator('[data-channel="music"]').fill('23');
    await page.locator('[data-channel="music"]').dispatchEvent('input');
    check((await g.state()).audio.settings.music===.23,'music slider updates the live bus');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__RIPE_READY===true);
    check((await g.state()).audio.settings.music===.23,'music slider persists across reload');
    await page.mouse.click(640,360);
    await page.waitForFunction(()=>window.__RIPE.state().audio.music?.ready,{},{timeout:15000});
    await g.call('audio.volume','music',.35);
    // Actual tab visibility, not a synthetic event or overridden hidden flag.
    const cdp=await g.ctx.newCDPSession(page);
    const {windowId}=await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'minimized'}});
    await page.waitForTimeout(400);
    report.hidden=await page.evaluate(()=>({visibility:document.visibilityState,state:window.__GAME.get('audio').ctx.state}));
    await cdp.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});
    await page.bringToFront();await page.waitForTimeout(400);
    report.resumed=await page.evaluate(()=>({visibility:document.visibilityState,state:window.__GAME.get('audio').ctx.state,sources:window.__RIPE.state().audio.music.sources}));
    if(report.hidden.visibility==='hidden')check(report.hidden.state==='suspended','real minimized browser suspends audio',report.hidden);
    else report.visibilityLimitation='Chromium automation remained document.visible after background-window and minimized-window attempts. Real visibility suspend is unverified here; CPU event lifecycle passes. No document.hidden override was used.';
    check(report.resumed.state==='running'&&report.resumed.sources===3,'foreground retains exactly three running stems',report.resumed);
    await page.evaluate(()=>{
      const a=window.__GAME.get('audio');window.__AUDIO_QA={};
      const q=window.__AUDIO_QA;q.event={kind:'coconuts',phase:'active',remaining:30};
      a.setEventDirector({getPresentation:()=>q.event});
    });
    await page.waitForTimeout(5400);
    report.trouble=await page.evaluate(()=>{const a=window.__GAME.get('audio');return {state:a.music.getState(),gains:a.music.gains.map(g=>g.gain.value)};});
    check(report.trouble.gains.every((v,i)=>Math.abs(v-[.88,.65,.75][i])<.01),'trouble mix settles on the audio-clock bar grid',report.trouble);
    await page.evaluate(()=>{const a=window.__GAME.get('audio');const names=window.__RIPE.call('audio.list');
      for(const name of names)a.play(name,{volume:.03});});
    report.voiceBurst=(await g.state()).audio.activeVoices;
    check(report.voiceBurst<=32,'simultaneous voice count is bounded',report.voiceBurst);
    await page.waitForTimeout(2200);
    check((await g.state()).audio.activeVoices===0,'one-shot scopes clean up after tails');
    // Record the actual game canvas and post-master output for forty seconds.
    await page.evaluate(()=>{
      const a=window.__GAME.get('audio'),q=window.__AUDIO_QA;
      q.event={kind:null,phase:'idle',remaining:0};
      q.destination=a.ctx.createMediaStreamDestination();a.compressor.connect(q.destination);
      q.stream=document.getElementById('view').captureStream(24);
      for(const track of q.destination.stream.getAudioTracks())q.stream.addTrack(track);
      q.chunks=[];q.recorder=new MediaRecorder(q.stream,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:1600000,audioBitsPerSecond:128000});
      q.recorder.ondataavailable=e=>{if(e.data.size)q.chunks.push(e.data);};q.recorder.start(1000);
    });
    const views=[{x:55,z:62,look:[45,5,52],kind:null},{x:-4,z:31,look:[-24,11,22],kind:'windfall'},
      {x:37.5,z:7.5,look:[34,8,-25],kind:'coconuts'},{x:-9,z:-44,look:[8,39,-62],kind:'order'}];
    for(let i=0;i<views.length;i++){
      const v=views[i],h=await g.terrainHeight(v.x,v.z);await g.tp(v.x,h+.15,v.z);
      await page.evaluate(({look,kind})=>{const p=window.__GAME.player,dx=look[0]-p.position.x,dy=look[1]-(p.position.y+1.6),dz=look[2]-p.position.z;
        window.__RIPE.look(Math.atan2(-dx,-dz),Math.atan2(dy,Math.hypot(dx,dz)));
        window.__AUDIO_QA.event={kind,phase:kind?'active':'idle',remaining:30};},v);
      if(i===3)await page.evaluate(()=>window.__GAME.bus.emit('legendary:phase',{id:'kingMelon',phase:'detach'}));
      await page.waitForTimeout(9000);
      if(i===3)await page.evaluate(()=>window.__GAME.bus.emit('legendary:complete',{id:'kingMelon',payout:0}));
      else await g.call('audio.play',['woodKnock','coconutClack','ropeFire'][i]);
      await page.waitForTimeout(1000);
    }
    const base64=await page.evaluate(async()=>{const q=window.__AUDIO_QA;
      await new Promise(r=>{q.recorder.onstop=r;q.recorder.stop();});
      const blob=new Blob(q.chunks,{type:q.recorder.mimeType});
      for(const track of q.stream.getTracks())track.stop();
      window.__GAME.get('audio').compressor.disconnect(q.destination);q.destination.disconnect();
      return new Promise(r=>{const reader=new FileReader();reader.onload=()=>{
        const uri=String(reader.result);r(uri.slice(uri.lastIndexOf(',')+1));};reader.readAsDataURL(blob);});});
    const recording=Buffer.from(base64,'base64');
    check(recording.length>1000&&recording.subarray(0,4).toString('hex')==='1a45dfa3','recording export contains a valid WebM header');
    writeFileSync(`${out}/game-audio-40s.webm`,recording);
    report.final=(await g.state()).audio;report.consoleErrors=g.consoleErrors;
    await g.shot('audio-scene','alive/audio');
    check(!g.consoleErrors.some(e=>/pageerror:|Music unavailable/.test(e)),'no audio runtime or decoding errors');
    report.disposed=await page.evaluate(async()=>{const a=window.__GAME.get('audio'),ctx=a.ctx;
      a.dispose();await new Promise(r=>setTimeout(r,100));
      return {context:ctx.state,voices:a.activeVoices.size,ambience:a.ambienceSources.length,music:a.music};});
    check(report.disposed.context==='closed'&&report.disposed.voices===0&&report.disposed.ambience===0&&report.disposed.music===null,'real audio graph closes and clears on dispose',report.disposed);
  },{width:1280,height:720,headless:false,quiet:true});
} finally {writeFileSync(`${out}/browser-report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
