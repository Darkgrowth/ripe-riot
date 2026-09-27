import * as THREE from 'three';
import type { Terrain } from '@/world/Terrain';

const color = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
const GRASS = color(0x648e58);
const GRASS_DARK = color(0x4f7850);
const GRASS_LIGHT = color(0x789b61);
const EARTH = color(0xa48258);
const EARTH_LIGHT = color(0xb39568);

/** Paint the existing terrain triangles in voxel mode. The renderer and
 * Rapier already share their positions, so a second tiled surface would
 * intersect the walkable ground and expose its own vertical seams. */
export function paintVoxelClearingTerrain(terrain: Terrain): void {
  const position = terrain.mesh.geometry.getAttribute('position');
  const colors = terrain.mesh.geometry.getAttribute('color');
  const original = new THREE.Color();
  const tint = new THREE.Color();
  const centreX = -24, centreZ = 22, radius = 30.5;

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i);
    const distance = Math.hypot(x - centreX, z - centreZ);
    if (distance > radius) continue;
    const path = terrain.pathWeight(x, z);
    const patch = Math.sin(x * 0.20 + Math.sin(z * 0.13) * 1.4)
      + Math.cos(z * 0.23 - x * 0.08);
    const grass = patch > 0.65 ? GRASS_LIGHT : patch < -0.6 ? GRASS_DARK : GRASS;
    tint.copy(grass).lerp(patch > 0 ? EARTH_LIGHT : EARTH,
      Math.min(1, path * 0.94));
    const rim = THREE.MathUtils.clamp((distance - (radius - 2.6)) / 2.6, 0, 1);
    if (rim > 0) {
      original.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i));
      tint.lerp(original, rim);
    }
    colors.setXYZ(i, tint.r, tint.g, tint.b);
  }
  colors.needsUpdate = true;
}
