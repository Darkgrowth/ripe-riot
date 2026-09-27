import * as THREE from 'three';
import { VoxelVolume } from './VoxelSurface';

const BASE = new Map<number, THREE.BufferGeometry>();

/** Broad stepped boulders with quiet faces; scaled per prop before batching. */
export function voxelRockGeometry(radius: number, variant: number): THREE.BufferGeometry {
  if (!(radius > 0)) throw new Error('rock radius must be positive');
  const shape = ((variant % 3) + 3) % 3;
  let base = BASE.get(shape);
  if (!base) {
    const volume = new VoxelVolume();
    const widths = [2.7, 2.9, 2.75];
    const depths = [2.85, 2.65, 2.95];
    for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) {
      for (let z = -3; z <= 3; z++) {
        const rough = 0.055 * Math.sin(x * 1.3 + z * 2.1 + shape * 2.4)
          + 0.035 * Math.cos(y * 1.7 - z * 0.8);
        const distance = (x / widths[shape]) ** 2 + (y / 2.75) ** 2
          + (z / depths[shape]) ** 2;
        if (distance <= 1 + rough) volume.put(x, y, z, 0xffffff);
      }
    }
    base = volume.geometry({ cellSize: 0.27,
      origin: new THREE.Vector3(-0.135, -0.135, -0.135) });
    BASE.set(shape, base);
  }
  const geometry = base.clone();
  geometry.scale(radius, radius, radius);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = `VoxelRock:${shape}`;
  return geometry;
}
