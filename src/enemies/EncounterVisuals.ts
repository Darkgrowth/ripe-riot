import * as THREE from 'three';
import type { EncounterKind, EncounterProjectile, EncounterState } from './EncounterModel';
import { MimicRig, type MimicStyle } from './MimicRig.ts';
import { voxelSnapjawBase, voxelSnapjawCore, voxelSnapjawEye,
  voxelSnapjawLowerJaw, voxelSnapjawLowerMouth, voxelSnapjawTeeth,
  voxelSnapjawUpperJaw, voxelSnapjawUpperMouth } from './VoxelSnapjawGeometry.ts';
import { voxelSpitterBase, voxelSpitterBulb, voxelSpitterLeaves,
  voxelSpitterMuzzle, voxelSpitterPod } from './VoxelSpitterGeometry.ts';

const color = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
const material = (hex: number, roughness = 0.86, emissive = 0): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: color(hex), roughness,
    emissive: color(hex), emissiveIntensity: emissive, flatShading: true });

function mesh(geometry: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D,
  x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** A small, hand-built silhouette for each threat; no ordinary fruit mesh is reused. */
export class EncounterVisual {
  readonly root = new THREE.Group();
  private kind: EncounterKind;
  private readonly voxelSnapjaw: boolean;
  private readonly voxelSpitter: boolean;
  private mimicRig: MimicRig | null = null;
  private upperJaw: THREE.Group | null = null;
  private snapjawAnatomy: THREE.Group | null = null;
  private snapjawHealth: number | null = null;
  private snapjawHitAge = 99;
  private snapjawDefeatAge = 99;
  private snapjawWasDefeated = false;
  private spitterHead: THREE.Group | null = null;
  private spitterAnatomy: THREE.Group | null = null;
  private spitterBulb: THREE.Mesh | null = null;
  private spitterHealth: number | null = null;
  private spitterHitAge = 99;
  private spitterDefeatAge = 99;
  private spitterWasDefeated = false;
  private prize: THREE.Mesh | null = null;
  private eyes: THREE.Mesh[] = [];
  private danger: THREE.Mesh;
  private lane: THREE.Mesh | null = null;
  private glow: THREE.MeshStandardMaterial | null = null;
  private time = 0;
  private positioned = false;

  constructor(kind: EncounterKind, scene: THREE.Scene, style: MimicStyle = 'polygon') {
    this.kind = kind;
    this.voxelSnapjaw = kind === 'snapjaw' && style === 'voxel';
    this.voxelSpitter = kind === 'spitter' && style === 'voxel';
    this.root.name = kind === 'mimic' ? 'Mimic Melon'
      : kind === 'snapjaw' ? 'Snapjaw' : 'Spitter Plant';
    scene.add(this.root);
    if (kind === 'mimic') this.mimicRig = new MimicRig(this.root, style);
    else if (kind === 'snapjaw') {
      if (this.voxelSnapjaw) this.buildVoxelSnapjaw();
      else this.buildSnapjaw();
    }
    else if (this.voxelSpitter) this.buildVoxelSpitter();
    else this.buildSpitter();
    const ring = new THREE.RingGeometry(kind === 'snapjaw' ? 2.1 : 1.75,
      kind === 'snapjaw' ? 2.34 : 1.95, 40);
    const warning = new THREE.MeshBasicMaterial({ color: color(kind === 'spitter' ? 0xe9eb63 : 0xff4f28),
      transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    this.danger = mesh(ring, warning, this.root, 0, 0.08, 0);
    this.danger.rotation.x = -Math.PI / 2;
    this.danger.castShadow = false;
    this.danger.receiveShadow = false;
    if (kind === 'mimic') {
      const laneMat = new THREE.MeshBasicMaterial({ color: color(0xff6b32),
        transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
      this.lane = mesh(new THREE.PlaneGeometry(2.3, 9.2), laneMat, this.root, 0, 0.065, 4.6);
      this.lane.rotation.x = -Math.PI / 2;
      this.lane.castShadow = false;
      this.lane.receiveShadow = false;
    } else if (kind === 'snapjaw') {
      const laneMat = new THREE.MeshBasicMaterial({ color: color(0xff9b3d),
        transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
      this.lane = mesh(new THREE.PlaneGeometry(0.9, 8), laneMat,
        this.root, 0, 0.075, 4);
      this.lane.rotation.x = -Math.PI / 2;
      this.lane.castShadow = false;
      this.lane.receiveShadow = false;
    } else if (kind === 'spitter') {
      const laneMat = new THREE.MeshBasicMaterial({ color: color(0xf0ec69),
        transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
      this.lane = mesh(new THREE.PlaneGeometry(0.8, 16), laneMat, this.root, 0, 0.075, 8);
      this.lane.rotation.x = -Math.PI / 2;
      this.lane.castShadow = false;
      this.lane.receiveShadow = false;
    }
  }

  update(state: Readonly<EncounterState>, groundY: number, dt: number): void {
    this.time += dt;
    if (this.kind !== 'mimic' && !this.voxelSnapjaw && !this.voxelSpitter)
      this.root.visible = state.phase !== 'defeated';
    const target = new THREE.Vector3(state.position[0], groundY, state.position[2]);
    if (!this.positioned) { this.root.position.copy(target); this.positioned = true; }
    else this.root.position.lerp(target, 1 - Math.exp(-Math.max(0, dt) * 24));
    this.root.rotation.y = state.heading;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 18);
    const warning = state.phase === 'warn';
    const attacking = state.phase === 'attack';
    const recovering = state.phase === 'recover';
    if (this.kind === 'snapjaw') {
      (this.danger.material as THREE.MeshBasicMaterial).color.setHex(
        state.baited ? 0xffbe47 : 0xff4f28);
    }
    (this.danger.material as THREE.MeshBasicMaterial).opacity = this.kind === 'mimic'
      ? warning ? 0.26 + 0.14 * pulse : attacking ? 0.18 : 0
      : warning ? 0.36 + 0.36 * pulse
        : attacking ? 0.32 : state.capturedVictimId !== null ? 0.28 + pulse * 0.22 : 0;
    this.danger.scale.setScalar(warning ? 0.87 + pulse * 0.15 : 1);
    if (this.lane) {
      (this.lane.material as THREE.MeshBasicMaterial).opacity =
        this.kind === 'snapjaw' ? state.capturedVictimId !== null
          ? 0.20 + pulse * 0.12 : 0
          : warning ? this.kind === 'mimic' ? 0.17 + pulse * 0.08
            : 0.14 + pulse * 0.17 : 0;
      if (this.kind === 'snapjaw' && state.captureAim) {
        const distance = Math.min(10, Math.max(2,
          Math.hypot(state.captureAim[0] - state.position[0],
            state.captureAim[2] - state.position[2])));
        this.lane.position.z = distance * .5;
        this.lane.scale.y = distance / 8;
      }
    }

    if (this.kind === 'mimic') {
      this.mimicRig?.update(state, dt);
      if (state.dormant) this.root.visible = false;
    } else if (this.kind === 'snapjaw') {
      if (this.voxelSnapjaw) {
        if (this.snapjawHealth !== null && state.health < this.snapjawHealth)
          this.snapjawHitAge = 0;
        this.snapjawHitAge += Math.max(0, dt);
        if (state.phase === 'defeated' && !this.snapjawWasDefeated) {
          // A loaded/co-op defeated snapshot is already a wilted remnant. A
          // live kill takes a short beat to fold down, without changing rules.
          this.snapjawDefeatAge = this.snapjawHealth === null ? 0.72 : 0;
          this.snapjawWasDefeated = true;
        }
        if (this.snapjawWasDefeated) this.snapjawDefeatAge += Math.max(0, dt);
        this.snapjawHealth = state.health;
        this.root.visible = true;
      }
      const open = this.voxelSnapjaw && state.phase === 'defeated' ? 0.02
        : state.capturedVictimId !== null ? 0.48 + pulse * 0.13
        : warning ? 0.43 + pulse * 0.22
          : attacking && this.voxelSnapjaw
            ? Math.max(0.02, Math.min(0.74, (state.timeLeft / 0.32) ** 2 * 0.74))
            : attacking ? 0.02
        : recovering ? 0.95 : 0.16;
      if (this.upperJaw) {
        this.upperJaw.position.y = 1.58 + open * 0.62;
        this.upperJaw.rotation.x = -open * 0.62;
      }
      if (this.prize) {
        if (this.voxelSnapjaw) this.prize.visible = state.phase !== 'defeated';
        this.prize.position.y = this.voxelSnapjaw
          ? 1.36 + (recovering ? 0.20 : 0.03)
          : 1.36 + (recovering ? 0.35 : 0.06);
        this.prize.scale.setScalar(this.voxelSnapjaw
          ? recovering ? 1.02 + pulse * 0.06 : 0.92 + Math.sin(this.time * 3.2) * 0.025
          : recovering ? 1.23 : 1 + Math.sin(this.time * 3.2) * 0.06);
      }
      if (this.glow) this.glow.emissiveIntensity = this.voxelSnapjaw
        ? state.phase === 'defeated' ? 0 : recovering ? 0.19 + pulse * 0.08 : 0.07
        : recovering ? 1.7 : 0.65;
      for (const eye of this.eyes) eye.scale.setScalar(warning || attacking ? 1.25 : 1);
      if (this.voxelSnapjaw && this.eyes[0]?.material instanceof THREE.MeshStandardMaterial)
        this.eyes[0].material.emissiveIntensity = state.phase === 'defeated' ? 0 : 0.33;
      if (this.snapjawAnatomy) {
        const hit = Math.max(0, 1 - this.snapjawHitAge / 0.38);
        const fall = this.snapjawWasDefeated
          ? THREE.MathUtils.smoothstep(this.snapjawDefeatAge, 0, 0.72) : 0;
        this.snapjawAnatomy.rotation.x = (warning ? -0.09 - pulse * 0.045
          : attacking ? 0.15 : recovering ? -0.075
            : this.snapjawWasDefeated ? 0
              : Math.sin(this.time * 1.3) * 0.025) - hit * 0.22 + fall * 0.75;
        this.snapjawAnatomy.rotation.z = hit * Math.sin(this.snapjawHitAge * 35) * 0.16
          + fall * 0.57;
        this.snapjawAnatomy.position.y = -fall * 0.50;
        this.snapjawAnatomy.scale.y = 1 - fall * 0.42;
        if (this.upperJaw && fall > 0) this.upperJaw.rotation.x = fall * 0.34;
      }
    } else {
      if (this.voxelSpitter) {
        if (this.spitterHealth !== null && state.health < this.spitterHealth)
          this.spitterHitAge = 0;
        this.spitterHitAge += Math.max(0, dt);
        if (state.phase === 'defeated' && !this.spitterWasDefeated) {
          this.spitterDefeatAge = this.spitterHealth === null ? 0.72 : 0;
          this.spitterWasDefeated = true;
        }
        if (this.spitterWasDefeated) this.spitterDefeatAge += Math.max(0, dt);
        this.spitterHealth = state.health;
        this.root.visible = true;
        const fall = this.spitterWasDefeated
          ? THREE.MathUtils.smoothstep(this.spitterDefeatAge, 0, 0.72) : 0;
        const hit = Math.max(0, 1 - this.spitterHitAge / 0.36);
        if (this.spitterAnatomy) {
          this.spitterAnatomy.rotation.x = (warning ? -0.07 : 0) + fall * 0.95;
          this.spitterAnatomy.rotation.z = hit * 0.20 + fall * 0.24;
          this.spitterAnatomy.position.y = -fall * 0.46;
          this.spitterAnatomy.scale.y = 1 - fall * 0.43;
        }
        if (this.spitterBulb) this.spitterBulb.scale.setScalar(fall ? 1 - fall * 0.34
          : warning ? 1.13 + pulse * 0.05 : recovering ? 0.94 : 1);
        if (this.spitterHead) {
          this.spitterHead.position.y = 2.1 - fall * 0.24;
          this.spitterHead.rotation.x = fall ? 0.52 * fall
            : warning ? -0.28 - pulse * 0.04
              : attacking ? 0.22 + Math.max(0, state.timeLeft / 0.2) * 0.36
                : recovering ? 0.10 : Math.sin(this.time * 1.5) * 0.025;
        }
        if (this.glow) this.glow.emissiveIntensity = fall ? 0
          : warning ? 0.16 + pulse * 0.08 : attacking ? 0.22 : 0.06;
      } else if (this.spitterHead) {
        this.spitterHead.position.y = 1.9 + (warning ? 0.22 + pulse * 0.1 : 0);
        this.spitterHead.rotation.x = warning ? -0.22 : attacking ? 0.42
          : recovering ? 0.12 : Math.sin(this.time * 1.8) * 0.035;
      }
      if (!this.voxelSpitter && this.glow) this.glow.emissiveIntensity = warning ? 1.6 + pulse * 1.1
        : attacking ? 2.2 : 0.45;
    }
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.root.traverse(obj => {
      if (!(obj instanceof THREE.Mesh)) return;
      geometries.add(obj.geometry);
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) materials.add(m);
    });
    for (const geo of geometries) geo.dispose();
    for (const mat of materials) mat.dispose();
  }

  private buildSnapjaw(): void {
    const rootMat = material(0x405b31);
    const outer = material(0x567532);
    const lip = material(0x9a5742);
    const inner = material(0x4a1e28);
    const teeth = material(0xe9d6a7);
    const eyeMat = material(0xff713d, 0.35, 0.4);
    const core = material(0xffc65e, 0.3, 0.65);
    this.glow = core;
    mesh(new THREE.CylinderGeometry(0.48, 0.78, 0.9, 8), rootMat, this.root, 0, 0.48, 0);
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      const root = mesh(new THREE.ConeGeometry(0.23, 1.25, 5), rootMat,
        this.root, Math.sin(a) * 0.86, 0.35, Math.cos(a) * 0.86);
      root.rotation.z = Math.sin(a) * 1.13;
      root.rotation.x = -Math.cos(a) * 1.13;
    }
    const lower = mesh(new THREE.SphereGeometry(1, 12, 7), outer, this.root, 0, 1.1, 0.12);
    lower.scale.set(1.35, 0.37, 1.02);
    const mouth = mesh(new THREE.SphereGeometry(1, 12, 7), inner, this.root, 0, 1.37, 0.12);
    mouth.scale.set(1.12, 0.13, 0.85);
    mesh(new THREE.TorusGeometry(0.89, 0.11, 5, 14, Math.PI), lip,
      this.root, 0, 1.35, 0.72);
    this.upperJaw = new THREE.Group();
    this.root.add(this.upperJaw);
    const top = mesh(new THREE.SphereGeometry(1, 12, 8), outer, this.upperJaw);
    top.scale.set(1.38, 0.59, 1.08);
    const gum = mesh(new THREE.SphereGeometry(1, 12, 7), lip, this.upperJaw, 0, -0.37, 0.22);
    gum.scale.set(1.14, 0.16, 0.82);
    for (let i = -3; i <= 3; i++) {
      const fang = mesh(new THREE.ConeGeometry(0.13, 0.39, 4), teeth,
        this.upperJaw, i * 0.28, -0.51, 0.73 - Math.abs(i) * 0.07);
      fang.rotation.z = Math.PI;
    }
    for (const x of [-0.68, 0.68]) {
      const eye = mesh(new THREE.SphereGeometry(0.16, 7, 5), eyeMat,
        this.upperJaw, x, 0.15, 0.84);
      this.eyes.push(eye);
    }
    this.prize = mesh(new THREE.IcosahedronGeometry(0.35, 1), core,
      this.root, 0, 1.42, 1.08);
    const crown = mesh(new THREE.TorusGeometry(0.43, 0.045, 5, 18), teeth,
      this.root, 0, 1.47, 1.06);
    crown.rotation.x = 0.35;
  }

  private buildVoxelSnapjaw(): void {
    const shell = new THREE.MeshStandardMaterial({ vertexColors: true,
      roughness: 0.88, metalness: 0, flatShading: true });
    const ember = new THREE.MeshStandardMaterial({ vertexColors: true,
      roughness: 0.44, emissive: color(0xff6533), emissiveIntensity: 0.33,
      flatShading: true });
    const core = new THREE.MeshStandardMaterial({ vertexColors: true,
      roughness: 0.7, emissive: color(0x9d4418), emissiveIntensity: 0.07,
      flatShading: true });
    this.glow = core;
    this.snapjawAnatomy = new THREE.Group();
    this.snapjawAnatomy.name = 'Snapjaw rooted anatomy';
    this.root.add(this.snapjawAnatomy);
    const body = this.snapjawAnatomy;
    mesh(voxelSnapjawBase(), shell, body);
    mesh(voxelSnapjawLowerJaw(), shell, body);
    mesh(voxelSnapjawLowerMouth(), shell, body);
    this.upperJaw = new THREE.Group();
    this.upperJaw.name = 'Snapjaw moving leaf jaw';
    body.add(this.upperJaw);
    mesh(voxelSnapjawUpperJaw(), shell, this.upperJaw);
    mesh(voxelSnapjawUpperMouth(), shell, this.upperJaw);
    mesh(voxelSnapjawTeeth(), shell, this.upperJaw);
    for (const x of [-0.71, 0.71]) {
      const eye = mesh(voxelSnapjawEye(), ember, this.upperJaw, x, 0.17, 1.12);
      this.eyes.push(eye);
    }
    this.prize = mesh(voxelSnapjawCore(), core, body, 0, 1.39, 0.55);
    this.prize.name = 'Snapjaw exposed seed';
  }

  private buildSpitter(): void {
    const stalk = material(0x344f36);
    const leaf = material(0x628a43);
    const leafDark = material(0x456c38);
    const bulb = material(0x789455);
    const throat = material(0x293a2a);
    const seed = material(0xe8e567, 0.35, 0.45);
    this.glow = seed;
    mesh(new THREE.CylinderGeometry(0.32, 0.6, 1.7, 7), stalk, this.root, 0, 0.88, 0);
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      const frond = mesh(new THREE.ConeGeometry(0.34, 1.7, 5),
        i % 2 ? leaf : leafDark, this.root,
        Math.sin(a) * 0.58, 0.51, Math.cos(a) * 0.58);
      frond.rotation.z = Math.sin(a) * 1.1;
      frond.rotation.x = -Math.cos(a) * 1.1;
    }
    this.spitterHead = new THREE.Group();
    this.spitterHead.position.y = 1.9;
    this.root.add(this.spitterHead);
    const sac = mesh(new THREE.SphereGeometry(0.75, 11, 8), bulb, this.spitterHead,
      0, 0.02, -0.1);
    sac.scale.set(0.95, 0.82, 1.12);
    const snout = mesh(new THREE.CylinderGeometry(0.5, 0.68, 0.72, 10), leaf,
      this.spitterHead, 0, -0.06, 0.65);
    snout.rotation.x = Math.PI / 2;
    mesh(new THREE.CircleGeometry(0.39, 12), throat,
      this.spitterHead, 0, -0.06, 1.04);
    mesh(new THREE.SphereGeometry(0.23, 8, 6), seed, this.spitterHead,
      0, -0.06, 1.075);
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      const petal = mesh(new THREE.ConeGeometry(0.19, 0.62, 4), leafDark,
        this.spitterHead, Math.sin(a) * 0.57, -0.06 + Math.cos(a) * 0.57, 0.96);
      petal.rotation.z = -Math.sin(a) * 0.85;
      petal.rotation.x = Math.cos(a) * 0.85;
    }
    for (const x of [-0.41, 0.41]) {
      const eye = mesh(new THREE.SphereGeometry(0.12, 7, 5), seed,
        this.spitterHead, x, 0.33, 0.65);
      this.eyes.push(eye);
    }
  }

  private buildVoxelSpitter(): void {
    const shell = new THREE.MeshStandardMaterial({ vertexColors: true,
      roughness: 0.86, metalness: 0, flatShading: true });
    const mouth = new THREE.MeshStandardMaterial({ vertexColors: true,
      roughness: 0.78, metalness: 0, emissive: color(0x9d9a42),
      emissiveIntensity: 0.06, flatShading: true });
    this.glow = mouth;
    this.spitterAnatomy = new THREE.Group();
    this.spitterAnatomy.name = 'Spitter rooted anatomy';
    this.root.add(this.spitterAnatomy);
    mesh(voxelSpitterBase(), shell, this.spitterAnatomy);
    mesh(voxelSpitterLeaves(), shell, this.spitterAnatomy);
    this.spitterHead = new THREE.Group();
    this.spitterHead.name = 'Spitter firing head';
    this.spitterHead.position.y = 2.1;
    this.spitterAnatomy.add(this.spitterHead);
    this.spitterBulb = mesh(voxelSpitterBulb(), shell, this.spitterHead);
    this.spitterBulb.name = 'Spitter pressure bulb';
    const muzzle = mesh(voxelSpitterMuzzle(), mouth, this.spitterHead);
    muzzle.name = 'Spitter muzzle';
  }
}

/** Spitter shot presentation; voxel mode keeps its pod on the authoritative position. */
export class EncounterProjectileVisual {
  readonly root = new THREE.Group();
  private positioned = false;
  private readonly voxel: boolean;
  private pod: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene, style: MimicStyle = 'polygon') {
    this.voxel = style === 'voxel';
    this.root.name = 'Spitter seed';
    scene.add(this.root);
    if (this.voxel) {
      this.pod = mesh(voxelSpitterPod(), new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.7, flatShading: true,
        emissive: color(0x8c8430), emissiveIntensity: 0.12,
      }), this.root);
      this.pod.name = 'Spitter seed pod';
    } else {
      mesh(new THREE.IcosahedronGeometry(0.3, 1),
        new THREE.MeshBasicMaterial({ color: color(0xf5f58a) }), this.root);
      const halo = mesh(new THREE.SphereGeometry(0.48, 8, 6),
        new THREE.MeshBasicMaterial({ color: color(0xdbed65), transparent: true,
          opacity: 0.25, depthWrite: false }), this.root);
      halo.castShadow = false;
    }
  }

  update(state: EncounterProjectile, dt: number): void {
    const target = new THREE.Vector3(...state.position);
    if (this.voxel) {
      this.root.position.copy(target);
      const direction = new THREE.Vector3(...state.velocity).normalize();
      if (direction.lengthSq() > 0)
        this.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
      if (this.pod) {
        this.pod.rotation.z += dt * 6;
        const mat = this.pod.material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(state.reflectedBy ? 0x42b9d1 : 0x8c8430);
        mat.emissiveIntensity = state.reflectedBy ? .55 : .12;
      }
    } else {
      if (!this.positioned) { this.root.position.copy(target); this.positioned = true; }
      else this.root.position.lerp(target, 1 - Math.exp(-Math.max(0, dt) * 30));
      this.root.rotation.y += dt * 5;
    }
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    this.root.traverse(obj => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) mat.dispose();
    });
  }
}
