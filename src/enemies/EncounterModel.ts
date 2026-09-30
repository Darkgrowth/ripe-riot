import { probeMeleeSweep, type MeleeContact, type MeleeSurface } from './MeleeSweep.ts';

/** Host-owned encounter rules. Coordinates are world-space metres. */
export type Point3 = [number, number, number];
export type EncounterKind = 'mimic' | 'snapjaw' | 'spitter';
export type EncounterPhase = 'idle' | 'warn' | 'attack' | 'stagger' | 'recover' | 'defeated';
export type EncounterStrike = 'melee' | 'air';

export interface EncounterTarget {
  id: string;
  position: Point3;
  protected?: boolean;
}

export interface EncounterState {
  kind: EncounterKind;
  position: Point3;
  heading: number;
  phase: EncounterPhase;
  timeLeft: number;
  health: number;
  baited: boolean;
  capturedVictimId: string | null;
  captureTimeLeft: number;
  /** Committed throw direction while the victim is held. */
  captureAim?: Point3 | null;
  dormant?: boolean;
  returning?: boolean;
  /** A mallet-controlled heading for the next warning only. */
  pendingHeading?: number | null;
  /** Start of a charge still in progress, needed after host promotion. */
  chargeStart?: Point3 | null;
}

export interface EncounterNetState {
  revision: number;
  encounters: EncounterState[];
  projectiles: EncounterProjectile[];
  nextMimicImpactId?: number;
  mimicGrace?: Array<{ victimId: string; remaining: number }>;
  nextFlingId?: number;
  flights?: EncounterFlight[];
  snapjawGrace?: Array<{ victimId: string; remaining: number }>;
}

export interface EncounterFlight {
  victimId: string;
  flingId: number;
  remaining: number;
}

export interface MimicImpact {
  type: 'mimic-impact';
  id: number;
  from: Point3;
  to: Point3;
  treePlantId: number | null;
}

export interface EncounterProjectile {
  reflectedBy?: string;
  id: number;
  position: Point3;
  velocity: Point3;
  timeLeft: number;
}

export interface EncounterHit {
  kind: EncounterKind;
  damage: number;
  defeated: boolean;
  attackerId?: string;
  releasedVictimId?: string;
  deflectedProjectileId?: number;
  mimicImpact?: MimicImpact;
}

export interface EncounterMeleeResult {
  outcome: 'whoosh' | 'blocked' | 'protected' | 'hit';
  target?: EncounterKind;
  contact?: MeleeContact;
  hit?: EncounterHit;
}

export interface EncounterDamage {
  type: 'damage';
  kind: EncounterKind;
  victimId: string;
  amount: number;
}

export interface EncounterCapture {
  type: 'capture';
  kind: 'snapjaw';
  victimId: string;
}

export interface EncounterRelease {
  type: 'release';
  kind: 'snapjaw';
  victimId: string;
  reason: 'timeout';
}

export interface EncounterFling {
  type: 'fling';
  kind: 'snapjaw';
  victimId: string;
  flingId: number;
  aim: Point3;
}

export type EncounterEvent = EncounterDamage | EncounterCapture | EncounterRelease
  | EncounterFling | MimicImpact | { type: 'reflected-hit'; hit: EncounterHit };

interface InternalState extends EncounterState {
  aim: Point3;
  home: Point3;
  leashRadius: number;
  alreadyHit: Set<string>;
}

const WARN = { mimic: 0.8, snapjaw: 0.72, spitter: 0.9 };
const ATTACK = { mimic: 1.05, snapjaw: 0.32, spitter: 0.2 };
const RECOVER = { mimic: 2.15, snapjaw: 1.6, spitter: 1.5 };
const HEALTH = { mimic: 3, snapjaw: 2, spitter: 2 };
const PROJECTILE_GRAVITY = 7.5;
const MIMIC_RADIUS = 0.85;
// Keep the full 1.25 m visual shell visible after its lunge. The mallet still
// reaches its surface from here, so the counterattack window remains fair.
const MIMIC_RECOVER_DISTANCE = 2.45;
const MIMIC_STAGGER = 0.48;
const MIMIC_TREE_STAGGER = 1.05;
const MIMIC_HIT_GRACE = 5.2;
const SNAPJAW_HIT_GRACE = 3.2;
const SNAPJAW_FLIGHT_WINDOW = 1.8;

/** A world collision query shared by charge, knockback and bite checks. */
export type ProjectileBlocked = (from: Point3, to: Point3) => number | null;
export interface MimicCollision { point: Point3; treePlantId: number | null }
export type MimicBlocked = (from: Point3, to: Point3, radius: number) => boolean | MimicCollision | null;

const distanceXZ = (a: Point3, b: Point3): number => Math.hypot(a[0] - b[0], a[2] - b[2]);
const headingTo = (a: Point3, b: Point3): number => Math.atan2(b[0] - a[0], b[2] - a[2]);

export class EncounterModel {
  private encounters = new Map<EncounterKind, InternalState>();
  private targets: EncounterTarget[] = [];
  private revision = 0;
  private lastApplied = -1;
  private groundHeight: ((x: number, z: number) => number) | null;
  private elapsed = 0;
  private lastStrikeAt = new Map<string, number>();
  private projectiles: EncounterProjectile[] = [];
  private nextProjectileId = 1;
  private nextMimicImpactId = 1;
  private mimicGrace = new Map<string, number>();
  private snapjawGrace = new Map<string, number>();
  private flights = new Map<string, EncounterFlight>();
  private nextFlingId = 1;
  private lastReleasedFlingId = 0;
  private mimicBlocked: MimicBlocked | null;
  private projectileBlocked: ProjectileBlocked | null;

  constructor(spawns: Array<{ kind: EncounterKind; position: Point3; dormant?: boolean; leashRadius?: number }>,
    groundHeight: ((x: number, z: number) => number) | null = null,
    initialRevision = 0, mimicBlocked: MimicBlocked | null = null,
    projectileBlocked: ProjectileBlocked | null = null) {
    this.groundHeight = groundHeight;
    this.mimicBlocked = mimicBlocked;
    this.projectileBlocked = projectileBlocked;
    this.revision = initialRevision;
    for (const spawn of spawns) {
      this.encounters.set(spawn.kind, {
        kind: spawn.kind, position: [...spawn.position], heading: 0,
        phase: 'idle', timeLeft: 0, health: HEALTH[spawn.kind], baited: false,
        capturedVictimId: null, captureTimeLeft: 0, captureAim: null,
        dormant: !!spawn.dormant, returning: false, home: [...spawn.position],
        leashRadius: spawn.leashRadius ?? Infinity,
        aim: [...spawn.position], alreadyHit: new Set(), pendingHeading: null,
        chargeStart: null,
      });
    }
  }

  get(kind: EncounterKind): Readonly<EncounterState> {
    const state = this.encounters.get(kind);
    if (!state) throw new Error(`Encounter not found: ${kind}`);
    return state;
  }

  setTargets(targets: EncounterTarget[]): void {
    this.targets = targets.filter(t => !t.protected && typeof t.id === 'string' && t.position.every(Number.isFinite))
      .map(t => ({ id: t.id, position: [...t.position] }));
  }

  activate(kind: EncounterKind): boolean {
    const state = this.encounters.get(kind);
    if (!state || state.phase === 'defeated') return false;
    state.dormant = false;
    this.revision++;
    return true;
  }

  restoreCleared(kinds: Iterable<EncounterKind>): void {
    for (const kind of kinds) {
      const state = this.encounters.get(kind);
      if (!state) continue;
      state.phase = 'defeated'; state.health = 0; state.timeLeft = 0;
      state.dormant = false; state.returning = false; state.baited = false;
      state.capturedVictimId = null; state.captureTimeLeft = 0; state.captureAim = null;
      state.pendingHeading = null; state.chargeStart = null;
      if (kind === 'spitter') this.projectiles = [];
      if (kind === 'mimic') this.mimicGrace.clear();
      if (kind === 'snapjaw') { this.snapjawGrace.clear(); this.flights.clear(); }
    }
    this.revision++;
  }

  private returnHome(state: InternalState, dt: number): boolean {
    if (state.kind !== 'mimic' || !Number.isFinite(state.leashRadius)) return false;
    const homeDistance = distanceXZ(state.position, state.home);
    const nearby = this.targets.some(t => distanceXZ(t.position, state.home) <= state.leashRadius);
    if (!state.returning && nearby && homeDistance < state.leashRadius) return false;
    if (homeDistance < .12) {
      state.returning = false; state.phase = 'idle'; state.timeLeft = 0;
      return !nearby;
    }
    state.returning = true; state.phase = 'idle'; state.timeLeft = 0;
    state.pendingHeading = null; state.chargeStart = null;
    const heading = headingTo(state.position, state.home);
    const stride = Math.min(homeDistance, dt * 3.5);
    for (const offset of [0, .65, -.65, 1.2, -1.2]) {
      const next: Point3 = [state.position[0] + Math.sin(heading + offset) * stride,
        state.position[1], state.position[2] + Math.cos(heading + offset) * stride];
      if (this.groundHeight) next[1] = this.groundHeight(next[0], next[2]);
      if (this.mimicBlocked?.(state.position, next, MIMIC_RADIUS)) continue;
      state.position = next; state.heading = heading + offset; break;
    }
    return true;
  }

  step(dt: number): EncounterEvent[] {
    if (!(dt > 0) || !Number.isFinite(dt)) return [];
    this.elapsed += dt;
    const events: EncounterEvent[] = [];
    for (const [victimId, flight] of this.flights) {
      flight.remaining = Math.max(0, flight.remaining - dt);
      if (flight.remaining === 0) this.flights.delete(victimId);
    }
    this.stepProjectiles(dt, events);
    for (const state of this.encounters.values()) {
      if (state.kind === 'snapjaw' && state.capturedVictimId !== null) {
        state.captureTimeLeft = Math.max(0, state.captureTimeLeft - dt);
        if (state.captureTimeLeft === 0) {
          const victimId = state.capturedVictimId;
          const flingId = this.nextFlingId++;
          const aim: Point3 = state.captureAim ? [...state.captureAim]
            : this.soloFlingAim(state);
          events.push({ type: 'fling', kind: 'snapjaw', victimId, flingId, aim });
          this.flights.set(victimId, { victimId, flingId,
            remaining: SNAPJAW_FLIGHT_WINDOW });
          this.clearCapture(state);
          state.phase = 'recover';
          state.timeLeft = RECOVER.snapjaw;
        }
        else continue;
      }
      if (state.phase === 'defeated' || state.dormant || this.returnHome(state, dt)) continue;
      if (state.phase === 'idle') {
        const radius = state.kind === 'mimic' ? 13 : state.kind === 'spitter' ? 18 : 4.8;
        const nearest = this.targets.filter(t => distanceXZ(t.position, state.position) <= radius
          && (state.kind !== 'mimic' || this.elapsed >= (this.mimicGrace.get(t.id) ?? 0))
          && (state.kind !== 'snapjaw' || this.elapsed >= (this.snapjawGrace.get(t.id) ?? 0))
          && (state.kind !== 'mimic' || distanceXZ(t.position, state.home) <= state.leashRadius)
          && (state.kind !== 'spitter' || (distanceXZ(t.position, state.position) >= 3.5
            && this.projectileBlocked?.([state.position[0], state.position[1] + 2.1, state.position[2]],
              [t.position[0], t.position[1] + 1, t.position[2]]) == null)))
          .sort((a, b) => distanceXZ(a.position, state.position) - distanceXZ(b.position, state.position))[0];
        if (nearest) this.beginWarning(state, nearest.position, false);
        continue;
      }

      const elapsed = Math.min(dt, state.timeLeft);
      state.timeLeft = Math.max(0, state.timeLeft - dt);
      if (state.phase === 'attack' && state.kind !== 'spitter') {
        if (state.kind === 'mimic') {
          const from: Point3 = [...state.position];
          const next: Point3 = [state.position[0] + Math.sin(state.heading) * 10 * elapsed,
            state.position[1], state.position[2] + Math.cos(state.heading) * 10 * elapsed];
          if (this.groundHeight) next[1] = this.groundHeight(next[0], next[2]);
          const collision = this.mimicBlocked?.(from, next, MIMIC_RADIUS);
          if (collision) {
            const contact = typeof collision === 'object' && collision.point?.every(Number.isFinite)
              ? collision.point : next;
            const treePlantId = typeof collision === 'object' && Number.isSafeInteger(collision.treePlantId)
              ? collision.treePlantId : null;
            events.push(this.finishMimicCharge(state, contact, treePlantId));
            state.phase = treePlantId !== null ? 'stagger' : 'recover';
            state.timeLeft = treePlantId !== null ? MIMIC_TREE_STAGGER : RECOVER.mimic;
          } else state.position = next;
        }
        for (const target of this.targets) {
          if (state.kind === 'mimic' && state.phase !== 'attack') break;
          if (state.alreadyHit.has(target.id)) continue;
          if (state.kind === 'snapjaw' && state.capturedVictimId !== null) break;
          if (state.kind === 'snapjaw'
            && this.elapsed < (this.snapjawGrace.get(target.id) ?? 0)) continue;
          const reach = state.kind === 'mimic' ? 1.5 : 2.25;
          if (distanceXZ(state.position, target.position) > reach) continue;
          if (state.kind === 'mimic' && this.mimicBlocked?.(state.position, target.position, 0.1)) continue;
          if (state.kind === 'snapjaw') {
            const toward = headingTo(state.position, target.position);
            if (Math.cos(toward - state.heading) < 0.45) continue;
          }
          state.alreadyHit.add(target.id);
          if (state.kind === 'mimic') this.mimicGrace.set(target.id, this.elapsed + MIMIC_HIT_GRACE);
          events.push({ type: 'damage', kind: state.kind, victimId: target.id,
            amount: state.kind === 'mimic' ? 28 : 38 });
          if (state.kind === 'mimic') {
            events.push(this.finishMimicCharge(state, state.position, null));
            // A lunge has one committed impact. Halt it at body contact rather
            // than letting the whole shell travel through the player's view.
            const ax = state.position[0] - target.position[0];
            const az = state.position[2] - target.position[2];
            const distance = Math.hypot(ax, az);
            const ux = distance > 1e-5 ? ax / distance : -Math.sin(state.heading);
            const uz = distance > 1e-5 ? az / distance : -Math.cos(state.heading);
            const next: Point3 = [target.position[0] + ux * MIMIC_RECOVER_DISTANCE,
              state.position[1], target.position[2] + uz * MIMIC_RECOVER_DISTANCE];
            if (this.groundHeight) next[1] = this.groundHeight(next[0], next[2]);
            if (!this.mimicBlocked?.(state.position, next, 0.1)) state.position = next;
            state.phase = 'recover';
            state.timeLeft = RECOVER.mimic;
            break;
          }
          if (state.kind === 'snapjaw') {
            state.capturedVictimId = target.id;
            state.captureTimeLeft = 2.4;
            const ally = this.targets.filter(t => t.id !== target.id
              && distanceXZ(t.position, state.position) <= 11)
              .sort((a, b) => distanceXZ(a.position, state.position)
                - distanceXZ(b.position, state.position))[0];
            state.captureAim = ally ? [...ally.position] : this.soloFlingAim(state);
            state.heading = headingTo(state.position, state.captureAim);
            events.push({ type: 'capture', kind: 'snapjaw', victimId: target.id });
          }
        }
      }
      if (state.timeLeft > 0) continue;
      if (state.phase === 'warn') {
        state.phase = 'attack';
        state.timeLeft = ATTACK[state.kind];
        state.alreadyHit.clear();
        if (state.kind === 'mimic') state.chargeStart = [...state.position];
        if (state.kind === 'spitter') this.launchProjectile(state);
      } else if (state.phase === 'attack') {
        if (state.kind === 'mimic')
          events.push(this.finishMimicCharge(state, state.position, null));
        state.phase = 'recover';
        state.timeLeft = RECOVER[state.kind];
      } else if (state.phase === 'stagger') {
        state.phase = 'recover';
        state.timeLeft = RECOVER.mimic;
      } else if (state.phase === 'recover') {
        state.phase = 'idle';
        state.baited = false;
      }
    }
    this.revision++;
    return events;
  }

  /** A thrown fruit near the rooted jaws can draw their next snap away. */
  offerBait(position: Point3): boolean {
    const state = this.encounters.get('snapjaw');
    if (!state || state.baited || (state.phase !== 'idle' && state.phase !== 'warn') || !position.every(Number.isFinite)
      || distanceXZ(position, state.position) > 5.5) return false;
    this.beginWarning(state, position, true);
    this.revision++;
    return true;
  }

  /** Follow the one accepted physical lure during warning; never restart its
   * clock. Once the bite begins, its direction is committed like a normal snap. */
  followBait(position: Point3): boolean {
    const state = this.encounters.get('snapjaw');
    if (!state || state.phase !== 'warn' || !state.baited || !position.every(Number.isFinite)
      || distanceXZ(position, state.position) > 5.5
      || position[1] < state.position[1] - .2 || position[1] > state.position[1] + 3.5) return false;
    state.aim = [...position];
    state.heading = headingTo(state.position, position);
    this.revision++;
    return true;
  }

  /** The captured player can break free after the bite settles. */
  tryEscape(victimId: string): boolean {
    const state = this.encounters.get('snapjaw');
    if (!state || state.capturedVictimId !== victimId || state.captureTimeLeft > 2.05) return false;
    this.clearCapture(state);
    this.revision++;
    return true;
  }

  /** Another player can pull the victim out of the rooted jaws. */
  tryRescue(victimId: string, rescuerId: string): boolean {
    const state = this.encounters.get('snapjaw');
    const rescuer = this.targets.find(t => t.id === rescuerId);
    if (!state || !rescuer || rescuerId === victimId
      || state.capturedVictimId !== victimId
      || distanceXZ(rescuer.position, state.position) > 3.4) return false;
    this.clearCapture(state);
    this.revision++;
    return true;
  }

  isCaptured(victimId: string): boolean {
    return this.encounters.get('snapjaw')?.capturedVictimId === victimId;
  }

  isFlying(victimId: string, flingId: number): boolean {
    const flight = this.flights.get(victimId);
    return !!flight && flight.flingId === flingId && flight.remaining > 0;
  }

  finishFlight(victimId: string, flingId: number): boolean {
    if (!this.isFlying(victimId, flingId)) return false;
    this.flights.delete(victimId);
    this.revision++;
    return true;
  }

  /** An authenticated launch packet can arrive before its matching snapshot. */
  releaseFromFling(victimId: string, flingId: number, revision: number): boolean {
    if (!victimId || !Number.isSafeInteger(flingId) || flingId < 1
      || flingId <= this.lastReleasedFlingId || !Number.isSafeInteger(revision)
      || revision < this.lastApplied) return false;
    const state = this.encounters.get('snapjaw');
    if (!state || (state.capturedVictimId && state.capturedVictimId !== victimId)) return false;
    this.clearCapture(state);
    this.lastReleasedFlingId = flingId;
    this.nextFlingId = Math.max(this.nextFlingId, flingId + 1);
    this.lastApplied = Math.max(this.lastApplied, revision);
    this.revision = Math.max(this.revision, revision);
    return true;
  }

  /** A lethal bite follows the normal downed path instead of a later throw. */
  abortCapture(victimId: string): boolean {
    const state = this.encounters.get('snapjaw');
    if (!state || state.capturedVictimId !== victimId) return false;
    this.clearCapture(state);
    this.revision++;
    return true;
  }

  /** Input routing on clients: this never mutates health or projectile state. */
  canStrike(origin: Point3, direction: Point3, strike: EncounterStrike): boolean {
    if (!origin.every(Number.isFinite) || !direction.every(Number.isFinite)) return false;
    const length = Math.hypot(...direction);
    if (length < 0.001) return false;
    return this.rayEnemy(origin, direction, length, strike, false) !== null
      || (strike === 'air' && this.rayProjectile(origin, direction, length) !== null);
  }

  resolveMelee(origin: Point3, direction: Point3, attackerId: string,
    blocked: (contact: MeleeContact) => boolean): EncounterMeleeResult {
    const surfaces: MeleeSurface[] = [];
    for (const state of this.encounters.values()) {
      if (state.phase === 'defeated' || state.dormant) continue;
      const [x, y, z] = state.position;
      if (state.kind === 'mimic')
        surfaces.push({ id: state.kind, center: [x, y + 1.25, z], radius: 1.25 });
      else if (state.kind === 'snapjaw')
        surfaces.push({ id: state.kind, center: [x, y + 1.45, z], radius: 1.35 });
      else {
        surfaces.push({ id: state.kind, center: [x, y + 2.1, z], radius: 0.92 });
        surfaces.push({ id: state.kind, center: [x, y + 0.85, z], radius: 0.52 });
      }
    }
    const contact = probeMeleeSweep(origin, direction, surfaces);
    if (!contact) return { outcome: 'whoosh' };
    const state = this.encounters.get(contact.id as EncounterKind)!;
    if (blocked(contact)) return { outcome: 'blocked', target: state.kind, contact };
    if (state.kind === 'snapjaw' && state.phase !== 'recover'
      && state.capturedVictimId === null)
      return { outcome: 'protected', target: state.kind, contact };
    const hit = this.applyHit(state, 'melee', attackerId, origin, false);
    return hit ? { outcome: 'hit', target: state.kind, contact, hit }
      : { outcome: 'protected', target: state.kind, contact };
  }

  /** Resolve a world-space swing or airborne strike against the first enemy on the ray. */
  tryHit(origin: Point3, direction: Point3, strike: EncounterStrike, attackerId?: string): EncounterHit | null {
    if (!origin.every(Number.isFinite) || !direction.every(Number.isFinite)) return null;
    const length = Math.hypot(...direction);
    if (length < 0.001) return null;
    const candidate = this.rayEnemy(origin, direction, length, strike, true);
    const projectile = strike === 'air' ? this.rayProjectile(origin, direction, length) : null;
    if (projectile && (!candidate || projectile.along < candidate.along)) {
      const seed = projectile.state;
      const source = this.encounters.get('spitter');
      if (!source || source.phase === 'defeated') return null;
      const destination: Point3 = [source.position[0], source.position[1] + 2.1, source.position[2]];
      const flight = Math.max(.08, Math.hypot(destination[0] - seed.position[0],
        destination[1] - seed.position[1], destination[2] - seed.position[2]) / 20);
      seed.velocity = [(destination[0] - seed.position[0]) / flight,
        (destination[1] - seed.position[1] + .5 * PROJECTILE_GRAVITY * flight * flight) / flight,
        (destination[2] - seed.position[2]) / flight];
      seed.reflectedBy = attackerId ?? 'solo'; seed.timeLeft = Math.max(1, flight + .3);
      this.revision++;
      return { kind: 'spitter', damage: 0, defeated: false, attackerId,
        deflectedProjectileId: projectile.state.id };
    }
    if (!candidate) return null;
    return this.applyHit(candidate.state, strike, attackerId, origin, true);
  }

  private applyHit(state: InternalState, strike: EncounterStrike, attackerId: string | undefined,
    origin: Point3, throttle: boolean): EncounterHit | null {
    const strikeKey = `${state.kind}:${attackerId ?? ''}`;
    if (throttle) {
      if (this.elapsed - (this.lastStrikeAt.get(strikeKey) ?? -Infinity) < 0.42) return null;
      this.lastStrikeAt.set(strikeKey, this.elapsed);
    }
    const damage = strike === 'air' ? 2 : 1;
    const mimicImpact = state.kind === 'mimic' && state.phase === 'attack'
      ? this.finishMimicCharge(state, state.position, null) : undefined;
    state.health = Math.max(0, state.health - damage);
    let releasedVictimId: string | undefined;
    if (state.health === 0) {
      state.phase = 'defeated';
      state.timeLeft = 0;
      if (state.kind === 'spitter') this.projectiles = [];
      if (state.capturedVictimId !== null) {
        releasedVictimId = state.capturedVictimId;
        this.clearCapture(state);
      }
    } else if (state.kind === 'mimic') {
      state.pendingHeading = headingTo(origin, state.position);
      const dx = state.position[0] - origin[0], dz = state.position[2] - origin[2];
      const len = Math.hypot(dx, dz) || 1;
      const next: Point3 = [state.position[0] + dx / len * 0.55, state.position[1],
        state.position[2] + dz / len * 0.55];
      if (this.groundHeight) next[1] = this.groundHeight(next[0], next[2]);
      if (!this.mimicBlocked?.(state.position, next, MIMIC_RADIUS)) state.position = next;
      state.phase = 'stagger';
      state.timeLeft = MIMIC_STAGGER;
    } else if (state.kind === 'snapjaw') {
      if (state.capturedVictimId !== null) {
        releasedVictimId = state.capturedVictimId;
        this.clearCapture(state);
      }
      state.phase = 'recover';
      state.timeLeft = RECOVER.snapjaw;
    } else if (state.kind === 'spitter') {
      state.phase = 'recover';
      state.timeLeft = RECOVER.spitter;
    }
    this.revision++;
    return { kind: state.kind, damage, defeated: state.health === 0,
      attackerId, ...(releasedVictimId !== undefined ? { releasedVictimId } : {}),
      ...(mimicImpact ? { mimicImpact } : {}) };
  }

  snapshot(): EncounterNetState {
    return {
      revision: this.revision,
      encounters: [...this.encounters.values()].map(s => ({
        kind: s.kind, position: [...s.position], heading: s.heading, phase: s.phase,
        timeLeft: s.timeLeft, health: s.health, baited: s.baited,
        capturedVictimId: s.capturedVictimId, captureTimeLeft: s.captureTimeLeft,
        captureAim: s.captureAim ? [...s.captureAim] : null,
        dormant: !!s.dormant, returning: !!s.returning,
        pendingHeading: s.pendingHeading ?? null,
        chargeStart: s.chargeStart ? [...s.chargeStart] : null,
      })),
      projectiles: this.projectiles.map(p => ({ id: p.id, position: [...p.position],
        velocity: [...p.velocity], timeLeft: p.timeLeft,
        ...(p.reflectedBy ? { reflectedBy: p.reflectedBy } : {}) })),
      nextMimicImpactId: this.nextMimicImpactId,
      mimicGrace: [...this.mimicGrace].filter(([, until]) => until > this.elapsed)
        .map(([victimId, until]) => ({ victimId, remaining: until - this.elapsed })),
      nextFlingId: this.nextFlingId,
      flights: [...this.flights.values()].map(f => ({ ...f })),
      snapjawGrace: [...this.snapjawGrace].filter(([, until]) => until > this.elapsed)
        .map(([victimId, until]) => ({ victimId, remaining: until - this.elapsed })),
    };
  }

  /** Clients apply state; only the host runs step/tryHit/offerBait. */
  applySnapshot(snapshot: EncounterNetState): boolean {
    if (!Number.isFinite(snapshot?.revision) || snapshot.revision <= this.lastApplied
      || !Array.isArray(snapshot.encounters)) return false;
    for (const incoming of snapshot.encounters) {
      const state = this.encounters.get(incoming.kind);
      if (!state || !incoming.position?.every(Number.isFinite)
        || !Number.isFinite(incoming.heading) || !Number.isFinite(incoming.timeLeft)
        || !Number.isFinite(incoming.health)) continue;
      state.position = [...incoming.position];
      state.heading = incoming.heading;
      state.phase = incoming.phase;
      state.timeLeft = incoming.timeLeft;
      state.health = incoming.health;
      state.baited = !!incoming.baited;
      state.dormant = !!incoming.dormant; state.returning = !!incoming.returning;
      state.capturedVictimId = typeof incoming.capturedVictimId === 'string'
        ? incoming.capturedVictimId : null;
      state.captureTimeLeft = Math.max(0, incoming.captureTimeLeft || 0);
      state.captureAim = incoming.captureAim?.length === 3
        && incoming.captureAim.every(Number.isFinite) ? [...incoming.captureAim] : null;
      state.pendingHeading = typeof incoming.pendingHeading === 'number'
        && Number.isFinite(incoming.pendingHeading) ? incoming.pendingHeading : null;
      state.chargeStart = incoming.chargeStart?.length === 3
        && incoming.chargeStart.every(Number.isFinite) ? [...incoming.chargeStart] : null;
    }
    this.projectiles = Array.isArray(snapshot.projectiles)
      ? snapshot.projectiles.filter(p => Number.isFinite(p.id)
        && p.position?.every(Number.isFinite) && p.velocity?.every(Number.isFinite)
        && Number.isFinite(p.timeLeft))
        .map(p => ({ id: p.id, position: [...p.position], velocity: [...p.velocity],
          timeLeft: p.timeLeft, ...(typeof p.reflectedBy === 'string' ? { reflectedBy: p.reflectedBy } : {}) }))
      : [];
    this.lastApplied = snapshot.revision;
    this.nextMimicImpactId = Number.isSafeInteger(snapshot.nextMimicImpactId)
      && snapshot.nextMimicImpactId! > 0 ? snapshot.nextMimicImpactId! : this.nextMimicImpactId;
    this.mimicGrace.clear();
    if (Array.isArray(snapshot.mimicGrace)) for (const entry of snapshot.mimicGrace) {
      if (typeof entry?.victimId === 'string' && entry.victimId.length > 0
        && entry.victimId.length <= 80 && Number.isFinite(entry.remaining)
        && entry.remaining > 0 && this.mimicGrace.size < 8)
        this.mimicGrace.set(entry.victimId, this.elapsed + Math.min(MIMIC_HIT_GRACE, entry.remaining));
    }
    this.nextFlingId = Number.isSafeInteger(snapshot.nextFlingId)
      && snapshot.nextFlingId! > 0 ? snapshot.nextFlingId! : this.nextFlingId;
    this.flights.clear();
    if (Array.isArray(snapshot.flights)) for (const flight of snapshot.flights) {
      if (typeof flight?.victimId === 'string' && flight.victimId.length > 0
        && flight.victimId.length <= 80 && Number.isSafeInteger(flight.flingId)
        && flight.flingId > 0 && Number.isFinite(flight.remaining)
        && flight.remaining > 0 && this.flights.size < 8)
        this.flights.set(flight.victimId, { victimId: flight.victimId,
          flingId: flight.flingId, remaining: Math.min(SNAPJAW_FLIGHT_WINDOW, flight.remaining) });
    }
    this.snapjawGrace.clear();
    if (Array.isArray(snapshot.snapjawGrace)) for (const entry of snapshot.snapjawGrace) {
      if (typeof entry?.victimId === 'string' && entry.victimId.length > 0
        && entry.victimId.length <= 80 && Number.isFinite(entry.remaining)
        && entry.remaining > 0 && this.snapjawGrace.size < 8)
        this.snapjawGrace.set(entry.victimId,
          this.elapsed + Math.min(SNAPJAW_HIT_GRACE, entry.remaining));
    }
    this.revision = snapshot.revision;
    return true;
  }

  private beginWarning(state: InternalState, aim: Point3, baited: boolean): void {
    state.phase = 'warn';
    state.timeLeft = WARN[state.kind];
    state.aim = [...aim];
    state.heading = state.kind === 'mimic' && typeof state.pendingHeading === 'number'
      && Number.isFinite(state.pendingHeading) ? state.pendingHeading : headingTo(state.position, aim);
    if (state.kind === 'mimic') state.pendingHeading = null;
    state.baited = baited;
  }

  private soloFlingAim(state: InternalState): Point3 {
    return [state.position[0] + Math.sin(state.heading) * 7,
      state.position[1], state.position[2] + Math.cos(state.heading) * 7];
  }

  private clearCapture(state: InternalState): void {
    if (state.capturedVictimId !== null)
      this.snapjawGrace.set(state.capturedVictimId, this.elapsed + SNAPJAW_HIT_GRACE);
    state.capturedVictimId = null;
    state.captureTimeLeft = 0;
    state.captureAim = null;
  }

  private finishMimicCharge(state: InternalState, to: Point3,
    treePlantId: number | null): MimicImpact {
    const from: Point3 = state.chargeStart ? [...state.chargeStart] : [...state.position];
    state.chargeStart = null;
    return { type: 'mimic-impact', id: this.nextMimicImpactId++, from,
      to: [...to], treePlantId };
  }

  private launchProjectile(state: InternalState): void {
    const from: Point3 = [state.position[0], state.position[1] + 2.1, state.position[2]];
    if (this.projectileBlocked?.(from, [state.aim[0], state.aim[1] + 1, state.aim[2]]) != null) return;
    const distance = distanceXZ(state.position, state.aim);
    const flight = Math.max(0.35, distance / 15);
    const velocity: Point3 = [
      (state.aim[0] - from[0]) / flight,
      (state.aim[1] + 1.0 - from[1] + 0.5 * PROJECTILE_GRAVITY * flight ** 2) / flight,
      (state.aim[2] - from[2]) / flight,
    ];
    this.projectiles.push({ id: this.nextProjectileId++, position: from,
      velocity, timeLeft: Math.max(1.2, flight + 0.45) });
  }

  private stepProjectiles(dt: number, events: EncounterEvent[]): void {
    const keep: EncounterProjectile[] = [];
    for (const p of this.projectiles) {
      const from = p.position;
      const to: Point3 = [from[0] + p.velocity[0] * dt,
        from[1] + p.velocity[1] * dt - 0.5 * PROJECTILE_GRAVITY * dt * dt,
        from[2] + p.velocity[2] * dt];
      const wall = this.projectileBlocked?.(from, to) ?? null;
      let contact = wall ?? Infinity;
      let struck: EncounterTarget | null = null;
      const source = this.encounters.get('spitter');
      if (p.reflectedBy && source && source.phase !== 'defeated') {
        const t = segmentSphere(from, to, [source.position[0], source.position[1] + 2.1,
          source.position[2]], .92);
        if (t !== null && t < contact) {
          const hit = this.applyHit(source, 'air', p.reflectedBy, from, false);
          if (hit) events.push({ type: 'reflected-hit', hit });
          continue;
        }
      } else if (!p.reflectedBy) {
        for (const target of this.targets) {
          const t = segmentSphere(from, to, [target.position[0], target.position[1] + 1,
            target.position[2]], .85);
          if (t !== null && t < contact) { contact = t; struck = target; }
        }
      }
      if (struck) {
        events.push({ type: 'damage', kind: 'spitter', victimId: struck.id, amount: 24 });
        continue;
      }
      if (wall !== null) continue;
      p.position = to;
      p.velocity = [p.velocity[0], p.velocity[1] - PROJECTILE_GRAVITY * dt, p.velocity[2]];
      p.timeLeft -= dt;
      const ground = this.groundHeight?.(to[0], to[2]) ?? 0;
      if (p.timeLeft > 0 && to[1] > ground + 0.15) keep.push(p);
    }
    this.projectiles = this.encounters.get('spitter')?.phase === 'defeated' ? [] : keep;
  }

  private rayEnemy(origin: Point3, direction: Point3, length: number, strike: EncounterStrike,
    vulnerable: boolean): { state: InternalState; along: number } | null {
    const maxReach = strike === 'air' ? 18 : 3.2;
    let candidate: { state: InternalState; along: number } | null = null;
    for (const state of this.encounters.values()) {
      if (state.phase === 'defeated' || state.dormant || (vulnerable && state.kind === 'snapjaw'
        && state.phase !== 'recover' && state.capturedVictimId === null)) continue;
      const centre: Point3 = [state.position[0], state.position[1] + 1.15, state.position[2]];
      const relative: Point3 = [centre[0] - origin[0], centre[1] - origin[1], centre[2] - origin[2]];
      const along = (relative[0] * direction[0] + relative[1] * direction[1]
        + relative[2] * direction[2]) / length;
      if (along < 0 || along > maxReach) continue;
      const missSq = Math.max(0, relative[0] ** 2 + relative[1] ** 2 + relative[2] ** 2 - along ** 2);
      if (missSq > (state.kind === 'mimic' ? 1.45 : 1.6) ** 2) continue;
      if (!candidate || along < candidate.along) candidate = { state, along };
    }
    return candidate;
  }

  private rayProjectile(origin: Point3, direction: Point3, length: number):
    { state: EncounterProjectile; along: number } | null {
    let candidate: { state: EncounterProjectile; along: number } | null = null;
    for (const p of this.projectiles) {
      const relative: Point3 = [p.position[0] - origin[0], p.position[1] - origin[1],
        p.position[2] - origin[2]];
      const along = (relative[0] * direction[0] + relative[1] * direction[1]
        + relative[2] * direction[2]) / length;
      if (along < 0 || along > 18) continue;
      const missSq = Math.max(0, relative[0] ** 2 + relative[1] ** 2 + relative[2] ** 2 - along ** 2);
      if (missSq > 0.8 ** 2) continue;
      if (!candidate || along < candidate.along) candidate = { state: p, along };
    }
    return candidate;
  }
}

/** First intersection fraction, so world cover and actor hits share one ordering. */
function segmentSphere(from: Point3, to: Point3, centre: Point3, radius: number): number | null {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const r = [from[0] - centre[0], from[1] - centre[1], from[2] - centre[2]];
  const a = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  const c = r[0] ** 2 + r[1] ** 2 + r[2] ** 2 - radius * radius;
  if (c <= 0) return 0;
  if (a < 1e-10) return null;
  const b = r[0] * d[0] + r[1] * d[1] + r[2] * d[2];
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 && t <= 1 ? t : null;
}
