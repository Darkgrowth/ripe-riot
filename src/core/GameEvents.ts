import type * as THREE from 'three';

/** Payload shapes for the global bus. Keep these small and serialisable —
 *  the multiplayer layer replicates several of them verbatim. */
export interface GameEventMap {
  'world:ready': { seed: number };

  'player:ragdoll': { playerId: number; speed: number; source: string };
  'player:recovered': { playerId: number };
  'player:downed': { playerId: number };
  'player:revived': { playerId: number; byId: number };
  'player:landed': { playerId: number; speed: number };
  /** Something hit the player hard enough to notice but not to flatten them. */
  'player:hit': { momentum: number; fromAbove: boolean; point: THREE.Vector3 };

  'fruit:detached': { fruitId: number; species: string; cause: string; playerId: number };
  /** Something loose was taken into the hands. `mass` drives the feedback. */
  'fruit:grabbed': { fruitId: number; species: string; mass: number; heavy: boolean };
  /** Host ledger accepted a remote pickup; does not impersonate local hand feedback. */
  'fruit:claimed': { fruitId: number };
  /** A predicted net pickup has been accepted or rejected by the host. */
  'net:pickResult': { fruitId: number; ok: boolean };
  'fruit:impact': { fruitId: number; species: string; speed: number; point: THREE.Vector3; onPlayer: boolean };
  'fruit:qualityChanged': {
    fruitId: number; quality: string; damage: number;
    displayName: string; lost: number;
  };
  'fruit:destroyed': { fruitId: number; species: string; value: number };
  'fruit:stowed': { fruitId: number; species: string };
  'fruit:sold': { fruitId: number; species: string; value: number; quality: string; mass: number };
  'fruit:spawned': { fruitId: number; species: string };
  /** A plant was shaken hard enough to notice; position is the base, height the canopy top. */
  'plant:shaken': { plantId: number; position: THREE.Vector3; height: number; strength: number };

  /** Raised by tools when something stunt-worthy might have happened; the
   *  scoring system decides whether it actually counts. */
  'stunt:candidate': { fruitId: number; kind: string };
  'stunt:awarded': { name: string; label: string; multiplier: number; fruitId: number };
  'stunt:chain': { count: number; total: number };
  'vinebomb:launch': { fruitId: number; speed: number; restrained: number };

  'money:changed': { money: number; delta: number; reason: string };
  'shop:purchased': { itemId: string; cost: number };
  'shop:opened': Record<string, never>;
  'shop:closed': Record<string, never>;

  'book:discovered': { species: string; variant: string | null };
  'book:record': { species: string; field: string; value: number };

  'tool:equipped': { slot: number; toolId: string };
  /** A tool did its thing. `power` (0..2, default 1) scales the arms' reaction,
   *  so a tap of the shaker and a full-charge cannon do not kick alike. */
  'tool:fired': { toolId: string; power?: number };
  /** A tool swept through an arc: the viewmodel follows it for `duration` seconds. */
  'tool:swing': { toolId: string; duration: number };
  /** A tool put energy into a POINT IN THE WORLD. Separate from tool:fired,
   *  which is about the hands: this is what the blast looked like. */
  'tool:blast': { toolId: string; point: THREE.Vector3; power: number; radius: number };

  'rope:attached': { ropeId: number; aId: number; bId: number };
  'rope:snapped': { ropeId: number };
  /** A rope crossed from slack into load, or back. `tension` is in newtons. */
  'rope:taut': { ropeId: number; taut: boolean; tension: number };
  /** A rope moved the player this step. `speed` is the velocity change, m/s. */
  'rope:tug': { ropeId: number; speed: number };

  'ui:toast': { text: string; sub?: string; kind?: 'info' | 'good' | 'bad' | 'gold'; ms?: number };
  'ui:celebrate': { title: string; sub?: string; kind?: 'discovery' | 'record' | 'stunt' | 'legendary' };
  'ui:prompt': { text: string | null; priority?: 'hint' | 'context' | 'action' };

  'audio:sfx': { name: string; position?: THREE.Vector3; volume?: number; pitch?: number };
  'island:event': { id: number; kind: 'windfall' | 'coconuts' | 'order';
    phase: 'idle' | 'warning' | 'active' | 'result'; result: string };

  'legendary:phase': { id: string; phase: string };
  'legendary:complete': { id: string; payout: number };
  /** The legendary body hit something hard. */
  'legendary:landed': { id: string; position: THREE.Vector3; speed: number };

  'save:written': { slot: string };
  'save:loaded': { slot: string };

  'debug:log': { text: string };
}
