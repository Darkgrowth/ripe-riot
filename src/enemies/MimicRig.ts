import * as THREE from 'three';
import type { EncounterState, Point3 } from './EncounterModel';

export type MimicStyle = 'polygon' | 'block';

const c = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
const RIND = c(0x365e3f);
const RIB = c(0x527a4b);
const RIND_DARK = c(0x264734);
const FLESH = c(0xc4574b);
const THROAT = c(0x482638);
const TOOTH = c(0xf1ddaa);
const ROOT = c(0x365332);
const STEM = c(0x557443);
const EYE = c(0xc8834a);

const vertexMaterial = () => new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.88, flatShading: true,
});
const solidMaterial = (color: THREE.Color, emissive = 0) => new THREE.MeshStandardMaterial({
  color, emissive: color, emissiveIntensity: emissive, roughness: 0.88,
  flatShading: true,
});

function addMesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry,
  material: THREE.Material, name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function stripedHemisphere(upper: boolean): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2,
    upper ? 0 : Math.PI / 2, Math.PI / 2);
  const pos = geo.getAttribute('position');
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    pos.setXYZ(i, x * 1.18, y * 0.82, z * 1.05);
    const stripe = Math.cos(Math.atan2(x, z) * 7) > 0.55;
    const color = stripe ? RIB : RIND;
    colors.push(color.r, color.g, color.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

type Face = [number, number, number, number, number, number, number, number, number,
  number, number, number];
const FACE_CORNERS: Face[] = [
  [1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1],
  [-1, -1, 1, -1, 1, 1, -1, 1, -1, -1, -1, -1],
  [-1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, -1],
  [-1, -1, 1, -1, -1, -1, 1, -1, -1, 1, -1, 1],
  [1, -1, 1, 1, 1, 1, -1, 1, 1, -1, -1, 1],
  [-1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1, -1],
];
const FACE_STEPS: Array<[number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

function pushFace(vertices: number[], colors: number[], cx: number, cy: number,
  cz: number, sx: number, sy: number, sz: number, face: number,
  color: THREE.Color): void {
  const corners = FACE_CORNERS[face];
  const pts: number[][] = [];
  for (let n = 0; n < 4; n++) {
    const offset = n * 3;
    pts.push([cx + corners[offset] * sx / 2, cy + corners[offset + 1] * sy / 2,
      cz + corners[offset + 2] * sz / 2]);
  }
  for (const i of [0, 1, 2, 0, 2, 3]) {
    vertices.push(...pts[i]);
    colors.push(color.r, color.g, color.b);
  }
}

/** All exposed cube faces become one vertex-coloured buffer, not one Mesh per cube. */
function blockHemisphere(upper: boolean): THREE.BufferGeometry {
  const cells = new Set<string>();
  for (let x = -6; x <= 6; x++) for (let y = upper ? 0 : -4; y <= (upper ? 3 : -1); y++) {
    for (let z = -5; z <= 5; z++) {
      const px = x * 0.22, py = (y + 0.5) * 0.20, pz = z * 0.22;
      if ((px / 1.18) ** 2 + (py / 0.82) ** 2 + (pz / 1.05) ** 2 <= 1.05)
        cells.add(`${x},${y},${z}`);
    }
  }
  const vertices: number[] = [], colors: number[] = [];
  for (const key of cells) {
    const [x, y, z] = key.split(',').map(Number);
    const stripe = Math.cos(Math.atan2(x, z) * 7) > 0.52;
    for (let face = 0; face < 6; face++) {
      const [dx, dy, dz] = FACE_STEPS[face];
      if (cells.has(`${x + dx},${y + dy},${z + dz}`)) continue;
      const cut = (upper && face === 3 && y === 0)
        || (!upper && face === 2 && y === -1);
      pushFace(vertices, colors, x * 0.22, (y + 0.5) * 0.20, z * 0.22,
        0.22, 0.20, 0.22, face, cut ? FLESH : stripe ? RIB : RIND);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

interface Block { x: number; y: number; z: number; w: number; h: number; d: number; color: THREE.Color }

function blockBatch(blocks: Block[]): THREE.BufferGeometry {
  const vertices: number[] = [], colors: number[] = [];
  for (const b of blocks) {
    for (let face = 0; face < 6; face++)
      pushFace(vertices, colors, b.x, b.y, b.z, b.w, b.h, b.d, face, b.color);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

interface Leg {
  side: number;
  fore: number;
  upper: THREE.Mesh;
  lower: THREE.Mesh;
  foot: THREE.Mesh;
}

const UP = new THREE.Vector3(0, 1, 0);
function connect(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  const delta = b.clone().sub(a);
  mesh.quaternion.setFromUnitVectors(UP, delta.clone().normalize());
  mesh.scale.y = delta.length();
}

/** One articulated animation for both surface treatments. */
export class MimicRig {
  readonly style: MimicStyle;
  readonly anatomy = new THREE.Group();
  readonly upper = new THREE.Group();
  readonly lower = new THREE.Group();
  readonly roots = new THREE.Group();
  readonly chips: THREE.InstancedMesh;
  private body = new THREE.Group();
  private legs: Leg[] = [];
  private eyes: THREE.Mesh[] = [];
  private time = 0;
  private stride = 0;
  private previousPosition: Point3 | null = null;
  private previousHealth: number | null = null;
  private previousPhase = '';
  private defeatAge = 0;
  private chipAge = 99;

  constructor(parent: THREE.Group, style: MimicStyle) {
    this.style = style;
    this.anatomy.name = 'Mimic anatomy';
    parent.add(this.anatomy);
    this.anatomy.add(this.body, this.roots);
    this.body.name = 'Mimic body';
    this.roots.name = 'Mimic roots';
    this.lower.name = 'Mimic lower rind';
    this.upper.name = 'Mimic upper rind';
    this.lower.position.y = 1.18;
    this.upper.position.set(0, 1.18, -0.78);
    this.body.add(this.lower, this.upper);
    const shell = vertexMaterial();
    const upperShell = addMesh(this.upper,
      style === 'block' ? blockHemisphere(true) : stripedHemisphere(true), shell,
      style === 'block' ? 'Mimic block upper batch' : 'Mimic polygon upper shell');
    upperShell.position.z = 0.78;
    addMesh(this.lower, style === 'block' ? blockHemisphere(false) : stripedHemisphere(false),
      shell, style === 'block' ? 'Mimic block lower batch' : 'Mimic polygon lower shell');

    if (style === 'polygon') {
      const upperFlesh = addMesh(this.upper, new THREE.CircleGeometry(1.03, 16),
        solidMaterial(FLESH), 'Mimic upper flesh');
      upperFlesh.rotation.x = Math.PI / 2;
      upperFlesh.position.set(0, -0.008, 0.78);
      upperFlesh.scale.set(1.12, 1, 0.98);
      const lowerFlesh = addMesh(this.lower, new THREE.CircleGeometry(1.03, 16),
        solidMaterial(FLESH), 'Mimic lower flesh');
      lowerFlesh.rotation.x = -Math.PI / 2;
      lowerFlesh.position.y = 0.008;
      lowerFlesh.scale.set(1.12, 1, 0.98);
    }
    const throat = addMesh(this.lower,
      style === 'block' ? new THREE.BoxGeometry(1.55, 0.04, 0.72)
        : new THREE.SphereGeometry(1, 12, 6), solidMaterial(THROAT), 'Mimic throat');
    throat.position.set(0, 0.024, 0.40);
    if (style === 'polygon') throat.scale.set(0.77, 0.025, 0.42);

    if (style === 'block') {
      const teeth: Block[] = [];
      for (let n = -2; n <= 2; n++) teeth.push({ x: n * 0.28, y: -0.105, z: 1.46,
        w: 0.13, h: 0.21, d: 0.16, color: TOOTH });
      addMesh(this.upper, blockBatch(teeth), shell, 'Mimic batched teeth');
      addMesh(this.upper, blockBatch([
        { x: 0, y: 0.98, z: 0.78, w: 0.28, h: 0.40, d: 0.27, color: STEM },
        { x: -0.18, y: 1.17, z: 0.78, w: 0.31, h: 0.12, d: 0.22, color: RIND_DARK },
      ]), shell, 'Mimic batched stem');
    } else {
      for (let n = -2; n <= 2; n++) {
        const tooth = addMesh(this.upper, new THREE.ConeGeometry(0.105, 0.24, 4),
          solidMaterial(TOOTH), `Mimic tooth ${n}`);
        tooth.position.set(n * 0.28, -0.115, 1.46);
        tooth.rotation.z = Math.PI;
      }
      const stem = addMesh(this.upper, new THREE.CylinderGeometry(0.09, 0.15, 0.43, 6),
        solidMaterial(STEM), 'Mimic stem');
      stem.position.set(0, 1.02, 0.78);
      stem.rotation.z = 0.18;
      const leaf = addMesh(this.upper, new THREE.ConeGeometry(0.19, 0.48, 5),
        solidMaterial(RIND_DARK), 'Mimic leaf');
      leaf.position.set(-0.24, 1.19, 0.78);
      leaf.rotation.z = -0.84;
    }

    for (const x of [-0.43, 0.43]) {
      const eye = addMesh(this.upper,
        style === 'block' ? new THREE.BoxGeometry(0.14, 0.14, 0.09)
          : new THREE.SphereGeometry(0.075, 6, 4),
        solidMaterial(EYE, 0.2), 'Mimic seed eye');
      eye.position.set(x, 0.42, 1.60);
      this.eyes.push(eye);
    }

    for (const side of [-1, 1]) for (const fore of [-1, 1]) {
      const legRoot = new THREE.Group();
      legRoot.name = `Mimic root ${side < 0 ? 'L' : 'R'}${fore < 0 ? 'B' : 'F'}`;
      this.roots.add(legRoot);
      const makeSegment = (name: string) => addMesh(legRoot,
        style === 'block' ? new THREE.BoxGeometry(0.38, 1, 0.34)
          : new THREE.CylinderGeometry(0.15, 0.25, 1, 6),
        solidMaterial(ROOT), name);
      const upper = makeSegment('root upper');
      const lower = makeSegment('root lower');
      const foot = addMesh(legRoot,
        style === 'block' ? new THREE.BoxGeometry(0.42, 0.18, 0.56)
          : new THREE.SphereGeometry(1, 7, 5), solidMaterial(RIND_DARK), 'root foot');
      if (style === 'polygon') foot.scale.set(0.29, 0.09, 0.36);
      this.legs.push({ side, fore, upper, lower, foot });
    }

    this.chips = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.13),
      solidMaterial(RIB), 8);
    this.chips.name = 'Mimic chips';
    this.chips.visible = false;
    this.chips.castShadow = false;
    this.anatomy.add(this.chips);
  }

  update(state: Readonly<EncounterState>, dt: number): void {
    const step = Math.max(0, dt);
    this.time += step;
    if (this.previousPosition) {
      const moved = Math.hypot(state.position[0] - this.previousPosition[0],
        state.position[2] - this.previousPosition[2]);
      if (state.phase === 'attack') this.stride += moved / 0.75 * Math.PI;
    }
    this.previousPosition = [...state.position];
    if (this.previousHealth !== null && state.health < this.previousHealth) this.chipAge = 0;
    this.previousHealth = state.health;
    if (state.phase === 'defeated') {
      if (this.previousPhase !== 'defeated') {
        this.defeatAge = 0;
        this.chipAge = 0;
      } else this.defeatAge += step;
    }
    this.previousPhase = state.phase;
    this.anatomy.parent!.visible = state.phase !== 'defeated' || this.defeatAge < 2.2;

    const warning = state.phase === 'warn';
    const attack = state.phase === 'attack';
    const stagger = state.phase === 'stagger';
    const recovery = state.phase === 'recover';
    const defeated = state.phase === 'defeated';
    const warnProgress = warning ? 1 - Math.max(0, Math.min(1, state.timeLeft / 0.8)) : 0;
    const open = defeated ? 0.8 : stagger ? 0.65 : recovery ? 0.55
      : attack ? 0.78 : warning ? 0.08 + warnProgress * 0.68 : 0.015;
    this.upper.rotation.x = -open * 0.57;
    this.upper.position.y = 1.18 + (attack ? 0.06 : stagger ? 0.12 : 0);
    this.body.rotation.x = attack ? 0.18 : warning ? -0.11 * warnProgress
      : recovery ? 0.07 : 0;
    this.body.rotation.z = stagger ? 0.25 : defeated ? -0.34 : 0;
    const breathe = state.phase === 'idle' ? Math.sin(this.time * 2.1) * 0.018 : 0;
    const compression = warning ? warnProgress * 0.10 : attack ? 0.06 : 0;
    this.body.scale.set(1 + compression * 0.25, defeated ? 0.42 : 1 - compression,
      1 + compression * 0.45);
    this.body.position.y = defeated ? -0.28 : breathe - compression * 0.1;
    for (const eye of this.eyes) eye.visible = !defeated && state.phase !== 'idle';

    for (const leg of this.legs) {
      const spread = state.phase === 'idle' ? 0.78 : 1;
      const cycle = this.stride + (leg.side * leg.fore > 0 ? 0 : Math.PI);
      const strideZ = attack ? Math.cos(cycle) * 0.31 : 0;
      const lift = attack ? Math.max(0, Math.sin(cycle)) * 0.24 : 0;
      const hip = new THREE.Vector3(leg.side * 0.66, 0.96 + this.body.position.y,
        leg.fore * 0.53);
      const foot = new THREE.Vector3(leg.side * 1.04 * spread,
        0.10 + lift, leg.fore * 0.80 * spread + strideZ);
      const knee = new THREE.Vector3(leg.side * 0.89 * spread,
        0.51 + lift * 0.4, leg.fore * 0.64 * spread + strideZ * 0.4);
      connect(leg.upper, hip, knee);
      connect(leg.lower, knee, foot);
      leg.foot.position.copy(foot);
    }

    this.chipAge += step;
    this.chips.visible = this.chipAge < 0.62;
    if (this.chips.visible) {
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI * 2 / 8;
        const age = this.chipAge;
        dummy.position.set(Math.cos(angle) * (0.55 + age * 1.65),
          1.15 + age * (1.1 + (i % 3) * 0.25) - age * age * 5.2,
          Math.sin(angle) * (0.55 + age * 1.65));
        dummy.rotation.set(age * (i + 2), angle, age * (i + 1));
        dummy.scale.setScalar(Math.max(0.05, 1 - age / 0.62));
        dummy.updateMatrix();
        this.chips.setMatrixAt(i, dummy.matrix);
      }
      this.chips.instanceMatrix.needsUpdate = true;
    }
  }
}
