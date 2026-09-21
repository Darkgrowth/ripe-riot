import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { plantShape, swayCurve, SHAPE_VARIANTS, type PlantType } from './PlantGeometry';
import type { PhysicsWorld, PhysicsOwner, RBody, RCollider } from '@/physics/PhysicsWorld';
import { Groups } from '@/physics/Layers';
import { Rng } from '@/core/Rng';

export interface PlantNode {
  local: THREE.Vector3;
  world: THREE.Vector3;
  quat: THREE.Quaternion;
  /** Fruit currently attached here, or -1. */
  fruitId: number;
  /** How firmly this node holds, multiplied into the species attach strength. */
  grip: number;
}

export interface Plant extends PhysicsOwner {
  readonly id: number;
  readonly kind: string;
  type: PlantType;
  variant: number;
  position: THREE.Vector3;
  rotationY: number;
  scale: number;
  height: number;
  phase: number;
  /** Extra sway amplitude from shaking; decays each step. */
  shake: number;
  /** Per-instance colour multiplier: warm/cool and light/dark jitter, so a
   *  grove of three shapes does not read as a grove of three trees. */
  tint: [number, number, number];
  nodes: PlantNode[];
  batchKey: string;
  instanceIndex: number;
  body: RBody | null;
  colliders: RCollider[];
}

interface Batch {
  harvestCrown: boolean;
  mesh: THREE.InstancedMesh;
  plants: Plant[];
  capacity: number;
  phaseAttr: THREE.InstancedBufferAttribute;
  shakeAttr: THREE.InstancedBufferAttribute;
  type: PlantType;
  variant: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _off = new THREE.Vector3();
const _wind = new THREE.Vector3(1, 0, 0);
const _perp = new THREE.Vector3();

/**
 * Instanced plants with GPU wind sway. The exact sway curve is duplicated on
 * the CPU (see `swayOffset`) so attached fruit tracks the branch it is on
 * instead of hovering next to it.
 */
export class PlantSystem {
  private batches = new Map<string, Batch>();
  private plantsById = new Map<number, Plant>();
  private scene: THREE.Scene;
  private physics: PhysicsWorld;
  private uniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3(1, 0, 0) },
    uWindStrength: { value: 0.12 },
  };
  windDir = new THREE.Vector3(1, 0, 0);
  windStrength = 0.12;

  constructor(scene: THREE.Scene, physics: PhysicsWorld) {
    this.scene = scene;
    this.physics = physics;
  }

  // ---- creation -----------------------------------------------------------
  private batchFor(type: PlantType, variant: number, harvestCrown: boolean): Batch {
    const key = `${type}:${variant}${harvestCrown ? ':harvest' : ''}`;
    let b = this.batches.get(key);
    if (b) return b;
    b = this.makeBatch(type, variant, 32, harvestCrown);
    this.batches.set(key, b);
    return b;
  }

  private makeBatch(type: PlantType, variant: number, capacity: number, harvestCrown: boolean): Batch {
    const shape = plantShape(type, variant, harvestCrown);
    const geo = shape.geometry.clone();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.88, metalness: 0,
      side: type === 'bananaPlant' || type === 'melonVine' ? THREE.DoubleSide : THREE.FrontSide,
    });
    mat.name = `plant:${type}`;
    mat.envMapIntensity = 0.4;
    const u = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = u.uTime;
      shader.uniforms.uWind = u.uWind;
      shader.uniforms.uWindStrength = u.uWindStrength;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float swayWeight;
          attribute float instancePhase;
          attribute float instanceShake;
          uniform float uTime;
          uniform vec3 uWind;
          uniform float uWindStrength;`)
        .replace('#include <project_vertex>', `
          vec4 mvPosition = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
            // Sway is applied in world space so a rotated instance still bends
            // downwind. The mesh itself is kept at the origin with an identity
            // model matrix, so model space and world space are the same here.
            float amp = (uWindStrength + instanceShake) * swayWeight;
            vec3 wdir = normalize(uWind + vec3(0.0001, 0.0, 0.0));
            vec3 wperp = vec3(-wdir.z, 0.0, wdir.x);
            float s1 = sin(uTime * 1.15 + instancePhase);
            float s2 = sin(uTime * 2.70 + instancePhase * 1.7);
            float s3 = sin(uTime * 0.90 + instancePhase * 1.3);
            mvPosition.xyz += wdir * (amp * (0.55 * s1 + 0.18 * s2));
            mvPosition.xyz += wperp * (amp * 0.28 * s3);
            mvPosition.y -= amp * abs(s1) * 0.12;
          #endif
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;`);
    };
    mat.customProgramCacheKey = () => 'plant-sway';

    const mesh = new THREE.InstancedMesh(geo, mat, capacity);
    mesh.name = `Plants:${type}:${variant}${harvestCrown ? ':harvest' : ''}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.matrixAutoUpdate = false; // identity model matrix, see shader note
    const phaseAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    const shakeAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    shakeAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('instancePhase', phaseAttr);
    geo.setAttribute('instanceShake', shakeAttr);
    this.scene.add(mesh);
    return { mesh, plants: [], capacity, phaseAttr, shakeAttr, type, variant, harvestCrown };
  }

  private growBatch(b: Batch): void {
    const key = `${b.type}:${b.variant}${b.harvestCrown ? ':harvest' : ''}`;
    const cap = Math.ceil(b.capacity * 1.8) + 8;
    const old = b.mesh;
    const fresh = this.makeBatch(b.type, b.variant, cap, b.harvestCrown);
    fresh.plants = b.plants;
    this.scene.remove(old);
    old.geometry.dispose();
    (old.material as THREE.Material).dispose();
    this.batches.set(key, fresh);
    for (let i = 0; i < fresh.plants.length; i++) {
      const p = fresh.plants[i];
      p.instanceIndex = i;
      fresh.phaseAttr.setX(i, p.phase);
      fresh.mesh.instanceColor!.setXYZ(i, p.tint[0], p.tint[1], p.tint[2]);
    }
    fresh.mesh.count = fresh.plants.length;
    fresh.phaseAttr.needsUpdate = true;
    fresh.mesh.instanceColor!.needsUpdate = true;
    // Callers hold Batch references only transiently, so swapping is safe.
    Object.assign(b, fresh);
  }

  plant(id: number, type: PlantType, position: THREE.Vector3, rng: Rng,
    opts: { scale?: number; rotationY?: number; variant?: number } = {}): Plant {
    const variant = opts.variant ?? rng.int(0, SHAPE_VARIANTS - 1);
    // The reviewed pruning treatment now covers every orchard on Sunpatch.
    // Reusing the existing type/variant batches avoids a second regional set.
    const harvestCrown = type === 'appleTree' || type === 'orangeTree';
    const shape = plantShape(type, variant, harvestCrown);
    const b = this.batchFor(type, variant, harvestCrown);
    if (b.plants.length + 1 > b.capacity) this.growBatch(b);

    const scale = opts.scale ?? rng.range(0.85, 1.2);
    const rotationY = opts.rotationY ?? rng.range(0, Math.PI * 2);
    // Warm (yellow-green) to cool (blue-green), and a little lighter or darker.
    const warm = rng.range(-1, 1);
    const lum = rng.range(0.9, 1.08);
    const tint: [number, number, number] = [
      lum * (1 + warm * 0.09), lum * (1 + warm * 0.03), lum * (1 - warm * 0.11),
    ];
    const p: Plant = {
      id, kind: 'plant', type, variant, position: position.clone(), rotationY, scale,
      height: shape.height * scale,
      phase: rng.range(0, Math.PI * 2),
      shake: 0,
      tint,
      nodes: shape.attachPoints.map((local) => ({
        local: local.clone(), world: new THREE.Vector3(), quat: new THREE.Quaternion(),
        fruitId: -1, grip: rng.range(0.85, 1.25),
      })),
      batchKey: `${type}:${variant}${harvestCrown ? ':harvest' : ''}`,
      instanceIndex: b.plants.length,
      body: null, colliders: [],
    };
    b.plants.push(p);
    this.plantsById.set(id, p);

    _q.setFromAxisAngle(UP, rotationY);
    _s.setScalar(scale);
    _m.compose(position, _q, _s);
    b.mesh.setMatrixAt(p.instanceIndex, _m);
    b.phaseAttr.setX(p.instanceIndex, p.phase);
    b.mesh.instanceColor!.setXYZ(p.instanceIndex, tint[0], tint[1], tint[2]);
    b.mesh.count = b.plants.length;
    b.mesh.instanceMatrix.needsUpdate = true;
    b.phaseAttr.needsUpdate = true;
    b.mesh.instanceColor!.needsUpdate = true;

    if (shape.collider) {
      const c = shape.collider;
      const body = this.physics.createFixed(
        _v.copy(position).setY(position.y + c.offset * scale));
      const desc = RAPIER.ColliderDesc.capsule(c.halfHeight * scale, c.radius * scale)
        .setFriction(0.9);
      const col = this.physics.attach(body, desc, Groups.plant);
      this.physics.register(p, body, [col]);
      p.body = body;
      p.colliders = [col];
    }

    this.updateNodes(p, 0);
    return p;
  }

  get(id: number): Plant | undefined { return this.plantsById.get(id); }
  get count(): number { return this.plantsById.size; }
  all(): IterableIterator<Plant> { return this.plantsById.values(); }

  // ---- sway ---------------------------------------------------------------
  /** CPU mirror of the vertex shader's displacement. Keep the two in step. */
  swayOffset(p: Plant, localY: number, time: number, out: THREE.Vector3): THREE.Vector3 {
    const w = swayCurve(localY, p.height / p.scale);
    const amp = (this.windStrength + p.shake) * w * p.scale;
    _wind.copy(this.windDir).setY(0).normalize();
    _perp.set(-_wind.z, 0, _wind.x);
    const s1 = Math.sin(time * 1.15 + p.phase);
    const s2 = Math.sin(time * 2.7 + p.phase * 1.7);
    const s3 = Math.sin(time * 0.9 + p.phase * 1.3);
    out.set(0, 0, 0);
    out.addScaledVector(_wind, amp * (0.55 * s1 + 0.18 * s2));
    out.addScaledVector(_perp, amp * 0.28 * s3);
    out.y -= amp * Math.abs(s1) * 0.12;
    return out;
  }

  updateNodes(p: Plant, time: number): void {
    _q.setFromAxisAngle(UP, p.rotationY);
    for (const n of p.nodes) {
      _v.copy(n.local).multiplyScalar(p.scale).applyQuaternion(_q).add(p.position);
      this.swayOffset(p, n.local.y, time, _off);
      n.world.copy(_v).add(_off);
      n.quat.copy(_q);
    }
  }

  /** Shake a plant. Returns the effective force applied to its fruit. */
  shakePlant(id: number, strength: number): number {
    const p = this.plantsById.get(id);
    if (!p) return 0;
    p.shake = Math.min(2.2, p.shake + strength);
    return p.shake;
  }

  setWind(dir: THREE.Vector3, strength: number): void {
    this.windDir.copy(dir).setY(0);
    if (this.windDir.lengthSq() < 1e-6) this.windDir.set(1, 0, 0);
    this.windDir.normalize();
    this.windStrength = strength;
    (this.uniforms.uWind.value as THREE.Vector3).copy(this.windDir);
    this.uniforms.uWindStrength.value = strength;
  }

  /** Advance sway; returns plants whose shake crossed a detach threshold. */
  step(dt: number, time: number): void {
    this.uniforms.uTime.value = time;
    for (const b of this.batches.values()) {
      let dirty = false;
      for (const p of b.plants) {
        if (p.shake > 0) {
          p.shake = Math.max(0, p.shake - dt * 1.6);
          b.shakeAttr.setX(p.instanceIndex, p.shake);
          dirty = true;
        }
      }
      if (dirty) b.shakeAttr.needsUpdate = true;
    }
    for (const p of this.plantsById.values()) {
      // Only plants that actually hold fruit need CPU node updates.
      let holds = false;
      for (const n of p.nodes) if (n.fruitId >= 0) { holds = true; break; }
      if (holds) this.updateNodes(p, time);
    }
  }

  dispose(): void {
    for (const b of this.batches.values()) {
      this.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
    }
    this.batches.clear();
    this.plantsById.clear();
  }
}

const UP = new THREE.Vector3(0, 1, 0);
