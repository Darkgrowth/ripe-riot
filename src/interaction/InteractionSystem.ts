import * as THREE from 'three';
import type { Game, System } from '@/core/Game';
import type { Fruit } from '@/fruit/Fruit';
import type { FruitSystem } from '@/fruit/FruitSystem';
import type { Sunpatch } from '@/world/Sunpatch';
import type { Economy } from '@/systems/Economy';
import { clamp, damp } from '@/core/MathUtils';
import { QueryMask } from '@/physics/Layers';

/** Anything the player can carry in their hands. Fruit for now; crates later. */
export interface Carried {
  fruit: Fruit;
  /** Two-handed haul: slower, held low, cannot be stowed. */
  heavy: boolean;
}

export interface BasketState {
  items: Fruit[];
  capacity: number;
  /** Heaviest single fruit the basket will take, in kg. */
  maxItemMass: number;
  massCarried: number;
}

const REACH = 3.4;
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _hold = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * Everything the player does with their hands: looking at things, picking them
 * up, hauling them, throwing them, and selling them.
 *
 * The rule that shapes the whole early game lives here: light fruit goes in the
 * basket automatically so harvesting stays fast, and anything heavier than the
 * basket allows must be carried in both hands. That single threshold is what
 * turns a watermelon from "an apple worth more" into a logistics problem.
 */
export class InteractionSystem implements System {
  readonly name = 'interaction';
  private g!: Game;
  private fruitSys!: FruitSystem;
  private world!: Sunpatch;
  private economy!: Economy;

  carried: Carried | null = null;
  basket: BasketState = { items: [], capacity: 9, maxItemMass: 6.5, massCarried: 0 };

  /** What the player is currently looking at, if anything. */
  target: Fruit | null = null;
  targetKind: 'fruit' | 'sell' | 'shop' | 'shake' | null = null;
  private targetPlantId = -1;
  promptText: string | null = null;

  /** Smoothed hand position offsets, so carrying has weight. */
  private handSway = new THREE.Vector3();
  /** Offset of the held fruit from the hand point, its velocity, and where
   *  the hand point was last frame (the spring's driving term). */
  private handLag = new THREE.Vector3();
  private handLagVel = new THREE.Vector3();
  private lastHold = new THREE.Vector3();
  /** 1 the instant something is picked, decaying: widens the swing cap so
   *  the fruit springs off the branch rather than teleporting to the hand. */
  private snap = 0;
  /** 0..1 wind-up, written by whichever tool is doing the throwing. */
  throwCharge = 0;
  private nearSellPad = false;
  private sellCooldown = 0;
  /** Free fruit resting on the sell pad, with the time they arrived. */
  private padFruit = new Map<number, number>();

  init(g: Game): void {
    this.g = g;
    this.fruitSys = g.get<FruitSystem>('fruit');
    this.world = g.get<Sunpatch>('world');
    this.economy = g.get<Economy>('economy');

    g.debug?.addProbe('interaction', () => ({
      carrying: this.carried ? {
        id: this.carried.fruit.id, species: this.carried.fruit.species,
        heavy: this.carried.heavy, mass: +this.carried.fruit.mass.toFixed(1),
      } : null,
      basket: this.basket.items.length,
      basketMass: +this.basket.massCarried.toFixed(1),
      basketValue: this.basketValue(),
      target: this.target ? { id: this.target.id, species: this.target.species } : null,
      targetKind: this.targetKind,
      prompt: this.promptText,
      nearSellPad: this.nearSellPad,
    }));
    g.debug?.addAction('interact', () => this.tryInteract());
    g.debug?.addAction('throw', (power = 1) => this.throwHeld(power));
    g.debug?.addAction('drop', () => this.dropHeld());
    g.debug?.addAction('sell', () => this.sellAll());
    g.debug?.addAction('basket.list', () => this.basket.items.map((f) => ({
      id: f.id, species: f.species, quality: f.quality, value: f.value(),
    })));
    g.debug?.addAction('basket.clear', () => { this.basket.items.length = 0; this.basket.massCarried = 0; });
  }

  // ---- per-frame ----------------------------------------------------------
  fixedStep(dt: number): void {
    const input = this.g.input.frame;
    this.sellCooldown = Math.max(0, this.sellCooldown - dt);
    this.updateTarget();
    this.updateSellPad(dt);

    if (this.g.player.state !== 'active') {
      if (this.carried) this.dropHeld();
      return;
    }

    if (input.interactPressed) this.tryInteract();
    // The mouse buttons belong to the equipped tool (ToolInventory routes them);
    // this system only owns E, and the state of what is in your hands.
    if (!this.carried) this.throwCharge = 0;

    this.g.player.carryLoad = (this.carried?.heavy ? this.carried.fruit.mass : 0)
      + this.basket.massCarried * 0.25;
  }

  frameUpdate(dt: number): void {
    this.updateHeldTransform(dt);
    this.g.bus.emit('ui:prompt', { text: this.promptText });
  }

  // ---- targeting ----------------------------------------------------------
  private updateTarget(): void {
    const p = this.g.player;
    _eye.copy(p.eyePosition);
    p.lookDir(_dir);
    this.target = null;
    this.targetKind = null;
    this.targetPlantId = -1;

    // Selling wins over picking when you are standing on the pad with goods.
    if (this.nearSellPad && (this.basket.items.length > 0 || this.carried)) {
      this.targetKind = 'sell';
      const n = this.basket.items.length + (this.carried ? 1 : 0);
      const value = this.basketValue() + (this.carried ? this.carried.fruit.value() : 0);
      this.promptText = `<b>E</b> Sell ${n} fruit — <b>$${value}</b>`;
      return;
    }

    const f = this.fruitSys.lookTarget(_eye, _dir, REACH, 13);
    if (f && (f.state === 'attached' || f.state === 'free')) {
      this.target = f;
      this.targetKind = 'fruit';
      const verb = f.state === 'attached' ? 'Pick' : 'Grab';
      const q = f.damage > 0.001 ? ` <b>${f.quality}</b>` : '';
      this.promptText = `<b>E</b> ${verb} ${f.displayName}${q} — $${f.value()}`;
      return;
    }

    // Bare hands on a trunk still shakes it, just badly.
    const hit = this.g.physics.raycast(_eye, _dir, REACH, QueryMask.interact, p.body);
    if (hit?.owner?.kind === 'plant') {
      this.targetKind = 'shake';
      this.targetPlantId = hit.owner.id;
      this.promptText = '<b>E</b> Shake the tree';
      return;
    }

    this.promptText = null;
  }

  private updateSellPad(dt: number): void {
    const pad = this.world.sellPad;
    const r = this.world.sellRadius;
    const p = this.g.player.position;
    this.nearSellPad = Math.hypot(p.x - pad.x, p.z - pad.z) < r + 1.2
      && Math.abs(p.y - pad.y) < 4;

    // Fruit that comes to rest on the pad sells itself. This is what makes
    // firing produce at the shop from a hilltop a legitimate strategy.
    const now = this.g.clock.elapsed;
    for (const f of this.fruitSys.fruits.values()) {
      if (f.state !== 'free') { this.padFruit.delete(f.id); continue; }
      const inside = Math.hypot(f.position.x - pad.x, f.position.z - pad.z) < r
        && f.position.y > pad.y - 1 && f.position.y < pad.y + 3.2;
      if (!inside) { this.padFruit.delete(f.id); continue; }
      if (f.speed > 1.4) { this.padFruit.set(f.id, now); continue; }
      const since = this.padFruit.get(f.id);
      if (since === undefined) { this.padFruit.set(f.id, now); continue; }
      if (now - since > 0.55) {
        this.padFruit.delete(f.id);
        // Landing produce in the drop-off under its own power is a stunt, not
        // an accident, and the scoring system should see it that way.
        if (this.g.has('scoring')) {
          this.g.get<{ awardDelivery(f: Fruit): void }>('scoring').awardDelivery(f);
        }
        this.sellFruit([f], 'delivered');
      }
    }
    void dt;
  }

  // ---- actions ------------------------------------------------------------
  tryInteract(): boolean {
    if (this.targetKind === 'sell') return this.sellAll().count > 0;
    if (this.targetKind === 'shake' && this.targetPlantId >= 0) {
      const dropped = this.fruitSys.shake(this.targetPlantId, 0.55, this.g.player.id);
      this.g.playerCamera.addShake(0.012, 0.28, 30);
      this.g.bus.emit('audio:sfx', { name: 'rustle', position: this.g.player.position.clone() });
      if (dropped === 0) {
        this.g.bus.emit('ui:toast', { text: 'Nothing budged', sub: 'You need a proper shaker', ms: 1600 });
      }
      return dropped > 0;
    }
    if (this.target) return this.pickUp(this.target);
    return false;
  }

  pickUp(f: Fruit): boolean {
    // Re-picking what you are already holding would stow it and immediately
    // take it back out, which reads as "the pick key did nothing".
    if (this.carried?.fruit === f) return false;
    if (f.state === 'stowed' || f.state === 'gone') return false;
    if (f.state === 'attached') {
      // Bare hands only work on fruit that is ready to come off.
      if (f.def.attachStrength > 6.0) {
        // A refusal is an interaction too: it should thump, not just print.
        this.g.bus.emit('audio:sfx', {
          name: 'stow', volume: 0.3, pitch: 0.5, position: f.position.clone(),
        });
        this.g.playerCamera.addRecoil(0, -0.008);
        this.g.bus.emit('ui:toast', {
          text: `${f.displayName} will not come loose`,
          sub: 'It needs proper equipment', kind: 'bad', ms: 2000,
        });
        return false;
      }
      this.fruitSys.detach(f, 'hand', this.g.player.id);
      // The snap of a stem giving way. Bigger fruit lets go lower and harder.
      this.g.bus.emit('audio:sfx', {
        name: 'pick', position: f.position.clone(),
        volume: clamp(0.7 + f.mass * 0.05, 0.7, 1.1),
        pitch: clamp(1.35 / Math.pow(Math.max(0.4, f.mass), 0.26), 0.62, 1.35),
      });
      this.g.playerCamera.addRecoil(0, clamp(0.004 + f.mass * 0.0016, 0.004, 0.02));
    }
    // Make room: stow whatever is in hand if the basket will take it.
    if (this.carried) {
      if (!this.stowHeld()) {
        this.dropHeld();
      }
    }
    const from = _v2.copy(f.position);
    f.pickUp(this.g.player.id);
    this.carried = { fruit: f, heavy: f.mass > this.basket.maxItemMass };
    this.holdPoint(this.lastHold, this.carried.heavy);
    // Start the spring displaced by where the fruit actually was, so it flies
    // into the hand from the branch.
    this.handLag.copy(from).sub(this.lastHold);
    if (this.handLag.lengthSq() > 0.81) this.handLag.setLength(0.9);
    this.handLagVel.set(0, 0, 0);
    this.snap = 1;
    // Taking hold of something is an action, and it used to be a silent one:
    // grabbing loose fruit off the ground — the commonest thing you do after
    // a tree shake — made no sound and did not move the hands at all. Weight
    // rides on the pitch, so a coconut lands lower in the ear than an apple.
    this.g.bus.emit('fruit:grabbed', {
      fruitId: f.id, species: f.species, mass: f.mass, heavy: this.carried.heavy,
    });
    this.g.bus.emit('audio:sfx', {
      name: this.carried.heavy ? 'thud' : 'stow',
      volume: this.carried.heavy ? 0.34 : 0.5,
      pitch: clamp(1.5 / Math.pow(Math.max(0.4, f.mass), 0.3), 0.55, 1.5),
      position: f.position.clone(),
    });
    if (this.carried.heavy) {
      // Hoisting a two-hander is a physical event, not a notification.
      this.g.playerCamera.addRecoil(0, -0.022);
      this.g.playerCamera.addShake(0.012, 0.22, 18);
      this.g.bus.emit('ui:toast', {
        text: `${f.displayName} — ${f.mass.toFixed(1)} kg`,
        sub: 'Too big for the basket. Both hands.', ms: 2400,
      });
    }
    return true;
  }

  /** Put the held fruit in the basket. Returns false if it will not fit. */
  stowHeld(): boolean {
    if (!this.carried) return false;
    const f = this.carried.fruit;
    if (f.mass > this.basket.maxItemMass) return false;
    if (this.basket.items.length >= this.basket.capacity) {
      this.g.bus.emit('ui:toast', { text: 'Basket is full', kind: 'bad', ms: 1600 });
      return false;
    }
    // Evaluate before stowing: once stowed the fruit stops simulating and its
    // flight record can no longer be judged.
    if (this.g.has('scoring')) {
      this.g.get<{ evaluate(f: Fruit): void }>('scoring').evaluate(f);
    }
    f.stow();
    this.basket.items.push(f);
    this.basket.massCarried += f.mass;
    this.carried = null;
    this.g.bus.emit('fruit:stowed', { fruitId: f.id, species: f.species });
    this.g.bus.emit('audio:sfx', { name: 'stow' });
    return true;
  }

  dropHeld(): void {
    if (!this.carried) return;
    const f = this.carried.fruit;
    this.releasePoint(f);
    _v.copy(this.g.player.velocity).multiplyScalar(0.6);
    f.release(_v);
    this.carried = null;
  }

  /**
   * Where a released fruit starts: where it was DRAWN, not the ideal hand
   * point. Now that heavy fruit trails the hands by up to a third of a metre,
   * releasing it from the ideal point pops it across that gap on the frame it
   * leaves your hands.
   */
  private releasePoint(f: Fruit): void {
    this.holdPoint(_hold, this.carried?.heavy ?? false);
    f.position.copy(_hold).add(this.handLag);
  }

  throwHeld(power = 1): void {
    if (!this.carried) return;
    const f = this.carried.fruit;
    this.releasePoint(f);
    // Heavier fruit leaves your hands slower. A watermelon is a shot put.
    //
    // The old curve saturated against its own upper clamp below about 3 kg, so
    // an apple, an orange and a banana bunch all left the hand at exactly
    // 21 m/s and the weight in the HUD was a lie. This one has no ceiling to
    // hit in the light range, so every species throws differently:
    //   orange 1.0 kg 21.0   apple 1.1 kg 20.0   banana 2.6 kg 12.4
    //   coconut 3.4 kg 10.7  watermelon 22 kg 4.7 (a shot put, as advertised)
    const base = 15.5 * clamp(1.35 / Math.pow(Math.max(0.35, f.mass), 0.55), 0.30, 1.45);
    this.g.player.lookDir(_dir);
    _v.copy(_dir).multiplyScalar(base * power);
    _v.y += 1.4 * power;
    _v.add(this.g.player.velocity);
    // Spin scales with how hard it was thrown; a lobbed melon should not
    // leave the hand rotating like a shuriken.
    const spin = 3 + power * 5 * clamp(2.5 / Math.max(0.5, f.mass), 0.3, 1.6);
    f.release(_v, _v2.set(
      (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin));
    this.carried = null;
    // Follow-through: heavier releases kick the view harder and lower.
    const heft = clamp(Math.pow(f.mass, 0.45) * 0.5, 0.4, 2.2);
    this.g.playerCamera.addRecoil((Math.random() - 0.5) * 0.012 * heft, 0.022 * power * heft);
    this.g.playerCamera.addShake(0.006 * power * heft, 0.18, 24);
    this.g.bus.emit('audio:sfx', {
      name: 'throw', volume: 0.45 + power * 0.55,
      pitch: clamp(1.45 / Math.pow(Math.max(0.4, f.mass), 0.28), 0.6, 1.45),
    });
    this.g.bus.emit('tool:fired', { toolId: 'hand' });
  }

  // ---- selling ------------------------------------------------------------
  basketValue(): number {
    let v = 0;
    for (const f of this.basket.items) v += f.value();
    return v;
  }

  sellAll(): { count: number; total: number } {
    if (this.sellCooldown > 0) return { count: 0, total: 0 };
    const batch: Fruit[] = [...this.basket.items];
    if (this.carried) { batch.push(this.carried.fruit); this.carried = null; }
    if (!batch.length) return { count: 0, total: 0 };
    this.basket.items.length = 0;
    this.basket.massCarried = 0;
    this.sellCooldown = 0.25;
    return this.sellFruit(batch, 'counter');
  }

  private sellFruit(batch: Fruit[], how: string): { count: number; total: number } {
    const scoring = this.g.has('scoring')
      ? this.g.get<{ multiplierFor(f: Fruit): number }>('scoring')
      : null;
    const result = this.economy.sell(batch, scoring ? (f) => scoring.multiplierFor(f) : undefined);
    for (const f of batch) this.fruitSys.remove(f);
    this.g.bus.emit('audio:sfx', { name: 'sale' });
    const best = result.lines.reduce((a, b) => (b.total > a.total ? b : a), result.lines[0]);
    // Say what the stunts were worth. A bonus the player cannot see is a
    // bonus that does not exist, and "+$41 from stunts" is the line that
    // makes someone try the stupid route again on the next load.
    const bonus = result.stuntBonus > 0 ? ` &nbsp;<b>+$${result.stuntBonus} stunts</b>` : '';
    this.g.bus.emit('ui:toast', {
      text: `Sold ${result.count} — $${result.total}`,
      sub: (result.count > 1 ? `Best: ${best.displayName} $${best.total}` : `${best.quality} · ${best.mass} kg`) + bonus,
      kind: 'gold', ms: 2600,
    });
    void how;
    return { count: result.count, total: result.total };
  }

  // ---- held-item presentation --------------------------------------------
  private holdPoint(out: THREE.Vector3, heavy: boolean): THREE.Vector3 {
    const p = this.g.player;
    p.lookDir(_dir);
    const dist = heavy ? 1.15 : 0.85;
    const drop = heavy ? -0.45 : -0.18;
    const side = heavy ? 0 : 0.28;
    out.copy(p.eyePosition).addScaledVector(_dir, dist);
    p.right(_v);
    out.addScaledVector(_v, side);
    out.y += drop;
    return out;
  }

  private updateHeldTransform(dt: number): void {
    if (!this.carried) return;
    const f = this.carried.fruit;
    this.holdPoint(_hold, this.carried.heavy);

    // A spring between the hands and the fruit, softened by mass.
    //
    // This is the only place a player can FEEL what a fruit weighs while
    // walking around with it, so the numbers matter: an apple is stiff enough
    // to look glued to the hands, a 22 kg watermelon swings a fifth of a metre
    // wide of a turn and takes a beat to catch up. The offset is `fruit minus
    // hands`: moving the hands displaces it, the spring pulls it back.
    //
    // (An earlier version computed this offset and then never added it to the
    // fruit, which is why every species used to carry like the same
    // polystyrene prop no matter what the HUD said it weighed.)
    const stiff = clamp(105 / (1 + f.mass * 0.55), 11, 95);
    const damping = 2 * Math.sqrt(stiff) * 0.78;
    // This runs on the RENDER step, whose dt is whatever the frame took. An
    // explicit spring integrated over a 200 ms hitch explodes; clamping the
    // step just makes the fruit catch up a frame later, which nobody sees.
    const h = Math.min(dt, 1 / 30);
    _v.copy(_hold).sub(this.lastHold);
    this.lastHold.copy(_hold);
    this.handLag.sub(_v);
    this.handLagVel.addScaledVector(this.handLag, -stiff * h);
    this.handLagVel.multiplyScalar(Math.exp(-damping * h));
    this.handLag.addScaledVector(this.handLagVel, h);
    // Cap the swing so a heavy fruit stays in frame rather than orbiting.
    // The cap opens up briefly at the moment of the pick so the fruit visibly
    // springs off the branch into the hand instead of teleporting there: the
    // detach snap is the whole physical read of "I took that".
    this.snap = Math.max(0, this.snap - dt * 4.5);
    const swing = clamp(0.05 + f.mass * 0.012, 0.05, 0.32) + this.snap * 0.75;
    if (this.handLag.lengthSq() > swing * swing) this.handLag.setLength(swing);

    const p = this.g.player;
    const bobAmp = this.carried.heavy ? 0.055 : 0.03;
    this.handSway.set(
      Math.sin(p.bobPhase) * bobAmp * 0.5,
      Math.abs(Math.cos(p.bobPhase)) * bobAmp,
      0,
    );
    f.position.copy(_hold).add(this.handSway).add(this.handLag);
    // Heavy things sag in the hands rather than floating at hand height.
    f.position.y -= clamp(f.mass * 0.0045, 0, 0.10);
    // Charging a throw pulls the fruit back and up.
    if (this.throwCharge > 0.01) {
      p.lookDir(_dir);
      f.position.addScaledVector(_dir, -this.throwCharge * 0.35);
      f.position.y += this.throwCharge * 0.18;
    }
    _e.set(p.pitch * 0.35, p.yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    f.quaternion.slerp(_q, Math.min(1, dt * 9));
  }

  get throwPower(): number { return this.throwCharge; }
}

const _v2 = new THREE.Vector3();
