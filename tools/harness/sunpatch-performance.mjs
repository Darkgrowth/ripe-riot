// Short, rendered hardware samples at the actual ultrawide gameplay camera.
// This is a reproducible spot check, not a minimum-spec or long-session test.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withGame, ROOT } from './driver.mjs';

if (process.env.RIPE_HARDWARE !== '1') throw new Error('Set RIPE_HARDWARE=1 for the GPU check.');
const out = path.join(ROOT, 'docs/evidence/sunpatch-finish');
mkdirSync(out, { recursive: true });
const report = { viewport: [3440, 1440], deviceScaleFactor: 1,
  method: 'Uncapped headless rAF; gl.finish synchronizes GPU completion on each sampled frame.',
  samples: [], errors: [] };
await withGame(async g => {
  for (const [name, x, z, tx, ty, tz] of [
    ['dock', 33, 66, 20, 7, 38],
    ['orchard', -20, 29, -24, 9, 16],
    ['ravine', -21, -34, 8, 30, -62],
  ]) {
    const y = await g.terrainHeight(x, z);
    await g.tp(x, y + .15, z);
    await g.look(Math.atan2(-(tx-x), -(tz-z)), Math.atan2(ty-y-1.7, Math.hypot(tx-x,tz-z)));
    await g.idleFrames(120);
    const sample = await g.page.evaluate(async () => {
      const game = window.__GAME;
      const renderer = game.renderer.renderer;
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const deltas = [];
      let previous;
      await new Promise(resolve => {
        const frame = () => {
          // Do not mistake a fast CPU command queue for completed GPU draws.
          gl.finish();
          const t = performance.now();
          if (previous !== undefined) deltas.push(t - previous);
          previous = t;
          if (deltas.length === 240) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      const sorted = [...deltas].sort((a, b) => a - b);
      const quantile = p => +sorted[Math.ceil(sorted.length * p) - 1].toFixed(2);
      return {
        gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable',
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        visualMode: window.__RIPE_VISUAL_MODE,
        frames: deltas.length,
        meanFrameMs: +(deltas.reduce((a, b) => a + b) / deltas.length).toFixed(2),
        medianFrameMs: quantile(.5), p95FrameMs: quantile(.95), maxFrameMs: quantile(1),
        render: game.renderer.info,
      };
    });
    report.samples.push({ name, ...sample });
  }
  report.errors = g.consoleErrors;
}, { width: 3440, height: 1440, headless: true, quiet: true });
writeFileSync(path.join(out, 'performance.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (report.errors.length) process.exitCode = 1;
