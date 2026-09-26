import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.RIPE_URL || 'http://127.0.0.1:5203';
const out = path.resolve(process.env.RIPE_OUT
  || 'docs/evidence/detailed-voxel-clearing/worker-in-game');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--use-gl=angle', '--use-angle=d3d11'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1, recordVideo: { dir: out, size: { width: 1920, height: 1080 } } });
const errors = [];
const frames = [];
const open = async (context, clickToPlay = false) => {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/?fresh=1&voxelPilot=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR,
    null, { timeout: 90000 });
  const bootError = await page.evaluate(() => window.__RIPE_ERROR ?? null);
  if (bootError) throw new Error(bootError);
  if (clickToPlay) await page.mouse.click(960, 540);
  return page;
};
try {
  const host = await open(context, true);
  console.log('host ready');
  const client = await open(context);
  console.log('client ready');
  await client.setViewportSize({ width: 320, height: 180 });
  const room = `voxel-worker-${Date.now()}`;
  await host.evaluate(room => window.__RIPE.call('net.connect', room, 0), room);
  console.log('host connected');
  await host.waitForTimeout(400);
  await client.evaluate(room => window.__RIPE.call('net.connect', room, 1), room);
  console.log('client connected');
  await host.waitForFunction(() => window.__GAME?.get('net')?.remotes?.size > 0,
    null, { timeout: 15000 });
  const cy = await client.evaluate(() => window.__RIPE.terrainHeight(15, 40));
  await client.evaluate(y => {
    window.__RIPE.tp(15, y + 0.15, 40);
    window.__RIPE.look(Math.PI, 0);
  }, cy);
  await host.bringToFront();
  await host.mouse.click(960, 540);
  await host.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 5000 });
  const shot = async name => {
    await host.waitForTimeout(450);
    await host.screenshot({ path: path.join(out, `${name}.png`) });
    const state = await host.evaluate(() => window.__RIPE.state());
    frames.push({ name, render: state.render, profile: state.profile,
      remoteCount: await host.evaluate(() => window.__GAME.get('net').remotes.size),
      errors: [...errors] });
    console.log(`${name}: ${state.render.drawCalls} calls, ${state.render.triangles} triangles`);
  };
  await host.evaluate(y => window.__RIPE.freeCam(15, y + 1.8, 36.2, 15, y + 1.25, 40), cy);
  await shot('worker-front');
  await host.evaluate(y => window.__RIPE.freeCam(18.5, y + 1.9, 40, 15, y + 1.25, 40), cy);
  await shot('worker-side');
  await host.evaluate(y => window.__RIPE.freeCam(15, y + 1.8, 43.8, 15, y + 1.25, 40), cy);
  await shot('worker-rear');
  await host.evaluate(y => window.__RIPE.freeCam(18.2, y + 2.0, 36.8, 15, y + 1.2, 40), cy);
  await client.evaluate(() => window.__RIPE.input({ moveZ: 1 }));
  await shot('worker-walk');
  await host.waitForTimeout(650);
  await client.evaluate(() => window.__RIPE.input({ moveZ: -1 }));
  await host.waitForTimeout(800);
  await client.evaluate(() => window.__RIPE.clearInput());
  await client.evaluate(() => window.__RIPE.call('ragdoll.trigger', 18, 'voxel-worker-visual-proof'));
  await host.waitForTimeout(180);
  const fallen = await client.evaluate(() => window.__GAME.player.position.toArray());
  await host.evaluate(([x, y, z]) => window.__RIPE.freeCam(x + 1.6, y + 1.5, z - 2.0,
    x, y + 0.9, z), fallen);
  await shot('worker-ragdoll');
  const groundAtRemote = async name => host.evaluate(name => {
    const remote = [...window.__GAME.get('net').remotes.values()][0];
    const root = remote.rig.root;
    const vertex = remote.pos.clone();
    const visualBottom = remote.pos.clone().set(0, Infinity, 0);
    root.updateMatrixWorld(true);
    root.traverse(object => {
      if (!object.isMesh) return;
      const positions = object.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        if (object.isSkinnedMesh) object.getVertexPosition(i, vertex);
        else vertex.fromBufferAttribute(positions, i);
        vertex.applyMatrix4(object.matrixWorld);
        if (vertex.y < visualBottom.y) visualBottom.copy(vertex);
      }
    });
    return { name, remotePosition: remote.pos.toArray(),
      visualRoot: root.position.toArray(), visualBottom: visualBottom.toArray(),
      terrainHeight: window.__GAME.get('world').terrain.height(remote.pos.x, remote.pos.z),
      groundAtVisualBottom: window.__GAME.get('world').terrain.height(visualBottom.x, visualBottom.z),
      playerHeight: remote.height, state: remote.state };
  }, name);
  frames.push(await groundAtRemote('remote-ground-early'));
  await host.waitForTimeout(2200);
  await shot('worker-ragdoll-settled');
  frames.push(await groundAtRemote('remote-ground-late'));
  const hostVideo = host.video();
  const clientVideo = client.video();
  await host.close();
  await client.close();
  await context.close();
  if (hostVideo) renameSync(await hostVideo.path(),
    path.join(out, 'worker-coop-motion.webm'));
  if (clientVideo) unlinkSync(await clientVideo.path());
} finally {
  await browser.close();
  writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ base, frames,
    motionVideo: 'worker-coop-motion.webm' }, null, 2));
}
