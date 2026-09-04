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

  'fruit:detached': { fruitId: number; species: string; cause: string; playerId: number };
  'fruit:impact': { fruitId: number; species: string; speed: number; point: THREE.Vector3; onPlayer: boolean };
  'fruit:qualityChanged': { fruitId: number; quality: string; damage: number };
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
  'tool:fired': { toolId: string };

  'rope:attached': { ropeId: number; aId: number; bId: number };
  'rope:snapped': { ropeId: number };

  'ui:toast': { text: string; sub?: string; kind?: 'info' | 'good' | 'bad' | 'gold'; ms?: number };
  'ui:celebrate': { title: string; sub?: string; kind?: 'discovery' | 'record' | 'stunt' | 'legendary' };
  'ui:prompt': { text: string | null };

  'audio:sfx': { name: string; position?: THREE.Vector3; volume?: number; pitch?: number };

  'legendary:phase': { id: string; phase: string };
  'legendary:complete': { id: string; payout: number };
  /** The legendary body hit something hard. */
  'legendary:landed': { id: string; position: THREE.Vector3; speed: number };

  'save:written': { slot: string };
  'save:loaded': { slot: string };

  'debug:log': { text: string };
}
