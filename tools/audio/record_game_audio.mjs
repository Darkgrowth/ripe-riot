// Isolated, software-only capture. Run only when the lead grants the test slot.
// RIPE_URL=http://127.0.0.1:5192 node tools/audio/record_game_audio.mjs
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {withGame,ensureOut} from '../harness/driver.mjs';
assert.ok(['http://127.0.0.1:5192','http://127.0.0.1:5193'].includes(process.env.RIPE_URL),'capture is restricted to staging servers');
assert.notEqual(process.env.RIPE_HARDWARE,'1','capture must use software rendering');
const out=ensureOut('alive/audio');
await withGame(async g=>{
  await g.page.mouse.click(160,90);
  await g.page.waitForFunction(()=>window.__RIPE.state().audio.music?.ready,null,{timeout:20000});
  await g.page.evaluate(()=>{
    const a=window.__GAME.get('audio'),q=window.__AUDIO_RECORDING={};
    q.destination=a.ctx.createMediaStreamDestination();a.compressor.connect(q.destination);
    // Capture post-master output while keeping this isolated browser silent.
    a.compressor.disconnect(a.ctx.destination);
    q.stream=document.getElementById('view').captureStream(12);
    for(const track of q.destination.stream.getAudioTracks())q.stream.addTrack(track);
    q.chunks=[];q.recorder=new MediaRecorder(q.stream,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:250000,audioBitsPerSecond:128000});
    q.recorder.ondataavailable=e=>{if(e.data.size)q.chunks.push(e.data);};
    q.recorder.onerror=e=>{q.error=String(e.error??e);};q.recorder.start(1000);
  });
  console.log('Recording isolated staging game audio for 40 seconds at 320x180.');
  const cues=['woodKnock','coconutClack','ropeFire','eventWarning','eventSuccess'];
  for(let i=0;i<5;i++){
    await g.page.waitForTimeout(4000);await g.call('audio.play',cues[i]);await g.page.waitForTimeout(4000);
  }
  const result=await g.page.evaluate(async()=>{
    const q=window.__AUDIO_RECORDING;
    if(q.error)throw new Error(q.error);
    await Promise.race([new Promise(r=>{q.recorder.onstop=r;q.recorder.stop();}),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('MediaRecorder stop timeout')),5000))]);
    const blob=new Blob(q.chunks,{type:q.recorder.mimeType});
    for(const track of q.stream.getTracks())track.stop();
    window.__GAME.get('audio').compressor.disconnect(q.destination);q.destination.disconnect();
    const base64=await new Promise(r=>{const reader=new FileReader();reader.onload=()=>{
      const uri=String(reader.result);r(uri.slice(uri.lastIndexOf(',')+1));};reader.readAsDataURL(blob);});
    return {base64,bytes:blob.size,mime:blob.type,audio:window.__RIPE.state().audio};
  });
  const bytes=Buffer.from(result.base64,'base64');delete result.base64;
  assert.ok(bytes.length>1000&&bytes.subarray(0,4).toString('hex')==='1a45dfa3','valid WebM EBML header');
  writeFileSync(`${out}/game-audio-40s.webm`,bytes);
  writeFileSync(`${out}/recording-report.json`,JSON.stringify({...result,width:320,height:180,software:true,
    cues,consoleErrors:g.consoleErrors,subjectiveListening:false},null,2));
  console.log(JSON.stringify({bytes:bytes.length,output:`${out}/game-audio-40s.webm`,consoleErrors:g.consoleErrors}));
},{width:320,height:180,headless:true,quiet:true});
