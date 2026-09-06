import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Every fruit is generated in code — no meshes to author, load or licence.
 *
 * Two rules make the whole rendering path cheap:
 *  1. Geometry is built at unit diameter (radius 0.5) so an instance's scale is
 *     literally the fruit's size in metres.
 *  2. The species' natural colouring lives in the geometry's vertex colours,
 *     which lets one InstancedMesh per species carry stems, leaves and stripes.
 *     Per-fruit tint (variant, ripeness, damage) rides on instanceColor and
 *     multiplies over the top.
 */

const cache = new Map<string, THREE.BufferGeometry>();

/**
 * mergeGeometries returns null rather than throwing when its inputs disagree
 * about attributes or indexing, which turns a geometry mistake into a confusing
 * crash three frames later. Fail loudly, at the source.
 */
function must(g: THREE.BufferGeometry | null, what: string): THREE.BufferGeometry {
  if (!g) throw new Error(`fruit geometry merge failed for "${what}" (mismatched attributes?)`);
  return g;
}

export function fruitGeometry(species: string): THREE.BufferGeometry {
  const hit = cache.get(species);
  if (hit) return hit;
  const geo = build(species);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  cache.set(species, geo);
  return geo;
}

function build(species: string): THREE.BufferGeometry {
  switch (species) {
    case 'apple': return apple();
    case 'orange': return orange();
    case 'coconut': return coconut();
    case 'watermelon': return watermelon();
    case 'puffmelon': return puffmelon();
    case 'vinebomb': return vinebomb();
    case 'banana': return banana();
    case 'boulderplum': return boulderplum();
    case 'gluefruit': return gluefruit();
    case 'spikefruit': return spikefruit();
    default: return apple();
  }
}

// ---------------------------------------------------------------------------
// colour helpers
// ---------------------------------------------------------------------------
const C = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

/**
 * Paint every vertex a single colour, and drop the index buffer.
 *
 * mergeGeometries returns null if some inputs are indexed and others are not;
 * Icosahedron is non-indexed, Sphere/Cylinder/Lathe are indexed. Normalising
 * here means species can freely mix primitives.
 */
function paint(g: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  if (g.index) { const flat = g.toNonIndexed(); g.dispose(); g = flat; }
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Paint per vertex from a callback, for stripes and gradients. */
function paintBy(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number, out: THREE.Color) => void): THREE.BufferGeometry {
  if (g.index) { const flat = g.toNonIndexed(); g.dispose(); g = flat; }
  const pos = g.getAttribute('position');
  const arr = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), c);
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Displace vertices radially by a smooth pseudo-random field. */
function lumpy(g: THREE.BufferGeometry, amount: number, freq: number, seed = 0): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * freq + seed) * Math.cos(v.y * freq * 1.3 + seed * 2) * Math.sin(v.z * freq * 0.9 + seed * 3);
    const len = v.length() || 1;
    v.multiplyScalar(1 + (n * amount) / len);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  return g;
}

/** Pinch the poles inward, which is what makes an apple read as an apple. */
function dimple(g: THREE.BufferGeometry, depth: number, sharpness = 3): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = Math.abs(v.y) / 0.5;
    const k = Math.pow(Math.max(0, t), sharpness);
    v.y -= Math.sign(v.y) * k * depth;
    // Widen the shoulders so the pinch does not just shorten the fruit.
    const w = 1 + k * depth * 0.55;
    v.x *= w; v.z *= w;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  return g;
}

function stem(length: number, radius: number, color: THREE.Color, tilt = 0.22): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius * 0.8, radius, length, 5, 1);
  g.translate(0, length / 2, 0);
  g.rotateZ(tilt);
  return paint(g, color);
}

function leaf(size: number, color: THREE.Color): THREE.BufferGeometry {
  // A flattened, tapered diamond reads as a leaf at any distance.
  const g = new THREE.ConeGeometry(size * 0.42, size, 4, 1);
  g.scale(1, 1, 0.22);
  g.rotateZ(Math.PI / 2);
  g.rotateY(0.35);
  return paint(g, color);
}

// ---------------------------------------------------------------------------
// species
// ---------------------------------------------------------------------------
function apple(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.5, 18, 14);
  body.scale(1, 0.94, 1);
  dimple(body, 0.11, 3.2);
  const red = C(0xd23b2e), redDark = C(0x9c2418), blush = C(0xf0a03a);
  const painted = paintBy(body, (x, y, z, out) => {
    // Sun-blush on one side, darker in the pole wells.
    const side = (x * 0.7 + z * 0.7) / 0.5;
    out.copy(redDark).lerp(red, THREE.MathUtils.clamp(0.45 + side * 0.5, 0, 1));
    out.lerp(blush, THREE.MathUtils.clamp(side * 0.35, 0, 0.32));
    const pole = Math.pow(Math.abs(y) / 0.5, 3);
    out.multiplyScalar(1 - pole * 0.35);
  });
  const s = stem(0.2, 0.022, C(0x6b4b2a));
  s.translate(0, 0.4, 0);
  const l = leaf(0.2, C(0x4f9e35));
  l.translate(0.11, 0.5, 0);
  return must(mergeGeometries([painted, s, l], false), 'apple');
}

function orange(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.5, 16, 12);
  lumpy(body, 0.012, 26, 3);
  body.scale(1, 0.95, 1);
  const o = C(0xf08c1e), oDark = C(0xc96a10);
  const painted = paintBy(body, (x, y, z, out) => {
    const n = Math.sin(x * 30) * Math.sin(y * 30) * Math.sin(z * 30);
    out.copy(o).lerp(oDark, THREE.MathUtils.clamp(0.4 + n * 0.5, 0, 1) * 0.5);
    out.multiplyScalar(1 - Math.pow(Math.abs(y) / 0.5, 4) * 0.25);
  });
  let calyx = new THREE.CylinderGeometry(0.06, 0.09, 0.04, 6);
  calyx.translate(0, 0.46, 0);
  const calyxPainted = paint(calyx, C(0x4f7d2a));
  return must(mergeGeometries([painted, calyxPainted], false), 'orange');
}

function coconut(): THREE.BufferGeometry {
  // Low-poly and faceted: a coconut should look hard.
  const body = new THREE.IcosahedronGeometry(0.5, 1);
  body.scale(1, 1.06, 0.98);
  lumpy(body, 0.02, 9, 7);
  const brown = C(0x7b5432), brownDark = C(0x4f3520), hair = C(0x9a6f42);
  const painted = paintBy(body, (x, y, z, out) => {
    const streak = Math.sin(Math.atan2(z, x) * 9 + y * 6);
    out.copy(brown).lerp(brownDark, THREE.MathUtils.clamp(0.5 + streak * 0.5, 0, 1) * 0.55);
    out.lerp(hair, THREE.MathUtils.clamp(y / 0.5, 0, 1) * 0.28);
  });
  // Three eyes on top, the detail everyone recognises.
  const eyes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const e = new THREE.CircleGeometry(0.055, 6);
    e.rotateX(-Math.PI / 2);
    const a = (i / 3) * Math.PI * 2;
    e.translate(Math.cos(a) * 0.14, 0.5, Math.sin(a) * 0.14);
    eyes.push(paint(e, C(0x2c1c0f)));
  }
  return must(mergeGeometries([painted, ...eyes], false), 'coconut');
}

function watermelon(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.5, 22, 16);
  body.scale(1, 0.82, 1);
  const light = C(0x7fc24a), dark = C(0x2f6b28);
  const painted = paintBy(body, (x, y, z, out) => {
    // Vertical stripes from the angle around the long axis.
    const theta = Math.atan2(z, x);
    const s = Math.sin(theta * 9);
    const wob = Math.sin(y * 12) * 0.18;
    out.copy(light).lerp(dark, THREE.MathUtils.smoothstep(s + wob, -0.15, 0.35));
    out.multiplyScalar(1 - Math.pow(Math.abs(y) / 0.41, 4) * 0.2);
  });
  const s = stem(0.13, 0.03, C(0x5f7d33), 0.5);
  s.translate(0, 0.38, 0);
  return must(mergeGeometries([painted, s], false), 'watermelon');
}

function puffmelon(): THREE.BufferGeometry {
  // Deliberately faceted and slightly irregular: it should look like it is
  // holding its breath.
  const body = new THREE.IcosahedronGeometry(0.5, 2);
  lumpy(body, 0.035, 7, 11);
  const pale = C(0xeef0cd), tint = C(0xbcd7a4), seam = C(0x9dbd8c);
  const painted = paintBy(body, (x, y, z, out) => {
    const theta = Math.atan2(z, x);
    const ribs = Math.abs(Math.sin(theta * 6));
    out.copy(pale).lerp(tint, THREE.MathUtils.clamp(0.35 + y, 0, 1) * 0.5);
    out.lerp(seam, Math.pow(ribs, 6) * 0.6);
  });
  const nub = new THREE.SphereGeometry(0.07, 6, 5);
  nub.translate(0, 0.47, 0);
  const nubPainted = paint(nub, C(0x8fae7c));
  return must(mergeGeometries([painted, nubPainted], false), 'puffmelon');
}

function vinebomb(): THREE.BufferGeometry {
  // Pear/teardrop silhouette so it reads as "under tension" even at rest.
  const pts: THREE.Vector2[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = -0.5 + t;
    const r = Math.sin(Math.pow(t, 0.78) * Math.PI) * 0.5 * (1 - t * 0.22) + 0.02;
    pts.push(new THREE.Vector2(Math.max(0.001, r), y));
  }
  const body = new THREE.LatheGeometry(pts, 16);
  const plum = C(0x8d3fa8), plumDark = C(0x53206b), sheen = C(0xc47ad8);
  const painted = paintBy(body, (x, y, z, out) => {
    const t = (y + 0.5);
    out.copy(plumDark).lerp(plum, THREE.MathUtils.clamp(t * 1.3, 0, 1));
    const side = THREE.MathUtils.clamp((x * 0.8 + z * 0.6) / 0.5, 0, 1);
    out.lerp(sheen, side * 0.22);
  });
  const stub = new THREE.CylinderGeometry(0.05, 0.075, 0.16, 6);
  stub.translate(0, 0.55, 0);
  const stubPainted = paint(stub, C(0x5c8f38));
  return must(mergeGeometries([painted, stubPainted], false), 'vinebomb');
}

function banana(): THREE.BufferGeometry {
  // A bunch: several curved prisms fanned around a stalk.
  const parts: THREE.BufferGeometry[] = [];
  const yellow = C(0xf2c53d), tipDark = C(0x7a5a1c);
  for (let i = 0; i < 5; i++) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.42, 0),
      new THREE.Vector3(0.10, 0.16, 0.02),
      new THREE.Vector3(0.16, -0.14, 0.02),
      new THREE.Vector3(0.10, -0.40, 0),
    ]);
    const g = new THREE.TubeGeometry(curve, 8, 0.062, 5, false);
    const gp = paintBy(g, (x, y, z, out) => {
      out.copy(yellow).lerp(tipDark, THREE.MathUtils.clamp((-y - 0.24) * 3, 0, 1) * 0.8);
    });
    const a = (i / 5) * Math.PI * 2;
    gp.rotateY(a);
    parts.push(gp);
  }
  const stalk = new THREE.CylinderGeometry(0.055, 0.075, 0.2, 6);
  stalk.translate(0, 0.5, 0);
  parts.push(paint(stalk, C(0x6b5426)));
  return must(mergeGeometries(parts, false), 'banana');
}

function boulderplum(): THREE.BufferGeometry {
  // Faceted like a river stone and coloured like a bruise: it has to read as
  // "heavy" from across the hill farm, before anyone has tried to lift it.
  const body = new THREE.IcosahedronGeometry(0.5, 1);
  lumpy(body, 0.03, 6, 5);
  body.scale(1, 0.96, 1);
  const slate = C(0x4b3a5e), facet = C(0x7a6690), bloom = C(0x9c86b8);
  const painted = paintBy(body, (x, y, z, out) => {
    const n = Math.sin(x * 9 + 1) * Math.cos(z * 7 - 2) * Math.sin(y * 11);
    out.copy(slate).lerp(facet, THREE.MathUtils.clamp(0.45 + n * 0.6, 0, 1) * 0.7);
    // A frosted bloom on the top, the way plums have.
    out.lerp(bloom, THREE.MathUtils.clamp(y / 0.5, 0, 1) * 0.28);
  });
  const s = stem(0.14, 0.03, C(0x4a3320), 0.3);
  s.translate(0, 0.44, 0);
  return must(mergeGeometries([painted, s], false), 'boulderplum');
}

function gluefruit(): THREE.BufferGeometry {
  // Amber, glossy, and dripping: three small drops hang off the underside so
  // it looks sticky before it has stuck to anything.
  const body = new THREE.SphereGeometry(0.5, 16, 12);
  body.scale(1, 0.86, 1);
  dimple(body, 0.06, 3);
  const amber = C(0xe3a12c), amberDark = C(0xb2711a), gloss = C(0xf8d37a);
  const painted = paintBy(body, (x, y, z, out) => {
    const side = (x * 0.7 + z * 0.7) / 0.5;
    out.copy(amberDark).lerp(amber, THREE.MathUtils.clamp(0.5 + side * 0.5, 0, 1));
    out.lerp(gloss, THREE.MathUtils.clamp(side * 0.45 + y * 0.6, 0, 0.5));
  });
  const parts: THREE.BufferGeometry[] = [painted];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    const drip = new THREE.ConeGeometry(0.065, 0.18, 6);
    drip.rotateX(Math.PI);
    drip.translate(Math.cos(a) * 0.2, -0.42, Math.sin(a) * 0.2);
    parts.push(paint(drip, C(0xc7801a)));
  }
  const s = stem(0.12, 0.02, C(0x6b4b2a));
  s.translate(0, 0.38, 0);
  parts.push(s);
  return must(mergeGeometries(parts, false), 'gluefruit');
}

function spikefruit(): THREE.BufferGeometry {
  // A dark core inside a shell of pale spikes. The spikes reach the unit
  // radius, so the collider sphere is the tips, not the flesh.
  const core = new THREE.SphereGeometry(0.34, 12, 9);
  const green = C(0x2f6b3a), greenDark = C(0x1e4527);
  const parts: THREE.BufferGeometry[] = [paintBy(core, (x, y, z, out) => {
    out.copy(greenDark).lerp(green, THREE.MathUtils.clamp(0.5 + y * 1.2, 0, 1));
  })];
  const tip = C(0xd9d2a3), base = C(0x5a6b3a);
  const n = 16;
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    // Fibonacci sphere: evenly spread, never two spikes on top of each other.
    const y = 1 - (i + 0.5) / n * 2;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.39996;
    dir.set(Math.cos(a) * r, y, Math.sin(a) * r);
    const h = 0.2;
    const spike = new THREE.ConeGeometry(0.075, h, 5);
    spike.translate(0, 0.30 + h / 2, 0);
    q.setFromUnitVectors(up, dir);
    spike.applyQuaternion(q);
    const flat = spike.toNonIndexed();
    spike.dispose();
    parts.push(paintBy(flat, (x, yy, z, out) => {
      const d = Math.hypot(x, yy, z);
      out.copy(base).lerp(tip, THREE.MathUtils.clamp((d - 0.3) / 0.2, 0, 1));
    }));
  }
  return must(mergeGeometries(parts, false), 'spikefruit');
}

export function disposeFruitGeometry(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}
