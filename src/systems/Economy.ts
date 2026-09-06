import type { Game, System } from '@/core/Game';
import type { Fruit } from '@/fruit/Fruit';
import { qualityFor } from '@/fruit/FruitDefs';

export interface SaleLine {
  species: string;
  displayName: string;
  variant: string | null;
  quality: string;
  mass: number;
  base: number;
  stuntMultiplier: number;
  total: number;
}

export interface SaleResult {
  lines: SaleLine[];
  subtotal: number;
  stuntBonus: number;
  total: number;
  count: number;
}

/**
 * One currency, deliberately. The gate on late equipment is DISCOVERY TIER, not
 * a second resource: grinding apples should never buy an air cannon, but it
 * should always be worth something.
 */
export class Economy implements System {
  readonly name = 'economy';
  money = 0;
  lifetimeEarned = 0;
  fruitSold = 0;
  bestSale = 0;
  /** Rises with new species and rare variants; gates the shop. */
  discoveryTier = 0;
  discoveryPoints = 0;

  private g!: Game;

  init(g: Game): void {
    this.g = g;
    this.money = 0;
    g.debug?.addProbe('economy', () => ({
      money: this.money, lifetime: this.lifetimeEarned, sold: this.fruitSold,
      tier: this.discoveryTier, points: this.discoveryPoints, best: this.bestSale,
    }));
    g.debug?.addAction('economy.add', (n: number) => { this.add(n, 'debug'); return this.money; });
    g.debug?.addAction('economy.set', (n: number) => { this.money = n; return this.money; });
    /** Back to a fresh save's discovery, for scenario isolation. */
    g.debug?.addAction('economy.resetDiscovery', () => {
      this.discoveryPoints = 0; this.discoveryTier = 0; return 0;
    });
  }

  add(amount: number, reason: string): void {
    if (amount === 0) return;
    this.money = Math.max(0, this.money + amount);
    if (amount > 0) this.lifetimeEarned += amount;
    this.g.bus.emit('money:changed', { money: this.money, delta: amount, reason });
  }

  canAfford(cost: number): boolean { return this.money >= cost; }

  spend(cost: number, reason: string): boolean {
    if (!this.canAfford(cost)) return false;
    this.add(-cost, reason);
    return true;
  }

  /** Award discovery points; every 100 raises the tier. */
  addDiscovery(points: number): void {
    this.discoveryPoints += points;
    const tier = Math.floor(this.discoveryPoints / 100);
    if (tier > this.discoveryTier) {
      this.discoveryTier = tier;
      this.g.bus.emit('ui:toast', {
        text: `DISCOVERY TIER ${tier}`, sub: 'New equipment available at the shed', kind: 'gold', ms: 4200,
      });
    }
  }

  /** Value a fruit without selling it — used by the HUD and the sell prompt. */
  quote(f: Fruit, stuntMultiplier = 1): number {
    return Math.max(1, Math.round(f.value() * stuntMultiplier));
  }

  /**
   * Sell a batch. Returns an itemised result so the UI can show a satisfying
   * breakdown rather than a single number appearing from nowhere.
   */
  sell(fruits: Fruit[], stuntMultiplierFor: (f: Fruit) => number = () => 1): SaleResult {
    const lines: SaleLine[] = [];
    let subtotal = 0;
    let withStunts = 0;
    for (const f of fruits) {
      const base = f.value();
      const mult = stuntMultiplierFor(f);
      const total = Math.max(1, Math.round(base * mult));
      subtotal += base;
      withStunts += total;
      lines.push({
        species: f.species,
        displayName: f.displayName,
        variant: f.variant?.id ?? null,
        quality: qualityFor(f.damage).tier,
        mass: +f.mass.toFixed(1),
        base, stuntMultiplier: +mult.toFixed(2), total,
      });
      this.g.bus.emit('fruit:sold', {
        fruitId: f.id, species: f.species, value: total,
        quality: f.quality, mass: f.mass,
      });
    }
    const result: SaleResult = {
      lines, subtotal, stuntBonus: withStunts - subtotal, total: withStunts, count: fruits.length,
    };
    if (result.total > 0) {
      this.add(result.total, 'sale');
      this.fruitSold += fruits.length;
      if (result.total > this.bestSale) this.bestSale = result.total;
    }
    return result;
  }

  serialize(): Record<string, number> {
    return {
      money: this.money, lifetimeEarned: this.lifetimeEarned, fruitSold: this.fruitSold,
      bestSale: this.bestSale, discoveryPoints: this.discoveryPoints, discoveryTier: this.discoveryTier,
    };
  }

  deserialize(d: Record<string, number>): void {
    this.money = d.money ?? 0;
    this.lifetimeEarned = d.lifetimeEarned ?? 0;
    this.fruitSold = d.fruitSold ?? 0;
    this.bestSale = d.bestSale ?? 0;
    this.discoveryPoints = d.discoveryPoints ?? 0;
    this.discoveryTier = d.discoveryTier ?? 0;
    this.g.bus.emit('money:changed', { money: this.money, delta: 0, reason: 'load' });
  }
}
