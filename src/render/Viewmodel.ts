import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const C = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

const GLOVE = C(0x8c5a30);
const GLOVE_DARK = C(0x6b4222);
const SKIN = C(0xe0a878);
const STEEL = C(0xa8b0b8);
const STEEL_DARK = C(0x5f6a72);
const WOOD = C(0xb08150);
const WOOD_DARK = C(0x7d5733);
const WICKER = C(0xd7b476);
const NETTING = C(0xe8dcb8);
const PAINT = C(0xd0503c);
const PAINT_DARK = C(0x9c3a29);
const RUBBER = C(0x3a3a44);
const SLEEVE = C(0xd8a13c);
const SLEEVE_DARK = C(0xa9761f);

/**
 * First-person tool models, generated in code like everything else.
 *
 * These are rendered in their own scene with a cleared depth buffer, so they
 * can sit 40 cm from the camera without ever poking through a wall — the usual
 * failure of parenting a viewmodel straight to the camera.
 */
export interface ViewModel {
  root: THREE.Group;
  /** Where a carried fruit should appear to be held, in viewmodel space. */
  holdPoint: THREE.Vector3;
  dispose(): void;
}

function box(w: number, h: number, d: number, color: THREE.Color,
  at: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0]): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rot[0]) g.rotateX(rot[0]);
  if (rot[1]) g.rotateY(rot[1]);
  if (rot[2]) g.rotateZ(rot[2]);
  g.translate(at[0], at[1], at[2]);
  return paint(g, color);
}

function cyl(rt: number, rb: number, h: number, seg: number, color: THREE.Color,
  at: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0]): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  if (rot[0]) g.rotateX(rot[0]);
  if (rot[1]) g.rotateY(rot[1]);
  if (rot[2]) g.rotateZ(rot[2]);
  g.translate(at[0], at[1], at[2]);
  return paint(g, color);
}

function torus(r: number, tube: number, color: THREE.Color,
  at: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0]): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(r, tube, 5, 16);
  if (rot[0]) g.rotateX(rot[0]);
  if (rot[1]) g.rotateY(rot[1]);
  if (rot[2]) g.rotateZ(rot[2]);
  g.translate(at[0], at[1], at[2]);
  return paint(g, color);
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

/** A gloved hand, used by every model so the tools feel held rather than floating. */
function hand(x: number, y: number, z: number, roll = 0): THREE.BufferGeometry[] {
  return [
    box(0.075, 0.06, 0.10, GLOVE, [x, y, z], [0, 0, roll]),
    box(0.078, 0.028, 0.045, GLOVE_DARK, [x, y - 0.038, z + 0.01], [0, 0, roll]),
    // Forearm running back toward the camera. Without it the gloves read as
    // two blocks floating in front of your face.
    box(0.072, 0.072, 0.20, SLEEVE, [x, y + 0.012, z + 0.15], [0, 0, roll]),
    box(0.078, 0.078, 0.035, SLEEVE_DARK, [x, y + 0.012, z + 0.055], [0, 0, roll]),
  ];
}

function assemble(parts: THREE.BufferGeometry[], material: THREE.Material, name: string): THREE.Mesh {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error(`viewmodel merge failed: ${name}`);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  for (const p of parts) p.dispose();
  const m = new THREE.Mesh(merged, material);
  m.name = `vm:${name}`;
  return m;
}

// ---------------------------------------------------------------------------
type Builder = () => { parts: THREE.BufferGeometry[]; hold: THREE.Vector3 };

const BUILDERS: Record<string, Builder> = {
  hand: () => ({
    // Empty hands: both gloves, held ready.
    parts: [...hand(-0.17, -0.08, -0.26, 0.25), ...hand(0.16, -0.11, -0.22, -0.3)],
    hold: new THREE.Vector3(0.0, -0.04, -0.40),
  }),

  basket: () => {
    const parts: THREE.BufferGeometry[] = [];
    // Woven sides: alternating slats read as wicker at this distance.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      parts.push(box(0.035, 0.16, 0.02, i % 2 ? WICKER : WOOD,
        [Math.cos(a) * 0.135, -0.10, Math.sin(a) * 0.135 - 0.02], [0, -a, 0]));
    }
    parts.push(torus(0.14, 0.014, WOOD_DARK, [0, -0.03, -0.02], [Math.PI / 2, 0, 0]));
    parts.push(torus(0.14, 0.012, WOOD_DARK, [0, -0.17, -0.02], [Math.PI / 2, 0, 0]));
    parts.push(box(0.26, 0.012, 0.24, WICKER, [0, -0.18, -0.02]));
    parts.push(...hand(-0.19, -0.06, 0.02, 0.4));
    return { parts, hold: new THREE.Vector3(0, -0.06, -0.06) };
  },

  ladder: () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const x of [-0.06, 0.06]) {
      parts.push(box(0.026, 0.03, 0.62, WOOD, [x, -0.14, -0.28]));
    }
    for (let i = 0; i < 5; i++) {
      parts.push(box(0.15, 0.02, 0.02, WOOD_DARK, [0, -0.14, -0.05 - i * 0.12]));
    }
    parts.push(...hand(-0.15, -0.09, -0.02, 0.3));
    return { parts, hold: new THREE.Vector3(0.05, -0.05, -0.26) };
  },

  net: () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(cyl(0.018, 0.022, 0.34, 6, WOOD, [0.10, -0.15, -0.14], [Math.PI / 2.3, -0.2, 0]));
    parts.push(torus(0.15, 0.012, STEEL, [0.18, -0.05, -0.35], [0.28, -0.2, 0]));
    // A shallow cone of netting behind the hoop.
    const cone = new THREE.ConeGeometry(0.15, 0.2, 12, 1, true);
    cone.rotateX(-Math.PI / 2 + 0.28);
    cone.rotateY(-0.2);
    cone.translate(0.18, -0.05, -0.25);
    parts.push(paint(cone, NETTING));
    parts.push(...hand(0.03, -0.22, -0.08, 0.2));
    return { parts, hold: new THREE.Vector3(0.18, -0.06, -0.33) };
  },

  shaker: () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(box(0.11, 0.13, 0.24, PAINT, [0.06, -0.12, -0.22]));
    parts.push(box(0.115, 0.05, 0.10, PAINT_DARK, [0.06, -0.05, -0.20]));
    // Jaws.
    parts.push(box(0.04, 0.13, 0.05, STEEL, [0.02, -0.12, -0.37], [0, 0, 0.22]));
    parts.push(box(0.04, 0.13, 0.05, STEEL, [0.10, -0.12, -0.37], [0, 0, -0.22]));
    parts.push(cyl(0.02, 0.02, 0.16, 6, RUBBER, [-0.03, -0.16, -0.14], [0, 0, 0.5]));
    parts.push(...hand(-0.08, -0.20, -0.10, 0.35));
    return { parts, hold: new THREE.Vector3(0.06, -0.06, -0.34) };
  },

  ropegun: () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(box(0.085, 0.10, 0.28, STEEL_DARK, [0.05, -0.12, -0.20]));
    parts.push(cyl(0.032, 0.038, 0.20, 8, STEEL, [0.05, -0.07, -0.32], [Math.PI / 2, 0, 0]));
    parts.push(torus(0.055, 0.016, WOOD, [0.05, -0.14, -0.16], [0, Math.PI / 2, 0]));  // spool
    parts.push(box(0.05, 0.11, 0.06, RUBBER, [0.05, -0.19, -0.11], [0.25, 0, 0]));     // grip
    parts.push(box(0.03, 0.05, 0.03, PAINT, [0.05, -0.05, -0.42]));                    // sight
    parts.push(...hand(0.05, -0.24, -0.10, 0.1));
    parts.push(...hand(-0.09, -0.17, -0.26, 0.5));
    return { parts, hold: new THREE.Vector3(0.05, -0.02, -0.40) };
  },

  aircannon: () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(cyl(0.075, 0.065, 0.40, 10, PAINT, [0.04, -0.09, -0.28], [Math.PI / 2, 0, 0]));
    parts.push(torus(0.082, 0.016, PAINT_DARK, [0.04, -0.09, -0.47], [0, 0, 0]));      // muzzle ring
    parts.push(cyl(0.05, 0.05, 0.22, 8, STEEL, [-0.05, -0.16, -0.12], [Math.PI / 2, 0, 0.3])); // tank
    parts.push(cyl(0.012, 0.012, 0.14, 5, STEEL_DARK, [0.0, -0.13, -0.20], [0, 0, 1.1]));      // hose
    parts.push(box(0.05, 0.12, 0.06, RUBBER, [0.05, -0.19, -0.13], [0.22, 0, 0]));
    parts.push(box(0.03, 0.03, 0.09, STEEL_DARK, [0.04, -0.02, -0.34]));
    parts.push(...hand(0.05, -0.25, -0.12, 0.1));
    parts.push(...hand(-0.07, -0.19, -0.30, 0.45));
    return { parts, hold: new THREE.Vector3(0.04, -0.02, -0.46) };
  },
};

/**
 * Where a held tool sits relative to the eye: down and to the right, and far
 * enough forward not to fill the screen.
 *
 * Models are authored around the origin for readability; this is the one place
 * that decides framing. Authored in place, the first pass put a net hoop dead
 * centre at 30 cm and blocked the entire view.
 */
const VIEW_OFFSET = new THREE.Vector3(0.12, -0.075, -0.22);
const VIEW_SCALE = 0.8;

export function buildViewModel(toolId: string, material: THREE.Material): ViewModel {
  const builder = BUILDERS[toolId] ?? BUILDERS.hand;
  const { parts, hold } = builder();
  const mesh = assemble(parts, material, toolId);
  mesh.position.copy(VIEW_OFFSET);
  mesh.scale.setScalar(VIEW_SCALE);
  const root = new THREE.Group();
  root.name = `ViewModel:${toolId}`;
  root.add(mesh);
  return {
    root,
    holdPoint: hold.multiplyScalar(VIEW_SCALE).add(VIEW_OFFSET),
    dispose() { mesh.geometry.dispose(); },
  };
}

export const VIEWMODEL_IDS = Object.keys(BUILDERS);
