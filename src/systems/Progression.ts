import type { Game, System } from '@/core/Game';
import type { Economy } from './Economy';
import type { Sunpatch } from '@/world/Sunpatch';
import type { LegendaryHarvest } from './LegendaryHarvest';
import { FRUIT } from '@/fruit/FruitDefs';

/**
 * What a purchase should make you go and try, in one sentence. Shown once,
 * a beat after the tool lands in the hands, because "you own a Catch Net" is
 * a fact and "swing it under a coconut palm" is a plan.
 */
const TRY_THIS: Record<string, { text: string; sub: string }> = {
  net: {
    text: 'TRY THIS: the coconut palms',
    sub: 'Lay a net under one (right-click), climb the ladder and drop a coconut in it. Or swing as it falls.',
  },
  shaker: {
    text: 'TRY THIS: stand under a palm and shake it',
    sub: 'Then decide whether that was a good idea. Bring the net.',
  },
  ropegun: {
    text: 'TRY THIS: a watermelon on the hill farm',
    sub: 'Rope it, pin the rope to rock (right-click), then cut it loose. Then look at the ravine.',
  },
  aircannon: {
    text: 'TRY THIS: fire fruit at the sell pad from the hill',
    sub: 'Anything that lands there sells itself. Right-click fires you.',
  },
  bigBasket: { text: 'Sixteen apples.', sub: 'And a watermelon, if you must.' },
  boots: { text: 'The ridge is yours now.', sub: 'Slopes that stopped you do not.' },
  harness: { text: 'Carry the heavy ones at a walk.', sub: 'The Boulder Plums on the hill were waiting for this.' },
  padding: { text: 'Coconuts are a suggestion now.', sub: 'Most of them, anyway.' },
};

/** The fruit whose first sighting is the "wait, what?" moment: not the ones
 *  that are merely heavy or round, the ones that do something. */
const STRANGE = new Set(['puffmelon', 'vinebomb', 'gluefruit', 'spikefruit', 'boulderplum']);

/** Islands, in the order they unlock. Only the first exists; the second is the reward. */
export const ISLANDS = [
  { id: 'sunpatch', label: 'Sunpatch' },
  { id: 'galegrove', label: 'Gale Grove' },
];

/**
 * The first hour's arc, as a system.
 *
 * Nothing here is a mechanic. It is the connective tissue between mechanics
 * that already exist: the one-time lines that turn a tool into a plan, the
 * moment the island first tells you what the giant melon is for, the record
 * that makes a big sale feel like one, and the thing the King Melon actually
 * unlocks. Every message fires once per save and is written down, so a
 * returning player is not re-taught.
 */
export class Progression implements System {
  readonly name = 'progress';
  private g!: Game;
  private economy!: Economy;
  private world!: Sunpatch;
  private legendary: LegendaryHarvest | null = null;
  /** Ids of islands the player may travel to. */
  islands = new Set<string>(['sunpatch']);
  /** One-shot messages already delivered. */
  shown = new Set<string>();
  /** Game time of each milestone the first time it happened, for the playthrough report. */
  milestones = new Map<string, number>();
  /** Encounter victories count even if the crew discovers them out of order. */
  threatsCleared = new Set<'mimic' | 'snapjaw' | 'spitter'>();
  private pendingHint: { at: number; text: string; sub: string } | null = null;
  private unlockAt = -1;
  private sightTimer = 0;

  constructor(private readonly mimicComparison = false) {}

  init(g: Game): void {
    this.g = g;
    this.economy = g.get<Economy>('economy');
    this.world = g.get<Sunpatch>('world');
    this.legendary = g.has('legendary') ? g.get<LegendaryHarvest>('legendary') : null;

    g.bus.on('shop:purchased', (p) => this.onPurchase(p.itemId));
    g.bus.on('legendary:complete', () => this.onLegendaryComplete());
    g.bus.on('encounter:defeated', ({ kind }) => {
      if (this.threatsCleared.has(kind)) return;
      this.threatsCleared.add(kind);
      this.mark(`defeated:${kind}`);
      this.g.bus.emit('ui:toast', {
        text: 'Objective updated', sub: this.objective, kind: 'gold', ms: 3800,
      });
    });
    g.bus.on('fruit:sold', () => this.mark('firstSale'));
    g.bus.on('money:changed', (p) => { if (p.reason === 'sale') this.onSale(p.delta); });
    g.bus.on('book:discovered', (p) => this.onDiscovered(p.species, p.variant));
    g.bus.on('player:ragdoll', () => this.mark('firstKnockdown'));
    g.bus.on('fruit:destroyed', () => this.mark('firstBurst'));
    g.bus.on('fruit:qualityChanged', () => this.mark('firstBruise'));
    g.bus.on('stunt:awarded', () => this.mark('firstStunt'));
    g.bus.on('legendary:phase', (p) => {
      if (p.phase === 'tether') this.mark('legendaryReady');
      if (p.phase === 'drop') this.mark('legendaryDrop');
    });

    g.debug?.addProbe('progress', () => ({
      islands: [...this.islands],
      nextIsland: this.nextIslandUnlocked,
      shown: [...this.shown],
      milestones: Object.fromEntries([...this.milestones].map(([k, v]) => [k, +v.toFixed(1)])),
      objective: this.objective, threatsCleared: [...this.threatsCleared],
    }));
    g.debug?.addAction('progress.info', () => ({
      islands: [...this.islands], milestones: Object.fromEntries(this.milestones),
      objective: this.objective, threatsCleared: [...this.threatsCleared],
    }));
    g.debug?.addAction('progress.reset', () => {
      this.islands = new Set(['sunpatch']);
      this.shown.clear();
      this.milestones.clear();
      this.threatsCleared.clear();
      this.world.setNextIslandOpen(false);
      return true;
    });
  }

  get nextIslandUnlocked(): boolean { return this.islands.has('galegrove'); }

  /** The session host owns shared encounter milestones while playing together. */
  applyHostThreats(value: unknown): void {
    if (!Array.isArray(value)) return;
    const next = new Set<'mimic' | 'snapjaw' | 'spitter'>(value.filter(
      (x): x is 'mimic' | 'snapjaw' | 'spitter' => x === 'mimic' || x === 'snapjaw' || x === 'spitter'));
    if (next.size === this.threatsCleared.size && [...next].every(x => this.threatsCleared.has(x))) return;
    this.threatsCleared = next;
    this.g.bus.emit('ui:toast', {
      text: 'Objective updated', sub: this.objective, kind: 'gold', ms: 3800,
    });
  }

  get objective(): string {
    if (this.mimicComparison) return this.threatsCleared.has('mimic')
      ? 'Mimic subdued. Secure the melon and sell it at the nearby orchard pad.'
      : 'Investigate the orchard fruit. Strike or use the Air Cannon.';
    if (this.nextIslandUnlocked) return 'Sunpatch cleared. Return to the boat.';
    if (!this.threatsCleared.has('mimic')) return 'Follow the orchard path. Investigate the moving fruit.';
    if (!this.threatsCleared.has('snapjaw')) return 'Take the hill path. Free the harvest from Snapjaw.';
    if (!this.threatsCleared.has('spitter')) return 'Climb toward the ridge. Silence the Spitter Plant.';
    if (this.g.has('kingVine') && this.g.get<{ subdued: boolean }>('kingVine').subdued)
      return 'Cut the King Melon free. Bring it to the marked pad.';
    return 'Confront King Vine at King Melon.';
  }

  /** Record the first time something happened, in game seconds. */
  mark(key: string): void {
    if (!this.milestones.has(key)) this.milestones.set(key, this.g.clock.elapsed);
  }

  private once(key: string): boolean {
    if (this.shown.has(key)) return false;
    this.shown.add(key);
    return true;
  }

  private onPurchase(itemId: string): void {
    this.mark('firstPurchase');
    this.mark(`bought:${itemId}`);
    const hint = TRY_THIS[itemId];
    if (!hint || !this.once(`try:${itemId}`)) return;
    // After the "equipped" toast has had its moment, not on top of it.
    this.pendingHint = { at: this.g.clock.elapsed + 2.6, ...hint };
  }

  private onSale(delta: number): void {
    // A new best sale is worth a banner, once it is big enough to be one.
    if (delta >= 150 && delta >= this.economy.bestSale && delta > this.lastBest) {
      this.lastBest = delta;
      if (this.everCelebratedSale) {
        this.g.bus.emit('ui:celebrate', {
          title: 'BEST SALE YET', sub: `$${delta.toLocaleString('en-US')}`, kind: 'record',
        });
      }
      this.everCelebratedSale = true;
    }
  }
  private lastBest = 0;
  private everCelebratedSale = false;

  private onDiscovered(species: string, variant: string | null): void {
    if (variant) { this.mark('firstVariant'); return; }
    if (STRANGE.has(species) && FRUIT[species]) this.mark('firstStrangeFruit');
    this.mark(`found:${species}`);
  }

  private onLegendaryComplete(): void {
    this.mark('legendaryComplete');
    if (this.nextIslandUnlocked) return;
    this.islands.add('galegrove');
    // Let LEGENDARY COMPLETE land first. This is the second banner, and the
    // reason the first one was worth chasing.
    this.unlockAt = this.g.clock.elapsed + 3.4;
  }

  private announceUnlock(): void {
    this.world.setNextIslandOpen(true);
    this.g.bus.emit('ui:celebrate', {
      title: 'GALE GROVE UNLOCKED', sub: 'THE NEXT ISLAND. MERV IS FIXING THE BOAT.', kind: 'legendary',
    });
    this.g.bus.emit('audio:sfx', { name: 'discovery', volume: 1, pitch: 1.15 });
    this.g.bus.emit('ui:toast', {
      text: 'Sunpatch: complete', sub: 'The board at the shed has changed. So has the boat.', kind: 'gold', ms: 6000,
    });
  }

  /**
   * The King Melon, explained the first time you are close enough to wonder.
   * Not at the dock — it is in the opening frame, and a toast over the
   * opening frame is noise — but the first time the walk brings you within
   * seventy metres of it, which is the ridge or the hill farm.
   */
  private checkFirstSight(dt: number): void {
    if (!this.legendary || this.shown.has('sight')) return;
    this.sightTimer -= dt;
    if (this.sightTimer > 0) return;
    this.sightTimer = 0.5;
    const m = this.legendary.position;
    const p = this.g.player.position;
    if (Math.hypot(m.x - p.x, m.z - p.z) > 70) return;
    this.once('sight');
    this.mark('kingMelonSeen');
    this.legendary.firstSightAt = this.g.clock.elapsed;
    this.g.bus.emit('ui:celebrate', { title: 'THE KING MELON', sub: '2,600 KG. $9,500. FOUR VINES.', kind: 'legendary' });
    this.g.bus.emit('ui:toast', {
      text: 'The King Vine guards the prize',
      sub: 'Dodge its attacks, hit the exposed stem, then cut the melon free. Ropes can steady the drop.',
      kind: 'gold', ms: 6000,
    });
  }

  fixedStep(dt: number): void {
    if (!this.mimicComparison) this.checkFirstSight(dt);
    const now = this.g.clock.elapsed;
    if (this.pendingHint && now >= this.pendingHint.at) {
      this.g.bus.emit('ui:toast', {
        text: this.pendingHint.text, sub: this.pendingHint.sub, kind: 'gold', ms: 7000,
      });
      this.pendingHint = null;
    }
    if (this.unlockAt >= 0 && now >= this.unlockAt) {
      this.unlockAt = -1;
      this.announceUnlock();
    }
  }

  serialize(): { islands: string[]; shown: string[]; milestones: Record<string, number>;
    threatsCleared: Array<'mimic' | 'snapjaw' | 'spitter'> } {
    return {
      islands: [...this.islands], shown: [...this.shown],
      milestones: Object.fromEntries([...this.milestones].map(([k, v]) => [k, +v.toFixed(1)])),
      threatsCleared: [...this.threatsCleared],
    };
  }

  deserialize(d: { islands?: string[]; shown?: string[]; milestones?: Record<string, number>;
    threatsCleared?: Array<'mimic' | 'snapjaw' | 'spitter'> }): void {
    this.islands = new Set(d.islands?.length ? d.islands : ['sunpatch']);
    this.shown = new Set(d.shown ?? []);
    this.milestones = new Map(Object.entries(d.milestones ?? {}));
    this.threatsCleared = new Set((d.threatsCleared ?? []).filter(
      (x): x is 'mimic' | 'snapjaw' | 'spitter' => x === 'mimic' || x === 'snapjaw' || x === 'spitter'));
    this.world.setNextIslandOpen(this.nextIslandUnlocked);
  }
}
