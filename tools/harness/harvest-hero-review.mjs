import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../../capture/harvest-hero/', import.meta.url));
mkdirSync(out, { recursive: true });
const cards = [['cannon', 'Air cannon'], ['melon', 'Watermelon']].flatMap(([id, title]) =>
  [['wide', '1920 × 1080', '1920/1080'], ['ultra', '3434 × 1270', '3434/1270']].map(([aspect, size, ratio]) => `
  <section><h2>${title} <small>${size}</small></h2>
    <div class="compare" style="aspect-ratio:${ratio}">
      <img src="after/${id}-${aspect}.png" alt="Updated ${title.toLowerCase()} in the Sunpatch orchard">
      <img class="before" src="before/${id}-${aspect}.png" alt="Previous ${title.toLowerCase()} in the same camera view">
      <span class="label old">Before</span><span class="label new">After</span>
      <div class="divider"></div>
    </div>
    <label class="slider">Compare <input type="range" min="0" max="100" value="50" aria-label="${title}, ${size}: amount of previous image visible"></label>
    <a href="after/${id}-${aspect}.png">Open full-resolution image</a>
  </section>`)).join('');
writeFileSync(`${out}/review.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RIPE RIOT · Harvest hero assets</title><style>
*{box-sizing:border-box}body{margin:0;background:#142d2b;color:#f5ecd6;font:16px/1.5 system-ui}main{max-width:1600px;margin:auto;padding:30px 24px 60px}h1{font-size:clamp(28px,4vw,48px);margin:0}p{max-width:850px;color:#c6d8c9}h2{margin:32px 0 12px;font-size:22px}small{font-size:14px;font-weight:400;color:#b8c7bc}a{color:#ffe09a}.compare{position:relative;overflow:hidden;background:#081917;--split:50%}.compare img{position:absolute;inset:0;width:100%;height:100%}.before{clip-path:inset(0 calc(100% - var(--split)) 0 0)}.divider{position:absolute;left:var(--split);top:0;bottom:0;border-left:2px solid #ffdc75}.label{position:absolute;top:12px;padding:4px 10px;background:#142d2be6;border-radius:5px;font-size:13px}.old{left:12px}.new{right:12px}.slider{display:flex;gap:14px;align-items:center;margin:10px 0}input{flex:1;accent-color:#ffd36a}.detail{width:100%;display:block}.note{padding:16px;background:#203d37;border-radius:8px}section>a{font-size:14px}@media(max-width:600px){main{padding:20px 12px}.label{top:5px;padding:2px 5px;font-size:11px}h2 small{display:block}}
</style><main><h1>Fruit first. Unreasonable equipment.</h1>
<p>A rounder watermelon with broad rind stripes, a bent stem and a small field spot. A substantial air cannon with enamel housing, brass reservoir, hose, bolted breech and a working charge dial.</p>
<p class="note">Matching player cameras, full HUD, wide and ultrawide. Drag each slider or use the arrow keys. Wind and idle animation timing can differ. These are gameplay captures, not concept renders.</p>
${cards}
<section><h2>Charge dial at full power</h2><img class="detail" src="qa/cannon-charged.png" alt="Air cannon held at full charge with its dial pointing to the red zone"><p>Verified through mouse press and release: charge 0 → 1 → 0, dial left → right → left, full-power shot fired. Switching tools cancels the charge. Carrying fruit hides the cannon; dropping restores it.</p></section>
<p>Scope: this pass improves two close-up assets. Island routes, fruit mass, tool power and multiplayer authority retain their existing behavior. The first island still has further environment work ahead.</p>
<p><a href="/">Play RIPE RIOT</a> · <a href="../identity-proof/review.html">Previous orchard and glove pass</a></p>
</main><script>document.querySelectorAll('.slider input').forEach(input=>input.addEventListener('input',()=>input.closest('section').querySelector('.compare').style.setProperty('--split',input.value+'%')))</script></html>`);
console.log(`Review written to ${out}/review.html`);
