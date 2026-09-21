// Static evidence viewer. Reads finalized capture artifacts; never opens a browser.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
const directory = path.resolve(process.argv[2] ?? 'capture/staging-qa/normal-input-final');
const report = JSON.parse(readFileSync(path.join(directory, 'report.json'), 'utf8'));
const rows = readFileSync(path.join(directory, 'timeline.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = n => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
const moments = rows.filter(row => row.kind === 'observed-event' &&
  (row.name === 'island:event' || row.name === 'money:changed' && row.payload.delta > 0 ||
    row.name === 'ui:toast' && row.payload.text?.startsWith('Merv:')));
const frames = readdirSync(directory).filter(f => /^frame-\d+\.png$/.test(f)).sort();
const video = existsSync(path.join(directory, 'session.mp4')) ? 'session.mp4'
  : existsSync(path.join(directory, 'session-indexed.webm')) ? 'session-indexed.webm' : 'session.webm';
const audio = ['gameplay-audio.mp3','gameplay-audio.ogg'].find(file => existsSync(path.join(directory, file)));
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sunpatch session evidence</title>
<style>body{margin:0;background:#122d28;color:#f0ebd9;font:16px/1.5 system-ui}main{max-width:1000px;margin:auto;padding:24px}a{color:#ffd879}video{width:100%;background:#000;image-rendering:auto}button{background:#e9d590;color:#17352c;border:0;border-radius:5px;padding:6px 10px;cursor:pointer}li{margin:8px 0}.frames{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}.frames img{width:100%}figure{margin:0}figcaption{font-size:14px}.limits{border-left:4px solid #e9d590;padding-left:16px}code{overflow-wrap:anywhere}</style>
<main><h1>Sunpatch: ordinary-input recording</h1>
<p>${report.fullTenMinuteSession ? 'Uninterrupted ten-minute session.' : 'Partial session; the ten-minute requirement is not met.'} Recorded ${Number(report.recording?.recordedSeconds ?? 0).toFixed(1)} seconds.</p>
<p class="limits">This is an automated keyboard/mouse run with read-only navigation assistance, not a human first-session playtest. The 320×180 software-rendered canvas video excludes the DOM HUD; timestamped screenshots below include it. This does not establish 1080p performance or commercial appeal.</p>
<video id="session" controls preload="metadata" src="${video}"></video>
${audio ? `<p>Actual gameplay mix, after master volume:</p><audio controls preload="metadata" src="${audio}"></audio>` : ''}
<h2>Observed beats</h2><ul>${Object.entries(report.beats).map(([beat, observed]) => `<li>${observed ? 'Observed' : 'Missing'}: ${escape(beat)}</li>`).join('')}</ul>
${report.failures.length ? `<h2>Run limitations/errors</h2><pre>${escape(report.failures.join('\n'))}</pre>` : ''}
<h2>Moments</h2><ol>${moments.map(row => `<li><button data-time="${Math.max(0,row.wallSeconds-2)}">${time(row.wallSeconds)}</button> ${escape(row.name === 'island:event' ? `${row.payload.kind}: ${row.payload.phase}${row.payload.result ? ` (${row.payload.result})` : ''}` : row.name === 'money:changed' ? `+$${row.payload.delta} (${row.payload.reason})` : row.payload.text)}</li>`).join('')}</ol>
<h2>HUD screenshots</h2><div class="frames">${frames.map(file => `<figure><a href="${file}"><img loading="lazy" src="${file}" alt="Gameplay at ${time(Number(file.match(/\d+/)[0]))}"></a><figcaption>${time(Number(file.match(/\d+/)[0]))}</figcaption></figure>`).join('')}</div>
<p><a href="report.json">Full report</a> · <a href="timeline.jsonl">Input and event timeline</a></p></main>
<script>document.querySelectorAll('[data-time]').forEach(button=>button.onclick=()=>{const video=document.getElementById('session');video.currentTime=Number(button.dataset.time);video.scrollIntoView({block:'center'});});</script></html>`;
writeFileSync(path.join(directory, 'review.html'), html);
console.log(JSON.stringify({directory,moments:moments.length,frames:frames.length}));
