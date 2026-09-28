import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toolHand } from './WorkerHands.ts';
import { voxelAirCannonGeometry, voxelMalletGeometry } from '../art/voxel/VoxelTools.ts';
import type { VisualMode } from '../art/voxel/VisualMode.ts';
import type { MalletViewPose } from '../player/MalletViewPose.ts';

const C = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

const GLOVE = C(0x8c5a30);
const GLOVE_DARK = C(0x6b4222);
const GLOVE_PANEL = C(0xa67543);
const STITCH = C(0xc49b65);
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
const SLEEVE_PANEL = C(0xe2ad4b);

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
  /**
   * Shrink the model in place for narrow frames. Scaling the ROOT would do
   * nothing — it would pull the model toward the camera by the same factor,
   * and uniform scaling about the eye is invisible in perspective. This scales
   * the geometry around its offset instead, which is the part that changes.
   */
  setFit(fit: number): void;
  /** Cosmetic blast-strength dial; reads existing tool state only. */
  setCharge?(charge: number): void;
  /** Independent mallet, lead glove and support glove pose. Cosmetic only. */
  setMalletPose?(pose: MalletViewPose): void;
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

/** A broad, single-step leather/fabric chamfer, contained in the original box. */
function padded(w: number, h: number, d: number, bevel: number, color: THREE.Color,
  at: [number, number, number],
  rot: [number, number, number] = [0, 0, 0]): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, 1, bevel);
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

/**
 * A gloved hand, used by every model so the tools feel held rather than
 * floating.
 *
 * The forearm is deliberately SHORT. Running it back toward the camera reads
 * well in a wireframe and terribly in perspective: at 0.19 m from the eye a
 * 7 cm sleeve is a quarter of the screen height on its own, and the first
 * version filled the bottom third of every frame with two yellow slabs. It only
 * has to bridge the gap between the glove and the bottom of the frame.
 */
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
    // The starter mallet is short and low in frame so it reads as a tool
    // without hiding fruit at the crosshair or the way through the orchard.
    parts: [
      toolHand('L', new THREE.Vector3(-0.17, -0.08, -0.26), 0.25),
      toolHand('R', new THREE.Vector3(0.16, -0.11, -0.22), -0.3),
      cyl(0.018, 0.022, 0.34, 8, WOOD_DARK, [0.16, 0.08, -0.24], [0, 0, -0.18]),
      box(0.16, 0.075, 0.09, STEEL_DARK, [0.16, 0.25, -0.24]),
      box(0.12, 0.015, 0.095, STEEL, [0.16, 0.294, -0.24]),
    ],
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
    parts.push(toolHand('L', new THREE.Vector3(-0.19, -0.06, 0.02), 0.4));
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
    parts.push(toolHand('L', new THREE.Vector3(-0.15, -0.09, -0.02), 0.3));
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
    parts.push(toolHand('R', new THREE.Vector3(0.03, -0.22, -0.08), 0.2));
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
    parts.push(toolHand('L', new THREE.Vector3(-0.08, -0.20, -0.10), 0.35));
    return { parts, hold: new THREE.Vector3(0.06, -0.06, -0.34) };
  },

  ropegun: () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(box(0.085, 0.10, 0.28, STEEL_DARK, [0.05, -0.12, -0.20]));
    parts.push(cyl(0.032, 0.038, 0.20, 8, STEEL, [0.05, -0.07, -0.32], [Math.PI / 2, 0, 0]));
    parts.push(torus(0.055, 0.016, WOOD, [0.05, -0.14, -0.16], [0, Math.PI / 2, 0]));  // spool
    parts.push(box(0.05, 0.11, 0.06, RUBBER, [0.05, -0.19, -0.11], [0.25, 0, 0]));     // grip
    parts.push(box(0.03, 0.05, 0.03, PAINT, [0.05, -0.05, -0.42]));                    // sight
    parts.push(toolHand('R', new THREE.Vector3(0.05, -0.24, -0.10), 0.1));
    parts.push(toolHand('L', new THREE.Vector3(-0.09, -0.17, -0.26), 0.5));
    return { parts, hold: new THREE.Vector3(0.05, -0.02, -0.40) };
  },

  aircannon: () => {
    const parts: THREE.BufferGeometry[] = [];
    const enamel = C(0x36796f), cream = C(0xe4d5a9), brass = C(0xc49344);
    const dark = C(0x293c3c);
    const axial: [number, number, number] = [Math.PI / 2, 0, 0];
    // A squat pressure vessel, bolted breech and bell mouth give this tool
    // a different silhouette from the rope gun. All fixed parts stay merged.
    parts.push(cyl(0.078, 0.088, 0.28, 16, enamel, [0.04, -0.065, -0.25], axial));
    parts.push(cyl(0.087, 0.074, 0.085, 16, cream, [0.04, -0.065, -0.075], axial));
    parts.push(cyl(0.094, 0.094, 0.018, 16, brass, [0.04, -0.065, -0.105], axial));
    const bell = new THREE.CylinderGeometry(0.078, 0.105, 0.075, 16, 1, true);
    bell.rotateX(Math.PI / 2); bell.translate(0.04, -0.065, -0.423);
    parts.push(paint(bell, PAINT));
    const bore = new THREE.CylinderGeometry(0.063, 0.092, 0.07, 16, 1, true);
    bore.scale(-1, 1, 1); // reverse the wall winding so the inside is visible
    bore.rotateX(Math.PI / 2); bore.translate(0.04, -0.065, -0.42);
    parts.push(paint(bore, dark));
    parts.push(cyl(0.065, 0.065, 0.004, 16, dark, [0.04, -0.065, -0.387], axial));
    parts.push(torus(0.105, 0.014, PAINT_DARK, [0.04, -0.065, -0.463]));
    parts.push(torus(0.079, 0.010, brass, [0.04, -0.065, -0.371]));
    for (const z of [-0.32, -0.18]) {
      parts.push(torus(0.081, 0.010, cream, [0.04, -0.065, z]));
      for (const side of [-1, 1]) parts.push(box(0.013, 0.11, 0.019, dark, [0.04 + side * 0.075, -0.065, z]));
    }
    // Longitudinal reinforcement ribs, large enough to read at play distance.
    for (const side of [-1, 1]) parts.push(padded(0.019, 0.026, 0.22, 0.005,
      cream, [0.04 + side * 0.064, -0.012, -0.24]));
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      parts.push(cyl(0.007, 0.007, 0.012, 6, dark,
        [0.04 + Math.cos(a) * 0.067, -0.065 + Math.sin(a) * 0.067, -0.025], axial));
    }
    // Side reservoir and a real curved hose, visibly connected at both ends.
    parts.push(cyl(0.039, 0.046, 0.18, 12, brass, [-0.073, -0.11, -0.19], axial));
    for (const z of [-0.27, -0.11]) parts.push(torus(0.043, 0.008, dark, [-0.073, -0.11, z]));
    const hose = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.073, -0.105, -0.093), new THREE.Vector3(-0.115, -0.08, -0.04),
      new THREE.Vector3(-0.085, -0.01, -0.045), new THREE.Vector3(-0.025, -0.015, -0.12),
    ]);
    parts.push(paint(new THREE.TubeGeometry(hose, 12, 0.011, 6, false), dark));
    // Gauge faces the worker. The moving needle is added by buildViewModel.
    parts.push(cyl(0.038, 0.038, 0.022, 16, brass, [0.045, 0.033, -0.105], axial));
    parts.push(cyl(0.032, 0.032, 0.003, 24, cream, [0.045, 0.033, -0.092], axial));
    parts.push(torus(0.034, 0.005, dark, [0.045, 0.033, -0.090]));
    for (let i = 0; i < 9; i++) {
      const a = -1.1 + i * 2.2 / 8;
      parts.push(box(0.003, i % 2 ? 0.005 : 0.008, 0.003, i > 6 ? PAINT : dark,
        [0.045 + Math.sin(a) * 0.025, 0.033 + Math.cos(a) * 0.025, -0.088], [0, 0, -a]));
    }
    // Broad rubber handles and two gloves make the weight-bearing grip clear.
    parts.push(padded(0.043, 0.10, 0.060, 0.008, RUBBER, [0.07, -0.17, -0.085], [0.22, 0, 0]));
    parts.push(torus(0.034, 0.007, brass, [0.05, -0.155, -0.15], [0, Math.PI / 2, 0]));
    parts.push(padded(0.09, 0.034, 0.11, 0.008, RUBBER, [-0.01, -0.158, -0.29]));
    for (let i = 0; i < 4; i++) parts.push(box(0.092, 0.005, 0.009, STEEL_DARK, [-0.01, -0.177, -0.325 + i * 0.023]));
    parts.push(toolHand('R', new THREE.Vector3(0.085, -0.195, -0.09), 0.12));
    parts.push(toolHand('L', new THREE.Vector3(-0.10, -0.135, -0.32), 0.40));
    return { parts, hold: new THREE.Vector3(0.04, -0.02, -0.46) };
  },
};

const VOXEL_BUILDERS: Partial<Record<string, Builder>> = {
  aircannon: () => ({
    parts: [
      toolHand('R', new THREE.Vector3(0.085, -0.195, -0.09), 0.12),
      toolHand('L', new THREE.Vector3(-0.10, -0.135, -0.32), 0.40),
      voxelAirCannonGeometry(),
    ],
    hold: new THREE.Vector3(0.04, -0.02, -0.46),
  }),
};

/**
 * Where a held tool sits relative to the eye: down and to the right, and far
 * enough forward not to fill the screen.
 *
 * Models are authored around the origin for readability; this is the one place
 * that decides framing. Authored in place, the first pass put a net hoop dead
 * centre at 30 cm and blocked the entire view.
 *
 * The numbers matter more than they look. A viewmodel's screen size is set by
 * how CLOSE its nearest vertex is, not by its scale: at 0.22 m the hands
 * spanned 58% of the screen height and ran off the right edge. Pushing the
 * whole rig out to ~0.4 m and taking 20% off the scale brings an ordinary tool
 * back to roughly a fifth of frame height, low and to the right, with the
 * crosshair and the path ahead clear. Measured by
 * `tools/harness/startup-check.mjs`, which fails if it creeps back up.
 *
 * There is deliberately no X here. Vertical framing is stable because the
 * vertical FOV is fixed, but the visible WIDTH depends on the aspect ratio, so
 * a fixed lateral offset that reads as "held to the right" at 16:9 walks
 * straight off the edge at 4:3 and off the screen in portrait.
 * `ViewmodelSystem` places it laterally as a fraction of the frame instead.
 */
const VIEW_OFFSET = new THREE.Vector3(0, -0.19, -0.40);
const VIEW_SCALE = 0.62;

/** Depth the lateral placement is computed at — roughly where a tool sits. */
export const VIEW_DEPTH = 0.5;
/** How far toward the right edge the tool is held, as a fraction of the visible
 *  half-width at VIEW_DEPTH. */
export const VIEW_LATERAL = 0.37;

/** The grip GLB contains a short, capped sleeve. Extend only its fabric from
 * beneath the leather cuff toward the player's elbow, so the cap leaves the
 * lower camera frame while the authored palm stays wrapped around the shaft. */
function malletGrip(side: 'L' | 'R', x: number, y: number, z: number, roll: number,
  material: THREE.Material, voxel: boolean): THREE.Mesh {
  const geo = toolHand(side, new THREE.Vector3(), roll);
  let grip = geo;
  if (voxel) {
    const positions = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = geo.getAttribute('color') as THREE.BufferAttribute;
    const outward = side === 'L' ? -1 : 1;
    for (let i = 0; i < positions.count; i++) {
      let x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      // The ochre vertex color belongs to the sleeve alone. Its opening is at
      // the low-Y end of the source GLB; the darker cuff and fingers stay put.
      if (colors.getX(i) > .5) {
        const towardElbow = THREE.MathUtils.clamp((-y - .048) / .12, 0, 1);
        y -= .27 * towardElbow;
        x += outward * .13 * towardElbow;
      }
      const rear = THREE.MathUtils.clamp((z - .015) / .16, 0, 1);
      positions.setXYZ(i, x + outward * .09 * rear, y, z);
    }
    positions.needsUpdate = true;
    geo.scale(.88, .92, .82);
    geo.computeVertexNormals();
    // Three short leather fingers bridge each palm onto the camera side of
    // the same wooden shaft. They remain part of that hand's moving mesh.
    const fingerParts: THREE.BufferGeometry[] = [geo];
    const shaftX = .16 - x;
    const shaftZ = -.24 - z;
    for (const offset of [-.018, 0, .018])
      fingerParts.push(padded(.039, .014, .078, .004, GLOVE,
        [shaftX + (side === 'L' ? -.012 : .012), offset, shaftZ + .037]));
    const merged = mergeGeometries(fingerParts, false);
    if (!merged) throw new Error(`mallet grip merge failed: ${side}`);
    merged.computeVertexNormals();
    for (const part of fingerParts) part.dispose();
    grip = merged;
  } else {
    geo.scale(1.10, 1.04, 1.04);
  }
  grip.translate(x, y, z);
  grip.computeBoundingSphere();
  const mesh = new THREE.Mesh(grip, material);
  mesh.name = `vm:hand:${side === 'R' ? 'rightGrip' : 'leftGrip'}`;
  return mesh;
}

/** The mallet needs three moving pieces: the striking head and two hands.
 * Keeping the tool rigid with both gloves caused the old detached left stump
 * and prevented the head from crossing the camera-centred melee sweep. */
function buildMalletViewModel(material: THREE.Material, visualMode: VisualMode): ViewModel {
  const tool = assemble(visualMode === 'voxel' ? [voxelMalletGeometry()] : [
    cyl(0.018, 0.022, 0.34, 8, WOOD_DARK, [0.16, 0.08, -0.24], [0, 0, -0.18]),
    box(0.16, 0.075, 0.09, STEEL_DARK, [0.16, 0.25, -0.24]),
    box(0.12, 0.015, 0.095, STEEL, [0.16, 0.294, -0.24]),
  ], material, 'hand');
  // In voxel mode the grip heights and cuff fan keep both hands distinct at
  // the gameplay camera. The baseline hand pose retains its authored fit.
  const voxel = visualMode === 'voxel';
  const right = malletGrip('R', .19, voxel ? .065 : .03, -.22, -.30, material, voxel);
  const left = malletGrip('L', voxel ? .07 : .11, voxel ? .185 : -.02, -.24,
    .25, material, voxel);
  const root = new THREE.Group();
  root.name = 'ViewModel:hand';
  root.add(tool, right, left);
  const gripPivot = new THREE.Vector3(.16, -.02, -.24);
  const turned = new THREE.Vector3();
  let fit = 1;
  let pose: MalletViewPose = { rootX: 0, rootY: 0, rootYaw: 0,
    toolRoll: 0, toolPitch: 0, leftLag: 0, contact: 0, impact: 0 };
  const place = (mesh: THREE.Mesh, roll: number, pitch: number,
    lagX = 0, lagY = 0, lagZ = 0) => {
    mesh.rotation.set(pitch, 0, roll);
    turned.copy(gripPivot).applyEuler(mesh.rotation);
    const scale = VIEW_SCALE * fit;
    mesh.position.set(
      VIEW_OFFSET.x + (gripPivot.x - turned.x + lagX) * scale,
      VIEW_OFFSET.y + (gripPivot.y - turned.y + lagY) * scale,
      VIEW_OFFSET.z + (gripPivot.z - turned.z + lagZ) * scale,
    );
    mesh.scale.setScalar(scale);
  };
  const apply = () => {
    const recoil = pose.impact;
    place(tool, pose.toolRoll, pose.toolPitch, 0, 0, recoil * .012);
    place(right, pose.toolRoll * .92, pose.toolPitch * .9, 0, -recoil * .004,
      recoil * .012);
    place(left, pose.toolRoll * .58, pose.toolPitch * .65,
      pose.leftLag, -recoil * .008, recoil * .008);
  };
  apply();
  return {
    root,
    holdPoint: new THREE.Vector3(0, -.04, -.40).multiplyScalar(VIEW_SCALE).add(VIEW_OFFSET),
    setFit(next) { fit = next; apply(); },
    setMalletPose(next) { pose = next; apply(); },
    dispose() { tool.geometry.dispose(); right.geometry.dispose(); left.geometry.dispose(); },
  };
}

export function buildViewModel(toolId: string, material: THREE.Material,
  visualMode: VisualMode = 'baseline'): ViewModel {
  if (toolId === 'hand') return buildMalletViewModel(material, visualMode);
  const builder = (visualMode === 'voxel' ? VOXEL_BUILDERS[toolId] : undefined)
    ?? BUILDERS[toolId] ?? BUILDERS.hand;
  const { parts, hold } = builder();
  const mesh = assemble(parts, material, toolId);
  mesh.position.copy(VIEW_OFFSET);
  // Raise the heavier two-handed housing just enough to show its support
  // glove. This is tool-specific; other approved framing stays unchanged.
  if (toolId === 'aircannon') mesh.position.y += 0.010;
  mesh.scale.setScalar(VIEW_SCALE);
  const root = new THREE.Group();
  root.name = `ViewModel:${toolId}`;
  root.add(mesh);
  let needle: THREE.Mesh | undefined;
  if (toolId === 'aircannon') {
    needle = assemble([
      box(0.0035, 0.024, 0.004, PAINT, [0, 0.008, 0]),
      cyl(0.005, 0.005, 0.005, 8, STEEL_DARK, [0, 0, 0], [Math.PI / 2, 0, 0]),
    ], material, 'blast-dial');
    needle.position.set(0.045, 0.033, -0.084);
    mesh.add(needle);
  }
  return {
    root,
    holdPoint: hold.multiplyScalar(VIEW_SCALE).add(VIEW_OFFSET),
    setFit(fit: number) { mesh.scale.setScalar(VIEW_SCALE * fit); },
    setCharge: needle ? (charge: number) => {
      needle.rotation.z = 1.1 - THREE.MathUtils.clamp(charge, 0, 1) * 2.2;
    } : undefined,
    dispose() { mesh.geometry.dispose(); needle?.geometry.dispose(); },
  };
}

export const VIEWMODEL_IDS = Object.keys(BUILDERS);
