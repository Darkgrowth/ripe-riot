// Focused hidden-browser proof of normal loading, co-op fall visibility and
// graceful diagnostic boot when the authored visual is unavailable.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { openGame, openSecondClient, sleep, startServer } from './driver.mjs';

const url = process.env.RIPE_URL;
if (!url || new URL(url).port === '5197') throw new Error('use the dedicated worktree server');
const server = await startServer();
let host;
try {
  host = await openGame({ headless: true, quiet: true,
    islandActivities: false, drawFrames: false });
  const client = await openSecondClient(host, { quiet: true,
    islandActivities: false, drawFrames: false });
  await client.page.evaluate(() => { window.__GAME.get('net').suit = 1; });
  const room = `worker-runtime-${Date.now()}`;
  await host.call('net.connect', room, 0);
  await client.call('net.connect', room, 1);
  await client.tp(15, (await client.terrainHeight(15, 40)) + .12, 40);
  await sleep(1200);
  const normal = await host.page.evaluate(() => {
    const r = [...window.__GAME.get('net').remotes.values()][0];
    return { source: r?.rig.source, visible: r?.rig.root.visible,
      body: r?.rig.body?.isSkinnedMesh, bones: r?.rig.body?.skeleton.bones.length,
      suitRgb: [...r.rig.body.material.map.image.data.slice(0, 3)] };
  });
  assert.deepEqual(normal, { source: 'glb', visible: true, body: true, bones: 17,
    suitRgb: [74, 134, 192] });
  await client.call('ragdoll.trigger', 18, 'worker-runtime');
  await sleep(320);
  const fallen = await host.page.evaluate(() => {
    const r = [...window.__GAME.get('net').remotes.values()][0];
    return { state: r?.state, source: r?.rig.source,
      visible: r?.rig.root.visible && r?.rig.body?.visible };
  });
  assert.deepEqual(fallen, { state: 'ragdoll', source: 'glb', visible: true });
  const headAnchorError = await client.page.evaluate(() => {
    const rag = window.__GAME.get('ragdoll');
    const t = rag.parts.find(p => p.name === 'head').body.translation();
    return Math.hypot(rag.anchor.position.x - t.x,
      rag.anchor.position.y - (t.y + .1), rag.anchor.position.z - t.z);
  });
  assert.ok(headAnchorError < 1e-5, `physical head anchor drift ${headAnchorError}`);
  await host.close();
  host = null;

  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${url}/?fresh=1&workerAsset=missing`);
    await page.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR,
      null, { timeout: 90_000 });
    const fallback = await page.evaluate(() => {
      const g = window.__GAME;
      const rag = g.get('ragdoll');
      g.debug.call('ragdoll.trigger', 18, 'missing-worker');
      return { ready: window.__RIPE_READY, source: rag.rig.source,
        visible: rag.rig.root.visible, body: rag.rig.body };
    });
    assert.deepEqual(fallback, { ready: true, source: 'fallback', visible: true, body: null });
    const workerWarning = await page.locator('#visual-asset-warning').textContent();
    assert.match(workerWarning, /worker.*visual.*missing/i);
    assert.equal(await page.locator('#visual-asset-warning').isVisible(), true);

    const missingHands = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await missingHands.route('**/models/worker-hands.glb', route =>
      route.fulfill({ status: 404, body: 'missing worker hands' }));
    await missingHands.goto(`${url}/?fresh=1`);
    await missingHands.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR,
      null, { timeout: 90_000 });
    const handFallback = await missingHands.evaluate(() => ({
      ready: window.__RIPE_READY === true,
      handsSource: window.__RIPE?.state().viewmodel?.handsSource,
      warning: document.querySelector('#visual-asset-warning')?.textContent ?? '',
    }));
    assert.equal(handFallback.ready, true, 'missing hand GLB must not abort gameplay boot');
    assert.equal(handFallback.handsSource, 'diagnostic');
    assert.match(handFallback.warning, /worker.*hands.*missing/i);
    assert.equal(await missingHands.locator('#visual-asset-warning').isVisible(), true);
    console.log('worker runtime: skinned remote, visible co-op fall, diagnostic boot PASS');
  } finally { await browser.close(); }
} finally {
  if (host) await host.close().catch(() => {});
  if (server.proc) server.proc.kill();
}
