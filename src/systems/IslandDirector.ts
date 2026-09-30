import * as THREE from 'three';
import type { Game, System } from '@/core/Game';
import { Rng } from '@/core/Rng';
import type { FruitSystem } from '@/fruit/FruitSystem';
import type { Sunpatch } from '@/world/Sunpatch';
import type { Economy } from './Economy';
import type { RopeSystem } from './RopeSystem';

export type IslandEventKind = 'windfall' | 'coconuts' | 'order';
export type IslandEventPhase = 'idle' | 'warning' | 'active' | 'result';
export type HarvestAgitationKind = 'site-disturbance' | 'rare-fruit' | 'tree-shaker'
  | 'air-cannon' | 'vine-release';
export interface HarvestAgitationState {
  pressure: number; warning: boolean; at: [number, number, number]; acceptedIds: string[];
}
export interface IslandEventState {
  id: number; kind: IslandEventKind | null; phase: IslandEventPhase;
  remaining: number; targets: number[]; plants: number[]; released: number;
  at: [number, number, number]; progress: number; goal: number; reward: number;
  species: string[]; counted: number[]; paid: boolean; result: string;
}
export interface IslandDirectorState {
  event: IslandEventState; sequence: number; cooldown: number; last: IslandEventKind | null;
  firstPick: boolean; firstSale: boolean; introDone: boolean; introDelay: number; orders: number;
  agitation: HarvestAgitationState;
}
export interface IslandCrew { position: THREE.Vector3; busy: boolean; hasNet: boolean; }

const blank = (): IslandEventState => ({ id: 0, kind: null, phase: 'idle', remaining: 0,
  targets: [], plants: [], released: 0, at: [0, 0, 0], progress: 0, goal: 0,
  reward: 0, species: [], counted: [], paid: false, result: '' });
const calm = (): HarvestAgitationState => ({ pressure: 0, warning: false,
  at: [0, 0, 0], acceptedIds: [] });
const AGITATION_WARNING = 3;
const AGITATION_BURST = 6;
const AGITATION_MAX = 9;
const AGITATION_DECAY = 0.08;
const AGITATION_WEIGHTS: Record<HarvestAgitationKind, number> = {
  'site-disturbance': 3, 'rare-fruit': 2, 'tree-shaker': 3,
  'air-cannon': 2, 'vine-release': 2,
};

/** The host schedules trouble; ordinary fruit physics determines what happens. */
export class IslandDirector implements System {
  readonly name = 'director';
  private g!: Game;
  private fruit!: FruitSystem;
  private world!: Sunpatch;
  private state: IslandDirectorState = { event: blank(), sequence: 0, cooldown: 0, last: null,
    firstPick: false, firstSale: false, introDone: false, introDelay: 12, orders: 0,
    agitation: calm() };
  automatic = true;
  private cue = '';
  private tickCue = -1;
  private rustleTimer = 0;
  private returning = false;

  init(g: Game): void {
    this.g = g; this.fruit = g.get('fruit'); this.world = g.get('world');
    g.bus.on('fruit:detached', p => {
      if (this.authoritative && p.cause === 'hand') this.state.firstPick = true;
      if (!this.authoritative || !['hand', 'remote', 'shake', 'shove'].includes(p.cause)) return;
      const fruit = this.fruit.get(p.fruitId);
      if (fruit?.species === 'vinebomb') {
        this.acceptAgitation(`vine-release:${p.fruitId}`, 'vine-release', fruit.position);
      } else if (fruit && (fruit.variant || ['puffmelon', 'watermelon'].includes(fruit.species))) {
        this.acceptAgitation(`rare-fruit:${p.fruitId}`, 'rare-fruit', fruit.position);
      }
    });
    g.bus.on('fruit:grabbed', p => {
      if (!this.authoritative) return;
      this.state.firstPick = true;
      this.noteGather(p.fruitId);
    });
    g.bus.on('fruit:stowed', p => { if (this.authoritative) this.noteGather(p.fruitId); });
    g.bus.on('fruit:claimed', p => {
      if (!this.authoritative) return;
      this.state.firstPick = true;
      this.noteGather(p.fruitId);
    });
    g.bus.on('fruit:sold', p => {
      // Clients also emit this event for their book. They must never advance
      // the order or mint money: the authoritative Economy sold the batch.
      if (!this.authoritative) return;
      this.state.firstSale = true;
      const e = this.state.event;
      if (e.kind !== 'order' || e.phase !== 'active' || e.remaining <= 0
        || !e.species.includes(p.species) || e.counted.includes(p.fruitId)) return;
      e.counted.push(p.fruitId); e.progress++;
      if (e.progress >= e.goal && !e.paid) {
        e.paid = true; // Latch before the nested money event and next snapshot.
        g.get<Economy>('economy').add(e.reward, 'rush-order');
        this.finish('success');
      }
    });
    g.debug?.addProbe('director', () => ({ ...this.netState(), authoritative: this.authoritative,
      automatic: this.automatic }));
    g.debug?.addAction('director.start', (kind: IslandEventKind) => this.start(kind, true));
    g.debug?.addAction('director.reset', (automatic = false) => {
      this.state = { event: blank(), sequence: 0, cooldown: 0, last: null, firstPick: false,
        firstSale: false, introDone: false, introDelay: 12, orders: 0, agitation: calm() };
      this.automatic = automatic; this.cue = ''; return true;
    });
    g.debug?.addAction('director.enable', (on = true) => { this.automatic = on; return on; });
  }

  get authoritative(): boolean { return this.fruit.authoritative; }
  getPresentation(): IslandEventState { return this.state.event; }
  getAgitationPresentation(): HarvestAgitationState { return this.state.agitation; }
  /** Called only after the host has accepted a valuable or violent harvest action. */
  acceptAgitation(actionId: string, kind: HarvestAgitationKind, at: THREE.Vector3): boolean {
    if (!this.authoritative || !this.automatic || this.finalBeat() || this.protectedSequence()
      || this.state.cooldown > 0 || (this.state.event.phase !== 'idle'
        && this.state.event.kind !== 'order') || !Object.hasOwn(AGITATION_WEIGHTS, kind)
      || typeof actionId !== 'string' || !actionId || actionId.length > 128
      || !at || !Number.isFinite(at.x) || !Number.isFinite(at.y) || !Number.isFinite(at.z)) return false;
    const a = this.state.agitation;
    if (a.acceptedIds.includes(actionId)) return false;
    if (kind === 'air-cannon' && ![...this.fruit.fruits.values()].some(f =>
      (f.state === 'attached' || f.state === 'free')
      && f.position.distanceToSquared(at) <= 7 * 7)) return false;
    const orchard = this.world.at('orchard').position;
    const hill = this.world.at('hillFarm').position;
    const dx = hill.x - orchard.x, dz = hill.z - orchard.z;
    const t = THREE.MathUtils.clamp(((at.x - orchard.x) * dx + (at.z - orchard.z) * dz)
      / (dx * dx + dz * dz), 0, 1);
    if (Math.hypot(at.x - orchard.x - dx * t, at.z - orchard.z - dz * t) > 34) return false;
    a.acceptedIds.push(actionId);
    if (a.acceptedIds.length > 64) a.acceptedIds.shift();
    a.pressure = Math.min(AGITATION_MAX, a.pressure + AGITATION_WEIGHTS[kind]);
    a.at = [at.x, at.y, at.z];
    a.warning = a.pressure >= AGITATION_WARNING && this.state.event.phase === 'idle';
    return true;
  }
  private chapterState(): string {
    return this.g.has('progress')
      ? this.g.get<{ chapterState: string }>('progress').chapterState : 'active';
  }
  private finalBeat(): boolean {
    const chapter = this.chapterState();
    return chapter === 'return' || (chapter === 'settled' && this.returning);
  }
  crew(): IslandCrew[] {
    if (this.g.has('net')) return this.g.get<{ activityCrew(): IslandCrew[] }>('net').activityCrew();
    return [{ position: this.g.player.position, busy: this.g.player.state !== 'active',
      hasNet: this.g.get<{ owned: Set<string> }>('tools').owned.has('net') }];
  }
  private protectedSequence(): boolean {
    const l = this.g.get<{ phase: string; tethers: unknown[] }>('legendary');
    return ['detach', 'drop', 'recover'].includes(l.phase)
      || (l.phase === 'tether' && l.tethers.length > 0);
  }
  private tied(id: number): boolean {
    for (const rope of this.g.get<RopeSystem>('ropes').ropes.values()) {
      if ((rope.a.kind === 'fruit' && rope.a.ownerId === id)
        || (rope.b.kind === 'fruit' && rope.b.ownerId === id)) return true;
    }
    return false;
  }
  private noteGather(id: number): void {
    const e = this.state.event;
    if (e.kind === 'order' || e.phase === 'idle' || e.phase === 'result'
      || !e.targets.includes(id) || e.counted.includes(id)) return;
    e.counted.push(id); e.progress++;
  }

  start(kind: IslandEventKind, force = false, focus?: THREE.Vector3): boolean {
    if (!this.authoritative || !['windfall', 'coconuts', 'order'].includes(kind)
      || this.state.event.phase !== 'idle' || this.protectedSequence() || this.finalBeat()) return false;
    const crew = this.crew().filter(c => !c.busy);
    if (!crew.length) return false;
    if (kind === 'order' && !force && !this.state.firstSale) return false;
    if (kind === 'order' && !force) {
      const orchard = this.world.at('orchard').position;
      const dock = this.world.sellPad;
      if (crew.every(c => Math.hypot(c.position.x - orchard.x, c.position.z - orchard.z) > 33
        && Math.hypot(c.position.x - dock.x, c.position.z - dock.z) > 30)) return false;
    }
    const e = blank(); e.id = this.state.sequence + 1; e.kind = kind;
    if (kind === 'order') {
      const coconuts = this.state.orders > 0 && crew.some(c => c.hasNet);
      e.phase = 'active'; e.remaining = coconuts ? 120 : 90;
      e.species = coconuts ? ['coconut'] : ['apple', 'orange'];
      e.goal = coconuts ? 4 : 6; e.reward = coconuts ? 120 : 60;
      e.at = this.world.shopCounter.toArray() as [number, number, number];
      this.state.orders++;
    } else {
      const orchard = this.world.at('orchard').position;
      const eligible = crew.filter(c => kind === 'windfall'
        ? Math.hypot(c.position.x - (focus ?? orchard).x,
          c.position.z - (focus ?? orchard).z) < 33
        : (force || c.hasNet));
      let selected: typeof e.targets = [];
      for (const c of eligible) {
        const candidates = [...this.fruit.fruits.values()].filter(f => f.state === 'attached'
          && (kind === 'windfall' ? ['apple', 'orange'].includes(f.species) : f.species === 'coconut')
          && Math.hypot(f.position.x - c.position.x, f.position.z - c.position.z) < 15
          && (!focus || Math.hypot(f.position.x - focus.x, f.position.z - focus.z) < 20)
          && !this.tied(f.id))
          .sort((a, b) => a.position.distanceToSquared(c.position) - b.position.distanceToSquared(c.position)
            || a.id - b.id);
        if (candidates.length >= 3) {
          selected = candidates.slice(0, kind === 'windfall' ? 8 : 6).map(f => f.id); break;
        }
      }
      if (!selected.length) return false;
      e.targets = selected; e.goal = selected.length;
      const centre = new THREE.Vector3();
      for (const id of selected) {
        const f = this.fruit.get(id)!; centre.add(f.position);
        if (f.attach && !e.plants.includes(f.attach.plantId)) e.plants.push(f.attach.plantId);
      }
      centre.divideScalar(selected.length);
      centre.y = this.world.terrain.height(centre.x, centre.z);
      e.at = centre.toArray() as [number, number, number];
      e.phase = 'warning'; e.remaining = 8;
      if (kind === 'windfall') this.state.introDone = true;
    }
    this.state.sequence = e.id; this.state.event = e; this.state.last = kind;
    if (kind === 'windfall') {
      this.state.agitation.pressure = 0;
      this.state.agitation.warning = false;
    } else if (kind === 'order') this.state.agitation.warning = false;
    this.present(); return true;
  }

  private finish(result: string): void {
    const e = this.state.event; e.phase = 'result'; e.remaining = 6; e.result = result;
    this.present();
  }
  fixedStep(dt: number): void {
    if (!this.authoritative) return;
    const finalBeat = this.finalBeat();
    this.returning = this.chapterState() === 'return';
    if (finalBeat) {
      this.state.agitation = calm();
      if (this.state.event.phase !== 'idle') {
        this.state.event = blank();
        this.present();
      }
      return;
    }
    const e = this.state.event;
    if (e.phase === 'idle') {
      this.state.cooldown = Math.max(0, this.state.cooldown - dt);
      // Uncontrolled solo tabs are not a hidden source of trouble; a connected
      // host still runs events for players active elsewhere in the session.
      const net = this.g.get<{ connected: boolean }>('net');
      if (!this.automatic || (!net.connected && !this.g.input.pointerLocked && !this.g.input.synthetic)) return;
      const agitation = this.state.agitation;
      if (agitation.pressure >= AGITATION_BURST && this.state.cooldown === 0) {
        if (this.protectedSequence() || !this.crew().some(c => !c.busy)) return;
        if (this.start('windfall', false, new THREE.Vector3(...agitation.at))) return;
        // The players moved away or no eligible tree remains. Drop pressure
        // rather than keep a warning for a hazard that cannot happen.
        agitation.pressure = 0;
        agitation.warning = false;
        this.state.cooldown = 5;
        return;
      }
      agitation.pressure = Math.max(0, agitation.pressure - AGITATION_DECAY * dt);
      agitation.warning = agitation.pressure >= AGITATION_WARNING && this.state.cooldown === 0;
      // Rush orders remain optional after a real sale. Ordinary fruit and idle
      // time no longer schedule a physical hazard.
      if (!this.state.firstSale || this.state.cooldown > 0 || agitation.warning) return;
      if (this.state.orders === 0 || new Rng(`${this.g.seed}:order:${this.state.sequence}`).next() > 0.5) {
        if (this.start('order')) return;
      }
      this.state.cooldown = 5;
      return;
    }
    e.remaining = Math.max(0, e.remaining - dt);
    if (e.phase === 'warning' && e.remaining === 0) {
      // Do not spring a prepared hazard on a player now shopping or recovering.
      if (this.protectedSequence() || this.crew().every(c => c.busy
        || Math.hypot(c.position.x - e.at[0], c.position.z - e.at[2]) > 28)) {
        this.finish('cancelled'); return;
      }
      e.phase = 'active'; e.remaining = 18; this.present();
    }
    if (e.phase === 'active' && e.kind !== 'order') {
      const elapsed = 18 - e.remaining;
      const count = Math.min(e.targets.length, Math.floor(elapsed / (6 / e.targets.length)) + 1);
      while (e.released < count) {
        const id = e.targets[e.released++]; // Advance before mutation; migration carries this cursor.
        const f = this.fruit.get(id);
        if (!f || f.state !== 'attached' || this.tied(id)) continue;
        this.fruit.detach(f, 'island-event', -1,
          new THREE.Vector3(e.kind === 'windfall' ? 1.6 : 0.2, 0, 0.4));
      }
    }
    if (e.remaining === 0) {
      if (e.phase === 'active') this.finish(e.kind === 'order' ? 'missed' : 'over');
      else if (e.phase === 'result') {
        const pending = e.kind === 'order' && this.state.agitation.pressure >= AGITATION_WARNING;
        this.state.event = blank();
        this.state.cooldown = pending ? 0
          : new Rng(`${this.g.seed}:quiet:${this.state.sequence}`).range(120, 180);
        this.state.agitation.warning = pending;
        this.present();
      }
    }
  }

  frameUpdate(dt: number): void {
    if (this.chapterState() === 'return') return;
    const e = this.state.event;
    const agitation = this.state.agitation;
    if (e.phase === 'idle' && agitation.warning) {
      for (const plant of this.fruit.plants.all()) {
        if (Math.hypot(plant.position.x - agitation.at[0],
          plant.position.z - agitation.at[2]) < 16) plant.shake = Math.max(plant.shake, 0.24);
      }
      this.rustleTimer -= dt;
      if (this.rustleTimer <= 0) {
        this.rustleTimer = 1.6;
        this.g.bus.emit('audio:sfx', { name: 'rustle',
          position: new THREE.Vector3(...agitation.at), volume: 0.55 });
      }
    }
    if (e.phase === 'warning' || (e.phase === 'active' && e.kind !== 'order' && e.remaining > 12)) {
      for (const id of e.plants) {
        const p = this.fruit.plants.get(id);
        if (p) p.shake = Math.max(p.shake, e.phase === 'warning' ? 0.28 : 0.65);
      }
      this.rustleTimer -= dt;
      if (this.rustleTimer <= 0) {
        this.rustleTimer = 1.6;
        this.g.bus.emit('audio:sfx', { name: 'rustle', position: new THREE.Vector3(...e.at), volume: 0.7 });
      }
    }
    const tick = Math.ceil(e.remaining);
    if (e.kind === 'order' && e.phase === 'active' && tick <= 10 && tick > 0 && tick !== this.tickCue) {
      this.tickCue = tick; this.g.bus.emit('audio:sfx', { name: 'eventTick', volume: 0.45 });
    }
  }

  private present(): void {
    const e = this.state.event, key = `${e.id}:${e.kind}:${e.phase}`;
    if (key === this.cue) return;
    this.cue = key; this.tickCue = -1;
    if (!e.kind) return;
    this.g.bus.emit('island:event', { id: e.id, kind: e.kind, phase: e.phase, result: e.result });
    const name = e.phase === 'warning' || (e.kind === 'order' && e.phase === 'active') ? 'eventWarning'
      : e.phase === 'result' ? (e.result === 'success' ? 'eventSuccess' : e.result === 'missed' ? 'eventFail' : '') : '';
    if (name) this.g.bus.emit('audio:sfx', { name, volume: 0.6 });
  }
  netState(): IslandDirectorState { return JSON.parse(JSON.stringify(this.state)) as IslandDirectorState; }
  applyNet(state: IslandDirectorState): void {
    if (!state?.event || !Number.isFinite(state.sequence)) return;
    this.state = JSON.parse(JSON.stringify(state)) as IslandDirectorState;
    this.state.agitation = this.normalizedAgitation(state.agitation);
    this.present();
  }
  private normalizedAgitation(s?: Partial<HarvestAgitationState>): HarvestAgitationState {
    const pressure = Number.isFinite(s?.pressure) ? THREE.MathUtils.clamp(s!.pressure!, 0, AGITATION_MAX) : 0;
    const at = Array.isArray(s?.at) && s.at.length === 3 && s.at.every(Number.isFinite)
      ? [...s.at] as [number, number, number] : [0, 0, 0] as [number, number, number];
    return { pressure, warning: pressure >= AGITATION_WARNING && s?.warning === true,
      at, acceptedIds: Array.isArray(s?.acceptedIds)
        ? s.acceptedIds.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 128).slice(-64)
        : [] };
  }
  serialize(): Omit<IslandDirectorState, 'event'> {
    const { event: _event, ...s } = this.state;
    return { ...s, cooldown: Math.max(30, s.cooldown),
      agitation: this.normalizedAgitation(s.agitation) };
  }
  deserialize(s: Partial<IslandDirectorState>): void {
    this.state = { event: blank(), sequence: s.sequence ?? 0, cooldown: Math.max(30, s.cooldown ?? 30),
      last: s.last ?? null, firstPick: s.firstPick ?? false, firstSale: s.firstSale ?? false,
      introDone: s.introDone ?? false, introDelay: 12, orders: s.orders ?? 0,
      agitation: this.normalizedAgitation(s.agitation) };
    this.cue = ''; this.automatic = true;
  }
}
