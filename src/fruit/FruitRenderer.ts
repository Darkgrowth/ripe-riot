import * as THREE from 'three';
import { fruitGeometry } from './FruitGeometry';
import type { Fruit } from './Fruit';

/**
 * One InstancedMesh per species. Everything visible — on the tree, in the air,
 * rolling down a hill, in someone's hands — is drawn from the same instance
 * buffer, so the entire island's fruit costs one draw call per species.
 *
 * Per-instance colour carries the variant/damage tint; a small shader patch
 * adds a per-instance emissive term so Glowing variants actually glow.
 */
const EMISSIVE_PATCH_VERT_DECL = `
  attribute float instanceEmissive;
  varying float vInstEmissive;
`;
const EMISSIVE_PATCH_VERT_BODY = `
  vInstEmissive = instanceEmissive;
`;
const EMISSIVE_PATCH_FRAG_DECL = `
  varying float vInstEmissive;
`;
const EMISSIVE_PATCH_FRAG_BODY = `
  totalEmissiveRadiance += vColor.rgb * vInstEmissive;
`;

class SpeciesBatch {
  mesh: THREE.InstancedMesh;
  capacity: number;
  emissiveAttr: THREE.InstancedBufferAttribute;
  private species: string;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, species: string, capacity: number) {
    this.species = species;
    this.scene = scene;
    this.capacity = capacity;
    this.mesh = this.make(capacity);
    scene.add(this.mesh);
    this.emissiveAttr = this.mesh.geometry.getAttribute('instanceEmissive') as THREE.InstancedBufferAttribute;
  }

  private make(capacity: number): THREE.InstancedMesh {
    const geo = fruitGeometry(this.species).clone();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0.02,
    });
    mat.name = `fruit:${this.species}`;
    mat.envMapIntensity = 0.5;
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${EMISSIVE_PATCH_VERT_DECL}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${EMISSIVE_PATCH_VERT_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${EMISSIVE_PATCH_FRAG_DECL}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${EMISSIVE_PATCH_FRAG_BODY}`);
    };
    // Distinguish the compiled program from a plain standard material.
    mat.customProgramCacheKey = () => `fruit-emissive-${this.species}`;

    const mesh = new THREE.InstancedMesh(geo, mat, capacity);
    mesh.name = `Fruit:${this.species}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('instanceEmissive',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // the batch spans the island; culling it is all-or-nothing
    mesh.count = 0;
    return mesh;
  }

  grow(needed: number): void {
    let cap = this.capacity;
    while (cap < needed) cap = Math.ceil(cap * 1.8) + 8;
    const old = this.mesh;
    this.mesh = this.make(cap);
    this.capacity = cap;
    this.scene.add(this.mesh);
    this.scene.remove(old);
    old.geometry.dispose();
    (old.material as THREE.Material).dispose();
    this.emissiveAttr = this.mesh.geometry.getAttribute('instanceEmissive') as THREE.InstancedBufferAttribute;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
/** Emissive lift on the aimed-at fruit. Enough to pick out of a canopy, not
 *  enough to be mistaken for a Glowing variant (which sits at 0.85). */
const HIGHLIGHT = 0.34;

export class FruitRenderer {
  private batches = new Map<string, SpeciesBatch>();
  private scene: THREE.Scene;
  private buckets = new Map<string, Fruit[]>();
  lastDrawn = 0;
  /**
   * One fruit that this client does not draw in the world.
   *
   * The local player's carried fruit is drawn by the first-person carry rig at
   * a framed size instead. It still exists at full size here — remote clients
   * receive its real position and draw it normally — it simply is not put in
   * this client's instance buffer, because a 1.7 m sphere 0.9 m from the eye is
   * not a picture of anything.
   */
  hiddenId = -1;
  /** Fruit the player is aiming at: lit so a ripe apple in a dark canopy reads. */
  highlightId = -1;

  constructor(scene: THREE.Scene) { this.scene = scene; }

  private batch(species: string): SpeciesBatch {
    let b = this.batches.get(species);
    if (!b) { b = new SpeciesBatch(this.scene, species, 48); this.batches.set(species, b); }
    return b;
  }

  /** Rewrite every instance buffer from the live fruit list. */
  update(fruits: Iterable<Fruit>): void {
    for (const list of this.buckets.values()) list.length = 0;
    let total = 0;
    for (const f of fruits) {
      if (!f.visible || f.id === this.hiddenId) continue;
      let list = this.buckets.get(f.species);
      if (!list) { list = []; this.buckets.set(f.species, list); }
      list.push(f);
      total++;
    }
    this.lastDrawn = total;

    for (const [species, list] of this.buckets) {
      const b = this.batch(species);
      if (list.length > b.capacity) b.grow(list.length);
      const colors = b.mesh.instanceColor!;
      const emis = b.emissiveAttr;
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        _s.setScalar(f.renderScale);
        _m.compose(f.position, f.quaternion, _s);
        b.mesh.setMatrixAt(i, _m);
        colors.setXYZ(i, f.tint.r, f.tint.g, f.tint.b);
        // The emissive term already exists for Glowing variants, so making the
        // aimed-at fruit legible costs one comparison and no new material: it
        // lifts the fruit's OWN colour, which reads as "this one" without
        // recolouring it into something you cannot identify.
        const lit = f.emissive ? 0.85 : 0;
        emis.setX(i, f.id === this.highlightId ? Math.max(lit, HIGHLIGHT) : lit);
      }
      b.mesh.count = list.length;
      b.mesh.instanceMatrix.needsUpdate = true;
      colors.needsUpdate = true;
      emis.needsUpdate = true;
    }
  }

  get speciesCount(): number { return this.batches.size; }

  dispose(): void {
    for (const b of this.batches.values()) b.dispose();
    this.batches.clear();
  }
}
