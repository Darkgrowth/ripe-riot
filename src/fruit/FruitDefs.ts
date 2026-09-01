import * as THREE from 'three';

/**
 * All fruit is data. Adding a species should mean adding an entry here plus, at
 * most, one reusable trait — never a new code path through the game.
 */
export interface FruitDef {
  id: string;
  label: string;
  /** Base diameter in metres. Everything scales from this. */
  size: number;
  /** Fractional natural size variation, e.g. 0.14 = +/-14%. */
  sizeVar: number;
  /** kg at base size; actual mass scales with volume. */
  mass: number;
  /** 0 = indestructible, 1 = looking at it wrong ruins it. */
  fragility: number;
  /** Impulse (N.s) needed to tear it off its stem. */
  attachStrength: number;
  /** Money at Good quality, base size, no variant. */
  baseValue: number;
  /** Relative spawn weight within a habitat. */
  weight: number;
  traits: string[];
  /** Landmark ids where this species grows. */
  habitat: string[];
  /** How many grow per plant, on average. */
  perPlant: [number, number];
  restitution: number;
  friction: number;
  linearDamping: number;
  angularDamping: number;
  /** Impact speed (m/s) above which a hit player ragdolls. */
  dangerous: boolean;
  hint: string;
  flavour: string;
  /** Which plant type carries it. */
  plant: 'appleTree' | 'orangeTree' | 'palm' | 'bananaPlant' | 'melonVine' | 'puffBush' | 'vinebombVine';
}

export const FRUIT: Record<string, FruitDef> = {
  apple: {
    id: 'apple', label: 'Apple', size: 0.34, sizeVar: 0.16, mass: 1.1,
    fragility: 0.35, attachStrength: 1.1, baseValue: 12, weight: 100,
    traits: [], habitat: ['orchard', 'hillFarm'], perPlant: [4, 7],
    restitution: 0.24, friction: 0.7, linearDamping: 0.06, angularDamping: 0.35,
    dangerous: false, plant: 'appleTree',
    hint: 'Grows in the old orchard. Falls if you look at it firmly.',
    flavour: 'The one everybody starts with. Nobody respects it.',
  },
  orange: {
    id: 'orange', label: 'Orange', size: 0.32, sizeVar: 0.14, mass: 1.0,
    fragility: 0.3, attachStrength: 1.35, baseValue: 15, weight: 70,
    traits: ['roller'], habitat: ['orchard', 'hillFarm'], perPlant: [4, 8],
    restitution: 0.32, friction: 0.32, linearDamping: 0.03, angularDamping: 0.1,
    dangerous: false, plant: 'orangeTree',
    hint: 'Round. Extremely round. Do not drop it on a hill.',
    flavour: 'Rolls with a determination that borders on malice.',
  },
  coconut: {
    id: 'coconut', label: 'Coconut', size: 0.40, sizeVar: 0.13, mass: 3.4,
    fragility: 0.08, attachStrength: 4.2, baseValue: 34, weight: 100,
    traits: ['heavy'], habitat: ['palmBeach', 'caveOrchard'], perPlant: [3, 6],
    restitution: 0.14, friction: 0.75, linearDamping: 0.05, angularDamping: 0.4,
    dangerous: true, plant: 'palm',
    hint: 'High up a palm. Gravity does most of the harvesting.',
    flavour: 'Weighs as much as a small argument.',
  },
  banana: {
    id: 'banana', label: 'Banana Bunch', size: 0.62, sizeVar: 0.18, mass: 2.6,
    fragility: 0.5, attachStrength: 2.4, baseValue: 26, weight: 55,
    traits: [], habitat: ['palmBeach', 'waterfall'], perPlant: [2, 3],
    restitution: 0.1, friction: 0.55, linearDamping: 0.08, angularDamping: 0.5,
    dangerous: false, plant: 'bananaPlant',
    hint: 'Long, awkward, and never fits anywhere sensibly.',
    flavour: 'Five problems in a trench coat.',
  },
  watermelon: {
    id: 'watermelon', label: 'Watermelon', size: 0.80, sizeVar: 0.2, mass: 22,
    fragility: 0.85, attachStrength: 5.5, baseValue: 105, weight: 40,
    traits: ['heavy', 'splitter'], habitat: ['hillFarm', 'orchard'], perPlant: [1, 2],
    restitution: 0.05, friction: 0.8, linearDamping: 0.08, angularDamping: 0.6,
    dangerous: true, plant: 'melonVine',
    hint: 'Heavy and fragile at the same time, which is deeply unfair.',
    flavour: 'Detaching it is the easy half.',
  },
  puffmelon: {
    id: 'puffmelon', label: 'Puff Melon', size: 0.56, sizeVar: 0.15, mass: 1.9,
    fragility: 0.45, attachStrength: 2.0, baseValue: 130, weight: 26,
    traits: ['inflate'], habitat: ['waterfall', 'hillFarm', 'ridge'], perPlant: [2, 3],
    restitution: 0.42, friction: 0.4, linearDamping: 0.5, angularDamping: 0.8,
    dangerous: false, plant: 'puffBush',
    hint: 'Inflates the moment it comes free. Then the wind gets involved.',
    flavour: 'The only fruit that harvests YOU.',
  },
  vinebomb: {
    id: 'vinebomb', label: 'Vinebomb', size: 0.48, sizeVar: 0.14, mass: 3.6,
    fragility: 0.4, attachStrength: 7.5, baseValue: 165, weight: 18,
    traits: ['elastic'], habitat: ['waterfall', 'ravine', 'caveOrchard'], perPlant: [1, 2],
    restitution: 0.5, friction: 0.45, linearDamping: 0.04, angularDamping: 0.3,
    dangerous: true, plant: 'vinebombVine',
    hint: 'The vine is under tension. Release it wrong and it leaves the island.',
    flavour: 'Technically a catapult that grows on a cliff.',
  },
};

export const FRUIT_IDS = Object.keys(FRUIT);

// ---------------------------------------------------------------------------
// quality
// ---------------------------------------------------------------------------
export type QualityTier = 'Perfect' | 'Good' | 'Bruised' | 'Damaged' | 'Ruined';

export const QUALITY_ORDER: QualityTier[] = ['Perfect', 'Good', 'Bruised', 'Damaged', 'Ruined'];

interface QualityStep { tier: QualityTier; maxDamage: number; mult: number; color: number; }

/**
 * Damage thresholds are generous on purpose. Ordinary chaos should cost a
 * little; only genuinely awful handling should wipe the value out.
 */
export const QUALITY: QualityStep[] = [
  { tier: 'Perfect', maxDamage: 0.001, mult: 1.55, color: 0x8ef2a8 },
  { tier: 'Good', maxDamage: 0.22, mult: 1.0, color: 0xd8e8b0 },
  { tier: 'Bruised', maxDamage: 0.5, mult: 0.7, color: 0xe8c880 },
  { tier: 'Damaged', maxDamage: 0.82, mult: 0.4, color: 0xe89a5a },
  { tier: 'Ruined', maxDamage: Infinity, mult: 0.12, color: 0xc45a4a },
];

export function qualityFor(damage: number): QualityStep {
  for (const q of QUALITY) if (damage <= q.maxDamage) return q;
  return QUALITY[QUALITY.length - 1];
}

// ---------------------------------------------------------------------------
// variants
// ---------------------------------------------------------------------------
export interface VariantDef {
  id: string;
  label: string;
  /** Relative chance, before the global rare-variant rate. */
  weight: number;
  sizeMul: number;
  massMul: number;
  valueMul: number;
  /** Multiplied over the fruit's natural colours. */
  tint: THREE.Color;
  emissive?: number;
  /** Extra traits granted by the variant. */
  traits?: string[];
  fragilityMul?: number;
  note: string;
}

const T = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

export const VARIANTS: VariantDef[] = [
  { id: 'huge', label: 'Huge', weight: 26, sizeMul: 1.62, massMul: 4.0, valueMul: 3.1,
    tint: T(0xffffff), note: 'Considerably more fruit than anyone asked for.' },
  { id: 'tiny', label: 'Tiny', weight: 26, sizeMul: 0.52, massMul: 0.16, valueMul: 1.9,
    tint: T(0xffffff), note: 'Collectors pay stupid money for these.' },
  { id: 'pale', label: 'Pale', weight: 20, sizeMul: 1.0, massMul: 0.92, valueMul: 2.4,
    tint: T(0xdfe6e2), note: 'Grew somewhere the sun never found it.' },
  { id: 'black', label: 'Black', weight: 12, sizeMul: 1.06, massMul: 1.25, valueMul: 4.2,
    tint: T(0x3a3a44), fragilityMul: 0.6, note: 'Dense, dark, and faintly ominous.' },
  { id: 'glowing', label: 'Glowing', weight: 8, sizeMul: 1.0, massMul: 0.85, valueMul: 6.0,
    tint: T(0xbdf5c8), emissive: 0x4fe08a, note: 'It is doing that on purpose.' },
  { id: 'ancient', label: 'Ancient', weight: 5, sizeMul: 2.15, massMul: 7.5, valueMul: 9.0,
    tint: T(0xb8a184), fragilityMul: 1.4, note: 'Older than the orchard. Possibly older than the island.' },
  { id: 'unstable', label: 'Unstable', weight: 5, sizeMul: 1.1, massMul: 0.7, valueMul: 7.0,
    tint: T(0xf3a2ff), traits: ['unstable'], fragilityMul: 1.6, note: 'Do not let it get comfortable.' },
  { id: 'golden', label: 'Golden', weight: 3, sizeMul: 1.12, massMul: 1.5, valueMul: 14.0,
    tint: T(0xffcf4a), emissive: 0x6a4a00, note: 'The whole reason anyone climbs anything.' },
];

/** Chance that a given spawned fruit is a rare variant at all. */
export const VARIANT_RATE = 0.055;

export const VARIANT_BY_ID = new Map(VARIANTS.map((v) => [v.id, v]));

export function variantById(id: string | null): VariantDef | null {
  return id ? VARIANT_BY_ID.get(id) ?? null : null;
}
