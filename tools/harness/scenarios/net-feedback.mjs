// Net outcomes: a fruit crossing the wind-up is not a miss if the active
// window catches it, while a real late crossing still costs recovery.
export const name = 'net-feedback';

export async function run(g, t) {
  await g.call('tool.give', 'net');
  await g.call('tool.select', 'net');
  const initial = await g.page.evaluate(() => {
    const net = window.__GAME.get('tools').toolOf('net');
    return { caught: net.caught, swings: net.swings, misses: net.misses,
      hintsLeft: net.hintsLeft };
  });
  await g.page.evaluate(() => {
    window.__NET_FEEDBACK_TOASTS = [];
    window.__GAME.bus.on('ui:toast', (e) => window.__NET_FEEDBACK_TOASTS.push(e.text));
  });
  const toastTexts = () => g.page.evaluate(() => [...window.__NET_FEEDBACK_TOASTS]);
  const clearToasts = () => g.page.evaluate(() => { window.__NET_FEEDBACK_TOASTS.length = 0; });
  const press = async () => {
    await g.call('tool.primary', true);
    await g.call('tool.primary', false);
  };

  const state = await g.state();
  await g.look(state.player.yaw, 1.15);
  await g.wait(0.2);
  const rest = await g.call('tool.debug', 'net');
  const [x, y, z] = rest.hoop;
  const G = 22;
  const lead = (rest.window[0] + rest.window[1]) / 2;
  const eta = (above, speed) =>
    (-speed + Math.sqrt(speed * speed + 2 * G * Math.max(0, above))) / G;

  // Normal timed swing. The fruit passes close to the hoop in wind-up and
  // should finish with a single, successful outcome.
  const apple = await g.call('fruit.spawn', 'apple', x, y + 9, z);
  let pressed = false;
  for (let i = 0; i < 60 && !pressed; i++) {
    await g.wait(0.05);
    const f = await g.call('fruit.info', apple);
    if (!f) break;
    if (eta(f.pos[1] - y, Math.max(1, f.speed)) <= lead + 0.02) {
      await press();
      pressed = true;
    }
  }
  await g.wait(0.6);
  const caught = await g.call('tool.debug', 'net');
  t.ok(pressed, 'a timed swing was made');
  t.eq((await g.state()).interaction.basket, 1, 'the fruit reached the basket');
  t.eq(caught.caught, 1, 'the swing recorded one catch');
  t.eq(caught.misses, 0, 'the successful swing recorded no miss');
  t.ok(!(await toastTexts()).includes('MISSED'), 'the successful swing showed no MISSED cue');

  // A genuine miss in recovery retains the timing cue and longer recovery.
  await g.call('basket.clear');
  await g.call('fruit.despawnAllFree');
  await g.wait(0.7);
  await clearToasts();
  const late = await g.call('fruit.spawn', 'apple', x, y + 9, z);
  for (let i = 0; i < 60; i++) {
    await g.wait(0.05);
    const f = await g.call('fruit.info', late);
    if (!f) break;
    if (f.pos[1] - y <= 6.2) { await press(); break; }
  }
  await g.wait(0.8);
  const missed = await g.call('tool.debug', 'net');
  t.eq(missed.misses, 1, 'an early swing followed by a crossing still misses');
  t.ok((await toastTexts()).includes('MISSED'), 'the real miss shows timing advice');

  // Deterministic boundary fixture for the exact old contradiction: mark a
  // fast crossing in the dead start, then catch that very fruit in this
  // swing's active slice. No time or authority gates are changed by setup.
  await g.call('fruit.despawnAllFree');
  await g.wait(0.7);
  await clearToasts();
  const windupId = await g.call('fruit.spawn', 'apple', x, y, z);
  const windup = await g.page.evaluate((id) => {
    const game = window.__GAME;
    const net = game.get('tools').toolOf('net');
    const fruit = game.get('fruit').get(id);
    const placeFruit = () => {
      net.placeHoop(net.hoop);
      fruit.position.copy(net.hoop);
      fruit.body?.setTranslation(fruit.position, true);
      fruit.body?.setLinvel({ x: 0, y: 8, z: 0 }, true);
    };
    net.beginSwing();
    net.phaseT = 0.03;
    placeFruit();
    net.checkMiss();
    const provisional = net.earlyMissCandidate && !net.missedThisSwing;
    net.phaseT = 0.17;
    placeFruit();
    net.sweep();
    net.endSwing();
    return { provisional, caught: net.caught, misses: net.misses, status: net.status() };
  }, windupId);
  t.ok(windup.provisional, 'dead-start crossing waits for the active window');
  t.eq(windup.caught, 2, 'the same swing then catches the fruit');
  t.eq(windup.misses, 1, 'the caught crossing does not add a miss');
  t.ok(windup.status !== 'miss', 'the net does not enter miss recovery after that catch');
  t.ok(!(await toastTexts()).includes('MISSED'), 'the caught crossing shows no miss toast');

  // Controlled refusal fixture: pickup failure must not emit a catch cue or
  // increment catch telemetry. This does not alter the acceptance playthrough.
  await g.call('fruit.despawnAllFree');
  await g.wait(0.7);
  await clearToasts();
  const denied = await g.call('fruit.spawn', 'apple', x, y, z);
  const before = (await g.call('tool.debug', 'net')).caught;
  const calls = await g.page.evaluate((id) => {
    const game = window.__GAME;
    const net = game.get('tools').toolOf('net');
    const interaction = game.get('interaction');
    const fruit = game.get('fruit').get(id);
    const original = interaction.pickUp;
    let attempts = 0;
    try {
      net.phase = 'swing';
      net.phaseT = 0.17;
      net.placeHoop(net.hoop);
      fruit.position.copy(net.hoop);
      fruit.body?.setTranslation(fruit.position, true);
      fruit.body?.setLinvel({ x: 0, y: 8, z: 0 }, true);
      interaction.pickUp = () => { attempts++; return false; };
      net.sweep();
    } finally {
      interaction.pickUp = original;
    }
    return attempts;
  }, denied);
  t.gt(calls, 0, 'the refused fruit entered the net sweep');
  t.eq((await g.call('tool.debug', 'net')).caught, before, 'a refused pickup is not counted as caught');
  t.ok(!(await toastTexts()).includes('CAUGHT'), 'a refused pickup shows no CAUGHT cue');

  // The toast for a predicted client catch belongs to the host's answer.
  // A denied prediction is silent (the interaction system supplies its own
  // refusal message), while a confirmed prediction celebrates exactly once.
  await clearToasts();
  const results = await g.page.evaluate(() => {
    const game = window.__GAME;
    const net = game.get('tools').toolOf('net');
    net.caught++; // mirror a locally predicted pickup before its denial
    net.pendingCatch.set(900001, { name: 'Apple', speed: 8 });
    game.bus.emit('net:pickResult', { fruitId: 900001, ok: false });
    const deniedTexts = [...window.__NET_FEEDBACK_TOASTS];
    net.pendingCatch.set(900002, { name: 'Apple', speed: 8 });
    const beforeAck = [...window.__NET_FEEDBACK_TOASTS];
    game.bus.emit('net:pickResult', { fruitId: 900002, ok: true });
    game.bus.emit('net:pickResult', { fruitId: 900002, ok: true });
    return { deniedTexts, beforeAck, afterAck: [...window.__NET_FEEDBACK_TOASTS] };
  });
  t.ok(!results.deniedTexts.includes('CAUGHT'), 'host denial does not confirm a predicted catch');
  t.ok(!results.beforeAck.includes('CAUGHT'), 'predicted catch waits for the host result');
  t.eq(results.afterAck.filter(x => x === 'CAUGHT').length, 1,
    'one host approval gives one CAUGHT cue');

  // The scenario runner reuses one Game. Its generic reset restores owned
  // tools but does not recreate their debug counters, so leave the net as it
  // was for the subsequent tools scenario.
  await g.call('tool.select', 'hand');
  await g.page.evaluate((start) => {
    const net = window.__GAME.get('tools').toolOf('net');
    net.caught = start.caught;
    net.swings = start.swings;
    net.misses = start.misses;
    net.hintsLeft = start.hintsLeft;
    net.phase = 'ready';
    net.phaseT = 0;
    net.swingCaught = 0;
    net.missedThisSwing = false;
    net.earlyMissCandidate = false;
    net.pendingCatch.clear();
  }, initial);
}
