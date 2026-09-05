/**
 * What a fruit does to your hands, and to your screen.
 *
 * Two different questions get answered here and they must not be confused:
 *
 *  1. CAN this be carried in hands at all? That is a rule about the WORLD. A
 *     three-metre Puff Melon is not a pickup, it is a haulage problem, and the
 *     answer has to be the same on every client because it gates an action.
 *  2. HOW BIG may it look while carried? That is a rule about the CAMERA, and
 *     it exists because a fruit's real size and its readable screen size stop
 *     agreeing somewhere around a watermelon.
 *
 * The whole reason this file exists: presentation used to be `put the world
 * fruit 0.85 m in front of the eye and let perspective decide`. That is honest
 * and it is unusable. A 22 kg watermelon covered 62% of the frame height; an
 * inflated Puff Melon, radius 0.87 m at 0.85 m, contained the camera. So the
 * world keeps the true size — physics, collision, other players' view of you,
 * all unchanged — and the first-person view draws a PROXY whose screen size is
 * capped. Big fruit is a problem in the world, never a problem in the camera.
 */

export type CarryClass = 'small' | 'medium' | 'large' | 'oversized';

/** Every carry class except `oversized`, in ascending order. */
export const CARRYABLE: readonly CarryClass[] = ['small', 'medium', 'large'];

interface ClassRule {
  cls: CarryClass;
  /** True diameter, in metres, at or below which a fruit is in this class. */
  maxDiameter: number;
  /** True mass, in kg, at or below which a fruit is in this class. */
  maxMass: number;
}

/**
 * Both gates apply: a fruit is in the first class that can take its size AND
 * its weight. A Huge Coconut is only 0.65 m across but weighs 58 kg, and it
 * should read as a two-handed haul, not as something you toss one-handed.
 *
 * Measured against the actual content:
 *   apple 0.34/1.1, orange 0.32/1.0, coconut 0.40/3.4        -> small
 *   vinebomb 0.48/3.6, puff 0.56/1.9, banana 0.62/2.6        -> medium
 *   watermelon 0.80/22, huge coconut 0.65/58                 -> large
 *   inflated puff 1.74, huge watermelon 1.30/374, ancient *  -> oversized
 */
const RULES: readonly ClassRule[] = [
  { cls: 'small', maxDiameter: 0.46, maxMass: 4.5 },
  { cls: 'medium', maxDiameter: 0.72, maxMass: 12 },
  { cls: 'large', maxDiameter: 1.10, maxMass: 60 },
];

/** The largest thing two hands will close around. */
export const MAX_CARRY_DIAMETER = RULES[RULES.length - 1].maxDiameter;
/** The heaviest thing a person will lift off the ground unaided. */
export const MAX_CARRY_MASS = RULES[RULES.length - 1].maxMass;

/**
 * Basket limits live here rather than on the basket, because in a co-op session
 * the HOST enforces them for every player and it must use the same two numbers
 * the client used to decide what to ask for. A host that disagreed with the
 * client about "will this fit" would deny a stow the client had already
 * predicted, which is a visible pop for a rule nobody was breaking.
 */
export const BASKET_CAPACITY = 9;
/** Heaviest single fruit the basket will take, in kg. Above this: both hands. */
export const BASKET_MAX_ITEM_MASS = 6.5;
/** The same two numbers after the Deep Basket upgrade. Named here so the shop
 *  that grants it and the host ledger that enforces it read one source. */
export const DEEP_BASKET_CAPACITY = 16;
export const DEEP_BASKET_MAX_ITEM_MASS = 11;

export function carryClassFor(diameter: number, mass: number): CarryClass {
  for (const r of RULES) {
    if (diameter <= r.maxDiameter && mass <= r.maxMass) return r.cls;
  }
  return 'oversized';
}

export function canHandCarry(diameter: number, mass: number): boolean {
  return carryClassFor(diameter, mass) !== 'oversized';
}

/** Why a pickup was refused, in words a toast can use. */
export function refusalReason(diameter: number, mass: number): string {
  if (mass > MAX_CARRY_MASS && diameter > MAX_CARRY_DIAMETER) return 'far too big and far too heavy';
  if (mass > MAX_CARRY_MASS) return `${Math.round(mass)} kg — you cannot lift that`;
  return `${diameter.toFixed(1)} m across — you cannot get your arms round it`;
}

// ---------------------------------------------------------------------------
// framing
// ---------------------------------------------------------------------------

export interface CarryFraming {
  /** Distance from the eye at which the proxy is drawn, in metres. */
  distance: number;
  /**
   * Lateral offset as a fraction of the visible half-width at `distance`.
   * Small fruit sits off to the right the way a tool does; a two-handed haul
   * is centred, because that is where both arms can reach.
   */
  lateral: number;
  /**
   * Where the TOP of the fruit lands, as a percentage of frame height measured
   * up from the bottom edge. The crosshair is at 50%, so everything here stays
   * comfortably under it — this single number is what keeps the forward route
   * readable no matter what you are carrying.
   */
  topPct: number;
  /** Hard cap on how much of the frame's height the fruit may occupy. */
  maxHeightPct: number;
  /** How many hands appear on the fruit. */
  hands: 1 | 2;
  /** Multiplier on carry bob and sway: heavier things move the view more. */
  heft: number;
}

const FRAMING: Record<Exclude<CarryClass, 'oversized'>, CarryFraming> = {
  // Low and to the right, one hand under it, nothing near the middle.
  small: { distance: 0.52, lateral: 0.22, topPct: 34, maxHeightPct: 25, hands: 1, heft: 1.0 },
  // Two hands, brought in toward the centre and pushed further out.
  medium: { distance: 0.58, lateral: 0.10, topPct: 37, maxHeightPct: 29, hands: 2, heft: 1.35 },
  // A haul: centred, low, further still, and it moves with you.
  large: { distance: 0.64, lateral: 0.0, topPct: 40, maxHeightPct: 33, hands: 2, heft: 1.9 },
};

export function framingFor(cls: CarryClass): CarryFraming {
  return FRAMING[cls === 'oversized' ? 'large' : cls];
}

/** Diameter the screen-size curve is calibrated against — one apple. */
const REF_DIAMETER = 0.34;
/** …and the fraction of frame height that apple gets. */
const REF_HEIGHT_PCT = 22;
/**
 * How hard real size is compressed on its way to the screen. At 1.0 a
 * watermelon is 2.4x an apple and unusable; at 0 every fruit is identical and
 * the player learns nothing from looking down. 0.35 keeps the ordering — a
 * Tiny apple, an apple, a coconut and a watermelon are visibly four different
 * sizes — inside a range the frame can hold.
 */
const SIZE_COMPRESSION = 0.35;
const MIN_HEIGHT_PCT = 13;

/**
 * How much of the frame's height a carried fruit should occupy, given its true
 * diameter. Monotone in size, capped by class, and never zero.
 */
export function screenHeightPctFor(diameter: number, cls: CarryClass): number {
  const f = framingFor(cls);
  const raw = REF_HEIGHT_PCT * Math.pow(Math.max(0.02, diameter) / REF_DIAMETER, SIZE_COMPRESSION);
  return Math.min(f.maxHeightPct, Math.max(MIN_HEIGHT_PCT, raw));
}
