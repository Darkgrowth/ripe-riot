import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Palette } from '@/render/Palette';
import { fbm2, clamp, smoothstep, TAU } from '@/core/MathUtils';
import { Rng } from '@/core/Rng';
import { voxelDressingGeometry, type VoxelDressingKind } from '@/art/voxel/VoxelDressing';
import type { VisualMode } from '@/art/voxel/VisualMode';
import type { Terrain } from './Terrain';
import { orchardProofWeight } from './VisualProof';

/**
 * The clutter layer: grass tufts, bushes, ferns, flowers, loose stones and
 * driftwood.
 *
 * The island shipped with landmarks and nothing between them, so the walk from
 * the dock to the shop crossed forty metres of unbroken pale ground and read as
 * a greybox. This is what fills that in.
 *
 * Three rules it is built around:
 *
 * **Nothing here collides.** Clutter is scenery. A bush you have to walk round
 * is a bug rather than detail, and a few thousand tiny colliders would be pure
 * broadphase cost for no gameplay.
 *
 * **One draw call per kind, not per object.** Everything is an InstancedMesh,
 * so a few thousand pieces of scenery cost nine draw calls between them.
 *
 * **Clumped, not sprinkled.** Density is multiplied by a low-frequency noise
 * field, so vegetation gathers into thickets with clear ground between them.
 * Uniform scatter at the same count reads as static and hides the route;
 * clumped scatter at the same count reads as a place and frames it.
 */

/** Local +Y of a clutter vertex, normalised to the piece's height and raised to
 *  a power so sway concentrates in the tips. Baked per vertex at build time and
 *  read by the sway patch below. */
const SWAY_ATTR = 'swayWeight';

const VERT_PATCH = /* glsl */`
  vec4 mvPosition = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
    // Sway is applied after the instance matrix, in world space, so a rotated
    // instance still bends downwind rather than around its own axis. The mesh
    // keeps an identity model matrix (matrixAutoUpdate off), so world space and
    // model space are the same here.
    float amp = uWindStrength * swayWeight;
    vec3 wdir = normalize(uWind + vec3(0.0001, 0.0, 0.0));
    vec3 wperp = vec3(-wdir.z, 0.0, wdir.x);
    // Phase comes from world position: neighbouring clumps move together and
    // distant ones do not, and it costs no per-instance attribute to do it.
    float ph = mvPosition.x * 0.35 + mvPosition.z * 0.27;
    float s1 = sin(uTime * 1.35 + ph);
    float s2 = sin(uTime * 3.10 + ph * 1.7);
    mvPosition.xyz += wdir * (amp * (0.62 * s1 + 0.20 * s2));
    mvPosition.xyz += wperp * (amp * 0.30 * sin(uTime * 0.95 + ph * 1.3));
    mvPosition.y -= amp * abs(s1) * 0.10;
  #endif
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;`;

interface Kind {
  name: string;
  geometry: THREE.BufferGeometry;
  /** Per-instance colour, for kinds that want variety without new materials. */
  tinted?: boolean;
  castShadow?: boolean;
  doubleSide?: boolean;
  sway: boolean;
}

interface Placement {
  kind: string;
  x: number; z: number; y: number;
  scale: number;
  rotY: number;
  tilt: number;
  color?: THREE.Color;
}

export class Dressing {
  private meshes = new Map<string, THREE.InstancedMesh>();
  private uniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3(1, 0, 0) },
    uWindStrength: { value: 0.09 },
  };
  /** Pieces placed per kind, for the harness and the perf report. */
  counts: Record<string, number> = {};

  constructor(private readonly visualMode: VisualMode = 'baseline') {}

  build(scene: THREE.Scene, terrain: Terrain): void {
    const kinds = buildKinds();
    const places = scatter(terrain);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();

    const addInstances = (k: Kind, mine: Placement[], voxel: boolean) => {
      const mesh = this.makeMesh(k, mine.length, voxel);
      for (let i = 0; i < mine.length; i++) {
        const p = mine[i];
        pos.set(p.x, p.y, p.z);
        // Tilt away from vertical in the direction the piece faces, so a
        // hillside of grass leans with the slope instead of standing to
        // attention on it.
        e.set(p.tilt * Math.cos(p.rotY), p.rotY, p.tilt * Math.sin(p.rotY));
        q.setFromEuler(e);
        scl.setScalar(p.scale);
        m.compose(pos, q, scl);
        mesh.setMatrixAt(i, m);
        if (k.tinted && p.color) mesh.setColorAt(i, p.color);
        if (['grass', 'bush', 'bushBig', 'fern'].includes(k.name)) {
          const proof = orchardProofWeight(p.x, p.z);
          if (proof > 0) {
            const tint = k.name === 'grass' ? new THREE.Color(1.18, 0.95, 0.78)
              : new THREE.Color(0.77, 0.88, 1.04);
            tint.lerp(new THREE.Color(1, 1, 1), 1 - proof);
            mesh.setColorAt(i, tint);
          }
          const grove = 1 - smoothstep(10, 23, Math.hypot((p.x - 62) * 0.9, p.z + 9));
          if (grove > 0) {
            const tint = new THREE.Color().setRGB(0.64, 0.86, 0.95);
            tint.lerp(new THREE.Color(1, 1, 1), 1 - grove);
            mesh.setColorAt(i, tint);
          }
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
      this.meshes.set(mesh.name, mesh);
    };

    for (const k of kinds) {
      const mine = places.filter((p) => p.kind === k.name);
      this.counts[k.name] = mine.length;
      const onVoxelRoute = (p: Placement) => {
        if (Math.hypot(p.x + 24, p.z - 22) <= 30) return true;
        // Continue the visual language around the Spitter without changing
        // the seeded scatter or the walkable hill-path clearance.
        if (Math.hypot(p.x + 31, p.z + 8) <= 11) return true;
        // The dock, shop, and orchard form the first playable route. A broad
        // corridor converts its foliage together instead of leaving a ring of
        // faceted bushes at the clearing edge.
        const t = THREE.MathUtils.clamp(((p.x + 24) * 82 + (p.z - 22) * 40)
          / (82 * 82 + 40 * 40), 0, 1);
        return Math.hypot(p.x - (-24 + 82 * t), p.z - (22 + 40 * t)) <= 18;
      };
      const voxel = this.visualMode === 'voxel' ? mine.filter(onVoxelRoute) : [];
      const baseline = voxel.length ? mine.filter((p) => !onVoxelRoute(p)) : mine;
      if (baseline.length) addInstances(k, baseline, false);
      else k.geometry.dispose();
      if (voxel.length) {
        const voxelKind: Kind = {
          ...k, geometry: voxelDressingGeometry(k.name as VoxelDressingKind),
          doubleSide: false,
        };
        addInstances(voxelKind, voxel, true);
      }
    }
  }

  private makeMesh(k: Kind, count: number, voxel: boolean): THREE.InstancedMesh {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      // Blades and petals are single-sided cards seen from every angle; without
      // DoubleSide their backs go black as the player walks round them.
      side: k.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      flatShading: true,
    });
    mat.name = `dressing:${voxel ? 'voxel:' : ''}${k.name}`;
    mat.envMapIntensity = 0.45;
    if (k.sway) {
      const u = this.uniforms;
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = u.uTime;
        shader.uniforms.uWind = u.uWind;
        shader.uniforms.uWindStrength = u.uWindStrength;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
            attribute float ${SWAY_ATTR};
            uniform float uTime;
            uniform vec3 uWind;
            uniform float uWindStrength;`)
          .replace('#include <project_vertex>', VERT_PATCH);
      };
      mat.customProgramCacheKey = () => 'dressing-sway';
    }
    const mesh = new THREE.InstancedMesh(k.geometry, mat, count);
    mesh.name = `Dressing:${voxel ? 'voxel:' : ''}${k.name}`;
    mesh.castShadow = k.castShadow ?? false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;   // identity model matrix; see the sway patch
    return mesh;
  }

  setWind(dir: THREE.Vector3, strength: number): void {
    (this.uniforms.uWind.value as THREE.Vector3).copy(dir).setY(0).normalize();
    this.uniforms.uWindStrength.value = strength;
  }

  update(t: number): void { this.uniforms.uTime.value = t; }

  /** Total instances placed, across every kind. */
  get total(): number {
    let n = 0;
    for (const v of Object.values(this.counts)) n += v;
    return n;
  }

  get triangles(): number {
    let n = 0;
    for (const mesh of this.meshes.values()) {
      n += (mesh.geometry.getAttribute('position').count / 3) * mesh.count;
    }
    return Math.round(n);
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) {
      mesh.parent?.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.meshes.clear();
  }
}

// ---------------------------------------------------------------------------
// Geometry. Everything is authored around the origin, sitting on y = 0, with a
// swayWeight attribute baked in.

function paint(g: THREE.BufferGeometry, top: THREE.Color, bottom: THREE.Color,
  height: number, swayPower: number): THREE.BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  const pos = flat.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const sway = new Float32Array(pos.count);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = clamp(pos.getY(i) / height, 0, 1);
    c.copy(bottom).lerp(top, t);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    sway[i] = swayPower > 0 ? Math.pow(t, swayPower) : 0;
  }
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  flat.setAttribute(SWAY_ATTR, new THREE.BufferAttribute(sway, 1));
  for (const k of Object.keys(flat.attributes)) {
    if (k !== 'position' && k !== 'normal' && k !== 'color' && k !== SWAY_ATTR) {
      flat.deleteAttribute(k);
    }
  }
  return flat;
}

/** One tapered blade, leaning outward and curling over at the tip. */
function blade(angle: number, h: number, w: number, lean: number, bend: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const seg = 2;
  const verts: number[] = [];
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    // Lean plus an accelerating bend, so the tip curls over instead of the
    // whole blade tipping like a felled post.
    const out = lean * t + bend * t * t;
    pts.push([Math.cos(angle) * out, h * t, Math.sin(angle) * out]);
  }
  const nx = -Math.sin(angle), nz = Math.cos(angle);
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg, t1 = (i + 1) / seg;
    const w0 = w * (1 - t0 * 0.72), w1 = w * (1 - t1 * 0.88);
    const a = pts[i], b = pts[i + 1];
    const a0 = [a[0] - nx * w0, a[1], a[2] - nz * w0];
    const a1 = [a[0] + nx * w0, a[1], a[2] + nz * w0];
    const b0 = [b[0] - nx * w1, b[1], b[2] - nz * w1];
    const b1 = [b[0] + nx * w1, b[1], b[2] + nz * w1];
    verts.push(...a0, ...a1, ...b1, ...a0, ...b1, ...b0);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
}

function grassTuft(rng: Rng, tall = false): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = tall ? 6 : 5;
  const hMax = tall ? 0.95 : 0.5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.range(-0.35, 0.35);
    const h = hMax * rng.range(0.6, 1.0);
    parts.push(blade(a, h, tall ? 0.035 : 0.045, h * 0.22, h * 0.30));
  }
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return paint(merged, Palette.bladeTip, Palette.bladeBase, hMax, 1.5);
}

/**
 * A low leafy dome. Three squashed icosahedra read as a bush from two metres
 * and cost sixty triangles; a sphere with enough segments to look round costs
 * four hundred and looks worse under flat shading.
 */
function bush(rng: Rng, big = false): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // More, smaller lobes than the first cut. Three big icosahedra look like a
  // bush from five metres and like one enormous green triangle from one, and
  // the player walks past these at arm's length constantly.
  const lobes = big ? 6 : 4;
  const base = big ? 0.46 : 0.30;
  let top = 0;
  for (let i = 0; i < lobes; i++) {
    const r = base * rng.range(0.62, 1.0);
    const a = (i / lobes) * TAU + rng.range(-0.4, 0.4);
    const d = base * rng.range(0.35, 0.95);
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.scale(1, rng.range(0.62, 0.85), 1);
    const y = r * rng.range(0.55, 0.95);
    g.translate(Math.cos(a) * d, y, Math.sin(a) * d);
    top = Math.max(top, y + r);
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return paint(merged, Palette.bushLeafLit, Palette.bushLeaf, top, 2.0);
}

/**
 * A fan of broad fronds, for the wetter ground round the waterfall and the
 * orchard edges. It reads as a different plant from a bush at a glance, which
 * is the entire reason for having two.
 */
function fern(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.range(-0.2, 0.2);
    const h = rng.range(0.42, 0.72);
    parts.push(blade(a, h, 0.11, h * 0.55, h * 0.55));
  }
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return paint(merged, Palette.bushLeafLit, Palette.fernLeaf, 0.72, 1.5);
}

/**
 * Flowers are two meshes sharing one set of transforms: green stems with fixed
 * colour, and heads that take a per-instance tint.
 *
 * Splitting them is what makes five flower colours cost two draw calls instead
 * of five. `instanceColor` multiplies the WHOLE instance, so one merged mesh
 * would tint the stems red along with the petals.
 */
function flowerStems(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + rng.range(-0.5, 0.5);
    const h = FLOWER_H[i];
    parts.push(blade(a + FLOWER_A[i], h, 0.012, h * 0.30, h * 0.10));
  }
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return paint(merged, Palette.bladeTip, Palette.bladeBase, 0.42, 1.3);
}

function flowerHeads(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + FLOWER_A[i];
    const h = FLOWER_H[i];
    const out = h * 0.30 + h * 0.10;
    // Five petals on a shallow cone: a recognisable bloom silhouette for ten
    // triangles, which at this scale is all a flower gets.
    const g = new THREE.ConeGeometry(0.055, 0.032, 5, 1);
    g.rotateX(Math.PI);
    g.translate(Math.cos(a) * out, h + 0.014, Math.sin(a) * out);
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  // White base: the per-instance colour supplies the actual hue.
  const white = new THREE.Color(1, 1, 1);
  return paint(merged, white, white, 0.42, 1.3);
}

/** Stem heights and angular offsets, shared by both flower meshes so the heads
 *  land on the stems rather than beside them. */
const FLOWER_H = [0.38, 0.27, 0.34, 0.24];
const FLOWER_A = [0.31, -0.42, 0.18, -0.25];

function stone(rng: Rng): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.26, 0);
  g.scale(rng.range(0.85, 1.3), rng.range(0.5, 0.8), rng.range(0.85, 1.3));
  const pos = g.getAttribute('position');
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i));
  // Sink it slightly, so stones sit IN the ground rather than on it.
  g.translate(0, -minY * 0.6, 0);
  return paint(g, Palette.rock, Palette.rockDark, 0.4, 0);
}

function driftwood(rng: Rng): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.11, 0.15, rng.range(1.2, 1.8), 5);
  g.rotateZ(Math.PI / 2);
  g.translate(0, 0.13, 0);
  return paint(g, Palette.driftwood, Palette.woodDark, 0.3, 0);
}

function buildKinds(): Kind[] {
  const rng = new Rng('dressing-geo');
  return [
    { name: 'grass', geometry: grassTuft(rng), sway: true, doubleSide: true },
    { name: 'reed', geometry: grassTuft(rng, true), sway: true, doubleSide: true },
    // Only the big bushes cast. A knee-high bush's shadow is a smudge under
    // its own canopy that nobody can see, and the shadow pass was the single
    // most expensive thing in the frame.
    { name: 'bush', geometry: bush(rng), sway: true },
    { name: 'bushBig', geometry: bush(rng, true), sway: true, castShadow: true },
    { name: 'fern', geometry: fern(rng), sway: true, doubleSide: true },
    { name: 'flowerStem', geometry: flowerStems(rng), sway: true, doubleSide: true },
    { name: 'flowerHead', geometry: flowerHeads(), sway: true, tinted: true, doubleSide: true },
    { name: 'stone', geometry: stone(rng), sway: false },
    { name: 'driftwood', geometry: driftwood(rng), sway: false },
  ];
}

// ---------------------------------------------------------------------------
// Placement.

const PETALS = [
  Palette.petalRed, Palette.petalYellow, Palette.petalWhite,
  Palette.petalPink, Palette.petalOrange,
];

/**
 * Hand-placed clusters along the route, laid over the procedural field.
 *
 * The scatter alone gets density right and composition wrong: it has no idea
 * that the corner where the dock meets the sand is the first thing anybody
 * sees. These are the beats — a thicket at the shoreline, planting either side
 * of the shop, a hedge line marking where the orchard starts — and they are the
 * difference between "vegetated" and "art directed".
 */
const CLUSTERS: Array<{ x: number; z: number; r: number; mix: string[]; n: number }> = [
  // Where the dock lands on the sand: the first ten metres of the game.
  { x: 63, z: 57, r: 5.5, mix: ['bushBig', 'bush', 'grass', 'stone'], n: 16 },
  { x: 53, z: 67, r: 6.0, mix: ['bush', 'grass', 'driftwood', 'stone'], n: 14 },
  { x: 62, z: 70, r: 5.0, mix: ['grass', 'driftwood', 'stone'], n: 10 },
  // Framing the walk up to the shop.
  { x: 49, z: 62, r: 6.0, mix: ['bushBig', 'bush', 'flower', 'grass'], n: 18 },
  { x: 47, z: 47, r: 5.5, mix: ['bush', 'flower', 'grass'], n: 16 },
  { x: 36, z: 59, r: 6.5, mix: ['bushBig', 'grass', 'flower'], n: 16 },
  { x: 34, z: 46, r: 6.0, mix: ['bush', 'grass', 'stone'], n: 14 },
  // Planting up against the shop, so the landmark sits in something.
  { x: 50.5, z: 49.5, r: 5.5, mix: ['bushBig', 'bush', 'flower', 'grass'], n: 16 },
  { x: 40.5, z: 46.5, r: 5.5, mix: ['bush', 'flower', 'grass'], n: 16 },
  { x: 38.5, z: 58.5, r: 5.0, mix: ['bushBig', 'grass', 'flower'], n: 14 },
  { x: 47.5, z: 58.0, r: 4.5, mix: ['bush', 'grass', 'flower'], n: 12 },
  // The long middle stretch, the emptiest ground on the island.
  { x: 27, z: 55, r: 7.0, mix: ['bushBig', 'bush', 'grass'], n: 16 },
  { x: 22, z: 39, r: 6.5, mix: ['bush', 'flower', 'grass'], n: 16 },
  { x: 14, z: 47, r: 7.0, mix: ['bushBig', 'grass', 'flower'], n: 16 },
  { x: 6, z: 30, r: 6.0, mix: ['bush', 'grass', 'stone'], n: 14 },
  { x: 2, z: 43, r: 7.0, mix: ['bushBig', 'bush', 'grass'], n: 16 },
  // Orchard approach and edges: a hedge line that says "the trees start here".
  { x: -6, z: 34, r: 6.0, mix: ['bushBig', 'bush', 'flower', 'fern'], n: 18 },
  { x: -12, z: 33, r: 5.5, mix: ['bush', 'fern', 'grass'], n: 14 },
  { x: -20, z: 32, r: 6.0, mix: ['bushBig', 'fern', 'flower'], n: 14 },
  { x: -32, z: 26, r: 7.0, mix: ['bush', 'fern', 'grass', 'flower'], n: 16 },
  { x: -30, z: 12, r: 7.0, mix: ['bushBig', 'bush', 'grass'], n: 14 },
  { x: -14, z: 12, r: 6.5, mix: ['bush', 'flower', 'grass'], n: 14 },
  // Inside the orchard itself: long grass and wildflowers under the trees.
  // Without these the terrace is one unbroken sheet of mid-green with tree
  // trunks standing in it, which is what a placeholder orchard looks like.
  { x: -20, z: 24, r: 8.5, mix: ['grass', 'grass', 'flower', 'bush'], n: 26 },
  { x: -28, z: 18, r: 8.0, mix: ['grass', 'flower', 'bushBig'], n: 22 },
  { x: -12, z: 19, r: 7.5, mix: ['grass', 'flower', 'bush'], n: 20 },
  { x: -34, z: 30, r: 7.0, mix: ['bush', 'fern', 'grass'], n: 16 },
  { x: -16, z: 34, r: 6.0, mix: ['grass', 'flower', 'bush'], n: 16 },
  // Waterfall basin: wet ground, so ferns and reeds rather than dry brush.
  { x: 30, z: 4, r: 6.5, mix: ['fern', 'reed', 'stone', 'grass'], n: 18 },
  { x: 42, z: 3, r: 6.0, mix: ['fern', 'reed', 'stone'], n: 14 },
  { x: 22, z: -8, r: 6.0, mix: ['fern', 'reed', 'grass'], n: 14 },
  { x: 48, z: -10, r: 6.0, mix: ['fern', 'bush', 'stone'], n: 14 },
  { x: 34, z: -24, r: 7.0, mix: ['fern', 'reed', 'stone'], n: 16 },
];

/** Buildings and pads the clutter must keep out of, as (x, z, radius). */
const KEEP_CLEAR: Array<[number, number, number]> = [
  [58, 62, 9],        // dock apron and its approach
  [45, 52, 6.2],      // shop shed
  [40.8, 55.4, 5.5],  // sell pad
  [8, -62, 14],       // under the King Melon
];

function scatter(terrain: Terrain): Placement[] {
  const rng = new Rng('dressing');
  const out: Placement[] = [];
  const half = terrain.extent / 2;
  const step = 2.1;

  const push = (kind: string, x: number, z: number, y: number, s: number) => {
    const p: Placement = {
      kind, x, z, y, scale: s, rotY: rng.range(0, TAU), tilt: rng.range(0, 0.09),
    };
    if (kind === 'flower') {
      const color = rng.pick(PETALS);
      out.push({ ...p, kind: 'flowerStem' });
      out.push({ ...p, kind: 'flowerHead', color });
    } else {
      out.push(p);
    }
  };

  const blocked = (x: number, z: number) => {
    // The dock extends far beyond its landward circular exclusion. Test its
    // actual local rectangle so foliage cannot grow through the planking.
    const dx = x - 58, dz = z - 62;
    const localX = dx * 0.6 - dz * 0.8;
    const localZ = dx * 0.8 + dz * 0.6;
    if (Math.abs(localX) < 3.2 && localZ > -3 && localZ < 25) return true;
    for (const [cx, cz, r] of KEEP_CLEAR) {
      if ((x - cx) * (x - cx) + (z - cz) * (z - cz) < r * r) return true;
    }
    return false;
  };

  // ---- the procedural field ----------------------------------------------
  for (let z = -half; z <= half; z += step) {
    for (let x = -half; x <= half; x += step) {
      const px = x + rng.range(-step * 0.48, step * 0.48);
      const pz = z + rng.range(-step * 0.48, step * 0.48);
      const y = terrain.height(px, pz);
      if (y < 0.85 || y > 44) continue;
      const slope = terrain.slope(px, pz);
      if (slope > 0.42) continue;                       // cliffs stay bare
      if (blocked(px, pz)) continue;

      // The route stays walkable and readable: nothing on it, and a thinning
      // band at its shoulders so it has a worn edge rather than a mown one.
      const pw = terrain.pathWeight(px, pz);
      if (pw > 0.42) continue;
      const pathFade = 1 - smoothstep(0.05, 0.42, pw);

      const b = terrain.biome(px, pz, y, slope);
      const clump = clamp(fbm2(px * 0.042, pz * 0.042, 3, 4242) * 0.5 + 0.5, 0, 1);
      const thicket = smoothstep(0.34, 0.78, clump);

      const r = rng.next();
      if (b.grass > 0.45) {
        // Independent bands, not nested tails. The first cut wrote these as
        // `density + 0.055` and so on, which sounds like 5.5% and is in fact
        // 5.5% of whatever grass left over: the island came out with 1,382
        // grass tufts, 454 stones and 73 bushes on it.
        const pGrass = (0.26 + thicket * 0.33) * pathFade;
        const pBush = (0.038 + thicket * 0.085) * pathFade;
        const pFlower = (0.030 + thicket * 0.062) * pathFade;
        const pStone = 0.012 * pathFade;
        if (r < pGrass) {
          push('grass', px, pz, y, rng.range(0.75, 1.45));
        } else if (r < pGrass + pBush) {
          push(rng.chance(0.34) ? 'bushBig' : 'bush', px, pz, y, rng.range(0.8, 1.5));
        } else if (r < pGrass + pBush + pFlower) {
          push('flower', px, pz, y, rng.range(0.8, 1.35));
        } else if (r < pGrass + pBush + pFlower + pStone) {
          push('stone', px, pz, y, rng.range(0.7, 1.6));
        }
        // Ferns want damp, low, sheltered ground, which is most of what
        // separates the waterfall basin and the orchard floor from the ridge.
        if (y < 9 && rng.next() < 0.030 * thicket * pathFade) {
          push('fern', px, pz, y, rng.range(0.8, 1.4));
        }
      } else if (b.sand > 0.5) {
        // Beaches: sparse, and mostly things the tide left.
        if (r < 0.020 * pathFade) push('grass', px, pz, y, rng.range(0.6, 1.0));
        else if (r < 0.030 * pathFade) push('stone', px, pz, y, rng.range(0.7, 1.5));
        else if (r < 0.0345 * pathFade) push('driftwood', px, pz, y, rng.range(0.8, 1.4));
      } else if (b.rock > 0.5 && slope < 0.34) {
        if (r < 0.022 * pathFade) push('stone', px, pz, y, rng.range(0.9, 1.9));
        else if (r < 0.075 * pathFade) push('grass', px, pz, y, rng.range(0.6, 1.0));
      }

      // Reeds gather in the shallows, where the ground is barely above water.
      if (y < 1.7 && slope < 0.16 && rng.next() < 0.055 * pathFade) {
        push('reed', px, pz, y, rng.range(0.8, 1.4));
      }
    }
  }

  // ---- authored clusters --------------------------------------------------
  for (const c of CLUSTERS) {
    for (let i = 0; i < c.n; i++) {
      const a = rng.range(0, TAU);
      const rr = c.r * Math.sqrt(rng.range(0.05, 1));
      const px = c.x + Math.cos(a) * rr;
      const pz = c.z + Math.sin(a) * rr;
      const y = terrain.height(px, pz);
      if (y < 0.85 || terrain.slope(px, pz) > 0.45) continue;
      if (blocked(px, pz)) continue;
      if (terrain.pathWeight(px, pz) > 0.34) continue;
      const kind = rng.pick(c.mix);
      const s = kind === 'bushBig' ? rng.range(1.0, 1.7)
        : kind === 'stone' ? rng.range(0.8, 2.0)
          : rng.range(0.85, 1.5);
      push(kind, px, pz, y, s);
    }
  }

  // Small coherent wildflower drifts at the route shoulders. A separate seed
  // preserves the existing scatter, and a shared petal tint keeps each drift
  // reading as a plant colony rather than multicoloured confetti.
  const flowerRng = new Rng('sunpatch-flower-drifts');
  for (const [cx, cz, r, tint] of [
    [49, 62, 2.4, 0], [34, 57, 2.8, 1], [27, 42, 2.2, 2],
    [17, 46, 2.5, 1], [6, 40, 2.1, 0], [-8, 36, 2.0, 2],
    [-15, 33, 2.4, 1], [-24, 17, 2.0, 0], [28, 5, 2.2, 2],
  ]) {
    const driftColor = [Palette.petalYellow, Palette.petalWhite, Palette.petalPink][tint];
    for (let i = 0; i < 20; i++) {
      const a = flowerRng.range(0, TAU), rr = r * Math.sqrt(flowerRng.next());
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      const y = terrain.height(x, z);
      if (y < 0.85 || terrain.slope(x, z) > 0.4 || blocked(x, z) || terrain.pathWeight(x, z) > 0.25) continue;
      const p: Placement = { kind: 'flowerStem', x, y, z, scale: flowerRng.range(1.1, 1.8),
        rotY: flowerRng.range(0, TAU), tilt: 0.04 };
      out.push(p, { ...p, kind: 'flowerHead', color: driftColor });
    }
  }
  // Clear only the authored workplace footprints after sampling, preserving
  // the seeded placement of vegetation everywhere else on the island.
  // Authored fern colonies make the shaded grove read as a damp habitat.
  // Their independent RNG does not move any existing plants or ground cover.
  const habitatRng = new Rng('sunpatch-habitat-finish');
  for (const [cx, cz, radius, kind, count] of [
    [54, -20, 2.7, 'fern', 18], [67, -21, 2.5, 'fern', 16],
    [60, -9, 2.4, 'fern', 14], [72, -10, 2.5, 'reed', 12],
    [-20, -26, 2.6, 'grass', 15], [-12, -27, 2.2, 'grass', 12],
    [-58, 54, 2.0, 'grass', 10], [-52, 61, 2.2, 'grass', 10],
    [-10, -78, 3.0, 'grass', 12], [7, -85, 2.5, 'grass', 12],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const angle = habitatRng.range(0, TAU), r = radius * Math.sqrt(habitatRng.next());
      const x = cx + Math.cos(angle) * r, z = cz + Math.sin(angle) * r;
      const y = terrain.height(x, z);
      if (y < 0.7 || terrain.slope(x, z) > 0.38 || blocked(x, z) || terrain.pathWeight(x, z) > 0.25) continue;
      out.push({ kind, x, y, z, scale: habitatRng.range(0.9, 1.55),
        rotY: habitatRng.range(0, TAU), tilt: 0.04 });
    }
  }
  return out.filter(p => !(
    (Math.abs(p.x + 16) < 3.5 && Math.abs(p.z + 25) < 2.5) ||
    (Math.abs(p.x + 54) < 2.6 && Math.abs(p.z - 57) < 1.9) ||
    (Math.abs(p.x + 5) < 3.5 && Math.abs(p.z + 40) < 1.4)
  ));
}
