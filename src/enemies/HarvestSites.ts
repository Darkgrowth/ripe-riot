import type { EncounterKind, Point3 } from './EncounterModel';

export interface HarvestSiteDefinition {
  id: string; kind: EncounterKind; plantId: number; fruitIds: number[]; position: Point3;
}
export type HarvestSitePhase = 'quiet' | 'warning' | 'active' | 'cleared';
export interface HarvestSiteState extends HarvestSiteDefinition {
  phase: HarvestSitePhase; released: number[]; consumed: number[];
}
interface Disturbance { allow: boolean; changed: boolean; phase?: HarvestSitePhase; activate: boolean; }

/** Three authored identities, not a scheduler. No reward or physics mutation lives here. */
export class HarvestSites {
  private states: HarvestSiteState[];
  private warnedAt = new Map<string, number>();
  constructor(definitions: HarvestSiteDefinition[]) {
    this.states = definitions.map(d => ({ ...d, fruitIds: [...d.fruitIds], position: [...d.position],
      phase: d.kind === 'mimic' ? 'quiet' : 'active', released: [], consumed: [] }));
  }
  atPlant(plantId: number): HarvestSiteState | undefined { return this.states.find(s => s.plantId === plantId); }
  atFruit(fruitId: number): HarvestSiteState | undefined { return this.states.find(s => s.fruitIds.includes(fruitId)); }
  disturb(plantId: number, now: number): Disturbance {
    const site = this.atPlant(plantId);
    if (!site || site.kind !== 'mimic' || site.phase === 'cleared' || site.phase === 'active')
      return { allow: true, changed: false, activate: false };
    if (site.phase === 'quiet') {
      site.phase = 'warning'; this.warnedAt.set(site.id, now);
      return { allow: false, changed: true, phase: 'warning', activate: false };
    }
    // All nodes and all impulses of one blast share this beat. Holding E does
    // not produce another action; a separate press after the warning can.
    if (now - (this.warnedAt.get(site.id) ?? -Infinity) < .65)
      return { allow: false, changed: false, activate: false };
    site.phase = 'active';
    return { allow: true, changed: true, phase: 'active', activate: true };
  }
  release(fruitId: number): void {
    const s = this.atFruit(fruitId);
    if (s && !s.released.includes(fruitId)) s.released.push(fruitId);
  }
  consume(fruitId: number): void {
    const s = this.atFruit(fruitId);
    if (s && !s.consumed.includes(fruitId)) { this.release(fruitId); s.consumed.push(fruitId); }
  }
  clear(kind: EncounterKind): void {
    for (const s of this.states) if (s.kind === kind) s.phase = 'cleared';
  }
  snapshot(): HarvestSiteState[] {
    return this.states.map(s => ({ ...s, position: [...s.position], fruitIds: [...s.fruitIds],
      released: [...s.released], consumed: [...s.consumed] }));
  }
  apply(raw: unknown): void {
    if (!Array.isArray(raw)) return;
    for (const value of raw) {
      if (!value || typeof value !== 'object') continue;
      const s = this.states.find(s => s.id === value.id);
      if (!s || !['quiet', 'warning', 'active', 'cleared'].includes(value.phase)) continue;
      if (s.kind !== 'mimic' && ['quiet', 'warning'].includes(value.phase)) continue;
      s.phase = value.phase;
      s.released = Array.isArray(value.released) ? s.fruitIds.filter(id => value.released.includes(id)) : [];
      s.consumed = Array.isArray(value.consumed) ? s.fruitIds.filter(id => value.consumed.includes(id)) : [];
      for (const id of s.consumed) if (!s.released.includes(id)) s.released.push(id);
    }
    this.warnedAt.clear();
  }
}
