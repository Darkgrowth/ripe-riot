import * as THREE from 'three';
import { VoxelVolume } from '../art/voxel/VoxelSurface.ts';

// Authored in encounter metres. The head group sits at world Y = ground + 2.1;
// its aperture is centred on local (0, 0, 0), the projectile's logical origin.
const STEP = 0.09;
const ROOT = 0x344f36;
const ROOT_DARK = 0x263e31;
const STALK = 0x4d713e;
const STALK_RIDGE = 0x668747;
const LEAF = 0x557e3d;
const LEAF_LIGHT = 0x77994b;
const LEAF_DARK = 0x3c6137;
const BULB = 0x759451;
const BULB_LIGHT = 0x9dab5b;
const BULB_DARK = 0x506d43;
const LIP = 0xa8a65a;
const APERTURE = 0x263629;
const POD = 0xbec34b;
const POD_LIGHT = 0xd8d15e;
const POD_DARK = 0x758638;

function geometry(name: string, draw: (volume: VoxelVolume) => void): THREE.BufferGeometry {
  const volume = new VoxelVolume();
  draw(volume);
  const surface = volume.geometry({ cellSize: STEP,
    origin: new THREE.Vector3(-STEP / 2, -STEP / 2, -STEP / 2) });
  surface.name = name;
  return surface;
}

/** A narrow standing stalk planted by six radial roots. */
export function voxelSpitterBase(): THREE.BufferGeometry {
  return geometry('Spitter planted stalk', volume => {
    for (let y = 0; y <= 21; y++) for (let x = -15; x <= 15; x++) {
      for (let z = -15; z <= 15; z++) {
        const px = x * STEP, py = y * STEP, pz = z * STEP;
        const radius = Math.hypot(px, pz);
        const stalkRadius = py < 0.35 ? 0.40 - py * 0.18
          : 0.34 - (py - 0.35) * 0.063;
        let root = false;
        if (py < 0.46 && radius < 1.27) for (let i = 0; i < 6; i++) {
          const angle = i * Math.PI / 3;
          const along = px * Math.sin(angle) + pz * Math.cos(angle);
          const across = Math.abs(px * Math.cos(angle) - pz * Math.sin(angle));
          if (along >= 0.16 && along <= 1.26 && across < 0.23 - along * 0.11
            && py <= 0.48 - along * 0.34) { root = true; break; }
        }
        if (radius > stalkRadius && !root) continue;
        const angle = Math.atan2(px, pz);
        const ridge = Math.sin(angle * 7 + py * 1.2) > 0.68;
        volume.put(x, y, z, root || py < 0.22 ? ROOT_DARK
          : ridge ? STALK_RIDGE : py > 1.3 ? STALK : ROOT);
      }
    }
  });
}

/** Inflated rear pressure sac; its ridges read from both side views. */
export function voxelSpitterBulb(): THREE.BufferGeometry {
  return geometry('Spitter pressure bulb', volume => {
    for (let x = -7; x <= 7; x++) for (let y = -6; y <= 6; y++) {
      for (let z = -15; z <= -2; z++) {
        const radius = (x / 6.3) ** 2 + (y / 5.4) ** 2 + ((z + 8.5) / 6.8) ** 2;
        if (radius > 1) continue;
        const ridge = Math.abs(y) <= 1 && (Math.abs(x) >= 3 || z <= -10);
        const shaded = y < -2 || z < -11;
        volume.put(x, y, z, ridge ? BULB_LIGHT : shaded ? BULB_DARK : BULB);
      }
    }
  });
}

/** Narrow launch tube with a recessed dark aperture and a muted colored lip. */
export function voxelSpitterMuzzle(): THREE.BufferGeometry {
  return geometry('Spitter launch aperture', volume => {
    for (let z = -5; z <= 0; z++) for (let x = -5; x <= 5; x++) {
      for (let y = -5; y <= 5; y++) {
        const radius = Math.hypot(x * STEP, y * STEP);
        const outside = z <= -3 ? 0.42 : 0.36;
        if (radius > outside) continue;
        const cavity = radius < 0.23 && z > -2;
        if (cavity) continue;
        const tint = z === -2 && radius < 0.23 ? APERTURE
          : z === 0 && radius >= 0.23 ? LIP
            : radius >= 0.30 && y > 1 ? LEAF_LIGHT : LEAF_DARK;
        volume.put(x, y, z, tint);
      }
    }
  });
}

/** Two pairs of layered side leaves, shaped to keep a slim ranged silhouette. */
export function voxelSpitterLeaves(): THREE.BufferGeometry {
  return geometry('Spitter layered leaves', volume => {
    for (const side of [-1, 1]) for (const tier of [0, 1]) {
      for (let along = 2; along <= (tier ? 15 : 18); along++) {
        const t = along / (tier ? 15 : 18);
        const centreY = Math.round((tier ? 1.33 : 0.75) / STEP
          + Math.sin(t * Math.PI) * (tier ? 3 : 4) - t * (tier ? 2 : 4));
        const centreZ = tier ? -4 : 3;
        const halfWidth = Math.max(0, Math.round((1 - t) * (tier ? 3 : 4)));
        for (let dz = -halfWidth; dz <= halfWidth; dz++) for (let dy = -1; dy <= 1; dy++) {
          const edge = Math.abs(dz) === halfWidth || along >= (tier ? 14 : 17);
          const vein = dz === 0 && dy === 1;
          volume.put(side * along, centreY + dy, centreZ + dz,
            edge ? LEAF_DARK : vein ? LEAF_LIGHT : LEAF);
        }
      }
    }
  });
}

/** Pointed chartreuse hazard seed with a dark dorsal seam. */
export function voxelSpitterPod(): THREE.BufferGeometry {
  return geometry('Spitter flying seed pod', volume => {
    for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) {
      for (let z = -4; z <= 4; z++) {
        const width = z <= 0 ? 2.5 + (z + 4) * 0.075 : 2.8 - z * 0.55;
        const radius = (x / width) ** 2 + (y / (width * 0.88)) ** 2;
        if (radius > 1) continue;
        const seam = y >= 1 && Math.abs(x) <= 1 && z >= -2 && z <= 2;
        const tip = z >= 3;
        const shaded = y <= -2 || z <= -3;
        volume.put(x, y, z, seam || shaded ? POD_DARK : tip ? POD_LIGHT : POD);
      }
    }
  });
}
