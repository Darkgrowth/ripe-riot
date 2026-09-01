import type { Game, System } from '@/core/Game';
import type { Economy } from './Economy';
import type { FruitSystem } from '@/fruit/FruitSystem';
import type { HarvestScoring } from './HarvestScoring';
import { FRUIT, VARIANTS, type QualityTier } from '@/fruit/FruitDefs';

export interface SpeciesRecord {
  species: string;
  discovered: boolean;
  harvested: number;
  destroyed: number;
  largestKg: number;
  smallestKg: number;
  mostValuable: number;
  bestQuality: QualityTier | null;
  bestStuntMultiplier: number;
  longestDistance: number;
  highestDrop: number;
  variants: Set<string>;
}

/**
 * The collection layer. Records are what turn a fruit from a unit of income
 * into something a player has an opinion about — "that is the biggest coconut
 * I have ever seen" only works if the game remembers the previous biggest.
 */
export class HarvestBook implements System {
  readonly name = 'book';
  private g!: Game;
  private economy!: Economy;
  private fruitSys!: FruitSystem;
  private scoring!: HarvestScoring;
  records = new Map<string, SpeciesRecord>();
  open = false;
  private panel: HTMLElement | null = null;

  init(g: Game): void {
    this.g = g;
    this.economy = g.get<Economy>('economy');
    this.fruitSys = g.get<FruitSystem>('fruit');
    this.scoring = g.get<HarvestScoring>('scoring');

    for (const id of Object.keys(FRUIT)) this.records.set(id, blank(id));

    // Discovery fires the moment a fruit is detached, not when it is sold: the
    // player has seen the thing, and finding out what it is should not be
    // contingent on getting it home in one piece.
    g.bus.on('fruit:detached', (p) => {
      const f = this.fruitSys.get(p.fruitId);
      if (f) this.discover(f.species, f.variant?.id ?? null);
    });
    g.bus.on('fruit:sold', (p) => this.onSold(p.fruitId, p.species, p.value, p.quality, p.mass));
    g.bus.on('fruit:destroyed', (p) => {
      const r = this.records.get(p.species);
      if (r) r.destroyed++;
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyB' && !e.repeat) this.toggle();
      if (e.code === 'Escape' && this.open) this.close();
    });

    g.debug?.addProbe('book', () => ({
      discovered: [...this.records.values()].filter((r) => r.discovered).length,
      species: this.records.size,
      harvested: [...this.records.values()].reduce((a, r) => a + r.harvested, 0),
      variants: [...this.records.values()].reduce((a, r) => a + r.variants.size, 0),
      open: this.open,
    }));
    g.debug?.addAction('book.get', (species: string) => {
      const r = this.records.get(species);
      return r ? { ...r, variants: [...r.variants] } : null;
    });
    g.debug?.addAction('book.all', () => [...this.records.values()].map((r) => ({
      ...r, variants: [...r.variants],
    })));
    g.debug?.addAction('book.open', () => { this.openPanel(); return this.open; });
    g.debug?.addAction('book.close', () => { this.close(); return this.open; });
  }

  discover(species: string, variantId: string | null): void {
    const r = this.records.get(species);
    if (!r) return;
    if (!r.discovered) {
      r.discovered = true;
      const def = FRUIT[species];
      this.g.bus.emit('book:discovered', { species, variant: null });
      this.g.bus.emit('ui:celebrate', { title: 'NEW FRUIT', sub: def.label.toUpperCase(), kind: 'discovery' });
      this.g.bus.emit('ui:toast', { text: def.label, sub: def.flavour, kind: 'gold', ms: 4000 });
      this.economy.addDiscovery(34);
    }
    if (variantId && !r.variants.has(variantId)) {
      r.variants.add(variantId);
      const v = VARIANTS.find((x) => x.id === variantId);
      this.g.bus.emit('book:discovered', { species, variant: variantId });
      this.g.bus.emit('ui:celebrate', {
        title: (v?.label ?? variantId).toUpperCase(), sub: `${FRUIT[species].label} · ${v?.note ?? ''}`,
        kind: 'discovery',
      });
      this.economy.addDiscovery(46);
    }
  }

  private onSold(fruitId: number, species: string, value: number, quality: string, mass: number): void {
    const r = this.records.get(species);
    if (!r) return;
    const f = this.fruitSys.get(fruitId);
    // Record the species and any variant here as well as on detach: fruit can
    // reach the counter without ever having been detached by a player (netted
    // mid-air, delivered by air cannon, spawned by an event).
    this.discover(species, f?.variant?.id ?? null);
    r.harvested++;
    const beat = (field: keyof SpeciesRecord, next: number, better: (a: number, b: number) => boolean) => {
      const cur = r[field] as number;
      if (better(next, cur)) {
        (r[field] as number) = next;
        this.g.bus.emit('book:record', { species, field: String(field), value: next });
        return true;
      }
      return false;
    };

    if (beat('largestKg', +mass.toFixed(2), (a, b) => a > b) && r.harvested > 1) {
      this.g.bus.emit('ui:celebrate', {
        title: 'PERSONAL RECORD', sub: `${mass.toFixed(1)} KG ${FRUIT[species].label.toUpperCase()}`, kind: 'record',
      });
    }
    if (r.smallestKg === 0 || mass < r.smallestKg) r.smallestKg = +mass.toFixed(2);
    beat('mostValuable', value, (a, b) => a > b);

    const order: QualityTier[] = ['Ruined', 'Damaged', 'Bruised', 'Good', 'Perfect'];
    if (!r.bestQuality || order.indexOf(quality as QualityTier) > order.indexOf(r.bestQuality)) {
      r.bestQuality = quality as QualityTier;
    }
    if (f) {
      const mult = this.scoring.multiplierFor(f);
      beat('bestStuntMultiplier', +mult.toFixed(2), (a, b) => a > b);
      beat('longestDistance', +f.travelled.toFixed(1), (a, b) => a > b);
      beat('highestDrop', +Math.max(0, f.peakHeight - f.position.y).toFixed(1), (a, b) => a > b);
    }
  }

  get discoveredCount(): number {
    return [...this.records.values()].filter((r) => r.discovered).length;
  }

  // ---- panel --------------------------------------------------------------
  toggle(): void { this.open ? this.close() : this.openPanel(); }

  openPanel(): void {
    if (this.open) return;
    this.open = true;
    this.g.input.enabled = false;
    document.exitPointerLock?.();
    this.panel = document.createElement('div');
    this.panel.className = 'panel';
    document.getElementById('ui-root')!.appendChild(this.panel);
    this.render();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.panel?.remove();
    this.panel = null;
    this.g.input.enabled = true;
  }

  private render(): void {
    if (!this.panel) return;
    const entries = [...this.records.values()];
    const known = entries.filter((r) => r.discovered).length;
    this.panel.innerHTML = `
      <div class="card">
        <h2>HARVEST BOOK</h2>
        <p class="hint">${known} / ${entries.length} species
          &nbsp;·&nbsp; ${entries.reduce((a, r) => a + r.variants.size, 0)} rare variants
          &nbsp;·&nbsp; B or Esc to close</p>
        <div class="book-grid">
          ${entries.map((r) => this.entryHtml(r)).join('')}
        </div>
      </div>`;
  }

  private entryHtml(r: SpeciesRecord): string {
    const def = FRUIT[r.species];
    if (!r.discovered) {
      return `<div class="book-entry unknown">
        <div class="name">? ? ?</div>
        <div class="row"><span>${def.hint}</span></div>
      </div>`;
    }
    const row = (k: string, v: string) => `<div class="row"><span>${k}</span><b>${v}</b></div>`;
    return `<div class="book-entry">
      <div class="name">${def.label}</div>
      ${row('harvested', String(r.harvested))}
      ${row('largest', r.largestKg ? `${r.largestKg} kg` : '—')}
      ${row('smallest', r.smallestKg ? `${r.smallestKg} kg` : '—')}
      ${row('best sale', r.mostValuable ? `$${r.mostValuable}` : '—')}
      ${row('best quality', r.bestQuality ?? '—')}
      ${row('best stunt', r.bestStuntMultiplier ? `×${r.bestStuntMultiplier}` : '—')}
      ${row('longest haul', r.longestDistance ? `${r.longestDistance} m` : '—')}
      ${row('variants', r.variants.size ? [...r.variants].join(', ') : '—')}
      ${row('lost', String(r.destroyed))}
    </div>`;
  }

  serialize(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, r] of this.records) out[k] = { ...r, variants: [...r.variants] };
    return out;
  }

  deserialize(d: Record<string, unknown>): void {
    for (const [k, raw] of Object.entries(d)) {
      const r = this.records.get(k);
      if (!r || !raw || typeof raw !== 'object') continue;
      const src = raw as Partial<SpeciesRecord> & { variants?: string[] };
      Object.assign(r, src, { variants: new Set(src.variants ?? []) });
    }
  }
}

function blank(species: string): SpeciesRecord {
  return {
    species, discovered: false, harvested: 0, destroyed: 0,
    largestKg: 0, smallestKg: 0, mostValuable: 0, bestQuality: null,
    bestStuntMultiplier: 0, longestDistance: 0, highestDrop: 0,
    variants: new Set(),
  };
}
