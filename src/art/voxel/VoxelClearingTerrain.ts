import * as THREE from 'three';
import type { Terrain } from '@/world/Terrain';

const color = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
const GRASS = color(0x648e58);
const GRASS_DARK = color(0x4f7850);
const GRASS_LIGHT = color(0x789b61);
const EARTH = color(0xa48258);
const EARTH_LIGHT = color(0xb39568);
const EDGE = color(0x4c6745);

/** A single visual mesh over the existing terrain collider in the old orchard. */
export function buildVoxelClearingTerrain(terrain: Terrain): THREE.Mesh {
  const cell = 0.5;
  const radius = 30.5;
  const centreX = -24;
  const centreZ = 22;
  const minX = centreX - radius;
  const minZ = centreZ - radius;
  const count = Math.ceil(radius * 2 / cell);
  const positions: number[] = [];
  const colors: number[] = [];
  const baseColor = new THREE.Color();

  const topAt = (x: number, z: number): number => terrain.height(x, z) + 0.035;
  const inPatch = (x: number, z: number): boolean =>
    Math.hypot(x - centreX, z - centreZ) <= radius;
  const face = (points: readonly (readonly [number, number, number])[], tint: THREE.Color): void => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = points[i];
      positions.push(p[0], p[1], p[2]);
      colors.push(tint.r, tint.g, tint.b);
    }
  };

  for (let iz = 0; iz < count; iz++) for (let ix = 0; ix < count; ix++) {
    const x0 = minX + ix * cell;
    const z0 = minZ + iz * cell;
    const x1 = x0 + cell;
    const z1 = z0 + cell;
    const x = (x0 + x1) / 2;
    const z = (z0 + z1) / 2;
    if (!inPatch(x, z)) continue;
    const y = topAt(x, z);
    const corners = [topAt(x0, z0), topAt(x0, z1), topAt(x1, z1), topAt(x1, z0)];
    const steep = corners.some(corner => Math.abs(corner - y) > 0.18);
    const top = steep ? corners : [y, y, y, y];
    const path = terrain.pathWeight(x, z);
    const patch = Math.sin(x * 0.20 + Math.sin(z * 0.13) * 1.4)
      + Math.cos(z * 0.23 - x * 0.08);
    const grass = patch > 0.65 ? GRASS_LIGHT : patch < -0.6 ? GRASS_DARK : GRASS;
    const tileColor = grass.clone().lerp(patch > 0 ? EARTH_LIGHT : EARTH,
      Math.min(1, path * 0.94));
    const rim = Math.max(0, Math.min(1,
      (Math.hypot(x - centreX, z - centreZ) - (radius - 2.6)) / 2.6));
    if (rim > 0) {
      terrain.colorAt(x, z, baseColor);
      tileColor.lerp(baseColor, rim * 0.85);
    }

    // Gentle ground has flat voxel terraces. Steeper ground follows the
    // analytic height at every corner so the worker does not walk through it.
    face([[x0, top[0], z0], [x0, top[1], z1],
      [x1, top[2], z1], [x1, top[3], z0]], tileColor);
    if (steep) continue;
    const sides: Array<{ nx: number; nz: number;
      a: readonly [number, number]; b: readonly [number, number] }> = [
      { nx: -cell, nz: 0, a: [x0, z1], b: [x0, z0] },
      { nx: cell, nz: 0, a: [x1, z0], b: [x1, z1] },
      { nx: 0, nz: -cell, a: [x0, z0], b: [x1, z0] },
      { nx: 0, nz: cell, a: [x1, z1], b: [x0, z1] },
    ];
    for (const side of sides) {
      const neighbourX = x + side.nx;
      const neighbourZ = z + side.nz;
      const neighbourTop = inPatch(neighbourX, neighbourZ)
        ? topAt(neighbourX, neighbourZ) : terrain.height(neighbourX, neighbourZ) + 0.008;
      if (y - neighbourTop < 0.035) continue;
      const low = Math.max(neighbourTop - 0.008, y - 0.25);
      face([[side.a[0], low, side.a[1]], [side.a[0], y, side.a[1]],
        [side.b[0], y, side.b[1]], [side.b[0], low, side.b[1]]], EDGE);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 1, flatShading: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Detailed voxel orchard ground';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
