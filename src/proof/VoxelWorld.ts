import * as THREE from 'three';

type Cell = { x: number; y: number; z: number; color: number };
type VoxelOptions = { cellSize: number; origin?: THREE.Vector3; roughness?: number };

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const color = (hex: number) => new THREE.Color(hex);

export class VoxelVolume {
  readonly cells = new Map<string, Cell>();

  put(x: number, y: number, z: number, pigment: number): void {
    this.cells.set(key(x, y, z), { x, y, z, color: pigment });
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, pigment: number): void {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      this.put(x, y, z, pigment);
    }
  }

  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, pigments: readonly number[]): void {
    for (let x = Math.ceil(cx - rx); x <= Math.floor(cx + rx); x++) {
      for (let y = Math.ceil(cy - ry); y <= Math.floor(cy + ry); y++) {
        for (let z = Math.ceil(cz - rz); z <= Math.floor(cz + rz); z++) {
          const distance = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
          if (distance <= 1.06) this.put(x, y, z, pigments[Math.abs(x * 7 + y * 13 + z * 3) % pigments.length]);
        }
      }
    }
  }

  connectedComponents(): number {
    const pending = new Set(this.cells.keys());
    let count = 0;
    while (pending.size) {
      count++;
      const first = pending.values().next().value as string;
      const stack = [first];
      pending.delete(first);
      while (stack.length) {
        const cell = this.cells.get(stack.pop()!)!;
        for (const [dx, dy, dz] of DIRECTIONS) {
          const neighbor = key(cell.x + dx, cell.y + dy, cell.z + dz);
          if (pending.delete(neighbor)) stack.push(neighbor);
        }
      }
    }
    return count;
  }

  mesh(options: VoxelOptions): THREE.Mesh {
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const s = options.cellSize;
    const o = options.origin ?? new THREE.Vector3();
    for (const voxel of this.cells.values()) {
      for (const face of FACES) {
        if (this.cells.has(key(voxel.x + face.dir[0], voxel.y + face.dir[1], voxel.z + face.dir[2]))) continue;
        const shade = face.shade;
        const c = color(voxel.color);
        const tint = [c.r * shade, c.g * shade, c.b * shade];
        for (const i of [0, 1, 2, 0, 2, 3]) {
          const corner = face.corners[i];
          positions.push(o.x + (voxel.x + corner[0]) * s, o.y + (voxel.y + corner[1]) * s, o.z + (voxel.z + corner[2]) * s);
          normals.push(...face.dir);
          colors.push(...tint);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingBox();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: options.roughness ?? 1, metalness: 0, flatShading: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

const DIRECTIONS: readonly [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const FACES = [
  { dir: [1, 0, 0], shade: .83, corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { dir: [-1, 0, 0], shade: .72, corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { dir: [0, 1, 0], shade: 1, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, -1, 0], shade: .62, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: [0, 0, 1], shade: .92, corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { dir: [0, 0, -1], shade: .77, corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
] as const;

export function makeVoxelWorker() {
  const v = new VoxelVolume();
  const suit = 0xf0ba35, suitLight = 0xffd558, suitShadow = 0xd99527;
  const boot = 0x503c35, glove = 0x5d4736, skin = 0xa76f4b, face = 0xc88b5c;
  // All features meet through shared faces. The model is authored as a single solid occupancy field.
  v.box(-3, 3, 8, 14, -2, 2, suit);
  v.box(-2, 2, 9, 13, 3, 3, suitLight);
  v.box(-3, -1, 3, 8, -2, 2, suitShadow);
  v.box(1, 3, 3, 8, -2, 2, suit);
  v.box(-3, -1, 0, 3, -2, 3, boot);
  v.box(1, 3, 0, 3, -2, 3, boot);
  v.box(-5, -3, 9, 13, -2, 2, suit);
  v.box(3, 5, 9, 13, -2, 2, suit);
  v.box(-5, -4, 7, 9, -2, 2, glove);
  v.box(4, 5, 7, 9, -2, 2, glove);
  v.box(-2, 2, 14, 18, -2, 2, skin);
  v.box(-2, 2, 15, 17, 3, 3, face);
  v.box(-1, -1, 16, 16, 4, 4, 0x302d2d);
  v.box(1, 1, 16, 16, 4, 4, 0x302d2d);
  v.box(0, 0, 15, 15, 4, 4, 0xdba072);
  v.box(-3, 3, 18, 18, -3, 4, 0xe7792f);
  v.box(-2, 2, 19, 20, -2, 2, 0xf59632);
  v.box(-2, 2, 19, 19, 3, 3, 0xde642b);
  v.box(-3, -2, 10, 13, -3, -3, 0xf7dd7d);
  v.box(2, 3, 10, 13, -3, -3, 0xf7dd7d);
  v.box(-2, 2, 10, 14, -4, -3, 0x668b60);
  v.box(-1, 1, 11, 12, -5, -5, 0x789d6a);
  v.box(-2, 2, 8, 8, 3, 3, 0x9b6935);
  v.box(-1, 1, 8, 8, 4, 4, 0xdaba53);
  v.box(0, 0, 11, 12, 4, 4, 0xffe399);
  const mesh = v.mesh({ cellSize: .096 });
  mesh.name = 'One connected voxel worker';
  return { mesh, connectedComponents: v.connectedComponents(), voxelCount: v.cells.size };
}

function makeTree(x: number, z: number, orange: boolean): THREE.Mesh {
  const v = new VoxelVolume();
  v.box(-1, 1, 0, 9, -1, 1, 0x795438);
  v.box(-1, 1, 7, 11, -4, 4, 0x795438);
  v.box(-4, 4, 7, 11, -1, 1, 0x795438);
  v.ellipsoid(0, 12, 0, 7, 5, 6, [0x4c8b3d, 0x5b9b44, 0x6aab47, 0x76ae4b]);
  for (const [fx, fy, fz] of [[-5, 11, 2], [4, 12, 3], [0, 10, 6], [3, 13, -4], [-3, 14, -3], [5, 10, -1]]) {
    v.box(fx, fx + 1, fy, fy + 1, fz, fz + 1, orange ? 0xf28b36 : 0xe05b42);
  }
  const mesh = v.mesh({ cellSize: .26, origin: new THREE.Vector3(x, .48, z) });
  mesh.name = orange ? 'Voxel orange tree' : 'Voxel apple tree';
  return mesh;
}

export function makeVoxelPatch() {
  const group = new THREE.Group();
  group.name = 'Compact voxel orchard and shore';
  const terrainVolume = new VoxelVolume();
  const cell = .48;
  for (let x = -17; x <= 12; x++) {
    for (let z = -12; z <= 11; z++) {
      const coast = x >= 8;
      const pathCenter = Math.round(1.3 * Math.sin(z * .31));
      const onPath = Math.abs(x - pathCenter) <= 2 && !coast;
      const fleck = Math.abs((x * 17 + z * 31) % 11);
      const top = coast ? [0xe6cb8b, 0xeecf94, 0xd7ba80][fleck % 3]
        : onPath ? [0xc39a63, 0xd5aa73, 0xb78b58][fleck % 3]
        : [0x69a640, 0x78b34b, 0x83b94d, 0x5e9c3b][fleck % 4];
      terrainVolume.box(x, x, -2, -1, z, z, coast ? 0xc1a878 : 0x695941);
      terrainVolume.put(x, 0, z, top);
    }
  }
  const terrain = terrainVolume.mesh({ cellSize: cell });
  terrain.name = 'One batched voxel terrain surface';
  terrain.receiveShadow = true;
  group.add(terrain);

  const waterVolume = new VoxelVolume();
  for (let x = 13; x <= 19; x++) for (let z = -12; z <= 11; z++) {
    waterVolume.put(x, -1, z, Math.abs((x * 7 + z * 11) % 9) < 2 ? 0x52d9d0 : 0x26b6bd);
  }
  const water = waterVolume.mesh({ cellSize: cell, roughness: .34 });
  water.name = 'Batched stepped turquoise water';
  water.castShadow = false;
  group.add(water);

  const treeMeshes = [makeTree(-5.1, -2.7, true), makeTree(-6.2, 3.4, false), makeTree(3.5, -4.5, true)];
  treeMeshes.forEach(tree => group.add(tree));
  // A few low harvest crates tie the character to this patch without changing the game.
  const crateVolume = new VoxelVolume();
  crateVolume.box(0, 4, 0, 3, 0, 4, 0x9a663e);
  crateVolume.box(0, 4, 4, 4, 0, 4, 0xb8824f);
  crateVolume.box(1, 3, 5, 5, 1, 3, 0xe5a44a);
  const crate = crateVolume.mesh({ cellSize: .19, origin: new THREE.Vector3(2.5, .48, 2.9) });
  crate.name = 'One voxel harvest crate';
  group.add(crate);

  return {
    group, terrain, water, treeMeshes, groundY: (_x: number, _z: number) => .48,
    waterY: -.48, voxelCount: terrainVolume.cells.size + waterVolume.cells.size,
  };
}
