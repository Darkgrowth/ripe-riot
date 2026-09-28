import * as THREE from 'three';
import { VoxelVolume } from './VoxelSurface';

// Four-centimetre cells give the small resident broad, readable steps at the
// normal game camera without turning its eyes or flight feathers into noise.
const CELL = 0.04;
const ORIGIN = new THREE.Vector3(-CELL / 2, -CELL / 2, -CELL / 2);
const P = {
  cream: 0xe9e7d8,
  white: 0xf3efdc,
  belly: 0xd4d7ca,
  mantle: 0xa9babc,
  wing: 0xc5ceca,
  flight: 0x8ca3a7,
  tip: 0x485e64,
  eye: 0x2c4144,
  beak: 0xe4ad42,
  beakShade: 0xb97335,
  feet: 0xcf8c3e,
} as const;

function finish(volume: VoxelVolume): THREE.BufferGeometry {
  const geometry = volume.geometry({ cellSize: CELL, origin: ORIGIN });
  geometry.userData.style = 'detailed-voxel';
  return geometry;
}

function roundedMass(volume: VoxelVolume, cx: number, cy: number, cz: number,
  rx: number, ry: number, rz: number,
  color: (x: number, y: number, z: number) => number): void {
  for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
        // A little squarer than a sphere, with two-cell shoulders rather than
        // a featureless cuboid or a single low-poly facet.
        const d = Math.abs((x - cx) / rx) ** 2.4
          + Math.abs((y - cy) / ry) ** 2.4
          + Math.abs((z - cz) / rz) ** 2.4;
        if (d <= 1) volume.put(x, y, z, color(x, y, z));
      }
    }
  }
}

/** Body, mantle, tail and feet remain a single draw-call-friendly surface. */
export function voxelGullBodyGeometry(): THREE.BufferGeometry {
  const v = new VoxelVolume();
  roundedMass(v, 0, 6, 0, 5.3, 5.5, 8.5, (_x, y, z) =>
    y >= 8 && z < 4 ? P.mantle : y <= 3 ? P.belly : P.cream);
  roundedMass(v, 0, 7, 4, 4.1, 4.4, 5.0, (_x, y) => y <= 4 ? P.belly : P.white);

  // Fan tail projects behind the body; three darker end rows still read when
  // the gull folds its wings beside the fence post.
  for (let z = -8; z >= -17; z--) {
    const halfWidth = z < -14 ? 2 : z < -11 ? 3 : 4;
    const y = z < -13 ? 5 : 6;
    for (let x = -halfWidth; x <= halfWidth; x++) {
      v.box(x, x, y, y + 1, z, z, z <= -15 ? P.tip : P.wing);
    }
  }
  for (const side of [-1, 1]) {
    const x = side * 2;
    v.box(x, x, -1, 3, 1, 1, P.feet);
    v.box(x - 1, x + 1, -1, 0, 1, 4, P.feet);
    v.box(x - 1, x - 1, -1, -1, 4, 5, P.beakShade);
    v.box(x + 1, x + 1, -1, -1, 4, 5, P.beakShade);
  }
  return finish(v);
}

/** Round head, paired dark eyes and an ochre tapered bill. */
export function voxelGullFaceGeometry(): THREE.BufferGeometry {
  const v = new VoxelVolume();
  roundedMass(v, 0, 0, 2, 4.1, 4.3, 4.2, (_x, y) => y >= 0 ? P.white : P.cream);
  roundedMass(v, 0, -1, 4, 3.0, 2.5, 3.0, () => P.cream);
  for (const side of [-1, 1]) {
    // Cream socket attaches each eye to the head; the dark inset remains a
    // small eye on the side, never a large amber disc on the underside.
    v.box(side * 4, side * 4, 0, 2, 2, 4, P.cream);
    v.box(side * 5, side * 5, 1, 2, 3, 4, P.eye);
  }
  for (let z = 6; z <= 10; z++) {
    const halfWidth = z <= 7 ? 2 : z <= 9 ? 1 : 0;
    const y = z <= 8 ? -1 : -2;
    v.box(-halfWidth, halfWidth, y, y, z, z, z === 10 ? P.beakShade : P.beak);
    if (z <= 8) v.box(-halfWidth, halfWidth, y - 1, y - 1, z, z, P.beakShade);
  }
  return finish(v);
}

/** One joined wing with a broad chord and short stepped primary feathers. */
export function voxelGullWingGeometry(): THREE.BufferGeometry {
  const v = new VoxelVolume();
  const ends = new Map<number, number>([
    [-5, 15], [-4, 18], [-3, 20], [-2, 17], [-1, 21],
    [0, 21], [1, 18], [2, 20], [3, 17], [4, 15],
  ]);
  for (let x = 0; x <= 21; x++) {
    const chord = x < 3 ? 2 : x < 7 ? 3 : x < 12 ? 4 : 5;
    for (let z = -chord; z <= Math.min(chord, 4); z++) {
      if (x > (ends.get(z) ?? 0)) continue;
      const bottom = x < 12 ? -1 : 0;
      const top = x < 5 ? 2 : x < 13 ? 1 : 0;
      for (let y = bottom; y <= top; y++) {
        const color = x >= 16 ? P.tip : x >= 11 || z <= -4 ? P.flight
          : y < 0 ? P.belly : x < 5 ? P.cream : P.wing;
        v.put(x, y, z, color);
      }
    }
  }
  return finish(v);
}
