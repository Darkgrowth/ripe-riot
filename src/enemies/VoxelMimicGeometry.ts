import * as THREE from 'three';

// Geometry only: the rig owns materials, articulation, visibility, and combat timing.
// All coordinates below use the existing MimicRig local space and colour roles.
const color = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
const RIND = color(0x365e3f);
const RIB = color(0x527a4b);
const RIND_DARK = color(0x264734);
const FLESH = color(0xc4574b);
const THROAT = color(0x482638);
const TOOTH = color(0xf1ddaa);
const ROOT = color(0x365332);
const STEM = color(0x557443);
const EYE = color(0xc8834a);

type Cell = { x: number; y: number; z: number; color: THREE.Color };
type Size = readonly [number, number, number];
type SurfaceColor = (cell: Cell, face: number) => THREE.Color;

const STEPS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
const CORNERS: readonly (readonly number[])[] = [
  [1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1],
  [-1, -1, 1, -1, 1, 1, -1, 1, -1, -1, -1, -1],
  [-1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, -1],
  [-1, -1, 1, -1, -1, -1, 1, -1, -1, 1, -1, 1],
  [1, -1, 1, 1, 1, 1, -1, 1, 1, -1, -1, 1],
  [-1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1, -1],
];

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** Emits only exposed faces into one vertex-coloured BufferGeometry per moving part. */
function surface(cells: Map<string, Cell>, size: Size,
  surfaceColor: SurfaceColor = cell => cell.color): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  for (const cell of cells.values()) {
    const [sx, sy, sz] = size;
    for (let face = 0; face < 6; face++) {
      const [dx, dy, dz] = STEPS[face];
      if (cells.has(key(cell.x + dx, cell.y + dy, cell.z + dz))) continue;
      const corners = CORNERS[face];
      const tint = surfaceColor(cell, face);
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const n = i * 3;
        positions.push((cell.x + corners[n] * 0.5) * sx,
          (cell.y + corners[n + 1] * 0.5) * sy,
          (cell.z + corners[n + 2] * 0.5) * sz);
        colors.push(tint.r, tint.g, tint.b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

function put(cells: Map<string, Cell>, x: number, y: number, z: number,
  cellColor: THREE.Color): void {
  cells.set(key(x, y, z), { x, y, z, color: cellColor });
}

/**
 * Stepped elliptical rind centred on the original shell origin. Keep the upper
 * shell mesh's existing +0.78 local Z offset in MimicRig; lower stays at zero.
 * The two flat lip planes meet at local Y=0 when the jaw is closed.
 */
export function makeDetailedVoxelMimicShell(upper: boolean): THREE.BufferGeometry {
  const cells = new Map<string, Cell>();
  const size: Size = [0.106, 0.103, 0.106];
  for (let x = -11; x <= 11; x++) {
    for (let y = upper ? 0 : -8; y <= (upper ? 7 : -1); y++) {
      for (let z = -10; z <= 10; z++) {
        const px = x * size[0];
        const py = (y + 0.5) * size[1];
        const pz = z * size[2];
        if ((px / 1.18) ** 2 + (py / 0.82) ** 2 + (pz / 1.05) ** 2 > 1.04) continue;
        const theta = Math.atan2(px, pz);
        const rib = Math.cos(theta * 7 + Math.sin(py * 4) * 0.08);
        const shellColor = rib > 0.48 ? RIB : rib < -0.90 ? RIND_DARK : RIND;
        put(cells, x, y, z, shellColor);
      }
    }
  }
  const geometry = surface(cells, size, (cell, face) => {
    const cut = upper ? cell.y === 0 && face === 3 : cell.y === -1 && face === 2;
    if (cut) {
      const radial = Math.hypot(cell.x * size[0] / 1.18, cell.z * size[2] / 1.05);
      return radial < 0.61 && cell.z > -5 ? THROAT : FLESH;
    }
    if (face === 3 && cell.y < -4) return RIND_DARK;
    return cell.color;
  });
  // The shell sampling uses half-cell Y centres. Put both exposed lips at Y=0.
  geometry.translate(0, size[1] / 2, 0);
  geometry.computeBoundingBox();
  return geometry;
}

/** Centred at zero; retain the lower-jaw mesh position (0, 0.024, 0.40). */
export function makeDetailedVoxelMimicThroat(): THREE.BufferGeometry {
  const cells = new Map<string, Cell>();
  const size: Size = [0.07, 0.04, 0.07];
  for (let x = -11; x <= 11; x++) for (let z = -5; z <= 5; z++) {
    const radial = (x * size[0] / 0.78) ** 2 + (z * size[2] / 0.39) ** 2;
    if (radial <= 1.06) put(cells, x, 0, z, radial > 0.72 ? FLESH : THROAT);
  }
  return surface(cells, size);
}

/** Five attached, tapered fangs in the upper group's existing local space. */
export function makeDetailedVoxelMimicTeeth(): THREE.BufferGeometry {
  const cells = new Map<string, Cell>();
  const size: Size = [0.045, 0.045, 0.045];
  for (let tooth = -2; tooth <= 2; tooth++) {
    const cx = Math.round(tooth * 0.28 / size[0]);
    const cz = Math.round(1.46 / size[2]);
    for (let y = -5; y <= 0; y++) {
      const width = y <= -4 ? 0 : y <= -2 ? 1 : 2;
      for (let x = -width; x <= width; x++) for (let z = -1; z <= 1; z++)
        put(cells, cx + x, y, cz + z, TOOTH);
    }
  }
  return surface(cells, size);
}

/** Stem and one bent leaf share a batched shell-space geometry. */
export function makeDetailedVoxelMimicStem(): THREE.BufferGeometry {
  const cells = new Map<string, Cell>();
  const size: Size = [0.07, 0.07, 0.07];
  for (let y = 11; y <= 18; y++) {
    const lean = y >= 17 ? -1 : 0;
    for (let x = -1; x <= 1; x++) for (let z = 10; z <= 12; z++)
      put(cells, x + lean, y, z, STEM);
  }
  for (let x = -6; x <= -1; x++) for (let y = 15; y <= 20; y++) {
    const ellipse = ((x + 3.0) / 3.4) ** 2 + ((y - 17.5) / 3.2) ** 2;
    if (ellipse > 1.05) continue;
    for (let z = 10; z <= 12; z++) put(cells, x, y, z, RIND_DARK);
  }
  return surface(cells, size);
}

/** A seed-like eye, centred at zero for use at each eye attachment. */
export function makeDetailedVoxelMimicEye(): THREE.BufferGeometry {
  const cells = new Map<string, Cell>();
  const size: Size = [0.04, 0.04, 0.04];
  for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) {
    for (let z = -1; z <= 1; z++) {
      if ((x / 2.7) ** 2 + (y / 2.7) ** 2 + (z / 1.9) ** 2 > 1) continue;
      put(cells, x, y, z, z === 1 && Math.abs(x) <= 1 && Math.abs(y) <= 1
        ? RIND_DARK : EYE);
    }
  }
  return surface(cells, size);
}

/** Y-aligned and unit length for the current connect() endpoint scaling. */
export function makeDetailedVoxelMimicRootSegment(): THREE.BufferGeometry {
  const cells = new Map<string, Cell>();
  const size: Size = [0.055, 0.10, 0.055];
  for (let y = -5; y <= 5; y++) {
    const taper = 1 - Math.abs(y) * 0.032;
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
      if ((x * size[0] / (0.19 * taper)) ** 2
        + (z * size[2] / (0.17 * taper)) ** 2 > 1) continue;
      put(cells, x, y, z, (Math.abs(x) >= 3 || Math.abs(z) >= 3) ? ROOT : RIND_DARK);
    }
  }
  return surface(cells, size);
}

/** A planted, rounded-step root tip, centred on each current foot position. */
export function makeDetailedVoxelMimicRootFoot(): THREE.BufferGeometry {
  const cells = new Map<string, Cell>();
  const size: Size = [0.055, 0.055, 0.055];
  for (let x = -4; x <= 4; x++) for (let y = -1; y <= 1; y++) {
    for (let z = -5; z <= 5; z++) {
      if ((x * size[0] / 0.23) ** 2 + (y * size[1] / 0.09) ** 2
        + (z * size[2] / 0.29) ** 2 > 1) continue;
      put(cells, x, y, z, y < 0 ? RIND_DARK : ROOT);
    }
  }
  return surface(cells, size);
}
