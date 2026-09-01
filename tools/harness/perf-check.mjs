// Where do the draw calls go? Attribute them by toggling passes.
import { withGame } from './driver.mjs';

await withGame(async (g) => {
  await g.tp(-24, 12, 22);
  await g.look(0.6, -0.1);
  await g.wait(0.8);
  const all = (await g.state()).render;

  await g.setShadows(false);
  await g.wait(0.6);
  const noShadow = (await g.state()).render;

  await g.call('viewmodel.show', false);
  await g.wait(0.6);
  const noVm = (await g.state()).render;

  await g.setShadows(true);
  await g.call('viewmodel.show', true);

  console.log('everything      ', JSON.stringify(all));
  console.log('without shadows ', JSON.stringify(noShadow));
  console.log('without viewmodel too', JSON.stringify(noVm));
  console.log(`\nshadow pass costs ${all.drawCalls - noShadow.drawCalls} draws, ` +
    `${all.triangles - noShadow.triangles} tris`);
  console.log(`viewmodel costs ${noShadow.drawCalls - noVm.drawCalls} draws, ` +
    `${noShadow.triangles - noVm.triangles} tris`);
  console.log(`scene itself: ${noVm.drawCalls} draws, ${noVm.triangles} tris`);
}, { width: 1280, height: 720, headless: true, quiet: true });
