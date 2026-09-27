import * as THREE from 'three';
import { VoxelVolume } from './VoxelSurface';

let barrel: THREE.BufferGeometry | null = null;
let sack: THREE.BufferGeometry | null = null;

/** Unit barrel: broad staves, two dark hoops, and a slightly swollen middle. */
export function voxelBarrelGeometry(): THREE.BufferGeometry {
  if (barrel) return barrel;
  const volume = new VoxelVolume();
  const n = 10;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) {
    const px = (x + 0.5 - n / 2) / n;
    const pz = (z + 0.5 - n / 2) / n;
    const radius = 0.405 + 0.065 * Math.sin(Math.PI * (y + 0.5) / n);
    if (Math.hypot(px, pz) > radius) continue;
    const stave = Math.floor((Math.atan2(pz, px) + Math.PI) / (Math.PI / 4));
    const color = y === 2 || y === 7 ? 0x55575b
      : y === 9 ? 0x76502f
        : stave % 3 === 0 ? 0xa87345 : 0x98653a;
    volume.put(x, y, z, color);
  }
  barrel = volume.geometry({ cellSize: 1 / n, origin: new THREE.Vector3(-0.5, -0.5, -0.5) });
  barrel.name = 'VoxelShopBarrel';
  return barrel;
}

/** Unit sack with a filled base, quiet woven body and pinched tied neck. */
export function voxelSackGeometry(): THREE.BufferGeometry {
  if (sack) return sack;
  const volume = new VoxelVolume();
  const n = 10;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) {
    const px = (x + 0.5 - n / 2) / n;
    const pz = (z + 0.5 - n / 2) / n;
    const radius = y >= 8 ? 0.19 : y === 7 ? 0.32 : y === 0 ? 0.34
      : 0.40 + 0.045 * Math.sin(Math.PI * y / 7);
    if (Math.hypot(px, pz) > radius) continue;
    volume.put(x, y, z, y >= 8 ? 0x94683f : y < 2 ? 0x98744b : 0xad8255);
  }
  sack = volume.geometry({ cellSize: 1 / n, origin: new THREE.Vector3(-0.5, 0, -0.5) });
  sack.name = 'VoxelShopSack';
  return sack;
}
