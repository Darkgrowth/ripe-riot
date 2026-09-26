import * as THREE from 'three';
import { VoxelVolume } from './VoxelWorld.ts';

const pixel = (x: number, y: number, z: number, seed = 0) => Math.abs(x * 13 + y * 19 + z * 31 + seed * 47);

export function makeBlockWorker() {
  const v = new VoxelVolume();
  const yellow = 0xe7b63d;
  const darkYellow = 0xc99530;
  const skin = 0xbd885f;
  const brown = 0x514638;

  // Broad cube head, straight sleeves and a flat cap make this intentionally
  // different from the rounded canopy / finer voxel silhouette in study 01.
  v.box(-3, 3, 7, 13, -2, 2, yellow);
  v.box(-3, -1, 3, 7, -2, 2, darkYellow);
  v.box(1, 3, 3, 7, -2, 2, darkYellow);
  v.box(-3, -1, 0, 3, -2, 3, brown);
  v.box(1, 3, 0, 3, -2, 3, brown);
  v.box(-5, -3, 7, 13, -2, 2, yellow);
  v.box(3, 5, 7, 13, -2, 2, yellow);
  v.box(-5, -4, 6, 8, -2, 2, 0x65503a);
  v.box(4, 5, 6, 8, -2, 2, 0x65503a);
  v.box(-3, 3, 13, 19, -3, 3, skin);
  for (const cell of [...v.cells.values()]) {
    if (cell.color === yellow && pixel(cell.x, cell.y, cell.z, 2) % 7 === 0) {
      v.put(cell.x, cell.y, cell.z, 0xf2c653);
    }
  }

  // Pixel-colored front face, with eyes and brows forming part of the volume.
  for (let x = -3; x <= 3; x++) for (let y = 14; y <= 18; y++) {
    v.put(x, y, 4, [0xc89167, 0xbe865b, 0xd09b70][pixel(x, y, 4) % 3]);
  }
  v.box(-2, -1, 17, 17, 5, 5, 0x292823);
  v.box(1, 2, 17, 17, 5, 5, 0x292823);
  v.box(-2, -1, 18, 18, 5, 5, 0x6b5038);
  v.box(1, 2, 18, 18, 5, 5, 0x6b5038);
  v.box(0, 0, 15, 16, 5, 5, 0xd5a079);
  v.box(-1, 1, 14, 14, 5, 5, 0x714f3a);

  v.box(-4, 4, 19, 19, -4, 5, 0xdf772d);
  v.box(-3, 3, 20, 21, -3, 3, 0xef8b32);
  v.box(-3, 3, 20, 20, 4, 4, 0xbc5d29);
  v.box(-1, 1, 21, 21, -2, -2, 0xf7a642);

  // One-cell-thick apron and pack sit flush against the torso. No loose pieces.
  v.box(-2, 2, 8, 12, 3, 3, 0xf4cc57);
  v.box(-2, -2, 8, 12, 4, 4, 0xc18c32);
  v.box(2, 2, 8, 12, 4, 4, 0xc18c32);
  v.box(-2, 2, 8, 8, 4, 4, 0xc18c32);
  v.box(-1, 1, 9, 10, 4, 4, 0xdeaa37);
  v.box(0, 0, 11, 11, 4, 4, 0xffe39a);
  v.box(-2, 2, 9, 13, -4, -3, 0x647849);
  v.box(-2, 2, 9, 9, -5, -5, 0x4d633d);

  const mesh = v.mesh({ cellSize: .09 });
  mesh.name = 'Single batched block worker';
  return { mesh, connectedComponents: v.connectedComponents(), voxelCount: v.cells.size };
}

function blockTree(x: number, z: number, pigment: 'apple' | 'orange'): THREE.Mesh {
  const v = new VoxelVolume();
  v.box(-1, 1, 0, 11, -1, 1, 0x71513c);
  v.box(-4, 4, 10, 15, -4, 4, 0x426f38);
  v.box(-5, 5, 11, 14, -3, 3, 0x4c7e3b);
  v.box(-3, 3, 16, 17, -3, 3, 0x538744);
  for (const cell of [...v.cells.values()]) {
    if (cell.y < 10 || cell.color === 0x71513c) continue;
    v.put(cell.x, cell.y, cell.z, [0x477a3b, 0x568b42, 0x659a49, 0x3c6a35][pixel(cell.x, cell.y, cell.z) % 4]);
  }
  for (const [fx, fy, fz] of [[-5, 12, 1], [3, 13, 4], [-1, 11, 5], [5, 12, -2]]) {
    v.box(fx, fx + 1, fy, fy + 1, fz, fz + 1, pigment === 'apple' ? 0xc94735 : 0xee8b31);
  }
  const mesh = v.mesh({ cellSize: .25, origin: new THREE.Vector3(x, .5, z) });
  mesh.name = pigment === 'apple' ? 'Square apple tree' : 'Square orange tree';
  mesh.userData.connectedComponents = v.connectedComponents();
  return mesh;
}

export function makeBlockPatch() {
  const group = new THREE.Group();
  group.name = 'Small block-style orchard slice';
  const v = new VoxelVolume();
  const cellSize = .5;
  for (let x = -16; x <= 13; x++) for (let z = -12; z <= 11; z++) {
    const raised = x < -11 && z < -3;
    const topY = raised ? 1 : 0;
    const shore = x >= 9;
    const path = Math.abs(x - Math.round(Math.sin(z * .28))) <= 2 && !shore;
    const variation = pixel(x, topY, z) % 5;
    for (let y = -2; y < topY; y++) {
      v.put(x, y, z, [0x71523b, 0x805c3e, 0x684c35, 0x8b6441][pixel(x, y, z) % 4]);
    }
    const top = shore ? [0xe2c688, 0xd8b978, 0xe9d39a][variation % 3]
      : path ? [0xb9905e, 0xc49b65, 0xd0a773][variation % 3]
      : [0x5f9341, 0x6da347, 0x77ac4b, 0x4f823b][variation % 4];
    v.put(x, topY, z, top);
  }
  const terrain = v.mesh({ cellSize });
  terrain.name = 'Batched dirt, grass, path and shore';
  group.add(terrain);

  const waterVoxels = new VoxelVolume();
  for (let x = 14; x <= 20; x++) for (let z = -12; z <= 11; z++) {
    waterVoxels.put(x, -1, z, [0x279cae, 0x38b6c2, 0x4bc5cb][pixel(x, -1, z) % 3]);
  }
  const water = waterVoxels.mesh({ cellSize, roughness: .4 });
  water.name = 'Batched blue water blocks';
  water.castShadow = false;
  group.add(water);

  const treeMeshes = [blockTree(-6.4, -4.8, 'apple'), blockTree(4.2, -5.3, 'orange'), blockTree(-8.2, 3.6, 'orange')];
  treeMeshes.forEach(tree => group.add(tree));

  const crateVoxels = new VoxelVolume();
  crateVoxels.box(0, 4, 0, 4, 0, 4, 0x865b3a);
  crateVoxels.box(0, 4, 5, 5, 0, 4, 0xb9824c);
  crateVoxels.box(1, 3, 6, 6, 1, 3, 0xd7974d);
  const crate = crateVoxels.mesh({ cellSize: .19, origin: new THREE.Vector3(2.5, .5, 3) });
  crate.name = 'Batched wooden harvest crate';
  group.add(crate);

  return { group, terrain, water, treeMeshes, groundY: (_x: number, _z: number) => .5,
    waterY: -.5, voxelCount: v.cells.size + waterVoxels.cells.size };
}
