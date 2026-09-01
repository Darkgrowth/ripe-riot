// Contact-sheet builder.
//
// Looking at N frames costs N images worth of attention. Looking at one sheet
// of N thumbnails costs one. This composes labelled thumbnails into a single
// PNG using a throwaway browser page, so it needs no image libraries.

import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * @param {{file: string, label: string, note?: string}[]} shots
 * @param {string} outFile
 * @param {{cols?: number, thumbW?: number, title?: string}} opts
 */
export async function contactSheet(shots, outFile, opts = {}) {
  const cols = opts.cols ?? 3;
  const thumbW = opts.thumbW ?? 420;
  const title = opts.title ?? path.basename(outFile, '.png');

  const cells = shots.map((s) => {
    const b64 = readFileSync(s.file).toString('base64');
    return `<figure>
      <img src="data:image/png;base64,${b64}" />
      <figcaption><b>${escapeHtml(s.label)}</b>${s.note ? `<span>${escapeHtml(s.note)}</span>` : ''}</figcaption>
    </figure>`;
  }).join('\n');

  const html = `<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; background:#11181f; color:#dfe8ef;
         font:13px/1.4 'Segoe UI', system-ui, sans-serif; padding:18px; }
  h1 { font-size:17px; margin:0 0 14px; letter-spacing:1px; color:#ffcc44; }
  .grid { display:grid; grid-template-columns:repeat(${cols}, ${thumbW}px); gap:14px; }
  figure { margin:0; background:#1a232c; border-radius:8px; overflow:hidden;
           border:1px solid #2b3742; }
  img { display:block; width:${thumbW}px; height:auto; }
  figcaption { padding:6px 9px; font-size:12px; display:flex; justify-content:space-between; gap:8px; }
  figcaption span { opacity:.62; font-variant-numeric:tabular-nums; text-align:right; }
</style>
<h1>${escapeHtml(title)}</h1>
<div class="grid">${cells}</div>`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: cols * (thumbW + 14) + 40, height: 800 } });
  await page.setContent(html, { waitUntil: 'load' });
  mkdirSync(path.dirname(outFile), { recursive: true });
  await page.screenshot({ path: outFile, fullPage: true });
  await browser.close();
  return outFile;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Compact one-line summary of a frameStats object, for logs and captions. */
export function statLine(s) {
  if (!s) return '';
  return `mean ${s.mean.toFixed(2)} flat ${s.flat.toFixed(2)} ctr ${s.contrast.toFixed(2)} hue ${s.hueSpread}`;
}

/** Heuristic verdict so the harness can shout without anyone looking. */
export function verdict(s) {
  if (!s) return 'no-stats';
  if (s.black > 0.9) return 'BLACK SCREEN';
  if (s.flat > 0.985) return 'FEATURELESS';
  if (s.contrast < 0.035) return 'NO CONTRAST';
  if (s.blown > 0.5) return 'BLOWN OUT';
  if (s.hueSpread <= 1) return 'MONOCHROME';
  return 'ok';
}
