import * as THREE from 'three';
import { Palette } from './Palette';

/**
 * Shared material cache. Every mesh in the game should pull from here so the
 * renderer keeps a small, batchable material set (and so a global art tweak is
 * one edit). Materials are keyed by their visual intent, not by object type.
 */

export interface MatOpts {
  color: THREE.Color | number;
  roughness?: number;
  metalness?: number;
  flat?: boolean;
  transparent?: boolean;
  opacity?: number;
  emissive?: THREE.Color | number;
  emissiveIntensity?: number;
  side?: THREE.Side;
  vertexColors?: boolean;
  /** Enables per-instance colour on InstancedMesh. */
  instanced?: boolean;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();

function keyOf(name: string, o: MatOpts): string {
  const col = o.color instanceof THREE.Color ? o.color.getHexString() : o.color.toString(16);
  return [name, col, o.roughness, o.metalness, o.flat, o.transparent, o.opacity,
    o.side, o.vertexColors, o.instanced, o.emissiveIntensity].join('|');
}

export function mat(name: string, o: MatOpts): THREE.MeshStandardMaterial {
  const k = keyOf(name, o);
  const hit = cache.get(k);
  if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({
    color: o.color instanceof THREE.Color ? o.color.clone() : new THREE.Color(o.color),
    roughness: o.roughness ?? 0.82,
    metalness: o.metalness ?? 0.0,
    flatShading: o.flat ?? false,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
    vertexColors: o.vertexColors ?? false,
    emissive: o.emissive !== undefined
      ? (o.emissive instanceof THREE.Color ? o.emissive.clone() : new THREE.Color(o.emissive))
      : new THREE.Color(0x000000),
    emissiveIntensity: o.emissiveIntensity ?? 1,
  });
  m.name = name;
  m.envMapIntensity = 0.65;
  cache.set(k, m);
  return m;
}

/** Convenience accessors for the materials used all over the world build. */
export const Mats = {
  terrain: () => mat('terrain', { color: 0xffffff, vertexColors: true, roughness: 0.95, flat: false }),
  rock: () => mat('rock', { color: Palette.rock, roughness: 0.95, flat: true }),
  sand: () => mat('sand', { color: Palette.sand, roughness: 1.0 }),
  trunk: () => mat('trunk', { color: Palette.trunk, roughness: 0.9, flat: true }),
  palmTrunk: () => mat('palmTrunk', { color: Palette.palmTrunk, roughness: 0.9, flat: true }),
  leaf: () => mat('leaf', { color: Palette.leaf, roughness: 0.72, flat: true, side: THREE.DoubleSide }),
  leafLight: () => mat('leafLight', { color: Palette.leafLight, roughness: 0.72, flat: true, side: THREE.DoubleSide }),
  palmLeaf: () => mat('palmLeaf', { color: Palette.palmLeaf, roughness: 0.7, flat: true, side: THREE.DoubleSide }),
  vine: () => mat('vine', { color: Palette.vine, roughness: 0.85, flat: true }),
  wood: () => mat('wood', { color: Palette.wood, roughness: 0.85, flat: true }),
  woodDark: () => mat('woodDark', { color: Palette.woodDark, roughness: 0.85, flat: true }),
  plank: () => mat('plank', { color: Palette.plank, roughness: 0.82, flat: true }),
  metal: () => mat('metal', { color: Palette.metal, roughness: 0.45, metalness: 0.75, flat: true }),
  metalDark: () => mat('metalDark', { color: Palette.metalDark, roughness: 0.5, metalness: 0.7, flat: true }),
  paintRed: () => mat('paintRed', { color: Palette.paintRed, roughness: 0.7, flat: true }),
  paintBlue: () => mat('paintBlue', { color: Palette.paintBlue, roughness: 0.7, flat: true }),
  paintCream: () => mat('paintCream', { color: Palette.paintCream, roughness: 0.75, flat: true }),
  rope: () => mat('rope', { color: Palette.rope, roughness: 0.95, flat: true }),
  /** Per-instance-coloured fruit body: white base tinted by instanceColor. */
  fruitInstanced: () => mat('fruitInstanced', { color: 0xffffff, roughness: 0.55, flat: false, instanced: true }),
  fruitInstancedFlat: () => mat('fruitInstancedFlat', { color: 0xffffff, roughness: 0.6, flat: true, instanced: true }),
};

export function disposeMaterials(): void {
  for (const m of cache.values()) m.dispose();
  cache.clear();
}

/** Cheap banded-gradient map for optional toon accents. */
export function toonGradient(steps = 4): THREE.DataTexture {
  const data = new Uint8Array(steps * 4);
  for (let i = 0; i < steps; i++) {
    const v = Math.round((i / (steps - 1)) * 255);
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
