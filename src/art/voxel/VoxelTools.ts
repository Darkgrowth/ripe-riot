import * as THREE from 'three';
import { VoxelVolume } from './VoxelSurface.ts';

/**
 * First-person tool bodies in the existing Viewmodel.ts local coordinates.
 * One modeling cell is one centimeter. The surface builder removes every
 * internal face, so these are two ordinary vertex-colored BufferGeometries,
 * rather than hundreds of individually drawn cubes.
 *
 * Gloves remain the animated/posed WorkerHands meshes owned by Viewmodel.ts.
 */
const CELL = 0.01;
const ORIGIN = new THREE.Vector3(-CELL / 2, -CELL / 2, -CELL / 2);

const P = {
  bark: 0x82532f,
  barkLight: 0xaa7040,
  leather: 0x49392f,
  leatherEdge: 0x76563a,
  iron: 0x647780,
  ironLight: 0xaebdbb,
  ironDark: 0x374950,
  brass: 0xc89549,
  red: 0xc7533e,
  enamel: 0x357e75,
  enamelLight: 0x5aa69b,
  cream: 0xe5d4aa,
  bore: 0x283b3d,
} as const;

function putBox(v: VoxelVolume, x0: number, x1: number, y0: number, y1: number,
  z0: number, z1: number, color: number): void {
  v.box(x0, x1, y0, y1, z0, z1, color);
}

function putRoundY(v: VoxelVolume, cx: number, cz: number, y0: number, y1: number,
  radius: number, color: number): void {
  const extent = Math.ceil(radius);
  for (let y = y0; y <= y1; y++) for (let x = cx - extent; x <= cx + extent; x++) {
    for (let z = cz - extent; z <= cz + extent; z++) {
      if (Math.hypot(x - cx, z - cz) <= radius) v.put(x, y, z, color);
    }
  }
}

function putRoundZ(v: VoxelVolume, cx: number, cy: number, z0: number, z1: number,
  radius: number, color: number): void {
  const extent = Math.ceil(radius);
  for (let z = z0; z <= z1; z++) for (let x = cx - extent; x <= cx + extent; x++) {
    for (let y = cy - extent; y <= cy + extent; y++) {
      if (Math.hypot(x - cx, y - cy) <= radius) v.put(x, y, z, color);
    }
  }
}

function finish(v: VoxelVolume): THREE.BufferGeometry {
  const geometry = v.geometry({ cellSize: CELL, origin: ORIGIN });
  geometry.userData.style = 'detailed-voxel';
  return geometry;
}

/** A short picking mallet: carved shaft, leather grip and a stepped forged head. */
export function voxelMalletGeometry(): THREE.BufferGeometry {
  const v = new VoxelVolume();
  const cx = 16, cz = -24;

  // A continuous shaft runs through the head. Leather covers its lower end;
  // the few light cells along the wood read as broad carving, not pixel noise.
  putRoundY(v, cx, cz, -12, 23, 2.1, P.bark);
  putRoundY(v, cx, cz, -12, -3, 2.4, P.leather);
  putRoundY(v, cx, cz, -3, -2, 2.5, P.leatherEdge);
  putRoundY(v, cx, cz, 18, 22, 2.7, P.brass);
  putBox(v, 16, 16, 1, 15, -22, -22, P.barkLight);

  // The forged head has a one-to-two-cell corner bevel. Its bright end caps
  // and thin top ridge identify the working face at gameplay scale.
  for (let x = 5; x <= 27; x++) for (let y = 22; y <= 30; y++) {
    for (let z = -29; z <= -19; z++) {
      const edgeX = Math.max(0, Math.abs(x - cx) - 9);
      const edgeY = Math.max(0, Math.abs(y - 26) - 3);
      const edgeZ = Math.max(0, Math.abs(z - cz) - 4);
      if (edgeX + edgeY + edgeZ > 2) continue;
      let color: number = P.iron;
      if (x <= 7 || x >= 25) color = P.ironLight;
      else if (y >= 29) color = P.ironLight;
      else if (y === 22 || z === -19) color = P.ironDark;
      v.put(x, y, z, color);
    }
  }
  // Small inset orchard mark, attached to the front plate.
  for (let x = 14; x <= 18; x++) for (let y = 24; y <= 28; y++) {
    if (Math.abs(x - 16) + Math.abs(y - 26) <= 2) v.put(x, y, -30, P.red);
  }
  return finish(v);
}

/**
 * Squat Air Cannon with an actual hollow forward bell, pressure canister,
 * support grip and a raised charge dial. The existing moving gauge needle
 * should remain at (0.045, 0.033, -0.084) in Viewmodel.ts.
 */
export function voxelAirCannonGeometry(): THREE.BufferGeometry {
  const v = new VoxelVolume();
  const cx = 4, cy = -7;

  // Main enamel vessel. A pair of wide bands and a light top rail break its
  // cylindrical run without turning the surface into scattered highlights.
  for (let z = -34; z <= -7; z++) {
    const color = z >= -12 && z <= -10 ? P.brass
      : z >= -31 && z <= -30 ? P.cream : P.enamel;
    putRoundZ(v, cx, cy, z, z, 7.8, color);
  }
  putBox(v, 1, 7, 0, 1, -29, -15, P.enamelLight);
  putBox(v, 0, 8, -15, -14, -31, -29, P.ironDark);

  // The tapered bell is an annulus, rather than a solid tapered cylinder. A
  // dark back plate is visible down the bore, while the red lip catches light.
  for (let z = -47; z <= -35; z++) {
    const t = (z + 47) / 12;
    const outer = 9.8 - t * 2.2;
    const inner = 5.8;
    const extent = Math.ceil(outer);
    for (let x = cx - extent; x <= cx + extent; x++) {
      for (let y = cy - extent; y <= cy + extent; y++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < inner || d > outer) continue;
        const color = d < 6.8 ? P.bore
          : z <= -45 ? P.red
            : z >= -39 && z <= -38 ? P.brass : P.enamel;
        v.put(x, y, z, color);
      }
    }
  }
  putRoundZ(v, cx, cy, -34, -34, 5.7, P.bore);

  // Side pressure canister and the clamp linking it physically to the main
  // shell. The support hand wraps a broad dark grip near its front end.
  putRoundZ(v, -8, -11, -27, -10, 3.7, P.brass);
  putRoundZ(v, -8, -11, -27, -26, 4.0, P.ironDark);
  putRoundZ(v, -8, -11, -12, -11, 4.0, P.ironDark);
  putBox(v, -6, -2, -12, -8, -23, -14, P.ironDark);
  putBox(v, -11, -4, -17, -12, -32, -26, P.leather);
  putBox(v, -10, -5, -18, -17, -31, -27, P.leatherEdge);

  // Pistol grip beside the right glove, with a small squared trigger guard.
  putBox(v, 5, 9, -21, -8, -10, -5, P.leather);
  putBox(v, 5, 9, -19, -18, -5, -4, P.brass);
  putBox(v, 3, 5, -15, -12, -10, -5, P.ironDark);

  // Raised gauge looks toward the worker. The face stops just behind the
  // animated needle already placed by buildViewModel.
  putBox(v, 2, 6, -1, 2, -12, -10, P.ironDark);
  putRoundZ(v, 4, 3, -12, -10, 3.8, P.brass);
  putRoundZ(v, 4, 3, -9, -9, 2.9, P.cream);
  for (let x = 0; x <= 8; x++) for (let y = -1; y <= 7; y++) {
    const d = Math.hypot(x - 4, y - 3);
    if (d >= 2.6 && d <= 3.8) v.put(x, y, -8, P.ironDark);
  }
  return finish(v);
}
