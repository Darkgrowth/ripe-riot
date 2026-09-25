import * as THREE from 'three';
import { fbm2, smoothstep, clamp } from '@/core/MathUtils';
import { Palette } from '@/render/Palette';
import { Mats } from '@/render/Materials';
import { orchardProofWeight } from './VisualProof';
const PROOF_GROUND = new THREE.Color().setHex(0x929365, THREE.SRGBColorSpace);
const PROOF_EARTH = new THREE.Color().setHex(0xb19063, THREE.SRGBColorSpace);
const MEADOW = new THREE.Color().setHex(0x89965b, THREE.SRGBColorSpace);
const GROVE_FLOOR = new THREE.Color().setHex(0x567b68, THREE.SRGBColorSpace);
const UPLAND = new THREE.Color().setHex(0xa1a16c, THREE.SRGBColorSpace);
const STRATA = new THREE.Color().setHex(0xb2a288, THREE.SRGBColorSpace);
const WORK_EARTH = new THREE.Color().setHex(0xa08a65, THREE.SRGBColorSpace);
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { Groups } from '@/physics/Layers';

export const SEA_LEVEL = 0;

/**
 * The worn route the island teaches itself along: off the dock, past the shop
 * and the sell pad, then up the rise into the old orchard.
 *
 * It is a *ground treatment*, not a corridor — the height function is untouched,
 * so nothing about traversal, collision or the pads changes. What it does is
 * tint the ground toward packed earth and keep the clutter layer off itself,
 * which between them is what makes the way ahead readable without hanging a
 * marker in the sky.
 *
 * Entries are x, z, half-width in metres. The width opens out at the sell pad
 * and again where the orchard starts, so the route reads as a place rather than
 * a track of constant gauge.
 */
export const ROUTE: ReadonlyArray<readonly [number, number, number]> = [
  [60.0, 65.0, 2.8], [55.5, 61.0, 3.0], [50.5, 58.2, 3.4], [45.5, 56.3, 4.2],
  [41.0, 55.2, 4.6], [36.5, 52.6, 3.8], [31.0, 49.6, 3.4], [25.0, 46.0, 3.2],
  [18.5, 42.6, 3.2], [11.0, 38.6, 3.2], [4.0, 35.0, 3.3], [-3.5, 31.4, 3.6],
  [-10.5, 28.0, 3.8], [-17.0, 25.0, 4.2], [-24.0, 22.0, 5.0],
];

/**
 * The second track: out of the back of the orchard, up the one walkable
 * shoulder of the central hill (29 degrees at its worst — measured, not
 * hoped), across the hill farm and down to the ravine rim where the King
 * Melon hangs. It is the island's escalation drawn on the ground: apples
 * behind you, watermelons and Boulder Plums beside you, the legendary ahead.
 * It is narrower than the first because fewer people walk it.
 */
export const ROUTE_HILL: ReadonlyArray<readonly [number, number, number]> = [
  [-24.0, 22.0, 4.0], [-27.0, 12.0, 3.0], [-29.0, 2.0, 2.8], [-31.0, -8.0, 2.8],
  [-33.0, -18.0, 3.0], [-36.0, -30.0, 3.8], [-30.0, -38.0, 3.0], [-22.0, -44.0, 2.8],
  [-13.0, -49.0, 2.8], [-5.0, -51.5, 3.2],
];

/** Worn footpath from the lower ravine to the gentler southern ground. */
export const ROUTE_RAVINE: ReadonlyArray<readonly [number, number, number]> = [
  [15.8, -57, 2.2], [15.4, -53, 2.2], [15.0, -49, 2.2], [14.5, -44, 2.2],
];
export const ROUTE_RAVINE_WEST: ReadonlyArray<readonly [number, number, number]> = [
  [-20, -62, 2.2], [-18.2, -58, 2.2], [-15.6, -52, 2.2], [-12, -44, 2.2],
];

const ROUTES = [ROUTE, ROUTE_HILL, ROUTE_RAVINE, ROUTE_RAVINE_WEST];

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

    // Waterfall basin: a bowl that catches the fall and holds a pool...
    const bowl = gauss(x, z, 34, -14, 15, 15);
    h -= bowl * 10;
    // ...and a tight, steep knoll on its northern rim to fall OFF. Without a
    // real cliff the waterfall lay flat against a grassy slope and read as a
    // white smear rather than falling water.
    h += gauss(x, z, 34, -31, 12, 6.5) * 13;

    // Cliff band on the north-west coast, for verticality near the sea.
    h += Math.max(0, fbm2(x * 0.03 + 11, z * 0.03, 2, this.seed + 5)) *
      smoothstep(40, 78, Math.hypot(x + 60, z + 40)) * 0;

    // Medium and fine detail. The finest band is deliberately just above the
    // 1.5 m grid so it adds crunch at walking distance without aliasing into
    // noise at range.
    h += fbm2(x * 0.028, z * 0.028, 3, this.seed + 91) * 3.4 * land;
    h += fbm2(x * 0.09, z * 0.09, 2, this.seed + 7) * 1.1 * land;
    h += fbm2(x * 0.31, z * 0.31, 2, this.seed + 55) * 0.34 * land;

    // Authored pads.
    for (const f of this.flattens) {
      const d = Math.hypot(x - f.x, z - f.z);
      const w = smoothstep(f.r + f.blend, f.r, d);
      if (w > 0) h = h * (1 - w) + f.y * w;
    }

    // A lower ravine player must be able to walk out without a tool. Blend a
    // broad, shallow ramp into the south bank rather than changing the King
    // Melon's landing ground or the high rim where its vines are anchored.
    // The visual mesh and Rapier trimesh both sample this same height function.
    const exitX = 15.8 - (z + 57) * 0.1;
    const along = smoothstep(-58.2, -56.7, z) * smoothstep(-42.5, -45.3, z);
    const across = smoothstep(5.0, 2.2, Math.abs(x - exitX));
    const exitWeight = along * across;
    if (exitWeight > 0) {
      const exitHeight = 1.4 + (z + 57) * 0.62;
      h += (exitHeight - h) * exitWeight;
    }
    // The western pocket is divided from that walkout by the high ridge. Its
    // second path climbs south into the existing back-country route instead.
    const westX = -20 + (z + 62) * (8 / 18);
    const westAlong = smoothstep(-63, -61.8, z) * smoothstep(-42.5, -45.3, z);
    const westAcross = smoothstep(5.0, 2.2, Math.abs(x - westX));
    const westWeight = westAlong * westAcross;
    if (westWeight > 0) {
      const westHeight = 4.7 + (z + 62) * 0.49;
      h += (westHeight - h) * westWeight;
    }

    // Beaches: flatten anything close to sea level into a gentle shelf.
    const beach = smoothstep(3.4, 0.2, h) * smoothstep(-2.5, 0.6, h);
    h += beach * 0.35;

    return h;
  }

  /**
   * How strongly (x, z) sits on the worn route: 1 in the middle, 0 well off it.
   *
   * Distance to a 15-segment polyline is cheap, but it is evaluated once per
   * terrain vertex and once per candidate clutter position, so the bounding-box
   * reject in front of it earns its keep — most of the island is nowhere near
   * the route and pays two comparisons instead of thirty.
   */
  pathWeight(x: number, z: number): number {
    let best = 0;
    for (let r = 0; r < ROUTES.length; r++) {
      const box = ROUTE_BOXES[r];
      if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
      const route = ROUTES[r];
      for (let i = 0; i < route.length - 1; i++) {
        const [x1, z1, w1] = route[i];
        const [x2, z2, w2] = route[i + 1];
        const vx = x2 - x1, vz = z2 - z1;
        const len2 = vx * vx + vz * vz;
        let t = len2 > 0 ? ((x - x1) * vx + (z - z1) * vz) / len2 : 0;
        t = clamp(t, 0, 1);
        const d = Math.hypot(x - (x1 + vx * t), z - (z1 + vz * t));
        const w = w1 + (w2 - w1) * t;
        // Wander the edge so the route is a worn track, not a painted stripe.
        const wobble = fbm2(x * 0.16, z * 0.16, 2, this.seed + 77) * 0.9;
        const wt = smoothstep(w * 1.5 + wobble, w * 0.5, d);
        if (wt > best) best = wt;
        if (best > 0.999) return best;
      }
    }
    return best;
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
    // Sand used to reach 4.2 m, which is above both authored pads: the dock
    // apron, the whole first stretch of the route and the shop frontage all
    // came out beige, and the worn path had nothing to read against. Pulled
    // back to a real beach band, the route crosses grass within twenty metres
    // of the dock and the path reads as a path.
    const tide = fbm2(x * 0.06, z * 0.06, 2, this.seed + 211) * 0.9;
    const sand = clamp(smoothstep(2.15 + tide, 0.1, h) * (1 - smoothstep(0.30, 0.55, s)), 0, 1);
    // Rock is a SLOPE story, not an altitude one. The shipped altitude term
    // started at 21 m, which greyed out the waterfall knoll, the ravine rims
    // and the whole King Melon massif — every distant hill read as bare stone
    // where the art direction wants green with rock showing through the steep
    // faces. Pushed up and weighted down, the peaks keep their vegetation and
    // the cliffs still read as cliffs.
    const rock = clamp(smoothstep(0.22, 0.50, s) + smoothstep(32, 48, h) * 0.6, 0, 1);
    const dirtNoise = fbm2(x * 0.05, z * 0.05, 2, this.seed + 400);
    const dirt = clamp(smoothstep(0.16, 0.42, dirtNoise) * (1 - rock) * (1 - sand) * 0.7, 0, 1);
    const grass = clamp(1 - sand - rock - dirt, 0, 1);
    return { sand, grass, rock, dirt };
  }

  colorAt(x: number, z: number, out: THREE.Color, h?: number, s?: number): THREE.Color {
    const hh = h ?? this.height(x, z);
    const ss = s ?? this.slope(x, z);
    const b = this.biome(x, z, hh, ss);
    out.setRGB(0, 0, 0);

    // Sand. The waterline gets its own darker, wetter band, and the band is
    // warped by noise so the beach does not read as a contour line drawn round
    // the island at exactly one height.
    const tideWarp = fbm2(x * 0.07, z * 0.07, 2, this.seed + 133) * 1.1;
    _c.copy(hh < 0.55 + tideWarp ? Palette.sandWet : Palette.sand);
    // A little dry-sand mottling so the beach is not one flat card.
    _c.lerp(Palette.dirt, clamp(fbm2(x * 0.13, z * 0.13, 2, this.seed + 61) * 0.4 + 0.1, 0, 1) * 0.16);
    addScaled(out, _c, b.sand);

    // Grass, in three registers: lush in the hollows, standard on the flat,
    // dry and yellow where it climbs or catches the light on a shoulder.
    const dry = smoothstep(9, 30, hh);
    _c.copy(Palette.grass).lerp(Palette.grassDry, dry * 0.5);
    const patch = clamp(fbm2(x * 0.055, z * 0.055, 3, this.seed + 21) * 0.5 + 0.5, 0, 1);
    // Two-sided: the same noise pushes toward dark lush green below the middle
    // and toward dry highlight above it, which roughly doubles the amount of
    // colour variation for one noise lookup.
    if (patch < 0.5) _c.lerp(Palette.grassDark, (0.5 - patch) * 1.15);
    else _c.lerp(Palette.grassDry, (patch - 0.5) * 0.75);
    // Steeper grass sits in shadow more of the day; darkening it is what gives
    // a rolling hillside its form when the geometry itself is smooth.
    _c.lerp(Palette.grassDark, smoothstep(0.10, 0.42, ss) * 0.45);
    // Broad, quiet meadow patches separate the ground from the saturated fruit
    // and crowns. These are pigment changes only: all height/route data stays exact.
    _c.lerp(MEADOW, 0.24 + smoothstep(0.40, 0.67, patch) * 0.28);
    const grove = 1 - smoothstep(10, 23, Math.hypot((x - 62) * 0.9, z + 9));
    _c.lerp(GROVE_FLOOR, grove * 0.68);
    const upland = smoothstep(11, 25, hh) * (1 - smoothstep(31, 45, hh));
    _c.lerp(UPLAND, upland * 0.28);
    addScaled(out, _c, b.grass);

    // Rock, with a crevice term. The high-frequency band is only applied where
    // it is actually steep, so flat ground does not pick up grey speckle.
    const crev = clamp(fbm2(x * 0.24, z * 0.24, 2, this.seed + 313) * 0.5 + 0.5, 0, 1);
    _c.copy(Palette.rock).lerp(Palette.rockDark,
      clamp(fbm2(x * 0.06, z * 0.06, 2, this.seed + 3) * 0.5 + 0.5, 0, 1));
    _c.lerp(Palette.rockDark, smoothstep(0.34, 0.62, ss) * crev * 0.7);
    const strata = Math.sin(hh * 0.76 + x * 0.041 + Math.sin(z * 0.065) * 1.8);
    _c.lerp(STRATA, smoothstep(0.52, 0.91, strata) * 0.34);
    _c.lerp(Palette.rockDark, smoothstep(-0.55, -0.92, strata) * 0.12);
    addScaled(out, _c, b.rock);

    addScaled(out, Palette.dirt, b.dirt);

    // A large-scale shade term. Without it the island reads as one flat colour
    // no matter how the biomes blend; measured contrast roughly doubles.
    const shade = 1 + fbm2(x * 0.017, z * 0.017, 3, this.seed + 909) * 0.24;
    out.r *= shade; out.g *= shade; out.b *= shade;

    // Local art proof: a warmer, quieter orchard floor under cooler pruned
    // crowns. This only paints the mesh; height, slope and routes stay exact.
    const proof = orchardProofWeight(x, z);
    if (proof > 0) out.lerp(PROOF_GROUND, proof * b.grass * (0.48 + patch * 0.22));

    // Worn footprints connect the shelters to their ground without flattening
    // terrain or adding collision. Soft irregular edges avoid a rectangular decal.
    let wear = 0;
    for (const [cx, cz, rx, rz] of WORK_FOOTPRINTS) {
      const d = Math.hypot((x - cx) / rx, (z - cz) / rz);
      wear = Math.max(wear, 1 - smoothstep(0.48, 1.15, d + (patch - 0.5) * 0.3));
    }
    out.lerp(WORK_EARTH, wear * 0.66 * (1 - b.rock));

    // The worn route, laid over everything else. Pale packed earth in the
    // middle where it is actually walked, darker at the shoulders where it
    // gives way to the grass.
    const pw = this.pathWeight(x, z);
    if (pw > 0.001) {
      _c.copy(Palette.pathDark).lerp(Palette.path, smoothstep(0.3, 0.9, pw));
      if (proof > 0) _c.lerp(PROOF_EARTH, proof * 0.35);
      // Scuff it, so a 5 m band of flat colour does not appear on the hillside.
      _c.lerp(Palette.dirt, clamp(fbm2(x * 0.35, z * 0.35, 2, this.seed + 505) * 0.5 + 0.5, 0, 1) * 0.22);
      out.lerp(_c, pw * 0.92);
    }
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
    //
    // The cutoff is deliberately well below anything walkable. At -7.5 it once
    // clipped the floor of the waterfall basin, leaving a hole in the collider
    // that swallowed the player — the kind of bug that is invisible until
    // someone walks to exactly that spot.
    const idx: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * vertsPerSide + i;
        const b = a + 1;
        const c = a + vertsPerSide;
        const d = c + 1;
        const maxH = Math.max(heights[a], heights[b], heights[c], heights[d]);
        if (maxH < -16) continue;
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

const WORK_FOOTPRINTS = [[-16, -25, 4.7, 3.2], [-54, 57, 3.6, 2.6],
  [-5, -40, 4.6, 2.6], [60, -23, 5.5, 4.0]] as const;

/** Bounding box of each route, padded by its widest half-width. Used to reject
 *  the ~90% of the island that is nowhere near a route in two comparisons. */
const ROUTE_BOXES = ROUTES.map((route) => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, pad = 0;
  for (const [x, z, w] of route) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    pad = Math.max(pad, w);
  }
  pad = pad * 1.5 + 2;
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
});

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
