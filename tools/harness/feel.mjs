// Feel probe. Plays the early loop through the real first-person input path
// and prints NUMBERS for the things that decide whether an interaction feels
// good: whether a pick registers on the step the key goes down, how far a held
// fruit trails the hands, what each species leaves your hand at, how much the
// camera reacts to being hit, and where a Puff Melon actually goes.
//
// Not a pass/fail suite — run-tests.mjs owns that. This is the instrument you
// read before and after a tuning change.
//
//   node tools/harness/feel.mjs            # everything
//   node tools/harness/feel.mjs throw hit  # only matching sections

import { withGame } from './driver.mjs';

const filter = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const want = (name) => !filter.length || filter.some((k) => name.includes(k));

const n = (v, d = 2) => (typeof v === 'number' ? v.toFixed(d) : String(v));
const row = (label, ...cells) => console.log(`  ${String(label).padEnd(24)}${cells.join('   ')}`);
const head = (t) => console.log(`\n--- ${t} ---`);

await withGame(async (g) => {
  await g.pause(true);
  const sim = (s) => g.simulate(s);

  const standAt = async (x, z, yaw = 0, lift = 0.4) => {
    const h = await g.terrainHeight(x, z);
    await g.tp(x, h + lift, z);
    await g.look(yaw, 0);
    await sim(0.35);
  };
  const faceTo = async (x, y, z) => {
    const s = await g.state();
    const [px, py, pz] = s.player.pos;
    const dx = x - px, dy = y - (py + 1.6), dz = z - pz;
    await g.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  };
  const reset = async () => {
    await g.clearInput();
    await g.call('ragdoll.recover');
    await g.call('drop');
    await g.call('fruit.despawnAllFree');
    await g.call('basket.clear');
    await g.call('rope.clear');
    await g.attachCam();
    await standAt(-24, 22, 0);
    await g.call('fruit.despawnAllFree');
    await sim(0.2);
  };
  /** Peak camera shake amplitude over the next `secs` of simulated time. */
  const shakePeak = (secs) => g.page.evaluate(async (s) => {
    const cam = window.__GAME.playerCamera;
    let peak = 0;
    for (let i = 0; i < Math.round(s * 60); i++) {
      await window.__RIPE.advance(1);
      let amp = 0;
      for (const sh of cam.shakes ?? []) amp += sh.amp * (sh.left / sh.total);
      amp += Math.abs(cam.recoil?.y ?? 0) + Math.abs(cam.recoil?.x ?? 0);
      if (amp > peak) peak = amp;
    }
    return peak;
  }, secs);

  /**
   * Find an apple on an orchard tree and stand where a player would stand to
   * pick it: 1.5 m out from the trunk on the fruit's own side, looking at it.
   * A fixed offset puts you inside the trunk collider half the time.
   */
  const goPickApple = async () => {
    const tree = await g.call('plant.nearest', -24, 8, 22, 'appleTree', true);
    if (!tree) return null;
    const apple = await g.call('fruit.nearest', tree.pos[0], tree.pos[1] + 3, tree.pos[2],
      'apple', 'attached');
    if (!apple) return null;
    const dx = apple.pos[0] - tree.pos[0], dz = apple.pos[2] - tree.pos[2];
    const d = Math.hypot(dx, dz) || 1;
    await standAt(apple.pos[0] + (dx / d) * 1.5, apple.pos[2] + (dz / d) * 1.5);
    await faceTo(...apple.pos);
    await sim(0.3);
    return apple;
  };

  // ------------------------------------------------------ hand pick latency
  if (want('pick')) {
    head('hand picking: does the action land on the step the button goes down');
    await reset();
    const apple = await goPickApple();
    if (!apple) row('no attached apple found', '');
    else {
      const before = await g.state();
      row('prompt', JSON.stringify(before.interaction.prompt));
      await g.input({ interact: true, interactPressed: true });
      await g.advance(1);
      await g.clearInput();
      const afterE = await g.state();
      row('E, after 1 step', afterE.interaction.carrying ? `carrying ${afterE.interaction.carrying.species}` : 'NOTHING');

      await g.call('drop');
      await g.call('fruit.despawnAllFree');
      const apple2 = await goPickApple();
      if (apple2) {
        await g.input({ primary: true, primaryPressed: true });
        await g.advance(1);
        await g.input({ primary: false, primaryReleased: true });
        await g.advance(1);
        await g.clearInput();
        const lmb = await g.state();
        row('LMB, empty hands', lmb.interaction.carrying ? `carrying ${lmb.interaction.carrying.species}` : 'NOTHING HAPPENS');
      }

      // Grabbing a loose fruit off the ground: the most common action after a
      // shake. Does it make any sound or move the hands at all?
      await g.call('drop');
      await g.call('fruit.despawnAllFree');
      const p = (await g.state()).player.pos;
      const loose = await g.call('fruit.spawn', 'apple', p[0], p[1] + 0.4, p[2] - 1.4);
      await sim(0.6);
      const info = await g.call('fruit.info', loose);
      await faceTo(...info.pos);
      await sim(0.15);
      const fx = await g.page.evaluate(async () => {
        const G = window.__GAME;
        const vm = G.get('viewmodel');
        const before = { kick: vm.kick ?? 0, sound: G.get('audio').played };
        G.get('interaction').tryInteract();
        for (let i = 0; i < 6; i++) await window.__RIPE.advance(1);
        return { kickBefore: before.kick, kickAfter: vm.kick ?? 0, sounds: G.get('audio').played - before.sound };
      });
      row('grab loose fruit', `viewmodel kick ${n(fx.kickBefore, 3)} -> ${n(fx.kickAfter, 3)}`, `sfx queued ${fx.sounds}`);
    }
  }

  // ------------------------------------------------- held fruit lag / weight
  if (want('hold') || want('carry')) {
    head('carrying: how far the held fruit trails the hand point on a 60 deg turn');
    for (const species of ['apple', 'coconut', 'watermelon']) {
      await reset();
      const p = (await g.state()).player.pos;
      const id = await g.call('fruit.spawn', species, p[0], p[1] + 1.2, p[2] - 1.2);
      await sim(0.3);
      const out = await g.page.evaluate(async (fid) => {
        const G = window.__GAME;
        const inter = G.get('interaction');
        const f = G.get('fruit').get(fid);
        if (!f) return null;
        inter.pickUp(f);
        const V = f.position.constructor;
        let peak = 0;
        // Let the pick-up snap decay first: this measures how the fruit rides
        // in the hands, not how it flew into them.
        for (let i = 0; i < 45; i++) await window.__RIPE.advance(1);
        const start = G.player.yaw;
        for (let i = 0; i < 30; i++) {
          G.player.yaw = start + (i / 30) * 1.05;
          await window.__RIPE.advance(1);
          if (!inter.carried) break;
          const hp = inter.holdPoint(new V(), inter.carried.heavy);
          const d = inter.carried.fruit.position.distanceTo(hp);
          if (d > peak) peak = d;
        }
        return { mass: f.mass, heavy: inter.carried?.heavy ?? null, peak };
      }, id);
      if (out) row(species, `${n(out.mass, 1)} kg`, `heavy ${out.heavy}`, `peak trail ${n(out.peak, 4)} m`);
    }
  }

  // ---------------------------------------------------------------- throwing
  if (want('throw')) {
    head('throwing: speed leaving the hand at full charge (mass should be legible)');
    for (const species of ['apple', 'orange', 'banana', 'coconut', 'watermelon']) {
      await reset();
      const p = (await g.state()).player.pos;
      const id = await g.call('fruit.spawn', species, p[0], p[1] + 1.2, p[2] - 1.2);
      await sim(0.3);
      const out = await g.page.evaluate(async (fid) => {
        const G = window.__GAME;
        const inter = G.get('interaction');
        const f = G.get('fruit').get(fid);
        if (!f) return null;
        inter.pickUp(f);
        const mass = f.mass;
        inter.throwHeld(1);
        const v = f.body ? f.body.linvel() : { x: 0, y: 0, z: 0 };
        void (await window.__RIPE.advance(1));
        return { mass, speed: Math.hypot(v.x, v.y, v.z) };
      }, id);
      if (out) row(species, `${n(out.mass, 1)} kg`, `-> ${n(out.speed, 1)} m/s`);
    }
  }

  // ------------------------------------------------------- fruit on the head
  if (want('hit') || want('coconut')) {
    head('being hit: camera reaction to fruit landing on the player');
    for (const [species, dropH] of [['apple', 9], ['coconut', 6], ['coconut', 13]]) {
      await reset();
      const p = (await g.state()).player.pos;
      await g.call('fruit.spawn', species, p[0], p[1] + dropH, p[2]);
      const peak = await shakePeak(1.8);
      const after = await g.state();
      row(`${species} from ${dropH} m`, `shake peak ${n(peak, 4)}`,
        `ragdoll ${after.ragdoll.active}`, `source ${after.ragdoll.lastSource || '-'}`);
      await g.call('ragdoll.recover');
    }
  }

  // ------------------------------------------------------------- puff melon
  if (want('puff')) {
    head('puff melon: height relative to release, still air, one sample per second');
    await reset();
    await g.call('wind.set', 0, 0, 0);
    const y0 = (await g.terrainHeight(-24, 22)) + 14;
    const id = await g.call('fruit.spawn', 'puffmelon', -24, y0, 22);
    const trace = [];
    for (let i = 0; i < 12; i++) {
      await sim(1);
      const f = await g.call('fruit.info', id);
      if (!f) { trace.push('gone'); break; }
      trace.push(n(f.pos[1] - y0, 1));
    }
    row('dy per second', trace.join(' '));
    const f = await g.call('fruit.info', id);
    if (f) row('after 12 s', `y ${n(f.pos[1], 1)}`, `inflate x${n(f.inflate, 2)}`, `speed ${n(f.speed, 2)}`);
    await g.call('wind.set', 1, 0.4, 2.2);
  }

  // --------------------------------------------------------------- rope gun
  if (want('rope')) {
    head('rope gun: firing, tension and the tug it puts on the player');
    await reset();
    await g.page.evaluate(() => {
      const t = window.__GAME.get('tools');
      t.give('ropegun'); t.selectById('ropegun');
    });
    // Tether to a tree trunk, then sprint away until the leash bites: the
    // moment the rope gun has to sell itself.
    const tree = await g.call('plant.nearest', -24, 8, 22, 'appleTree');
    await standAt(tree.pos[0] + 3.0, tree.pos[2]);
    await faceTo(tree.pos[0], tree.pos[1] + 1.2, tree.pos[2]);
    await sim(0.2);
    await g.page.evaluate(() => window.__GAME.get('tools').activeTool.onPrimary(true));
    await sim(0.05);
    const st = await g.state();
    row('after one shot', `${st.ropes.count} rope(s)`, JSON.stringify(st.ropes.list[0] ?? null));
    const before = await g.state();
    await g.input({ moveZ: -1, sprint: true });
    const tug = await g.page.evaluate(async () => {
      const G = window.__GAME;
      const audio = G.get('audio');
      const played0 = audio.played;
      let peakTension = 0, peakYank = 0, tautSteps = 0;
      let prev = G.player.velocity.clone();
      for (let i = 0; i < 210; i++) {
        await window.__RIPE.advance(1);
        for (const r of G.get('ropes').ropes.values()) {
          if (r.tension > peakTension) peakTension = r.tension;
          if (r.tension > 1) tautSteps++;
        }
        const d = G.player.velocity.clone().sub(prev).length();
        if (d > peakYank) peakYank = d;
        prev = G.player.velocity.clone();
      }
      return { peakTension, peakYank, tautSteps, sounds: audio.played - played0 };
    });
    await g.clearInput();
    const after = await g.state();
    row('sprinting off the leash', `peak tension ${n(tug.peakTension, 0)} N`,
      `worst yank ${n(tug.peakYank, 2)} m/s/step`, `taut ${tug.tautSteps} steps`,
      `sounds ${tug.sounds}`);
    row('distance gained', `${n(Math.hypot(after.player.pos[0] - before.player.pos[0], after.player.pos[2] - before.player.pos[2]), 2)} m on a ${n(st.ropes.list[0]?.len ?? 0, 1)} m rope`);
    await g.call('rope.clear');
  }

  // ------------------------------------------------------------- air cannon
  if (want('cannon')) {
    head('air cannon: charge time, recoil, and what it does to a fruit');
    await reset();
    await g.page.evaluate(() => {
      const t = window.__GAME.get('tools');
      t.give('aircannon'); t.selectById('aircannon');
    });
    await g.look(0, 0);
    const p = (await g.state()).player.pos;
    for (const holdFor of [0, 0.4, 1.2]) {
      await g.page.evaluate(() => { window.__GAME.get('tools').activeTool.recharge = 1; });
      await g.input({ primary: true, primaryPressed: true });
      await g.page.evaluate(() => window.__GAME.get('tools').activeTool.onPrimary(true));
      await sim(holdFor);
      // Spawn AFTER the wind-up: at eye height, dead ahead, with no simulated
      // time to fall in before the shot, so the blast ray actually meets it.
      await g.call('fruit.despawnAllFree');
      const id = await g.call('fruit.spawn', 'apple', p[0], p[1] + 1.63, p[2] - 6);
      // Rapier's broad phase only sees a new collider after a step, so a query
      // fired in the same breath as the spawn passes straight through it.
      await g.advance(1);
      await g.clearInput();
      await g.page.evaluate(() => window.__GAME.get('tools').activeTool.onPrimary(false));
      await sim(0.05);
      const d = await g.call('tool.debug', 'aircannon');
      const st = await g.state();
      const f = await g.call('fruit.info', id);
      row(`hold ${n(holdFor, 2)} s`, `power ${n(d.lastPower, 2)}`, `pushed ${d.lastPushed}`,
        `fruit ${f ? n(f.speed, 1) : '-'} m/s`, `player |v| ${n(Math.hypot(...st.player.vel), 1)}`);
      row('', `blast at ${d.lastCentre.join(',')} r${d.lastRadius}`,
        `fruit at ${f ? f.pos.join(',') : '-'}`);
    }
  }

  // ------------------------------------------------------------- stunt spam
  if (want('stunt')) {
    head('stunts: what an ordinary hand pick-and-stow awards');
    await reset();
    const apple = await goPickApple();
    if (apple) {
      await g.call('interact');
      await sim(0.1);
      await g.page.evaluate(() => window.__GAME.get('interaction').stowHeld());
      await sim(0.1);
      row('picked straight off a tree', JSON.stringify(await g.call('scoring.of', apple.id)));
    }
    const p = (await g.state()).player.pos;
    const id = await g.call('fruit.spawn', 'apple', p[0], p[1] + 0.5, p[2] - 1.5);
    await sim(0.6);
    await g.page.evaluate(async (fid) => {
      const G = window.__GAME;
      const f = G.get('fruit').get(fid);
      G.get('interaction').pickUp(f);
      G.get('interaction').stowHeld();
    }, id);
    row('grabbed off the ground', JSON.stringify(await g.call('scoring.of', id)));
  }

  console.log('');
}, { width: 640, height: 360 });
