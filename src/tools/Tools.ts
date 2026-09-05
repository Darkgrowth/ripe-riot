import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Tool, type ToolDef } from './ToolBase';
import type { Fruit } from '@/fruit/Fruit';
import type { RopeSystem, Rope } from '@/systems/RopeSystem';
import { QueryMask, Groups } from '@/physics/Layers';
import { Palette } from '@/render/Palette';
import { clamp } from '@/core/MathUtils';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

// ---------------------------------------------------------------------------
// HAND PICKER — the one you start with
// ---------------------------------------------------------------------------
export class HandPicker extends Tool {
  readonly def: ToolDef = {
    id: 'hand', label: 'Hand Picker', icon: '✋',
    description: 'Two hands and some optimism.',
    tagline: 'Free, because it is your hands.',
    cost: 0, tier: 0, starter: true,
  };

  /** True while the click that just picked something is still held down, so
   *  releasing it cannot immediately throw what it picked. */
  private pickedOnPress = false;

  override onPrimary(down: boolean): void {
    const inter = this.ctx.interaction;
    if (down) {
      this.charge = 0;
      // Left-click with empty hands used to do nothing at all, which is a
      // strange thing for the first button of a first-person game to do:
      // every player tries it on the first apple they see. It picks.
      this.pickedOnPress = !inter.carried && inter.tryInteract();
      return;
    }
    if (this.pickedOnPress) { this.pickedOnPress = false; this.charge = 0; return; }
    if (inter.carried) {
      inter.throwHeld(0.35 + this.charge * 0.65);
      this.charge = 0;
    }
  }

  override onSecondary(down: boolean): void {
    if (!down) return;
    const inter = this.ctx.interaction;
    if (inter.carried) inter.stowHeld();
    else inter.tryInteract();
  }

  override step(dt: number, held: { primary: boolean }): void {
    super.step(dt, held as never);
    if (held.primary && this.ctx.interaction.carried && !this.pickedOnPress) {
      this.charge = Math.min(1, this.charge + dt * 1.9);
    } else if (!held.primary) {
      this.charge = 0;
      this.pickedOnPress = false;
    }
    // Share the wind-up so the held fruit pulls back on screen.
    this.ctx.interaction.throwCharge = this.charge;
  }

  override status(): string {
    return this.charge > 0.05 ? `${Math.round(this.charge * 100)}%` : '';
  }
}

// ---------------------------------------------------------------------------
// TREE SHAKER — the first tool that makes fruit come to you
// ---------------------------------------------------------------------------
export class TreeShaker extends Tool {
  readonly def: ToolDef = {
    id: 'shaker', label: 'Tree Shaker', icon: '🌳',
    description: 'Grips a trunk and disagrees with it violently.',
    tagline: 'Faster than picking. Worse for the fruit.',
    cost: 380, tier: 0,
  };

  override onPrimary(down: boolean): void {
    if (!down || this.cooldown > 0) return;
    const p = this.player;
    const hit = this.game.physics.raycast(
      p.eyePosition.clone(), this.aim(_dir), 5.5, QueryMask.interact, p.body);
    if (!hit || hit.owner?.kind !== 'plant') {
      this.game.bus.emit('ui:toast', { text: 'Point it at a trunk', ms: 1300 });
      return;
    }
    this.cooldown = 0.85;
    const dropped = this.ctx.fruit.shake(hit.owner.id, 1.75, p.id);
    this.game.playerCamera.addShake(0.03, 0.45, 26);
    this.game.bus.emit('audio:sfx', { name: 'shake', position: hit.point });
    this.game.bus.emit('tool:fired', { toolId: this.def.id, power: 1.15 });
    if (dropped > 0) {
      this.game.bus.emit('ui:toast', {
        text: `${dropped} came down`, kind: 'good', ms: 1600,
      });
    }
  }

  /** Area shake: every plant within reach, at lower strength. */
  override onSecondary(down: boolean): void {
    if (!down || this.cooldown > 0) return;
    this.cooldown = 2.4;
    const p = this.player;
    let total = 0;
    for (const plant of this.ctx.fruit.plants.all()) {
      const d = plant.position.distanceTo(p.position);
      if (d > 9) continue;
      total += this.ctx.fruit.shake(plant.id, 1.35 * (1 - d / 11), p.id);
    }
    this.game.playerCamera.addShake(0.05, 0.7, 20);
    this.game.bus.emit('audio:sfx', { name: 'shake', volume: 1 });
    if (total > 0) {
      this.game.bus.emit('ui:toast', { text: `${total} fruit down`, kind: 'good', ms: 1800 });
    }
  }

  override status(): string { return this.cooldown > 0 ? this.cooldown.toFixed(1) : ''; }
}

// ---------------------------------------------------------------------------
// CATCH NET — turns "it fell" into "we caught it"
// ---------------------------------------------------------------------------
/**
 * A swing, not a vacuum.
 *
 * The first version was "hold the button and anything that enters a 1.55 m
 * sphere in front of you is yours". Measured against a falling apple that was
 * a 100% catch with no decision in it: you held the button before the fruit
 * left the tree and waited. The tool everyone buys second had no skill in it,
 * no miss, and therefore no story.
 *
 * Now a click is a SWING. The hoop sweeps through the aim point over a third
 * of a second and only the middle of that sweep can catch, so the player has
 * to commit as the fruit ARRIVES. Too early and the hoop has passed; too late
 * and it is still coming up. A miss whooshes, droops, and costs a recovery
 * before the next swing. Holding the button flails — swing after swing with
 * the same window — which still works on a shower of fruit and reads as
 * exactly what it is.
 *
 * The telegraph is the other half: the hoop is always in view while the net
 * is equipped, and it brightens as something catchable closes on it, so "swing
 * when it glows" is learnable from the first coconut.
 */
export class CatchNet extends Tool {
  readonly def: ToolDef = {
    id: 'net', label: 'Catch Net', icon: '🥅',
    description: 'Click to swing as the fruit arrives. Right-click lays a ground net.',
    tagline: 'The difference between a harvest and a mess.',
    cost: 260, tier: 0,
  };

  /** Seconds a swing takes, and the slice of it that can actually catch. */
  static readonly SWING = 0.34;
  static readonly ACTIVE_FROM = 0.06;
  static readonly ACTIVE_TO = 0.28;
  /** Seconds after a swing before the next one. Longer after a miss. */
  static readonly RECOVER = 0.36;
  static readonly RECOVER_MISS = 0.50;
  /** A press this close to the end of recovery queues the next swing. */
  static readonly BUFFER = 0.14;
  /** Speed a fruit must be doing to count as CAUGHT rather than scooped. */
  private static readonly CATCH_SPEED = 2.2;

  private phase: 'ready' | 'swing' | 'recover' = 'ready';
  private phaseT = 0;
  private recoverFor = CatchNet.RECOVER;
  private queued = false;
  /** What this swing caught, and whether something already got past it. */
  private swingCaught = 0;
  private missedThisSwing = false;
  private hintsLeft = 3;

  /** Ground nets soften whatever lands on them. */
  private groundNets: Array<{ pos: THREE.Vector3; radius: number; until: number; mesh: THREE.Mesh }> = [];
  private ring: THREE.Mesh | null = null;
  private ringMat: THREE.MeshStandardMaterial | null = null;
  /** 0..1 telegraph: something catchable is closing on the hoop. */
  private lock = 0;
  /** Decaying flash left by the last catch. */
  private flash = 0;
  /** Measured: at 1.55 m (a 3.1 m hoop) a press a tenth of a second early still caught a falling apple on the last active step. */
  catchRadius = 1.05;
  /** Seen from the eye, a 1.05 m hoop at 2.8 m is ~41 degrees across: a big net,
   *  not a reticle. At 2.0 m the ring touched the frame edges. */
  catchDistance = 2.8;
  /** Instrumentation. */
  caught = 0;
  swings = 0;
  misses = 0;
  /** The hoop's current centre, which is also the catch volume's centre. */
  private hoop = new THREE.Vector3();

  override onAttach(): void {
    const geo = new THREE.TorusGeometry(this.catchRadius, 0.035, 6, 24);
    this.ringMat = new THREE.MeshStandardMaterial({
      color: Palette.rope, roughness: 0.9, transparent: true, opacity: 0.85,
    });
    this.ring = new THREE.Mesh(geo, this.ringMat);
    this.ring.visible = false;
    this.ring.frustumCulled = false;
    this.game.renderer.scene.add(this.ring);
  }

  override onPrimary(down: boolean): void {
    if (!down) return;
    if (this.phase === 'ready') { this.beginSwing(); return; }
    // Pressing during the tail of a recovery should not be eaten: the player
    // meant "again", and jump buffering exists for exactly this reason.
    if (this.phase === 'recover' && this.recoverFor - this.phaseT <= CatchNet.BUFFER) {
      this.queued = true;
    }
  }

  override onUnequip(): void {
    super.onUnequip();
    this.phase = 'ready';
    this.phaseT = 0;
    this.queued = false;
    this.lock = 0;
    this.flash = 0;
    if (this.ring) { this.ring.visible = false; this.ring.scale.setScalar(1); }
  }

  /** True during the slice of a swing that can catch. */
  get active(): boolean {
    return this.phase === 'swing'
      && this.phaseT >= CatchNet.ACTIVE_FROM && this.phaseT <= CatchNet.ACTIVE_TO;
  }

  private beginSwing(): void {
    this.phase = 'swing';
    this.phaseT = 0;
    this.queued = false;
    this.swings++;
    this.swingCaught = 0;
    this.missedThisSwing = false;
    this.game.bus.emit('audio:sfx', { name: 'netSwing', volume: 0.5, pitch: 1 });
    this.game.bus.emit('tool:swing', { toolId: this.def.id, duration: CatchNet.SWING });
    this.game.playerCamera.addRecoil((Math.random() - 0.5) * 0.004, 0.004);
  }

  private endSwing(): void {
    this.phase = 'recover';
    this.phaseT = 0;
    // Whiffing at something costs more than swinging at nothing.
    this.recoverFor = this.missedThisSwing ? CatchNet.RECOVER_MISS : CatchNet.RECOVER;
  }

  /**
   * A miss is a real event, not the absence of a catch: a catchable fruit
   * went through the hoop while the net could not take it — too late (the
   * dead start of the swing) or too early (the recovery). It has to be
   * legible as a miss the moment it happens, or the player concludes the
   * tool is broken rather than that their timing was off. A low whoosh, a
   * dip in the view, a longer recovery, and — the first few times — the one
   * sentence that fixes it.
   */
  private checkMiss(): void {
    if (this.missedThisSwing || this.swingCaught > 0) return;
    const r2 = Math.pow(this.catchRadius * 1.15, 2);
    for (const f of this.ctx.fruit.fruits.values()) {
      if (f.state !== 'free' || !f.body || f.mass > 14) continue;
      if (f.speed < CatchNet.CATCH_SPEED * 1.5) continue;
      if (f.position.distanceToSquared(this.hoop) > r2) continue;
      this.missedThisSwing = true;
      this.misses++;
      if (this.phase === 'recover') this.recoverFor = CatchNet.RECOVER_MISS;
      this.game.bus.emit('audio:sfx', { name: 'netSwing', volume: 0.42, pitch: 0.72 });
      this.game.playerCamera.addRecoil(0, -0.007);
      if (this.hintsLeft > 0) {
        this.hintsLeft--;
        this.game.bus.emit('ui:toast', {
          text: 'MISSED', sub: 'Swing as it reaches the hoop — when the ring glows', kind: 'bad', ms: 1800,
        });
      }
      return;
    }
  }

  /** Lay a net on the ground that softens anything landing in it. */
  override onSecondary(down: boolean): void {
    if (!down || this.cooldown > 0) return;
    const p = this.player;
    const hit = this.game.physics.raycast(
      p.eyePosition.clone(), this.aim(_dir), 14, QueryMask.groundOnly, p.body);
    if (!hit) { this.game.bus.emit('ui:toast', { text: 'Aim at the ground', ms: 1200 }); return; }
    this.cooldown = 1.0;

    const radius = 2.4;
    const geo = new THREE.CircleGeometry(radius, 20);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: Palette.rope, roughness: 0.95, transparent: true, opacity: 0.55,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(hit.point).add(_v.set(0, 0.06, 0));
    mesh.receiveShadow = true;
    this.game.renderer.scene.add(mesh);
    this.groundNets.push({
      pos: hit.point.clone(), radius, until: this.game.clock.elapsed + 90, mesh,
    });
    if (this.groundNets.length > 4) this.retireNet(0);
    this.game.bus.emit('audio:sfx', { name: 'netPlace', position: hit.point });
  }

  private retireNet(i: number): void {
    const n = this.groundNets[i];
    if (!n) return;
    this.game.renderer.scene.remove(n.mesh);
    n.mesh.geometry.dispose();
    (n.mesh.material as THREE.Material).dispose();
    this.groundNets.splice(i, 1);
  }

  /**
   * Where the hoop is right now. At rest it hangs a little right of the aim
   * point; a swing carries it from the right, through the aim point at the
   * middle of the active window, and out to the left; a recovery lets it
   * droop and drift back. Expressed in the camera's own axes so it reads the
   * same whichever way the player is facing.
   */
  private placeHoop(out: THREE.Vector3): THREE.Vector3 {
    this.muzzle(out, this.catchDistance);
    const cam = this.game.renderer.camera;
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    let lateral = 0.35, vertical = -0.10;
    if (this.phase === 'swing') {
      const mid = (CatchNet.ACTIVE_FROM + CatchNet.ACTIVE_TO) * 0.5;
      // 0 at the start of the swing, 0.5 at the middle of the active window,
      // 1 at the end: the hoop is dead on the aim point when it matters most.
      const s = this.phaseT < mid
        ? 0.5 * this.phaseT / mid
        : 0.5 + 0.5 * (this.phaseT - mid) / (CatchNet.SWING - mid);
      const e = s * s * (3 - 2 * s);
      lateral = 1.05 - e * 1.85;
      vertical = 0.28 - e * 0.55;
    } else if (this.phase === 'recover') {
      const k = clamp(this.phaseT / this.recoverFor, 0, 1);
      const back = k * k * (3 - 2 * k);
      lateral = -0.8 + (0.35 + 0.8) * back;
      vertical = -0.45 + (-0.10 + 0.45) * back;
    }
    return out.addScaledVector(_right, lateral).addScaledVector(_up, vertical);
  }

  override step(dt: number, held: { primary: boolean }): void {
    super.step(dt, held as never);
    this.flash = Math.max(0, this.flash - dt * 3.4);

    // --- the swing state machine
    if (this.phase === 'swing') {
      this.phaseT += dt;
      if (this.phaseT >= CatchNet.SWING) this.endSwing();
    } else if (this.phase === 'recover') {
      this.phaseT += dt;
      if (this.phaseT >= this.recoverFor) {
        this.phase = 'ready';
        this.phaseT = 0;
        // Buffered press, or the button still down: swing again.
        if (this.queued || held.primary) this.beginSwing();
      }
    }

    // --- hoop and telegraph
    this.placeHoop(this.hoop);
    if (this.ring) {
      this.ring.visible = this.equipped && this.player.state === 'active';
      this.ring.position.copy(this.hoop);
      this.ring.quaternion.copy(this.game.renderer.camera.quaternion);
      // The telegraph is read at the AIM point, which is where the swing
      // passes at the middle of its window — that is the thing being timed.
      this.muzzle(_pos, this.catchDistance);
      const threat = this.threat(_pos);
      this.lock = clamp(this.lock + (threat - this.lock) * Math.min(1, dt * 14), 0, 1);
      const glow = Math.max(Math.pow(this.lock, 0.7), this.flash);
      const droop = this.phase === 'recover' ? 1 - clamp(this.phaseT / this.recoverFor, 0, 1) : 0;
      const s = 1 + glow * 0.16 + this.flash * 0.22 - droop * 0.12;
      this.ring.scale.setScalar(s);
      if (this.ringMat) {
        this.ringMat.color.copy(Palette.rope).lerp(WHITE, this.flash * 0.8);
        this.ringMat.emissive.copy(GOLD).multiplyScalar(glow * 0.85);
        // Dim at rest, fully there during a swing, greyed out in recovery.
        const base = this.phase === 'swing' ? 0.9 : this.phase === 'recover' ? 0.3 : 0.5;
        this.ringMat.opacity = base + glow * (1 - base);
      }
    }
    if (this.active) this.sweep();
    else if (this.phase !== 'ready') this.checkMiss();
  }

  /** How close the nearest catchable fruit is to the hoop, as 0..1. */
  private threat(hoop: THREE.Vector3): number {
    let best = 0;
    const warn = this.catchRadius * 3.4;
    for (const f of this.ctx.fruit.fruits.values()) {
      if (f.state !== 'free' || !f.body || f.mass > 14) continue;
      const d = f.position.distanceTo(hoop);
      if (d > warn) continue;
      // Weight by speed: a fruit lying still in the grass is not a catch.
      const moving = clamp(f.speed / 6, 0, 1);
      const near = 1 - d / warn;
      // Rises early enough to be a cue, not a confirmation: with near squared the
      // ring only lit once the fruit was already inside the swing.
      const v = Math.pow(near, 1.5) * (0.35 + moving * 0.65);
      if (v > best) best = v;
    }
    return best;
  }

  /** Runs even when the net is stowed: ground nets keep working. */
  override background(_dt: number): void {
    const now = this.game.clock.elapsed;
    for (let i = this.groundNets.length - 1; i >= 0; i--) {
      if (this.groundNets[i].until < now) this.retireNet(i);
    }
    if (!this.groundNets.length) return;
    for (const f of this.ctx.fruit.fruits.values()) {
      if (f.state !== 'free' || !f.body) continue;
      const v = f.body.linvel();
      if (v.y > -3) continue;
      for (const n of this.groundNets) {
        const dx = f.position.x - n.pos.x;
        const dz = f.position.z - n.pos.z;
        const dy = f.position.y - n.pos.y;
        if (dy < -0.5 || dy > 2.2) continue;
        if (dx * dx + dz * dz > n.radius * n.radius) continue;
        // Bleed the fall off over a few frames rather than stopping it dead:
        // an instant halt reads as a bug, a rapid decelerate reads as a net.
        f.body.setLinvel({ x: v.x * 0.55, y: v.y * 0.35, z: v.z * 0.55 }, true);
        if (v.y < -6) {
          this.game.bus.emit('audio:sfx', { name: 'netCatch', position: f.position.clone() });
          this.game.bus.emit('stunt:candidate', { fruitId: f.id, kind: 'netLanding' });
        }
        break;
      }
    }
  }

  /** Catch anything inside the hoop during the active slice of a swing. */
  private sweep(): void {
    const inter = this.ctx.interaction;
    const r2 = this.catchRadius * this.catchRadius;
    for (const f of this.ctx.fruit.fruits.values()) {
      if (f.state !== 'free' || !f.body) continue;
      if (f.position.distanceToSquared(this.hoop) > r2) continue;
      // Too heavy to catch by hand — but it does get slowed down a lot.
      if (f.mass > 14) {
        const v = f.body.linvel();
        f.body.setLinvel({ x: v.x * 0.72, y: v.y * 0.72, z: v.z * 0.72 }, true);
        this.swingCaught++;   // deflecting a watermelon is not a miss
        this.game.bus.emit('audio:sfx', {
          name: 'thud', volume: 0.4, pitch: 0.7, position: f.position.clone(),
        });
        continue;
      }
      const speed = f.speed;
      const realCatch = speed > CatchNet.CATCH_SPEED;
      this.caught++;
      this.swingCaught++;
      // A catch and a scoop are different events and should not sound the
      // same: snatching a coconut out of the air is the point of the tool,
      // sweeping a windfall out of the grass is tidying up.
      this.game.bus.emit('audio:sfx', {
        name: 'netCatch', position: f.position.clone(),
        volume: realCatch ? clamp(0.55 + speed / 18, 0.55, 1) : 0.3,
        pitch: realCatch ? clamp(0.85 + speed / 26, 0.85, 1.5) : 0.7,
      });
      if (realCatch) {
        this.flash = 1;
        // The catch lands in the hands: a thump in the view, a bite on the
        // arms, and a puff where the fruit hit the netting.
        this.game.playerCamera.addShake(clamp(0.008 + speed * 0.0018, 0.008, 0.034), 0.18, 30);
        this.game.playerCamera.addRecoil(0, -0.008 - Math.min(0.014, speed * 0.001));
        this.game.bus.emit('tool:fired', { toolId: this.def.id, power: clamp(0.4 + speed / 20, 0.4, 1.3) });
        this.game.bus.emit('tool:blast', {
          toolId: this.def.id, point: f.position.clone(), power: clamp(speed / 30, 0.12, 0.4), radius: 0.9,
        });
        if (speed > 5) {
          this.game.bus.emit('ui:toast', {
            text: 'CAUGHT', sub: `${f.displayName} at ${speed.toFixed(0)} m/s`, kind: 'good', ms: 1400,
          });
        }
      }
      if (speed > 5.5 && f.position.y > this.player.position.y + 0.4) {
        this.game.bus.emit('stunt:candidate', { fruitId: f.id, kind: 'midAir' });
      }
      inter.pickUp(f);
      inter.stowHeld();
      break; // one per step, so a burst of fruit reads as a sequence of catches
    }
  }

  override status(): string {
    if (this.phase === 'swing') return 'SWING';
    if (this.phase === 'recover') return this.missedThisSwing ? 'miss' : '…';
    return this.groundNets.length ? `${this.groundNets.length} laid` : '';
  }

  override debugState(): Record<string, unknown> {
    return {
      ...super.debugState(), phase: this.phase, phaseT: +this.phaseT.toFixed(3),
      active: this.active, swings: this.swings, caught: this.caught, misses: this.misses,
      lock: +this.lock.toFixed(2),
      hoop: [+this.hoop.x.toFixed(2), +this.hoop.y.toFixed(2), +this.hoop.z.toFixed(2)],
      window: [CatchNet.ACTIVE_FROM, CatchNet.ACTIVE_TO, CatchNet.SWING, CatchNet.RECOVER],
    };
  }

  override onEquip(): void { super.onEquip(); }
}

// ---------------------------------------------------------------------------
// ROPE GUN — the tool the whole late game is built on
// ---------------------------------------------------------------------------
export class RopeGun extends Tool {
  readonly def: ToolDef = {
    id: 'ropegun', label: 'Rope Gun', icon: '🪝',
    description: 'Tethers you to anything. Right-click to pin the near end, hold to winch.',
    tagline: 'Fruit picking was not supposed to require a harpoon. This is the warm-up.',
    cost: 720, tier: 1,
  };

  private ropes!: RopeSystem;
  /** Ropes this gun currently owns, most recent last. */
  private mine: Rope[] = [];
  maxRopes = 4;
  range = 34;
  /** Winch speed ramps in rather than starting at full rate. */
  private winchSpeed = 0;
  /** Seconds until the next winch tick; the ratchet is a rhythm, not noise. */
  private winchTick = 0;

  override onAttach(): void {
    this.ropes = this.game.get<RopeSystem>('ropes');
    // A rope going taut is the tool's most important piece of information and
    // the player is usually looking the other way when it happens, so it gets
    // a sound and a bite in the view rather than only a thicker line.
    this.game.bus.on('rope:taut', (p) => {
      if (!p.taut || !this.mine.some((r) => r.id === p.ropeId)) return;
      this.game.bus.emit('audio:sfx', {
        name: 'ropeStrain', volume: 0.55,
        pitch: clamp(0.8 + p.tension / 4000, 0.8, 1.9),
      });
    });
    this.game.bus.on('rope:tug', (p) => {
      if (!this.mine.some((r) => r.id === p.ropeId)) return;
      const k = clamp(p.speed / 9, 0, 1);
      this.game.playerCamera.addShake(0.01 + k * 0.05, 0.22 + k * 0.2, 24);
      this.game.playerCamera.addRecoil((Math.random() - 0.5) * 0.02 * k, -0.03 * k);
      // Only a serious yank goes through the arms as well as the head.
      if (k > 0.5) this.game.bus.emit('tool:fired', { toolId: this.def.id, power: 0.5 + k * 0.9 });
    });
  }

  override onPrimary(down: boolean): void {
    if (!down || this.cooldown > 0) return;
    const p = this.player;
    const hit = this.game.physics.raycast(
      p.eyePosition.clone(), this.aim(_dir), this.range, QueryMask.interact, p.body);
    if (!hit) {
      this.game.bus.emit('ui:toast', { text: 'Nothing in range', ms: 1200 });
      return;
    }
    this.cooldown = 0.35;

    // A fixed body is a world point as far as a rope cares — except the
    // legendary, which hangs FIXED until its first vine is cut. A rope pinned
    // to the melon's surface in world space held nothing when it fell: the
    // line stayed up in the air and the melon went without it.
    const targetBody = hit.body && (!hit.body.isFixed() || hit.owner?.kind === 'legendary') ? hit.body : null;
    const owner = hit.owner;
    // Local anchor on a moving target, world point on static geometry.
    let bLocal: THREE.Vector3;
    if (targetBody) {
      const t = targetBody.translation();
      bLocal = _v.set(hit.point.x - t.x, hit.point.y - t.y, hit.point.z - t.z).clone();
    } else {
      bLocal = hit.point.clone();
    }

    const rope = this.ropes.create(
      { body: p.body, local: new THREE.Vector3(0, 1.2, 0), ownerId: p.id },
      { body: targetBody, local: bLocal, ownerId: owner?.id ?? -1 },
      Math.max(2.5, hit.distance * 1.12),
      { heldByPlayer: true, maxTension: 4200 },
    );
    this.mine.push(rope);
    while (this.mine.length > this.maxRopes) {
      const old = this.mine.shift();
      if (old) this.ropes.remove(old.id);
    }
    // Anything tethered resists a Vinebomb launch.
    if (owner?.kind === 'fruit') {
      const f = this.ctx.fruit.get(owner.id);
      if (f) f.restraint = Math.min(0.95, f.restraint + 0.42);
    }
    this.game.playerCamera.addRecoil(0, 0.012);
    this.game.bus.emit('audio:sfx', { name: 'ropeFire', position: hit.point });
    this.game.bus.emit('tool:fired', { toolId: this.def.id, power: 0.7 });
  }

  /**
   * Tap: move the near end of the newest rope from the player onto whatever you
   * are looking at, turning a personal tether into a fixed one. Hold: winch.
   */
  override onSecondary(down: boolean): void {
    if (!down) { this.stopWinch(); return; }
    this.secondaryHeldFor = 0;
  }
  private secondaryHeldFor = -1;

  private stopWinch(): void {
    for (const r of this.mine) this.ropes.setReel(r.id, 0);
    if (this.secondaryHeldFor >= 0 && this.secondaryHeldFor < 0.28) this.pinNearEnd();
    this.secondaryHeldFor = -1;
    this.winchSpeed = 0;
    this.winchTick = 0;
  }

  private pinNearEnd(): void {
    const rope = this.mine[this.mine.length - 1];
    if (!rope) { this.game.bus.emit('ui:toast', { text: 'No rope to pin', ms: 1200 }); return; }
    const p = this.player;
    const hit = this.game.physics.raycast(
      p.eyePosition.clone(), this.aim(_dir), this.range, QueryMask.interact, p.body);
    if (!hit) return;
    // Rebuild the rope with the far end kept and the near end pinned.
    const far = rope.b;
    const len = rope.length;
    this.ropes.remove(rope.id);
    const idx = this.mine.indexOf(rope);
    // A fixed body is a world point as far as a rope cares — except the
    // legendary, which hangs FIXED until its first vine is cut. A rope pinned
    // to the melon's surface in world space held nothing when it fell: the
    // line stayed up in the air and the melon went without it.
    const targetBody = hit.body && (!hit.body.isFixed() || hit.owner?.kind === 'legendary') ? hit.body : null;
    let aLocal: THREE.Vector3;
    if (targetBody) {
      const t = targetBody.translation();
      aLocal = new THREE.Vector3(hit.point.x - t.x, hit.point.y - t.y, hit.point.z - t.z);
    } else {
      aLocal = hit.point.clone();
    }
    const fresh = this.ropes.create(
      { body: targetBody, local: aLocal, ownerId: hit.owner?.id ?? -1 },
      { body: far.body, local: far.local, ownerId: far.ownerId },
      len, { maxTension: 5200 },
    );
    if (idx >= 0) this.mine[idx] = fresh; else this.mine.push(fresh);
    this.game.bus.emit('ui:toast', { text: 'Rope anchored', kind: 'good', ms: 1400 });
    this.game.bus.emit('audio:sfx', { name: 'ropeAnchor', position: hit.point });
  }

  override step(dt: number, held: { primary: boolean; secondary: boolean }): void {
    super.step(dt, held);
    // Drop ropes whose far end has been sold, eaten or otherwise removed.
    this.mine = this.mine.filter((r) => this.ropes.ropes.has(r.id));
    if (held.secondary && this.secondaryHeldFor >= 0) {
      this.secondaryHeldFor += dt;
      if (this.secondaryHeldFor > 0.28) {
        const rope = this.mine[this.mine.length - 1];
        if (rope) {
          // Spin up rather than snapping to full rate: a winch that reaches
          // 2.4 m/s on the first frame reads as a teleport, and it is the
          // ramp that makes fine positioning under a load possible at all.
          this.winchSpeed = Math.min(2.6, this.winchSpeed + dt * 5.0);
          this.ropes.setReel(rope.id, -this.winchSpeed);
          // A ratchet at a steady rate, pitched by how hard it is working.
          this.winchTick -= dt;
          if (this.winchTick <= 0) {
            this.winchTick = 0.16;
            this.game.bus.emit('audio:sfx', {
              name: 'winch', volume: 0.3 + (this.winchSpeed / 2.6) * 0.25,
              pitch: clamp(0.8 + rope.tension / 2600, 0.8, 1.7),
            });
          }
        }
      }
    } else if (this.winchSpeed !== 0) {
      this.winchSpeed = 0;
    }
  }

  /** Q releases the newest rope. */
  releaseNewest(): boolean {
    const rope = this.mine.pop();
    if (!rope) return false;
    // Cutting loose under load should feel like letting go of something, not
    // like a line vanishing from the scene.
    const loaded = clamp(rope.tension / 3000, 0, 1);
    this.ropes.remove(rope.id);
    this.game.bus.emit('audio:sfx', {
      name: 'ropeSnap', volume: 0.25 + loaded * 0.45, pitch: 1.35 - loaded * 0.35,
    });
    if (loaded > 0.05) this.game.playerCamera.addShake(0.008 + loaded * 0.022, 0.2, 26);
    return true;
  }

  /** Length, and how hard the newest rope is pulling. */
  override status(): string {
    const rope = this.mine[this.mine.length - 1];
    if (!rope) return '';
    const taut = rope.tension > 60 ? ' ‼' : rope.tension > 1 ? ' ·' : '';
    return `${this.mine.length} · ${rope.length.toFixed(1)}m${taut}`;
  }
  override onUnequip(): void { super.onUnequip(); this.stopWinch(); }
}

// ---------------------------------------------------------------------------
// AIR CANNON — the escalation tool
// ---------------------------------------------------------------------------
export class AirCannon extends Tool {
  readonly def: ToolDef = {
    id: 'aircannon', label: 'Air Cannon', icon: '💨',
    description: 'A directed blast of compressed air. Hold to charge.',
    tagline: 'Harvests fruit, teammates, and your own dignity.',
    cost: 1450, tier: 2,
  };

  private charging = false;
  private recharge = 1;
  /** Seconds of FOV punch left, its full duration, and its peak offset. */
  private fovLeft = 0;
  private fovTotal = 0;
  private fovPeak = 0;
  /** Charge milestones already announced, so the whine steps rather than buzzes. */
  private chargeStep = 0;
  blastRange = 13;
  blastRadius = 3.6;
  /** Instrumentation for the harness. */
  fires = 0;
  lastPushed = 0;
  lastPower = 0;
  lastBlocked = '';
  lastRecoil: [number, number, number] = [0, 0, 0];
  lastCentre: [number, number, number] = [0, 0, 0];
  lastRadius = 0;
  lastVelAfter: [number, number, number] = [0, 0, 0];

  override onPrimary(down: boolean): void {
    if (down) { this.charging = true; this.charge = 0; this.chargeStep = 0; return; }
    if (!this.charging) return;
    this.charging = false;
    // A tap is a puff and a full charge is a cannon. The old floor of 0.42
    // meant a tap already did 43% of the damage of a full wind-up, so holding
    // the button was a formality rather than a decision.
    this.fire(0.28 + this.charge * 0.72);
    this.charge = 0;
    this.chargeStep = 0;
  }

  /** Fire straight down: the self-launch everyone discovers within a minute. */
  override onSecondary(down: boolean): void {
    if (!down || this.recharge < 0.55) {
      if (down) this.dryFire();
      return;
    }
    this.recharge -= 0.55;
    const p = this.player;
    _v.set(0, 1, 0).multiplyScalar(13.5);
    p.addImpulseVelocity(_v, false, 'aircannon');
    this.game.playerCamera.addShake(0.05, 0.4, 24);
    this.game.playerCamera.addRecoil(0, 0.05);
    this.punchFov(9, 0.26);
    this.game.bus.emit('audio:sfx', { name: 'cannon', volume: 0.9, pitch: 0.82 });
    this.game.bus.emit('tool:fired', { toolId: this.def.id, power: 2.0 });
    this.game.bus.emit('tool:blast', {
      toolId: this.def.id, point: p.position.clone(), power: 1, radius: 4.0,
    });
    this.ctx.fruit.blast(p.position.clone(), 4.0, 5.5, 0.2);
  }

  /**
   * A FOV kick that lives on the fixed step rather than on `setTimeout`.
   *
   * The wall clock is the wrong clock for anything the player sees: with the
   * game paused (the harness does this for every scenario) a timeout still
   * fires, and at 20 fps a 220 ms timeout lands four frames late.
   */
  private punchFov(amount: number, seconds: number): void {
    this.fovPeak = amount;
    this.fovLeft = seconds;
    this.fovTotal = seconds;
    this.game.renderer.setFovOffset(amount);
  }

  /** Nothing in the tank. Say so with a click instead of only a toast. */
  private dryFire(): void {
    this.game.bus.emit('audio:sfx', { name: 'ropeAnchor', volume: 0.22, pitch: 0.55 });
  }

  private fire(power: number): void {
    this.lastPower = power;
    if (this.recharge < 0.3) {
      this.lastBlocked = 'recharge';
      this.dryFire();
      this.game.bus.emit('ui:toast', { text: 'Compressor still building', ms: 1200 });
      return;
    }
    this.lastBlocked = '';
    this.fires++;
    this.recharge = Math.max(0, this.recharge - (0.3 + power * 0.35));
    const p = this.player;
    this.aim(_dir);
    this.muzzle(_pos, 1.0);

    // The blast centre is placed where the barrel is pointing, at whatever it
    // hits first — so blasting a tree trunk shakes the tree, and blasting past
    // it launches whatever is behind.
    const hit = this.game.physics.raycast(_pos.clone(), _dir, this.blastRange, QueryMask.solidFruit, p.body);
    const dist = hit ? hit.distance : this.blastRange;
    _v.copy(_pos).addScaledVector(_dir, dist);

    const radius = this.blastRadius * (0.75 + power * 0.5);
    // Measured at the old value: a full-charge blast left an apple doing
    // 11.7 m/s, which is slower than throwing the same apple by hand (21 m/s).
    // A $1450 compressed-air cannon has to beat an arm.
    const strength = 22 * power;
    const pushed = this.ctx.fruit.blast(_v, radius, strength, 0.30);
    this.lastPushed = pushed;
    this.lastCentre = [+_v.x.toFixed(2), +_v.y.toFixed(2), +_v.z.toFixed(2)];
    this.lastRadius = +radius.toFixed(2);

    // Shake any plant caught in the blast, so the cannon also harvests.
    for (const plant of this.ctx.fruit.plants.all()) {
      const d = plant.position.distanceTo(_v);
      if (d < radius + 2.5) {
        this.ctx.fruit.shake(plant.id, 2.1 * power * (1 - d / (radius + 3)), p.id);
      }
    }

    // Recoil, scaled with the blast so the two stay honest with each other:
    // a tap still pushes you off your mark, a full charge is a decision. It
    // stays under the 13.5 m/s knockdown bar, so the cannon shoves you around
    // without ever flattening you for using it.
    _v2.copy(_dir).multiplyScalar(-8.5 * power);
    _v2.y += 2.0 * power;
    this.lastRecoil = [+_v2.x.toFixed(2), +_v2.y.toFixed(2), +_v2.z.toFixed(2)];
    p.addImpulseVelocity(_v2, false, 'aircannon');
    this.lastVelAfter = [+p.velocity.x.toFixed(2), +p.velocity.y.toFixed(2), +p.velocity.z.toFixed(2)];

    this.game.playerCamera.addShake(0.03 + power * 0.055, 0.34 + power * 0.16, 26);
    this.game.playerCamera.addRecoil((Math.random() - 0.5) * 0.022 * power, 0.045 * power);
    this.punchFov(3 + 6 * power, 0.16 + power * 0.12);
    // Deeper and louder the harder it is charged, so the wind-up pays off in
    // the ear as well as in the physics.
    this.game.bus.emit('audio:sfx', {
      name: 'cannon', volume: 0.55 + power * 0.45, pitch: 1.18 - power * 0.36,
    });
    this.game.bus.emit('tool:fired', { toolId: this.def.id, power: 0.5 + power * 1.3 });
    // Where the blast LANDED, which up to now the player could only infer from
    // what happened to move. A $1450 cannon that leaves no mark on the world
    // reads as a physics cheat rather than as a tool.
    this.game.bus.emit('tool:blast', {
      toolId: this.def.id, point: _v.clone(), power, radius,
    });
    if (pushed > 2) {
      this.game.bus.emit('ui:toast', { text: `${pushed} objects airborne`, ms: 1500 });
    }
  }

  override step(dt: number, held: { primary: boolean }): void {
    super.step(dt, held as never);
    this.recharge = Math.min(1, this.recharge + dt * 0.42);
    if (this.charging && held.primary) {
      this.charge = Math.min(1, this.charge + dt * 1.35);
      // Three rising clicks and a distinct top-out, so the wind-up is
      // audible without needing a looping voice.
      const step = this.charge >= 1 ? 4 : this.charge > 0.72 ? 3 : this.charge > 0.42 ? 2 : 1;
      if (step > this.chargeStep) {
        this.chargeStep = step;
        this.game.bus.emit('audio:sfx', {
          name: step === 4 ? 'ropeAnchor' : 'winch',
          volume: step === 4 ? 0.3 : 0.22, pitch: 0.9 + step * 0.22,
        });
      }
    }
    if (this.fovLeft > 0) {
      this.fovLeft = Math.max(0, this.fovLeft - dt);
      const k = this.fovTotal > 0 ? this.fovLeft / this.fovTotal : 0;
      this.game.renderer.setFovOffset(this.fovPeak * k * k);
    }
  }

  override onUnequip(): void {
    super.onUnequip();
    this.charging = false;
    this.chargeStep = 0;
    if (this.fovLeft > 0) { this.fovLeft = 0; this.game.renderer.setFovOffset(0); }
  }

  override background(dt: number): void {
    this.recharge = Math.min(1, this.recharge + dt * 0.22);
  }

  override status(): string {
    if (this.charging) return `${Math.round(this.charge * 100)}%`;
    return `${Math.round(this.recharge * 100)}%`;
  }

  override debugState(): Record<string, unknown> {
    return {
      ...super.debugState(), charging: this.charging,
      recharge: +this.recharge.toFixed(3), fires: this.fires,
      lastPushed: this.lastPushed, lastPower: +this.lastPower.toFixed(3),
      lastBlocked: this.lastBlocked, lastRecoil: this.lastRecoil,
      lastCentre: this.lastCentre, lastRadius: this.lastRadius,
      lastVelAfter: this.lastVelAfter,
    };
  }
}

// ---------------------------------------------------------------------------
// UTILITY: BASKET
// ---------------------------------------------------------------------------
export class BasketTool extends Tool {
  readonly def: ToolDef = {
    id: 'basket', label: 'Basket', icon: '🧺',
    description: 'Holds nine small fruit. Not a watermelon.',
    tagline: 'Wicker. Genuinely wicker.',
    cost: 0, tier: 0, utility: true, starter: true,
  };

  override onPrimary(down: boolean): void {
    if (!down) return;
    const inter = this.ctx.interaction;
    if (inter.carried) inter.stowHeld();
  }

  /** Tip the basket out, for when you need your hands and the ground is fine. */
  override onSecondary(down: boolean): void {
    if (!down) return;
    // The spill itself lives in InteractionSystem: nine fruit going back into
    // the world is nine authority transitions, and they belong on the same
    // path as dropping one.
    const n = this.ctx.interaction.tipOutBasket();
    if (!n) return;
    this.game.bus.emit('ui:toast', { text: `Tipped out ${n}`, ms: 1500 });
  }

  override status(): string {
    const b = this.ctx.interaction.basket;
    return `${b.items.length}/${b.capacity}`;
  }
}

// ---------------------------------------------------------------------------
// UTILITY: LADDER
// ---------------------------------------------------------------------------
export class LadderTool extends Tool {
  readonly def: ToolDef = {
    id: 'ladder', label: 'Ladder', icon: '🪜',
    description: 'Place it, climb it. Look up and hold forward.',
    tagline: 'The least unreasonable equipment you will ever own.',
    cost: 0, tier: 0, utility: true, starter: true,
  };

  private placed: {
    mesh: THREE.Mesh; body: RAPIER.RigidBody; base: THREE.Vector3; top: number; yaw: number;
  } | null = null;
  height = 5.2;

  override onPrimary(down: boolean): void {
    if (!down || this.cooldown > 0) return;
    this.cooldown = 0.4;
    const p = this.player;
    const hit = this.game.physics.raycast(
      p.eyePosition.clone(), this.aim(_dir), 7, QueryMask.solid, p.body);
    if (!hit) { this.game.bus.emit('ui:toast', { text: 'Aim somewhere closer', ms: 1200 }); return; }
    this.place(hit.point, p.yaw);
  }

  override onSecondary(down: boolean): void {
    if (!down) return;
    this.pickUpLadder();
  }

  private place(at: THREE.Vector3, yaw: number): void {
    this.pickUpLadder();
    const base = at.clone();
    base.y = this.game.get<{ terrain: { height(x: number, z: number): number } }>('world')
      .terrain.height(base.x, base.z);

    const mesh = buildLadderMesh(this.height);
    mesh.position.copy(base);
    mesh.rotation.y = yaw;
    this.game.renderer.scene.add(mesh);

    // A thin static body so the ladder is solid to lean on and to land on.
    const body = this.game.physics.createFixed(
      _v.copy(base).add(_v2.set(0, this.height / 2, 0)),
      new THREE.Quaternion().setFromAxisAngle(UP, yaw));
    const desc = RAPIER.ColliderDesc.cuboid(0.34, this.height / 2, 0.09).setFriction(0.9);
    this.game.physics.attach(body, desc, Groups.prop);

    this.placed = { mesh, body, base, top: base.y + this.height - 0.4, yaw };
    this.game.bus.emit('audio:sfx', { name: 'ladderPlace', position: base });
  }

  private pickUpLadder(): void {
    if (!this.placed) return;
    this.game.renderer.scene.remove(this.placed.mesh);
    this.placed.mesh.geometry.dispose();
    (this.placed.mesh.material as THREE.Material).dispose();
    this.game.physics.removeBody(this.placed.body);
    this.placed = null;
    this.player.climbVolume = null;
  }

  /** Ladders work whether or not the tool is the one in hand. */
  override background(_dt: number): void {
    const l = this.placed;
    const p = this.player;
    if (!l) { if (p.climbVolume) p.climbVolume = null; return; }
    const dx = p.position.x - l.base.x;
    const dz = p.position.z - l.base.z;
    const near = dx * dx + dz * dz < 1.3 * 1.3;
    const withinHeight = p.position.y > l.base.y - 1 && p.position.y < l.top + 1.4;
    if (near && withinHeight) {
      p.climbVolume = { top: l.top, climbSpeed: 3.6 };
    } else if (p.climbVolume) {
      p.climbVolume = null;
    }
  }

  override status(): string { return this.placed ? 'placed' : ''; }
  override onUnequip(): void { super.onUnequip(); }
}

function buildLadderMesh(height: number): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const rail = (x: number) => {
    const g = new THREE.BoxGeometry(0.09, height, 0.09);
    g.translate(x, height / 2, 0);
    return g;
  };
  parts.push(rail(-0.28), rail(0.28));
  const rungs = Math.floor(height / 0.42);
  for (let i = 1; i <= rungs; i++) {
    const g = new THREE.BoxGeometry(0.62, 0.06, 0.06);
    g.translate(0, i * 0.42, 0);
    parts.push(g);
  }
  const merged = parts.reduce((acc: THREE.BufferGeometry | null, g) => {
    if (!acc) return g;
    return acc;
  }, null);
  void merged;
  // Merge by hand to avoid pulling in the merge helper for four boxes.
  const geo = mergeSimple(parts);
  const mat = new THREE.MeshStandardMaterial({
    color: Palette.wood, roughness: 0.85, flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'Ladder';
  return mesh;
}

/** Concatenate position/normal buffers from same-attribute non-indexed boxes. */
function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flats = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  let total = 0;
  for (const f of flats) total += f.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  let o = 0;
  for (const f of flats) {
    const p = f.getAttribute('position') as THREE.BufferAttribute;
    const n = f.getAttribute('normal') as THREE.BufferAttribute;
    pos.set(p.array as Float32Array, o * 3);
    nrm.set(n.array as Float32Array, o * 3);
    o += p.count;
    f.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.computeBoundingSphere();
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
/** Catch-net ring tints. Allocated once; the material lerps between them. */
const WHITE = new THREE.Color(1, 1, 1);
const GOLD = new THREE.Color(1.0, 0.78, 0.26);

export const ALL_TOOLS: Array<new () => Tool> = [
  HandPicker, CatchNet, TreeShaker, RopeGun, AirCannon, BasketTool, LadderTool,
];

export type { Fruit };
