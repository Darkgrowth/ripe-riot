import * as THREE from 'three';
import { VoxelVolume } from './VoxelSurface';

export const VOXEL_DRESSING_KINDS = [
  'grass', 'reed', 'bush', 'bushBig', 'fern',
  'flowerStem', 'flowerHead', 'stone', 'driftwood',
] as const;

export type VoxelDressingKind = typeof VOXEL_DRESSING_KINDS[number];

const GRASS_BASE = 0x4e8f2b;
const GRASS_MID = 0x78ad38;
const GRASS_TIP = 0x9ec94a;
const BUSH_DARK = 0x458c2d;
const BUSH_MID = 0x61a53b;
const BUSH_LIT = 0x76b641;
const FERN_DARK = 0x3f8a3a;
const FERN_LIT = 0x73ad46;
const FLOWER_H = [0.38, 0.27, 0.34, 0.24];
const FLOWER_A = [0.31, -0.42, 0.18, -0.25];

/** A thin connected staircase between authored points, avoiding floating voxels. */
function trace(volume: VoxelVolume, from: [number, number, number],
  to: [number, number, number], color: number): void {
  let [x, y, z] = from;
  volume.put(x, y, z, color);
  while (x !== to[0] || y !== to[1] || z !== to[2]) {
    if (y !== to[1]) y += Math.sign(to[1] - y);
    else if (x !== to[0]) x += Math.sign(to[0] - x);
    else z += Math.sign(to[2] - z);
    volume.put(x, y, z, color);
  }
}

function grass(tall: boolean): THREE.BufferGeometry {
  const volume = new VoxelVolume();
  const cell = tall ? 0.10 : 0.08;
  const height = tall ? 9 : 6;
  const angles = [0.13, 1.44, 2.63, 3.88, 5.18];
  angles.forEach((angle, i) => {
    let last: [number, number, number] = [0, 0, 0];
    for (let y = 0; y <= height - (i % 3); y++) {
      const t = y / height;
      const distance = t * t * (tall ? 3.8 : 3.0);
      const point: [number, number, number] = [
        Math.round(Math.cos(angle) * distance), y,
        Math.round(Math.sin(angle) * distance),
      ];
      trace(volume, last, point, t > 0.68 ? GRASS_TIP : t > 0.35 ? GRASS_MID : GRASS_BASE);
      last = point;
    }
  });
  return volume.geometry({ cellSize: cell,
    origin: new THREE.Vector3(-cell / 2, 0, -cell / 2),
    swayHeight: (height + 1) * cell });
}

function ellipsoid(volume: VoxelVolume, cx: number, cy: number, cz: number,
  rx: number, ry: number, rz: number, colors: readonly number[], phase: number): void {
  for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const rough = 0.09 * Math.sin(x * 1.31 + z * 0.77 + phase)
          * Math.cos(z * 1.63 - y * 0.61);
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
          + ((z - cz) / rz) ** 2;
        if (d > 1 + rough) continue;
        const shade = y > cy + ry * 0.34 ? 2 : y > cy - ry * 0.28 ? 1 : 0;
        volume.put(x, y, z, colors[shade]);
      }
    }
  }
}

function bush(big: boolean): THREE.BufferGeometry {
  const volume = new VoxelVolume();
  const cell = big ? 0.14 : 0.105;
  const scale = 1;
  const lobes: Array<[number, number, number, number]> = [
    [-2.1, 2.8, -0.8, 3.9], [1.8, 3.3, -1.7, 4.1],
    [-0.1, 3.6, 2.1, 4.0], [2.6, 2.3, 2.2, 3.1],
  ];
  if (big) lobes.push([-3.1, 3.5, 1.5, 3.5], [0.0, 4.8, 0.0, 3.6]);
  lobes.forEach(([x, y, z, r], i) => {
    ellipsoid(volume, x * scale, y * scale, z * scale,
      r * scale, (i === 5 ? 3.2 : 2.9) * scale, r * 0.86 * scale,
      [BUSH_DARK, BUSH_MID, BUSH_LIT], i * 2.3);
  });
  // Stems touch the floor and join the canopy into one readable silhouette.
  for (const [x, z] of [[-2, -1], [2, -1], [0, 2]])
    trace(volume, [x, 0, z], [x, big ? 4 : 3, z], BUSH_DARK);
  return volume.geometry({ cellSize: cell,
    origin: new THREE.Vector3(-cell / 2, 0, -cell / 2),
    swayHeight: big ? 1.2 : 0.9 });
}

function fern(): THREE.BufferGeometry {
  const volume = new VoxelVolume();
  const cell = 0.085;
  volume.box(-1, 1, 0, 2, -1, 1, FERN_DARK);
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + 0.15;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const px = -dz, pz = dx;
    let last: [number, number, number] = [0, 2, 0];
    for (let t = 1; t <= 8; t++) {
      const point: [number, number, number] = [
        Math.round(dx * t), Math.round(2 + 4.2 * Math.sin((t / 8) * Math.PI * 0.82)),
        Math.round(dz * t),
      ];
      const color = t >= 5 ? FERN_LIT : FERN_DARK;
      trace(volume, last, point, color);
      if (t >= 2 && t <= 7) {
        const width = t <= 5 ? 2 : 1;
        for (const side of [-1, 1]) {
          const tip: [number, number, number] = [
            point[0] + Math.round(px * width * side), point[1],
            point[2] + Math.round(pz * width * side),
          ];
          trace(volume, point, tip, color);
        }
      }
      last = point;
    }
  }
  return volume.geometry({ cellSize: cell,
    origin: new THREE.Vector3(-cell / 2, 0, -cell / 2), swayHeight: 0.75 });
}

function flower(stem: boolean): THREE.BufferGeometry {
  const volume = new VoxelVolume();
  const cell = 0.035;
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + FLOWER_A[i];
    const h = Math.round(FLOWER_H[i] / cell);
    const out = Math.round(FLOWER_H[i] * 0.4 / cell);
    const tip: [number, number, number] = [
      Math.round(Math.cos(angle) * out), h, Math.round(Math.sin(angle) * out),
    ];
    if (stem) {
      let prev: [number, number, number] = [0, 0, 0];
      for (let y = 1; y <= h; y++) {
        const t = y / h;
        const next: [number, number, number] = [
          Math.round(tip[0] * t * t), y, Math.round(tip[2] * t * t),
        ];
        trace(volume, prev, next, y < h / 2 ? GRASS_BASE : GRASS_TIP);
        prev = next;
      }
    } else {
      // White petals accept the existing per-instance flower tint. A warm
      // centre remains visible after multiplication by the petal colour.
      volume.put(...tip, 0xfff4d6);
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1],
        [-2, 0], [2, 0], [0, -2], [0, 2]])
        volume.put(tip[0] + dx, tip[1], tip[2] + dz, 0xffffff);
      volume.put(tip[0], tip[1] + 1, tip[2], 0xffffff);
    }
  }
  return volume.geometry({ cellSize: cell,
    origin: new THREE.Vector3(-cell / 2, 0, -cell / 2), swayHeight: 0.42 });
}

function stone(): THREE.BufferGeometry {
  const volume = new VoxelVolume();
  ellipsoid(volume, 0, 1.2, 0, 3.8, 2.4, 3.2,
    [0x6b6459, 0x8e8371, 0x9a8f7c], 1.7);
  return volume.geometry({ cellSize: 0.09,
    origin: new THREE.Vector3(-0.045, -0.045, -0.045) });
}

function driftwood(): THREE.BufferGeometry {
  const volume = new VoxelVolume();
  for (let x = -7; x <= 7; x++) {
    const bend = x < -2 ? -1 : x > 4 ? 1 : 0;
    for (let z = -1; z <= 1; z++) {
      volume.put(x, 1, z + bend, x % 5 === 0 ? 0xc29e70 : 0xa78e6d);
      if (Math.abs(x) < 6 && z === 0) volume.put(x, 2, bend, 0xb18b60);
    }
  }
  for (const x of [-4, 4]) volume.box(x, x + 1, 0, 2, -1, 1, 0x7d6042);
  return volume.geometry({ cellSize: 0.11,
    origin: new THREE.Vector3(-0.055, 0, -0.055) });
}

/** One reusable local-space geometry per kind; Dressing instances the result. */
export function voxelDressingGeometry(kind: VoxelDressingKind): THREE.BufferGeometry {
  let geometry: THREE.BufferGeometry;
  switch (kind) {
    case 'grass': geometry = grass(false); break;
    case 'reed': geometry = grass(true); break;
    case 'bush': geometry = bush(false); break;
    case 'bushBig': geometry = bush(true); break;
    case 'fern': geometry = fern(); break;
    case 'flowerStem': geometry = flower(true); break;
    case 'flowerHead': geometry = flower(false); break;
    case 'stone': geometry = stone(); break;
    case 'driftwood': geometry = driftwood(); break;
  }
  geometry.name = `VoxelDressing:${kind}`;
  return geometry;
}
