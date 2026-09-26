import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { RigColors } from './PlayerRig.ts';

let template: THREE.Group | null = null;
let loadedUrl: string | null = null;
let pending: Promise<void> | null = null;
const REQUIRED_BONES = [
  'Pelvis', 'Spine', 'Chest', 'Neck', 'Head',
  'UpperArm_L', 'UpperArm_R', 'Forearm_L', 'Forearm_R', 'Hand_L', 'Hand_R',
  'Thigh_L', 'Thigh_R', 'Shin_L', 'Shin_R', 'Foot_L', 'Foot_R',
];

/** Parse once; failed loads remain retryable and are reported to the caller. */
export function loadWorkerAsset(url: string): Promise<void> {
  if (template && loadedUrl === url) return Promise.resolve();
  if (pending && loadedUrl === url) return pending;
  loadedUrl = url;
  pending = new GLTFLoader().loadAsync(url).then((gltf) => {
    const body = gltf.scene.getObjectByName('WorkerBody');
    if (!(body instanceof THREE.SkinnedMesh))
      throw new Error('worker GLB has no skinned WorkerBody');
    const present = new Set(body.skeleton.bones.map((bone) => bone.name));
    const missing = REQUIRED_BONES.filter((name) => !present.has(name));
    if (missing.length) throw new Error(`worker GLB missing bones: ${missing.join(', ')}`);
    template = gltf.scene;
  }).catch((error: unknown) => {
    template = null;
    loadedUrl = null;
    throw error;
  }).finally(() => { pending = null; });
  return pending;
}

function channel(value: number): number {
  return Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255);
}

function paletteTexture(colors: RigColors): THREE.DataTexture {
  const bytes = new Uint8Array(16);
  for (const [i, key] of (['suit', 'suitDark', 'skin', 'gloves'] as const).entries()) {
    const c = colors[key].clone().convertLinearToSRGB();
    bytes.set([channel(c.r), channel(c.g), channel(c.b), 255], i * 4);
  }
  const tex = new THREE.DataTexture(bytes, 4, 1, THREE.RGBAFormat);
  tex.name = 'WorkerPaletteInstance';
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

export interface WorkerVisual {
  root: THREE.Group;
  body: THREE.SkinnedMesh;
  dispose(): void;
}

/** New bones and palette per peer; immutable mesh geometry stays shared. */
export function cloneWorkerVisual(colors: RigColors): WorkerVisual {
  if (!template) throw new Error('loadWorkerAsset must finish before cloning');
  const root = cloneSkeleton(template) as THREE.Group;
  root.name = 'ConnectedWorkerVisual';
  root.visible = true;
  const body = root.getObjectByName('WorkerBody');
  if (!(body instanceof THREE.SkinnedMesh)) throw new Error('cloned worker lost skin');
  const ownedMaterials = new Set<THREE.Material>();
  const ownedTextures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const previous = Array.isArray(object.material) ? object.material : [object.material];
    const replacement = previous.map((base) => {
      const material = base.clone();
      ownedMaterials.add(material);
      if (material instanceof THREE.MeshStandardMaterial) {
        if (object === body) {
          material.map = paletteTexture(colors);
          ownedTextures.add(material.map);
          material.color.set(0xffffff);
          material.needsUpdate = true;
        } else if (material.name in colors) {
          const key = material.name as keyof RigColors;
          material.color.copy(colors[key]);
        }
      }
      return material;
    });
    object.material = Array.isArray(object.material) ? replacement : replacement[0];
  });
  let disposed = false;
  return { root, body, dispose() {
    if (disposed) return;
    disposed = true;
    for (const material of ownedMaterials) material.dispose();
    for (const texture of ownedTextures) texture.dispose();
  } };
}
