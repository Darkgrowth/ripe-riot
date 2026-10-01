import type { Game, System } from '@/core/Game';
import type { FruitSystem } from '@/fruit/FruitSystem';
import type { InteractionSystem } from '@/interaction/InteractionSystem';
import type { MultiplayerAuthority } from '@/net/MultiplayerAuthority';
import type { Sunpatch } from '@/world/Sunpatch';
import { FRUIT } from '@/fruit/FruitDefs';

export interface ExtractionState {
  version: 1;
  revision: number;
  banked: number;
  secured: Array<[number, number]>;
  soldIds: number[];
  cargo: Record<string, number>;
  lost: number[];
  elapsed: number;
  finished: boolean;
}

const validId = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;

function validatedState(raw: unknown): ExtractionState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<ExtractionState>;
  if (s.version !== 1 || !validId(s.revision) || !Number.isSafeInteger(s.banked)
    || Number(s.banked) < 0 || !Number.isFinite(s.elapsed) || Number(s.elapsed) < 0
    || typeof s.finished !== 'boolean' || !Array.isArray(s.secured) || !Array.isArray(s.lost)
    || s.secured.length + s.lost.length > 10000) return null;
  const ids = new Set<number>(); let banked = 0;
  for (const item of s.secured) {
    if (!Array.isArray(item) || item.length !== 2 || !validId(item[0])
      || !Number.isSafeInteger(item[1]) || item[1] <= 0 || ids.has(item[0])) return null;
    ids.add(item[0]); banked += item[1];
  }
  for (const id of s.lost) { if (!validId(id) || ids.has(id)) return null; ids.add(id); }
  if (!Number.isSafeInteger(banked) || banked !== s.banked) return null;
  if (!s.cargo || typeof s.cargo !== 'object' || Array.isArray(s.cargo)) return null;
  let count = 0;
  for (const [species, amount] of Object.entries(s.cargo)) {
    if (!Object.hasOwn(FRUIT, species) || !Number.isSafeInteger(amount) || amount < 0) return null;
    count += amount;
  }
  if (count !== s.secured.length) return null;
  return { version: 1, revision: s.revision, banked,
    soldIds: [...s.secured.map(([id]) => id)], cargo: { ...s.cargo },
    secured: s.secured.map(([id, value]) => [id, value]), lost: [...s.lost],
    elapsed: Number(s.elapsed), finished: s.finished };
}

export class HarvestExtraction implements System {
  readonly name = 'extraction';
  readonly target = 500;
  banked = 0;
  elapsed = 0;
  finished = false;
  private g!: Game;
  private secured = new Map<number, number>();
  private lost = new Set<number>();
  private cargo: Record<string, number> = {};
  private revision = 0;
  private netSource = '';

  get fruitCount(): number { return this.secured.size; }
  get targetReached(): boolean { return this.banked >= this.target; }
  get consumedIds(): number[] { return [...this.secured.keys(), ...this.lost]; }
  get objective(): string {
    if (this.finished) return `$${this.banked.toLocaleString('en-US')} secured · run complete`;
    return this.targetReached ? `$${this.banked.toLocaleString('en-US')} secured · keep harvesting or finish at the crate`
      : `Secure $500 at the crate · $${this.banked.toLocaleString('en-US')} banked`;
  }
  private get authoritative(): boolean {
    return !this.g.has('net') || this.g.get<MultiplayerAuthority>('net').authoritative;
  }

  init(g: Game): void {
    this.g = g;
    g.bus.on('fruit:sold', p => {
      if (!this.authoritative || this.finished || !validId(p.fruitId)
        || !Number.isSafeInteger(p.value) || p.value <= 0
        || this.secured.has(p.fruitId) || this.lost.has(p.fruitId)) return;
      const reached = this.targetReached;
      this.secured.set(p.fruitId, p.value); this.banked += p.value; this.revision++;
      const species = Object.hasOwn(FRUIT, p.species) ? p.species : 'apple';
      this.cargo[species] = (this.cargo[species] ?? 0) + 1;
      if (!reached && this.targetReached) g.bus.emit('ui:toast', {
        text: '$500 secured', sub: 'Keep harvesting, or return to the crate and finish your run.', kind: 'gold', ms: 5000,
      });
    });
    g.bus.on('fruit:destroyed', p => {
      if (!this.authoritative || this.finished || !validId(p.fruitId)
        || this.secured.has(p.fruitId) || this.lost.has(p.fruitId)) return;
      this.lost.add(p.fruitId); this.revision++;
    });
    g.debug?.addProbe('extraction', () => ({ ...this.netState(), target: this.target,
      targetReached: this.targetReached, fruitCount: this.fruitCount, objective: this.objective }));
    g.debug?.addAction('extraction.finish', () => this.finish());
  }

  atCrate(at: { x: number; y: number; z: number } = this.g.player.position): boolean {
    const world = this.g.get<Sunpatch>('world');
    return Number.isFinite(at.x + at.y + at.z)
      && Math.hypot(at.x - world.sellPad.x, at.z - world.sellPad.z) < world.sellRadius + 1.2
      && Math.abs(at.y - world.sellPad.y) < 4;
  }

  finish(): boolean {
    if (this.finished || this.g.player.state !== 'active') return false;
    const hands = this.g.get<InteractionSystem>('interaction');
    if (!this.atCrate() || hands.carried || hands.basket.items.length) {
      this.g.bus.emit('ui:toast', { text: 'Finish at the extraction crate',
        sub: 'Bank the fruit in your hands and basket first.', ms: 2800 });
      return false;
    }
    if (!this.authoritative) {
      this.g.get<MultiplayerAuthority>('net').requestExtractionFinish(); return false;
    }
    return this.confirmFinish(this.g.player.position);
  }

  /** Host calls this only after checking the caller's state and empty cargo ledger. */
  confirmFinish(at: { x: number; y: number; z: number }): boolean {
    if (!this.authoritative || this.finished || !this.atCrate(at)) return false;
    this.finished = true; this.revision++;
    if (this.g.has('save')) this.g.get<{ save(): boolean }>('save').save();
    return true;
  }

  frameUpdate(dt: number): void {
    if (this.authoritative && !this.finished && !this.g.clock.paused && Number.isFinite(dt) && dt > 0)
      this.elapsed += dt;
  }
  netState(): ExtractionState {
    return { version: 1, revision: this.revision, banked: this.banked,
      soldIds: [...this.secured.keys()], cargo: { ...this.cargo },
      secured: [...this.secured], lost: [...this.lost], elapsed: this.elapsed, finished: this.finished };
  }
  /** A reconnect can replace solo progress even when the same peer still hosts. */
  beginNetSession(): void { this.netSource = ''; }
  applyNet(raw: unknown, source = ''): boolean {
    const s = validatedState(raw);
    const changedSource = !!source && source !== this.netSource;
    if (!s || (!changedSource && (s.revision < this.revision
      || (s.revision === this.revision && s.elapsed < this.elapsed)))) return false;
    this.netSource = source; this.restore(s); return true;
  }
  serialize(): ExtractionState { return this.netState(); }
  deserialize(raw: unknown): void {
    const s = validatedState(raw);
    if (s) this.restore(s);
  }
  private restore(s: ExtractionState): void {
    this.banked = s.banked; this.elapsed = s.elapsed; this.finished = s.finished;
    this.revision = s.revision; this.secured = new Map(s.secured); this.lost = new Set(s.lost);
    this.cargo = { ...s.cargo };
    const fruit = this.g.get<FruitSystem & { restoreRunFruitIds(ids: number[]): void }>('fruit');
    fruit.restoreRunFruitIds(this.consumedIds);
  }
}
