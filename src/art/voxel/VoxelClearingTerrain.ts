import * as THREE from 'three';
import { ROUTE_HILL, type Terrain } from '@/world/Terrain';

const color = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
const GRASS = color(0x648e58);
const GRASS_DARK = color(0x4f7850);
const GRASS_LIGHT = color(0x789b61);
const EARTH = color(0xa48258);
const EARTH_LIGHT = color(0xb39568);

function disc(x: number, z: number, cx: number, cz: number,
  full: number, fade: number): number {
  return 1 - THREE.MathUtils.smoothstep(Math.hypot(x - cx, z - cz), full, fade);
}

function corridor(x: number, z: number, ax: number, az: number,
  bx: number, bz: number, full: number, fade: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return disc(x, z, ax + dx * t, az + dz * t, full, fade);
}

/** One art boundary for route dressing, low crops and ground colour. */
export function voxelFirstRouteWeight(x: number, z: number): number {
  let weight = Math.max(
    disc(x, z, -24, 22, 26, 31),
    disc(x, z, -36, -30, 16, 22),
    disc(x, z, -31, -8, 9, 12),
    corridor(x, z, -24, 22, 58, 62, 15, 19),
  );
  // Follow the authored climb only as far as the farm. The rest of the hill
  // route leads onward toward the ravine and is outside this visual pass.
  for (let i = 0; i < 5; i++) {
    const from = ROUTE_HILL[i], to = ROUTE_HILL[i + 1];
    weight = Math.max(weight, corridor(x, z, from[0], from[1], to[0], to[1], 8, 13));
  }
  return weight;
}

/** Paint the existing terrain triangles in voxel mode. The renderer and
 * Rapier already share their positions, so a second tiled surface would
 * intersect the walkable ground and expose its own vertical seams. */
export function paintVoxelClearingTerrain(terrain: Terrain): void {
  const position = terrain.mesh.geometry.getAttribute('position');
  const colors = terrain.mesh.geometry.getAttribute('color');
  const original = new THREE.Color();
  const tint = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i);
    const routeWeight = voxelFirstRouteWeight(x, z);
    if (routeWeight <= 0) continue;
    const path = terrain.pathWeight(x, z);
    const patch = Math.sin(x * 0.20 + Math.sin(z * 0.13) * 1.4)
      + Math.cos(z * 0.23 - x * 0.08);
    const grass = patch > 0.65 ? GRASS_LIGHT : patch < -0.6 ? GRASS_DARK : GRASS;
    tint.copy(grass).lerp(patch > 0 ? EARTH_LIGHT : EARTH,
      Math.min(1, path * 0.94));
    // Keep the stronger approved orchard palette. Elsewhere retain more of
    // the existing biome colour, especially the sand beside the dock.
    const orchardWeight = disc(x, z, -24, 22, 26, 31);
    const strength = Math.max(orchardWeight, routeWeight * 0.52);
    original.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i));
    tint.lerp(original, 1 - strength);
    colors.setXYZ(i, tint.r, tint.g, tint.b);
  }
  colors.needsUpdate = true;
}
