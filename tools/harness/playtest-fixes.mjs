// Focused regression and evidence capture for the three issues reported in the
// September 2026 ultrawide playtest: local ragdoll camera occlusion, prompt
// ownership, and the shop modal/input path.

import { withGame, ensureOut } from './driver.mjs';
import { contactSheet } from './sheet.mjs';
import path from 'node:path';

const phase = process.argv.includes('--before') ? 'before' : 'after';
const captureOnly = process.argv.includes('--capture-only');
let failures = 0;
const shots = [];

function check(ok, label, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
}

async function fullShot(g, name, label, note = '') {
  const file = path.join(ensureOut(`playtest-fixes/${phase}`), `${name}.png`);
  await g.page.screenshot({ path: file, animations: 'disabled' });
  shots.push({ file, label, note });
  return file;
}

async function promptText(g) {
  return g.page.locator('.prompt').textContent().then((s) => s?.replace(/\s+/g, ' ').trim() ?? '');
}

async function layout(g) {
  return g.page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { x: r.x, y: r.y, width: r.width, height: r.height, font: parseFloat(cs.fontSize) };
    };
    return {
      card: rect('.panel .card'), item: rect('.shop-item .name'), next: rect('.shop-next strong'),
      prompt: rect('.prompt'), viewport: [innerWidth, innerHeight],
    };
  });
}

async function contextPrevented(g, selector) {
  return g.page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, selector);
}

async function runSize(width, height) {
  await withGame(async (g) => {
    console.log(`\n--- ${width}x${height} / ${phase} ---`);
    const world = await g.call('world.info');
    const legendary = await g.call('legendary.info');

    // Prompt collision: a real attached fruit under the crosshair while the
    // legendary preparation hint is also in range.
    const home = legendary.home;
    const fruit = await g.call('fruit.nearest', home[0], home[1], home[2], undefined, 'attached');
    const standZ = fruit.pos[2] + 2.4;
    const y = await g.terrainHeight(fruit.pos[0], standZ);
    await g.tp(fruit.pos[0], y + 0.1, standZ);
    const aimAtFruit = async () => {
      const st = await g.state();
      const dx = fruit.pos[0] - st.player.pos[0];
      const dy = fruit.pos[1] - (st.player.pos[1] + st.player.height - 0.19);
      const dz = fruit.pos[2] - st.player.pos[2];
      const flat = Math.hypot(dx, dz);
      await g.look(Math.atan2(-dx, -dz), Math.atan2(dy, flat));
      await g.wait(0.35);
    };
    await aimAtFruit();
    const promptWithFruit = await promptText(g);
    const interactionPrompt = await g.page.evaluate(() => window.__GAME.get('interaction').promptText ?? '');
    console.log('  prompt collision:', { interactionPrompt, promptWithFruit });
    if (!captureOnly) check(/pick up|shove|basket|spiky/i.test(promptWithFruit),
      'nearby fruit prompt wins legendary preparation advice', promptWithFruit);
    await fullShot(g, `${width}x${height}-fruit-prompt`, `${width}×${height} · fruit prompt`, promptWithFruit || 'no prompt');

    // Incapacitation and recovery: collect a short sequence, not a settled pose.
    await g.pause(true);
    await g.call('ragdoll.trigger', 18, 'playtest-fix');
    await g.simulate(0.18);
    const earlyClearance = await g.page.evaluate(() => {
      const G = window.__GAME; const rag = G.get('ragdoll'); const cam = G.renderer.camera.position;
      return Math.min(...rag.parts.map((p) => cam.distanceTo(p.mesh.position)));
    });
    const ragEarlyPrompt = await promptText(g);
    const early = await fullShot(g, `${width}x${height}-ragdoll-early`, `${width}×${height} · ragdoll 0.18 s`, ragEarlyPrompt || 'prompt clear');
    await g.simulate(0.45);
    const midClearance = await g.page.evaluate(() => {
      const G = window.__GAME; const rag = G.get('ragdoll'); const cam = G.renderer.camera.position;
      return Math.min(...rag.parts.map((p) => cam.distanceTo(p.mesh.position)));
    });
    const ragMidPrompt = await promptText(g);
    await fullShot(g, `${width}x${height}-ragdoll-mid`, `${width}×${height} · ragdoll 0.63 s`, ragMidPrompt || 'prompt clear');
    if (!captureOnly) check(!ragEarlyPrompt && !ragMidPrompt, 'action/context prompts are hidden while ragdolled', `${ragEarlyPrompt} | ${ragMidPrompt}`);
    if (!captureOnly) check(earlyClearance > 0.62 && midClearance > 0.62,
      'ragdoll camera remains outside every local body part', `${earlyClearance.toFixed(2)} m / ${midClearance.toFixed(2)} m`);
    await g.call('ragdoll.recover');
    await g.simulate(0.25);
    await g.pause(false);
    await g.tp(fruit.pos[0], y + 0.1, standZ);
    await aimAtFruit();
    const recoveryPrompt = await promptText(g);
    await fullShot(g, `${width}x${height}-recovered`, `${width}×${height} · recovered`, recoveryPrompt || 'prompt clear');
    const state = await g.state();
    if (!captureOnly) check(state.player.state === 'active', 'ragdoll recovery returns the player to active state', state.player.state);
    if (!captureOnly) check(/pick up|shove|spiky/i.test(recoveryPrompt), 'the aimed fruit prompt returns after recovery', recoveryPrompt);
    await g.pause(true);
    await g.simulate(4.7);
    await g.pause(false);
    const lookingAway = (await g.state()).player.yaw + Math.PI;
    await g.look(lookingAway, 0);
    await g.wait(0.25);
    const expiredHint = await promptText(g);
    if (!captureOnly) check(!/Rope Gun/i.test(expiredHint), 'preparation advice expires instead of following the player', expiredHint);
    await g.call('tool.give', 'ropegun');
    await g.wait(0.4);
    await aimAtFruit();
    const withRopeGun = await promptText(g);
    if (!captureOnly) check(/pick up|shove|spiky/i.test(withRopeGun), 'nearby fruit still wins after acquiring the Rope Gun', withRopeGun);
    void early;

    // Normal shop path: stand at the physical counter, press E, then inspect
    // the real modal and close it with Escape.
    const counter = world.shopCounter;
    await g.tp(counter[0] + 1.0, counter[1] + 0.1, counter[2] + 1.0);
    await g.wait(0.2);
    await g.page.click('#view', { position: { x: 40, y: 40 } });
    await g.wait(0.15);
    const lockedBeforeShop = await g.page.evaluate(() => document.pointerLockElement === document.getElementById('view'));
    if (!captureOnly) check(lockedBeforeShop, 'normal gameplay path begins with canvas pointer lock');
    await g.page.keyboard.press('KeyE');
    await g.wait(0.25);
    let st = await g.state();
    check(st.shop.open === true, 'E opens the shop through the normal input path');
    const shopLayout = await layout(g);
    console.log('  shop layout:', shopLayout);
    const modalPrompt = await promptText(g);
    if (!captureOnly) check(!modalPrompt, 'the shop modal owns the centre prompt', modalPrompt);
    if (!captureOnly) {
      check((shopLayout.item?.font ?? 0) >= 15, 'shop card type remains readable', String(shopLayout.item?.font));
      check((shopLayout.card?.width ?? width) < width * 0.72, 'shop stays bounded instead of stretching edge-to-edge', String(shopLayout.card?.width));
      check((shopLayout.next?.font ?? 0) >= 14, 'Next purchase line is readable', String(shopLayout.next?.font));
    }
    const modalState = await g.page.evaluate(() => ({
      focused: document.activeElement?.classList.contains('shop-panel') ?? false,
      role: document.activeElement?.getAttribute('role') ?? '',
      input: window.__GAME.input.enabled,
    }));
    if (!captureOnly) {
      check(modalState.focused && modalState.role === 'dialog', 'shop takes accessible modal focus', JSON.stringify(modalState));
      check(modalState.input === false, 'shop exclusively owns input while open');
    }
    await g.page.keyboard.press('KeyB');
    await g.wait(0.15);
    const ownership = await g.state();
    if (!captureOnly) check(ownership.shop.open && !ownership.book.open, 'Harvest Book cannot stack over the shop modal');
    const leakedButtons = await g.page.evaluate(() => {
      document.querySelector('.shop-item')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      return window.__GAME.input.buttonPresses.size;
    });
    if (!captureOnly) check(leakedButtons === 0, 'shop clicks do not create gameplay button edges', String(leakedButtons));
    const panelContext = await contextPrevented(g, '.panel');
    const canvasContext = await contextPrevented(g, '#view');
    const browserContext = await contextPrevented(g, '.audio-settings summary');
    console.log('  contextmenu prevented:', { panelContext, canvasContext, browserContext });
    if (!captureOnly) {
      check(panelContext === true, 'shop surface suppresses the native context menu');
      check(canvasContext === true, 'game canvas suppresses the native context menu');
      check(browserContext === false, 'unowned browser control keeps its context menu');
    }
    await fullShot(g, `${width}x${height}-shop`, `${width}×${height} · shop`, `card ${Math.round(shopLayout.card?.width ?? 0)} px`);

    await g.page.keyboard.press('Escape');
    await g.wait(0.2);
    st = await g.state();
    check(st.shop.open === false, 'Escape closes the shop');
    check(await g.page.evaluate(() => window.__GAME.input.enabled), 'game input is restored after closing');
    const locked = await g.page.evaluate(() => document.pointerLockElement === document.getElementById('view'));
    if (!captureOnly) check(locked, 'Escape restores the pointer lock owned before the modal');

    if (!captureOnly) {
      // The reported location, exercised through the ordinary movement input:
      // sprint off the route shoulder toward the King Melon ravine.
      const slopeX = 8, slopeZ = -50;
      const slopeY = await g.terrainHeight(slopeX, slopeZ);
      const beforeFalls = (await g.state()).ragdoll.knockdowns;
      await g.tp(slopeX, slopeY + 0.1, slopeZ);
      const dx = 8 - slopeX;
      const dz = -66 - slopeZ;
      await g.look(Math.atan2(-dx, -dz), 0);
      await g.input({ moveZ: 1, sprint: true, jump: true, jumpPressed: true });
      await g.pause(true);
      await g.simulate(0.18);
      await g.input({ moveZ: 1, sprint: true, jump: false });
      await g.simulate(6);
      await g.clearInput();
      await g.pause(false);
      const afterFalls = (await g.state()).ragdoll.knockdowns;
      check(afterFalls > beforeFalls, 'normal sprint-jump path reproduces a ravine slope knockdown', `${beforeFalls} -> ${afterFalls}`);
      await g.call('ragdoll.recover');
    }

    const errors = g.consoleErrors.filter((e) => !/favicon|GPU stall due to ReadPixels/i.test(e));
    check(errors.length === 0, 'no fresh console warnings or errors', errors.join(' | '));
  }, { headless: true, width, height, quiet: true });
}

for (const [w, h] of [[1920, 1080], [3436, 1270]]) await runSize(w, h);

const sheet = path.join(ensureOut('playtest-fixes'), `${phase}-evidence.png`);
await contactSheet(shots, sheet, { cols: 2, thumbW: 720, title: `RIPE RIOT · playtest fixes · ${phase}` });
console.log(`\nevidence: ${sheet}`);
console.log(failures ? `${failures} CHECK(S) FAILED` : 'OK');
process.exit(failures ? 1 : 0);
