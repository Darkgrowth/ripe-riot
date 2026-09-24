// Player-facing rope ownership: the line that will move or release must be
// identifiable, and Q must do what the visible carry/tool cue promises.
export const name = 'rope-ux';

export async function run(g, t) {
  await g.call('rope.clear');
  await g.call('tool.give', 'ropegun');
  await g.call('tool.select', 'ropegun');
  await g.look(0, -0.25);
  await g.wait(0.1);

  const guide = () => g.page.evaluate(() => {
    const el = document.querySelector('.rope-guide');
    return el && !el.hidden ? el.textContent : '';
  });
  const pressQ = async () => {
    await g.input({ dropPressed: true });
    await g.wait(0.05);
    await g.clearInput();
  };

  t.ok(/attach.*anchor.*reel.*release/i.test(await guide()),
    'equipped rope gun explains its four actions in the HUD');

  await g.call('tool.fire');
  await g.wait(0.4);
  await g.call('tool.fire');
  await g.wait(0.1);
  const before = (await g.state()).ropes.list;
  t.eq(before.length, 2, 'two player-fired ropes can coexist');
  t.ok(/2\s*\/\s*4/.test(await guide()), 'HUD counts the player-owned ropes');
  const latest = before.at(-1)?.id;
  const cameraClearance = await g.page.evaluate((ids) => {
    const scene = window.__GAME.renderer.scene;
    const camera = window.__GAME.renderer.camera;
    const point = camera.position.clone();
    return ids.map((id) => {
      const mesh = scene.getObjectByName(`Rope:${id}`);
      if (!mesh?.visible) return 0;
      const positions = mesh.geometry.getAttribute('position');
      let nearest = Infinity;
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i);
        mesh.localToWorld(point);
        nearest = Math.min(nearest, point.distanceTo(camera.position));
      }
      return nearest;
    });
  }, before.map((r) => r.id));
  t.ok(cameraClearance.every((distance) => distance > 0.55),
    'drawn rope stays clear of the near camera while physical tethers remain', cameraClearance);
  const marked = await g.page.evaluate((id) => {
    let material = '';
    window.__GAME.renderer.scene.traverse((o) => {
      if (o.name === `Rope:${id}`) material = o.material?.name ?? '';
    });
    return material;
  }, latest);
  t.ok(/selected/i.test(marked), 'newest rope is visually marked as the next target');

  await g.call('tool.select', 'hand');
  await g.wait(0.05);
  t.eq(await guide(), '', 'rope guide leaves when another tool is selected');
  await pressQ();
  t.eq((await g.state()).ropes.count, 2,
    'Q with another tool selected does not silently release a rope');

  await g.call('tool.select', 'ropegun');
  await pressQ();
  const after = (await g.state()).ropes.list;
  t.eq(after.length, 1, 'Q with the rope gun selected releases one rope');
  t.ok(!after.some((r) => r.id === latest), 'Q releases the newest rope');
  t.ok(/Rope released/i.test(await g.page.evaluate(() =>
    document.querySelector('.toasts')?.textContent ?? '')),
  'release confirms the result');

  const [x, y, z] = (await g.state()).player.pos;
  const apple = await g.call('fruit.spawn', 'apple', x + 0.9, y + 1.0, z - 0.9);
  await g.wait(0.2);
  t.ok(await g.call('pickup', apple), 'a fruit can be carried with a rope still attached');
  await g.idleFrames(1);
  t.eq(await guide(), '', 'carry instructions replace the rope guide while fruit is held');
  await pressQ();
  t.eq((await g.state()).interaction.carrying, null,
    'Q drops carried fruit even while the rope gun is selected');
  t.eq((await g.state()).ropes.count, 1,
    'dropping fruit leaves the existing rope attached');
  t.ok(/1\s*\/\s*4/.test(await guide()), 'rope guide returns after dropping fruit');

  await g.call('shop.open');
  await g.idleFrames(1);
  t.eq(await guide(), '', 'rope guide stays hidden while the shop owns input');
  await g.call('shop.close');
  await g.idleFrames(1);
  t.ok(/1\s*\/\s*4/.test(await guide()), 'rope guide returns when the shop closes');

  await g.call('rope.clear');
  await g.call('fruit.despawnAllFree');
}
