/** Host-owned encounter rules. Coordinates are world-space metres. */
export type Point3 = [number, number, number];
export type EncounterKind = 'mimic' | 'snapjaw' | 'spitter';
export type EncounterPhase = 'idle' | 'warn' | 'attack' | 'recover' | 'defeated';
export type EncounterStrike = 'melee' | 'air';

export interface EncounterTarget {
  id: string;
  position: Point3;
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
}

export interface EncounterNetState {
  revision: number;
  encounters: EncounterState[];
  projectiles: EncounterProjectile[];
}

export interface EncounterProjectile {
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

export type EncounterEvent = EncounterDamage | EncounterCapture | EncounterRelease;

interface InternalState extends EncounterState {
  aim: Point3;
  alreadyHit: Set<string>;
}

const WARN = { mimic: 0.8, snapjaw: 0.72, spitter: 0.9 };
const ATTACK = { mimic: 1.05, snapjaw: 0.32, spitter: 0.2 };
const RECOVER = { mimic: 1.3, snapjaw: 1.6, spitter: 1.5 };
const HEALTH = { mimic: 3, snapjaw: 2, spitter: 2 };
const PROJECTILE_GRAVITY = 7.5;

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

  constructor(spawns: Array<{ kind: EncounterKind; position: Point3 }>,
    groundHeight: ((x: number, z: number) => number) | null = null,
    initialRevision = 0) {
    this.groundHeight = groundHeight;
    this.revision = initialRevision;
    for (const spawn of spawns) {
      this.encounters.set(spawn.kind, {
        kind: spawn.kind, position: [...spawn.position], heading: 0,
        phase: 'idle', timeLeft: 0, health: HEALTH[spawn.kind], baited: false,
        capturedVictimId: null, captureTimeLeft: 0,
        aim: [...spawn.position], alreadyHit: new Set(),
      });
    }
  }

  get(kind: EncounterKind): Readonly<EncounterState> {
    const state = this.encounters.get(kind);
    if (!state) throw new Error(`Encounter not found: ${kind}`);
    return state;
  }

  setTargets(targets: EncounterTarget[]): void {
    this.targets = targets.filter(t => typeof t.id === 'string' && t.position.every(Number.isFinite))
      .map(t => ({ id: t.id, position: [...t.position] }));
  }

  step(dt: number): EncounterEvent[] {
    if (!(dt > 0) || !Number.isFinite(dt)) return [];
    this.elapsed += dt;
    const events: EncounterEvent[] = [];
    this.stepProjectiles(dt, events);
    for (const state of this.encounters.values()) {
      if (state.kind === 'snapjaw' && state.capturedVictimId !== null) {
        state.captureTimeLeft = Math.max(0, state.captureTimeLeft - dt);
        if (state.captureTimeLeft === 0) {
          events.push({ type: 'release', kind: 'snapjaw',
            victimId: state.capturedVictimId, reason: 'timeout' });
          state.capturedVictimId = null;
        }
      }
      if (state.phase === 'defeated') continue;
      if (state.phase === 'idle') {
        const radius = state.kind === 'mimic' ? 13 : state.kind === 'spitter' ? 18 : 4.8;
        const nearest = this.targets.filter(t => distanceXZ(t.position, state.position) <= radius
          && (state.kind !== 'spitter' || distanceXZ(t.position, state.position) >= 3.5))
          .sort((a, b) => distanceXZ(a.position, state.position) - distanceXZ(b.position, state.position))[0];
        if (nearest) this.beginWarning(state, nearest.position, false);
        continue;
      }

      const elapsed = Math.min(dt, state.timeLeft);
      state.timeLeft = Math.max(0, state.timeLeft - dt);
      if (state.phase === 'attack' && state.kind !== 'spitter') {
        if (state.kind === 'mimic') {
          state.position[0] += Math.sin(state.heading) * 10 * elapsed;
          state.position[2] += Math.cos(state.heading) * 10 * elapsed;
          if (this.groundHeight) state.position[1] = this.groundHeight(state.position[0], state.position[2]);
        }
        for (const target of this.targets) {
          if (state.alreadyHit.has(target.id)) continue;
          if (state.kind === 'snapjaw' && state.capturedVictimId !== null) break;
          const reach = state.kind === 'mimic' ? 1.5 : 2.25;
          if (distanceXZ(state.position, target.position) > reach) continue;
          if (state.kind === 'snapjaw') {
            const toward = headingTo(state.position, target.position);
            if (Math.cos(toward - state.heading) < 0.45) continue;
          }
          state.alreadyHit.add(target.id);
          events.push({ type: 'damage', kind: state.kind, victimId: target.id,
            amount: state.kind === 'mimic' ? 28 : 38 });
          if (state.kind === 'snapjaw') {
            state.capturedVictimId = target.id;
            state.captureTimeLeft = 2.4;
            events.push({ type: 'capture', kind: 'snapjaw', victimId: target.id });
          }
        }
      }
      if (state.timeLeft > 0) continue;
      if (state.phase === 'warn') {
        state.phase = 'attack';
        state.timeLeft = ATTACK[state.kind];
        state.alreadyHit.clear();
        if (state.kind === 'spitter') this.launchProjectile(state);
      } else if (state.phase === 'attack') {
        state.phase = 'recover';
        state.timeLeft = RECOVER[state.kind];
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
    if (!state || (state.phase !== 'idle' && state.phase !== 'warn') || !position.every(Number.isFinite)
      || distanceXZ(position, state.position) > 5.5) return false;
    this.beginWarning(state, position, true);
    this.revision++;
    return true;
  }

  /** The captured player can break free after the bite settles. */
  tryEscape(victimId: string): boolean {
    const state = this.encounters.get('snapjaw');
    if (!state || state.capturedVictimId !== victimId || state.captureTimeLeft > 2.05) return false;
    state.capturedVictimId = null;
    state.captureTimeLeft = 0;
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
    state.capturedVictimId = null;
    state.captureTimeLeft = 0;
    this.revision++;
    return true;
  }

  isCaptured(victimId: string): boolean {
    return this.encounters.get('snapjaw')?.capturedVictimId === victimId;
  }

  /** Input routing on clients: this never mutates health or projectile state. */
  canStrike(origin: Point3, direction: Point3, strike: EncounterStrike): boolean {
    if (!origin.every(Number.isFinite) || !direction.every(Number.isFinite)) return false;
    const length = Math.hypot(...direction);
    if (length < 0.001) return false;
    return this.rayEnemy(origin, direction, length, strike, false) !== null
      || (strike === 'air' && this.rayProjectile(origin, direction, length) !== null);
  }

  /** Resolve a world-space swing or airborne strike against the first enemy on the ray. */
  tryHit(origin: Point3, direction: Point3, strike: EncounterStrike, attackerId?: string): EncounterHit | null {
    if (!origin.every(Number.isFinite) || !direction.every(Number.isFinite)) return null;
    const length = Math.hypot(...direction);
    if (length < 0.001) return null;
    const candidate = this.rayEnemy(origin, direction, length, strike, true);
    const projectile = strike === 'air' ? this.rayProjectile(origin, direction, length) : null;
    if (projectile && (!candidate || projectile.along < candidate.along)) {
      this.projectiles = this.projectiles.filter(p => p.id !== projectile.state.id);
      this.revision++;
      return { kind: 'spitter', damage: 0, defeated: false, attackerId,
        deflectedProjectileId: projectile.state.id };
    }
    if (!candidate) return null;
    const state = candidate.state;
    const strikeKey = `${state.kind}:${attackerId ?? ''}`;
    if (this.elapsed - (this.lastStrikeAt.get(strikeKey) ?? -Infinity) < 0.42) return null;
    this.lastStrikeAt.set(strikeKey, this.elapsed);
    const damage = strike === 'air' ? 2 : 1;
    state.health = Math.max(0, state.health - damage);
    let releasedVictimId: string | undefined;
    if (state.health === 0) {
      state.phase = 'defeated';
      state.timeLeft = 0;
      if (state.kind === 'spitter') this.projectiles = [];
      if (state.capturedVictimId !== null) {
        releasedVictimId = state.capturedVictimId;
        state.capturedVictimId = null;
        state.captureTimeLeft = 0;
      }
    } else if (state.kind === 'mimic' && (state.phase === 'idle' || state.phase === 'attack')) {
      this.beginWarning(state, origin, false);
    } else if (state.kind === 'spitter') {
      state.phase = 'recover';
      state.timeLeft = RECOVER.spitter;
    }
    this.revision++;
    return { kind: state.kind, damage, defeated: state.health === 0,
      attackerId, ...(releasedVictimId !== undefined ? { releasedVictimId } : {}) };
  }

  snapshot(): EncounterNetState {
    return {
      revision: this.revision,
      encounters: [...this.encounters.values()].map(s => ({
        kind: s.kind, position: [...s.position], heading: s.heading, phase: s.phase,
        timeLeft: s.timeLeft, health: s.health, baited: s.baited,
        capturedVictimId: s.capturedVictimId, captureTimeLeft: s.captureTimeLeft,
      })),
      projectiles: this.projectiles.map(p => ({ id: p.id, position: [...p.position],
        velocity: [...p.velocity], timeLeft: p.timeLeft })),
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
      state.capturedVictimId = typeof incoming.capturedVictimId === 'string'
        ? incoming.capturedVictimId : null;
      state.captureTimeLeft = Math.max(0, incoming.captureTimeLeft || 0);
    }
    this.projectiles = Array.isArray(snapshot.projectiles)
      ? snapshot.projectiles.filter(p => Number.isFinite(p.id)
        && p.position?.every(Number.isFinite) && p.velocity?.every(Number.isFinite)
        && Number.isFinite(p.timeLeft))
        .map(p => ({ id: p.id, position: [...p.position], velocity: [...p.velocity],
          timeLeft: p.timeLeft }))
      : [];
    this.lastApplied = snapshot.revision;
    this.revision = snapshot.revision;
    return true;
  }

  private beginWarning(state: InternalState, aim: Point3, baited: boolean): void {
    state.phase = 'warn';
    state.timeLeft = WARN[state.kind];
    state.aim = [...aim];
    state.heading = headingTo(state.position, aim);
    state.baited = baited;
  }

  private launchProjectile(state: InternalState): void {
    const from: Point3 = [state.position[0], state.position[1] + 2.1, state.position[2]];
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
      const segment: Point3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      const segmentSq = segment[0] ** 2 + segment[1] ** 2 + segment[2] ** 2;
      let struck: EncounterTarget | null = null;
      for (const target of this.targets) {
        const centre: Point3 = [target.position[0], target.position[1] + 1.0, target.position[2]];
        const toward: Point3 = [centre[0] - from[0], centre[1] - from[1], centre[2] - from[2]];
        const t = segmentSq > 0 ? Math.max(0, Math.min(1,
          (toward[0] * segment[0] + toward[1] * segment[1] + toward[2] * segment[2]) / segmentSq)) : 0;
        if (Math.hypot(from[0] + segment[0] * t - centre[0],
          from[1] + segment[1] * t - centre[1],
          from[2] + segment[2] * t - centre[2]) < 0.85) { struck = target; break; }
      }
      if (struck) {
        events.push({ type: 'damage', kind: 'spitter', victimId: struck.id, amount: 24 });
        continue;
      }
      p.position = to;
      p.velocity = [p.velocity[0], p.velocity[1] - PROJECTILE_GRAVITY * dt, p.velocity[2]];
      p.timeLeft -= dt;
      const ground = this.groundHeight?.(to[0], to[2]) ?? 0;
      if (p.timeLeft > 0 && to[1] > ground + 0.15) keep.push(p);
    }
    this.projectiles = keep;
  }

  private rayEnemy(origin: Point3, direction: Point3, length: number, strike: EncounterStrike,
    vulnerable: boolean): { state: InternalState; along: number } | null {
    const maxReach = strike === 'air' ? 18 : 3.2;
    let candidate: { state: InternalState; along: number } | null = null;
    for (const state of this.encounters.values()) {
      if (state.phase === 'defeated' || (vulnerable && state.kind === 'snapjaw'
        && state.phase !== 'recover')) continue;
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
