import * as THREE from 'three';
import { VoxelVolume } from '../art/voxel/VoxelSurface.ts';

// The guardian uses a coarser, heavier silhouette than the hill Spitter.
// All coordinates are in world metres relative to the boss's ground anchor.
const STEP = 0.12;
const BARK_DARK = 0x263e32;
const BARK = 0x385b3d;
const BARK_RIDGE = 0x527447;
const ROOT = 0x2e4937;
const CROWN = 0x668247;
const CROWN_LIGHT = 0x839953;
const SOCKET = 0x1d302b;
const CORE = 0xd98530;
const CORE_LIGHT = 0xf1ad48;
const CORE_DARK = 0x985124;
const GUARD = 0x4f773f;
const GUARD_RIB = 0x89a65b;
const GUARD_EDGE = 0x35583a;
const SEED = 0xd16636;
const SEED_LIGHT = 0xf2964e;
const SEED_DARK = 0x793d2e;

type V3 = [number, number, number];

function geometry(name: string, step: number, paint: (v: VoxelVolume) => void): THREE.BufferGeometry {
  const volume = new VoxelVolume();
  paint(volume);
  const surface = volume.geometry({ cellSize: step,
    origin: new THREE.Vector3(-step / 2, -step / 2, -step / 2) });
  surface.name = name;
  return surface;
}

function branch(v: VoxelVolume, a: V3, b: V3, r0: number, r1: number,
  step: number, tint: (t: number, x: number, y: number, z: number) => number): void {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const samples = Math.ceil(length / step * 4);
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const c: V3 = [a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const radius = r0 + (r1 - r0) * t;
    const low = c.map(n => Math.floor((n - radius) / step));
    const high = c.map(n => Math.ceil((n + radius) / step));
    for (let x = low[0]; x <= high[0]; x++) for (let y = low[1]; y <= high[1]; y++) {
      for (let z = low[2]; z <= high[2]; z++) {
        if ((x * step - c[0]) ** 2 + (y * step - c[1]) ** 2
          + (z * step - c[2]) ** 2 > radius ** 2) continue;
        v.put(x, y, z, tint(t, x, y, z));
      }
    }
  }
}

/** Splayed buttress roots, twisted trunk, and a three-pronged crown. */
export function voxelKingVineBase(): THREE.BufferGeometry {
  return geometry('King Vine planted guardian', STEP, volume => {
    for (let y = 0; y <= 26; y++) for (let x = -11; x <= 11; x++) {
      for (let z = -11; z <= 11; z++) {
        const px = x * STEP, py = y * STEP, pz = z * STEP;
        const angle = Math.atan2(px, pz);
        const twistX = Math.sin(py * 1.45) * 0.10;
        const twistZ = Math.cos(py * 1.1) * 0.07;
        const radius = py < 0.52 ? 1.00 - py * 0.36
          : py < 2.05 ? 0.81 - (py - 0.52) * 0.11
            : 0.64 + (py - 2.05) * 0.18;
        const lobes = Math.sin(angle * 5 + py * 0.75) * 0.065;
        if (Math.hypot(px - twistX, pz - twistZ) > radius + lobes) continue;
        const coreOpening = (px / 0.58) ** 2 + ((py - 1.7) / 0.67) ** 2 < 1
          && pz > -0.33;
        if (coreOpening) continue;
        const socketRim = (px / 0.74) ** 2 + ((py - 1.7) / 0.82) ** 2 < 1
          && pz > 0.18;
        const ridge = Math.sin(angle * 7 + py * 1.6) > 0.72;
        volume.put(x, y, z, socketRim ? SOCKET
          : py < 0.35 ? BARK_DARK : py > 2.5 ? CROWN
            : ridge ? BARK_RIDGE : BARK);
      }
    }
    // Unequal, ground-hugging roots make the large guardian feel planted.
    const roots: V3[] = [[-1.85, 0.06, 0.97], [1.75, 0.07, 1.09],
      [-1.63, 0.08, -1.26], [1.70, 0.09, -1.34]];
    for (const end of roots) branch(volume, [0, 0.48, 0], end, 0.38, 0.15, STEP,
      (t, _x, y) => y <= 2 || t > 0.75 ? ROOT : BARK_DARK);
    // Crown shoulders join the trunk instead of hovering as separate leaves.
    for (const side of [-1, 1]) {
      branch(volume, [side * 0.35, 2.27, 0], [side * 1.12, 3.07, 0.17],
        0.37, 0.12, STEP, (t, x) => t > 0.73 ? CROWN_LIGHT
          : x % 3 === 0 ? BARK_RIDGE : CROWN);
      branch(volume, [side * 0.53, 2.54, -0.08], [side * 0.85, 2.92, -0.47],
        0.22, 0.10, STEP, () => CROWN);
    }
    branch(volume, [0, 2.60, -0.08], [0, 3.15, -0.20],
      0.35, 0.12, STEP, t => t > 0.75 ? CROWN_LIGHT : CROWN);
  });
}

/** Pivot-local scythe paddle, reaching +Z 9.5 m from a world-Y 2.2 hinge. */
export function voxelKingVineArm(): THREE.BufferGeometry {
  return geometry('King Vine sweep paddle', STEP, volume => {
    branch(volume, [0, 0, 0], [0, -0.12, 4.7], 0.39, 0.24, STEP,
      (t, x) => x % 3 === 0 && t > 0.2 ? BARK_RIDGE : BARK);
    branch(volume, [0, -0.12, 4.7], [0, -0.28, 9.27], 0.27, 0.13, STEP,
      (t, x) => x % 4 === 0 ? CROWN : BARK_RIDGE);
    // Broad, thin far end conveys a lateral sweep instead of a ranged shot.
    for (let z = 36; z <= 78; z++) {
      const t = (z - 36) / 42;
      const halfWidth = 0.24 + 0.69 * Math.sin(Math.PI * t) ** 0.8;
      const midY = -0.12 - 0.17 * t;
      for (let x = -8; x <= 8; x++) for (let y = -5; y <= 1; y++) {
        const px = x * STEP, py = y * STEP;
        if (Math.abs(px) > halfWidth || Math.abs(py - midY) > 0.13) continue;
        const edge = Math.abs(px) > halfWidth - 0.13;
        const rib = z % 7 === 0 && Math.abs(px) < halfWidth - 0.14;
        volume.put(x, y, z, edge ? CROWN_LIGHT : rib ? BARK_RIDGE : CROWN);
      }
    }
    for (const side of [-1, 1]) for (const z of [51, 66]) {
      branch(volume, [side * 0.44, -0.20, z * STEP],
        [side * 0.79, 0.07, (z + 3) * STEP], 0.18, 0.09, STEP,
        () => CROWN_LIGHT);
    }
  });
}

/** Vertical braided stem from crown to the existing melon underside. */
export function voxelKingVineConnector(topY: number): THREE.BufferGeometry {
  if (!Number.isFinite(topY) || topY <= 3.5)
    throw new RangeError('King Vine connector top must be above its crown');
  return geometry('King Vine melon connector', STEP, volume => {
    for (let y = 24; y <= Math.ceil(topY / STEP); y++) {
      const py = y * STEP;
      const t = THREE.MathUtils.clamp((py - 2.88) / (topY - 2.88), 0, 1);
      const cx = Math.sin(py * 1.5) * 0.055;
      const cz = Math.cos(py * 1.3) * 0.055;
      for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
        const px = x * STEP - cx, pz = z * STEP - cz;
        const angle = Math.atan2(px, pz);
        const raisedStrand = Math.sin(angle * 3 - py * 2.4) > 0.48;
        const radius = 0.27 - t * 0.07 + (raisedStrand ? 0.045 : 0);
        if (Math.hypot(px, pz) > radius) continue;
        volume.put(x, y, z, raisedStrand ? BARK_RIDGE : t > 0.7 ? CROWN : BARK);
      }
    }
  });
}

/** Amber stem target, ground-local at the existing (0, 1.7, 0) hit centre. */
export function voxelKingVineCore(): THREE.BufferGeometry {
  return geometry('King Vine exposed amber stem', STEP, volume => {
    for (let x = -5; x <= 5; x++) for (let y = 9; y <= 19; y++) {
      for (let z = -5; z <= 5; z++) {
        const px = x * STEP, py = y * STEP - 1.68, pz = z * STEP;
        const ellipsoid = (px / 0.52) ** 2 + (py / 0.57) ** 2 + (pz / 0.46) ** 2;
        if (ellipsoid > 1) continue;
        const rib = Math.abs(x) <= 1 && z >= 2 && y % 3 !== 0;
        const shadow = y <= 11 || z <= -2;
        volume.put(x, y, z, rib ? CORE_LIGHT : shadow ? CORE_DARK : CORE);
      }
    }
  });
}

/** One pivot-local guard blade: mirror it on X for the opposite hinge. */
export function voxelKingVineGuardLeaf(): THREE.BufferGeometry {
  const step = 0.10;
  return geometry('King Vine hinged stem guard', step, volume => {
    for (let x = 0; x <= 8; x++) for (let y = -7; y <= 7; y++) {
      for (let z = 0; z <= 2; z++) {
        const px = x * step, py = y * step;
        const blade = ((px - 0.39) / 0.42) ** 2 + (py / 0.67) ** 2;
        if (blade > 1 || (z === 2 && Math.abs(y) > 5)) continue;
        const vein = Math.abs(y) <= 1 && x >= 1;
        const edge = blade > 0.72 || Math.abs(y) >= 5;
        volume.put(x, y, z, edge ? GUARD_EDGE : vein ? GUARD_RIB : GUARD);
      }
    }
  });
}

/** Compact pointed seed, centered on the authoritative projectile position. */
export function voxelKingVineSeed(): THREE.BufferGeometry {
  const step = 0.10;
  return geometry('King Vine flying barbed seed', step, volume => {
    for (let z = -6; z <= 6; z++) for (let x = -4; x <= 4; x++) {
      for (let y = -4; y <= 4; y++) {
        const taper = z < -3 ? 0.20 + (z + 6) * 0.065
          : z <= 1 ? 0.42 : 0.42 - (z - 1) * 0.075;
        const oval = ((x * step) / taper) ** 2 + ((y * step) / (taper * 0.85)) ** 2;
        if (oval > 1) continue;
        const seam = y >= 2 && Math.abs(x) <= 1 && z > -4 && z < 4;
        const shaded = y <= -2 || z <= -5;
        volume.put(x, y, z, seam || shaded ? SEED_DARK
          : z >= 4 ? SEED_LIGHT : SEED);
      }
    }
  });
}
