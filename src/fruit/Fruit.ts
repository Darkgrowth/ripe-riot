import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld, RBody, RCollider, PhysicsOwner } from '@/physics/PhysicsWorld';
import { Groups } from '@/physics/Layers';
import { FRUIT, qualityFor, variantById, type FruitDef, type QualityTier, type VariantDef } from './FruitDefs';
import { traitsFor, type FruitTrait, type TraitContext } from './FruitTraits';
import { clamp } from '@/core/MathUtils';

export type FruitState = 'attached' | 'free' | 'carried' | 'stowed' | 'gone';

export interface AttachPoint {
  /** Owning plant, used to look the node transform up each frame. */
  plantId: number;
  nodeIndex: number;
  /** World-space transform, refreshed by the plant when it sways. */
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * One harvestable fruit. Deliberately has no mesh of its own: FruitRenderer
 * draws every fruit of a species from one InstancedMesh, so a thousand apples
 * cost one draw call and the fruit object stays cheap enough to keep hundreds
 * of them alive across the island.
 */
export class Fruit implements PhysicsOwner {
  readonly kind = 'fruit';
  readonly id: number;
  def: FruitDef;
  variant: VariantDef | null;
  state: FruitState = 'attached';

  /** Natural size multiplier (variation + variant), before inflation. */
  sizeScale = 1;
  /** Current inflation multiplier (Puff Melon). */
  inflate = 1;
  inflateTarget = 1;
  inflating = false;
  mass = 1;
  damage = 0;
  ripeness = 1;
  /** Extra tint applied by variant and condition. */
  tint = new THREE.Color(1, 1, 1);
  emissive = 0;

  position = new THREE.Vector3();
  quaternion = new THREE.Quaternion();
  attach: AttachPoint | null = null;

  body: RBody | null = null;
  colliders: RCollider[] = [];
  /** A cheap fixed collider used while attached and near a player. */
  private staticCollider: RCollider | null = null;
  private staticBody: RBody | null = null;

  traits: FruitTrait[] = [];
  /** Vinebomb: stored launch speed and direction. */
  tension = 0;
  tensionDir = new THREE.Vector3(0, 1, 0);
  /** 0 = free to launch, 1 = fully restrained by ropes/nets/hands. */
  restraint = 0;
  /** Volatile charge. */
  charge = 0;
  jitterTimer = 0;
  stuck = false;
  destroyed = false;

  /** Who last caused it to move — used for stunt attribution. */
  lastToucherId = -1;
  detachedAt = -1;
  detachPosition = new THREE.Vector3();
  /** Highest airborne height reached since detaching, for stunt scoring. */
  peakHeight = 0;
  airborneTime = 0;
  /** Total ground distance travelled since detaching. */
  travelled = 0;
  private lastTravelSample = new THREE.Vector3();
  /** Set while any tool has a hold of it. */
  heldBy = -1;
  /** Speed at the end of the previous fixed step, for impact detection. */
  private prevSpeed = 0;
  /** Velocity lost in the most recent step. The honest measure of an impact. */
  lastDeltaV = 0;
  /** Flight record, read by HarvestScoring when the fruit is finally banked. */
  touchedGround = false;
  bounces = 0;
  maxSpeedSinceDetach = 0;
  caughtInAir = false;

  private physics: PhysicsWorld;
  private baseRadius = 0.5;

  constructor(physics: PhysicsWorld, id: number, speciesId: string, variantId: string | null, sizeRoll: number) {
    this.physics = physics;
    this.id = id;
    this.def = FRUIT[speciesId];
    if (!this.def) throw new Error(`Unknown fruit species: ${speciesId}`);
    this.variant = variantById(variantId);

    const natural = 1 + (sizeRoll * 2 - 1) * this.def.sizeVar;
    this.sizeScale = natural * (this.variant?.sizeMul ?? 1);
    this.mass = this.def.mass * Math.pow(this.sizeScale, 3) * (this.variant?.massMul ?? 1);
    this.baseRadius = (this.def.size * this.sizeScale) / 2;

    this.traits = traitsFor([...this.def.traits, ...(this.variant?.traits ?? [])]);
    for (const t of this.traits) if (t.massMul) this.mass *= t.massMul(this);
    this.emissive = this.variant?.emissive ?? 0;
    this.refreshTint();
  }

  // ---- derived ------------------------------------------------------------
  get species(): string { return this.def.id; }
  get radius(): number { return this.baseRadius * this.inflate; }
  get diameter(): number { return this.radius * 2; }
  get renderScale(): number { return this.def.size * this.sizeScale * this.inflate; }
  get quality(): QualityTier { return qualityFor(this.damage).tier; }
  /** World gravity, so traits can express lift in gravities rather than N/kg. */
  get gravity(): number { return this.physics.gravity; }
  get fragility(): number { return this.def.fragility * (this.variant?.fragilityMul ?? 1); }
  get visible(): boolean { return this.state !== 'stowed' && this.state !== 'gone'; }

  hasTrait(id: string): boolean { return this.traits.some((t) => t.id === id); }

  /** Money this fruit is worth right now. */
  value(): number {
    const q = qualityFor(this.damage);
    // Size contributes sub-linearly so a Huge apple is worth more but not 4x.
    const sizeFactor = Math.pow(this.sizeScale, 1.5);
    const v = this.def.baseValue * sizeFactor * (this.variant?.valueMul ?? 1) * q.mult;
    return Math.max(1, Math.round(v));
  }

  get displayName(): string {
    return this.variant ? `${this.variant.label} ${this.def.label}` : this.def.label;
  }

  // ---- lifecycle ----------------------------------------------------------
  attachTo(point: AttachPoint): void {
    this.attach = point;
    this.state = 'attached';
    this.position.copy(point.position);
    this.quaternion.copy(point.quaternion);
  }

  /** Refresh transform from the plant. Called by the plant each frame it sways. */
  syncToAttachment(): void {
    if (!this.attach) return;
    this.position.copy(this.attach.position);
    this.quaternion.copy(this.attach.quaternion);
    if (this.staticBody) {
      this.staticBody.setTranslation({ x: this.position.x, y: this.position.y, z: this.position.z }, false);
    }
  }

  /**
   * Give attached fruit a real (fixed) collider so tools and thrown objects can
   * hit it. Only worth doing near a player: the island holds hundreds of these.
   */
  setNearby(on: boolean): void {
    if (this.state !== 'attached') { this.clearStatic(); return; }
    if (on === !!this.staticBody) return;
    if (on) {
      this.staticBody = this.physics.createFixed(this.position);
      const desc = RAPIER.ColliderDesc.ball(this.radius)
        .setFriction(this.def.friction)
        .setRestitution(this.def.restitution)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(6);
      this.staticCollider = this.physics.attach(this.staticBody, desc, Groups.fruit);
      this.physics.register(this, this.staticBody, [this.staticCollider]);
    } else {
      this.clearStatic();
    }
  }

  private clearStatic(): void {
    if (!this.staticBody) return;
    this.physics.removeBody(this.staticBody, this.staticCollider ? [this.staticCollider] : []);
    this.staticBody = null;
    this.staticCollider = null;
  }

  /** Detach from the plant and start simulating. */
  detach(ctx: TraitContext, cause: string, playerId = -1, inheritVel?: THREE.Vector3): void {
    if (this.state !== 'attached') return;
    this.clearStatic();
    this.attach = null;
    this.state = 'free';
    this.lastToucherId = playerId;
    this.detachedAt = ctx.elapsed;
    this.detachPosition.copy(this.position);
    this.lastTravelSample.copy(this.position);
    this.travelled = 0;
    this.peakHeight = this.position.y;
    this.touchedGround = false;
    this.bounces = 0;
    this.maxSpeedSinceDetach = 0;
    this.caughtInAir = false;
    this.createBody(inheritVel);
    for (const t of this.traits) t.onDetach?.(this, ctx);
    ctx.emit('fruit:detached', { fruitId: this.id, species: this.species, cause, playerId });
  }

  private createBody(vel?: THREE.Vector3): void {
    const p = this.physics;
    this.body = p.createDynamic(this.position, {
      quat: this.quaternion,
      linearDamping: this.def.linearDamping,
      angularDamping: this.def.angularDamping,
      ccd: this.mass > 8 || this.radius < 0.18,
    });
    this.rebuildCollider();
    if (vel) this.body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    this.prevSpeed = vel ? vel.length() : 0;
  }

  /** Rebuild the collider after size changes (inflation, variants). */
  rebuildCollider(): void {
    if (!this.body) return;
    for (const c of this.colliders) this.physics.world.removeCollider(c, false);
    this.colliders.length = 0;
    // setMass gives the design's kilograms AND a consistent inertia tensor for
    // that shape. Setting a near-zero density and adding mass separately leaves
    // the body spinning as if it were weightless.
    const desc = RAPIER.ColliderDesc.ball(this.radius)
      .setFriction(this.def.friction)
      .setRestitution(this.def.restitution)
      .setMass(this.mass)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(4);
    const c = this.physics.attach(this.body, desc, Groups.fruit);
    this.colliders.push(c);
    this.physics.register(this, this.body, this.colliders);
  }

  setInflation(v: number): void {
    if (Math.abs(v - this.inflate) < 1e-3) return;
    this.inflate = v;
    if (this.body) this.rebuildCollider();
    if (this.inflate >= this.inflateTarget - 1e-3) this.inflating = false;
  }

  setDrag(linear: number, angular: number): void {
    if (!this.body) return;
    this.body.setLinearDamping(linear);
    this.body.setAngularDamping(angular);
  }

  /** Picked up by hand or a tool. Physics body is parked while carried. */
  pickUp(carrierId: number): void {
    if (this.state === 'gone') return;
    if (this.state === 'attached') this.clearStatic();
    this.attach = null;
    this.state = 'carried';
    this.heldBy = carrierId;
    this.lastToucherId = carrierId;
    if (this.body) {
      this.physics.removeBody(this.body, this.colliders);
      this.body = null;
      this.colliders.length = 0;
    }
  }

  /** Put a carried fruit back into the world with a velocity. */
  release(velocity: THREE.Vector3, angular?: THREE.Vector3): void {
    if (this.state !== 'carried') return;
    this.state = 'free';
    this.heldBy = -1;
    if (this.detachedAt < 0) this.detachPosition.copy(this.position);
    this.createBody(velocity);
    if (angular && this.body) {
      this.body.setAngvel({ x: angular.x, y: angular.y, z: angular.z }, true);
    }
    this.lastTravelSample.copy(this.position);
  }

  /** Into the basket: no body, no draw. */
  stow(): void {
    if (this.body) {
      this.physics.removeBody(this.body, this.colliders);
      this.body = null;
      this.colliders.length = 0;
    }
    this.clearStatic();
    this.state = 'stowed';
    this.heldBy = -1;
  }

  /** Take it back out of the basket at a given transform. */
  unstow(pos: THREE.Vector3, carrierId: number): void {
    this.position.copy(pos);
    this.state = 'carried';
    this.heldBy = carrierId;
  }

  setTransformFromCarrier(pos: THREE.Vector3, quat: THREE.Quaternion): void {
    this.position.copy(pos);
    this.quaternion.copy(quat);
  }

  /** Apply damage in 0..1 units and update the visual tint. */
  addDamage(amount: number): boolean {
    if (amount <= 0 || this.destroyed) return false;
    const before = this.quality;
    this.damage = clamp(this.damage + amount, 0, 1);
    this.refreshTint();
    return this.quality !== before;
  }

  refreshTint(): void {
    const q = qualityFor(this.damage);
    this.tint.setRGB(1, 1, 1);
    if (this.variant) this.tint.copy(this.variant.tint);
    // Bruising darkens and desaturates rather than recolouring: the species
    // should still be recognisable at a glance.
    const d = this.damage;
    if (d > 0) {
      const dark = 1 - d * 0.42;
      this.tint.multiplyScalar(dark);
      this.tint.r = clamp(this.tint.r + d * 0.10, 0, 2);
      this.tint.g = clamp(this.tint.g - d * 0.05, 0, 2);
      this.tint.b = clamp(this.tint.b - d * 0.08, 0, 2);
    }
    void q;
  }

  /** Destroy it in place: splat, no value. */
  burst(_point: THREE.Vector3, ctx: TraitContext): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.damage = 1;
    ctx.emit('fruit:destroyed', { fruitId: this.id, species: this.species, value: this.value() });
    ctx.emit('audio:sfx', { name: 'splat', position: this.position.clone() });
    this.despawn();
  }

  despawn(): void {
    if (this.body) this.physics.removeBody(this.body, this.colliders);
    this.clearStatic();
    this.body = null;
    this.colliders.length = 0;
    this.state = 'gone';
  }

  // ---- per-step -----------------------------------------------------------
  step(ctx: TraitContext): void {
    if (this.state === 'free' && this.body) {
      const t = this.body.translation();
      const r = this.body.rotation();
      this.position.set(t.x, t.y, t.z);
      this.quaternion.set(r.x, r.y, r.z, r.w);
      if (this.position.y > this.peakHeight) this.peakHeight = this.position.y;
      _v.copy(this.position).sub(this.lastTravelSample);
      _v.y = 0;
      const d = _v.length();
      if (d > 0.02) { this.travelled += d; this.lastTravelSample.copy(this.position); }
      // Airborne bookkeeping for stunt scoring.
      const v = this.body.linvel();
      if (Math.abs(v.y) > 0.6 || !this.body.isSleeping()) {
        this.airborneTime += ctx.dt;
      }

      // Impact severity is measured as velocity actually lost in one step, not
      // from Rapier's contact force. The solver integrates force over substeps,
      // so totalForceMagnitude/mass overstates a hit by a large and
      // inconsistent factor; speed change is what the player can see.
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed > this.maxSpeedSinceDetach) this.maxSpeedSinceDetach = speed;
      const lost = this.prevSpeed - speed;
      this.prevSpeed = speed;
      this.lastDeltaV = lost > 0 ? lost : 0;
      if (this.lastDeltaV > 1.5) this.registerImpact(this.lastDeltaV, ctx);
      // Sunk fruit is lost.
      if (this.position.y < -3.5) {
        this.destroyed = true;
        ctx.emit('fruit:destroyed', { fruitId: this.id, species: this.species, value: 0 });
        this.despawn();
        return;
      }
    }
    for (const t of this.traits) t.onStep?.(this, ctx);
  }

  // ---- contacts -----------------------------------------------------------
  /**
   * Contact events tell us WHO was hit; the speed-change check in step() tells
   * us HOW HARD. Both are needed: a coconut landing on a player is only funny
   * if we know it was a player.
   */
  onContact(other: PhysicsOwner | null, _impulse: number, point: THREE.Vector3, _normal: THREE.Vector3): void {
    if (this.destroyed || this.state === 'gone') return;
    if (other?.kind === 'player' || other?.kind === 'ragdoll') {
      this.hitPlayerAt = Fruit.context?.elapsed ?? 0;
      this.hitPoint.copy(point);
    }
  }

  /** Time of the last contact with a player, used to attribute impacts. */
  private hitPlayerAt = -99;
  private hitPoint = new THREE.Vector3();

  private registerImpact(dv: number, ctx: TraitContext): void {
    const onPlayer = ctx.elapsed - this.hitPlayerAt < 0.09;
    const point = onPlayer ? this.hitPoint : this.position;
    if (!onPlayer) {
      this.bounces++;
      this.touchedGround = true;
    }
    for (const t of this.traits) t.onImpact?.(this, dv, point, UP, ctx);
    if (this.destroyed) return;

    // Free chaos up to a species-dependent tolerance, then it starts to cost.
    // Tolerance is tuned so an apple shrugs off a 4 m drop while a watermelon
    // is unhappy about 2 m.
    const tolerance = 2 + 20 * Math.pow(1 - this.fragility, 0.8);
    const over = dv - tolerance;
    if (over > 0) {
      const worthBefore = this.value();
      const changed = this.addDamage(over * 0.022 * (0.5 + this.fragility));
      if (changed) {
        ctx.emit('fruit:qualityChanged', {
          fruitId: this.id, quality: this.quality, damage: this.damage,
          displayName: this.displayName, lost: Math.max(0, worthBefore - this.value()),
        });
      }
    }
    if (dv > 2.5) {
      ctx.emit('fruit:impact', {
        fruitId: this.id, species: this.species, speed: dv,
        point: point.clone(), onPlayer,
      });
    }
  }

  /** Shared trait context, set once per frame by FruitSystem. */
  static context: TraitContext | null = null;

  applyImpulse(v: THREE.Vector3, wake = true): void {
    this.body?.applyImpulse({ x: v.x, y: v.y, z: v.z }, wake);
  }

  get velocity(): THREE.Vector3 {
    if (!this.body) return _v.set(0, 0, 0);
    const v = this.body.linvel();
    return _v.set(v.x, v.y, v.z);
  }

  get speed(): number {
    if (!this.body) return 0;
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  get orientation(): THREE.Quaternion { return _q.copy(this.quaternion); }
}
