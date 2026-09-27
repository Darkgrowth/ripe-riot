import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VoxelVolume } from '../art/voxel/VoxelSurface.ts';
import type { VisualMode } from '../art/voxel/VisualMode.ts';

const color = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

/** Landmark rind and crown, in the original 1.08r × .9r × 1.08r envelope.
 * The caller retains the existing material, transform and physics contract. */
export function buildKingMelonGeometry(radius: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const light = color(0xa9d95c), dark = color(0x173f14);
  const rind = new THREE.SphereGeometry(1, 56, 36);
  const p = rind.getAttribute('position');
  const colors = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const nx = p.getX(i), ny = p.getY(i), nz = p.getZ(i);
    const theta = Math.atan2(nz, nx);
    const latitude = Math.asin(THREE.MathUtils.clamp(ny, -1, 1));
    // Six broad bands retain the pale/dark landmark read. Slightly wandering
    // edges give the rind an organic rhythm without adding noisy speckles.
    const stripe = Math.sin(theta * 6 + Math.sin(latitude * 3.4) * 0.16
      + Math.sin(theta * 3 + latitude * 5) * 0.075);
    c.copy(light).lerp(dark, THREE.MathUtils.smoothstep(stripe, -0.35, 0.15));
    c.multiplyScalar(1 - Math.pow(Math.abs(ny), 4) * 0.22);
    colors.set([c.r, c.g, c.b], i * 3);
    // A shallow crown recess allows a stem to fit inside the established
    // envelope, rather than growing the legendary's collision silhouette.
    const crown = THREE.MathUtils.smoothstep(ny, 0.90, 1) * 0.078;
    p.setXYZ(i, nx * radius * 1.08, (ny * 0.9 - crown) * radius, nz * radius * 1.08);
  }
  rind.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  rind.computeVertexNormals();
  parts.push(rind);

  const append = (g: THREE.BufferGeometry, tint: THREE.Color) => {
    const a = g.getAttribute('position');
    const vertexColors = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) {
      // The inset stem's top is the original .9r top. The original sphere
      // keeps all horizontal extrema and the -.9r bottom exactly unchanged.
      a.setY(i, Math.min(a.getY(i), radius * 0.9));
      vertexColors.set([tint.r, tint.g, tint.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));
    parts.push(g);
  };

  // Broad, overlapping calyx lobes create one legible crown rather than a
  // collection of tiny floating leaves. All five share the rind material.
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    const leaf = new THREE.SphereGeometry(1, 8, 4);
    leaf.scale(radius * 0.115, radius * 0.018, radius * 0.045);
    leaf.rotateY(-a);
    leaf.translate(Math.cos(a) * radius * 0.08, radius * 0.824, Math.sin(a) * radius * 0.08);
    append(leaf, color(i % 2 ? 0x415a26 : 0x536c2d));
  }
  const stemPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.822, 0), new THREE.Vector3(-0.026, 0.847, 0.014),
    new THREE.Vector3(0.025, 0.877, 0.025), new THREE.Vector3(0.025, 0.9, 0.025),
  ].map(v => v.multiplyScalar(radius)));
  append(new THREE.TubeGeometry(stemPath, 10, radius * 0.022, 6, false), color(0x7a7140));
  const stemCut = new THREE.CircleGeometry(radius * 0.022, 6);
  stemCut.rotateX(-Math.PI / 2);
  stemCut.translate(radius * 0.025, radius * 0.9, radius * 0.025);
  append(stemCut, color(0xb4a16b));

  const scar = new THREE.SphereGeometry(1, 10, 4);
  scar.scale(radius * 0.11, radius * 0.016, radius * 0.11);
  scar.translate(0, -radius * 0.883, 0);
  append(scar, color(0x746737));

  // One vertex-coloured geometry, one existing material, no extra draw calls.
  const geometry = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** The opt-in rind keeps the legendary's original center and collision envelope.
 * One connected, hidden-face-culled surface follows the six familiar stripes;
 * the shallow crown has an inset stem rather than extra height. */
export function buildVoxelKingMelonGeometry(radius: number): THREE.BufferGeometry {
  const volume = new VoxelVolume();
  // Thirty-six broad cells across the landmark: rounded at game scale without
  // filling the ravine with tiny blocks. This step also divides its 0.9r
  // vertical envelope into exactly thirty cells.
  const step = radius * 2.16 / 36;
  const horizontal = radius * 1.08;
  const vertical = radius * 0.9;
  const origin = new THREE.Vector3(-horizontal, -vertical, -horizontal);
  const pale = 0xa9d95c;
  const dark = 0x245323;
  const transition = 0x628d37;
  const calyx = 0x496e2f;
  const calyxLight = 0x64823b;
  const stem = 0x796d3d;
  for (let ix = 0; ix < 36; ix++) for (let iy = 0; iy < 30; iy++) {
    for (let iz = 0; iz < 36; iz++) {
      const x = origin.x + (ix + 0.5) * step;
      const y = origin.y + (iy + 0.5) * step;
      const z = origin.z + (iz + 0.5) * step;
      const radial = Math.hypot(x, z);
      const ellipsoid = (x / horizontal) ** 2 + (y / vertical) ** 2
        + (z / horizontal) ** 2;
      if (ellipsoid > 1) continue;
      // The stem is recessed into the top. Its narrow column reconnects to
      // the body below the recess, so detached decoration cannot fall away.
      const crownRecess = y > radius * 0.78 && radial < radius * 0.16;
      const stemCell = y > radius * 0.73 && radial < step * 1.1;
      if (crownRecess && !stemCell) continue;
      if (stemCell) { volume.put(ix, iy, iz, stem); continue; }
      const theta = Math.atan2(z, x);
      const latitude = Math.asin(THREE.MathUtils.clamp(y / vertical, -1, 1));
      const stripe = Math.sin(theta * 6 + Math.sin(latitude * 3.4) * 0.16
        + Math.sin(theta * 3 + latitude * 5) * 0.075);
      let tint = stripe > 0.18 ? dark : stripe < -0.18 ? pale : transition;
      if (y > radius * 0.70 && radial < radius * 0.35) {
        // Five large calyx lobes, colored on the rind rather than separate
        // overlapping meshes that would break the single-surface silhouette.
        tint = Math.cos(theta * 5) > -0.15 ? calyx : calyxLight;
      } else if (y < -radius * 0.79 && radial < radius * 0.19) {
        tint = 0x716b38;
      }
      volume.put(ix, iy, iz, tint);
    }
  }
  const geometry = volume.geometry({ cellSize: step, origin });
  geometry.name = 'VoxelKingMelon';
  return geometry;
}

export function kingMelonGeometryForMode(radius: number, visualMode: VisualMode): THREE.BufferGeometry {
  return visualMode === 'voxel'
    ? buildVoxelKingMelonGeometry(radius) : buildKingMelonGeometry(radius);
}
