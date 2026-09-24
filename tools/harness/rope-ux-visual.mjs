// Full canvas + DOM evidence for the equipped Rope Gun at normal and ultrawide sizes.
import { withGame, ensureOut } from './driver.mjs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const sizes = process.argv.includes('--quick') ? [[1920, 1080]] : [[1920, 1080], [3436, 1270]];
for (const [width, height] of sizes) {
  await withGame(async (g) => {
    await g.call('director.reset', false);
    await g.call('characters.reset', false);
    const ground = await g.terrainHeight(-24, 22);
    await g.tp(-24, ground + 1.2, 22);
    await g.look(0, -0.25);
    await g.page.locator('#view').click({ position: { x: width / 2, y: height / 2 } });
    await g.call('tool.give', 'ropegun');
    await g.page.keyboard.press('Digit2');
    await g.wait(0.1);
    await g.page.mouse.click(width / 2, height / 2);
    await g.wait(0.4);
    await g.look(0.15, -0.25);
    await g.page.mouse.click(width / 2, height / 2);
    await g.wait(0.3);

    const count = (await g.state()).ropes.list.filter((r) => r.ak === 'player').length;
    const guide = await g.page.locator('.rope-guide').innerText();
    if (count !== 2 || !guide.includes('2/4')) {
      throw new Error(`expected two ropes and visible guide: count=${count}, guide=${guide}`);
    }
    const cdp = await g.ctx.newCDPSession(g.page);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(ensureOut('rope-ux'), `equipped-${width}x${height}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`${width}x${height}: ${file}`);
    await g.page.keyboard.press('KeyQ');
    await g.wait(0.1);
    const released = await g.page.locator('.rope-guide').innerText();
    if (!released.includes('1/4')) throw new Error(`Q did not release the newest rope: ${released}`);
    const errors = g.consoleErrors.filter((entry) =>
      entry.startsWith('error:') || entry.startsWith('pageerror:'));
    if (errors.length) throw new Error(errors.join('\n'));
  }, { width, height, headless: true, quiet: true, islandActivities: false, drawFrames: true });
}
