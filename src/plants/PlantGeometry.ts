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
  harvestCrown?: boolean;
  /** Three authored crown habits, independent of attachment sampling. */
  crownStyle?: number;
}): PlantShape {
  const rng = new Rng(seed);
  // Art variation has its own stream: fruit attachment coordinates are saved
  // gameplay data, so refining a crown must never reshuffle the harvest.
  const art = new Rng(`${seed}:orchard-crown`);
  const parts: THREE.BufferGeometry[] = [];
  const H = opts.trunkH + opts.blobR * 1.5;
  const crownStyle = opts.crownStyle ?? 0;

  const trunk = new THREE.CylinderGeometry(opts.trunkR * 0.62, opts.trunkR, opts.trunkH, 7, 3);
  trunk.translate(0, opts.trunkH / 2, 0);
  const trunkPos = trunk.getAttribute('position') as THREE.BufferAttribute;
  const bend = art.range(-0.065, 0.065);
  for (let i = 0; i < trunkPos.count; i++) {
    const t = trunkPos.getY(i) / opts.trunkH;
    // Reuse the existing three trunk segments for a slight elbow. The roots
    // and crown retain their original positions, as does the collider.
    trunkPos.setZ(i, trunkPos.getZ(i) + Math.sin(t * Math.PI) * bend);
  }
  // A slight lean stops a grove looking like a bar chart.
  trunk.rotateZ(opts.lean);
  parts.push(dress(trunk, (y) => _mix(BARK_DARK, BARK, THREE.MathUtils.clamp(y / opts.trunkH, 0, 1)),
    (y) => swayCurve(y, H) * 0.35));

  // Branches reaching into the canopy.
  const nBranch = 3;
  for (let i = 0; i < nBranch; i++) {
    const a = (i / nBranch) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const len = opts.blobR * rng.range(1.0, 1.5);
    const angle = rng.range(0.5, 0.85);
    const baseY = opts.trunkH * rng.range(0.72, 0.95);
    // Lower the fork just enough to show below the leaf skirt, then reach
    // back into the same crown. Two segments give the limb a woody elbow.
    const drop = opts.trunkR * 1.6;
    const branchLen = len + drop;
    const b = new THREE.CylinderGeometry(opts.trunkR * 0.13, opts.trunkR * 0.40, branchLen, 5, 2);
    b.translate(0, branchLen / 2, 0);
    const bp = b.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < bp.count; k++) {
      const t = bp.getY(k) / branchLen;
      bp.setX(k, bp.getX(k) + Math.sin(t * Math.PI) * opts.trunkR * 0.7);
    }
    b.rotateZ(angle);
    b.rotateY(a);
    const forkY = baseY - drop;
    b.translate(-Math.sin(opts.lean) * forkY, forkY, Math.sin(forkY / opts.trunkH * Math.PI) * bend);
    if (opts.harvestCrown) b.dispose();
    else parts.push(dress(b, _mix(BARK_DARK, BARK, 0.32), (y) => swayCurve(y, H) * 0.55));
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
    // Each existing lobe has a different growing direction. A taller crown,
    // oblique side masses and smaller leaf skirts avoid a stack of matching
    // horizontal disks without increasing the canopy's triangle count.
    const aspect = art.range(0.94, 1.06);
    const vertical = i === 0 ? art.range(0.84, 0.92)
      : lower ? art.range(0.70, 0.78) : art.range(0.76, 0.88);
    blob.scale(1.1 * aspect, vertical, 1.1 / aspect);
    blob.rotateY(art.range(0, Math.PI));
    blob.rotateZ(art.range(-0.10, 0.10));
    // Rough the silhouette up so the canopy is not a row of spheres: one broad
    // lump term and one finer one.
    const p = blob.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k);
      const n = Math.sin(v.x * 2.2 + seed) * Math.cos(v.z * 1.9 - seed) * Math.sin(v.y * 2.6) * 0.15
        + Math.sin(v.x * 5.3 - seed * 0.7) * Math.cos(v.z * 4.7 + seed) * 0.06;
      v.multiplyScalar(1 + n);
      // Tuck the lower silhouette in slightly so low hanging fruit remains
      // readable against a broken leaf edge instead of a broad flat skirt.
      const skirt = THREE.MathUtils.smoothstep(-v.y / rad, 0.05, 0.75);
      v.x *= 1 - skirt * 0.10;
      v.z *= 1 - skirt * 0.10;
      p.setXYZ(k, v.x, v.y, v.z);
    }
    // Pruned fans leave fruit against open sky. Compact, spreading and upright
    // habits break the repeating layer cake without changing any fruit nodes.
    const lift = opts.harvestCrown ? (i === 0 ? 0.04 : lower ? 0.30 : 0.14) : 0;
    if (opts.harvestCrown) {
      const habits = [[0.82, 0.78, 0.76], [0.92, 0.68, 0.72], [0.73, 0.84, 0.88]];
      const habit = habits[crownStyle % 3];
      blob.scale(habit[0] * (lower ? 0.93 : 1), habit[1] * (lower ? 0.92 : 1), habit[2]);
      // Neighbouring fans incline along their own limb, rather than all
      // exposing exactly horizontal undersides. No new geometry is needed.
      blob.rotateZ(Math.sin(i * 2.3 + crownStyle) * 0.14);
      blob.rotateY(crownStyle * 0.6);
    }
    blob.translate(cx, cy + lift, cz);
    const tone = rng.next();
    const lobeLeaf = _mix(opts.leaf, opts.leafAlt, tone * 0.72);
    // Broad warm/cool masses, not random triangles: the eye should read a
    // cluster of foliage first and its facets second.
    lobeLeaf.lerp(art.next() > 0.5 ? C(0x9ab84a) : C(0x367e45), art.range(0.06, 0.20));
    if (opts.harvestCrown) lobeLeaf.copy(_mix(C(0x4c8051), C(0x95aa64), tone * 0.6 + crownStyle * 0.035));
    const leafDark = opts.harvestCrown ? C(0x38613d) : LEAF_DARK;
    const lobeLight = _mix(lobeLeaf, opts.harvestCrown ? C(0xbccb82) : LEAF_LIGHT, 0.48);
    const dressed = dress(blob, (y) => _mix(
      leafDark, lobeLeaf, THREE.MathUtils.clamp((y - cy + rad * 1.3) / (rad * 1.8), 0, 1)),
    (y) => swayCurve(y, H));
    shadeByFacing(dressed, leafDark, lobeLight, lower ? 0.68 : 0.55, 0.28);
    parts.push(dressed);

    // Fruit hangs on the lower outside of each blob. The lower ring is where
    // most of it should be: that is the fruit at head height.
    const perBlob = lower ? 3 : 2;
    // Never against the trunk: a blob on the far side of the axis can put a
    // hanging point within 30 cm of it, where the trunk collider blocks the
    // eye ray and the pick prompt never appears. Push those outward.
    const minAxisR = opts.spread * 0.85;
    const nodeStart = attach.length;
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
    if (opts.harvestCrown) {
      const nodes = attach.slice(nodeStart);
      const center = new THREE.Vector3(cx, cy + lift, cz);
      if (i > 0 && !lower) {
        // Substantial forked limbs support the fans. Their roots follow the
        // trunk's lean; the branches meet the foliage instead of ending in
        // disconnected twigs below it. These are visual geometry only.
        const forkY = opts.trunkH * (0.69 + (i % 2) * 0.07);
        const fork = new THREE.Vector3(-Math.sin(opts.lean) * forkY, forkY,
          Math.sin(forkY / opts.trunkH * Math.PI) * bend);
        const end = center.clone().add(new THREE.Vector3(0, -rad * 0.10, 0));
        const elbow = fork.clone().lerp(end, 0.58);
        elbow.y -= 0.10;
        parts.push(harvestBranch(fork, elbow, opts.trunkR * 0.43, H, 0.35, 0.70));
        parts.push(harvestBranch(elbow, end, opts.trunkR * 0.43 * 0.55, H, 0.70, 1));
      }
      for (const pt of nodes) {
        // Only the exposed fruiting spur is needed. The main fork already
        // reaches into the crown; connecting every saved node to the trunk
        // creates a thicket of bare spokes after the fruit is picked.
        const tip = pt.clone().add(new THREE.Vector3(0, 0.20, 0));
        const direction = tip.clone().sub(center).normalize();
        const root = center.clone().addScaledVector(direction, rad * 0.50);
        parts.push(harvestBranch(root, tip, 0.022, H));
        // A pair of broad leaf blades makes the spur read as living growth,
        // including attachment sites waiting for their next crop.
        for (const side of [-1, 1]) {
          const blade = new THREE.OctahedronGeometry(0.115);
          blade.scale(1.65, 0.20, 0.65);
          blade.rotateZ(side * 0.38);
          const leafAngle = Math.atan2(direction.x, direction.z);
          blade.rotateY(leafAngle);
          blade.translate(tip.x + Math.cos(leafAngle) * side * 0.085,
            tip.y + 0.055, tip.z - Math.sin(leafAngle) * side * 0.085);
          parts.push(dress(blade, side > 0 ? lobeLight : lobeLeaf, y => swayCurve(y, H)));
        }
      }
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

function harvestBranch(from: THREE.Vector3, to: THREE.Vector3, radius: number,
  height: number, rootSway = 1, tipSway = 1): THREE.BufferGeometry {
  const dir = to.clone().sub(from);
  const g = new THREE.CylinderGeometry(radius * 0.55, radius, dir.length(), 5);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  return dress(g, C(0x6b4d35), y => swayCurve(y, height) * THREE.MathUtils.lerp(rootSway, tipSway,
    THREE.MathUtils.clamp((y - from.y) / (to.y - from.y || 1), 0, 1)));
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

function bush(seed: number, color: THREE.Color, radius: number, attachOnTop: number,
  opts: { dark?: THREE.Color; light?: THREE.Color; attachY?: [number, number]; stem?: boolean } = {}): PlantShape {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const H = radius * 1.6;
  const dark = opts.dark ?? LEAF_DARK;
  if (opts.stem) {
    // A short woody trunk under the foliage, so the thing reads as a small
    // tree rather than a hedge, and the fruit hangs from something.
    const trunk = new THREE.CylinderGeometry(0.12, 0.18, radius * 0.9, 6);
    trunk.translate(0, radius * 0.45, 0);
    parts.push(dress(trunk, BARK_DARK, (y) => swayCurve(y, H) * 0.3));
  }
  for (let i = 0; i < 4; i++) {
    const b = new THREE.IcosahedronGeometry(radius * rng.range(0.6, 1.0), 1);
    b.scale(1.1, 0.78, 1.1);
    const lift = opts.stem ? radius * 0.5 : 0;
    b.translate(rng.range(-radius, radius) * 0.6, lift + radius * rng.range(0.4, 0.8), rng.range(-radius, radius) * 0.6);
    const dressed = dress(b, _mix(color, dark, rng.next() * 0.4), (y) => swayCurve(y, H) * 0.7);
    if (opts.light) shadeByFacing(dressed, dark, opts.light, 0.55, 0.3);
    parts.push(dressed);
  }
  const attach: THREE.Vector3[] = [];
  const [y0, y1] = opts.attachY ?? [0.95, 1.25];
  for (let i = 0; i < attachOnTop; i++) {
    const a = (i / attachOnTop) * Math.PI * 2 + rng.range(-0.5, 0.5);
    attach.push(new THREE.Vector3(Math.sin(a) * radius * 0.55, radius * rng.range(y0, y1), Math.cos(a) * radius * 0.55));
  }
  const geometry = mustMerge(mergeGeometries(parts, false));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return {
    geometry, attachPoints: attach, height: H,
    collider: opts.stem ? { halfHeight: radius * 0.4, radius: 0.2, offset: radius * 0.45 } : null,
  };
}

/**
 * The Boulder Plum's nest: a squat woody stump ringed by broad dark leaves,
 * with the fruit sitting on top at knee height. It has to look like it could
 * hold forty-eight kilos, and like the plum would roll the moment it left.
 */
function boulderNest(seed: number): PlantShape {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const stump = new THREE.CylinderGeometry(0.2, 0.3, 0.5, 7);
  stump.translate(0, 0.25, 0);
  parts.push(dress(stump, BARK_DARK, () => 0.1));
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const r = rng.range(0.55, 1.35);
    const leaf = new THREE.CircleGeometry(rng.range(0.42, 0.68), 5);
    leaf.rotateX(-Math.PI / 2);
    leaf.rotateZ(rng.range(-0.18, 0.18));
    leaf.translate(Math.sin(a) * r, 0.1 + rng.range(0, 0.1), Math.cos(a) * r);
    parts.push(dress(leaf, _mix(LEAF_DARK, C(0x2c5a3e), rng.next() * 0.7), () => 0.35));
  }
  const geometry = mustMerge(mergeGeometries(parts, false));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return {
    geometry, height: 0.9, collider: null,
    attachPoints: [new THREE.Vector3(0, 0.76, 0), new THREE.Vector3(0.82, 0.42, 0.4)],
  };
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
  const tube = new THREE.TubeGeometry(curve, 18, 0.055, 8, false);
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
  | 'melonVine' | 'puffBush' | 'vinebombVine' | 'boulderBush' | 'gumTree' | 'spikeShrub';

const SHAPE_CACHE = new Map<string, PlantShape>();

/** Each type has a few pre-baked shape variants so a grove is not clones. */
export const SHAPE_VARIANTS = 3;

function mustMerge(g: THREE.BufferGeometry | null): THREE.BufferGeometry {
  if (!g) throw new Error('plant geometry merge failed (mismatched attributes?)');
  return g;
}

export function plantShape(type: PlantType, variant: number, harvestCrown = false): PlantShape {
  const baseKey = `${type}:${variant}`;
  const key = baseKey + (harvestCrown ? ':harvest' : '');
  const hit = SHAPE_CACHE.get(key);
  if (hit) return hit;
  const seed = Rng.hash(baseKey);
  let s: PlantShape;
  switch (type) {
    case 'appleTree':
      s = broadleaf(seed, { trunkH: 3.1 + (variant % 3) * 0.35, trunkR: 0.24, blobs: 5, blobR: 1.45,
        leaf: LEAF, leafAlt: LEAF_LIGHT, spread: 1.3, lean: (variant - 1) * 0.045, underBlobs: 3, harvestCrown, crownStyle: variant }); break;
    case 'orangeTree':
      s = broadleaf(seed, { trunkH: 2.7 + (variant % 3) * 0.3, trunkR: 0.21, blobs: 4, blobR: 1.3,
        leaf: C(0x3f8f31), leafAlt: C(0x67ad3e), spread: 1.05, lean: (variant - 1) * 0.05, underBlobs: 2, harvestCrown, crownStyle: (variant + 1) % 3 }); break;
    case 'palm': s = palm(seed); break;
    case 'bananaPlant': s = bananaPlant(seed); break;
    case 'melonVine': s = melonVine(seed); break;
    case 'puffBush': s = bush(seed, BUSH, 0.95, 3); break;
    case 'vinebombVine': s = vinebombVine(seed); break;
    case 'boulderBush': s = boulderNest(seed); break;
    // Olive and glossy-lit, on a stem, fruit hanging at chest height.
    case 'gumTree': s = bush(seed, C(0x8a8f38), 1.15, 4,
      { dark: C(0x4f5a1e), light: C(0xc9c465), attachY: [0.55, 0.85], stem: true }); break;
    // Blue-dark and low: it should look like something you would not put a
    // hand into even before you have read the prompt.
    case 'spikeShrub': s = bush(seed, C(0x2f6a5a), 1.0, 4,
      { dark: C(0x173d33), light: C(0x4f9a7e), attachY: [0.7, 1.1] }); break;
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
