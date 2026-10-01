import type { EncounterFruitContact, EncounterKind, EncounterPhase, Point3 } from './EncounterModel.ts';

export interface ThreatFruitSample {
  id: number;
  species: string;
  state: string;
  hasBody: boolean;
  stuck: boolean;
  position: Point3;
  radius: number;
  velocity: Point3;
}
export interface FruitThreatSample {
  kind: EncounterKind;
  position: Point3;
  phase: EncounterPhase;
  dormant?: boolean;
}
interface ContactLatch { fruitId: number; kind: EncounterKind; cooldown: number }
const COOLDOWN = .7;
const MAX_SPEED = 40;
const point = (p: Point3): boolean => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const centre = (p: Point3): Point3 => [p[0], p[1] + 1.15, p[2]];
const distance = (a: Point3, b: Point3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const threatRadius = (kind: EncounterKind): number => kind === 'mimic' ? 1.25 : 1.35;

/** Detects real cargo against model-owned enemies, which have no Rapier body.
 * Relative swept spheres prevent fast cannon shots and moving Mimics tunnelling.
 * A contact stays latched until separation AND cooldown, including stuck cargo. */
export class FruitThreatContacts {
  private previousFruit = new Map<number, Point3>();
  private previousThreat = new Map<EncounterKind, Point3>();
  private latched = new Map<string, ContactLatch>();

  clear(): void {
    this.previousFruit.clear(); this.previousThreat.clear(); this.latched.clear();
  }

  step(dt: number, fruits: readonly ThreatFruitSample[], threats: readonly FruitThreatSample[],
    blocked: (from: Point3, contact: Point3) => boolean): EncounterFruitContact[] {
    if (!(dt > 0) || !Number.isFinite(dt)) return [];
    const samples = fruits.filter(f => Number.isSafeInteger(f.id) && f.state === 'free'
      && f.hasBody && (f.species === 'boulderplum' || f.species === 'gluefruit')
      && point(f.position) && point(f.velocity) && Number.isFinite(f.radius) && f.radius > 0);
    const liveFruit = new Map(samples.map(f => [f.id, f]));
    const liveThreat = new Map(threats.filter(t => point(t.position)).map(t => [t.kind, t]));
    for (const [key, latch] of this.latched) {
      latch.cooldown = Math.max(0, latch.cooldown - dt);
      const f = liveFruit.get(latch.fruitId), t = liveThreat.get(latch.kind);
      if (!f || !t || (latch.cooldown === 0
        && distance(f.position, centre(t.position)) > threatRadius(t.kind) + Math.min(1.2, f.radius) + .3))
        this.latched.delete(key);
    }
    const contacts: EncounterFruitContact[] = [];
    for (const f of samples) {
      const from = this.previousFruit.get(f.id);
      this.previousFruit.set(f.id, [...f.position]);
      const speed = Math.hypot(...f.velocity);
      if (!from || f.stuck || speed < (f.species === 'boulderplum' ? 3 : 2)) continue;
      let first: { kind: EncounterKind; fraction: number; contact: Point3 } | null = null;
      for (const t of liveThreat.values()) {
        if (t.dormant || t.phase === 'defeated') continue;
        const oldCentre = centre(this.previousThreat.get(t.kind) ?? t.position);
        const currentCentre = centre(t.position);
        const relativeFrom = from.map((v, i) => v - oldCentre[i]) as Point3;
        const relativeTo = f.position.map((v, i) => v - currentCentre[i]) as Point3;
        const fraction = firstSphere(relativeFrom, relativeTo, threatRadius(t.kind) + Math.min(1.2, f.radius));
        if (fraction === null || (first && fraction >= first.fraction)) continue;
        const contact = from.map((v, i) => v + (f.position[i] - v) * fraction) as Point3;
        first = { kind: t.kind, fraction, contact };
      }
      if (!first) continue;
      const key = `${f.id}:${first.kind}`;
      if (this.latched.has(key) || blocked(from, first.contact)) continue;
      this.latched.set(key, { fruitId: f.id, kind: first.kind, cooldown: COOLDOWN });
      contacts.push({ fruitId: f.id, species: f.species as EncounterFruitContact['species'],
        kind: first.kind, point: first.contact,
        direction: f.velocity.map(v => v / speed) as Point3, speed: Math.min(MAX_SPEED, speed) });
    }
    for (const id of this.previousFruit.keys()) if (!liveFruit.has(id)) this.previousFruit.delete(id);
    for (const t of liveThreat.values()) this.previousThreat.set(t.kind, [...t.position]);
    for (const kind of this.previousThreat.keys()) if (!liveThreat.has(kind)) this.previousThreat.delete(kind);
    return contacts;
  }
}

function firstSphere(from: Point3, to: Point3, radius: number): number | null {
  const d = to.map((v, i) => v - from[i]);
  const c = from[0] ** 2 + from[1] ** 2 + from[2] ** 2 - radius ** 2;
  // Leaving the hull is separation, not a fresh strike after latch expiry.
  if (c <= 0) return to[0] ** 2 + to[1] ** 2 + to[2] ** 2 <= radius ** 2 ? 0 : null;
  const a = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  if (a < 1e-10) return null;
  const b = from[0] * d[0] + from[1] * d[1] + from[2] * d[2];
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const at = (-b - Math.sqrt(disc)) / a;
  return at >= 0 && at <= 1 ? at : null;
}
