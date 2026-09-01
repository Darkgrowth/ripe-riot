// Are shadows actually rendering? Compare identical frames with the sun's
// shadow casting on and off. If the numbers match, nothing is being shadowed.
import { withGame } from './driver.mjs';

await withGame(async (g) => {
  await g.freeCam([-14, 14, 34], [-26, 7, 20]);   // looking into the orchard
  await g.wait(0.4);
  console.log('setup:', JSON.stringify(await g.shadowInfo(), null, 1));

  await g.setShadows(true);
  await g.wait(0.5);
  const on = await g.stats();
  await g.setShadows(false);
  await g.wait(0.5);
  const off = await g.stats();

  console.log('shadows ON :', JSON.stringify(on));
  console.log('shadows OFF:', JSON.stringify(off));
  const dMean = Math.abs(on.mean - off.mean);
  const dContrast = Math.abs(on.contrast - off.contrast);
  console.log(`\ndelta mean ${dMean.toFixed(4)}  delta contrast ${dContrast.toFixed(4)}`);
  console.log(dMean > 0.004 || dContrast > 0.004
    ? 'shadows ARE affecting the image'
    : 'shadows are NOT affecting the image');
  await g.setShadows(true);
}, { width: 800, height: 450, headless: true, quiet: true });
