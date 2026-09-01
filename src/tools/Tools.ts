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

  override onPrimary(down: boolean): void {
    const inter = this.ctx.interaction;
    if (down) { this.charge = 0; return; }
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
    if (held.primary && this.ctx.interaction.carried) {
      this.charge = Math.min(1, this.charge + dt * 1.9);
    } else if (!held.primary) {
      this.charge = 0;
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
    this.game.bus.emit('tool:fired', { toolId: this.def.id });
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
export class CatchNet extends Tool {
  readonly def: ToolDef = {
    id: 'net', label: 'Catch Net', icon: '🥅',
    description: 'Hold to sweep the air in front of you. Catches anything moving.',
    tagline: 'The difference between a harvest and a mess.',
    cost: 260, tier: 0,
  };

  private active = false;
  /** Ground nets soften whatever lands on them. */
  private groundNets: Array<{ pos: THREE.Vector3; radius: number; until: number; mesh: THREE.Mesh }> = [];
  private ring: THREE.Mesh | null = null;
  catchRadius = 1.55;
  catchDistance = 2.0;
  caught = 0;

  override onAttach(): void {
    const geo = new THREE.TorusGeometry(this.catchRadius, 0.05, 6, 20);
    const mat = new THREE.MeshStandardMaterial({
      color: Palette.rope, roughness: 0.9, transparent: true, opacity: 0.85,
    });
    this.ring = new THREE.Mesh(geo, mat);
    this.ring.visible = false;
    this.ring.frustumCulled = false;
    this.game.renderer.scene.add(this.ring);
  }

  override onPrimary(down: boolean): void { this.active = down; }
  override onUnequip(): void { super.onUnequip(); this.active = false; if (this.ring) this.ring.visible = false; }

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

  override step(dt: number, held: { primary: boolean }): void {
    super.step(dt, held as never);
    if (this.ring) {
      this.ring.visible = this.active;
      if (this.active) {
        this.muzzle(_pos, this.catchDistance);
        this.ring.position.copy(_pos);
        this.ring.quaternion.copy(this.game.renderer.camera.quaternion);
      }
    }
    if (this.active) this.sweep();
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

  /** Catch anything moving through the hoop. */
  private sweep(): void {
    this.muzzle(_pos, this.catchDistance);
    const inter = this.ctx.interaction;
    const r2 = this.catchRadius * this.catchRadius;
    for (const f of this.ctx.fruit.fruits.values()) {
      if (f.state !== 'free' || !f.body) continue;
      if (f.position.distanceToSquared(_pos) > r2) continue;
      // Too heavy to catch by hand — but it does get slowed down a lot.
      if (f.mass > 14) {
        const v = f.body.linvel();
        f.body.setLinvel({ x: v.x * 0.72, y: v.y * 0.72, z: v.z * 0.72 }, true);
        continue;
      }
      const speed = f.speed;
      this.caught++;
      this.game.bus.emit('audio:sfx', { name: 'netCatch', position: f.position.clone() });
      if (speed > 5.5 && f.position.y > this.player.position.y + 0.4) {
        this.game.bus.emit('stunt:candidate', { fruitId: f.id, kind: 'midAir' });
      }
      inter.pickUp(f);
      inter.stowHeld();
      break; // one per step, so a burst of fruit reads as a sequence of catches
    }
  }

  override status(): string {
    return this.groundNets.length ? `${this.groundNets.length} laid` : '';
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

  override onAttach(): void {
    this.ropes = this.game.get<RopeSystem>('ropes');
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

    const targetBody = hit.body && !hit.body.isFixed() ? hit.body : null;
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
    this.game.bus.emit('tool:fired', { toolId: this.def.id });
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
    const targetBody = hit.body && !hit.body.isFixed() ? hit.body : null;
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
          this.ropes.setReel(rope.id, -2.4);
          if (Math.random() < 0.04) {
            this.game.bus.emit('audio:sfx', { name: 'winch', volume: 0.4 });
          }
        }
      }
    }
  }

  /** Q releases the newest rope. */
  releaseNewest(): boolean {
    const rope = this.mine.pop();
    if (!rope) return false;
    this.ropes.remove(rope.id);
    return true;
  }

  override status(): string { return this.mine.length ? `${this.mine.length}` : ''; }
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
    if (down) { this.charging = true; this.charge = 0; return; }
    if (!this.charging) return;
    this.charging = false;
    this.fire(0.42 + this.charge * 0.58);
    this.charge = 0;
  }

  /** Fire straight down: the self-launch everyone discovers within a minute. */
  override onSecondary(down: boolean): void {
    if (!down || this.recharge < 0.55) return;
    this.recharge -= 0.55;
    const p = this.player;
    _v.set(0, 1, 0).multiplyScalar(13.5);
    p.addImpulseVelocity(_v, false, 'aircannon');
    this.game.playerCamera.addShake(0.05, 0.4, 24);
    this.game.renderer.setFovOffset(9);
    setTimeout(() => this.game.renderer.setFovOffset(0), 260);
    this.game.bus.emit('audio:sfx', { name: 'cannon', volume: 0.9 });
    this.game.physics.explode(p.position.clone(), 4.0, 5.5, 0.2);
  }

  private fire(power: number): void {
    this.lastPower = power;
    if (this.recharge < 0.3) {
      this.lastBlocked = 'recharge';
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
    const strength = 13 * power;
    const pushed = this.game.physics.explode(_v, radius, strength, 0.30);
    this.lastPushed = pushed.length;
    this.lastCentre = [+_v.x.toFixed(2), +_v.y.toFixed(2), +_v.z.toFixed(2)];
    this.lastRadius = +radius.toFixed(2);

    // Shake any plant caught in the blast, so the cannon also harvests.
    for (const plant of this.ctx.fruit.plants.all()) {
      const d = plant.position.distanceTo(_v);
      if (d < radius + 2.5) {
        this.ctx.fruit.shake(plant.id, 2.1 * power * (1 - d / (radius + 3)), p.id);
      }
    }

    // Recoil. Enough to matter, not enough to be an accident every time.
    _v2.copy(_dir).multiplyScalar(-6.5 * power);
    _v2.y += 1.6 * power;
    this.lastRecoil = [+_v2.x.toFixed(2), +_v2.y.toFixed(2), +_v2.z.toFixed(2)];
    p.addImpulseVelocity(_v2, false, 'aircannon');
    this.lastVelAfter = [+p.velocity.x.toFixed(2), +p.velocity.y.toFixed(2), +p.velocity.z.toFixed(2)];

    this.game.playerCamera.addShake(0.035 + power * 0.045, 0.4, 26);
    this.game.playerCamera.addRecoil((Math.random() - 0.5) * 0.02, 0.035 * power);
    this.game.renderer.setFovOffset(5 * power);
    setTimeout(() => this.game.renderer.setFovOffset(0), 220);
    this.game.bus.emit('audio:sfx', { name: 'cannon', volume: 0.6 + power * 0.4 });
    this.game.bus.emit('tool:fired', { toolId: this.def.id });
    if (pushed.length > 2) {
      this.game.bus.emit('ui:toast', { text: `${pushed.length} objects airborne`, ms: 1500 });
    }
  }

  override step(dt: number, held: { primary: boolean }): void {
    super.step(dt, held as never);
    this.recharge = Math.min(1, this.recharge + dt * 0.42);
    if (this.charging && held.primary) this.charge = Math.min(1, this.charge + dt * 1.35);
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
    const inter = this.ctx.interaction;
    const items = [...inter.basket.items];
    if (!items.length) return;
    inter.basket.items.length = 0;
    inter.basket.massCarried = 0;
    const p = this.player;
    p.lookDir(_dir);
    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      const a = (i / items.length) * Math.PI * 2;
      f.position.copy(p.eyePosition)
        .addScaledVector(_dir, 1.1)
        .add(_v.set(Math.cos(a) * 0.35, -0.4 + i * 0.05, Math.sin(a) * 0.35));
      f.state = 'carried';
      f.release(_v2.set(Math.cos(a) * 1.1, 0.6, Math.sin(a) * 1.1));
    }
    this.game.bus.emit('ui:toast', { text: `Tipped out ${items.length}`, ms: 1500 });
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

export const ALL_TOOLS: Array<new () => Tool> = [
  HandPicker, CatchNet, TreeShaker, RopeGun, AirCannon, BasketTool, LadderTool,
];

export type { Fruit };
