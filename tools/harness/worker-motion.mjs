// Short headless gameplay clips for the connected-worker proof. Only the fall
// trigger, starting positions, inventory and test fruit are debug-authored;
// walking uses normal input and the game drives every visible pose and frame.
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGame, openSecondClient, sleep, startServer } from './driver.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'docs/evidence/connected-worker/after');
const temp = path.join(root, 'capture/worker-motion');
const url = process.env.RIPE_URL;
if (!url || new URL(url).port === '5197')
  throw new Error('Set RIPE_URL to the dedicated worktree preview, never port 5197');
mkdirSync(out, { recursive: true });
mkdirSync(temp, { recursive: true });
const server = await startServer();
let host;
let peer;
const clips = [];

async function frames(name, count, phase, camera = host) {
  const dir = path.join(temp, name);
  mkdirSync(dir, { recursive: true });
  const states = [];
  for (let i = 0; i < count; i++) {
    await phase(i);
    await sleep(85);
    await camera.idleFrames(1);
    await camera.shot(String(i).padStart(3, '0'), `worker-motion/${name}`);
    const s = await camera.state();
    states.push({ frame: i, time: s.elapsed, player: s.player.state,
      interaction: s.interaction?.carrying?.species ?? null,
      viewmodel: s.viewmodel?.tool ?? null, remote: s.net?.remotes?.length ?? null,
      hostPlayer: (await host.state()).player.state });
  }
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-framerate', '10', '-i', path.join(dir, '%03d.png'),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p',
    path.join(out, `${name}.mp4`)], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${name} encode failed: ${result.stderr}`);
  clips.push({ name, frames: count, fps: 10, viewport: [960, 540],
    phases: states, file: `${name}.mp4` });
  console.log(`clip ${name}: ${count} frames`);
}

try {
  host = await openGame({ width: 960, height: 540, headless: true,
    quiet: true, islandActivities: false, drawFrames: true });
  peer = await openSecondClient(host, { quiet: true,
    islandActivities: false, drawFrames: true });
  await peer.page.setViewportSize({ width: 960, height: 540 });
  await peer.page.evaluate(() => window.__GAME.renderer.resize());
  const room = `worker-motion-${Date.now()}`;
  await host.call('net.connect', room, 0);
  await sleep(900);
  await peer.call('net.connect', room, 1);
  await host.page.waitForFunction(() => window.__GAME.get('net').remotes.size > 0,
    null, { timeout: 15_000 });
  if (!await host.call('net.isHost')) throw new Error('capture page is not the co-op host');
  const x = 15, z = 40;
  const y = (await peer.terrainHeight(x, z)) + .12;
  await peer.tp(x, y, z);
  await peer.look(0, 0);
  const hz = z + 3.2;
  const hy = (await host.terrainHeight(x, hz)) + .12;
  await host.tp(x, hy, hz);
  await host.look(0, -.2);
  await host.call('viewmodel.show', false);
  await sleep(1400);

  await peer.pause(true);
  await frames('worker-walk', 24, async (i) => {
    if (i === 0) await peer.input({ moveX: .22 });
    if (i === 10) await peer.input({ moveX: -.22 });
    if (i === 20) await peer.clearInput();
    await peer.simulate(.08);
    const p = (await peer.state()).player.pos;
    const h = (await host.state()).player.pos;
    await host.look(Math.atan2(-(p[0] - h[0]), -(p[2] - h[2])),
      Math.atan2(p[1] + 1.05 - (h[1] + 1.63), Math.hypot(p[0] - h[0], p[2] - h[2])));
  });
  await peer.clearInput();
  await peer.pause(false);
  await host.tp(x, hy, hz);
  await host.freeCam([x + 3, hy + 2.3, hz + 3.8], [x, hy + .9, hz]);
  await host.pause(true);
  await sleep(250);
  await frames('worker-fall-recover', 32, async (i) => {
    if (i === 1) await host.call('ragdoll.trigger', 18, 'worker-motion');
    if (i === 19) await host.call('ragdoll.recover');
    if (i === 23) await host.attachCam();
    await host.simulate(.08);
  });
  await host.pause(false);

  await host.call('viewmodel.show', true);
  await host.look(.6, -.05);
  await host.call('tool.select', 'hand');
  await sleep(450);
  await frames('worker-tool-carry', 32, async (i) => {
    if (i === 6) { await host.call('tool.give', 'aircannon'); await host.call('tool.select', 'aircannon'); }
    if (i === 13) await host.call('tool.select', 'basket');
    if (i === 18 || i === 25) {
      if (i === 25) { await host.call('drop'); await host.call('fruit.despawnAllFree'); }
      const species = i === 18 ? 'apple' : 'watermelon';
      const p = (await host.state()).player.pos;
      const id = await host.call('fruit.spawn', species, p[0], p[1] + 1.2, p[2] - 1.2, null, .5);
      if (!await host.call('pickup', id)) throw new Error(`could not pick up ${species}`);
    }
  });

  writeFileSync(path.join(out, 'motion-manifest.json'), JSON.stringify({
    source: url, renderer: await host.page.evaluate(() => {
      const gl = window.__GAME.renderer.renderer.getContext();
      return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL
        ?? gl.RENDERER);
    }), dpr: 1, clips,
    errors: [...host.consoleErrors, ...peer.consoleErrors],
    authored: 'positions, fall trigger, inventory and fruit spawn/pickup',
    normalInput: 'worker-walk lateral movement and every game-rendered frame',
  }, null, 2));
} finally {
  if (host) await host.close().catch(() => {});
  if (server.proc) server.proc.kill();
}
