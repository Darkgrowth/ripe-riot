import * as THREE from 'three';
import type { Game, System } from '@/core/Game';
import type { Sunpatch } from '@/world/Sunpatch';
import { EncounterModel, type EncounterHit, type EncounterKind,
  type EncounterNetState, type EncounterStrike, type EncounterTarget,
  type Point3 } from './EncounterModel';
import { EncounterProjectileVisual, EncounterVisual } from './EncounterVisuals';

export type EncounterIntent =
  | { kind: 'hit'; origin: Point3; direction: Point3; strike: EncounterStrike; actorId: string }
  | { kind: 'bait'; position: Point3; actorId: string }
  | { kind: 'escape'; victimId: string }
  | { kind: 'rescue'; victimId: string; rescuerId: string };

export interface EncounterNet {
  readonly authoritative: boolean;
  requestEncounter(intent: EncounterIntent): void;
}

const point = (v: THREE.Vector3): Point3 => [v.x, v.y, v.z];

/** Host-authoritative island threats. Clients only draw replicated phases. */
export class EncounterSystem implements System {
  readonly name = 'encounters';
  net: EncounterNet | null = null;
  onPlayerDamaged: ((amount: number, kind: EncounterKind, victimId: string) => void) | null = null;
  onDefeated: ((kind: EncounterKind, position: THREE.Vector3, attackerId: string) => void) | null = null;
  onCaptured: ((victimId: string) => void) | null = null;
  onReleased: ((victimId: string, reason: 'escape' | 'rescue' | 'timeout' | 'defeat') => void) | null = null;

  private g!: Game;
  private world!: Sunpatch;
  private model!: EncounterModel;
  private visuals = new Map<EncounterKind, EncounterVisual>();
  private projectileVisuals = new Map<number, EncounterProjectileVisual>();
  private explicitTargets: EncounterTarget[] | null = null;
  private currentTargets: EncounterTarget[] = [];

  init(g: Game): void {
    this.g = g;
    this.world = g.get<Sunpatch>('world');
    this.resetModel();
    for (const kind of ['mimic', 'snapjaw', 'spitter'] as const) {
      this.visuals.set(kind, new EncounterVisual(kind, g.renderer.scene));
    }
    g.debug?.addProbe('encounters', () => this.info());
    g.debug?.addAction('encounters.info', () => this.info());
    // These actions use the same range, phase and authority checks as player input.
    g.debug?.addAction('encounters.hit', (kind: EncounterKind, strike: EncounterStrike = 'melee',
      actorId = 'solo') => {
      const target = this.model.get(kind);
      const origin = new THREE.Vector3(target.position[0], target.position[1] + 1.15,
        target.position[2] - 2);
      return this.tryHit(origin, new THREE.Vector3(0, 0, 1), strike, actorId);
    });
    g.debug?.addAction('encounters.bait', () => {
      const target = this.model.get('snapjaw');
      return this.offerBait(new THREE.Vector3(target.position[0] + 3, target.position[1],
        target.position[2]));
    });
    g.debug?.addAction('encounters.reset', () => {
      if (!this.authoritative) return false;
      this.resetModel();
      return this.info();
    });
  }

  get authoritative(): boolean { return this.net?.authoritative ?? true; }

  /** The host supplies local and remote peers each frame. Solo defaults to the local player. */
  setTargets(targets: EncounterTarget[]): void {
    this.explicitTargets = targets.map(t => ({ id: t.id, position: [...t.position] }));
  }

  fixedStep(dt: number): void {
    if (!this.authoritative) return;
    const targets = this.explicitTargets ?? [{ id: 'solo', position: point(this.g.player.position) }];
    this.currentTargets = targets;
    this.model.setTargets(targets);
    for (const event of this.model.step(dt)) {
      if (event.type === 'damage') {
        this.onPlayerDamaged?.(event.amount, event.kind, event.victimId);
        this.emit('encounter:attack', {
          kind: event.kind, victimId: event.victimId, damage: event.amount,
        });
      } else if (event.type === 'capture') {
        this.onCaptured?.(event.victimId);
        this.emit('encounter:capture', { kind: 'snapjaw', victimId: event.victimId });
      } else {
        this.release(event.victimId, 'timeout');
      }
    }
  }

  frameUpdate(dt: number): void {
    for (const kind of ['mimic', 'snapjaw', 'spitter'] as const) {
      const state = this.model.get(kind);
      this.visuals.get(kind)?.update(state,
        this.world.terrain.height(state.position[0], state.position[2]), dt);
    }
    const active = new Set<number>();
    for (const projectile of this.model.snapshot().projectiles) {
      active.add(projectile.id);
      let visual = this.projectileVisuals.get(projectile.id);
      if (!visual) {
        visual = new EncounterProjectileVisual(this.g.renderer.scene);
        this.projectileVisuals.set(projectile.id, visual);
      }
      visual.update(projectile, dt);
    }
    for (const [id, visual] of this.projectileVisuals) {
      if (active.has(id)) continue;
      visual.dispose();
      this.projectileVisuals.delete(id);
    }
  }

  /** Read-only input routing, including invulnerable jaws and in-flight seeds. */
  canStrike(origin: THREE.Vector3, direction: THREE.Vector3, strike: EncounterStrike): boolean {
    return this.model.canStrike(point(origin), point(direction), strike);
  }

  tryHit(origin: THREE.Vector3, direction: THREE.Vector3, strike: EncounterStrike,
    attackerId = 'solo'): EncounterHit | null {
    if (!this.authoritative) {
      this.net?.requestEncounter({ kind: 'hit', origin: point(origin), direction: point(direction),
        strike, actorId: attackerId });
      return null;
    }
    // A peer may send a strike intent, but its origin must be near that peer.
    const actor = this.currentTargets.find(t => t.id === attackerId);
    if (!actor || Math.hypot(origin.x - actor.position[0], origin.y - actor.position[1],
      origin.z - actor.position[2]) > 4.5) return null;
    const result = this.model.tryHit(point(origin), point(direction), strike, attackerId);
    if (result?.releasedVictimId !== undefined) this.release(result.releasedVictimId, 'defeat');
    if (result?.defeated) {
      const state = this.model.get(result.kind);
      const position = new THREE.Vector3(...state.position);
      this.onDefeated?.(result.kind, position.clone(), attackerId);
      this.emit('encounter:defeated', { kind: result.kind, position, actorId: attackerId });
    }
    return result;
  }

  offerBait(position: THREE.Vector3, actorId = 'solo'): boolean {
    if (!this.authoritative) {
      this.net?.requestEncounter({ kind: 'bait', position: point(position), actorId });
      return false;
    }
    return this.model.offerBait(point(position));
  }

  /** E during the short jaw hold; the host decides whether the escape window is open. */
  tryEscape(victimId = 'solo'): boolean {
    if (!this.authoritative) {
      this.net?.requestEncounter({ kind: 'escape', victimId });
      return false;
    }
    const escaped = this.model.tryEscape(victimId);
    if (escaped) this.release(victimId, 'escape');
    return escaped;
  }

  /** A teammate close to Snapjaw can release the held player. */
  tryRescue(victimId: string, rescuerId: string): boolean {
    if (!this.authoritative) {
      this.net?.requestEncounter({ kind: 'rescue', victimId, rescuerId });
      return false;
    }
    const rescued = this.model.tryRescue(victimId, rescuerId);
    if (rescued) this.release(victimId, 'rescue');
    return rescued;
  }

  isCaptured(victimId: string): boolean { return this.model.isCaptured(victimId); }

  snapshot(): EncounterNetState { return this.model.snapshot(); }

  applySnapshot(state: EncounterNetState): boolean {
    if (this.authoritative) return false;
    return this.model.applySnapshot(state);
  }

  dispose(): void {
    for (const visual of this.visuals.values()) visual.dispose();
    this.visuals.clear();
    for (const visual of this.projectileVisuals.values()) visual.dispose();
    this.projectileVisuals.clear();
  }

  private resetModel(): void {
    // Compact second route: orchard ambush, jaws on the hill approach, then
    // ranged pressure on the climb toward the King Melon.
    const mimic = this.world.groundAt(-37, 18, 0);
    const snapjaw = this.world.groundAt(-28, 11, 0);
    const spitter = this.world.groundAt(-31, -8, 0);
    const nextRevision = this.model ? this.model.snapshot().revision + 1 : 0;
    this.model = new EncounterModel([
      { kind: 'mimic', position: point(mimic) },
      { kind: 'snapjaw', position: point(snapjaw) },
      { kind: 'spitter', position: point(spitter) },
    ], (x, z) => this.world.terrain.height(x, z), nextRevision);
  }

  private info(): Record<string, unknown> {
    const snap = this.model.snapshot();
    return {
      authoritative: this.authoritative,
      revision: snap.revision,
      projectiles: snap.projectiles.map(p => ({ id: p.id,
        pos: p.position.map(n => +n.toFixed(3)), timeLeft: +p.timeLeft.toFixed(3) })),
      threats: Object.fromEntries(snap.encounters.map(s => [s.kind, {
        phase: s.phase, health: s.health, timeLeft: +s.timeLeft.toFixed(3),
        pos: s.position.map(n => +n.toFixed(3)), heading: +s.heading.toFixed(3),
        baited: s.baited, capturedVictimId: s.capturedVictimId,
        captureTimeLeft: +s.captureTimeLeft.toFixed(3),
      }])),
    };
  }

  private emit(name: string, payload: unknown): void {
    (this.g.bus.emit as (event: string, value: unknown) => void)(name, payload);
  }

  private release(victimId: string, reason: 'escape' | 'rescue' | 'timeout' | 'defeat'): void {
    this.onReleased?.(victimId, reason);
    this.emit('encounter:release', { kind: 'snapjaw', victimId, reason });
  }
}
