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
  private handLag = new THREE.Vector3();
  private throwCharge = 0;
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
    if (input.dropPressed) this.dropHeld();

    // Hold LMB to wind up a throw; release to let go. A charged throw is how
    // players discover they can put an apple through a shed window.
    if (this.carried) {
      if (input.primary) this.throwCharge = Math.min(1, this.throwCharge + dt * 1.9);
      if (input.primaryReleased && this.throwCharge > 0.02) {
        this.throwHeld(0.35 + this.throwCharge * 0.65);
        this.throwCharge = 0;
      }
      if (input.secondaryPressed) this.stowHeld();
    } else {
      this.throwCharge = 0;
    }

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
        this.g.bus.emit('ui:toast', {
          text: `${f.displayName} will not come loose`,
          sub: 'It needs proper equipment', kind: 'bad', ms: 2000,
        });
        return false;
      }
      this.fruitSys.detach(f, 'hand', this.g.player.id);
      this.g.bus.emit('audio:sfx', { name: 'pick', position: f.position.clone() });
    }
    // Make room: stow whatever is in hand if the basket will take it.
    if (this.carried) {
      if (!this.stowHeld()) {
        this.dropHeld();
      }
    }
    f.pickUp(this.g.player.id);
    this.carried = { fruit: f, heavy: f.mass > this.basket.maxItemMass };
    this.handLag.set(0, 0, 0);
    if (this.carried.heavy) {
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
    this.holdPoint(_hold, this.carried.heavy);
    f.position.copy(_hold);
    _v.copy(this.g.player.velocity).multiplyScalar(0.6);
    f.release(_v);
    this.carried = null;
  }

  throwHeld(power = 1): void {
    if (!this.carried) return;
    const f = this.carried.fruit;
    this.holdPoint(_hold, this.carried.heavy);
    f.position.copy(_hold);
    // Heavier fruit leaves your hands slower. A watermelon is a shot put.
    const base = 15.5 * clamp(2.2 / Math.sqrt(Math.max(0.35, f.mass)), 0.28, 1.35);
    this.g.player.lookDir(_dir);
    _v.copy(_dir).multiplyScalar(base * power);
    _v.y += 1.4 * power;
    _v.add(this.g.player.velocity);
    f.release(_v, _v2.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6));
    this.carried = null;
    this.g.playerCamera.addRecoil((Math.random() - 0.5) * 0.01, 0.02 * power);
    this.g.bus.emit('audio:sfx', { name: 'throw', volume: 0.5 + power * 0.5 });
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
    this.g.bus.emit('ui:toast', {
      text: `Sold ${result.count} — $${result.total}`,
      sub: result.count > 1 ? `Best: ${best.displayName} $${best.total}` : `${best.quality} · ${best.mass} kg`,
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

    // Lag the hand behind the camera slightly: instant tracking looks glued on.
    const lagK = this.carried.heavy ? 11 : 20;
    this.handLag.x = damp(this.handLag.x, 0, lagK, dt);
    this.handLag.y = damp(this.handLag.y, 0, lagK, dt);
    this.handLag.z = damp(this.handLag.z, 0, lagK, dt);
    _v.copy(_hold).sub(f.position);
    this.handLag.addScaledVector(_v, Math.min(1, dt * lagK));

    const p = this.g.player;
    const bobAmp = this.carried.heavy ? 0.055 : 0.03;
    this.handSway.set(
      Math.sin(p.bobPhase) * bobAmp * 0.5,
      Math.abs(Math.cos(p.bobPhase)) * bobAmp,
      0,
    );
    f.position.copy(_hold).add(this.handSway);
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
