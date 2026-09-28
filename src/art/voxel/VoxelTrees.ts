import * as THREE from 'three';
import { plantShape, type PlantShape, type PlantType } from '@/plants/PlantGeometry';
import { VoxelVolume } from './VoxelSurface';

const CACHE = new Map<string, PlantShape>();

type Lobe = {
  x: number; y: number; z: number;
  rx: number; ry: number; rz: number;
  color: number;
};

/** Replacement plant geometry with the exact saved fruit/physics nodes. */
export function voxelPlantShape(type: PlantType, variant: number, harvestCrown: boolean): PlantShape {
  if (type !== 'appleTree' && type !== 'orangeTree' && type !== 'melonVine'
    && type !== 'bananaPlant' && type !== 'palm' && type !== 'boulderBush') {
    throw new Error(`no detailed voxel plant shape for ${type}`);
  }
  const key = `${type}:${variant}:${harvestCrown}`;
  const cached = CACHE.get(key);
  if (cached) return cached;

  // plantShape caches its geometry and may still supply live legacy trees.
  // Keep that shared cache intact; only use its authored gameplay metadata.
  const original = plantShape(type, variant, harvestCrown);
  const geometry = type === 'boulderBush' ? buildBoulderNest(variant, original)
    : type === 'palm' ? buildPalm(variant, original)
    : type === 'melonVine' ? buildMelonVine(variant, original)
    : type === 'bananaPlant' ? buildBananaPlant(variant, original)
      : buildTree(type, variant, harvestCrown, original);
  const result: PlantShape = {
    geometry,
    attachPoints: original.attachPoints,
    collider: original.collider,
    height: original.height,
  };
  CACHE.set(key, result);
  return result;
}

/** Low woody support and broad stepped leaves under the saved plum sockets. */
function buildBoulderNest(variant: number, original: PlantShape): THREE.BufferGeometry {
  const cell = 0.13;
  const volume = new VoxelVolume();
  volume.box(-2, 1, 0, 3, -2, 1, 0x62452d);
  volume.box(-1, 0, 3, 3, -1, 0, 0x80603c);
  for (let i = 0; i < 9; i++) {
    const angle = i * Math.PI * 2 / 9 + variant * 0.17;
    const dx = Math.sin(angle), dz = Math.cos(angle);
    const px = -dz, pz = dx;
    let last: [number, number, number] = [0, 3, 0];
    for (let t = 1; t <= 10; t++) {
      const tip: [number, number, number] = [
        Math.round(dx * t), t < 5 ? 3 : 2, Math.round(dz * t),
      ];
      fillTwig(volume, last, tip, i % 2 ? 0x355d38 : 0x406d3b);
      const width = t < 3 || t > 9 ? 1 : t < 5 || t > 7 ? 2 : 3;
      for (const side of [-1, 1]) {
        const edge: [number, number, number] = [
          tip[0] + Math.round(px * width * side), tip[1],
          tip[2] + Math.round(pz * width * side),
        ];
        fillTwig(volume, tip, edge, i % 2 ? 0x456e3c : 0x4f7842);
      }
      last = tip;
    }
  }
  const geometry = volume.geometry({ cellSize: cell,
    origin: new THREE.Vector3(-cell / 2, 0, -cell / 2),
    swayHeight: original.height });
  geometry.name = `VoxelTree:boulderBush:${variant}`;
  return geometry;
}

function buildPalm(variant: number, original: PlantShape): THREE.BufferGeometry {
  const cell = 0.24;
  const volume = new VoxelVolume();
  const topY = Math.round(original.height / cell);
  // The existing coconut sockets describe the curved trunk's crown centre.
  // Recovering that centre keeps gameplay attachments in place without
  // changing the seeded palm shape, collision capsule or fruit IDs.
  const top = original.attachPoints.reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .multiplyScalar(1 / original.attachPoints.length);
  const topX = Math.round(top.x / cell), topZ = Math.round(top.z / cell);

  for (let y = 0; y <= topY; y++) {
    const t = y / topY;
    const cx = Math.round(topX * t * t), cz = Math.round(topZ * t * t);
    const radius = y < 3 ? 2 : 1;
    for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
      if (x * x + z * z > radius * radius + 0.25) continue;
      const band = y % 6 === 0;
      volume.put(cx + x, y, cz + z,
        band ? 0x816244 : y % 11 < 4 ? 0x9c7851 : 0xa8875c);
    }
  }

  // Broad, tapering fronds keep the tropical silhouette, but each blade is a
  // stepped volume with a darker rib rather than a thin polygonal sheet.
  for (let i = 0; i < 7; i++) {
    const angle = i * Math.PI * 2 / 7 + variant * 0.19;
    const ux = Math.sin(angle), uz = Math.cos(angle);
    const vx = uz, vz = -ux;
    const length = Math.round((2.75 + ((i * 3 + variant) % 5) * 0.16) / cell);
    const droop = 5 + (i + variant) % 3;
    const green = [0x58a83f, 0x64af47, 0x4d9c3b][(i + variant) % 3];
    let previous: [number, number, number] = [topX, topY, topZ];
    for (let s = 1; s <= length; s++) {
      const t = s / length;
      const centre: [number, number, number] = [
        topX + Math.round(ux * s),
        topY + Math.round(2 * Math.sin(t * Math.PI * 0.85) - droop * t * t),
        topZ + Math.round(uz * s),
      ];
      fillTwig(volume, previous, centre, 0x397d34);
      const halfWidth = Math.max(0, Math.round(Math.sin(t * Math.PI) * 2.3));
      for (const side of [-1, 1]) {
        const edge: [number, number, number] = [
          centre[0] + Math.round(vx * halfWidth * side),
          centre[1] - (s > length * 0.63 ? 1 : 0),
          centre[2] + Math.round(vz * halfWidth * side),
        ];
        fillTwig(volume, centre, edge, green);
      }
      previous = centre;
    }
  }

  const geometry = volume.geometry({
    cellSize: cell,
    origin: new THREE.Vector3(-cell / 2, 0, -cell / 2),
    swayHeight: original.height,
  });
  geometry.name = `VoxelTree:palm:${variant}`;
  return geometry;
}

function buildBananaPlant(variant: number, original: PlantShape): THREE.BufferGeometry {
  const cell = 0.12;
  const volume = new VoxelVolume();
  const top = Math.round(original.height / cell);
  // A single tapered pseudostem remains inside the original trunk capsule.
  for (let y = 0; y <= top; y++) {
    const r = y < 4 ? 2 : 1;
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
      if (x * x + z * z > r * r + 0.25) continue;
      volume.put(x, y, z, (y + x + z) % 5 === 0 ? 0x849d4c : 0x718b41);
    }
  }
  // Six wide, tapering fronds grow from that stem. Each is occupied cells in
  // the same volume, so wind sway does not reveal loose leaf objects.
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + variant * 0.16;
    const ux = Math.cos(a), uz = Math.sin(a);
    const vx = -uz, vz = ux;
    const length = 16 + (i + variant) % 4;
    const pigment = [0x58a143, 0x6bb34a, 0x4d973e][(i + variant) % 3];
    for (let s = 0; s <= length; s++) {
      const t = s / length;
      const cx = Math.round(ux * s);
      const cz = Math.round(uz * s);
      const cy = top - Math.round(4 * t * t);
      const halfWidth = Math.max(0, Math.round(Math.sin(t * Math.PI) * 3.2));
      fillTwig(volume, [0, top, 0], [cx, cy, cz], 0x448639);
      for (let w = -halfWidth; w <= halfWidth; w++) {
        const x = cx + Math.round(vx * w), z = cz + Math.round(vz * w);
        const rib = Math.abs(w) <= 1;
        fillTwig(volume, [cx, cy, cz], [x, cy, z], rib ? 0x448639 : pigment);
        volume.put(x, cy, z, rib ? 0x448639 : pigment);
        if (rib && s < length - 2) volume.put(x, cy - 1, z, 0x397333);
      }
    }
  }
  const geometry = volume.geometry({
    cellSize: cell,
    origin: new THREE.Vector3(-cell / 2, 0, -cell / 2),
    swayHeight: original.height,
  });
  geometry.name = `VoxelTree:bananaPlant:${variant}`;
  return geometry;
}

function buildMelonVine(variant: number, original: PlantShape): THREE.BufferGeometry {
  const cell = 0.07;
  const volume = new VoxelVolume();
  // One rooted centre reaches the existing y=0.30 melon node; narrow runners
  // hold broad stepped leaves close to the ground, all in the same volume.
  volume.box(-1, 1, 0, 4, -1, 1, 0x4d793d);
  for (let i = 0; i < 7; i++) {
    const angle = i * Math.PI * 2 / 7 + variant * 0.24;
    const ux = Math.cos(angle), uz = Math.sin(angle);
    const radius = 0.68 + ((i * 3 + variant) % 4) * 0.12;
    const cx = Math.round(ux * radius / cell), cz = Math.round(uz * radius / cell);
    fillTwig(volume, [0, 2, 0], [cx, 2, cz], 0x4d823d);
    const leafTone = [0x4d9a43, 0x63ad4e, 0x478e40][(i + variant) % 3];
    for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) {
      const along = dx * ux + dz * uz;
      const across = -dx * uz + dz * ux;
      const tip = 6.3 + (i % 2) * 0.8;
      if ((along / tip) ** 2 + (across / 3.7) ** 2 > 1) continue;
      volume.put(cx + dx, 2, cz + dz, 0x397936);
      if (Math.abs(along) < tip * 0.82 && Math.abs(across) < 3.2) {
        volume.put(cx + dx, 3, cz + dz, leafTone);
      }
    }
  }
  const geometry = volume.geometry({
    cellSize: cell,
    origin: new THREE.Vector3(-cell / 2, 0, -cell / 2),
    swayHeight: original.height,
  });
  geometry.name = `VoxelTree:melonVine:${variant}`;
  return geometry;
}

export function disposeVoxelPlantShapes(): void {
  for (const shape of CACHE.values()) shape.geometry.dispose();
  CACHE.clear();
}

function buildTree(type: 'appleTree' | 'orangeTree', variant: number,
  harvestCrown: boolean, original: PlantShape): THREE.BufferGeometry {
  const apple = type === 'appleTree';
  const cell = 0.13;
  const volume = new VoxelVolume();
  const trunkH = original.collider!.offset * 2;
  const trunkR = original.collider!.radius / 1.15;
  const lean = (variant - 1) * (apple ? 0.045 : 0.05);
  const spread = apple ? 1.30 : 1.05;
  const crownR = apple ? 1.45 : 1.30;
  const habit = ((variant % 3) + 3) % 3;
  const palette = apple
    ? [0x4c8e43, 0x59a04a, 0x69a851, 0x478544]
    : [0x408a39, 0x519b41, 0x67a747, 0x3a7f3c];

  // Three-cell-wide lower shaft, tapered top and a small root flare remain
  // inside the original capsule while breaking the straight-stick silhouette.
  for (let y = 0; y <= Math.ceil((trunkH + 0.25) / cell); y++) {
    const wy = (y + 0.5) * cell;
    const cx = -Math.sin(lean) * wy;
    const cz = Math.sin((wy / trunkH) * Math.PI) * (variant - 1) * 0.035;
    const radius = trunkR * (wy < 0.30 ? 1.25 : wy > trunkH * 0.77 ? 0.82 : 1);
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
      const wx = x * cell, wz = z * cell;
      if (Math.hypot(wx - cx, wz - cz) > radius + cell * 0.22) continue;
      const bark = Math.abs(x * 3 + z * 5 + Math.floor(wy * 2)) % 7 < 2 ? 0x67442e
        : wy < 0.6 ? 0x765034 : 0x805638;
      volume.put(x, y, z, bark);
    }
  }

  // Broad trees are pruned into a low sheltering shelf; open trees expose
  // three rising forks; wind-shaped trees carry their crown downwind. Each
  // uses a few large leaf masses rather than a ring of interchangeable balls.
  const lobes: Lobe[] = habit === 0 ? [
    { x: 0, y: trunkH + crownR * 0.65, z: 0,
      rx: crownR * 0.92, ry: crownR * 0.48, rz: crownR * 0.85, color: palette[0] },
    { x: -spread * 0.96, y: trunkH + crownR * 0.61, z: -spread * 0.15,
      rx: crownR * 0.78, ry: crownR * 0.38, rz: crownR * 0.70, color: palette[1] },
    { x: spread * 0.96, y: trunkH + crownR * 0.63, z: spread * 0.12,
      rx: crownR * 0.78, ry: crownR * 0.38, rz: crownR * 0.70, color: palette[2] },
    { x: 0, y: trunkH + crownR * 0.45, z: spread * 0.70,
      rx: crownR * 0.68, ry: crownR * 0.34, rz: crownR * 0.63, color: palette[3] },
  ] : habit === 1 ? [
    { x: 0, y: trunkH + crownR * 1.02, z: 0,
      rx: crownR * 0.68, ry: crownR * 0.40, rz: crownR * 0.66, color: palette[0] },
    { x: -spread * 0.88, y: trunkH + crownR * 0.74, z: -spread * 0.28,
      rx: crownR * 0.58, ry: crownR * 0.39, rz: crownR * 0.57, color: palette[1] },
    { x: spread * 0.90, y: trunkH + crownR * 0.80, z: spread * 0.34,
      rx: crownR * 0.58, ry: crownR * 0.38, rz: crownR * 0.57, color: palette[2] },
  ] : [
    { x: spread * 0.54, y: trunkH + crownR * 0.69, z: 0,
      rx: crownR * 0.76, ry: crownR * 0.56, rz: crownR * 0.72, color: palette[0] },
    { x: spread * 1.40, y: trunkH + crownR * 0.45, z: spread * 0.18,
      rx: crownR * 0.69, ry: crownR * 0.43, rz: crownR * 0.67, color: palette[1] },
    { x: spread * 1.12, y: trunkH + crownR * 0.96, z: -spread * 0.32,
      rx: crownR * 0.59, ry: crownR * 0.39, rz: crownR * 0.59, color: palette[2] },
  ];

  // Tapered boughs remain visible through the open lower crown, but reach
  // into each mass so the whole voxel surface is face-connected to the trunk.
  for (let i = 0; i < lobes.length; i++) {
    const end = lobes[i];
    fillBranch(volume,
      new THREE.Vector3(0, trunkH * (0.68 + i * 0.045), 0),
      new THREE.Vector3(end.x, end.y - end.ry * 0.32, end.z),
      cell, 0x775034);
  }

  const minX = Math.floor(Math.min(...lobes.map(l => l.x - l.rx)) / cell) - 2;
  const maxX = Math.ceil(Math.max(...lobes.map(l => l.x + l.rx)) / cell) + 2;
  const minZ = Math.floor(Math.min(...lobes.map(l => l.z - l.rz)) / cell) - 2;
  const maxZ = Math.ceil(Math.max(...lobes.map(l => l.z + l.rz)) / cell) + 2;
  for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
    for (let y = Math.floor((trunkH - crownR * 0.25) / cell); y <= Math.ceil((original.height + 0.10) / cell); y++) {
      const wx = x * cell, wy = (y + 0.5) * cell, wz = z * cell;
      let best = Infinity;
      let lobeIndex = -1;
      for (let i = 0; i < lobes.length; i++) {
        const l = lobes[i];
        const prune = harvestCrown && i > 0 ? 0.96 : 1;
        const d = Math.abs((wx - l.x) / (l.rx * prune)) ** 4
          + Math.abs((wy - l.y) / (l.ry * prune)) ** 4
          + Math.abs((wz - l.z) / (l.rz * prune)) ** 4;
        if (d < best) { best = d; lobeIndex = i; }
      }
      const edge = 0.08 * Math.sin(wx * 3.1 + variant) * Math.cos(wz * 2.8 - wy * 1.3)
        + 0.035 * Math.sin(wy * 5.1 + wx * 2.2);
      if (best > 1 + edge) continue;
      // Keep saved fruit positions visible against small recesses in the leaf
      // surface, without moving the gameplay node or opening broad holes.
      if (harvestCrown && original.attachPoints.some(pt =>
        Math.hypot(wx - pt.x, wy - pt.y, wz - pt.z) < 0.22)) continue;
      volume.put(x, y, z, lobes[lobeIndex].color);
    }
  }

  // A narrow, grid-connected spur reaches the top of every saved fruit node.
  // Node coordinates stay identical for save/network logic; the branch makes
  // even an outlying harvest point visibly belong to this crown.
  for (const pt of original.attachPoints) {
    const tip: [number, number, number] = [
      Math.round(pt.x / cell), Math.floor((pt.y + 0.16) / cell), Math.round(pt.z / cell),
    ];
    const root = volume.nearest(tip[0], tip[1], tip[2], 16);
    if (!root) throw new Error(`voxel ${type} fruit spur has no crown root`);
    fillTwig(volume, root, tip);
  }

  const geometry = volume.geometry({
    cellSize: cell,
    origin: new THREE.Vector3(-cell / 2, 0, -cell / 2),
    swayHeight: original.height,
  });
  geometry.name = `VoxelTree:${type}:${variant}${harvestCrown ? ':harvest' : ''}`;
  return geometry;
}

function fillTwig(volume: VoxelVolume, from: [number, number, number],
  to: [number, number, number], pigment = 0x745032): void {
  const current: [number, number, number] = [...from];
  const steps = Math.max(...to.map((v, i) => Math.abs(v - from[i])));
  for (let i = 1; i <= steps; i++) {
    const target = to.map((v, axis) => Math.round(from[axis] + (v - from[axis]) * i / steps));
    // One axis per occupied cell keeps a diagonal twig face-connected.
    for (let axis = 0; axis < 3; axis++) {
      while (current[axis] !== target[axis]) {
        current[axis] += Math.sign(target[axis] - current[axis]);
        volume.put(current[0], current[1], current[2], pigment);
      }
    }
  }
}

function fillBranch(volume: VoxelVolume, from: THREE.Vector3, to: THREE.Vector3,
  cell: number, pigment: number): void {
  const distance = from.distanceTo(to);
  const steps = Math.ceil(distance / (cell * 0.35));
  for (let i = 0; i <= steps; i++) {
    const p = from.clone().lerp(to, i / steps);
    const cx = Math.round(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.round(p.z / cell);
    const radiusSq = (1.8 - 0.75 * i / steps) ** 2;
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
      if (dx * dx + dy * dy + dz * dz > radiusSq) continue;
      volume.put(cx + dx, cy + dy, cz + dz, pigment);
    }
  }
}
