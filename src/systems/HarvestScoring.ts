import type { Game, System } from '@/core/Game';
import type { Fruit } from '@/fruit/Fruit';
import type { FruitSystem } from '@/fruit/FruitSystem';
import type { RopeSystem } from '@/systems/RopeSystem';
import type { Sunpatch } from '@/world/Sunpatch';

export interface StuntDef {
  id: string;
  label: string;
  /** Added to the fruit's multiplier when earned. */
  bonus: number;
  /** Shown when the player earns it for the first time. */
  blurb: string;
}

export const STUNTS: Record<string, StuntDef> = {
  midAir: { id: 'midAir', label: 'MID-AIR HARVEST', bonus: 0.55,
    blurb: 'Caught before it ever hit the ground.' },
  perfectLanding: { id: 'perfectLanding', label: 'PERFECT LANDING', bonus: 0.45,
    blurb: 'A long fall and not a mark on it.' },
  longHaul: { id: 'longHaul', label: 'LONG HAUL', bonus: 0.40,
    blurb: 'It travelled a very long way to get here.' },
  ricochet: { id: 'ricochet', label: 'RICOCHET', bonus: 0.35,
    blurb: 'Off three things, at least.' },
  fourWayTether: { id: 'fourWayTether', label: 'FOUR-WAY TETHER', bonus: 1.10,
    blurb: 'Four ropes. Somebody planned this.' },
  zeroDamage: { id: 'zeroDamage', label: 'NOT A MARK ON IT', bonus: 0.30,
    blurb: 'Through all of that, and still Perfect.' },
  hillRunner: { id: 'hillRunner', label: 'HILL RUNNER', bonus: 0.50,
    blurb: 'You chased that a long way downhill.' },
  skyPick: { id: 'skyPick', label: 'SKY PICK', bonus: 0.35,
    blurb: 'Harvested more than eight metres above the ground.' },
  oneShot: { id: 'oneShot', label: 'ONE SHOT', bonus: 0.60,
    blurb: 'Detached and banked without ever touching the ground.' },
  chainReaction: { id: 'chainReaction', label: 'CHAIN REACTION', bonus: 0.45,
    blurb: 'Five at once. Nobody meant that.' },
  lastSecond: { id: 'lastSecond', label: 'LAST SECOND', bonus: 0.70,
    blurb: 'Another half metre and that was the sea.' },
  airFreight: { id: 'airFreight', label: 'AIR FREIGHT', bonus: 0.65,
    blurb: 'Landed straight in the drop-off. On purpose, obviously.' },
  launched: { id: 'launched', label: 'FRUIT FLIGHT', bonus: 0.50,
    blurb: 'That went further than most birds.' },
};

interface Record_ { stunts: Set<string>; multiplier: number; }

/**
 * The system that rewards doing it the stupid way.
 *
 * Stunts are evaluated from the physical record every fruit already keeps —
 * distance travelled, peak height, bounces, whether it ever touched the ground.
 * Nothing here is scripted per species, so a Vinebomb fired from an air cannon
 * into a catch net scores three bonuses without anyone writing that case.
 */
export class HarvestScoring implements System {
  readonly name = 'scoring';
  private g!: Game;
  private fruitSys!: FruitSystem;
  private ropes!: RopeSystem;
  private world!: Sunpatch;
  private records = new Map<number, Record_>();
  /** Recent detach times, for chain-reaction detection. */
  private recentDetaches: number[] = [];
  /** Stunts the player has ever earned, for first-time celebrations. */
  seen = new Set<string>();
  totalAwarded = 0;
  bestMultiplier = 1;

  init(g: Game): void {
    this.g = g;
    this.fruitSys = g.get<FruitSystem>('fruit');
    this.ropes = g.get<RopeSystem>('ropes');
    this.world = g.get<Sunpatch>('world');

    g.bus.on('stunt:candidate', (p) => {
      const f = this.fruitSys.get(p.fruitId);
      if (!f) return;
      if (p.kind === 'midAir') {
        f.caughtInAir = true;
        this.award(f, 'midAir');
        if (!f.touchedGround) this.award(f, 'oneShot');
        this.checkLastSecond(f);
      } else if (p.kind === 'netLanding') {
        this.award(f, 'perfectLanding');
      }
    });

    g.bus.on('fruit:detached', (p) => {
      const f = this.fruitSys.get(p.fruitId);
      if (!f) return;
      // Elevation is geography, not a stunt: an ordinary apple on the hill
      // farm should score exactly like an ordinary apple beside the dock.
      // Measure the fruit's release above its local ground (or the sea),
      // keeping tall-palm and other elevated tool harvests eligible.
      const release = f.detachPosition;
      const ground = Math.max(0, this.world.terrain.height(release.x, release.z));
      if (release.y - ground > 8) this.award(f, 'skyPick');
      // "Five at once. Nobody meant that." — so a chain reaction is something
      // you caused INDIRECTLY. Counting hand picks made a methodical player
      // filling a basket off one tree score it every time, which is the same
      // reward spam as awarding ZERO DAMAGE for reaching up and taking an
      // apple. A shake, a blast or a rope pull still counts.
      if (p.cause === 'hand') return;
      const now = g.clock.elapsed;
      this.recentDetaches.push(now);
      while (this.recentDetaches.length && now - this.recentDetaches[0] > 3.2) {
        this.recentDetaches.shift();
      }
      if (this.recentDetaches.length >= 5) {
        this.award(f, 'chainReaction');
        g.bus.emit('stunt:chain', { count: this.recentDetaches.length, total: this.recentDetaches.length });
        this.recentDetaches.length = 0;
      }
    });

    g.bus.on('vinebomb:launch', (p) => {
      const f = this.fruitSys.get(p.fruitId);
      if (f && p.speed > 11) this.award(f, 'launched');
    });

    // Banking is where the flight record is finally judged.
    g.bus.on('fruit:stowed', (p) => {
      const f = this.fruitSys.get(p.fruitId);
      if (f) this.evaluate(f);
    });

    g.debug?.addProbe('scoring', () => ({
      tracked: this.records.size,
      totalAwarded: this.totalAwarded,
      best: +this.bestMultiplier.toFixed(2),
      seen: [...this.seen],
    }));
    g.debug?.addAction('scoring.of', (id: number) => {
      const r = this.records.get(id);
      return r ? { stunts: [...r.stunts], multiplier: +r.multiplier.toFixed(2) } : null;
    });
    g.debug?.addAction('scoring.award', (id: number, stunt: string) => {
      const f = this.fruitSys.get(id);
      if (!f) return false;
      return this.award(f, stunt);
    });
  }

  private recordFor(id: number): Record_ {
    let r = this.records.get(id);
    if (!r) { r = { stunts: new Set(), multiplier: 1 }; this.records.set(id, r); }
    return r;
  }

  /** Grant a stunt to a fruit. Returns false if it already had it. */
  award(f: Fruit, stuntId: string): boolean {
    const def = STUNTS[stuntId];
    if (!def) return false;
    const rec = this.recordFor(f.id);
    if (rec.stunts.has(stuntId)) return false;
    rec.stunts.add(stuntId);
    rec.multiplier += def.bonus;
    this.totalAwarded++;
    if (rec.multiplier > this.bestMultiplier) this.bestMultiplier = rec.multiplier;

    this.g.bus.emit('stunt:awarded', {
      name: stuntId, label: def.label, multiplier: rec.multiplier, fruitId: f.id,
    });
    // Stack the fanfare. Each stunt on the same run comes in a step higher, so
    // a fruit that earns four of them on one flight arpeggiates instead of
    // playing the same three notes four times.
    this.g.bus.emit('audio:sfx', {
      name: 'stunt', volume: 0.55 + Math.min(3, rec.stunts.size - 1) * 0.1,
      pitch: 1 + Math.min(4, rec.stunts.size - 1) * 0.14,
    });
    if (!this.seen.has(stuntId)) {
      this.seen.add(stuntId);
      this.g.bus.emit('ui:toast', { text: def.label, sub: def.blurb, kind: 'gold', ms: 3400 });
    }
    return true;
  }

  /** Judge everything that can only be known once the fruit is safely banked. */
  evaluate(f: Fruit): void {
    if (f.detachedAt < 0) return;
    const drop = Math.max(0, f.peakHeight - f.position.y);

    if (f.travelled > 42) this.award(f, 'longHaul');
    if (f.travelled > 34 && f.hasTrait('roller')) this.award(f, 'hillRunner');
    if (f.bounces >= 3) this.award(f, 'ricochet');
    if (!f.touchedGround && f.airborneTime > 0.5) this.award(f, 'oneShot');
    if (drop > 14 && f.damage <= 0.001) this.award(f, 'perfectLanding');
    // Undamaged is only an achievement if the fruit was ever in danger.
    // Unconditionally, this fired on every hand-picked apple in the game —
    // a stunt chip and a fanfare for reaching up and taking hold of
    // something, which is what taught players to ignore stunt chips.
    if (f.damage <= 0.001 && this.wasAtRisk(f, drop)) this.award(f, 'zeroDamage');
    if (f.maxSpeedSinceDetach > 24) this.award(f, 'launched');
    if (this.ropes.attachedTo(f.id).length >= 4) this.award(f, 'fourWayTether');
  }

  /**
   * Did this fruit actually go through anything on the way to the basket?
   *
   * Tuned against the ordinary case rather than in the abstract: a tree shake
   * drops fruit four to six metres at nine or ten metres a second and bounces
   * it once or twice, and that is the most routine thing in the game. The
   * bars sit above it, so surviving a shake is normal and surviving a fall
   * off a palm or a ride on an air cannon is worth saying out loud.
   */
  private wasAtRisk(f: Fruit, drop: number): boolean {
    return f.caughtInAir || f.bounces >= 3 || drop > 6.5
      || f.maxSpeedSinceDetach > 13 || f.travelled > 16;
  }

  /** Awarded for a catch made barely above the ground or the sea. */
  private checkLastSecond(f: Fruit): void {
    const ground = this.world.terrain.height(f.position.x, f.position.z);
    const clearance = f.position.y - Math.max(0, ground);
    if (clearance < 2.6 && f.maxSpeedSinceDetach > 9) this.award(f, 'lastSecond');
  }

  /** Called when a fruit lands inside the sell pad without being carried. */
  awardDelivery(f: Fruit): void {
    if (!f.touchedGround || f.bounces <= 2) this.award(f, 'airFreight');
    this.evaluate(f);
  }

  /** The value multiplier this fruit has earned. Used by Economy at sale time. */
  multiplierFor(f: Fruit): number {
    this.evaluate(f);
    return this.records.get(f.id)?.multiplier ?? 1;
  }

  stuntsFor(f: Fruit): string[] {
    const r = this.records.get(f.id);
    return r ? [...r.stunts] : [];
  }

  forget(id: number): void { this.records.delete(id); }

  fixedStep(): void {
    // Records for fruit that no longer exists would leak over a long session.
    if (this.records.size < 256) return;
    for (const id of this.records.keys()) {
      if (!this.fruitSys.get(id)) this.records.delete(id);
    }
  }

  serialize(): { seen: string[]; best: number; total: number } {
    return { seen: [...this.seen], best: this.bestMultiplier, total: this.totalAwarded };
  }
  deserialize(d: { seen?: string[]; best?: number; total?: number }): void {
    this.seen = new Set(d.seen ?? []);
    this.bestMultiplier = d.best ?? 1;
    this.totalAwarded = d.total ?? 0;
  }
}
