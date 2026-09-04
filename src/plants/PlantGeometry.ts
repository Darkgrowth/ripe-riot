import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '@/core/Rng';

/**
 * Procedural plants. Each type is baked to a single merged geometry carrying:
 *  - `color`      : vertex colours (bark, leaf, highlight)
 *  - `swayWeight` : 0 at the roots, 1 at the tips, so one vertex shader can
 *                   animate the whole plant and the CPU can place fruit using
 *                   exactly the same curve.
 *
 * Local attach points are returned alongside, in the same local space.
 */
export interface PlantShape {
  geometry: THREE.BufferGeometry;
  /** Where fruit hangs, in local space. */
  attachPoints: THREE.Vector3[];
  /** Trunk collider: capsule half-height and radius, centred at y = offset. */
  collider: { halfHeight: number; radius: number; offset: number } | null;
  /** Approximate height, used for LOD and shadow bounds. */
  height: number;
}

const C = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

const BARK = C(0x7a5537);
const BARK_DARK = C(0x593d26);
const PALM_BARK = C(0xa8875c);
const LEAF = C(0x4f9e35);
const LEAF_LIGHT = C(0x74c04a);
const LEAF_DARK = C(0x336f26);
const PALM_LEAF = C(0x57a83c);
const BANANA_LEAF = C(0x5fb043);
const VINE = C(0x5c8f38);
const BUSH = C(0x86b551);

/**
 * Attach `color` and `swayWeight` attributes to a geometry.
 *
 * Also converts to non-indexed: mergeGeometries silently returns null when the
 * inputs disagree about indexing, and Icosahedron/Polyhedron geometries are
 * non-indexed while every other primitive is indexed.
 */
function dress(g: THREE.BufferGeometry, color: THREE.Color | ((y: number, i: number) => THREE.Color),
  swayFn: (y: number) => number): THREE.BufferGeometry {
  if (g.index) { const flat = g.toNonIndexed(); g.dispose(); g = flat; }
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const sway = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const c = typeof color === 'function' ? color(y, i) : color;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    sway[i] = swayFn(y);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('swayWeight', new THREE.BufferAttribute(sway, 1));
  return g;
}

/** The canonical sway curve. Mirrored exactly in the plant vertex shader. */
export function swayCurve(y: number, height: number): number {
  const t = THREE.MathUtils.clamp(y / Math.max(0.5, height), 0, 1);
  return Math.pow(t, 1.6);
}

// ---------------------------------------------------------------------------
/**
 * Broadleaf canopy. A crown blob, a ring of blobs round it at trunk height,
 * and a lower, wider ring of smaller blobs offset by half a step, so the
 * silhouette stacks and the fruit on the lower ring hangs at head height
 * where a player can actually see it.
 *
 * The first pass was four blobs in one ring, coloured only by height within
 * the blob, and the orchard read as bright green spheres on sticks. What sells
 * a low-poly canopy is the underside: faces that point down are shaded toward
 * the dark leaf colour and faces that point up toward the light one, in the
 * vertex colours, so the hierarchy holds in flat light and in shadow alike.
 */
function broadleaf(seed: number, opts: {
  trunkH: number; trunkR: number; blobs: number; blobR: number;
  leaf: THREE.Color; leafAlt: THREE.Color; spread: number; lean: number;
  /** Smaller blobs in a lower ring. */
  underBlobs?: number;
}): PlantShape {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const H = opts.trunkH + opts.blobR * 1.5;

  const trunk = new THREE.CylinderGeometry(opts.trunkR * 0.62, opts.trunkR, opts.trunkH, 7, 3);
  trunk.translate(0, opts.trunkH / 2, 0);
  // A slight lean stops a grove looking like a bar chart.
  trunk.rotateZ(opts.lean);
  parts.push(dress(trunk, (y) => _mix(BARK_DARK, BARK, THREE.MathUtils.clamp(y / opts.trunkH, 0, 1)),
    (y) => swayCurve(y, H) * 0.35));

  // Branches reaching into the canopy.
  const nBranch = 3;
  for (let i = 0; i < nBranch; i++) {
    const a = (i / nBranch) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const len = opts.blobR * rng.range(1.0, 1.5);
    const b = new THREE.CylinderGeometry(opts.trunkR * 0.16, opts.trunkR * 0.34, len, 5);
    b.translate(0, len / 2, 0);
    b.rotateZ(rng.range(0.5, 0.85));
    b.rotateY(a);
    b.translate(Math.sin(a) * 0.02, opts.trunkH * rng.range(0.72, 0.95), Math.cos(a) * 0.02);
    parts.push(dress(b, BARK_DARK, (y) => swayCurve(y, H) * 0.55));
  }

  const attach: THREE.Vector3[] = [];
  const ring = Math.max(1, opts.blobs - 1);
  const under = opts.underBlobs ?? 0;
  for (let i = 0; i < 1 + ring + under; i++) {
    let cx: number, cz: number, cy: number, rad: number;
    let lower = false;
    if (i === 0) {
      // Crown: sits on top of the ring and gives the tree a peak.
      cx = rng.range(-0.15, 0.15); cz = rng.range(-0.15, 0.15);
      cy = opts.trunkH + opts.blobR * 0.6;
      rad = opts.blobR * rng.range(0.88, 1.04);
    } else if (i <= ring) {
      const a = ((i - 1) / ring) * Math.PI * 2 + rng.range(-0.35, 0.35);
      const r = opts.spread * rng.range(0.7, 1.0);
      cx = Math.sin(a) * r; cz = Math.cos(a) * r;
      cy = opts.trunkH + rng.range(-0.15, 0.35);
      rad = opts.blobR * rng.range(0.74, 1.0);
    } else {
      lower = true;
      const a = ((i - 1 - ring) / under) * Math.PI * 2 + Math.PI / Math.max(1, under) + rng.range(-0.3, 0.3);
      const r = opts.spread * rng.range(0.95, 1.3);
      cx = Math.sin(a) * r; cz = Math.cos(a) * r;
      cy = opts.trunkH - opts.blobR * rng.range(0.35, 0.6);
      rad = opts.blobR * rng.range(0.5, 0.74);
    }
    const blob = new THREE.IcosahedronGeometry(rad, 1);
    blob.scale(1.1, 0.78, 1.1);
    // Rough the silhouette up so the canopy is not a row of spheres: one broad
    // lump term and one finer one.
    const p = blob.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k);
      const n = Math.sin(v.x * 2.2 + seed) * Math.cos(v.z * 1.9 - seed) * Math.sin(v.y * 2.6) * 0.15
        + Math.sin(v.x * 5.3 - seed * 0.7) * Math.cos(v.z * 4.7 + seed) * 0.06;
      v.multiplyScalar(1 + n);
      p.setXYZ(k, v.x, v.y, v.z);
    }
    blob.translate(cx, cy, cz);
    const tone = rng.next();
    const dressed = dress(blob, (y) => _mix(
      _mix(LEAF_DARK, opts.leaf, THREE.MathUtils.clamp((y - cy + rad) / (rad * 2), 0, 1)),
      opts.leafAlt, tone * 0.5), (y) => swayCurve(y, H));
    shadeByFacing(dressed, LEAF_DARK, LEAF_LIGHT, lower ? 0.75 : 0.6, 0.35);
    parts.push(dressed);

    // Fruit hangs on the lower outside of each blob. The lower ring is where
    // most of it should be: that is the fruit at head height.
    const perBlob = lower ? 3 : 2;
    // Never against the trunk: a blob on the far side of the axis can put a
    // hanging point within 30 cm of it, where the trunk collider blocks the
    // eye ray and the pick prompt never appears. Push those outward.
    const minAxisR = opts.spread * 0.85;
    for (let k = 0; k < perBlob; k++) {
      // Out near the canopy edge and low on the blob: fruit buried inside
      // the foliage is fruit the player never sees.
      const aa = rng.range(0, Math.PI * 2);
      const rr = rad * rng.range(0.82, 1.05);
      const pt = new THREE.Vector3(
        cx + Math.sin(aa) * rr,
        cy - rad * rng.range(0.45, 0.80),
        cz + Math.cos(aa) * rr,
      );
      const axisR = Math.hypot(pt.x, pt.z);
      if (axisR < minAxisR) {
        const k2 = axisR > 1e-3 ? minAxisR / axisR : 0;
        if (k2 > 0) { pt.x *= k2; pt.z *= k2; }
        else { pt.x = minAxisR; }
      }
      attach.push(pt);
    }
  }

  const geometry = mustMerge(mergeGeometries(parts, false));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return {
    geometry, attachPoints: attach, height: H,
    collider: { halfHeight: opts.trunkH * 0.5, radius: opts.trunkR * 1.15, offset: opts.trunkH * 0.5 },
  };
}

function palm(seed: number): PlantShape {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const H = rng.range(7.5, 10.5);
  const lean = rng.range(0.1, 0.32);
  const leanDir = rng.range(0, Math.PI * 2);

  // Curved trunk built along a spline: palms should never be straight.
  const pts: THREE.Vector3[] = [];
  const segs = 7;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const bend = Math.pow(t, 1.8) * lean * H;
    pts.push(new THREE.Vector3(Math.sin(leanDir) * bend, t * H, Math.cos(leanDir) * bend));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const trunk = new THREE.TubeGeometry(curve, 10, 0.28, 7, false);
  // Taper towards the crown.
  const tp = trunk.getAttribute('position') as THREE.BufferAttribute;
  const c = new THREE.Vector3();
  for (let i = 0; i < tp.count; i++) {
    c.fromBufferAttribute(tp, i);
    const t = THREE.MathUtils.clamp(c.y / H, 0, 1);
    const axis = curve.getPoint(t);
    c.x = axis.x + (c.x - axis.x) * (1 - t * 0.45);
    c.z = axis.z + (c.z - axis.z) * (1 - t * 0.45);
    tp.setXYZ(i, c.x, c.y, c.z);
  }
  parts.push(dress(trunk, (y) => _mix(PALM_BARK, BARK_DARK, Math.abs(Math.sin(y * 3.4)) * 0.35),
    (y) => swayCurve(y, H) * 0.8));

  const top = curve.getPoint(1);
  const nFronds = 8;
  for (let i = 0; i < nFronds; i++) {
    const a = (i / nFronds) * Math.PI * 2 + rng.range(-0.14, 0.14);
    const len = rng.range(2.6, 3.6);
    const droop = rng.range(0.45, 0.95);
    const fpts: THREE.Vector3[] = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      fpts.push(new THREE.Vector3(
        Math.sin(a) * len * t,
        -Math.pow(t, 1.9) * len * droop + 0.1,
        Math.cos(a) * len * t,
      ));
    }
    const fc = new THREE.CatmullRomCurve3(fpts);
    const frond = new THREE.TubeGeometry(fc, 6, 0.055, 4, false);
    // Flatten into a blade.
    const fp = frond.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const perp = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    for (let k = 0; k < fp.count; k++) {
      v.fromBufferAttribute(fp, k);
      const t = THREE.MathUtils.clamp(Math.hypot(v.x, v.z) / len, 0, 1);
      const w = Math.sin(t * Math.PI) * 0.62 + 0.08;
      const along = fc.getPoint(t);
      const off = v.clone().sub(along);
      const side = off.dot(perp);
      v.addScaledVector(perp, side * (w / 0.055 - 1));
      fp.setXYZ(k, v.x, v.y, v.z);
    }
    frond.translate(top.x, top.y, top.z);
    parts.push(dress(frond, (y) => _mix(LEAF_DARK, PALM_LEAF, THREE.MathUtils.clamp((y - top.y + 2) / 2.4, 0, 1)),
      () => 1.0));
  }

  // Coconuts cluster right under the crown, which is why they are dangerous.
  const attach: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const r = rng.range(0.32, 0.55);
    attach.push(new THREE.Vector3(top.x + Math.sin(a) * r, top.y - rng.range(0.15, 0.5), top.z + Math.cos(a) * r));
  }

  const geometry = mustMerge(mergeGeometries(parts, false));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return {
    geometry, attachPoints: attach, height: H,
    collider: { halfHeight: H * 0.45, radius: 0.34, offset: H * 0.45 },
  };
}

function bananaPlant(seed: number): PlantShape {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const H = rng.range(2.9, 3.8);
  const trunk = new THREE.CylinderGeometry(0.17, 0.24, H, 8);
  trunk.translate(0, H / 2, 0);
  parts.push(dress(trunk, C(0x7f9a4a), (y) => swayCurve(y, H) * 0.5));

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const len = rng.range(1.9, 2.7);
    const leaf = new THREE.PlaneGeometry(0.72, len, 2, 5);
    const lp = leaf.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < lp.count; k++) {
      const y = lp.getY(k);
      // Clamp: rounding can put t a hair below 0, and Math.pow(-1e-17, 2.1)
      // is NaN, which then poisons the merged geometry's bounding sphere.
      const t = THREE.MathUtils.clamp((y + len / 2) / len, 0, 1);
      lp.setX(k, lp.getX(k) * (0.35 + Math.sin(t * Math.PI) * 0.9));
      lp.setZ(k, -Math.pow(t, 2.1) * len * 0.55);
    }
    leaf.rotateX(-Math.PI / 2);
    leaf.translate(0, 0, len / 2);
    leaf.rotateY(a);
    leaf.rotateZ(rng.range(-0.15, 0.15));
    leaf.translate(0, H * rng.range(0.82, 1.0), 0);
    parts.push(dress(leaf, BANANA_LEAF, () => 1.0));
  }

  const attach = [new THREE.Vector3(0.15, H * 0.78, 0.05), new THREE.Vector3(-0.18, H * 0.68, -0.1)];
  const geometry = mustMerge(mergeGeometries(parts, false));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return {
    geometry, attachPoints: attach, height: H,
    collider: { halfHeight: H * 0.45, radius: 0.26, offset: H * 0.45 },
  };
}

function bush(seed: number, color: THREE.Color, radius: number, attachOnTop: number): PlantShape {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const H = radius * 1.6;
  for (let i = 0; i < 4; i++) {
    const b = new THREE.IcosahedronGeometry(radius * rng.range(0.6, 1.0), 1);
    b.scale(1.1, 0.78, 1.1);
    b.translate(rng.range(-radius, radius) * 0.6, radius * rng.range(0.4, 0.8), rng.range(-radius, radius) * 0.6);
    parts.push(dress(b, _mix(color, LEAF_DARK, rng.next() * 0.4), (y) => swayCurve(y, H) * 0.7));
  }
  const attach: THREE.Vector3[] = [];
  for (let i = 0; i < attachOnTop; i++) {
    const a = (i / attachOnTop) * Math.PI * 2 + rng.range(-0.5, 0.5);
    attach.push(new THREE.Vector3(Math.sin(a) * radius * 0.55, radius * rng.range(0.95, 1.25), Math.cos(a) * radius * 0.55));
  }
  const geometry = mustMerge(mergeGeometries(parts, false));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, attachPoints: attach, height: H, collider: null };
}

function melonVine(seed: number): PlantShape {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0.3, 1.5);
    const leaf = new THREE.CircleGeometry(rng.range(0.28, 0.5), 5);
    leaf.rotateX(-Math.PI / 2);
    leaf.translate(Math.sin(a) * r, 0.09 + rng.range(0, 0.06), Math.cos(a) * r);
    parts.push(dress(leaf, _mix(LEAF, LEAF_DARK, rng.next() * 0.6), () => 0.4));
  }
  // A short stem loop so the melon looks connected to something.
  const stem = new THREE.TorusGeometry(0.22, 0.035, 4, 8, Math.PI);
  stem.rotateX(Math.PI / 2);
  stem.translate(0, 0.12, 0);
  parts.push(dress(stem, VINE, () => 0.3));

  const geometry = mustMerge(mergeGeometries(parts, false));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, attachPoints: [new THREE.Vector3(0, 0.30, 0)], height: 0.5, collider: null };
}

/** A vine hanging from above with the fruit on the end, under tension. */
function vinebombVine(seed: number): PlantShape {
  const rng = new Rng(seed);
  const len = rng.range(2.2, 3.4);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(rng.range(-0.2, 0.2), -len * 0.4, rng.range(-0.2, 0.2)),
    new THREE.Vector3(rng.range(-0.35, 0.35), -len * 0.78, rng.range(-0.35, 0.35)),
    new THREE.Vector3(0, -len, 0),
  ]);
  const tube = new THREE.TubeGeometry(curve, 12, 0.055, 5, false);
  const g = dress(tube, VINE, (y) => THREE.MathUtils.clamp(-y / len, 0, 1) * 0.9);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return {
    geometry: g,
    attachPoints: [new THREE.Vector3(0, -len - 0.16, 0)],
    height: len,
    collider: null,
  };
}

// ---------------------------------------------------------------------------
export type PlantType = 'appleTree' | 'orangeTree' | 'palm' | 'bananaPlant'
  | 'melonVine' | 'puffBush' | 'vinebombVine';

const SHAPE_CACHE = new Map<string, PlantShape>();

/** Each type has a few pre-baked shape variants so a grove is not clones. */
export const SHAPE_VARIANTS = 3;

function mustMerge(g: THREE.BufferGeometry | null): THREE.BufferGeometry {
  if (!g) throw new Error('plant geometry merge failed (mismatched attributes?)');
  return g;
}

export function plantShape(type: PlantType, variant: number): PlantShape {
  const key = `${type}:${variant}`;
  const hit = SHAPE_CACHE.get(key);
  if (hit) return hit;
  const seed = Rng.hash(key);
  let s: PlantShape;
  switch (type) {
    case 'appleTree':
      s = broadleaf(seed, { trunkH: 3.1 + (variant % 3) * 0.35, trunkR: 0.24, blobs: 5, blobR: 1.45,
        leaf: LEAF, leafAlt: LEAF_LIGHT, spread: 1.3, lean: (variant - 1) * 0.045, underBlobs: 3 }); break;
    case 'orangeTree':
      s = broadleaf(seed, { trunkH: 2.7 + (variant % 3) * 0.3, trunkR: 0.21, blobs: 4, blobR: 1.3,
        leaf: C(0x3f8f31), leafAlt: C(0x67ad3e), spread: 1.05, lean: (variant - 1) * 0.05, underBlobs: 2 }); break;
    case 'palm': s = palm(seed); break;
    case 'bananaPlant': s = bananaPlant(seed); break;
    case 'melonVine': s = melonVine(seed); break;
    case 'puffBush': s = bush(seed, BUSH, 0.95, 3); break;
    case 'vinebombVine': s = vinebombVine(seed); break;
    default: s = broadleaf(seed, { trunkH: 3, trunkR: 0.22, blobs: 3, blobR: 1.4,
      leaf: LEAF, leafAlt: LEAF_LIGHT, spread: 1.1, lean: 0 });
  }
  SHAPE_CACHE.set(key, s);
  return s;
}

/**
 * Shade a non-indexed geometry's vertex colours by which way each face points:
 * downward faces toward `dark`, upward faces toward `light`. This is what
 * gives a faceted canopy a top and an underside regardless of how the sun and
 * the hemisphere fill happen to land on it.
 */
function shadeByFacing(g: THREE.BufferGeometry, dark: THREE.Color, light: THREE.Color,
  darkAmount: number, lightAmount: number): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = g.getAttribute('color') as THREE.BufferAttribute;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), t = new THREE.Vector3();
  const cc = new THREE.Color();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(b, a).cross(t.subVectors(c, a));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    const down = n.y < 0 ? -n.y * darkAmount : 0;
    const up = n.y > 0.25 ? (n.y - 0.25) / 0.75 * lightAmount : 0;
    if (down <= 0 && up <= 0) continue;
    for (let j = 0; j < 3; j++) {
      cc.setRGB(col.getX(i + j), col.getY(i + j), col.getZ(i + j));
      if (down > 0) cc.lerp(dark, down);
      if (up > 0) cc.lerp(light, up);
      col.setXYZ(i + j, cc.r, cc.g, cc.b);
    }
  }
}

function _mix(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return new THREE.Color().copy(a).lerp(b, THREE.MathUtils.clamp(t, 0, 1));
}
