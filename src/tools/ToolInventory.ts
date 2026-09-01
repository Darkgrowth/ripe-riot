import type { Game, System } from '@/core/Game';
import type { InteractionSystem } from '@/interaction/InteractionSystem';
import type { FruitSystem } from '@/fruit/FruitSystem';
import { Tool, type ToolContext } from './ToolBase';
import { ALL_TOOLS, RopeGun } from './Tools';

/**
 * Three active slots plus one utility slot, as specified. The constraint is the
 * point: with everything available at once nobody has to decide what to bring,
 * and nobody has to shout at a teammate to bring the other thing.
 */
export class ToolInventory implements System {
  readonly name = 'tools';
  private g!: Game;
  private ctx!: ToolContext;

  /** Every tool that exists, by id. Owned or not. */
  all = new Map<string, Tool>();
  owned = new Set<string>();
  /** Tool ids in slots 0..2 (active) and 3 (utility). */
  slots: Array<string | null> = [null, null, null, null];
  activeSlot = 0;

  init(g: Game): void {
    this.g = g;
    this.ctx = {
      game: g,
      interaction: g.get<InteractionSystem>('interaction'),
      fruit: g.get<FruitSystem>('fruit'),
    };

    for (const Ctor of ALL_TOOLS) {
      const t = new Ctor();
      t.attach(this.ctx);
      this.all.set(t.def.id, t);
      if (t.def.starter) this.owned.add(t.def.id);
    }
    this.slots[0] = 'hand';
    this.slots[3] = 'basket';
    // The ladder shares the utility slot with the basket; swapping is a tap.
    this.equip(0);

    g.debug?.addProbe('tools', () => ({
      slots: this.slots,
      active: this.activeId,
      owned: [...this.owned],
      status: this.activeTool?.status() ?? '',
      cooldown: +(this.activeTool?.cooldown ?? 0).toFixed(2),
    }));
    g.debug?.addAction('tool.give', (id: string) => this.give(id));
    g.debug?.addAction('tool.equip', (slot: number) => { this.equip(slot); return this.activeId; });
    g.debug?.addAction('tool.select', (id: string) => this.selectById(id));
    g.debug?.addAction('tool.assign', (slot: number, id: string) => this.assignSlot(slot, id));
    g.debug?.addAction('tool.primary', (down = true) => { this.activeTool?.onPrimary(down); return true; });
    g.debug?.addAction('tool.secondary', (down = true) => { this.activeTool?.onSecondary(down); return true; });
    g.debug?.addAction('tool.fire', () => {
      // Press and release, the way a player actually uses a tool.
      this.activeTool?.onPrimary(true);
      this.activeTool?.onPrimary(false);
      return this.activeId;
    });
    g.debug?.addAction('tool.debug', (id?: string) => {
      const t = id ? this.all.get(id) : this.activeTool;
      return t ? { id: t.def.id, ...t.debugState() } : null;
    });
    g.debug?.addAction('tool.list', () => [...this.all.values()].map((t) => ({
      id: t.def.id, label: t.def.label, cost: t.def.cost, tier: t.def.tier,
      owned: this.owned.has(t.def.id), utility: !!t.def.utility,
    })));
  }

  get activeId(): string | null { return this.slots[this.activeSlot]; }
  get activeTool(): Tool | null {
    const id = this.activeId;
    return id ? this.all.get(id) ?? null : null;
  }
  toolOf(id: string): Tool | null { return this.all.get(id) ?? null; }

  /** Grant a tool and put it in the first free slot of the right kind. */
  give(id: string): boolean {
    const tool = this.all.get(id);
    if (!tool || this.owned.has(id)) return false;
    this.owned.add(id);
    const range = tool.def.utility ? [3] : [0, 1, 2];
    let placed = false;
    for (const i of range) {
      if (!this.slots[i]) { this.slots[i] = id; placed = true; break; }
    }
    if (!placed) {
      // Active slots full: replace the last one rather than making the player
      // walk back to a menu to use the thing they just bought.
      this.slots[tool.def.utility ? 3 : 2] = id;
    }
    this.g.bus.emit('tool:equipped', { slot: this.slots.indexOf(id), toolId: id });
    this.refreshUI();
    return true;
  }

  selectById(id: string): boolean {
    const i = this.slots.indexOf(id);
    if (i >= 0) { this.equip(i); return true; }
    // Owned but not slotted: with only three active slots this happens as soon
    // as a player owns a fourth tool, so put it in the current slot rather than
    // silently doing nothing.
    if (!this.owned.has(id)) return false;
    const tool = this.all.get(id);
    if (!tool) return false;
    return this.assignSlot(tool.def.utility ? 3 : Math.min(this.activeSlot, 2), id);
  }

  /** Put an owned tool into a specific slot and equip it. */
  assignSlot(slot: number, id: string): boolean {
    if (!this.owned.has(id) || slot < 0 || slot > 3) return false;
    const tool = this.all.get(id);
    if (!tool) return false;
    // `utility` is optional, so compare truthiness: `undefined !== false`
    // is true and would reject every ordinary tool.
    if (!!tool.def.utility !== (slot === 3)) return false;
    // A tool can only occupy one slot at a time.
    const existing = this.slots.indexOf(id);
    if (existing >= 0) this.slots[existing] = null;
    this.activeTool?.onUnequip();
    this.slots[slot] = id;
    this.activeSlot = slot;
    this.all.get(id)?.onEquip();
    this.g.bus.emit('tool:equipped', { slot, toolId: id });
    this.refreshUI();
    return true;
  }

  equip(slot: number): void {
    if (slot < 0 || slot > 3) return;
    if (!this.slots[slot]) return;
    if (slot === this.activeSlot && this.activeTool?.equipped) return;
    this.activeTool?.onUnequip();
    this.activeSlot = slot;
    this.activeTool?.onEquip();
    this.g.bus.emit('tool:equipped', { slot, toolId: this.activeId ?? '' });
    this.refreshUI();
  }

  /** Cycle the utility slot between owned utility tools. */
  cycleUtility(): void {
    const utilities = [...this.all.values()].filter((t) => t.def.utility && this.owned.has(t.def.id));
    if (utilities.length < 2) { this.equip(3); return; }
    const cur = this.slots[3];
    const i = utilities.findIndex((t) => t.def.id === cur);
    const next = utilities[(i + 1) % utilities.length];
    this.activeTool?.onUnequip();
    this.slots[3] = next.def.id;
    this.activeSlot = 3;
    next.onEquip();
    this.refreshUI();
  }

  private refreshUI(): void {
    const ui = this.g.has('ui') ? this.g.get<{ renderSlots(): void }>('ui') : null;
    ui?.renderSlots();
  }

  slotSummary(): Array<{ name: string; icon: string; active: boolean; empty: boolean; status: string }> {
    return this.slots.map((id, i) => {
      const t = id ? this.all.get(id) : null;
      return {
        name: t?.def.label ?? '—',
        icon: t?.def.icon ?? '',
        active: i === this.activeSlot,
        empty: !t,
        status: t?.status() ?? '',
      };
    });
  }

  fixedStep(dt: number): void {
    const input = this.g.input.frame;

    if (input.slot >= 1 && input.slot <= 4) {
      const target = input.slot - 1;
      if (target === 3 && this.activeSlot === 3) this.cycleUtility();
      else this.equip(target);
    }
    if (input.scroll !== 0) {
      const dir = input.scroll > 0 ? 1 : -1;
      for (let k = 1; k <= 3; k++) {
        const i = (this.activeSlot + dir * k + 3) % 3;
        if (this.slots[i]) { this.equip(i); break; }
      }
    }

    const active = this.activeTool;
    if (this.g.player.state === 'active') {
      if (input.primaryPressed) active?.onPrimary(true);
      if (input.primaryReleased) active?.onPrimary(false);
      if (input.secondaryPressed) active?.onSecondary(true);
      if (input.secondaryReleased) active?.onSecondary(false);
      if (input.dropPressed) {
        // Q releases a rope before it drops what is in your hands.
        const gun = this.all.get('ropegun') as RopeGun | undefined;
        if (!gun || !gun.releaseNewest()) this.ctx.interaction.dropHeld();
      }
    }

    active?.step(dt, { primary: input.primary, secondary: input.secondary });
    // Tools with persistent world state (ground nets, ladders, compressors)
    // keep working while stowed.
    for (const t of this.all.values()) {
      if (t !== active && this.owned.has(t.def.id)) t.background(dt);
    }
    if (active) active.background(0);
  }

  serialize(): { owned: string[]; slots: Array<string | null> } {
    return { owned: [...this.owned], slots: [...this.slots] };
  }

  deserialize(d: { owned?: string[]; slots?: Array<string | null> }): void {
    if (d.owned) { this.owned = new Set(d.owned); }
    if (d.slots) { this.slots = [...d.slots]; }
    this.equip(0);
    this.refreshUI();
  }
}
