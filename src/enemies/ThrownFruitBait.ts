import type { Point3 } from './EncounterModel';

interface Flight { fruitId: number; actorId: string; previous: Point3; age: number; }
export interface BaitFruit { position: Point3; speed: number; state: string; }
const LIFETIME = 3;
const RANGE = 5.25;
const MIN_SPEED = 2.2;

/** Only accepted carried-to-free throws may arm this host-side tracker.
 * No collision body or fruit state is changed: the bait remains harvestable. */
export class ThrownFruitBait {
  private flights = new Map<number, Flight>();
  get size(): number { return this.flights.size; }
  clear(): void { this.flights.clear(); }
  disarm(fruitId: number): void { this.flights.delete(fruitId); }

  arm(fruitId: number, actorId: string, position: Point3): void {
    if (!Number.isInteger(fruitId) || !actorId || !position.every(Number.isFinite)) return;
    // Bounded even if a modded client releases its whole inventory at once.
    if (this.flights.size >= 64) this.flights.delete(this.flights.keys().next().value!);
    this.flights.set(fruitId, { fruitId, actorId, previous: [...position], age: 0 });
  }

  step(dt: number, lookup: (id: number) => BaitFruit | null, jaw: Point3,
    blocked: (from: Point3, to: Point3) => boolean,
    offer: (flight: Readonly<Flight>, position: Point3) => boolean): void {
    for (const [id, flight] of this.flights) {
      flight.age += dt;
      const fruit = lookup(id);
      if (!fruit || fruit.state !== 'free' || flight.age > LIFETIME
        || !fruit.position.every(Number.isFinite) || !Number.isFinite(fruit.speed)
        || fruit.speed < MIN_SPEED) { this.flights.delete(id); continue; }
      const from = flight.previous, to = fruit.position;
      flight.previous = [...to];
      const dx = to[0] - from[0], dz = to[2] - from[2];
      const lengthSq = dx * dx + dz * dz;
      const projection = lengthSq > 1e-8
        ? ((jaw[0] - from[0]) * dx + (jaw[2] - from[2]) * dz) / lengthSq : 0;
      const nearest = Math.max(0, Math.min(1, projection));
      const nx = from[0] + dx * nearest - jaw[0], nz = from[2] + dz * nearest - jaw[2];
      const distanceSq = nx * nx + nz * nz;
      if (distanceSq > RANGE * RANGE) continue;
      // First entry, rather than the segment centre: a fruit crossing the jaw
      // in one tick still turns it toward the side where the distraction came from.
      const lx = from[0] + dx * projection - jaw[0], lz = from[2] + dz * projection - jaw[2];
      const entry = lengthSq > 1e-8 ? Math.max(0, projection
        - Math.sqrt(Math.max(0, RANGE * RANGE - lx * lx - lz * lz) / lengthSq)) : 0;
      const at: Point3 = [from[0] + dx * entry, from[1] + (to[1] - from[1]) * entry,
        from[2] + dz * entry];
      if (at[1] < jaw[1] - .2 || at[1] > jaw[1] + 3.5) continue;
      // One encounter opportunity per flight, including occluded/closed jaws.
      // Resting fruit cannot repeatedly reset warning or manufacture stunts.
      this.flights.delete(id);
      if (!blocked(at, [jaw[0], jaw[1] + 1.25, jaw[2]])) offer(flight, at);
    }
  }
}
