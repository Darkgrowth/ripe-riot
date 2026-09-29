import * as THREE from 'three';
import type { Game, System } from '@/core/Game';
import { Rng } from '@/core/Rng';
import type { FruitSystem } from '@/fruit/FruitSystem';
import type { Sunpatch } from '@/world/Sunpatch';
import type { Economy } from './Economy';
import type { RopeSystem } from './RopeSystem';

export type IslandEventKind = 'windfall' | 'coconuts' | 'order';
export type IslandEventPhase = 'idle' | 'warning' | 'active' | 'result';
export interface IslandEventState {
  id: number; kind: IslandEventKind | null; phase: IslandEventPhase;
  remaining: number; targets: number[]; plants: number[]; released: number;
  at: [number, number, number]; progress: number; goal: number; reward: number;
  species: string[]; counted: number[]; paid: boolean; result: string;
}
export interface IslandDirectorState {
  event: IslandEventState; sequence: number; cooldown: number; last: IslandEventKind | null;
  firstPick: boolean; firstSale: boolean; introDone: boolean; introDelay: number; orders: number;
}
export interface IslandCrew { position: THREE.Vector3; busy: boolean; hasNet: boolean; }

const blank = (): IslandEventState => ({ id: 0, kind: null, phase: 'idle', remaining: 0,
  targets: [], plants: [], released: 0, at: [0, 0, 0], progress: 0, goal: 0,
  reward: 0, species: [], counted: [], paid: false, result: '' });

/** The host schedules trouble; ordinary fruit physics determines what happens. */
export class IslandDirector implements System {
  readonly name = 'director';
  private g!: Game;
  private fruit!: FruitSystem;
  private world!: Sunpatch;
  private state: IslandDirectorState = { event: blank(), sequence: 0, cooldown: 0, last: null,
    firstPick: false, firstSale: false, introDone: false, introDelay: 12, orders: 0 };
  automatic = true;
  private cue = '';
  private tickCue = -1;
  private rustleTimer = 0;

  init(g: Game): void {
    this.g = g; this.fruit = g.get('fruit'); this.world = g.get('world');
    g.bus.on('fruit:detached', p => {
      if (this.authoritative && p.cause === 'hand') this.state.firstPick = true;
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
        firstSale: false, introDone: false, introDelay: 12, orders: 0 };
      this.automatic = automatic; this.cue = ''; return true;
    });
    g.debug?.addAction('director.enable', (on = true) => { this.automatic = on; return on; });
  }

  get authoritative(): boolean { return this.fruit.authoritative; }
  getPresentation(): IslandEventState { return this.state.event; }
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

  start(kind: IslandEventKind, force = false): boolean {
    if (!this.authoritative || !['windfall', 'coconuts', 'order'].includes(kind)
      || this.state.event.phase !== 'idle' || this.protectedSequence()) return false;
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
        ? Math.hypot(c.position.x - orchard.x, c.position.z - orchard.z) < 33
        : (force || c.hasNet));
      let selected: typeof e.targets = [];
      for (const c of eligible) {
        const candidates = [...this.fruit.fruits.values()].filter(f => f.state === 'attached'
          && (kind === 'windfall' ? ['apple', 'orange'].includes(f.species) : f.species === 'coconut')
          && Math.hypot(f.position.x - c.position.x, f.position.z - c.position.z) < 15
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
    this.present(); return true;
  }

  private finish(result: string): void {
    const e = this.state.event; e.phase = 'result'; e.remaining = 6; e.result = result;
    this.present();
  }
  fixedStep(dt: number): void {
    if (!this.authoritative) return;
    const e = this.state.event;
    if (e.phase === 'idle') {
      this.state.cooldown = Math.max(0, this.state.cooldown - dt);
      // Uncontrolled solo tabs are not a hidden source of trouble; a connected
      // host still runs events for players active elsewhere in the session.
      const net = this.g.get<{ connected: boolean }>('net');
      if (!this.automatic || (!net.connected && !this.g.input.pointerLocked && !this.g.input.synthetic)) return;
      if (this.state.firstPick && !this.state.introDone) {
        this.state.introDelay = Math.max(0, this.state.introDelay - dt);
        if (this.state.introDelay === 0 && this.state.cooldown === 0) this.start('windfall');
        return;
      }
      if (!this.state.introDone || this.state.cooldown > 0) return;
      const rng = new Rng(`${this.g.seed}:event:${this.state.sequence}`);
      const options: IslandEventKind[] = this.state.orders === 0 && this.state.firstSale
        ? ['order', 'coconuts', 'windfall'] : rng.next() > 0.5
          ? ['coconuts', 'order', 'windfall'] : ['windfall', 'order', 'coconuts'];
      for (const k of options) if (k !== this.state.last && this.start(k)) return;
      this.state.cooldown = 5; // No eligible fruit/player: retry without busy scanning.
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
        this.state.event = blank();
        this.state.cooldown = new Rng(`${this.g.seed}:quiet:${this.state.sequence}`).range(120, 180);
        this.present();
      }
    }
  }

  frameUpdate(dt: number): void {
    const e = this.state.event;
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
    this.present();
  }
  serialize(): Omit<IslandDirectorState, 'event'> {
    const { event: _event, ...s } = this.state;
    return { ...s, cooldown: Math.max(30, s.cooldown) };
  }
  deserialize(s: Partial<IslandDirectorState>): void {
    this.state = { event: blank(), sequence: s.sequence ?? 0, cooldown: Math.max(30, s.cooldown ?? 30),
      last: s.last ?? null, firstPick: s.firstPick ?? false, firstSale: s.firstSale ?? false,
      introDone: s.introDone ?? false, introDelay: 12, orders: s.orders ?? 0 };
    this.cue = ''; this.automatic = true;
  }
}
