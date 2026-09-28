import * as THREE from 'three';
import { VoxelVolume } from './VoxelSurface';

const CACHE = new Map<string, THREE.BufferGeometry>();
export const VOXEL_FRUIT_SPECIES = ['apple', 'orange', 'watermelon', 'coconut',
  'banana', 'puffmelon', 'vinebomb', 'boulderplum', 'gluefruit', 'spikefruit'] as const;
type VoxelFruitSpecies = typeof VOXEL_FRUIT_SPECIES[number];
export function hasVoxelFruit(species: string): species is VoxelFruitSpecies {
  return (VOXEL_FRUIT_SPECIES as readonly string[]).includes(species);
}

/** Unit-diameter, vertex-coloured fruit for the existing species InstancedMesh. */
export function voxelFruitGeometry(species: string, resolution: 8 | 12 | 20 = 20): THREE.BufferGeometry {
  const key = `${species}:${resolution}`;
  const cached = CACHE.get(key);
  if (cached) return cached;
  if (!hasVoxelFruit(species)) {
    throw new Error(`no detailed voxel fruit geometry for ${species}`);
  }
  const geometry = build(species, resolution);
  CACHE.set(key, geometry);
  return geometry;
}

export function disposeVoxelFruitGeometries(): void {
  for (const geometry of CACHE.values()) geometry.dispose();
  CACHE.clear();
}

function build(species: VoxelFruitSpecies, n: 8 | 12 | 20): THREE.BufferGeometry {
  if (species !== 'apple' && species !== 'orange' && species !== 'watermelon'
    && species !== 'coconut') return specialtyFruit(species, n);
  // Hero fruit has 20 modeling cells across; smaller coconuts use 12 nearby.
  // Distant fruit uses 8 after its screen diameter falls below about 20-25 px.
  const cell = 1 / n;
  const center = n / 2;
  const volume = new VoxelVolume();
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) {
    const px = (x + 0.5) * cell - 0.5;
    const py = (y + 0.5) * cell - 0.5;
    const pz = (z + 0.5) * cell - 0.5;
    const radial = Math.hypot(px, pz);
    let inside = false;
    if (species === 'apple') {
      const radius = 0.50 * (1 + 0.035 * Math.max(0, 1 - (py / 0.46) ** 2));
      const shoulder = 0.46 * Math.sqrt(Math.max(0, 1 - (radial / radius) ** 2));
      const well = Math.exp(-((radial / 0.14) ** 2));
      inside = radial <= radius && py <= shoulder - 0.075 * well
        && py >= -shoulder + 0.045 * well;
    } else {
      const ry = species === 'watermelon' ? 0.41 : species === 'coconut' ? 0.44 : 0.47;
      inside = (px / 0.5) ** 2 + (py / ry) ** 2 + (pz / 0.5) ** 2 <= 1;
    }
    if (!inside) continue;
    let pigment: number;
    if (species === 'apple') {
      // Broad sun-side blush and a darker pole well, not independent pixels.
      pigment = px + pz > 0.22 ? 0xe75b3b : py > 0.26 ? 0xb72d2a : 0xcf3930;
    } else if (species === 'orange') {
      pigment = py > 0.27 ? 0xe87b1e : px + pz > 0.15 ? 0xf59b2b : 0xe48622;
    } else if (species === 'coconut') {
      pigment = py > 0.23 ? 0x9d774d : px + pz > 0.17 ? 0x84603d : 0x755235;
    } else {
      const theta = Math.atan2(pz, px);
      const stripe = Math.sin(theta * 6 + Math.sin(py * 8) * 0.15);
      pigment = stripe > 0.13 ? 0x8bbf58 : 0x286d46;
      if (py < -0.22 && px + pz > 0.45) pigment = 0xc9bb72;
    }
    volume.put(x, y, z, pigment);
  }

  if (species === 'apple') {
    volume.box(center, center, n - 3, n, center, center, 0x654328);
    volume.box(center + 1, center + 2, n - 1, n - 1, center, center, 0x519a39);
    volume.box(center + 2, center + 2, n - 1, n - 1, center - 1, center + 1, 0x64ac46);
  } else if (species === 'orange') {
    volume.box(center, center, n - 4, n - 1, center, center, 0x527e32);
    volume.box(center - 2, center + 2, n - 2, n - 2, center, center, 0x63913d);
    volume.box(center, center, n - 2, n - 2, center - 2, center + 2, 0x63913d);
  } else if (species === 'watermelon') {
    volume.box(center, center, n - 4, n - 1, center, center, 0x668843);
    volume.box(center - 1, center + 1, n - 2, n - 2, center - 1, center + 1, 0x74964b);
  } else {
    volume.box(center, center, n - 4, n - 1, center, center, 0x65482f);
  }

  const geometry = volume.geometry({
    cellSize: cell,
    origin: new THREE.Vector3(-0.5, -0.5, -0.5),
  });
  geometry.name = `VoxelFruit:${species}${n === 8 ? ':far' : ''}`;
  return geometry;
}

/** Authored silhouettes and broad colour fields for the six back-country fruit.
 * They use the same unit envelope and exposed-face surface as the orchard fruit.
 * No change to masses, nodes, collider radii, traits or save/network identities. */
function specialtyFruit(species: VoxelFruitSpecies, n: number): THREE.BufferGeometry {
  const cell = 1 / n, volume = new VoxelVolume();
  const spikes = Array.from({ length: 16 }, (_, i) => {
    const y = 1 - (i + .5) / 8, r = Math.sqrt(1 - y * y), a = i * 2.39996;
    return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  });
  for (let x = 0; x < n; x++) for (let y = -1; y < n + 2; y++) for (let z = 0; z < n; z++) {
    const px = (x + .5) * cell - .5, py = (y + .5) * cell - .5;
    const pz = (z + .5) * cell - .5, radial = Math.hypot(px, pz);
    let inside = false, pigment = 0;
    if (species === 'vinebomb') {
      const t = py + .5;
      const radius = t >= 0 && t <= 1
        ? Math.sin(Math.pow(t, .78) * Math.PI) * .5 * (1 - t * .22) + .02 : 0;
      inside = radial <= radius || (py > .35 && py < .63 && radial <= Math.max(.055, cell));
      pigment = py > .47 ? 0x5c8f38 : px + pz > .28 ? 0xad62c0 : py < -.15 ? 0x642b7c : 0x8d3fa8;
    } else if (species === 'boulderplum') {
      inside = (px / .49) ** 2 + (py / .46) ** 2 + (pz / .49) ** 2 <= 1;
      if (py > .36 && py < .59 && radial <= Math.max(.025, cell * .72)) inside = true;
      pigment = py > .46 ? 0x60422b : py > .22 ? 0x9c86b8 : px + pz > .17 ? 0x79648f : 0x514060;
    } else if (species === 'puffmelon') {
      const theta = Math.atan2(pz, px);
      const radius = .48 + .016 * Math.cos(theta * 6);
      inside = (radial / radius) ** 2 + (py / .49) ** 2 <= 1;
      if (py > .4 && py < .56 && radial <= Math.max(.06, cell * .72)) inside = true;
      pigment = py > .46 ? 0x8fae7c : Math.cos(theta * 6) < -.72 ? 0x9dbd8c : py > .15 ? 0xeef0cd : 0xc9ddb0;
    } else if (species === 'gluefruit') {
      inside = (px / .49) ** 2 + (py / .41) ** 2 + (pz / .49) ** 2 <= 1;
      if (py > .3 && py < .53 && radial <= Math.max(.025, cell * .72)) inside = true;
      if (py < -.24 && py > -.53) for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3 + .6;
        if (Math.hypot(px - Math.cos(a) * .2, pz - Math.sin(a) * .2)
          <= Math.max(cell * .72, .09 * (py + .56) / .32)) inside = true;
      }
      pigment = py > .41 ? 0x6b4b2a : py < -.28 ? 0xc7801a : px + pz + py > .28 ? 0xf8d37a : 0xe3a12c;
    } else if (species === 'banana') {
      // Five bowed fingers meet at the same stalk, with enough thickness at
      // distant detail to avoid turning the bunch into disconnected pixels.
      if (py >= -.43 && py <= .44) {
        const t = (py + .43) / .87;
        const bend = .025 + .15 * Math.sin(t * Math.PI);
        for (let i = 0; i < 5; i++) {
          const a = i * Math.PI * 2 / 5;
          if (Math.hypot(px - Math.cos(a) * bend, pz - Math.sin(a) * bend)
            <= Math.max(.063, cell * .76)) inside = true;
        }
      }
      if (py > .35 && py < .61 && radial <= Math.max(.06, cell * .76)) inside = true;
      pigment = py > .44 || py < -.32 ? 0x7a5a1c : px + pz > .1 ? 0xf7d865 : 0xeabe36;
    } else if (species === 'spikefruit') {
      const length = Math.hypot(px, py, pz);
      inside = length <= .35;
      for (const direction of spikes) {
        const along = px * direction.x + py * direction.y + pz * direction.z;
        if (along < .27 || along > .5) continue;
        const off2 = Math.max(0, length * length - along * along);
        const width = Math.max(cell * .75, (.52 - along) * .46);
        if (off2 <= width * width) inside = true;
      }
      pigment = length > .40 ? 0xd9d2a3 : length > .34 ? 0x70804a : py > .1 ? 0x377847 : 0x235231;
    }
    if (inside) volume.put(x, y, z, pigment);
  }
  const geometry = volume.geometry({ cellSize: cell, origin: new THREE.Vector3(-.5, -.5, -.5) });
  geometry.name = `VoxelFruit:${species}${n === 8 ? ':far' : ''}`;
  return geometry;
}
