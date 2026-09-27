// Headless two-peer contact proof. Run against an isolated preview with RIPE_URL.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const url = process.env.RIPE_URL;
if (!url) throw new Error('Set RIPE_URL to an isolated worktree preview');
const out = path.resolve(process.env.RIPE_OUT || 'docs/evidence/worker-ground-contact');
mkdirSync(out, { recursive: true });
const report = { url, states: [], errors: [], input: 'synthetic movement into the real PlayerController; authored fall trigger' };
const browser = await chromium.launch({ headless: true,
  args: ['--disable-dev-shm-usage', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  // This harness uses synthetic movement and a detached camera. Never let a
  // page click request OS pointer lock or confine the user's real cursor.
  await context.addInitScript(() => {
    Element.prototype.requestPointerLock = () => {
      throw new Error('Pointer lock is forbidden in the worker contact harness');
    };
  });
  const open = async () => {
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(`${url}/?fresh=1&voxelPilot=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__RIPE_READY || window.__RIPE_ERROR,
      null, { timeout: 90_000 });
    const error = await page.evaluate(() => window.__RIPE_ERROR ?? null);
    if (error) throw new Error(error);
    return page;
  };
  const host = await open();
  const peer = await open();
  await host.bringToFront();
  await host.addStyleTag({ content: '.entry-hint { display: none !important; }' });
  await peer.setViewportSize({ width: 320, height: 180 });
  await peer.evaluate(() => window.__GAME.renderer.resize());
  const room = `ground-contact-${Date.now()}`;
  await host.evaluate(room => window.__RIPE.call('net.connect', room, 0), room);
  await peer.evaluate(room => window.__RIPE.call('net.connect', room, 1), room);
  await host.waitForFunction(() => window.__GAME.get('net').remotes.size === 1);
  await peer.evaluate(() => window.__RIPE.pause(true));

  const localState = () => peer.evaluate(() => {
    const g = window.__GAME, rag = g.get('ragdoll');
    const torso = rag.parts.find(part => part.name === 'torso')?.body;
    let visualMinimum = null;
    if (rag.active && rag.rig.root.visible) {
      const root = rag.rig.root, vertex = root.position.clone();
      root.updateMatrixWorld(true);
      root.traverse(object => {
        if (!object.isMesh) return;
        const positions = object.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          if (object.isSkinnedMesh) object.getVertexPosition(i, vertex);
          else vertex.fromBufferAttribute(positions, i);
          vertex.applyMatrix4(object.matrixWorld);
          const clearance = vertex.y - g.get('world').terrain.height(vertex.x, vertex.z);
          if (!visualMinimum || clearance < visualMinimum.clearance)
            visualMinimum = { clearance, at: vertex.toArray() };
        }
      });
    }
    if (visualMinimum) {
      const [x, y, z] = visualMinimum.at;
      const hit = g.physics.raycast(rag.rig.root.position.clone().set(x, y + 5, z),
        rag.rig.root.position.clone().set(0, -1, 0), 10, 0xffff0103);
      visualMinimum.physicsGround = hit?.point.y ?? null;
      visualMinimum.physicsClearance = hit ? y - hit.point.y : null;
    }
    return { state: g.player.state, controller: g.player.position.toArray(),
      grounded: g.player.grounded, ragdollTime: rag.timer, settledTime: rag.settled,
      torso: torso ? [torso.translation().x, torso.translation().y, torso.translation().z] : null,
      torsoSpeed: torso ? Math.hypot(...Object.values(torso.linvel())) : null,
      packet: rag.networkPose(), visualMinimum,
      ground: g.get('world').terrain.height(g.player.position.x, g.player.position.z) };
  });
  const remoteState = () => host.evaluate(() => {
    const g = window.__GAME, r = [...g.get('net').remotes.values()][0];
    const root = r.rig.root;
    root.updateMatrixWorld(true);
    const vertex = root.position.clone();
    const minima = { all: null, leftBoot: null, rightBoot: null };
    root.traverse(object => {
      if (!object.isMesh) return;
      const positions = object.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        if (object.isSkinnedMesh) object.getVertexPosition(i, vertex);
        else vertex.fromBufferAttribute(positions, i);
        vertex.applyMatrix4(object.matrixWorld);
        const clearance = vertex.y - g.get('world').terrain.height(vertex.x, vertex.z);
        const entry = { clearance, at: vertex.toArray(), object: object.name };
        if (!minima.all || clearance < minima.all.clearance) minima.all = entry;
        let key = null;
        for (let node = object; node && !key; node = node.parent) {
          if (node.name.startsWith('Boot_L')) key = 'leftBoot';
          else if (node.name.startsWith('Boot_R')) key = 'rightBoot';
        }
        if (key && (!minima[key] || clearance < minima[key].clearance)) minima[key] = entry;
      }
    });
    for (const minimum of Object.values(minima)) {
      if (!minimum) continue;
      const [x, y, z] = minimum.at;
      const hit = g.physics.raycast(root.position.clone().set(x, y + 5, z),
        root.position.clone().set(0, -1, 0), 10, 0xffff0103);
      minimum.physicsGround = hit?.point.y ?? null;
      minimum.physicsClearance = hit ? y - hit.point.y : null;
    }
    return { state: r.state, root: root.position.toArray(),
      poseTorso: r.ragdollPose?.torso.position.toArray() ?? null,
      poseParts: r.ragdollPose ? Object.keys(r.ragdollPose) : [],
      target: r.targetPos.toArray(), lastMoveAgo: performance.now() / 1000 - r.lastMoveAt,
      minima,
      meshNames: root.children.map(child => child.name) };
  });
  const capture = async (name) => {
    await host.bringToFront();
    await host.waitForTimeout(90);
    const local = await localState();
    if (local.torso && name.endsWith('falling')) await host.waitForFunction(([x, y, z]) => {
      const r = [...window.__GAME.get('net').remotes.values()][0];
      const t = r?.ragdollPose?.torso.position, root = r?.rig.root.position;
      return !!t && Math.hypot(t.x - x, t.y - y, t.z - z) < .15
        && Math.hypot(root.x - x, root.y - y, root.z - z) < .15;
    }, local.torso, { timeout: 15_000 });
    else if (local.torso) await host.waitForFunction(() => {
      const r = [...window.__GAME.get('net').remotes.values()][0];
      const t = r?.ragdollPose?.torso.position, root = r?.rig.root.position;
      return !!t && Math.hypot(root.x - t.x, root.y - t.y, root.z - t.z) < .08;
    }, null, { timeout: 20_000 });
    else await host.waitForFunction(([x, y, z]) => {
      const r = [...window.__GAME.get('net').remotes.values()][0];
      if (!r || r.state !== 'active') return false;
      return Math.hypot(r.pos.x - x, r.pos.y - y, r.pos.z - z) < .2;
    }, local.controller, { timeout: 15_000 });
    const remote = await remoteState();
    const target = local.torso ?? remote.root;
    await host.evaluate(([x, y, z]) => window.__RIPE.freeCam(
      x + 3.3, y + 1.8, z + 4.4, x, y - .15, z), target);
    await host.waitForTimeout(90);
    await host.screenshot({ path: path.join(out, `${name}.png`) });
    const drift = local.torso ? Math.hypot(...local.torso.map((n, i) => n - remote.root[i])) : null;
    report.states.push({ name, local, remote, drift });
    if (local.state === 'ragdoll') {
      assert.equal(remote.state, 'ragdoll', `${name}: remote state`);
      assert.equal(remote.poseParts.length, 6, `${name}: physical pose packet`);
      const poseDrift = Math.hypot(...remote.root.map((n, i) => n - remote.poseTorso[i]));
      assert.ok(poseDrift < .15, `${name}: remote rig diverged from received body pose`);
      if (name.endsWith('falling'))
        assert.ok(drift < .25, `${name}: physical torso drift ${drift.toFixed(3)} m`);
    }
    console.log(name, { state: remote.state, drift,
      clearance: remote.minima.all?.physicsClearance, settledTime: local.settledTime });
    if (name.endsWith('standing') || name.endsWith('walking') || name.endsWith('recovered')) {
      const limit = name.endsWith('standing') ? -.04 : -.06;
      assert.ok(remote.minima.leftBoot.physicsClearance > limit
        && remote.minima.rightBoot.physicsClearance > limit,
      `${name}: boot penetrates physics terrain`);
    }
    if (name.endsWith('settling')) {
      assert.ok(local.visualMinimum?.physicsClearance > -.06,
        `${name}: local worker sinks into physics terrain`);
      assert.ok(remote.minima.all.physicsClearance > -.06,
        `${name}: remote worker sinks into physics terrain`);
    }
    return { local, remote };
  };
  const place = async (x, z) => {
    await peer.evaluate(([x, z]) => {
      const y = window.__GAME.get('world').terrain.height(x, z);
      window.__RIPE.tp(x, y + .12, z);
      window.__RIPE.look(0, 0);
    }, [x, z]);
    await peer.evaluate(() => window.__RIPE.simulate(.32));
    const expected = await localState();
    await host.waitForFunction(([x, y, z]) => {
      const r = [...window.__GAME.get('net').remotes.values()][0];
      return !!r && r.state === 'active'
        && Math.hypot(r.pos.x - x, r.pos.y - y, r.pos.z - z) < .08;
    }, expected.controller, { timeout: 15_000 });
    await host.waitForTimeout(300);
  };

  await place(15, 40);
  await capture('flat-standing');
  const focused = process.env.RIPE_CASES === 'flat';
  const slope = await peer.evaluate(() => {
    const terrain = window.__GAME.get('world').terrain;
    let best = null;
    for (let x = 5; x <= 25; x += 2) for (let z = 32; z <= 48; z += 2) {
      const n = terrain.normal(x, z);
      const angle = Math.acos(n.y) * 180 / Math.PI;
      const y = terrain.height(x, z);
      if (y < 1.5 || angle < 11 || angle > 28) continue;
      if (!best || Math.abs(angle - 18) < Math.abs(best.angle - 18)) best = { x, z, angle };
    }
    return best;
  });
  assert.ok(slope, 'need walkable sloped ground in route area');
  report.slope = slope;
  if (!focused) {
    await peer.evaluate(() => window.__RIPE.input({ moveZ: 1 }));
    await peer.evaluate(() => window.__RIPE.simulate(.35));
    await capture('flat-walking');
    await peer.evaluate(() => window.__RIPE.clearInput());
    await place(slope.x, slope.z);
    await capture('slope-standing');
    await peer.evaluate(() => window.__RIPE.input({ moveZ: 1 }));
    await peer.evaluate(() => window.__RIPE.simulate(.3));
    await capture('slope-walking');
    await peer.evaluate(() => window.__RIPE.clearInput());
  }

  const cases = focused
    ? [['flat', [15, 40]]] : [['flat', [15, 40]], ['slope', [slope.x, slope.z]]];
  for (const [label, position] of cases) {
    await place(...position);
    await peer.evaluate(() => window.__RIPE.call('ragdoll.trigger', 18, 'contact-test'));
    await peer.evaluate(() => window.__RIPE.simulate(.12));
    await host.waitForFunction(() => [...window.__GAME.get('net').remotes.values()][0]?.state === 'ragdoll',
      null, { timeout: 10_000 });
    await capture(`${label}-falling`);
    await peer.evaluate(() => window.__RIPE.simulate(.68));
    await capture(`${label}-floor-contact`);
    let last = null;
    for (let i = 0; i < 24; i++) {
      last = await localState();
      if (last.state !== 'ragdoll' || last.settledTime > .06) break;
      await peer.evaluate(() => window.__RIPE.simulate(.10));
    }
    if (last.state === 'ragdoll') await capture(`${label}-settling`);
    else report.states.push({ name: `${label}-settling`, status: 'auto recovery before settled capture' });
    if (last.state === 'ragdoll') await peer.evaluate(() => window.__RIPE.simulate(3.6));
    await capture(`${label}-recovered`);
    assert.equal((await localState()).state, 'active', `${label}: recovered local state`);
  }
  assert.deepEqual(report.errors, [], 'no browser page errors');
  console.log('worker ground contact PASS', { slope, frames: report.states.length });
} finally {
  await browser.close();
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}
