import * as THREE from 'three';
import { VoxelVolume } from '../art/voxel/VoxelSurface.ts';

// Authored in the encounter's existing metre scale. Each moving piece is one
// exposed-face mesh; the rooted base remains a single connected occupancy field.
const STEP = 0.09;
const ROOT = 0x3b5d39;
const ROOT_DARK = 0x294832;
const LEAF = 0x5b873f;
const LEAF_LIGHT = 0x79a04d;
const LEAF_DARK = 0x426b39;
const LIP = 0xb36a55;
const GUM = 0x934953;
const THROAT = 0x4c2739;
const TOOTH = 0xf0deae;
const AMBER = 0xc76825;
const AMBER_LIGHT = 0xe39132;
const AMBER_DARK = 0x8c411d;

function volumeGeometry(name: string, draw: (volume: VoxelVolume) => void): THREE.BufferGeometry {
  const volume = new VoxelVolume();
  draw(volume);
  const geometry = volume.geometry({ cellSize: STEP,
    origin: new THREE.Vector3(-STEP / 2, -STEP / 2, -STEP / 2) });
  geometry.name = name;
  return geometry;
}

/** Six planted roots share the same cells as the tapered stalk and leaf collar. */
export function voxelSnapjawBase(): THREE.BufferGeometry {
  return volumeGeometry('Snapjaw rooted base', volume => {
    for (let y = 0; y <= 14; y++) for (let x = -16; x <= 16; x++) {
      for (let z = -16; z <= 16; z++) {
        const px = x * STEP, py = y * STEP, pz = z * STEP;
        const radius = Math.hypot(px, pz);
        const stalkRadius = py < 0.18 ? 0.59 - py * 0.36
          : py < 0.83 ? 0.53 - (py - 0.18) * 0.19
            : 0.41 + (py - 0.83) * 0.75;
        let plantedRoot = false;
        if (radius < 1.42 && py < 0.51) for (let i = 0; i < 6; i++) {
          const angle = i * Math.PI / 3;
          const along = px * Math.sin(angle) + pz * Math.cos(angle);
          const cross = Math.abs(px * Math.cos(angle) - pz * Math.sin(angle));
          if (along >= 0.2 && along <= 1.42 && cross < 0.27 - along * 0.12
            && py < 0.53 - along * 0.30) { plantedRoot = true; break; }
        }
        if (radius > stalkRadius && !plantedRoot) continue;
        const ridge = Math.sin(Math.atan2(px, pz) * 7) > 0.58;
        const tint = py < 0.25 ? ROOT_DARK : ridge ? LEAF_DARK : ROOT;
        volume.put(x, y, z, tint);
      }
    }
  });
}

/** The lower leaf is a broad supported cup, pointed toward the player at +Z. */
export function voxelSnapjawLowerJaw(): THREE.BufferGeometry {
  return volumeGeometry('Snapjaw lower leaf jaw', volume => {
    for (let z = -11; z <= 18; z++) for (let x = -15; x <= 15; x++) {
      const pz = z * STEP;
      const taper = Math.sqrt(Math.max(0, 1 - ((pz - 0.22) / 1.48) ** 2));
      const width = 1.35 * taper;
      if (Math.abs(x * STEP) > width) continue;
      const radial = Math.abs(x * STEP) / Math.max(0.001, width);
      const bottom = Math.round((0.82 + radial * 0.16) / STEP);
      const top = Math.round((1.25 - radial * 0.06) / STEP);
      for (let y = bottom; y <= top; y++) {
        const edge = radial > 0.79 || pz > 1.28;
        const vein = Math.abs(x) <= 1 && z > 2;
        volume.put(x, y, z, edge && y >= top - 1 ? LIP
          : vein ? LEAF_LIGHT : (z + x * 3) % 7 === 0 ? LEAF_DARK : LEAF);
      }
    }
  });
}

/** The dark top of the lower cup stays visible throughout the bite poses. */
export function voxelSnapjawLowerMouth(): THREE.BufferGeometry {
  return volumeGeometry('Snapjaw lower mouth lining', volume => {
    for (let z = -7; z <= 15; z++) for (let x = -12; x <= 12; x++) {
      const radial = (x * STEP / 1.04) ** 2 + ((z * STEP - 0.30) / 0.99) ** 2;
      if (radial > 1) continue;
      volume.put(x, 15, z, radial > 0.66 ? GUM : THROAT);
    }
  });
}

/** Moving canopy; the edge cells become a warm exposed leaf lip. */
export function voxelSnapjawUpperJaw(): THREE.BufferGeometry {
  return volumeGeometry('Snapjaw upper leaf jaw', volume => {
    for (let z = -11; z <= 18; z++) for (let x = -16; x <= 16; x++) {
      const pz = z * STEP;
      const taper = Math.sqrt(Math.max(0, 1 - ((pz - 0.21) / 1.49) ** 2));
      const width = 1.39 * taper;
      if (Math.abs(x * STEP) > width) continue;
      const radial = Math.abs(x * STEP) / Math.max(0.001, width);
      const bottom = Math.round((-0.30 + radial * 0.07) / STEP);
      const top = Math.round((0.13 + 0.48 * (1 - radial ** 1.8) * taper) / STEP);
      for (let y = bottom; y <= top; y++) {
        const edge = radial > 0.83 || pz > 1.31;
        const vein = Math.abs(x) <= 1 && z > 0 && y >= top - 1;
        volume.put(x, y, z, y <= bottom + 1 && edge ? LIP
          : vein ? LEAF_LIGHT : ((z + Math.abs(x) * 2) % 8 === 0 ? LEAF_DARK : LEAF));
      }
    }
  });
}

/** Exposed underside, with a thicker gum edge and deep central throat. */
export function voxelSnapjawUpperMouth(): THREE.BufferGeometry {
  return volumeGeometry('Snapjaw upper mouth lining', volume => {
    for (let z = -8; z <= 15; z++) for (let x = -12; x <= 12; x++) {
      const radial = (x * STEP / 1.05) ** 2 + ((z * STEP - 0.27) / 1.04) ** 2;
      if (radial > 1) continue;
      volume.put(x, -4, z, radial > 0.69 ? GUM : THROAT);
    }
  });
}

/** Seven stepped teeth share one draw call and remain parented to the moving jaw. */
export function voxelSnapjawTeeth(): THREE.BufferGeometry {
  return volumeGeometry('Snapjaw upper fangs', volume => {
    for (let i = -3; i <= 3; i++) {
      const cx = i * 3;
      const cz = 12 - Math.abs(i);
      for (let y = -8; y <= -4; y++) {
        const halfWidth = y < -6 ? 0 : 1;
        for (let x = -halfWidth; x <= halfWidth; x++) for (let z = -1; z <= 1; z++) {
          volume.put(cx + x, y, cz + z, TOOTH);
        }
      }
    }
  });
}

/** Small ember eyes with a dark central seed, centred at the rig's eye anchors. */
export function voxelSnapjawEye(): THREE.BufferGeometry {
  return volumeGeometry('Snapjaw ember eye', volume => {
    for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) {
      for (let z = -1; z <= 1; z++) {
        if ((x / 2.5) ** 2 + (y / 2.5) ** 2 + (z / 1.7) ** 2 > 1) continue;
        volume.put(x, y, z, z === 1 && Math.abs(x) <= 1 && Math.abs(y) <= 1
          ? ROOT_DARK : 0xff7b40);
      }
    }
  });
}

/** Warm amber seed with a shaded underside, distinct from the ivory fangs. */
export function voxelSnapjawCore(): THREE.BufferGeometry {
  return volumeGeometry('Snapjaw exposed seed', volume => {
    for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) {
      for (let z = -3; z <= 3; z++) {
        const radius = (x / 4.6) ** 2 + (y / 4.6) ** 2 + (z / 3.7) ** 2;
        if (radius > 1) continue;
        const tint = y < -1 || z < 0 ? AMBER_DARK
          : Math.abs(x) <= 1 && y >= 0 && z > 0 ? AMBER_LIGHT : AMBER;
        volume.put(x, y, z, tint);
      }
    }
  });
}
