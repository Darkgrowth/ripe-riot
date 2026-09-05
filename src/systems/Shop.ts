import type { Game, System } from '@/core/Game';
import type { Economy } from './Economy';
import type { ToolInventory } from '@/tools/ToolInventory';
import type { Sunpatch } from '@/world/Sunpatch';
import type { InteractionSystem } from '@/interaction/InteractionSystem';
import type { MultiplayerAuthority } from '@/net/MultiplayerAuthority';
import { DEEP_BASKET_CAPACITY, DEEP_BASKET_MAX_ITEM_MASS } from '@/interaction/CarryRules';

export interface ShopEntry {
  id: string;
  label: string;
  icon: string;
  description: string;
  tagline: string;
  cost: number;
  tier: number;
  kind: 'tool' | 'upgrade';
  owned: boolean;
  affordable: boolean;
  locked: boolean;
}

/** Non-tool purchases: stat upgrades that change how the tools feel. */
interface UpgradeDef {
  id: string;
  label: string;
  icon: string;
  description: string;
  tagline: string;
  cost: number;
  tier: number;
  apply(g: Game): void;
}

const UPGRADES: UpgradeDef[] = [
  {
    id: 'bigBasket', label: 'Deep Basket', icon: '🧺', cost: 320, tier: 0,
    description: 'Holds sixteen instead of nine, and takes heavier fruit.',
    tagline: 'Structural wicker.',
    apply(g) {
      const i = g.get<InteractionSystem>('interaction');
      i.basket.capacity = DEEP_BASKET_CAPACITY;
      i.basket.maxItemMass = DEEP_BASKET_MAX_ITEM_MASS;
    },
  },
  {
    id: 'boots', label: 'Grip Boots', icon: '🥾', cost: 420, tier: 0,
    description: 'Faster on foot and much better on slopes.',
    tagline: 'The soles are aggressive.',
    apply(g) {
      g.player.tuning.walk = 6.2;
      g.player.tuning.sprint = 9.6;
      g.player.tuning.maxSlopeDeg = 58;
    },
  },
  {
    id: 'harness', label: 'Hauling Harness', icon: '🎽', cost: 560, tier: 1,
    description: 'Carry heavy fruit without slowing to a shuffle.',
    tagline: 'Distributes the melon across your whole spine.',
    apply(g) { g.player.carryTolerance = 520; },
  },
  {
    id: 'padding', label: 'Impact Padding', icon: '🦺', cost: 640, tier: 1,
    description: 'Takes a lot more before you go down.',
    tagline: 'Does not stop it hurting. Stops it stopping you.',
    apply(g) { g.player.ragdollImpactSpeed = 19.5; },
  },
];

/**
 * The dockside shed. Deliberately a physical place with a physical counter: the
 * brief's loop is "sell expensive fruit, see exciting tool, buy it, walk
 * outside and immediately try it", and a menu you can open anywhere breaks the
 * walk-outside half of that.
 */
export class Shop implements System {
  readonly name = 'shop';
  private g!: Game;
  private economy!: Economy;
  private tools!: ToolInventory;
  private world!: Sunpatch;
  open = false;
  nearCounter = false;
  purchased = new Set<string>();
  /** Item a client has asked the host for and not yet heard back about. */
  pendingBuy: string | null = null;
  private panel: HTMLElement | null = null;
  private net: MultiplayerAuthority | null = null;

  init(g: Game): void {
    this.g = g;
    this.economy = g.get<Economy>('economy');
    this.tools = g.get<ToolInventory>('tools');
    this.world = g.get<Sunpatch>('world');
    this.net = g.has('net') ? g.get<MultiplayerAuthority>('net') : null;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.open) this.close();
    });

    g.debug?.addProbe('shop', () => ({
      open: this.open, near: this.nearCounter,
      purchased: [...this.purchased],
      offers: this.catalogue().length,
      pendingBuy: this.pendingBuy,
    }));
    g.debug?.addAction('shop.list', () => this.catalogue());
    g.debug?.addAction('shop.buy', (id: string) => this.buy(id));
    g.debug?.addAction('shop.open', () => { this.openPanel(); return this.open; });
    g.debug?.addAction('shop.close', () => { this.close(); return this.open; });
  }

  /** Everything currently on offer, in a stable, presentable order. */
  catalogue(): ShopEntry[] {
    const money = this.economy.money;
    const tier = this.economy.discoveryTier;
    const out: ShopEntry[] = [];

    for (const tool of this.tools.all.values()) {
      if (tool.def.cost <= 0 && tool.def.starter) continue;
      const owned = this.tools.owned.has(tool.def.id);
      out.push({
        id: tool.def.id, label: tool.def.label, icon: tool.def.icon,
        description: tool.def.description, tagline: tool.def.tagline,
        cost: tool.def.cost, tier: tool.def.tier, kind: 'tool',
        owned, affordable: money >= tool.def.cost, locked: tier < tool.def.tier,
      });
    }
    for (const up of UPGRADES) {
      const owned = this.purchased.has(up.id);
      out.push({
        id: up.id, label: up.label, icon: up.icon, description: up.description,
        tagline: up.tagline, cost: up.cost, tier: up.tier, kind: 'upgrade',
        owned, affordable: money >= up.cost, locked: tier < up.tier,
      });
    }
    out.sort((a, b) => (a.owned === b.owned ? a.cost - b.cost : a.owned ? 1 : -1));
    return out;
  }

  /** The price list, for the host's ledger. Null for anything not on sale. */
  priceOf(id: string): { cost: number; tier: number } | null {
    const tool = this.tools.all.get(id);
    if (tool && !(tool.def.cost <= 0 && tool.def.starter)) return { cost: tool.def.cost, tier: tool.def.tier };
    const up = UPGRADES.find((u) => u.id === id);
    return up ? { cost: up.cost, tier: up.tier } : null;
  }

  /**
   * Buy something.
   *
   * Money is shared and the host owns it, so on a client this SPENDS NOTHING:
   * it checks what it can see (owned, tier, balance — all mirrored from the
   * host) so the refusal is instant, then asks. The host spends once and
   * answers, and `grant` runs when the answer is yes. The old version spent
   * the shared pot locally and was overwritten by the next snapshot, which is
   * a free tool with extra steps.
   */
  buy(id: string): { ok: boolean; reason?: string; requested?: boolean } {
    const entry = this.catalogue().find((e) => e.id === id);
    if (!entry) return { ok: false, reason: 'no such item' };
    if (entry.owned) return { ok: false, reason: 'already owned' };
    if (entry.locked) {
      this.g.bus.emit('ui:toast', {
        text: 'Not yet', sub: `Needs Discovery Tier ${entry.tier}`, kind: 'bad', ms: 2200,
      });
      return { ok: false, reason: 'locked' };
    }
    if (!this.economy.canAfford(entry.cost)) {
      this.g.bus.emit('ui:toast', {
        text: 'Not enough money', sub: `${entry.label} costs $${entry.cost}`, kind: 'bad', ms: 2200,
      });
      return { ok: false, reason: 'too expensive' };
    }
    if (this.net && !this.net.authoritative) {
      if (this.pendingBuy) return { ok: false, reason: 'waiting on the host' };
      this.pendingBuy = id;
      this.net.requestBuy(id);
      return { ok: false, requested: true };
    }
    if (!this.economy.spend(entry.cost, `buy:${id}`)) return { ok: false, reason: 'too expensive' };
    this.net?.noteBought(id);
    this.grant(id);
    return { ok: true };
  }

  /** The host said yes (or we are the host): hand the thing over. */
  grant(id: string): void {
    if (this.pendingBuy === id) this.pendingBuy = null;
    const entry = this.catalogue().find((e) => e.id === id);
    if (!entry || entry.owned) return;
    if (entry.kind === 'tool') {
      this.tools.give(id);
      // Put it in their hands. Buying a Catch Net and then walking out still
      // holding the hand picker is a strange reward for the first 260 dollars
      // anyone earns; the point of a purchase is to go and try the thing.
      this.tools.selectById(id);
      this.g.bus.emit('ui:toast', {
        text: `${entry.label} equipped`, sub: entry.description, kind: 'good', ms: 4200,
      });
    } else {
      const up = UPGRADES.find((u) => u.id === id)!;
      up.apply(this.g);
      this.purchased.add(id);
    }
    this.g.bus.emit('shop:purchased', { itemId: id, cost: entry.cost });
    this.g.bus.emit('audio:sfx', { name: 'purchase' });
    this.g.bus.emit('ui:celebrate', { title: entry.label.toUpperCase(), sub: entry.tagline });
    if (this.open) this.render();
  }

  /** The host said no. Nothing was spent, so nothing is undone. */
  refused(id: string, why: string): void {
    if (this.pendingBuy === id) this.pendingBuy = null;
    const entry = this.catalogue().find((e) => e.id === id);
    this.g.bus.emit('ui:toast', {
      text: entry ? `${entry.label} — ${why}` : why, kind: 'bad', ms: 2200,
    });
    if (this.open) this.render();
  }

  // ---- panel --------------------------------------------------------------
  openPanel(): void {
    if (this.open) return;
    this.open = true;
    this.g.input.enabled = false;
    document.exitPointerLock?.();
    this.panel = document.createElement('div');
    this.panel.className = 'panel';
    document.getElementById('ui-root')!.appendChild(this.panel);
    this.render();
    this.g.bus.emit('shop:opened', {});
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.panel?.remove();
    this.panel = null;
    this.g.input.enabled = true;
    this.g.bus.emit('shop:closed', {});
  }

  private render(): void {
    if (!this.panel) return;
    const items = this.catalogue();
    this.panel.innerHTML = `
      <div class="card">
        <h2>MERV'S SUPPLY</h2>
        <p class="hint">$${this.economy.money.toLocaleString('en-US')} available
          &nbsp;·&nbsp; Discovery Tier ${this.economy.discoveryTier}
          &nbsp;·&nbsp; Esc to close</p>
        <div class="shop-grid">
          ${items.map((e) => `
            <div class="shop-item ${e.owned ? 'owned' : ''} ${e.locked || (!e.affordable && !e.owned) ? 'locked' : ''}"
                 data-id="${e.id}">
              <div class="name">${e.icon} ${e.label}</div>
              <div class="desc">${e.description}</div>
              <div class="cost ${!e.affordable && !e.owned ? 'cant' : ''}">
                ${e.owned ? 'OWNED' : e.locked ? `TIER ${e.tier} REQUIRED` : `$${e.cost}`}
              </div>
              <div class="tagline">${e.tagline}</div>
            </div>`).join('')}
        </div>
      </div>`;
    for (const el of Array.from(this.panel.querySelectorAll<HTMLElement>('.shop-item'))) {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        if (id) this.buy(id);
      });
    }
  }

  fixedStep(): void {
    const counter = this.world.shopCounter;
    const p = this.g.player.position;
    const d = Math.hypot(p.x - counter.x, p.z - counter.z);
    this.nearCounter = d < 4.4 && Math.abs(p.y - counter.y) < 4;

    if (this.nearCounter && !this.open && this.g.input.frame.interactPressed) {
      const inter = this.g.get<InteractionSystem>('interaction');
      // Selling wins if the player is carrying goods; browsing is the fallback.
      if (!inter.carried && inter.basket.items.length === 0) this.openPanel();
    }
  }

  frameUpdate(): void {
    if (this.open || !this.nearCounter) return;
    const inter = this.g.get<InteractionSystem>('interaction');
    if (!inter.promptText) {
      this.g.bus.emit('ui:prompt', { text: '<b>E</b> Browse the shed' });
    }
  }

  serialize(): { purchased: string[] } { return { purchased: [...this.purchased] }; }

  deserialize(d: { purchased?: string[] }): void {
    this.purchased = new Set(d.purchased ?? []);
    for (const id of this.purchased) {
      UPGRADES.find((u) => u.id === id)?.apply(this.g);
    }
  }
}

export { UPGRADES };
export type { UpgradeDef };