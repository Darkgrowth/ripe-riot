// Rebuild the visual review from matching route captures, without game edits.
import { mkdirSync, writeFileSync } from 'node:fs';
import { contactSheet } from './sheet.mjs';

const views = ['1-spawn', '2-dock-mid', '3-shop', '4-orchard', '5-waterfall', '6-king-melon'];
const labels = ['Arrival dock', 'Dock approach', "Merv’s Supply", 'Old Orchard', 'Waterfall lagoon', 'King Melon vista'];
const out = 'capture/polish-qa';
mkdirSync(out, { recursive: true });
const shots = views.flatMap((view, i) => ['before', 'after'].map(stage => ({
  file: `capture/route/polish-${stage}/${view}.png`, label: `${labels[i]} · ${stage}`,
})));
await contactSheet(shots, `${out}/comparison.png`, {
  cols: 2, thumbW: 640, title: 'SUNPATCH / matched gameplay views — before & after',
});
writeFileSync(`${out}/review.html`, `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sunpatch — visual review</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#122c29;color:#f3ecd7;font:16px/1.5 system-ui,sans-serif}
main{max-width:1420px;margin:auto;padding:32px}header{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:22px}
h1{font-size:clamp(24px,4vw,42px);line-height:1.1;margin:8px 0}p{margin:0;color:#b6c8bf}.eyebrow{font-size:12px;letter-spacing:3px;color:#eac574}
nav{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}button{background:#21433c;border:1px solid #507268;color:inherit;padding:10px 16px;border-radius:6px;cursor:pointer;font:inherit}
button[aria-pressed=true]{background:#eac574;color:#122c29;border-color:#eac574}button:focus-visible,input:focus-visible{outline:3px solid #fff;outline-offset:3px}
.frame{aspect-ratio:16/9;position:relative;overflow:hidden;border-radius:8px;background:#18372e;border:1px solid #507268}.frame img{position:absolute;width:100%;height:100%;object-fit:contain;inset:0}
#after{clip-path:inset(0 0 0 50%)}#divider{position:absolute;top:0;bottom:0;left:50%;width:2px;background:#fff8d8;pointer-events:none}
.badge{position:absolute;top:16px;background:#122c29df;padding:5px 12px;font-size:12px;letter-spacing:2px;border-radius:4px}.before{left:16px}.after{right:16px}
.controls{display:flex;gap:18px;align-items:center;margin:16px 0}input{flex:1;accent-color:#eac574}.note{max-width:950px;font-size:14px}
footer{border-top:1px solid #35574c;margin-top:24px;padding-top:18px;font-size:13px;color:#b6c8bf}a{color:#eac574}
@media(max-width:650px){main{padding:18px}header{display:block}header p{margin-top:14px}button{font-size:13px;padding:8px 10px}}
</style><main>
<header><div><div class="eyebrow">RIPE RIOT / AREA 01</div><h1>Sunpatch, a little more lived in.</h1></div><p>Six matching first-person views.<br>Drag to compare the same camera.</p></header>
<nav aria-label="Review viewpoint">${labels.map((label,i)=>`<button data-view="${i}" aria-pressed="${i===0}">${label}</button>`).join('')}</nav>
<div class="frame"><img id="before" alt="Sunpatch before polish"><img id="after" alt="Sunpatch after polish"><div id="divider"></div><span class="badge before">BEFORE</span><span class="badge after">AFTER</span></div>
<div class="controls"><label for="split">Comparison</label><input id="split" type="range" min="0" max="100" value="50" aria-label="Before and after split"><output id="amount">50%</output></div>
<p id="note" class="note"></p>
<footer>Captured at 1280 × 720 through the game’s player camera. Weather and wind may differ between runs.<br><a href="comparison.png">Full contact sheet</a> · <a href="../../?fresh=1">Play a fresh Sunpatch session</a></footer>
</main><script>
const views=${JSON.stringify(views)};
const notes=[
'Staggered timber joints, fasteners, a harvest medallion above the shop, and a clear dock without vegetation growing through its boards.',
'The established approach and spawn are preserved. Small carpentry details hold up as you walk toward the island.',
'Terracotta roof courses, teal counter boards and shutters, an enamel weighing scale, and a repaired harvest cart.',
'An open orchard entrance, painted sign and bunting, varied tree crowns and branches, wildflower drifts, and a barrow with its wheel above ground.',
'The waterfall now reaches the lagoon instead of disappearing inside the bank. Crossing ripples and thin shoreline arcs make the water move.',
'The existing King Melon, anchors and gameplay remain. Decorative hillside stones now sample the ground at their actual rotated positions.'
];
function show(i){document.querySelector('#before').src='../route/polish-before/'+views[i]+'.png';document.querySelector('#after').src='../route/polish-after/'+views[i]+'.png';document.querySelector('#note').textContent=notes[i];document.querySelectorAll('nav button').forEach((b,n)=>b.setAttribute('aria-pressed',String(n===i)))}
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>show(Number(b.dataset.view))));
document.querySelector('#split').addEventListener('input',e=>{const v=e.target.value;document.querySelector('#after').style.clipPath='inset(0 0 0 '+v+'%)';document.querySelector('#divider').style.left=v+'%';document.querySelector('#amount').value=v+'%'});show(0);
</script></html>`);
console.log(`${out}/review.html`);
