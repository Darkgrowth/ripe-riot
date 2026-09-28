import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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
    && type !== 'bananaPlant' && type !== 'palm' && type !== 'boulderBush'
    && type !== 'puffBush' && type !== 'gumTree' && type !== 'spikeShrub') {
    throw new Error(`no detailed voxel plant shape for ${type}`);
  }
  const key = `${type}:${variant}:${harvestCrown}`;
  const cached = CACHE.get(key);
  if (cached) return cached;

  // plantShape caches its geometry and may still supply live legacy trees.
  // Keep that shared cache intact; only use its authored gameplay metadata.
  const original = plantShape(type, variant, harvestCrown);
  const geometry = type === 'boulderBush' ? buildBoulderNest(variant, original)
    : type === 'puffBush' ? buildPuffBush(variant, original)
    : type === 'gumTree' || type === 'spikeShrub' ? buildIslandShrub(type, variant, original)
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

/** Olive gum on a short stem and low teal spike shrub use the saved nodes. */
function buildIslandShrub(type: 'gumTree' | 'spikeShrub', variant: number,
  original: PlantShape): THREE.BufferGeometry {
  const gum = type === 'gumTree';
  const cell = 0.14;
  const volume = new VoxelVolume();
  const lean = (variant - 1) * 0.08;
  if (gum) {
    // A narrow woody stem is the only collision-bearing part of this plant.
    for (let y = 0; y <= 8; y++) {
      const cx = Math.round(lean * y);
      volume.box(cx - 1, cx + 1, y, y, -1, 1,
        y % 3 === 0 ? 0x715336 : 0x62492f);
    }
  } else {
    volume.box(-2, 2, 0, 3, -2, 2, 0x1d4f42);
  }
  const palette = gum
    ? [0x707b2f, 0x89943b, 0xa3aa49, 0x627329]
    : [0x24594c, 0x317262, 0x3e806c, 0x1c5046];
  const lobes: Lobe[] = gum ? [
    { x: 0, y: 1.25, z: 0, rx: 0.87, ry: 0.57, rz: 0.84, color: palette[0] },
    { x: -0.61, y: 1.09, z: -0.21, rx: 0.66, ry: 0.46, rz: 0.68, color: palette[1] },
    { x: 0.63, y: 1.17, z: 0.15, rx: 0.68, ry: 0.44, rz: 0.65, color: palette[2] },
    { x: 0.08, y: 1.36, z: 0.58, rx: 0.60, ry: 0.40, rz: 0.58, color: palette[3] },
  ] : [
    { x: 0, y: 0.78, z: 0, rx: 0.96, ry: 0.63, rz: 0.94, color: palette[0] },
    { x: -0.56, y: 0.75, z: -0.16, rx: 0.70, ry: 0.49, rz: 0.67, color: palette[1] },
    { x: 0.51, y: 0.91, z: 0.13, rx: 0.71, ry: 0.53, rz: 0.68, color: palette[2] },
    { x: 0.03, y: 0.70, z: 0.63, rx: 0.61, ry: 0.48, rz: 0.57, color: palette[3] },
  ];
  for (const lobe of lobes) lobe.x += lean;
  for (let x = -11; x <= 11; x++) for (let y = 0; y <= 15; y++) {
    for (let z = -11; z <= 11; z++) {
      const wx = x * cell, wy = (y + 0.5) * cell, wz = z * cell;
      let best = Infinity, selected = 0;
      for (let i = 0; i < lobes.length; i++) {
        const l = lobes[i];
        const d = Math.abs((wx - l.x) / l.rx) ** 3
          + Math.abs((wy - l.y) / l.ry) ** 3
          + Math.abs((wz - l.z) / l.rz) ** 3;
        if (d < best) { best = d; selected = i; }
      }
      if (best > 1 + 0.065 * Math.sin(wx * 4 + wz * 3 + variant)) continue;
      if (original.attachPoints.some(pt =>
        Math.hypot(wx - pt.x, wy - pt.y, wz - pt.z) < 0.19)) continue;
      volume.put(x, y, z, lobes[selected].color);
    }
  }
  if (!gum) {
    // A few outward rising leaf tips distinguish the hazard without creating
    // gameplay collision or a forest of slender spikes.
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3 + variant * 0.15;
      const root: [number, number, number] = [
        Math.round(Math.sin(angle) * 5), 6, Math.round(Math.cos(angle) * 5),
      ];
      const tip: [number, number, number] = [
        Math.round(Math.sin(angle) * 9), 11 + i % 2,
        Math.round(Math.cos(angle) * 9),
      ];
      fillTwig(volume, root, tip, palette[i % palette.length]);
    }
  }
  const geometry = volume.geometry({ cellSize: cell,
    origin: new THREE.Vector3(-cell / 2, 0, -cell / 2),
    swayHeight: original.height });
  geometry.name = `VoxelTree:${type}:${variant}`;
  return geometry;
}

/** A low, connected leaf mass under the saved Puffmelon fruit sockets. */
function buildPuffBush(variant: number, original: PlantShape): THREE.BufferGeometry {
  const cell = 0.15;
  const volume = new VoxelVolume();
  volume.box(-1, 1, 0, 3, -1, 1, 0x407839);
  const bias = (((variant % 3) + 3) % 3 - 1) * 0.10;
  const lobes: Lobe[] = [
    { x: -0.37 + bias, y: 0.66, z: -0.16, rx: 0.70, ry: 0.51, rz: 0.68, color: 0x4c913f },
    { x: 0.37 + bias, y: 0.72, z: 0.11, rx: 0.72, ry: 0.53, rz: 0.67, color: 0x5aa148 },
    { x: bias, y: 0.84, z: 0.33, rx: 0.63, ry: 0.49, rz: 0.62, color: 0x67a74c },
  ];
  for (let x = -9; x <= 9; x++) for (let y = 0; y <= 10; y++) for (let z = -9; z <= 9; z++) {
    const wx = x * cell, wy = (y + 0.5) * cell, wz = z * cell;
    let best = Infinity, selected = 0;
    for (let i = 0; i < lobes.length; i++) {
      const lobe = lobes[i];
      const d = ((wx - lobe.x) / lobe.rx) ** 4 + ((wy - lobe.y) / lobe.ry) ** 4
        + ((wz - lobe.z) / lobe.rz) ** 4;
      if (d < best) { best = d; selected = i; }
    }
    const edge = 0.035 * Math.sin(wx * 3.2 + wz * 1.7 + variant);
    if (best > 1 + edge) continue;
    // The visual recess exposes existing fruit; their gameplay coordinates do
    // not move, and the rest of the crown remains a single occupied surface.
    if (original.attachPoints.some(pt => Math.hypot(wx - pt.x, wy - pt.y, wz - pt.z) < 0.19)) continue;
    volume.put(x, y, z, lobes[selected].color);
  }
  const geometry = volume.geometry({ cellSize: cell,
    origin: new THREE.Vector3(-cell / 2, 0, -cell / 2),
    swayHeight: original.height });
  geometry.name = `VoxelTree:puffBush:${variant}`;
  return geometry;
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
  const cell = 0.22;
  const volume = new VoxelVolume();
  const topY = Math.round(original.height / cell);
  // The existing coconut sockets describe the curved trunk's crown centre.
  // Recovering that centre keeps gameplay attachments in place without
  // changing the seeded palm shape, collision capsule or fruit IDs.
  const top = original.attachPoints.reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .multiplyScalar(1 / original.attachPoints.length);
  const topX = Math.round(top.x / cell), topZ = Math.round(top.z / cell);

  // The bark shaft is a faceted swept taper. Full-cell horizontal shifts on
  // a tall leaning palm produce obvious stacked joints at gameplay eye level;
  // a few broad planar faces preserve the softened block style while keeping
  // the outer silhouette continuously curved.
  const shaft = buildPalmShaft(topX * cell, topZ * cell, topY * cell, variant);
  volume.box(topX - 1, topX + 1, topY - 1, topY, topZ - 1, topZ + 1, 0x987653);

  // Five or six continuous leaf fans leave open sky between broad blades
  // instead of merging into a flat umbrella. Keep the inner cells bare so
  // coconuts can read below the fronds. All habits share sockets and sway.
  const habit = ((variant % 3) + 3) % 3;
  const count = habit === 2 ? 4 : 5;
  for (let i = 0; i < count; i++) {
    const angle = i * Math.PI * 2 / count + variant * 0.17 + (i % 2 ? 0.07 : -0.04);
    const ux = Math.sin(angle), uz = Math.cos(angle);
    const vx = uz, vz = -ux;
    const wind = habit === 1 ? ux * 0.23 : 0;
    const length = Math.round((3.0 + ((i * 2 + variant) % 3) * 0.13 + wind) / cell);
    const droop = habit === 2 ? 3.4 + (i % 2) * 0.8
      : habit === 1 ? 2.8 + (i % 2) * 0.6 : 2.5 + (i % 2);
    const green = [0x60a345, 0x6bad4c, 0x57983f][(i + variant) % 3];
    const shade = [0x4c8a3d, 0x528d3e, 0x478139][(i + variant) % 3];
    let previous: [number, number, number] = [topX, topY, topZ];
    for (let s = 1; s <= length; s++) {
      const t = s / length;
      const centre: [number, number, number] = [
        topX + Math.round(ux * s),
        topY + Math.round(1.5 * Math.sin(t * Math.PI * 0.9) - droop * t * t),
        topZ + Math.round(uz * s),
      ];
      fillTwig(volume, previous, centre, shade);
      if (s > 2) {
        // Broad blades occupy both sides of the curved midrib. Their tips
        // taper early enough to leave clear sky between neighboring fronds.
        const halfWidth = Math.max(0, Math.round(Math.sin(t * Math.PI) ** 0.8
          * (habit === 2 ? 2.70 : 2.95)));
        for (const side of [-1, 1]) {
          const edge: [number, number, number] = [
            centre[0] + Math.round(vx * halfWidth * side), centre[1],
            centre[2] + Math.round(vz * halfWidth * side),
          ];
          fillTwig(volume, centre, edge, green);
          // One deep interior row gives each fan an intentional soft block
          // silhouette. Leave the outer rim thin and tapered.
          if (t > 0.18 && t < 0.76 && halfWidth > 1) {
            const inner: [number, number, number] = [
              centre[0] + Math.round(vx * (halfWidth - 1) * side), centre[1] - 1,
              centre[2] + Math.round(vz * (halfWidth - 1) * side),
            ];
            fillTwig(volume, [centre[0], centre[1] - 1, centre[2]], inner, shade);
            volume.put(centre[0], centre[1] - 1, centre[2], shade);
          }
        }
      }
      previous = centre;
    }
  }

  const canopy = volume.geometry({
    cellSize: cell,
    origin: new THREE.Vector3(-cell / 2, 0, -cell / 2),
    swayHeight: original.height,
  });
  const geometry = mergeGeometries([shaft, canopy], false);
  if (!geometry) throw new Error('palm shaft and crown merge failed');
  geometry.userData.voxelConnectedComponents = canopy.userData.voxelConnectedComponents;
  geometry.userData.voxelCount = canopy.userData.voxelCount;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  shaft.dispose();
  canopy.dispose();
  geometry.name = `VoxelTree:palm:${variant}`;
  return geometry;
}

function buildPalmShaft(topX: number, topZ: number, height: number,
  variant: number): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [];
  const colors: number[] = [], sway: number[] = [];
  const rings = 22, sides = 10;
  const bark = [0x987653, 0xa2805c, 0x92704e].map(hex =>
    new THREE.Color().setHex(hex, THREE.SRGBColorSpace));
  const point = (ring: number, side: number): [number, number, number] => {
    const t = ring / rings;
    const bend = t * t * (3 - 2 * t);
    const angle = side * Math.PI * 2 / sides;
    const radius = 0.44 - t * 0.15 + (ring === 0 ? 0.04 : 0);
    return [topX * bend + Math.cos(angle) * radius, height * t,
      topZ * bend + Math.sin(angle) * radius];
  };
  const add = (point: [number, number, number], normal: [number, number, number],
    pigment: THREE.Color) => {
    positions.push(...point);
    normals.push(...normal);
    colors.push(pigment.r, pigment.g, pigment.b);
    sway.push(Math.pow(point[1] / height, 1.6));
  };
  for (let ring = 0; ring < rings; ring++) for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides;
    const angle = (side + 0.5) * Math.PI * 2 / sides;
    const normal: [number, number, number] = [Math.cos(angle), 0.05, Math.sin(angle)];
    const pigment = bark[(side + variant) % bark.length];
    const a = point(ring, side), b = point(ring + 1, side);
    const c = point(ring + 1, next), d = point(ring, next);
    for (const vertex of [a, b, c, a, c, d]) add(vertex, normal, pigment);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('swayWeight', new THREE.Float32BufferAttribute(sway, 1));
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

  // The upper lobes establish distinct habits. Lower asymmetric shoulders
  // occupy the outer halves of three boughs, leaving the central trunk and
  // most fruit exposed while keeping the limbs from reading as coat racks.
  const lobes: Lobe[] = habit === 0 ? [
    { x: 0, y: trunkH + crownR * 0.65, z: 0,
      rx: crownR * 0.92, ry: crownR * 0.48, rz: crownR * 0.85, color: palette[0] },
    { x: -spread * 0.96, y: trunkH + crownR * 0.61, z: -spread * 0.15,
      rx: crownR * 0.78, ry: crownR * 0.38, rz: crownR * 0.70, color: palette[1] },
    { x: spread * 0.96, y: trunkH + crownR * 0.63, z: spread * 0.12,
      rx: crownR * 0.78, ry: crownR * 0.38, rz: crownR * 0.70, color: palette[2] },
    { x: 0, y: trunkH + crownR * 0.45, z: spread * 0.70,
      rx: crownR * 0.68, ry: crownR * 0.34, rz: crownR * 0.63, color: palette[3] },
    { x: -spread * 0.88, y: trunkH - 0.43, z: -spread * 0.18,
      rx: crownR * 0.66, ry: crownR * 0.55, rz: crownR * 0.56, color: palette[1] },
    { x: spread * 0.92, y: trunkH - 0.24, z: spread * 0.20,
      rx: crownR * 0.69, ry: crownR * 0.52, rz: crownR * 0.61, color: palette[2] },
    { x: -spread * 0.10, y: trunkH - 0.38, z: spread * 0.83,
      rx: crownR * 0.55, ry: crownR * 0.48, rz: crownR * 0.60, color: palette[3] },
  ] : habit === 1 ? [
    { x: 0, y: trunkH + crownR * 1.02, z: 0,
      rx: crownR * 0.68, ry: crownR * 0.40, rz: crownR * 0.66, color: palette[0] },
    { x: -spread * 0.88, y: trunkH + crownR * 0.74, z: -spread * 0.28,
      rx: crownR * 0.58, ry: crownR * 0.39, rz: crownR * 0.57, color: palette[1] },
    { x: spread * 0.90, y: trunkH + crownR * 0.80, z: spread * 0.34,
      rx: crownR * 0.58, ry: crownR * 0.38, rz: crownR * 0.57, color: palette[2] },
    { x: -spread * 0.78, y: trunkH - 0.34, z: -spread * 0.22,
      rx: crownR * 0.66, ry: crownR * 0.57, rz: crownR * 0.59, color: palette[1] },
    { x: spread * 0.91, y: trunkH - 0.26, z: spread * 0.31,
      rx: crownR * 0.63, ry: crownR * 0.55, rz: crownR * 0.58, color: palette[2] },
    { x: -spread * 0.06, y: trunkH - 0.20, z: spread * 0.78,
      rx: crownR * 0.57, ry: crownR * 0.47, rz: crownR * 0.61, color: palette[3] },
  ] : [
    { x: spread * 0.54, y: trunkH + crownR * 0.69, z: 0,
      rx: crownR * 0.76, ry: crownR * 0.56, rz: crownR * 0.72, color: palette[0] },
    { x: spread * 1.40, y: trunkH + crownR * 0.45, z: spread * 0.18,
      rx: crownR * 0.69, ry: crownR * 0.43, rz: crownR * 0.67, color: palette[1] },
    { x: spread * 1.12, y: trunkH + crownR * 0.96, z: -spread * 0.32,
      rx: crownR * 0.59, ry: crownR * 0.39, rz: crownR * 0.59, color: palette[2] },
    { x: spread * 0.62, y: trunkH - 0.42, z: spread * 0.12,
      rx: crownR * 0.74, ry: crownR * 0.54, rz: crownR * 0.65, color: palette[1] },
    { x: spread * 1.39, y: trunkH - 0.31, z: spread * 0.20,
      rx: crownR * 0.62, ry: crownR * 0.50, rz: crownR * 0.56, color: palette[2] },
    { x: spread * 0.96, y: trunkH - 0.17, z: -spread * 0.62,
      rx: crownR * 0.54, ry: crownR * 0.46, rz: crownR * 0.55, color: palette[3] },
  ];

  // A short leaf collar sits behind the low fruit of each main bough. These
  // small, overlapping pads make the fruit feel grown from the crown without
  // wrapping it in foliage or changing its saved attachment coordinates.
  for (let i = 0; i < original.attachPoints.length; i++) {
    const pt = original.attachPoints[i];
    if (pt.y >= trunkH - 0.05) continue;
    const axis = Math.max(0.25, Math.hypot(pt.x, pt.z));
    lobes.push({
      x: pt.x - pt.x / axis * 0.24,
      y: pt.y + 0.35 + (i % 3) * 0.045,
      z: pt.z - pt.z / axis * 0.24,
      rx: 0.33 + (i % 2) * 0.05, ry: 0.29, rz: 0.34 + (i % 3) * 0.03,
      color: palette[(i + 1) % palette.length],
    });
  }

  // Tapered boughs remain visible through the open lower crown, but reach
  // into each mass so the whole voxel surface is face-connected to the trunk.
  for (let i = 0; i < 3; i++) {
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
        const d = Math.abs((wx - l.x) / (l.rx * prune)) ** 3
          + Math.abs((wy - l.y) / (l.ry * prune)) ** 3
          + Math.abs((wz - l.z) / (l.rz * prune)) ** 3;
        if (d < best) { best = d; lobeIndex = i; }
      }
      const edge = 0.10 * Math.sin(wx * 3.1 + variant) * Math.cos(wz * 2.8 - wy * 1.3)
        + 0.035 * Math.sin(wy * 5.1 + wx * 2.2);
      if (best > 1 + edge) continue;
      // Keep saved fruit positions visible against small recesses in the leaf
      // surface, without moving the gameplay node or opening broad holes.
      if (harvestCrown && original.attachPoints.some(pt =>
        Math.hypot(wx - pt.x, wy - pt.y, wz - pt.z) < 0.22)) continue;
      volume.put(x, y, z, lobes[lobeIndex].color);
    }
  }

  // The smallest outer pads can sit one cell clear of a shoulder. Join them
  // through the foliage, so the batched mesh remains one swaying surface.
  for (const pad of lobes.slice(habit === 0 ? 7 : 6)) {
    fillTwig(volume,
      [Math.round(pad.x / cell), Math.floor(pad.y / cell), Math.round(pad.z / cell)],
      [0, Math.floor(trunkH / cell), 0], pad.color);
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
