import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Game, System } from '@/core/Game';
import type { RBody } from '../physics/PhysicsWorld.ts';
import { Groups } from '../physics/Layers.ts';
import type { Sunpatch } from '@/world/Sunpatch';
import { voxelKingVineArm, voxelKingVineBase, voxelKingVineConnector,
  voxelKingVineCore, voxelKingVineGuardLeaf, voxelKingVineSeed } from './VoxelKingVineGeometry.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KING_VINE_WORKSITE, KING_MELON_CUT_ROW } from '../world/LegendaryLayout.ts';

export type VinePoint = [number, number, number];
export type KingVineStrike = 'melee' | 'air';
export type KingVinePhase = 'idle' | 'telegraph' | 'sweep' | 'seed' | 'recover' | 'subdued';
export type KingVineAttack = 'sweep' | 'seed';

export interface KingVineTarget { id: string; position: VinePoint }
export interface KingVineHit {
  kind: 'stem' | 'returned-seed';
  damage: number;
  subdued: boolean;
  actorId: string;
}
export interface KingVineProjectile {
  position: VinePoint;
  velocity: VinePoint;
  returned: boolean;
  age: number;
}
export interface KingVineNetState {
  revision: number;
  generation: number;
  center: VinePoint;
  phase: KingVinePhase;
  attack: KingVineAttack;
  timeLeft: number;
  health: number;
  heading: number;
  projectile: KingVineProjectile | null;
}
export interface KingVineOptions {
  authoritative?: boolean;
  /** Presentation only; encounter rules and snapshots are identical. */
  visualStyle?: 'baseline' | 'voxel';
  /** Tests or custom arenas may provide the stem's ground position directly. */
  center?: VinePoint;
  /** Fired only by the simulating peer, once per victim per attack. */
  onDamagePlayer?: (victimId: string, amount: number, source: string, attackId: string) => void;
  /** Fired only by the simulating peer. Extraction may now begin. */
  onSubdued?: () => void;
}

const SWEEP_WARN = 1.0;
const SEED_WARN = 1.0;
const SWEEP_TIME = 0.6;
const SEED_TIME = 3.0;
const RECOVER_TIME = 1.8;
const SWEEP_RANGE = 11;
const SEED_SPEED = 10;
const RETURN_SPEED = 18;
// A 2.9 m mallet swing can touch the surface of the 1.7 m stem with its
// 0.22 m head. The old centre-ray gate must include that reachable edge.
const MELEE_CORE_REACH = 2.9 + 1.7 + 0.22;
const PHASES: KingVinePhase[] = ['idle', 'telegraph', 'sweep', 'seed', 'recover', 'subdued'];
const point = (p: VinePoint): VinePoint => [p[0], p[1], p[2]];

/**
 * Active guardian rooted at the King Melon worksite. Ropes can later extend its
 * recovery window, but no rope is required: dodge a warning, hit the exposed
 * stem, or return a fired seed with the air cannon.
 *
 * Only the authoritative instance advances combat or decides damage. Clients
 * apply absolute snapshots and render telegraphs from the resulting state.
 */
export class KingVine implements System {
  readonly name = 'kingVine';
  readonly maxHealth = 6;
  authoritative: boolean;
  center: VinePoint;
  phase: KingVinePhase = 'idle';
  attack: KingVineAttack = 'sweep';
  timeLeft = 0;
  health = this.maxHealth;
  heading = 0;
  projectile: KingVineProjectile | null = null;
  generation = 0;

  private readonly options: KingVineOptions;
  private explicitCenter: boolean;
  private targets: KingVineTarget[] = [];
  private attackIndex = 0;
  private attackSerial = 0;
  private hitVictims = new Set<string>();
  private hitByActor = new Map<string, number>();
  private time = 0;
  private revision = 0;
  private lastApplied = -1;
  private g: Game | null = null;
  private root: THREE.Group | null = null;
  private trunkBody: RBody | null = null;
  private trunkColliderMode: 'standing' | 'subdued' | null = null;
  private arm: THREE.Group | null = null;
  private armMaterial: THREE.MeshStandardMaterial | null = null;
  private warning: THREE.Mesh | null = null;
  private seedLane: THREE.Mesh | null = null;
  private core: THREE.Mesh | null = null;
  private seedVisual: THREE.Mesh | null = null;
  private voxelBody: THREE.Group | null = null;
  private voxelConnector: THREE.Mesh | null = null;
  private voxelGuards: THREE.Group[] = [];
  private visualHealth: number | null = null;
  private visualHitAge = 99;
  private visualSubduedAge = 99;
  private visualWasSubdued = false;
  private visualTime = 0;

  constructor(options: KingVineOptions = {}) {
    this.options = options;
    this.authoritative = options.authoritative ?? true;
    this.explicitCenter = options.center !== undefined;
    this.center = options.center ? point(options.center) : [0, 0, 0];
  }

  get subdued(): boolean { return this.phase === 'subdued'; }

  init(g: Game): void {
    this.g = g;
    if (!this.explicitCenter) {
      const world = g.get<Sunpatch>('world');
      const { x, z } = KING_VINE_WORKSITE;
      this.center = [x, world.terrain.height(x, z), z];
    }
    this.buildVisuals();
    this.syncTrunkCollider(this.subdued ? 'subdued' : 'standing');
    g.debug?.addProbe('kingVine', () => ({
      health: this.health, maxHealth: this.maxHealth, phase: this.phase,
      attack: this.attack, timeLeft: +this.timeLeft.toFixed(2),
      targetCount: this.targets.length, projectile: this.projectile,
      subdued: this.subdued, authoritative: this.authoritative,
      generation: this.generation,
    }));
    g.debug?.addAction('kingVine.reset', () => { this.reset(); return this.phase; });
    g.debug?.addAction('kingVine.info', () => this.snapshot());
  }

  setAuthority(authoritative: boolean): void { this.authoritative = authoritative; }

  setTargets(targets: KingVineTarget[]): void {
    this.targets = targets.filter(t => typeof t.id === 'string' && t.id.length > 0 && validPoint(t.position))
      .map(t => ({ id: t.id, position: point(t.position) }));
  }

  fixedStep(dt: number): void {
    if (!this.authoritative || this.subdued || !Number.isFinite(dt) || dt <= 0) return;
    if (this.g && (!this.g.has('net') || !this.g.get<{ connected: boolean }>('net').connected)) {
      const player = this.g.player, p = player.position;
      const vitals = this.g.has('vitals') ? this.g.get<{
        downed: boolean; recoveryGraceRemaining: number;
      }>('vitals') : null;
      const available = player.state === 'active' && !vitals?.downed
        && (vitals?.recoveryGraceRemaining ?? 0) <= 0;
      this.setTargets(available ? [{ id: 'solo', position: [p.x, p.y, p.z] }] : []);
    }
    this.time += dt;
    if (this.phase === 'idle') {
      const target = this.nearestTarget(27);
      if (target) this.beginTelegraph(target);
      return;
    }
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.phase === 'telegraph') {
      if (this.timeLeft <= 1e-6) this.beginAttack();
    } else if (this.phase === 'sweep') {
      this.hitSweepTargets();
      if (this.timeLeft <= 1e-6) this.beginRecover();
    } else if (this.phase === 'seed') {
      this.advanceSeed(dt);
      if (this.phase === 'seed' && this.timeLeft <= 1e-6) this.beginRecover();
    } else if (this.phase === 'recover' && this.timeLeft <= 1e-6) {
      this.phase = 'idle';
      this.timeLeft = 0;
    }
    this.revision++;
  }

  /** Aim a tool ray at an airborne seed or the exposed stem. */
  canStrike(origin: VinePoint | THREE.Vector3, direction: VinePoint | THREE.Vector3,
    strike: KingVineStrike): boolean {
    if (this.subdued || (strike !== 'melee' && strike !== 'air')) return false;
    const from = readPoint(origin), dir = readPoint(direction);
    if (!from || !dir || Math.hypot(...dir) < 1e-4) return false;
    const reach = strike === 'air' ? 38 : MELEE_CORE_REACH;
    if (strike === 'air' && this.phase === 'seed' && this.projectile && !this.projectile.returned
      && raySphere(from, dir, this.projectile.position, 1.1, reach)) return true;
    return this.phase === 'recover'
      && raySphere(from, dir, [this.center[0], this.center[1] + 1.7, this.center[2]], 1.7, reach);
  }

  tryHit(origin: VinePoint | THREE.Vector3, direction: VinePoint | THREE.Vector3,
    strike: KingVineStrike, actorId: string): KingVineHit | null {
    if (!this.authoritative || this.subdued || (strike !== 'melee' && strike !== 'air')
      || typeof actorId !== 'string' || !actorId) return null;
    const from = readPoint(origin);
    const dir = readPoint(direction);
    if (!from || !dir) return null;
    const length = Math.hypot(...dir);
    if (length < 1e-4) return null;
    const maxReach = strike === 'air' ? 38 : MELEE_CORE_REACH;
    if (strike === 'air' && this.phase === 'seed' && this.projectile && !this.projectile.returned
      && raySphere(from, dir, this.projectile.position, 1.1, maxReach)) {
      const p = this.projectile;
      const toCore = normalize([
        this.center[0] - p.position[0],
        this.center[1] + 1.7 - p.position[1],
        this.center[2] - p.position[2],
      ]);
      p.velocity = scale(toCore, RETURN_SPEED);
      p.returned = true;
      this.revision++;
      return { kind: 'returned-seed', damage: 0, subdued: false, actorId };
    }
    if (this.phase !== 'recover') return null;
    const last = this.hitByActor.get(actorId) ?? -Infinity;
    if (this.time - last < 0.45) return null;
    const core: VinePoint = [this.center[0], this.center[1] + 1.7, this.center[2]];
    if (!raySphere(from, dir, core, 1.7, maxReach)) return null;
    this.hitByActor.set(actorId, this.time);
    const damage = strike === 'air' ? 2 : 1;
    this.hurtStem(damage);
    return { kind: 'stem', damage, subdued: this.subdued, actorId };
  }

  /** Full-team wipe orchestration calls this; the boss never resets players. */
  reset(): void {
    if (!this.authoritative) return;
    this.generation++;
    this.health = this.maxHealth;
    this.phase = 'idle';
    this.attack = 'sweep';
    this.timeLeft = 0;
    this.heading = 0;
    this.projectile = null;
    this.attackIndex = 0;
    this.hitVictims.clear();
    this.hitByActor.clear();
    this.revision++;
  }

  /** Restore a saved victory without paying or replaying the defeat callback. */
  restoreSubdued(): void {
    if (!this.authoritative || this.subdued) return;
    this.phase = 'subdued';
    this.health = 0;
    this.timeLeft = 0;
    this.projectile = null;
    this.hitVictims.clear();
    this.hitByActor.clear();
    this.revision++;
  }

  snapshot(): KingVineNetState {
    return {
      revision: this.revision, generation: this.generation, center: point(this.center),
      phase: this.phase, attack: this.attack, timeLeft: this.timeLeft,
      health: this.health, heading: this.heading,
      projectile: this.projectile ? {
        position: point(this.projectile.position), velocity: point(this.projectile.velocity),
        returned: this.projectile.returned, age: this.projectile.age,
      } : null,
    };
  }

  /** Clients mirror host state; stale or malformed snapshots are ignored. */
  applySnapshot(state: KingVineNetState): boolean {
    if (this.authoritative || !state || !Number.isInteger(state.revision)
      || state.revision <= this.lastApplied || !validPoint(state.center)
      || !PHASES.includes(state.phase) || (state.attack !== 'sweep' && state.attack !== 'seed')
      || !Number.isFinite(state.timeLeft) || !Number.isFinite(state.health)
      || !Number.isFinite(state.heading) || !Number.isInteger(state.generation)) return false;
    const p = state.projectile;
    if (p && (!validPoint(p.position) || !validPoint(p.velocity) || !Number.isFinite(p.age))) return false;
    this.lastApplied = state.revision;
    this.revision = state.revision;
    this.generation = state.generation;
    this.center = point(state.center);
    this.phase = state.phase;
    this.attack = state.attack;
    this.timeLeft = Math.max(0, state.timeLeft);
    this.health = Math.max(0, Math.min(this.maxHealth, state.health));
    this.heading = state.heading;
    this.projectile = p ? {
      position: point(p.position), velocity: point(p.velocity), returned: !!p.returned, age: p.age,
    } : null;
    return true;
  }

  frameUpdate(dt: number): void {
    if (!this.root) return;
    this.visualTime += Math.max(0, dt);
    this.root.position.set(...this.center);
    const warning = this.phase === 'telegraph' && this.attack === 'sweep';
    if (this.warning) {
      this.warning.visible = warning;
      this.warning.rotation.y = this.heading;
      (this.warning.material as THREE.MeshBasicMaterial).opacity = warning
        ? 0.27 + 0.2 * Math.sin(this.visualTime * 22) ** 2 : 0;
    }
    if (this.seedLane) {
      const charging = this.phase === 'telegraph' && this.attack === 'seed';
      this.seedLane.visible = charging;
      this.seedLane.rotation.y = this.heading;
      this.seedLane.position.set(Math.sin(this.heading) * 13.5, 0.13,
        Math.cos(this.heading) * 13.5);
      (this.seedLane.material as THREE.MeshBasicMaterial).opacity = charging
        ? 0.2 + 0.2 * Math.sin(this.visualTime * 18) ** 2 : 0;
    }
    if (this.options.visualStyle === 'voxel') this.updateVoxelPose(dt);
    else if (this.arm) {
      this.arm.rotation.y = this.heading;
      this.arm.rotation.z = this.subdued ? -0.9
        : this.phase === 'sweep' ? Math.sin((1 - this.timeLeft / SWEEP_TIME) * Math.PI) * 0.65
          : this.phase === 'telegraph' ? -0.18 : 0;
    }
    if (this.core && this.options.visualStyle !== 'voxel') {
      const mat = this.core.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = this.phase === 'recover'
        ? 1.2 + 0.3 * Math.sin(this.visualTime * 13) : 0.16;
      this.core.visible = !this.subdued;
    }
    if (this.seedVisual) {
      this.seedVisual.visible = !!this.projectile;
      if (this.projectile) this.seedVisual.position.set(
        this.projectile.position[0] - this.center[0],
        this.projectile.position[1] - this.center[1],
        this.projectile.position[2] - this.center[2]);
      if (this.projectile && this.options.visualStyle === 'voxel') {
        const velocity = new THREE.Vector3(...this.projectile.velocity).normalize();
        if (velocity.lengthSq() > 0) this.seedVisual.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1), velocity);
      }
    }
    this.root.scale.y = this.options.visualStyle === 'voxel' ? 1 : this.subdued ? 0.62 : 1;
    // Keep the standing blocker only while the voxel body is visibly falling.
    // The settled remnant is low; a permanent 3.2 m cylinder becomes an
    // invisible wall after the crown has folded to the ground.
    const settled = this.options.visualStyle !== 'voxel' || this.visualSubduedAge >= 0.72;
    this.syncTrunkCollider(this.subdued && settled ? 'subdued' : 'standing');
    if (this.options.visualStyle === 'voxel') this.updateArmCameraFade();
  }

  private syncTrunkCollider(mode: 'standing' | 'subdued'): void {
    const physics = this.g?.physics;
    if (!physics) return;
    const height = mode === 'standing' ? 3.2
      : this.options.visualStyle === 'voxel' ? 1.2 : 1.9;
    const radius = mode === 'standing' ? 1.05 : 0.85;
    const y = this.center[1] + height / 2;
    const at = this.trunkBody?.translation();
    if (this.trunkColliderMode === mode && at
      && Math.abs(at.x - this.center[0]) < 0.001
      && Math.abs(at.y - y) < 0.001
      && Math.abs(at.z - this.center[2]) < 0.001) return;
    if (this.trunkBody) physics.removeBody(this.trunkBody);
    // This remains a movement/camera boundary, never an attack authority.
    this.trunkBody = physics.createFixed(new THREE.Vector3(this.center[0], y, this.center[2]));
    physics.attach(this.trunkBody,
      RAPIER.ColliderDesc.cylinder(height / 2, radius).setFriction(0.85), Groups.plant);
    this.trunkColliderMode = mode;
  }

  private updateArmCameraFade(): void {
    if (!this.arm || !this.armMaterial) return;
    const camera = this.g?.renderer.camera;
    let opacity = 1;
    if (camera && !this.subdued) {
      // A sweep is allowed to cross the first-person view, but its visual mesh
      // cannot become an opaque wall around the lens. Measure the actual
      // camera-to-paddle distance rather than distance to the rooted boss.
      this.arm.updateWorldMatrix(true, false);
      const start = this.arm.localToWorld(new THREE.Vector3(0, 0, 0));
      const span = this.arm.localToWorld(new THREE.Vector3(0, -0.28, 9.27)).sub(start);
      const t = THREE.MathUtils.clamp(camera.position.clone().sub(start).dot(span) / span.lengthSq(), 0, 1);
      const distance = camera.position.distanceTo(start.addScaledVector(span, t));
      opacity = 0.24 + 0.76 * THREE.MathUtils.smoothstep(distance, 0.6, 1.9);
    }
    this.armMaterial.opacity = opacity;
    this.armMaterial.transparent = opacity < 0.99;
    this.armMaterial.depthWrite = opacity >= 0.99;
  }

  private updateVoxelPose(dt: number): void {
    if (this.visualHealth !== null && this.health < this.visualHealth)
      this.visualHitAge = 0;
    this.visualHitAge += Math.max(0, dt);
    if (this.subdued && !this.visualWasSubdued) {
      this.visualSubduedAge = this.visualHealth === null ? 0.72 : 0;
      this.visualWasSubdued = true;
    }
    if (!this.subdued && this.visualWasSubdued) {
      this.visualSubduedAge = 99;
      this.visualWasSubdued = false;
    }
    if (this.visualWasSubdued) this.visualSubduedAge += Math.max(0, dt);
    this.visualHealth = this.health;
    const fall = this.visualWasSubdued
      ? THREE.MathUtils.smoothstep(this.visualSubduedAge, 0, 0.72) : 0;
    const hit = Math.max(0, 1 - this.visualHitAge / 0.4);
    if (this.voxelBody) {
      this.voxelBody.rotation.x = fall * 0.72 - hit * 0.10;
      this.voxelBody.rotation.z = fall * 0.28 + hit * 0.17;
      this.voxelBody.position.y = -fall * 0.52;
      this.voxelBody.scale.y = 1 - fall * 0.35;
    }
    if (this.voxelConnector) this.voxelConnector.visible = fall < 0.8;
    const sweepProgress = THREE.MathUtils.clamp(1 - this.timeLeft / SWEEP_TIME, 0, 1);
    if (this.arm) {
      this.arm.rotation.y = this.heading + (this.subdued ? 0.1
        : this.phase === 'sweep' ? -0.75 + sweepProgress * 1.5
          : this.phase === 'telegraph' && this.attack === 'sweep' ? -0.75
            : 0);
      // The arm runs along local +Z. Rotating Z only rolls its wide paddle;
      // pitch it down immediately on subdue, then let the falling body take
      // over that angle during the short collapse animation.
      this.arm.rotation.x = this.subdued ? 0.8 - fall * 0.72
        : this.phase === 'telegraph' && this.attack === 'seed' ? -0.14
        : this.phase === 'seed' ? 0.22 : 0;
      this.arm.rotation.z = fall * -0.82 + hit * 0.12;
    }
    const open = this.subdued ? 0.32
      : this.phase === 'recover' ? 1.05
        : this.attack === 'seed' && (this.phase === 'telegraph' || this.phase === 'seed') ? 0.48 : 0;
    for (let i = 0; i < this.voxelGuards.length; i++)
      this.voxelGuards[i].rotation.y = (i === 0 ? -1 : 1) * open;
    if (this.core) {
      this.core.visible = this.phase === 'recover';
      (this.core.material as THREE.MeshStandardMaterial).emissiveIntensity =
        this.phase === 'recover' ? 0.17 + 0.07 * Math.sin(this.visualTime * 11) ** 2 : 0.03;
    }
  }

  dispose(): void {
    if (this.trunkBody) this.g?.physics.removeBody(this.trunkBody);
    this.trunkBody = null;
    this.trunkColliderMode = null;
    if (!this.root) return;
    this.root.parent?.remove(this.root);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.root.traverse(obj => {
      if (!(obj instanceof THREE.Mesh)) return;
      geometries.add(obj.geometry);
      for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) materials.add(m);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.armMaterial = null;
    this.root = null;
  }

  private nearestTarget(radius: number): KingVineTarget | null {
    let best: KingVineTarget | null = null;
    let distance = radius;
    for (const target of this.targets) {
      const d = distanceXZ(this.center, target.position);
      if (d < distance && Math.abs(target.position[1] - this.center[1]) < 7) {
        best = target;
        distance = d;
      }
    }
    return best;
  }

  private beginTelegraph(target: KingVineTarget): void {
    this.attack = this.attackIndex++ % 2 === 0 ? 'sweep' : 'seed';
    this.heading = Math.atan2(target.position[0] - this.center[0], target.position[2] - this.center[2]);
    this.phase = 'telegraph';
    this.timeLeft = this.attack === 'sweep' ? SWEEP_WARN : SEED_WARN;
    this.attackSerial++;
    this.hitVictims.clear();
    this.revision++;
  }

  private beginAttack(): void {
    if (this.attack === 'sweep') {
      this.phase = 'sweep';
      this.timeLeft = SWEEP_TIME;
      return;
    }
    this.phase = 'seed';
    this.timeLeft = SEED_TIME;
    this.projectile = {
      position: [this.center[0], this.center[1] + 1.5, this.center[2]],
      velocity: [Math.sin(this.heading) * SEED_SPEED, 0, Math.cos(this.heading) * SEED_SPEED],
      returned: false, age: 0,
    };
  }

  private hitSweepTargets(): void {
    for (const target of this.targets) {
      if (this.hitVictims.has(target.id)) continue;
      const dx = target.position[0] - this.center[0];
      const dz = target.position[2] - this.center[2];
      const dist = Math.hypot(dx, dz);
      if (dist < 1.3 || dist > SWEEP_RANGE || Math.abs(target.position[1] - this.center[1]) > 3.5) continue;
      const toward = Math.atan2(dx, dz);
      if (Math.cos(toward - this.heading) < Math.cos(0.85)) continue;
      this.hitVictims.add(target.id);
      this.damagePlayer(target.id, 30, 'king vine sweep');
    }
  }

  private advanceSeed(dt: number): void {
    const p = this.projectile;
    if (!p) return;
    p.age += dt;
    p.position[0] += p.velocity[0] * dt;
    p.position[1] += p.velocity[1] * dt;
    p.position[2] += p.velocity[2] * dt;
    if (p.returned) {
      if (distance3(p.position, [this.center[0], this.center[1] + 1.7, this.center[2]]) < 1.8) {
        this.projectile = null;
        this.hurtStem(2);
        if (!this.subdued) this.beginRecover();
      }
      return;
    }
    for (const target of this.targets) {
      if (this.hitVictims.has(target.id)) continue;
      if (distance3(p.position, [target.position[0], target.position[1] + 1.2, target.position[2]]) > 1.35) continue;
      this.hitVictims.add(target.id);
      this.damagePlayer(target.id, 22, 'king vine seed');
      this.projectile = null;
      this.beginRecover();
      return;
    }
    if (distanceXZ(p.position, this.center) > 30) {
      this.projectile = null;
      this.beginRecover();
    }
  }

  private damagePlayer(id: string, amount: number, source: string): void {
    this.options.onDamagePlayer?.(id, amount, source,
      `king-vine:${this.generation}:${this.attackSerial}:${id}`);
  }

  private hurtStem(amount: number): void {
    this.health = Math.max(0, this.health - amount);
    this.revision++;
    if (this.health > 0) return;
    this.phase = 'subdued';
    this.timeLeft = 0;
    this.projectile = null;
    this.options.onSubdued?.();
    this.g?.bus.emit('ui:toast', {
      text: 'KING VINE SUBDUED', sub: 'The King Melon can be extracted', kind: 'good', ms: 3800,
    });
  }

  private beginRecover(): void {
    this.phase = 'recover';
    this.timeLeft = RECOVER_TIME;
    this.projectile = null;
    this.hitByActor.clear();
  }

  private buildVisuals(): void {
    if (!this.g) return;
    const root = new THREE.Group();
    root.name = 'King Vine';
    root.position.set(...this.center);
    this.g.renderer.scene.add(root);
    this.root = root;
    if (this.options.visualStyle === 'voxel') {
      this.buildVoxelVisuals(root);
      return;
    }
    const bark = mat(0x37543a);
    const edge = mat(0x6b8141);
    const dark = mat(0x233a32);
    const thorn = mat(0x9f9a6c);
    const glow = mat(0xffb85d, 0.42, 0.16);
    const seedMat = mat(0xd65d34, 0.55, 0.24);

    mesh(root, new Cylinder(0.85, 1.45, 1.0, 9), dark, 0, 0.5, 0);
    mesh(root, new Cylinder(0.52, 0.9, 2.3, 8), bark, 0, 1.7, 0);
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      const x = Math.sin(a), z = Math.cos(a);
      segment(root, [x * 0.45, 0.45, z * 0.45], [x * 2.6, 0.13, z * 2.6], 0.16, bark);
      const spike = mesh(root, new THREE.ConeGeometry(0.16, 0.72, 5), thorn,
        x * 1.3, 0.65, z * 1.3);
      spike.rotation.z = x * 0.8;
      spike.rotation.x = -z * 0.8;
    }
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      const leaf = mesh(root, new THREE.ConeGeometry(0.42, 1.7, 4), edge,
        Math.sin(a) * 0.5, 2.8, Math.cos(a) * 0.5);
      leaf.rotation.z = Math.sin(a) * 0.72;
      leaf.rotation.x = -Math.cos(a) * 0.72;
    }
    this.core = mesh(root, new THREE.IcosahedronGeometry(0.75, 1), glow, 0, 1.7, 0.58);
    for (const x of [-0.52, 0.52]) {
      mesh(root, new THREE.OctahedronGeometry(0.18), seedMat, x, 2.0, 0.65);
    }
    const arm = new THREE.Group();
    root.add(arm);
    this.arm = arm;
    segment(arm, [0, 2.3, 0], [0, 2.2, 4.6], 0.24, bark);
    segment(arm, [0, 2.2, 4.6], [0, 1.7, 9.5], 0.13, edge);
    for (let i = 2; i < 9; i += 2) {
      mesh(arm, new THREE.ConeGeometry(0.25, 0.95, 5), thorn, 0, 2.6, i).rotation.x = Math.PI / 2;
    }
    const warningMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHex(0xff713e, THREE.SRGBColorSpace),
      transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
    });
    this.warning = mesh(root,
      new THREE.RingGeometry(1.8, SWEEP_RANGE, 32, 1, -Math.PI / 2 - 0.85, 1.7),
      warningMat, 0, 0.12, 0);
    this.warning.rotation.x = -Math.PI / 2;
    this.warning.visible = false;
    this.warning.castShadow = false;
    this.warning.receiveShadow = false;
    const laneMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHex(0xffa24e, THREE.SRGBColorSpace),
      transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
    });
    this.seedLane = mesh(root, new THREE.PlaneGeometry(2.2, 27), laneMat, 0, 0.13, 13.5);
    this.seedLane.rotation.x = -Math.PI / 2;
    this.seedLane.visible = false;
    this.seedLane.castShadow = false;
    this.seedLane.receiveShadow = false;
    this.seedVisual = mesh(root, new THREE.IcosahedronGeometry(0.68, 1), seedMat, 0, 1.5, 0);
    this.seedVisual.visible = false;
    const roots = this.cutRootPath();
    for (let i = 1; i < roots.length; i++) segment(root, roots[i - 1], roots[i], 0.21, bark);
  }

  private buildVoxelVisuals(root: THREE.Group): void {
    const shell = new THREE.MeshStandardMaterial({ vertexColors: true,
      roughness: 0.88, metalness: 0, flatShading: true });
    const coreMat = new THREE.MeshStandardMaterial({ vertexColors: true,
      roughness: 0.67, emissive: new THREE.Color().setHex(0xaa4d21, THREE.SRGBColorSpace),
      emissiveIntensity: 0.03, flatShading: true });
    const podMat = new THREE.MeshStandardMaterial({ vertexColors: true,
      roughness: 0.72, emissive: new THREE.Color().setHex(0x8a351b, THREE.SRGBColorSpace),
      emissiveIntensity: 0.10, flatShading: true });
    const body = new THREE.Group();
    body.name = 'King Vine rooted body';
    root.add(body);
    this.voxelBody = body;
    mesh(body, voxelKingVineBase(), shell, 0, 0, 0);
    this.core = mesh(body, voxelKingVineCore(), coreMat, 0, 0, 0);
    this.core.name = 'King Vine exposed stem';
    this.core.visible = false;
    const guardGeometry = voxelKingVineGuardLeaf();
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.name = side < 0 ? 'King Vine guard left' : 'King Vine guard right';
      hinge.position.set(side * 0.65, 1.7, 0.45);
      body.add(hinge);
      const leaf = mesh(hinge, guardGeometry, shell, 0, 0, 0);
      if (side > 0) leaf.scale.x = -1;
      this.voxelGuards.push(hinge);
    }
    const arm = new THREE.Group();
    arm.name = 'King Vine sweeping arm';
    arm.position.y = 2.2;
    body.add(arm);
    this.arm = arm;
    this.armMaterial = shell.clone();
    mesh(arm, voxelKingVineArm(), this.armMaterial, 0, 0, 0);

    const warningMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHex(0xff713e, THREE.SRGBColorSpace),
      transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
    });
    this.warning = mesh(root,
      new THREE.RingGeometry(1.8, SWEEP_RANGE, 32, 1, -Math.PI / 2 - 0.85, 1.7),
      warningMat, 0, 0.12, 0);
    this.warning.name = 'King Vine sweep warning';
    this.warning.rotation.x = -Math.PI / 2;
    this.warning.visible = false;
    this.warning.castShadow = false;
    this.warning.receiveShadow = false;
    const laneMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHex(0xffa24e, THREE.SRGBColorSpace),
      transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
    });
    this.seedLane = mesh(root, new THREE.PlaneGeometry(2.2, 27), laneMat, 0, 0.13, 13.5);
    this.seedLane.name = 'King Vine seed lane';
    this.seedLane.rotation.x = -Math.PI / 2;
    this.seedLane.visible = false;
    this.seedLane.castShadow = false;
    this.seedLane.receiveShadow = false;
    this.seedVisual = mesh(root, voxelKingVineSeed(), podMat, 0, 1.5, 0);
    this.seedVisual.name = 'King Vine seed pod';
    this.seedVisual.visible = false;

    // The guardian roots into the visible cutting ties, whose vines continue
    // to the original anchors and suspended fruit. Keep this on the ground.
    const roots = this.cutRootPath(), geometries: THREE.BufferGeometry[] = [];
    for (let i = 1; i < roots.length; i++) {
      const start = new THREE.Vector3(...roots[i - 1]);
      const delta = new THREE.Vector3(...roots[i]).sub(start);
      const geometry = voxelKingVineConnector(delta.length() + 2.88);
      geometry.translate(0, -2.88, 0);
      geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), delta.normalize()));
      geometry.translate(start.x, start.y, start.z);
      geometries.push(geometry);
    }
    this.voxelConnector = mesh(root, mergeGeometries(geometries)!, shell, 0, 0, 0);
    this.voxelConnector.name = 'King Vine melon connector';
    for (const geometry of geometries) geometry.dispose();
  }

  private cutRootPath(): VinePoint[] {
    const terrain = this.g!.get<Sunpatch>('world').terrain;
    const end = KING_MELON_CUT_ROW;
    const steps = Math.max(1, Math.floor(Math.hypot(end.x - this.center[0], end.z - this.center[2]) / 0.9));
    return Array.from({ length: steps + 1 }, (_, i) => {
      const t = i / steps, x = this.center[0] + (end.x - this.center[0]) * t;
      const z = this.center[2] + (end.z - this.center[2]) * t;
      return [x - this.center[0], terrain.height(x, z) + 0.35 - this.center[1], z - this.center[2]];
    });
  }
}

// Low-sided geometry keeps the silhouette hand-authored and consistent with
// Sunpatch's polygonal props. No voxel cubes or imported generated meshes.
const Cylinder = THREE.CylinderGeometry;
function mat(hex: number, roughness = 0.86, emissive = 0): THREE.MeshStandardMaterial {
  const color = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
  return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true,
    emissive: color, emissiveIntensity: emissive });
}
function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material,
  x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function segment(parent: THREE.Object3D, a: VinePoint, b: VinePoint,
  radius: number, material: THREE.Material): THREE.Mesh {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const delta = end.clone().sub(start);
  const m = mesh(parent, new THREE.CylinderGeometry(radius * 0.72, radius, delta.length(), 7),
    material, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return m;
}
function readPoint(value: VinePoint | THREE.Vector3): VinePoint | null {
  if (Array.isArray(value)) return validPoint(value) ? point(value) : null;
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)
    ? [value.x, value.y, value.z] : null;
}
function validPoint(value: unknown): value is VinePoint {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}
function distanceXZ(a: VinePoint, b: VinePoint): number { return Math.hypot(a[0] - b[0], a[2] - b[2]); }
function distance3(a: VinePoint, b: VinePoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
function normalize(v: VinePoint): VinePoint {
  const n = Math.hypot(...v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}
function scale(v: VinePoint, n: number): VinePoint { return [v[0] * n, v[1] * n, v[2] * n]; }
function raySphere(origin: VinePoint, direction: VinePoint, centre: VinePoint,
  radius: number, reach: number): boolean {
  const len = Math.hypot(...direction);
  const to: VinePoint = [centre[0] - origin[0], centre[1] - origin[1], centre[2] - origin[2]];
  const along = (to[0] * direction[0] + to[1] * direction[1] + to[2] * direction[2]) / len;
  if (along < 0 || along > reach) return false;
  const missSq = Math.max(0, to[0] ** 2 + to[1] ** 2 + to[2] ** 2 - along ** 2);
  return missSq <= radius * radius;
}
