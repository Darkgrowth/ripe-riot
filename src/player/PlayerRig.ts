import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const C = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

export interface RigColors {
  suit: THREE.Color;
  suitDark: THREE.Color;
  skin: THREE.Color;
  boots: THREE.Color;
  gloves: THREE.Color;
  hat: THREE.Color;
  pack: THREE.Color;
}

export const DEFAULT_COLORS: RigColors = {
  suit: C(0xd8a13c),
  suitDark: C(0xa9761f),
  skin: C(0xe0a878),
  boots: C(0x4a3524),
  gloves: C(0x8c5a30),
  hat: C(0xdd5a3c),
  pack: C(0x6c7a54),
};

/** Preset customisation sets; the shop sells these later. */
export const SUIT_PRESETS: Array<{ id: string; label: string; colors: Partial<RigColors> }> = [
  { id: 'default', label: 'Orchard Yellow', colors: {} },
  { id: 'blue', label: 'Dockworker Blue', colors: { suit: C(0x4a86c0), suitDark: C(0x2f5f8e), hat: C(0xf0e2c0) } },
  { id: 'green', label: 'Grove Green', colors: { suit: C(0x62a04a), suitDark: C(0x3f7030), hat: C(0xe8d16a) } },
  { id: 'red', label: 'Harvest Red', colors: { suit: C(0xc4503c), suitDark: C(0x8f3427), hat: C(0x2f2f38) } },
  { id: 'hazmat', label: 'Volatile Handling', colors: { suit: C(0xe8e2d0), suitDark: C(0xb8b2a0), hat: C(0xe8a020), gloves: C(0x3a3a44) } },
];

/**
 * The chunky harvest worker. Six parts, matching the ragdoll's six bodies, so
 * the same rig can be driven by animation or by physics without a second mesh.
 *
 * Parts are built around their own joint origins, which is what lets the
 * ragdoll drop rigid-body transforms straight onto them.
 */
export interface PlayerRig {
  root: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  parts: THREE.Mesh[];
  setVisible(v: boolean): void;
  dispose(): void;
}

function box(w: number, h: number, d: number, color: THREE.Color,
  at: [number, number, number] = [0, 0, 0], bevel = true): THREE.BufferGeometry {
  const g = bevel
    ? roundedBox(w, h, d, Math.min(w, h, d) * 0.18)
    : new THREE.BoxGeometry(w, h, d);
  g.translate(at[0], at[1], at[2]);
  return paint(g, color);
}

/** Cheap rounded box: a box with its corner vertices pulled in. */
function roundedBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const half = new THREE.Vector3(w / 2, h / 2, d / 2);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    for (const ax of ['x', 'y', 'z'] as const) {
      const lim = half[ax];
      if (Math.abs(Math.abs(v[ax]) - lim) < 1e-4) continue;
    }
    // Pull each vertex slightly toward the centre in proportion to how many
    // axes it is extreme on: corners move most, face centres not at all.
    let extremes = 0;
    for (const ax of ['x', 'y', 'z'] as const) {
      if (Math.abs(Math.abs(v[ax]) - half[ax]) < 1e-4) extremes++;
    }
    if (extremes >= 2) {
      const k = r * (extremes === 3 ? 0.62 : 0.34);
      for (const ax of ['x', 'y', 'z'] as const) {
        if (Math.abs(Math.abs(v[ax]) - half[ax]) < 1e-4) v[ax] -= Math.sign(v[ax]) * k;
      }
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  return g;
}

function paint(g: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  const n = flat.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  flat.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  for (const k of Object.keys(flat.attributes)) {
    if (k !== 'position' && k !== 'normal' && k !== 'color') flat.deleteAttribute(k);
  }
  return flat;
}

function build(parts: THREE.BufferGeometry[], material: THREE.Material, name: string): THREE.Mesh {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error(`rig part merge failed: ${name}`);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  for (const p of parts) p.dispose();
  const m = new THREE.Mesh(merged, material);
  m.name = `rig:${name}`;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function makePlayerRig(overrides: Partial<RigColors> = {}): PlayerRig {
  const c: RigColors = { ...DEFAULT_COLORS, ...overrides };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.75, metalness: 0.02, flatShading: true,
  });
  material.name = 'playerRig';

  // Torso: origin at the chest joint, body hanging below.
  const torso = build([
    box(0.52, 0.62, 0.34, c.suit, [0, -0.05, 0]),
    box(0.56, 0.14, 0.38, c.suitDark, [0, -0.30, 0]),     // belt
    box(0.30, 0.40, 0.18, c.pack, [0, -0.02, -0.26]),     // backpack
    box(0.24, 0.10, 0.06, c.suitDark, [0, 0.14, -0.36]),  // pack strap
  ], material, 'torso');

  // Head: origin at the neck.
  const head = build([
    box(0.34, 0.34, 0.32, c.skin, [0, 0.18, 0]),
    box(0.40, 0.11, 0.38, c.hat, [0, 0.37, 0]),           // helmet band
    box(0.36, 0.10, 0.16, c.hat, [0, 0.33, 0.20]),        // brim
    box(0.06, 0.06, 0.03, DEFAULT_COLORS.boots, [-0.08, 0.20, 0.17]),
    box(0.06, 0.06, 0.03, DEFAULT_COLORS.boots, [0.08, 0.20, 0.17]),
  ], material, 'head');

  const makeArm = (side: number) => build([
    box(0.16, 0.44, 0.16, c.suit, [0, -0.22, 0]),
    box(0.18, 0.16, 0.18, c.gloves, [0, -0.50, 0]),
  ], material, side < 0 ? 'armL' : 'armR');

  const makeLeg = (side: number) => build([
    box(0.19, 0.46, 0.19, c.suitDark, [0, -0.23, 0]),
    box(0.21, 0.14, 0.30, c.boots, [0, -0.50, 0.05]),
  ], material, side < 0 ? 'legL' : 'legR');

  const armL = makeArm(-1);
  const armR = makeArm(1);
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  const root = new THREE.Group();
  root.name = 'PlayerRig';
  const parts = [torso, head, armL, armR, legL, legR];
  for (const p of parts) root.add(p);
  root.visible = false;

  return {
    root, torso, head, armL, armR, legL, legR, parts,
    setVisible(v: boolean) { root.visible = v; },
    dispose() {
      for (const p of parts) p.geometry.dispose();
      material.dispose();
    },
  };
}

/** Rest-pose offsets from the torso origin, in metres. */
export const RIG_JOINTS = {
  head: new THREE.Vector3(0, 0.33, 0),
  armL: new THREE.Vector3(-0.34, 0.16, 0),
  armR: new THREE.Vector3(0.34, 0.16, 0),
  legL: new THREE.Vector3(-0.14, -0.38, 0),
  legR: new THREE.Vector3(0.14, -0.38, 0),
};
