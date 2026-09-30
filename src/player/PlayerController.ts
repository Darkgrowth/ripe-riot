import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld, RBody, RCollider, PhysicsOwner } from '@/physics/PhysicsWorld';
import { Groups, QueryMask } from '@/physics/Layers';
import type { InputFrame } from './PlayerInput';
import { FIXED_DT } from '@/core/Time';
import { clamp, damp, lerp, wrapAngle } from '@/core/MathUtils';
import { STAND_HEIGHT, CROUCH_HEIGHT, PLAYER_RADIUS } from './PlayerDimensions';
export { STAND_HEIGHT, CROUCH_HEIGHT, PLAYER_RADIUS } from './PlayerDimensions';

export interface MoveTuning {
  walk: number; sprint: number; crouch: number;
  groundAccel: number; airAccel: number;
  groundFriction: number; airDrag: number;
  jumpHeight: number; coyote: number; jumpBuffer: number;
  stepOffset: number; maxSlopeDeg: number; snapDist: number;
  maxAirSpeed: number;
}

export const DEFAULT_TUNING: MoveTuning = {
  walk: 5.4,
  sprint: 8.4,
  crouch: 2.7,
  groundAccel: 62,
  airAccel: 22,
  groundFriction: 13,
  airDrag: 0.12,
  jumpHeight: 1.28,
  coyote: 0.12,
  jumpBuffer: 0.14,
  stepOffset: 0.48,
  maxSlopeDeg: 53,
  snapDist: 0.42,
  maxAirSpeed: 26,
};

export type PlayerState = 'active' | 'ragdoll' | 'downed' | 'captured';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

/**
 * First-person movement. Uses Rapier's kinematic character controller for
 * collide-and-slide (it handles steps and slopes properly), while velocity,
 * acceleration and jump arcs are ours so the feel is tunable in one place.
 */
export class PlayerController implements PhysicsOwner {
  readonly kind = 'player';
  readonly id: number;
  tuning: MoveTuning = { ...DEFAULT_TUNING };

  body!: RBody;
  collider!: RCollider;
  private ctrl!: RAPIER.KinematicCharacterController;

  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  state: PlayerState = 'active';
  private catchableFling = false;
  private activeFlingId = 0;

  grounded = false;
  groundNormal = new THREE.Vector3(0, 1, 0);
  private airTime = 0;
  private coyoteLeft = 0;
  private jumpBufferLeft = 0;
  private wantCrouch = false;
  /** True while rising from a jump the player can still cut short. */
  private jumpCut = false;
  height = STAND_HEIGHT;
  private targetHeight = STAND_HEIGHT;

  /** Camera shake / bob outputs, consumed by PlayerCamera. */
  bobPhase = 0;
  landDip = 0;
  private lastFallSpeed = 0;
  /** Extra mass being hauled, in kg. Slows movement and adds sway. */
  carryLoad = 0;
  /** Load in kg at which movement is fully penalised. Raised by the harness. */
  carryTolerance = 260;
  /** Set by tools/effects; multiplies max speed (e.g. mud, ice, vacuum recoil). */
  speedMul = 1;
  /** Non-null while standing inside a ladder volume. Set by the ladder tool. */
  climbVolume: { top: number; climbSpeed: number } | null = null;
  climbing = false;

  /** Impact speed (m/s) above which the player ragdolls. */
  ragdollImpactSpeed = 13.5;
  onHardImpact: ((speed: number, source: string) => void) | null = null;

  private physics: PhysicsWorld;

  constructor(physics: PhysicsWorld, id: number, spawn: THREE.Vector3) {
    this.physics = physics;
    this.id = id;
    this.position.copy(spawn);
    this.createBody();
  }

  private createBody(): void {
    const p = this.physics;
    this.body = p.createKinematic(this.position);
    const half = (this.height - PLAYER_RADIUS * 2) / 2;
    const desc = RAPIER.ColliderDesc.capsule(half, PLAYER_RADIUS)
      .setTranslation(0, this.height / 2, 0)
      .setFriction(0.0)
      .setRestitution(0);
    this.collider = p.attach(this.body, desc, Groups.player);

    this.ctrl = p.world.createCharacterController(0.02);
    this.ctrl.setUp({ x: 0, y: 1, z: 0 });
    this.ctrl.enableAutostep(this.tuning.stepOffset, 0.24, true);
    this.ctrl.enableSnapToGround(this.tuning.snapDist);
    this.ctrl.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(this.tuning.maxSlopeDeg));
    this.ctrl.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(this.tuning.maxSlopeDeg));
    this.ctrl.setApplyImpulsesToDynamicBodies(true);
    this.ctrl.setCharacterMass(82);
    p.register(this, this.body, [this.collider]);
  }

  // ---- look ---------------------------------------------------------------
  applyLook(dx: number, dy: number): void {
    if (this.state === 'downed') return;
    this.yaw = wrapAngle(this.yaw - dx);
    this.pitch = clamp(this.pitch - dy, -1.535, 1.535);
  }

  forward(out = _fwd): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }
  right(out = _right): THREE.Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
  }
  /** Full look direction including pitch. */
  lookDir(out = new THREE.Vector3()): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp).normalize();
  }
  get eyePosition(): THREE.Vector3 {
    return _v2.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }
  get eyeHeight(): number { return this.height - 0.19; }

  // ---- fixed step ---------------------------------------------------------
  step(input: InputFrame, dt = FIXED_DT): void {
    if (this.state !== 'active') return;

    // --- crouch: shrink immediately, but only stand up if there is headroom.
    this.wantCrouch = input.crouch;
    this.targetHeight = this.wantCrouch ? CROUCH_HEIGHT : (this.hasHeadroom() ? STAND_HEIGHT : CROUCH_HEIGHT);
    const newH = damp(this.height, this.targetHeight, 16, dt);
    if (Math.abs(newH - this.height) > 1e-4) this.setHeight(newH);

    // --- desired horizontal velocity
    const load = clamp(1 - this.carryLoad / this.carryTolerance, 0.45, 1);
    let maxSpeed = (this.wantCrouch ? this.tuning.crouch
      : input.sprint && input.moveZ > 0 ? this.tuning.sprint : this.tuning.walk) * load * this.speedMul;

    this.forward(_fwd); this.right(_right);
    _v.set(0, 0, 0)
      .addScaledVector(_fwd, input.moveZ)
      .addScaledVector(_right, input.moveX);
    const inputMag = Math.min(1, _v.length());
    if (inputMag > 1e-4) _v.normalize();

    const wishX = _v.x * maxSpeed * inputMag;
    const wishZ = _v.z * maxSpeed * inputMag;

    if (this.grounded) {
      const accel = this.tuning.groundAccel * dt;
      this.velocity.x = approach(this.velocity.x, wishX, accel);
      this.velocity.z = approach(this.velocity.z, wishZ, accel);
      if (inputMag < 0.01) {
        const f = Math.exp(-this.tuning.groundFriction * dt);
        this.velocity.x *= f; this.velocity.z *= f;
        if (Math.hypot(this.velocity.x, this.velocity.z) < 0.05) { this.velocity.x = 0; this.velocity.z = 0; }
      }
    } else {
      // Air control: steer without adding speed beyond the ground cap.
      const accel = this.tuning.airAccel * dt * inputMag;
      const cur = Math.hypot(this.velocity.x, this.velocity.z);
      const nx = approach(this.velocity.x, wishX, accel);
      const nz = approach(this.velocity.z, wishZ, accel);
      const next = Math.hypot(nx, nz);
      if (next <= Math.max(cur, maxSpeed) + 0.001) { this.velocity.x = nx; this.velocity.z = nz; }
      const d = Math.exp(-this.tuning.airDrag * dt);
      this.velocity.x *= d; this.velocity.z *= d;
    }

    // --- ladders. Look where you want to go and hold forward; pressing jump
    // steps off. Deliberately forgiving: climbing is transport, not a skill test.
    this.climbing = false;
    if (this.climbVolume && this.position.y < this.climbVolume.top) {
      const wantsOff = input.jumpPressed;
      if (!wantsOff && (Math.abs(input.moveZ) > 0.1 || input.jump)) {
        this.climbing = true;
        const cs = this.climbVolume.climbSpeed;
        const lookY = Math.sin(this.pitch);
        this.velocity.y = input.jump ? cs : clamp(lookY * 1.6, -1, 1) * input.moveZ * cs;
        this.velocity.x *= 0.55;
        this.velocity.z *= 0.55;
        this.grounded = false;
      } else if (wantsOff) {
        this.velocity.y = Math.sqrt(2 * Math.abs(this.physics.gravity) * 0.7);
        this.velocity.addScaledVector(_fwd, 3.2);
        this.climbVolume = null;
      }
    }

    // --- gravity and jump
    this.coyoteLeft = this.grounded ? this.tuning.coyote : Math.max(0, this.coyoteLeft - dt);
    this.jumpBufferLeft = input.jumpPressed ? this.tuning.jumpBuffer : Math.max(0, this.jumpBufferLeft - dt);

    const g = Math.abs(this.physics.gravity);
    if (this.climbing) {
      // No gravity and no jump while on a ladder; the block above owns velocity.y.
      this.jumpBufferLeft = 0;
    } else if (this.jumpBufferLeft > 0 && this.coyoteLeft > 0) {
      this.velocity.y = Math.sqrt(2 * g * this.tuning.jumpHeight);
      this.jumpBufferLeft = 0; this.coyoteLeft = 0; this.grounded = false;
      this.jumpCut = true;
    } else {
      // Short-hop: cut the rise when the button is released early. This applies
      // ONLY to a rise the player started by jumping — applying it to every
      // upward velocity silently halved the apex of air-cannon launches,
      // explosions and Vinebomb rides.
      const rising = this.velocity.y > 0;
      const gScale = rising && this.jumpCut && !input.jump ? 1.9 : rising ? 1.0 : 1.35;
      this.velocity.y -= g * gScale * dt;
      if (this.velocity.y < -55) this.velocity.y = -55;
    }
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    if (hs > this.tuning.maxAirSpeed) {
      const s = this.tuning.maxAirSpeed / hs;
      this.velocity.x *= s; this.velocity.z *= s;
    }

    // --- move
    this.lastFallSpeed = Math.min(this.lastFallSpeed, this.velocity.y);
    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    this.ctrl.computeColliderMovement(this.collider, desired, undefined, Groups.player);
    const mv = this.ctrl.computedMovement();
    this.position.x += mv.x; this.position.y += mv.y; this.position.z += mv.z;
    this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y, z: this.position.z });

    // --- ground state and collision response
    const wasGrounded = this.grounded;
    this.grounded = this.ctrl.computedGrounded();
    this.resolveCollisionsAgainstVelocity(desired, mv);

    if (this.grounded) {
      if (!wasGrounded) this.onLand();
      this.airTime = 0;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.sampleGroundNormal();
    } else {
      this.airTime += dt;
    }

    // --- head bob
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && speed > 0.6) this.bobPhase += dt * (5.2 + speed * 0.85);
    else this.bobPhase = damp(this.bobPhase % (Math.PI * 2), 0, 6, dt);
    this.landDip = damp(this.landDip, 0, 9, dt);
  }

  /** Kill velocity components that ran into geometry, so we do not stick. */
  private resolveCollisionsAgainstVelocity(desired: { x: number; y: number; z: number },
    mv: { x: number; y: number; z: number }): void {
    const n = this.ctrl.numComputedCollisions();
    if (n === 0) return;
    for (let i = 0; i < n; i++) {
      const c = this.ctrl.computedCollision(i);
      if (!c) continue;
      const nv = c.normal1;
      _v.set(nv.x, nv.y, nv.z);
      const along = this.velocity.dot(_v);
      if (along < 0) this.velocity.addScaledVector(_v, -along);
    }
    // If we barely moved but wanted to fall fast, we hit something hard.
    if (desired.y < -0.12 && mv.y > desired.y * 0.35) {
      this.registerFallImpact();
    }
  }

  private sampleGroundNormal(): void {
    const hit = this.physics.raycast(
      _v.set(this.position.x, this.position.y + 0.4, this.position.z),
      _v2.set(0, -1, 0), 1.4, QueryMask.groundOnly, this.body);
    this.groundNormal.copy(hit ? hit.normal : new THREE.Vector3(0, 1, 0));
  }

  private onLand(): void {
    this.catchableFling = false;
    this.activeFlingId = 0;
    this.jumpCut = false;
    const impact = -this.lastFallSpeed;
    this.lastFallSpeed = 0;
    if (impact > 3) this.landDip = clamp((impact - 3) / 16, 0, 0.55);
    if (impact > this.ragdollImpactSpeed) this.onHardImpact?.(impact, 'fall');
  }

  private registerFallImpact(): void {
    const impact = -this.lastFallSpeed;
    this.lastFallSpeed = 0;
    if (impact > this.ragdollImpactSpeed) this.onHardImpact?.(impact, 'fall');
  }

  private hasHeadroom(): boolean {
    const hit = this.physics.raycast(
      _v.set(this.position.x, this.position.y + CROUCH_HEIGHT * 0.5, this.position.z),
      _v2.set(0, 1, 0), STAND_HEIGHT + 0.12 - CROUCH_HEIGHT * 0.5, QueryMask.solid, this.body);
    return !hit;
  }

  private setHeight(h: number): void {
    this.height = h;
    const half = Math.max(0.02, (h - PLAYER_RADIUS * 2) / 2);
    this.collider.setHalfHeight(half);
    this.collider.setTranslationWrtParent({ x: 0, y: h / 2, z: 0 });
  }

  // ---- external forces ----------------------------------------------------
  /** Apply one host-approved chaos launch. Packet replay protection lives in
   * MultiplayerAuthority; this guard keeps malformed speeds out of physics. */
  applyChaosLaunch(velocity: THREE.Vector3, source: 'mimic-charge' | 'snapjaw-fling',
    flingId = 0): boolean {
    if ((this.state !== 'active' && !(this.state === 'captured' && source === 'snapjaw-fling'))
      || !['mimic-charge', 'snapjaw-fling'].includes(source)
      || ![velocity.x, velocity.y, velocity.z].every(Number.isFinite)
      || velocity.lengthSq() < 0.01 || velocity.lengthSq() > 400) return false;
    if (this.state === 'captured') this.state = 'active';
    this.catchableFling = source === 'snapjaw-fling';
    this.activeFlingId = this.catchableFling ? flingId : 0;
    this.addImpulseVelocity(velocity, false, source);
    return true;
  }

  /** Host-confirmed Catch Net interception of a currently flying teammate. */
  stopChaosFlight(flingId = 0): boolean {
    if (this.state !== 'active' || !this.catchableFling
      || (flingId > 0 && flingId !== this.activeFlingId)) return false;
    this.catchableFling = false;
    this.activeFlingId = 0;
    this.velocity.x *= .12;
    this.velocity.z *= .12;
    this.velocity.y = Math.min(this.velocity.y, 1.2);
    return true;
  }

  /** Push the player around. `speed` is metres/second added to velocity. */
  addImpulseVelocity(v: THREE.Vector3, ragdollIfStrong = true, source = 'impulse'): void {
    this.velocity.add(v);
    this.grounded = false;
    this.coyoteLeft = 0;
    // An external launch is not a jump, so releasing space must not cut it.
    this.jumpCut = false;
    if (ragdollIfStrong && v.length() > this.ragdollImpactSpeed) {
      this.onHardImpact?.(v.length(), source);
    }
  }

  teleport(p: THREE.Vector3): void {
    this.catchableFling = false;
    this.activeFlingId = 0;
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
  }

  /** Disable the kinematic body while the ragdoll drives the player. */
  setSimulated(on: boolean): void {
    this.collider.setEnabled(on);
  }

  get speed(): number { return Math.hypot(this.velocity.x, this.velocity.z); }
  get airborne(): boolean { return !this.grounded && this.airTime > 0.08; }
  get airborneTime(): number { return this.airTime; }

  dispose(): void {
    this.physics.world.removeCharacterController(this.ctrl);
    this.physics.removeBody(this.body, [this.collider]);
  }
}

function approach(cur: number, target: number, maxDelta: number): number {
  const d = target - cur;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + Math.sign(d) * maxDelta;
}

export { lerp };
