import * as THREE from 'three';
import type { Game } from '@/core/Game';
import type { InteractionSystem } from '@/interaction/InteractionSystem';
import type { FruitSystem } from '@/fruit/FruitSystem';

export interface ToolContext {
  game: Game;
  interaction: InteractionSystem;
  fruit: FruitSystem;
}

export interface ToolDef {
  id: string;
  label: string;
  icon: string;
  /** One line, shown in the shop and on the slot. */
  description: string;
  /** The joke, shown smaller underneath. */
  tagline: string;
  cost: number;
  /** Discovery tier required before the shop will sell it. */
  tier: number;
  /** Utility tools go in slot 4 and are always available. */
  utility?: boolean;
  /** Owned from the start. */
  starter?: boolean;
}

/**
 * A tool is a small state machine that reacts to the two mouse buttons.
 *
 * Tools must not special-case fruit species. Everything interesting in the
 * brief — rope plus air cannon, winch plus tree shaker, net plus Vinebomb —
 * comes from tools acting on physics that already exists, so a new combination
 * needs no new code.
 */
export abstract class Tool {
  abstract readonly def: ToolDef;
  protected ctx!: ToolContext;
  /** Seconds until the tool can fire again. */
  cooldown = 0;
  /** 0..1, for tools that wind up. */
  charge = 0;
  equipped = false;

  attach(ctx: ToolContext): void { this.ctx = ctx; this.onAttach?.(); }

  onAttach?(): void;
  onEquip(): void { this.equipped = true; }
  onUnequip(): void { this.equipped = false; this.charge = 0; }

  /** LMB. `down` is true on press, false on release. */
  onPrimary(_down: boolean): void {}
  /** RMB. */
  onSecondary(_down: boolean): void {}
  /** Called every fixed step while equipped. */
  step(dt: number, _held: { primary: boolean; secondary: boolean }): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
  }
  /** Called every fixed step even when NOT equipped, for persistent state. */
  background(_dt: number): void {}

  /** Optional HUD line under the slot, e.g. ammo or charge. */
  status(): string { return ''; }

  /** Internal state for the test harness. Never used by gameplay. */
  debugState(): Record<string, unknown> {
    return { cooldown: +this.cooldown.toFixed(3), charge: +this.charge.toFixed(3), equipped: this.equipped };
  }

  protected get game(): Game { return this.ctx.game; }
  protected get player() { return this.ctx.game.player; }

  /** Where a tool's effect originates: just in front of the eyes. */
  protected muzzle(out = new THREE.Vector3(), forward = 0.55): THREE.Vector3 {
    const p = this.player;
    p.lookDir(_d);
    return out.copy(p.eyePosition).addScaledVector(_d, forward);
  }

  protected aim(out = new THREE.Vector3()): THREE.Vector3 {
    return this.player.lookDir(out);
  }
}

const _d = new THREE.Vector3();
