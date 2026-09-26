// Matched player-art fixture and evidence checker. Capture mode is added after
// the expected frame contract has been watched failing on the old branch.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGame, openSecondClient, sleep, startServer } from './driver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/evidence/connected-worker');
const FIXTURES = [
  ['remote-front', 1920, 1080],
  ['remote-side', 1920, 1080],
  ['remote-rear', 1920, 1080],
  ['remote-walk', 1920, 1080],
  ['ragdoll-early', 1920, 1080],
  ['ragdoll-mid', 1920, 1080],
  ['mallet', 1920, 1080],
  ['aircannon', 1920, 1080],
  ['carry-small', 1920, 1080],
  ['carry-large', 1920, 1080],
  ['ragdoll-mid-uw', 3434, 1270],
  ['mallet-uw', 3434, 1270],
  ['carry-large-uw', 3434, 1270],
];
const EXTRA_AFTER = [
  ['basket', 1920, 1080],
  ['basket-uw', 3434, 1270],
  ['aircannon-uw', 3434, 1270],
  ['carry-small-uw', 3434, 1270],
  ['remote-blue', 1920, 1080],
];

function checkFixtures(stage) {
  const dir = path.join(EVIDENCE, stage);
  const manifestPath = path.join(dir, 'manifest.json');
  const problems = [];
  let manifest = null;
  if (!existsSync(manifestPath)) problems.push(`${stage}: missing manifest.json`);
  else {
    try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
    catch (e) { problems.push(`${stage}: invalid manifest.json: ${e.message}`); }
  }
  const fixtures = stage === 'after' ? [...FIXTURES, ...EXTRA_AFTER] : FIXTURES;
  for (const [id, width, height] of fixtures) {
    const file = path.join(dir, `${id}.png`);
    const meta = manifest?.frames?.find((f) => f.id === id);
    if (!meta) problems.push(`${stage}: missing metadata for ${id}`);
    else {
      if (meta.viewport?.[0] !== width || meta.viewport?.[1] !== height)
        problems.push(`${stage}: wrong viewport metadata for ${id}`);
      if (!meta.camera || !meta.pose || !Array.isArray(meta.errors))
        problems.push(`${stage}: incomplete camera, pose or error metadata for ${id}`);
    }
    if (!existsSync(file)) { problems.push(`${stage}: missing ${id}.png`); continue; }
    const png = readFileSync(file);
    if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      || png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height)
      problems.push(`${stage}: invalid image size for ${id}`);
  }
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    process.exitCode = 1;
  } else console.log(`${stage}: ${fixtures.length}/${fixtures.length} matched frames with valid metadata`);
}

async function capture(stage) {
  const url = process.env.RIPE_URL;
  if (!url || new URL(url).port === '5197')
    throw new Error('Set RIPE_URL to this worktree\'s dedicated preview port, never the active B preview');
  const server = await startServer();
  const dir = path.join(EVIDENCE, stage);
  mkdirSync(dir, { recursive: true });
  let host;
  const frames = [];
  try {
    host = await openGame({ width: 1920, height: 1080, headless: true,
      quiet: true, islandActivities: false, drawFrames: false });
    const client = await openSecondClient(host, { quiet: true,
      islandActivities: false, drawFrames: false });
    await client.page.setViewportSize({ width: 320, height: 180 });
    const room = `worker-review-${Date.now()}`;
    await host.call('net.connect', room, 0);
    // The incumbent must be established before a second fresh page joins;
    // otherwise the ID tie-break can elect the capture page as a client and
    // a debug-spawned fruit will be removed by the real host's next snapshot.
    await sleep(900);
    await client.call('net.connect', room, 1);
    await host.page.waitForFunction(() => window.__GAME.get('net').remotes.size > 0,
      null, { timeout: 15_000 });
    if (!await host.call('net.isHost')) throw new Error('capture page is not the co-op host');
    let blue = null;

    // Open sand between the dock and orchard. The orchard enemy otherwise
    // occludes the worker and invalidates the silhouette comparison.
    const cx = 15, cz = 40;
    const cy = (await client.terrainHeight(cx, cz)) + 0.12;
    await client.tp(cx, cy, cz);
    await client.look(0, 0);
    await sleep(1800);

    const save = async (id, camera, pose) => {
      await host.idleFrames(2);
      await host.renderFrame();
      const source = await host.shot(id, `connected-worker-${stage}`);
      copyFileSync(source, path.join(dir, `${id}.png`));
      const actual = await host.page.evaluate(() => ({
        viewport: [document.getElementById('view').width, document.getElementById('view').height],
        dpr: window.devicePixelRatio,
        cameraPosition: window.__GAME.renderer.camera.position.toArray(),
        drawCalls: window.__GAME.renderer.renderer.info.render.calls,
        triangles: window.__GAME.renderer.renderer.info.render.triangles,
        interaction: window.__RIPE.state().interaction,
        viewmodel: window.__RIPE.state().viewmodel,
        frame: window.__RIPE.state().profile,
        elapsed: window.__RIPE.state().elapsed,
      }));
      frames.push({ id, viewport: actual.viewport, camera: {
        ...camera, position: actual.cameraPosition }, pose,
        dpr: actual.dpr, elapsed: actual.elapsed, frame: actual.frame,
        drawCalls: actual.drawCalls, triangles: actual.triangles,
        interaction: actual.interaction, viewmodel: actual.viewmodel,
        errors: [...host.consoleErrors, ...client.consoleErrors,
          ...(blue?.consoleErrors ?? [])] });
      if (id.startsWith('carry-') && (!actual.interaction?.carrying
        || !actual.viewmodel?.carryShown || actual.viewmodel?.toolShown))
        throw new Error(`${id} is not a carry frame: ${JSON.stringify({
          interaction: actual.interaction, viewmodel: actual.viewmodel,
        })}`);
      console.log(`${stage} ${id} ${actual.viewport.join('x')}`);
    };

    const place = async (id, x, z, label, distance = 0) => {
      const ground = await host.terrainHeight(x, z);
      await host.tp(x, ground + 0.12, z);
      const dx = cx - x, dz = cz - z;
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(cy + 1.05 - (ground + 1.75), Math.hypot(dx, dz));
      await host.look(yaw, pitch);
      await sleep(distance || 420);
      await save(id, { mode: 'player', x, z, yaw, pitch,
        target: [cx, cy + 1.05, cz], note: 'tool hidden for silhouette' }, label);
    };

    await host.call('viewmodel.show', false);
    await place('remote-front', cx, cz + 3.2, 'remote idle facing camera');
    await place('remote-side', cx + 3.2, cz, 'remote idle profile');
    await place('remote-rear', cx, cz - 3.2, 'remote idle from behind');
    await client.input({ moveZ: 1 });
    await sleep(350);
    await place('remote-walk', cx + 4.2, cz + 4.2, 'remote moving under normal input', 100);
    await client.clearInput();

    await host.tp(cx + 1.0, (await host.terrainHeight(cx + 1.0, cz + 6)) + 0.12, cz + 6);
    await host.look(0, -0.12);
    await host.pause(true);
    await host.call('ragdoll.trigger', 18, 'worker-review');
    await host.simulate(0.18);
    await save('ragdoll-early', { mode: 'ragdoll chase', seconds: 0.18 }, 'debug-triggered fall');
    await host.simulate(0.45);
    await save('ragdoll-mid', { mode: 'ragdoll chase', seconds: 0.63 }, 'debug-triggered fall');
    await host.call('ragdoll.recover');
    await host.pause(false);
    await sleep(250);

    await host.call('viewmodel.show', true);
    await host.look(0.6, -0.05);
    await host.call('tool.select', 'hand');
    await sleep(450);
    await save('mallet', { mode: 'player', yaw: 0.6, pitch: -0.05 }, 'starter mallet in hands');
    await host.call('tool.give', 'aircannon');
    await host.call('tool.select', 'aircannon');
    await sleep(700);
    await save('aircannon', { mode: 'player', yaw: 0.6, pitch: -0.05 }, 'Air Cannon grip');
    await host.call('tool.select', 'basket');
    await sleep(550);
    await save('basket', { mode: 'player', yaw: 0.6, pitch: -0.05 }, 'basket grip');
    await host.call('tool.select', 'aircannon');
    await sleep(550);

    const carry = async (id, species) => {
      const p = (await host.state()).player.pos;
      const fruitId = await host.call('fruit.spawn', species, p[0], p[1] + 1.2,
        p[2] - 1.2, null, 0.5);
      if (!await host.call('pickup', fruitId)) throw new Error(`pickup failed: ${species}`);
      await sleep(650);
      await save(id, { mode: 'player', yaw: 0.6, pitch: -0.05 }, `${species} carry grip`);
    };
    await carry('carry-small', 'apple');
    await host.call('drop');
    await host.call('fruit.despawnAllFree');
    await carry('carry-large', 'watermelon');

    await host.page.setViewportSize({ width: 3434, height: 1270 });
    await host.page.evaluate(() => window.__GAME.renderer.resize());
    await sleep(450);
    await save('carry-large-uw', { mode: 'player', yaw: 0.6, pitch: -0.05 },
      'watermelon carry grip, ultrawide');
    await host.call('drop');
    await host.call('fruit.despawnAllFree');
    await carry('carry-small-uw', 'apple');
    await host.call('drop');
    await host.call('fruit.despawnAllFree');
    await host.call('tool.select', 'hand');
    await sleep(550);
    await save('mallet-uw', { mode: 'player', yaw: 0.6, pitch: -0.05 },
      'starter mallet, ultrawide');
    await host.call('tool.select', 'aircannon');
    await sleep(550);
    await save('aircannon-uw', { mode: 'player', yaw: 0.6, pitch: -0.05 },
      'Air Cannon grip, ultrawide');
    await host.call('tool.select', 'basket');
    await sleep(550);
    await save('basket-uw', { mode: 'player', yaw: 0.6, pitch: -0.05 },
      'basket grip, ultrawide');
    await host.pause(true);
    await host.call('ragdoll.trigger', 18, 'worker-review-ultrawide');
    await host.simulate(0.63);
    await save('ragdoll-mid-uw', { mode: 'ragdoll chase', seconds: 0.63 },
      'debug-triggered fall, ultrawide');

    await host.call('ragdoll.recover');
    await host.pause(false);
    await host.page.setViewportSize({ width: 1920, height: 1080 });
    await host.page.evaluate(() => window.__GAME.renderer.resize());
    await host.call('viewmodel.show', false);
    const farX = cx + 15;
    await client.tp(farX, (await client.terrainHeight(farX, cz)) + .12, cz);
    blue = await openSecondClient(host, { quiet: true,
      islandActivities: false, drawFrames: false });
    await blue.page.setViewportSize({ width: 320, height: 180 });
    await blue.page.evaluate(() => { window.__GAME.get('net').suit = 1; });
    await blue.call('net.connect', room, 2);
    await host.page.waitForFunction(() => window.__GAME.get('net').remotes.size > 1,
      null, { timeout: 15_000 });
    await blue.tp(cx, (await blue.terrainHeight(cx, cz)) + .12, cz);
    await host.tp(cx, (await host.terrainHeight(cx, cz + 3.2)) + .12, cz + 3.2);
    await host.look(0, -.2);
    await sleep(1400);
    await save('remote-blue', { mode: 'player', x: cx, z: cz + 3.2,
      note: 'third peer authored as Dockworker Blue' }, 'blue co-op suit preset');

    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      stage, source: url, renderer: await host.page.evaluate(() => {
        const gl = window.__GAME.renderer.renderer.getContext();
        return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL
          ?? gl.RENDERER);
      }), frames,
    }, null, 2));
    checkFixtures(stage);
    if (process.exitCode) throw new Error(`${stage} fixture validation failed`);
  } finally {
    if (host) await host.close().catch(() => {});
    if (server.proc) server.proc.kill();
  }
}

if (process.argv.includes('--check-fixtures')) {
  checkFixtures('before');
  if (existsSync(path.join(EVIDENCE, 'after/manifest.json'))) checkFixtures('after');
}
else if (process.argv.includes('--before')) await capture('before');
else if (process.argv.includes('--after')) await capture('after');
else throw new Error('use --check-fixtures, --before or --after');
