import * as THREE from 'three';

/**
 * One place for every colour in the game. Art direction: stylised low-poly,
 * moderately saturated, warm sun, turquoise sea. Colours are authored as sRGB
 * hex and converted to linear-working-space once, here.
 */
const c = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

export const Palette = {
  // --- sky / atmosphere
  skyZenith:    c(0x2f8fd6),
  skyHorizon:   c(0xbfe9f5),
  skyGround:    c(0x9fbf8a),
  sunDisc:      c(0xfff4d0),
  sunLight:     c(0xfff0d2),
  fog:          c(0xbfe3ee),
  nightZenith:  c(0x0d1a3a),
  nightHorizon: c(0x2c4a6e),

  // --- ocean
  oceanDeep:    c(0x0e6f8f),
  oceanShallow: c(0x39c8c8),
  foam:         c(0xeafcff),

  // --- terrain
  sand:         c(0xe3cf93),
  sandWet:      c(0xcbb98a),
  grass:        c(0x548f2e),
  grassDry:     c(0x93b348),
  grassDark:    c(0x35661f),
  dirt:         c(0x8a6a44),
  rock:         c(0x8e8676),
  rockDark:     c(0x6e6a60),

  // --- plants
  trunk:        c(0x7a5537),
  trunkDark:    c(0x5c3f28),
  palmTrunk:    c(0xa8875c),
  leaf:         c(0x4f9e35),
  leafLight:    c(0x76c24a),
  leafDark:     c(0x35702a),
  palmLeaf:     c(0x57a83c),
  vine:         c(0x5c8f38),

  // --- built
  wood:         c(0xb08150),
  woodDark:     c(0x7d5733),
  plank:        c(0xc89a63),
  metal:        c(0xa8b0b8),
  metalDark:    c(0x5f6a72),
  paintRed:     c(0xd0503c),
  paintBlue:    c(0x3f7fb5),
  paintCream:   c(0xf0e2c0),
  rope:         c(0xd8c08a),

  // --- accents
  gold:         c(0xffcc44),
  danger:       c(0xff5544),
  good:         c(0x66dd88),
};

export type PaletteKey = keyof typeof Palette;

/** Slightly perturb a colour, for per-instance variety without new materials. */
export function jitterColor(base: THREE.Color, out: THREE.Color, amount: number, r: number): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  out.setHSL(
    (hsl.h + (r - 0.5) * amount * 0.12 + 1) % 1,
    THREE.MathUtils.clamp(hsl.s + (r - 0.5) * amount * 0.25, 0, 1),
    THREE.MathUtils.clamp(hsl.l + (r - 0.5) * amount * 0.22, 0.03, 0.97),
  );
  return out;
}
