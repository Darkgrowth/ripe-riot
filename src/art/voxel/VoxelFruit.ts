import * as THREE from 'three';
import { VoxelVolume } from './VoxelSurface';

const CACHE = new Map<string, THREE.BufferGeometry>();

/** Unit-diameter, vertex-coloured fruit for the existing species InstancedMesh. */
export function voxelFruitGeometry(species: string, resolution: 8 | 12 | 20 = 20): THREE.BufferGeometry {
  const key = `${species}:${resolution}`;
  const cached = CACHE.get(key);
  if (cached) return cached;
  if (species !== 'apple' && species !== 'orange' && species !== 'watermelon'
    && species !== 'coconut') {
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

function build(species: 'apple' | 'orange' | 'watermelon' | 'coconut', n: 8 | 12 | 20): THREE.BufferGeometry {
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
