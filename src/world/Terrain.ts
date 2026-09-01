import * as THREE from 'three';
import { fbm2, smoothstep, clamp } from '@/core/MathUtils';
import { Palette } from '@/render/Palette';
import { Mats } from '@/render/Materials';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { Groups } from '@/physics/Layers';

export const SEA_LEVEL = 0;

export interface BiomeWeights { sand: number; grass: number; rock: number; dirt: number; }

/** A circular region whose height is pulled toward a target — used to carve
 *  buildable pads (dock, farm) and basins out of the analytic island. */
interface Flatten { x: number; z: number; r: number; y: number; blend: number; }

/**
 * Sunpatch is authored as a pure height function rather than a heightmap asset.
 * That keeps the island in source control as ~150 lines, makes the collider and
 * the visual mesh provably identical, and lets gameplay code ask "how high is
 * the ground at (x,z)?" without a raycast.
 */
export class Terrain {
  readonly extent = 260;        // world spans [-130, 130] on X and Z
  readonly cell = 1.5;          // metres per grid cell
  readonly seed = 1337;
  mesh!: THREE.Mesh;
  private flattens: Flatten[] = [
    { x: 58, z: 62, r: 15, y: 1.7, blend: 12 },     // dock apron
    { x: 45, z: 52, r: 9, y: 2.4, blend: 8 },       // shop shed pad
    { x: -24, z: 22, r: 26, y: 7.5, blend: 18 },    // old orchard terrace
    { x: -36, z: -30, r: 16, y: 21.0, blend: 14 },  // hill farm plateau
    { x: 0, z: -78, r: 14, y: 30.0, blend: 12 },    // high ridge lookout
  ];

  // ---- analytic height ----------------------------------------------------
  height(x: number, z: number): number {
    const r = Math.hypot(x, z);
    // Coastline is a noisy circle, so the island silhouette is not a disc.
    const warp = fbm2(x * 0.011, z * 0.011, 3, this.seed) * 16;
    const coast = 94 + warp;

    // Land mass: a low plateau that falls away to a beach then a seabed.
    const land = smoothstep(coast, coast - 30, r);
    let h = land * 5.5;
    h -= 11 * smoothstep(coast - 8, coast + 46, r);

    // Big shapes.
    h += gauss(x, z, -32, -18, 36, 30) * 24;        // central hill
    h += ridge(x, z, -66, 58, 17) * 31;             // north high ridge
    h += gauss(x, z, 44, -60, 22, 26) * 25;         // eastern spur
    h += gauss(x, z, -66, -8, 20, 24) * 12;         // west shoulder

    // Ravine: a narrow trench separating ridge from spur. The King Melon hangs
    // over this, so it needs to be deep enough to read as a drop.
    const rav = trench(x, z, -30, -66, 46, -58, 11);
    h -= rav * 26;

    // Waterfall basin: a bowl that catches the fall and holds a pool.
    const bowl = gauss(x, z, 34, -14, 15, 15);
    h -= bowl * 13;

    // Cliff band on the north-west coast, for verticality near the sea.
    h += Math.max(0, fbm2(x * 0.03 + 11, z * 0.03, 2, this.seed + 5)) *
      smoothstep(40, 78, Math.hypot(x + 60, z + 40)) * 0;

    // Medium and fine detail.
    h += fbm2(x * 0.028, z * 0.028, 3, this.seed + 91) * 3.2 * land;
    h += fbm2(x * 0.09, z * 0.09, 2, this.seed + 7) * 0.9 * land;

    // Authored pads.
    for (const f of this.flattens) {
      const d = Math.hypot(x - f.x, z - f.z);
      const w = smoothstep(f.r + f.blend, f.r, d);
      if (w > 0) h = h * (1 - w) + f.y * w;
    }

    // Beaches: flatten anything close to sea level into a gentle shelf.
    const beach = smoothstep(3.4, 0.2, h) * smoothstep(-2.5, 0.6, h);
    h += beach * 0.35;

    return h;
  }

  normal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = 0.6;
    const hL = this.height(x - e, z), hR = this.height(x + e, z);
    const hD = this.height(x, z - e), hU = this.height(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  /** 0 = flat, 1 = vertical. */
  slope(x: number, z: number): number {
    const n = this.normal(x, z, _n);
    return clamp(1 - n.y, 0, 1);
  }

  biome(x: number, z: number, h = this.height(x, z), s = this.slope(x, z)): BiomeWeights {
    const sand = clamp(smoothstep(4.2, 0.1, h) * (1 - smoothstep(0.30, 0.55, s)), 0, 1);
    const rock = clamp(smoothstep(0.20, 0.46, s) + smoothstep(21, 30, h) * 0.85, 0, 1);
    const dirtNoise = fbm2(x * 0.05, z * 0.05, 2, this.seed + 400);
    const dirt = clamp(smoothstep(0.16, 0.42, dirtNoise) * (1 - rock) * (1 - sand) * 0.7, 0, 1);
    const grass = clamp(1 - sand - rock - dirt, 0, 1);
    return { sand, grass, rock, dirt };
  }

  colorAt(x: number, z: number, out: THREE.Color, h?: number, s?: number): THREE.Color {
    const hh = h ?? this.height(x, z);
    const b = this.biome(x, z, hh, s);
    out.setRGB(0, 0, 0);
    _c.copy(hh < 0.35 ? Palette.sandWet : Palette.sand);
    addScaled(out, _c, b.sand);
    // Two-tone grass, tinted drier as it climbs.
    const dry = smoothstep(8, 26, hh);
    _c.copy(Palette.grass).lerp(Palette.grassDry, dry * 0.55);
    const patch = fbm2(x * 0.08, z * 0.08, 2, this.seed + 21);
    _c.lerp(Palette.grassDark, clamp(patch * 0.5 + 0.25, 0, 1) * 0.5);
    addScaled(out, _c, b.grass);
    _c.copy(Palette.rock).lerp(Palette.rockDark, clamp(fbm2(x * 0.06, z * 0.06, 2, this.seed + 3) * 0.5 + 0.5, 0, 1));
    addScaled(out, _c, b.rock);
    addScaled(out, Palette.dirt, b.dirt);
    // A large-scale shade term. Without it the island reads as one flat colour
    // no matter how the biomes blend; measured contrast roughly doubles.
    const shade = 1 + fbm2(x * 0.017, z * 0.017, 3, this.seed + 909) * 0.20;
    out.r *= shade; out.g *= shade; out.b *= shade;
    return out;
  }

  /** Is this a sensible place to stand / spawn / plant something? */
  isLand(x: number, z: number, minHeight = 0.6): boolean {
    return this.height(x, z) > minHeight;
  }

  // ---- mesh + collider ----------------------------------------------------
  build(scene: THREE.Scene, physics: PhysicsWorld, flatShaded = true): void {
    const n = Math.round(this.extent / this.cell);      // cells per side
    const half = this.extent / 2;
    const vertsPerSide = n + 1;
    const pos = new Float32Array(vertsPerSide * vertsPerSide * 3);
    const col = new Float32Array(vertsPerSide * vertsPerSide * 3);
    const heights = new Float32Array(vertsPerSide * vertsPerSide);

    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = -half + i * this.cell;
        const z = -half + j * this.cell;
        const y = this.height(x, z);
        const k = j * vertsPerSide + i;
        heights[k] = y;
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        this.colorAt(x, z, _c2, y);
        col[k * 3] = _c2.r; col[k * 3 + 1] = _c2.g; col[k * 3 + 2] = _c2.b;
      }
    }

    // Index only the triangles that have any part above the seabed cutoff, so
    // we do not pay for a huge submerged skirt we never see or touch.
    const idx: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * vertsPerSide + i;
        const b = a + 1;
        const c = a + vertsPerSide;
        const d = c + 1;
        const maxH = Math.max(heights[a], heights[b], heights[c], heights[d]);
        if (maxH < -7.5) continue;
        idx.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const visual = flatShaded ? geo.toNonIndexed() : geo;
    if (flatShaded) visual.computeVertexNormals();
    visual.computeBoundingSphere();

    const material = Mats.terrain();
    material.flatShading = flatShaded;
    material.needsUpdate = true;

    this.mesh = new THREE.Mesh(visual, material);
    this.mesh.name = 'Terrain';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);

    physics.createTrimesh(pos, new Uint32Array(idx), Groups.world);
  }

  dispose(): void {
    this.mesh?.geometry.dispose();
  }
}

const _n = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();

/** THREE.Color has no addScaledVector; accumulate biome weights by hand. */
function addScaled(out: THREE.Color, src: THREE.Color, w: number): void {
  if (w <= 0) return;
  out.r += src.r * w; out.g += src.g * w; out.b += src.b * w;
}

// ---- shape helpers --------------------------------------------------------
function gauss(x: number, z: number, cx: number, cz: number, sx: number, sz: number): number {
  const dx = (x - cx) / sx, dz = (z - cz) / sz;
  return Math.exp(-(dx * dx + dz * dz));
}

/** Long east-west ridge centred on z=cz, with a sharper southern face. */
function ridge(x: number, z: number, cz: number, sx: number, sz: number): number {
  const dx = x / sx;
  const along = Math.exp(-dx * dx);
  const dz = (z - cz) / (z > cz ? sz * 0.72 : sz);
  return along * Math.exp(-dz * dz);
}

/** A narrow trench along the segment (x1,z1)-(x2,z2). Returns 0..1 depth. */
function trench(x: number, z: number, x1: number, z1: number, x2: number, z2: number, width: number): number {
  const vx = x2 - x1, vz = z2 - z1;
  const len2 = vx * vx + vz * vz;
  let t = ((x - x1) * vx + (z - z1) * vz) / len2;
  t = clamp(t, 0, 1);
  const px = x1 + vx * t, pz = z1 + vz * t;
  const d = Math.hypot(x - px, z - pz);
  // Taper the ends so the trench does not slice the coastline open.
  const endTaper = smoothstep(0, 0.14, t) * smoothstep(1, 0.86, t);
  return smoothstep(width, width * 0.25, d) * endTaper;
}
