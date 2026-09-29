import * as THREE from 'three';
import type { Game, System } from '@/core/Game';
import type { Sunpatch } from '@/world/Sunpatch';
import { EncounterModel, type EncounterHit, type EncounterKind,
  type EncounterMeleeResult, type EncounterNetState, type EncounterStrike, type EncounterTarget,
  type Point3 } from './EncounterModel';
import { EncounterProjectileVisual, EncounterVisual } from './EncounterVisuals';
import { Layer, QueryMask, groups } from '@/physics/Layers';
import type { FruitSystem } from '@/fruit/FruitSystem';
import { ThrownFruitBait } from './ThrownFruitBait';
import { HarvestSites, type HarvestSiteState } from './HarvestSites';

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
const MIMIC_OBSTACLES = groups(0xffff, Layer.PROP | Layer.PLANT | Layer.VEHICLE);

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
  private suspendedForHarness = false;
  private readonly baitFlights = new ThrownFruitBait();
  private baitCount = 0;
  private baitFocus: number | null = null;
  private sites!: HarvestSites;

  constructor(private readonly comparisonStyle: 'polygon' | 'block' | null = null,
    private readonly detailedVoxelClearing = false) {}

  init(g: Game): void {
    this.g = g;
    this.world = g.get<Sunpatch>('world');
    this.resetModel();
    const fruit = g.get<FruitSystem>('fruit');
    this.sites = new HarvestSites(this.comparisonStyle ? [] : fruit.harvestSites);
    fruit.beforeHarvest = (plantId, cause) => this.guardHarvest(plantId, cause);
    g.bus.on('fruit:detached', e => { if (this.authoritative) this.sites.release(e.fruitId); });
    g.bus.on('fruit:sold', e => { if (this.authoritative) this.sites.consume(e.fruitId); });
    g.bus.on('fruit:destroyed', e => { if (this.authoritative) this.sites.consume(e.fruitId); });
    for (const state of this.model.snapshot().encounters) {
      this.visuals.set(state.kind, new EncounterVisual(state.kind, g.renderer.scene,
        this.comparisonStyle ?? (this.detailedVoxelClearing ? 'voxel' : 'polygon')));
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
      if (this.comparisonStyle) return false;
      const target = this.model.get('snapjaw');
      return this.offerBait(new THREE.Vector3(target.position[0] + 3, target.position[1],
        target.position[2]));
    });
    g.debug?.addAction('encounters.reset', () => {
      if (!this.authoritative) return false;
      this.resetModel();
      return this.info();
    });
    // Numerical tests of unrelated systems can keep their original orchard
    // fixtures without a roaming enemy altering physics or player health.
    g.debug?.addAction('encounters.suspend', (on: boolean) => {
      this.suspendedForHarness = !!on;
      return this.suspendedForHarness;
    });
  }

  get authoritative(): boolean { return this.net?.authoritative ?? true; }

  /** The host supplies local and remote peers each frame. Solo defaults to the local player. */
  setTargets(targets: EncounterTarget[] | null): void {
    this.explicitTargets = targets?.map(t => ({ id: t.id, position: [...t.position], protected: !!t.protected })) ?? null;
  }

  fixedStep(dt: number): void {
    if (!this.authoritative) { this.clearBaitFlights(); return; }
    if (this.comparisonStyle && !this.g.input.pointerLocked) return;
    const grace = this.g.has('vitals')
      ? this.g.get<{ recoveryGraceRemaining: number }>('vitals').recoveryGraceRemaining : 0;
    const targets = this.explicitTargets ?? (this.g.player.state === 'active'
      ? [{ id: 'solo', position: point(this.g.player.position), protected: grace > 0 }] : []);
    this.currentTargets = targets;
    this.model.setTargets(targets);
    if (this.suspendedForHarness) return;
    this.stepBait(dt);
    for (const event of this.model.step(dt)) {
      if (event.type === 'damage') {
        this.onPlayerDamaged?.(event.amount, event.kind, event.victimId);
        this.emit('encounter:attack', {
          kind: event.kind, victimId: event.victimId, damage: event.amount,
        });
      } else if (event.type === 'capture') {
        this.onCaptured?.(event.victimId);
        this.emit('encounter:capture', { kind: 'snapjaw', victimId: event.victimId });
      } else if (event.type === 'reflected-hit') {
        this.publishHit(event.hit, event.hit.attackerId ?? 'solo');
      } else {
        this.release(event.victimId, 'timeout');
      }
    }
  }

  /** Called only after a new, accepted carried-to-free throw on the host. */
  trackThrownFruit(fruitId: number, actorId: string): void {
    if (!this.authoritative || this.comparisonStyle) return;
    const fruit = this.g.get<FruitSystem>('fruit').get(fruitId);
    if (!fruit || fruit.state !== 'free' || !fruit.body || fruit.speed < 2.2) return;
    this.baitFlights.arm(fruitId, actorId, point(fruit.position));
  }

  clearBaitFlights(): void { this.baitFlights.clear(); this.baitFocus = null; }
  cancelThrownFruit(fruitId: number): void {
    this.baitFlights.disarm(fruitId);
    if (this.baitFocus === fruitId) this.baitFocus = null;
  }

  private stepBait(dt: number): void {
    if (this.comparisonStyle) return;
    const fruits = this.g.get<FruitSystem>('fruit');
    const jaw = this.model.get('snapjaw');
    if (this.baitFocus !== null) {
      const f = fruits.get(this.baitFocus);
      if (!f || f.state !== 'free' || jaw.phase !== 'warn'
        || this.baitOccluded(point(f.position), [jaw.position[0], jaw.position[1] + 1.25, jaw.position[2]])
        || !this.model.followBait(point(f.position))) this.baitFocus = null;
    }
    if (this.baitFlights.size === 0) return;
    this.baitFlights.step(dt, id => {
      const f = fruits.get(id);
      return f ? { state: f.state, speed: f.speed, position: point(f.position) } : null;
    }, jaw.position, (from, to) => this.baitOccluded(from, to), (flight, position) => {
      if (!this.model.offerBait(position)) return false;
      this.baitFocus = flight.fruitId;
      this.baitCount++;
      this.g.bus.emit('encounter:baited', { kind: 'snapjaw', fruitId: flight.fruitId,
        actorId: flight.actorId, position: new THREE.Vector3(...position) });
      return true;
    });
  }

  private baitOccluded(from: Point3, to: Point3): boolean {
    const origin = new THREE.Vector3(...from);
    const direction = new THREE.Vector3(...to).sub(origin);
    const distance = direction.length();
    if (distance < .1) return false;
    const hit = this.g.physics.raycast(origin, direction.divideScalar(distance),
      distance, QueryMask.solid, this.g.player.body);
    return !!hit && hit.distance < distance - .08;
  }

  frameUpdate(dt: number): void {
    for (const site of this.sites.snapshot()) if (site.phase === 'warning') {
      const plant = this.g.get<FruitSystem>('fruit').plants.get(site.plantId);
      if (plant) plant.shake = Math.max(plant.shake, .25);
    }
    const snapshot = this.model.snapshot();
    const heldJaw = this.g.player.state === 'captured'
      ? snapshot.encounters.find(state => state.kind === 'snapjaw'
        && state.capturedVictimId !== null) : null;
    this.g.playerCamera.setCaptureThreat(heldJaw
      ? new THREE.Vector3(heldJaw.position[0], heldJaw.position[1], heldJaw.position[2])
      : null, heldJaw?.heading ?? 0);
    for (const state of snapshot.encounters) {
      this.visuals.get(state.kind)?.update(state,
        this.world.terrain.height(state.position[0], state.position[2]), dt);
    }
    const active = new Set<number>();
    for (const projectile of snapshot.projectiles) {
      active.add(projectile.id);
      let visual = this.projectileVisuals.get(projectile.id);
      if (!visual) {
        visual = new EncounterProjectileVisual(this.g.renderer.scene,
          this.comparisonStyle ?? (this.detailedVoxelClearing ? 'voxel' : 'polygon'));
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

  resolveMelee(origin: THREE.Vector3, direction: THREE.Vector3,
    attackerId = 'solo'): EncounterMeleeResult {
    if (!this.authoritative) return { outcome: 'whoosh' };
    const actor = this.currentTargets.find(target => target.id === attackerId);
    if (!actor || origin.distanceTo(new THREE.Vector3(...actor.position)) > 2.8)
      return { outcome: 'whoosh' };
    const result = this.model.resolveMelee(point(origin), point(direction), attackerId, contact => {
      if (contact.distance < 0.12) return false;
      const ray = new THREE.Vector3(...contact.direction);
      const obstruction = this.g.physics.raycast(origin, ray, contact.distance,
        QueryMask.solid, this.g.player.body);
      return !!obstruction && obstruction.distance < contact.distance - 0.08;
    });
    if (result.hit) this.publishHit(result.hit, attackerId);
    return result;
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
    if (result) this.publishHit(result, attackerId);
    return result;
  }

  private publishHit(result: EncounterHit, attackerId: string): void {
    if (result?.releasedVictimId !== undefined) this.release(result.releasedVictimId, 'defeat');
    if (result?.defeated) {
      this.sites.clear(result.kind);
      const site = this.sites.snapshot().find(s => s.kind === result.kind);
      if (site) this.presentSite(site);
      const state = this.model.get(result.kind);
      const position = new THREE.Vector3(...state.position);
      this.onDefeated?.(result.kind, position.clone(), attackerId);
      this.emit('encounter:defeated', { kind: result.kind, position, actorId: attackerId });
    }
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

  hasAuthoredPrize(kind: EncounterKind): boolean {
    return this.sites.snapshot().some(s => s.kind === kind);
  }

  harvestPrompt(fruitId: number): string | null {
    const site = this.sites.atFruit(fruitId);
    if (!site || site.kind !== 'mimic') return null;
    return site.phase === 'quiet' ? 'Inspect the overloaded crop'
      : site.phase === 'warning' ? 'Harvest it anyway — something is stirring' : null;
  }

  private guardHarvest(plantId: number, cause: string): boolean {
    if (!this.authoritative) return false;
    const site = this.sites.atPlant(plantId);
    if (!site) return true;
    // Windfalls and other passive events cannot make the player's first choice.
    if (cause === 'island-event' && (site.phase === 'quiet' || site.phase === 'warning')) return false;
    const action = this.sites.disturb(plantId, this.g.clock.elapsed);
    if (action.activate) this.model.activate('mimic');
    if (action.changed) this.presentSite(site);
    return action.allow;
  }

  private presentSite(site: HarvestSiteState): void {
    if (site.phase === 'quiet') return;
    const position = new THREE.Vector3(...site.position);
    this.g.bus.emit('harvest:site', { siteId: site.id, phase: site.phase, position });
    if (site.phase === 'warning') {
      this.g.get<FruitSystem>('fruit').plants.shakePlant(site.plantId, 1.2);
      this.g.bus.emit('audio:sfx', { name: 'rustle', position, volume: .9 });
      this.g.bus.emit('ui:toast', { text: 'Something moved beneath the harvest',
        sub: 'Step back, or press E again to risk the loaded crop.', ms: 3400 });
    } else if (site.phase === 'active' && site.kind === 'mimic') {
      this.g.bus.emit('audio:sfx', { name: 'thud', position, volume: .8, pitch: .65 });
      this.g.bus.emit('ui:toast', { text: 'The harvest woke a Mimic!',
        sub: 'Drop your prize, dodge the rush, then strike its recovery.', ms: 3200 });
    }
  }

  siteState(): HarvestSiteState[] {
    if (this.authoritative) for (const site of this.sites.snapshot()) for (const id of site.fruitIds) {
      const fruit = this.g.get<FruitSystem>('fruit').get(id);
      if (!fruit || fruit.state === 'gone') this.sites.consume(id);
      else if (fruit.state !== 'attached') this.sites.release(id);
    }
    return this.sites.snapshot();
  }

  applySiteState(raw: unknown): void {
    if (this.authoritative) return;
    const before = new Map(this.sites.snapshot().map(s => [s.id, s.phase]));
    this.sites.apply(raw);
    for (const site of this.sites.snapshot()) if (before.get(site.id) !== site.phase) this.presentSite(site);
  }

  restoreCleared(kinds: Iterable<EncounterKind>): void {
    const valid = [...kinds].filter(k => ['mimic', 'snapjaw', 'spitter'].includes(k));
    this.model.restoreCleared(valid);
    for (const kind of valid) this.sites.clear(kind);
    this.clearBaitFlights();
  }

  serialize(): unknown {
    const sites = this.siteState();
    const fruit = this.g.get<FruitSystem>('fruit');
    return { sites, cleared: this.model.snapshot().encounters.filter(s => s.phase === 'defeated').map(s => s.kind),
      prizes: sites.flatMap(s => s.released.filter(id => !s.consumed.includes(id)).flatMap(id => {
        const f = fruit.get(id);
        return f ? [{ id, position: point(f.position), damage: f.damage }] : [];
      })) };
  }

  deserialize(raw: unknown): void {
    if (!this.authoritative) return;
    const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    this.sites = new HarvestSites(this.comparisonStyle ? [] : this.g.get<FruitSystem>('fruit').harvestSites);
    this.sites.apply(data.sites);
    this.resetModel();
    for (const s of this.sites.snapshot()) {
      if (s.kind === 'mimic' && ['active', 'cleared'].includes(s.phase)) this.model.activate('mimic');
      if (s.phase === 'cleared') this.model.restoreCleared([s.kind]);
      for (const id of s.consumed) this.g.get<FruitSystem>('fruit').restoreHarvestPrize(id, null);
      for (const id of s.released) if (!s.consumed.includes(id)) {
        const saved = Array.isArray(data.prizes) ? data.prizes.find(p => p?.id === id) : null;
        const position = Array.isArray(saved?.position) && saved.position.length === 3
          && saved.position.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))
          && Math.abs(saved.position[0]) < 250 && Math.abs(saved.position[2]) < 250
          && saved.position[1] > -10 && saved.position[1] < 100
          ? saved.position as Point3 : [s.position[0], s.position[1] + 1, s.position[2]] as Point3;
        this.g.get<FruitSystem>('fruit').restoreHarvestPrize(id,
          { position, damage: Number.isFinite(saved?.damage) ? Math.max(0, Math.min(.99, saved.damage)) : 0 });
      }
    }
    if (Array.isArray(data.cleared)) this.restoreCleared(data.cleared);
  }

  private projectileBlock(from: Point3, to: Point3): number | null {
    const origin = new THREE.Vector3(...from), direction = new THREE.Vector3(...to).sub(origin);
    const length = direction.length();
    if (length < 1e-6) return null;
    const hit = this.g.physics.raycast(origin, direction.divideScalar(length), length, QueryMask.solid);
    return hit ? Math.max(0, Math.min(1, hit.distance / length)) : null;
  }

  private resetModel(): void {
    this.clearBaitFlights();
    // Compact second route: orchard ambush, jaws on the hill approach, then
    // ranged pressure on the climb toward the King Melon.
    const mimic = this.world.groundAt(-23, 22, 0);
    const snapjaw = this.world.groundAt(-28, 11, 0);
    const spitter = this.world.groundAt(-31, -8, 0);
    const nextRevision = this.model ? this.model.snapshot().revision + 1 : 0;
    this.model = new EncounterModel(this.comparisonStyle
      ? [{ kind: 'mimic', position: point(mimic) }]
      : [
        { kind: 'mimic', position: point(mimic), dormant: true, leashRadius: 13 },
        { kind: 'snapjaw', position: point(snapjaw) },
        { kind: 'spitter', position: point(spitter) },
      ], (x, z) => this.world.terrain.height(x, z), nextRevision,
      (from, to, radius) => this.mimicBlocked(from, to, radius),
      (from, to) => this.projectileBlock(from, to));
  }

  /** Sweep the root mass at rail and trunk height, excluding terrain and players. */
  private mimicBlocked(from: Point3, to: Point3, radius: number): boolean {
    const dx = to[0] - from[0], dz = to[2] - from[2];
    const length = Math.hypot(dx, dz);
    if (length < 1e-5) return false;
    const ux = dx / length, uz = dz / length;
    const dir = new THREE.Vector3(ux, 0, uz);
    // Orchard fences have two slender rails with an open gap at mid-height.
    // Sampling only the centre let the whole creature pass through both.
    for (const height of [0.58, 1.02]) for (const side of [-0.72, 0, 0.72]) {
      const origin = new THREE.Vector3(from[0] - uz * radius * side,
        from[1] + height, from[2] + ux * radius * side);
      const hit = this.g.physics.raycast(origin, dir, length + radius,
        MIMIC_OBSTACLES);
      if (hit && hit.distance <= length + radius) return true;
    }
    return false;
  }

  private info(): Record<string, unknown> {
    const snap = this.model.snapshot();
    return {
      authoritative: this.authoritative,
      sites: this.siteState(),
      bait: { pending: this.baitFlights.size, accepted: this.baitCount },
      revision: snap.revision,
      projectiles: snap.projectiles.map(p => ({ id: p.id,
        pos: p.position.map(n => +n.toFixed(3)), timeLeft: +p.timeLeft.toFixed(3) })),
      threats: Object.fromEntries(snap.encounters.map(s => [s.kind, {
        phase: s.phase, health: s.health, timeLeft: +s.timeLeft.toFixed(3),
        pos: s.position.map(n => +n.toFixed(3)), heading: +s.heading.toFixed(3),
        dormant: !!s.dormant, returning: !!s.returning,
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
