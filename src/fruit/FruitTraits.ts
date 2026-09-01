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
    // Big fruit survives proportionally less; a Huge melon still bursts.
    const limit = 11.5 / (1 + f.sizeScale * 0.35);
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
    if (!f.inflating) return;
    const rate = f.hasTrait('unstable') ? 6.5 : 1.55;
    const next = Math.min(f.inflateTarget, f.inflate + rate * ctx.dt);
    if (next !== f.inflate) f.setInflation(next);

    if (!f.body || f.state !== 'free') return;
    // Drag against the wind, scaled by frontal area. This is what makes a Puff
    // Melon a chase rather than a pickup.
    const area = f.radius * f.radius * Math.PI;
    const v = f.body.linvel();
    _rel.set(ctx.wind.x - v.x, ctx.wind.y * 0.35 - v.y, ctx.wind.z - v.z);
    const speed = _rel.length();
    if (speed > 0.01) {
      const dragK = 0.62 * area * speed;
      _rel.multiplyScalar(dragK);
      f.body.addForce({ x: _rel.x, y: _rel.y, z: _rel.z }, true);
    }
    // Slight buoyancy once fully puffed, so it hangs rather than plummets.
    const lift = (f.inflate - 1) / (f.inflateTarget - 1);
    f.body.addForce({ x: 0, y: lift * f.mass * 17.0, z: 0 }, true);
  },
};

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
    f.charge = Math.min(1, f.charge + Math.max(0, dv - 4) * 0.14);
    if (f.charge >= 1) {
      ctx.explode(point, 6.5 * f.sizeScale, 9.5 * f.sizeScale);
      ctx.emit('audio:sfx', { name: 'boom', position: point });
      f.burst(point, ctx);
    }
  },
};

/** Sticky fruit adheres to whatever it lands on. Placeholder physics for now. */
const sticky: FruitTrait = {
  id: 'sticky',
  onImpact(f, dv) {
    if (dv > 1.2 && f.body) {
      f.body.setLinearDamping(6.0);
      f.body.setAngularDamping(6.0);
      f.stuck = true;
    }
  },
};

const REGISTRY = new Map<string, FruitTrait>();
for (const t of [heavy, roller, splitter, inflate, elastic, unstable, volatile, sticky]) {
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
