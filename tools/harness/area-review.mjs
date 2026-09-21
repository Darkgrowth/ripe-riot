// Assemble the area-design review without opening a browser or starting a game.
// Optional contact sheet: node tools/harness/area-review.mjs --sheet
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const out = 'capture/area-design';
const views = JSON.parse(readFileSync(`${out}/views.json`, 'utf8')).map(view => view.id);
const labels = ['Arrival dock', 'Orchard approach', 'Hill route', 'King Melon crags', 'Palm Beach', 'Cave Grove'];
const notes = [
  'The familiar arrival dock and supply shop establish the same starting route. This view checks how the new area details fit the existing island.',
  'The orchard approach retains its established trees and route. The additional destinations build on this first-area palette.',
  'The original hill route stays open. The sorting shelter sits on the terrace to its east, clear of the track and fruit trees; see its close view below.',
  'Four continuous crags now give the King Melon anchors a visible rock foundation, with matching physical surfaces. The melon and anchor positions are unchanged; a staging board marks the approach.',
  'A coral-and-cream shade, timber bench, and net rack give the beach a small resting and working spot among the palms.',
  'Cave Grove provides a matching reference view of the existing island beyond the new destination details.',
];
const details = [
  { file: 'hill-close.png', title: 'Hill Farm · sorting shelter', text: 'Timber joinery, cloth shade, harvest trays, rope, and barrel.' },
  { file: 'beach-close.png', title: 'Palm Beach · shade and net rack', text: 'Coral-and-cream canvas, a resting bench, and hanging nets.' },
  { file: 'ravine-board.png', title: 'King Melon · staging board', text: 'The approach board and the crags supporting the existing challenge.' },
];
mkdirSync(out, { recursive: true });
const makeSheet = process.argv.includes('--sheet');
if (makeSheet) {
  // sheet.mjs uses Chromium; keep it opt-in so review generation is safe while
  // the gameplay suite owns the browser and dev server.
  const { contactSheet } = await import('./sheet.mjs');
  await contactSheet(views.flatMap((view, i) => ['before', 'after'].map(stage => ({
    file: `${out}/${stage}/${view}.png`, label: `${labels[i]} · ${stage}`,
  }))), `${out}/comparison.png`, { cols: 2, thumbW: 640, title: 'SUNPATCH / first-area design — matching cameras' });
}

writeFileSync(`${out}/review.html`, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sunpatch — first-area design review</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#122c29;color:#f3ecd7;font:16px/1.5 system-ui,sans-serif}
main{max-width:1420px;margin:auto;padding:32px}header{display:flex;align-items:end;justify-content:space-between;gap:28px;margin-bottom:26px}
h1{font-size:clamp(26px,4vw,44px);line-height:1.12;margin:8px 0 12px;max-width:750px}p{margin:0;color:#b6c8bf}.eyebrow{font-size:12px;letter-spacing:3px;color:#eac574}
nav{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}button{background:#21433c;border:1px solid #507268;color:inherit;padding:10px 16px;border-radius:6px;cursor:pointer;font:inherit}
button[aria-pressed=true]{background:#eac574;color:#122c29;border-color:#eac574}button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #fff;outline-offset:3px}
.frame{aspect-ratio:16/9;position:relative;overflow:hidden;border-radius:8px;background:#18372e;border:1px solid #507268}.frame img{position:absolute;width:100%;height:100%;object-fit:contain;inset:0}
#after{clip-path:inset(0 0 0 50%)}#divider{position:absolute;top:0;bottom:0;left:50%;width:2px;background:#fff8d8;pointer-events:none}
.badge{position:absolute;top:16px;background:#122c29df;padding:5px 12px;font-size:12px;letter-spacing:2px;border-radius:4px}.before{left:16px}.after{right:16px}
.controls{display:flex;gap:18px;align-items:center;margin:16px 0}input{flex:1;accent-color:#eac574;min-width:0}output{min-width:42px;font-variant-numeric:tabular-nums}.note{max-width:1040px;font-size:15px;min-height:3em}
h2{font-size:23px;margin:30px 0 12px}.details{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.detail{background:#1c3b34;border:1px solid #35574c;border-radius:8px;overflow:hidden;text-decoration:none;color:inherit}.detail img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}.detail div{padding:14px}.detail strong{font-size:15px}.detail p{font-size:13px;margin-top:5px}.detail:hover{border-color:#eac574}
.scope{font-size:13px;margin-top:18px;max-width:1100px}footer{border-top:1px solid #35574c;margin-top:26px;padding-top:18px;font-size:13px;color:#b6c8bf}a{color:#eac574}
@media(max-width:700px){main{padding:18px}header{display:block}header>p{margin-top:14px}button{font-size:13px;padding:8px 10px}.details{grid-template-columns:1fr}.badge{top:8px;padding:3px 7px;font-size:10px}.before{left:8px}.after{right:8px}}
</style></head><body><main>
<header><div><div class="eyebrow">RIPE RIOT / AREA 01</div><h1>Sunpatch, from arrival to the far shore.</h1><p>Working corners, a shaded beach, and a clearer King Melon challenge.</p></div><p>Six matching player-camera views.<br>Drag the divider to compare.</p></header>
<nav aria-label="Review viewpoint">${labels.map((label, i) => `<button data-view="${i}" aria-pressed="${i === 4}">${label}</button>`).join('')}</nav>
<div class="frame"><img id="before" alt=""><img id="after" alt=""><div id="divider"></div><span class="badge before">BEFORE</span><span class="badge after">AFTER</span></div>
<div class="controls"><label for="split">Comparison</label><input id="split" type="range" min="0" max="100" value="50" aria-label="Before and after split"><output id="amount" for="split">50%</output></div>
<p id="note" class="note" aria-live="polite"></p>
<h2>A closer look</h2>
<div class="details">${details.map(detail => `<a class="detail" href="${detail.file}"><img loading="lazy" src="${detail.file}" alt="${detail.title}"><div><strong>${detail.title} ↗</strong><p>${detail.text}</p></div></a>`).join('')}</div>
<p class="scope">The worker gloves also have chamfered leather, stitched panels, and golden cuffs. Both comparison sets already include those updated gloves, so the slider does not show that change. The three detail images above are current close views, not before-and-after pairs.</p>
<footer>Matching views use the game’s player camera at 1280 × 720. Weather, wind, and moving fruit can differ between captures.<br>${makeSheet ? '<a href="comparison.png">Full contact sheet</a> · ' : ''}<a href="../../?fresh=1">Play a fresh Sunpatch session</a> · <a href="../polish-qa/review.html">Earlier dock and orchard polish</a></footer>
</main><script>
const views=${JSON.stringify(views)};
const labels=${JSON.stringify(labels)};
const notes=${JSON.stringify(notes)};
function show(i){
  for(const stage of ['before','after']){
    const img=document.querySelector('#'+stage);
    img.src=stage+'/'+views[i]+'.png';
    img.alt=labels[i]+' — '+stage+' this area-design pass';
  }
  document.querySelector('#note').textContent=notes[i];
  document.querySelectorAll('nav button').forEach((b,n)=>b.setAttribute('aria-pressed',String(n===i)));
}
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>show(Number(b.dataset.view))));
document.querySelector('#split').addEventListener('input',e=>{
  const v=e.target.value;
  document.querySelector('#after').style.clipPath='inset(0 0 0 '+v+'%)';
  document.querySelector('#divider').style.left=v+'%';
  document.querySelector('#amount').value=v+'%';
});
show(4);
</script></body></html>`);
console.log(`${out}/review.html`);
