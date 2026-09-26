import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

type Side = 'L' | 'R';
const names = ['ToolGrip_L', 'ToolGrip_R', 'CarryGrip_L', 'CarryGrip_R'] as const;
let templates: Map<string, THREE.BufferGeometry> | null = null;
let loadedUrl: string | null = null;
let pending: Promise<void> | null = null;

export function loadWorkerHands(url: string): Promise<void> {
  if (templates && loadedUrl === url) return Promise.resolve();
  if (pending && loadedUrl === url) return pending;
  loadedUrl = url;
  pending = new GLTFLoader().loadAsync(url).then((gltf) => {
    const next = new Map<string, THREE.BufferGeometry>();
    for (const name of names) {
      const object = gltf.scene.getObjectByName(name);
      if (!(object instanceof THREE.Mesh)) throw new Error(`hand GLB missing ${name}`);
      for (const attr of ['position', 'normal', 'color'])
        if (!object.geometry.getAttribute(attr)) throw new Error(`${name} missing ${attr}`);
      next.set(name, object.geometry);
    }
    templates = next;
  }).catch((error: unknown) => {
    loadedUrl = null; templates = null; throw error;
  }).finally(() => { pending = null; });
  return pending;
}

function cloneHand(name: string): THREE.BufferGeometry {
  const source = templates?.get(name);
  if (!source) throw new Error(`loadWorkerHands must finish before ${name}`);
  const geo = source.index ? source.toNonIndexed() : source.clone();
  for (const attr of Object.keys(geo.attributes))
    if (attr !== 'position' && attr !== 'normal' && attr !== 'color') geo.deleteAttribute(attr);
  const color = geo.getAttribute('color');
  if (color.itemSize === 4) {
    const rgb = new Float32Array(color.count * 3);
    for (let i = 0; i < color.count; i++) {
      rgb[i*3] = color.getX(i); rgb[i*3+1] = color.getY(i); rgb[i*3+2] = color.getZ(i);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  }
  return geo;
}

/** Owns the returned merge-ready geometry; the template is never transformed. */
export function toolHand(side: Side, position: THREE.Vector3, roll: number): THREE.BufferGeometry {
  const geo = cloneHand(`ToolGrip_${side}`);
  geo.rotateZ(roll);
  geo.translate(position.x, position.y, position.z);
  geo.computeBoundingSphere();
  return geo;
}

/** Cupped glove used by the expanding fruit presentation. */
export function gripHand(material: THREE.Material, inward: 1 | -1): THREE.Mesh {
  const side: Side = inward === 1 ? 'L' : 'R';
  const mesh = new THREE.Mesh(cloneHand(`CarryGrip_${side}`), material);
  mesh.name = `vm:grip${side}`;
  return mesh;
}

export function disposeWorkerHands(): void {
  if (templates) for (const geometry of templates.values()) geometry.dispose();
  templates = null;
  loadedUrl = null;
}
