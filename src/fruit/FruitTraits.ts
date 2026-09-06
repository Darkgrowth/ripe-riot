import * as THREE from 'three';
import type { Fruit } from './Fruit';

/**
 * A trait is a small bundle of physical behaviour that can be attached to any
 * species. New fruit should be "config + traits", never a new subclass.
 */
export interface TraitContext {
  wind: THREE.Vector3;
  dt: number;
  /** Emit a game event without traits needing a reference to the bus. */
  emit(name: string, payload: Record<string, unknown>): void;
  /** Radial impulse helper (explosions, bursts). */
  explode(center: THREE.Vector3, radius: number, strength: number): void;
  elapsed: number;
}

export interface FruitTrait {
  readonly id: string;
  /** Multiply the base mass. Applied once at spawn. */
  massMul?(f: Fruit): number;
  /** Fires when the fruit leaves its plant. */
  onDetach?(f: Fruit, ctx: TraitContext): void;
  /** Every fixed step while the fruit is free or carried. */
  onStep?(f: Fruit, ctx: TraitContext): void;
  /** Fires on any registered contact. `dv` is the impulse divided by mass. */
  onImpact?(f: Fruit, dv: number, point: THREE.Vector3, normal: THREE.Vector3, ctx: TraitContext): void;
  /** Fires when picked up by hand. */
  onCarry?(f: Fruit, ctx: TraitContext): void;
}

// ---------------------------------------------------------------------------

/** Marker: this thing hurts. Damage and carry weight come from mass already. */
const heavy: FruitTrait = { id: 'heavy' };

/** Marker used by the stunt detector for hill-running bonuses. */
const roller: FruitTrait = { id: 'roller' };

/**
 * Watermelon. Above a hard enough impact it stops being a watermelon.
 */
const splitter: FruitTrait = {
  id: 'splitter',
  onImpact(f, dv, point, _n, ctx) {
    if (f.destroyed) return;
    // dv is a real velocity change in m/s, so this reads as "hit the ground at
    // more than ~20 m/s", i.e. a fall of about nine metres. Big fruit survives
    // proportionally less; a Huge melon still bursts.
    const limit = 21 / (1 + f.sizeScale * 0.3);
    if (dv > limit) {
      f.damage = 1;
      f.burst(point, ctx);
    }
  },
};

/**
 * Puff Melon. On release it inflates: same mass spread over a much larger
 * volume, so drag dominates and any wind at all takes it away.
 */
const inflate: FruitTrait = {
  id: 'inflate',
  onDetach(f) {
    f.inflating = true;
    f.inflateTarget = 3.1;
    f.setDrag(2.6, 3.2);
  },
  onStep(f, ctx) {
    if (f.inflating) {
      // "Inflates the moment it comes free" — at the old rate it took most of
      // two seconds, by which time it had already fallen half its escape.
      const rate = f.hasTrait('unstable') ? 6.5 : 3.2;
      const next = Math.min(f.inflateTarget, f.inflate + rate * ctx.dt);
      if (next !== f.inflate) f.setInflation(next);
    }

    // Everything below used to sit behind `if (!f.inflating) return`, and
    // `setInflation` clears `inflating` the instant the fruit reaches full
    // size — so drag, wind and buoyancy all switched off at the exact moment
    // the fruit became a balloon. The species is named for its wind
    // behaviour and it had none: what looked like flight was a stale force
    // left in Rapier's accumulator by the code that had stopped running.
    if (!f.body || f.state !== 'free' || f.inflate <= 1.001) return;
    // Drag against the wind, scaled by frontal area. This is what makes a Puff
    // Melon a chase rather than a pickup.
    //
    // Applied as impulses (force x dt) rather than `addForce`: Rapier's force
    // accumulator persists until it is explicitly reset, so adding a force
    // every step piles them up and the numbers written here stop meaning what
    // they say. An impulse is exactly one step's worth, every time.
    const area = f.radius * f.radius * Math.PI;
    const v = f.body.linvel();
    _rel.set(ctx.wind.x - v.x, ctx.wind.y * 0.35 - v.y, ctx.wind.z - v.z);
    const speed = _rel.length();
    if (speed > 0.01) {
      const dragK = 0.62 * area * speed * ctx.dt;
      _rel.multiplyScalar(dragK);
      f.body.applyImpulse({ x: _rel.x, y: _rel.y, z: _rel.z }, true);
    }
    // Buoyancy, and the shape of it is the whole fruit.
    //
    // Measured on the old constant: a released Puff Melon climbed steadily and
    // never came back down, so "chasing it" meant watching it leave. It now
    // overshoots hard while it inflates — the escape, which is the joke — then
    // bleeds off to a little heavier than air and sinks at about two metres a
    // second: low enough to run under with a net, while the wind drags it
    // across the island.
    //
    // Lift is expressed in GRAVITIES so the arc survives a change to world
    // gravity, which is -22 here rather than -9.81.
    const fill = (f.inflate - 1) / (f.inflateTarget - 1);
    const age = ctx.elapsed - f.detachedAt;
    const buoyancy = age < ESCAPE_TIME
      ? ESCAPE_LIFT
      : Math.max(SETTLED_LIFT, ESCAPE_LIFT - (age - ESCAPE_TIME) * LIFT_DECAY);
    const g = Math.abs(f.gravity);
    f.body.applyImpulse({ x: 0, y: fill * buoyancy * f.mass * g * ctx.dt, z: 0 }, true);
  },
};

/** Gravities of lift while a Puff Melon is making its escape. */
const ESCAPE_LIFT = 2.4;
/** …and once it has settled: under 1, so it comes down. */
const SETTLED_LIFT = 0.86;
/** Seconds of escape before the lift starts bleeding away. */
const ESCAPE_TIME = 1.5;
/** Gravities of lift lost per second after that. */
const LIFT_DECAY = 0.9;

/**
 * Vinebomb. While attached, the vine stores tension; releasing it without
 * restraint converts that straight into a launch.
 */
const elastic: FruitTrait = {
  id: 'elastic',
  onDetach(f, ctx) {
    const t = f.tension;
    if (!f.body || t <= 0) return;
    // Restraints (ropes, nets, a hand on it) bleed off the stored energy.
    const released = t * (1 - Math.min(0.92, f.restraint));
    _imp.copy(f.tensionDir).multiplyScalar(released * f.mass);
    f.body.applyImpulse({ x: _imp.x, y: _imp.y, z: _imp.z }, true);
    f.body.applyTorqueImpulse({ x: released * 0.05, y: released * 0.03, z: 0 }, true);
    // A catapult letting go should sound and feel like one. Pitch rides the
    // release, so a restrained vine twangs low and a free one cracks.
    ctx.emit('audio:sfx', {
      name: 'ropeSnap', position: f.position.clone(),
      volume: 0.4 + Math.min(0.6, released / 22),
      pitch: 0.75 + Math.min(0.8, released / 26),
    });
    ctx.emit('vinebomb:launch', { fruitId: f.id, speed: released, restrained: f.restraint });
  },
};

/**
 * Unstable variant. Expands fast and shrugs off small impulses at random, which
 * is exactly as helpful as it sounds.
 */
const unstable: FruitTrait = {
  id: 'unstable',
  onDetach(f) {
    f.inflating = true;
    f.inflateTarget = Math.max(f.inflateTarget, 2.2);
  },
  onStep(f, ctx) {
    if (f.state !== 'free' || !f.body) return;
    f.jitterTimer -= ctx.dt;
    if (f.jitterTimer <= 0) {
      f.jitterTimer = 0.55 + Math.random() * 0.9;
      const s = f.mass * (1.4 + Math.random() * 2.6);
      f.body.applyImpulse({
        x: (Math.random() - 0.5) * s,
        y: Math.random() * s * 0.85,
        z: (Math.random() - 0.5) * s,
      }, true);
    }
  },
};

/** Volatile fruit: hard hits destabilise it, then it goes off. */
const volatile: FruitTrait = {
  id: 'volatile',
  onImpact(f, dv, point, _n, ctx) {
    if (f.destroyed) return;
    f.charge = Math.min(1, f.charge + Math.max(0, dv - 7) * 0.09);
    if (f.charge >= 1) {
      ctx.explode(point, 6.5 * f.sizeScale, 9.5 * f.sizeScale);
      ctx.emit('audio:sfx', { name: 'boom', position: point });
      f.burst(point, ctx);
    }
  },
};

/**
 * Gluefruit. Adheres to whatever it lands on — ground, cliff, tree, sell pad —
 * and to whoever it lands on. The surface half is here: on the first real
 * impact with the world the body goes fixed where it is. The hands half lives
 * in the interaction layer, because "you are holding it now, whether you like
 * it or not" is a rule about hands rather than about the fruit.
 */
const sticky: FruitTrait = {
  id: 'sticky',
  onImpact(f, dv, point, _n, ctx) {
    if (f.stuck || f.lastImpactOnPlayer || dv < 1.6 || !f.body) return;
    f.stick();
    ctx.emit('audio:sfx', { name: 'netCatch', position: point.clone(), volume: 0.35, pitch: 0.6 });
  },
};

/** Seconds a gluefruit that lands on you refuses to leave your hands. */
export const STICK_HANDS_HIT = 4.0;
/** …and one you picked up on purpose. You knew what it was. */
export const STICK_HANDS_PICK = 1.6;

/**
 * Spikefruit. Nothing here moves: the whole identity is a rule about hands —
 * they cannot touch it — and the interaction layer owns that. The marker is
 * what the rule keys on, and what the host checks a client's pick against.
 */
const spiked: FruitTrait = { id: 'spiked' };

const REGISTRY = new Map<string, FruitTrait>();
for (const t of [heavy, roller, splitter, inflate, elastic, unstable, volatile, sticky, spiked]) {
  REGISTRY.set(t.id, t);
}

export function traitsFor(ids: readonly string[]): FruitTrait[] {
  const out: FruitTrait[] = [];
  for (const id of ids) {
    const t = REGISTRY.get(id);
    if (t) out.push(t);
  }
  return out;
}

export function registerTrait(t: FruitTrait): void { REGISTRY.set(t.id, t); }

const _rel = new THREE.Vector3();
const _imp = new THREE.Vector3();
