import * as THREE from 'three';

type Cell = { x: number; y: number; z: number; color: number };

export interface VoxelSurfaceOptions {
  cellSize: number;
  origin?: THREE.Vector3;
  /** Adds the plant shader's swayWeight attribute; roots remain at zero. */
  swayHeight?: number;
}

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const DIRECTIONS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0],
  [0, -1, 0], [0, 0, 1], [0, 0, -1],
] as const;

// Winding matches the outward normal on every face. Faces use two triangles
// so the output is directly usable by the game's InstancedMesh batches.
const FACES = [
  { normal: [1, 0, 0], light: 0.90, corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { normal: [-1, 0, 0], light: 0.78, corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { normal: [0, 1, 0], light: 1.00, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { normal: [0, -1, 0], light: 0.70, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { normal: [0, 0, 1], light: 0.94, corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { normal: [0, 0, -1], light: 0.83, corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
] as const;

/** An authored occupancy field; only its outward surface reaches the GPU. */
export class VoxelVolume {
  private readonly cells = new Map<string, Cell>();

  put(x: number, y: number, z: number, color: number): void {
    this.cells.set(key(x, y, z), { x, y, z, color });
  }

  remove(x: number, y: number, z: number): void {
    this.cells.delete(key(x, y, z));
  }

  /** Nearest authored cell to an attachment, in modeling-grid coordinates. */
  nearest(x: number, y: number, z: number, radius: number): [number, number, number] | null {
    let best = radius * radius + 1;
    let found: [number, number, number] | null = null;
    for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const d = dx * dx + dy * dy + dz * dz;
        if (d >= best || !this.cells.has(key(x + dx, y + dy, z + dz))) continue;
        best = d;
        found = [x + dx, y + dy, z + dz];
      }
    }
    return found;
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
    color: number): void {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      this.put(x, y, z, color);
    }
  }

  get size(): number { return this.cells.size; }

  connectedComponents(): number {
    const remaining = new Set(this.cells.keys());
    let components = 0;
    while (remaining.size) {
      components++;
      const first = remaining.values().next().value as string;
      const pending = [first];
      remaining.delete(first);
      while (pending.length) {
        const cell = this.cells.get(pending.pop()!)!;
        for (const [dx, dy, dz] of DIRECTIONS) {
          const neighbor = key(cell.x + dx, cell.y + dy, cell.z + dz);
          if (remaining.delete(neighbor)) pending.push(neighbor);
        }
      }
    }
    return components;
  }

  geometry(options: VoxelSurfaceOptions): THREE.BufferGeometry {
    if (!(options.cellSize > 0)) throw new Error('voxel cellSize must be positive');
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const sway: number[] = [];
    const origin = options.origin ?? new THREE.Vector3();
    const s = options.cellSize;
    const tint = new THREE.Color();
    for (const cell of this.cells.values()) {
      tint.setHex(cell.color, THREE.SRGBColorSpace);
      for (const face of FACES) {
        const [dx, dy, dz] = face.normal;
        if (this.cells.has(key(cell.x + dx, cell.y + dy, cell.z + dz))) continue;
        for (const i of [0, 1, 2, 0, 2, 3]) {
          const corner = face.corners[i];
          const py = origin.y + (cell.y + corner[1]) * s;
          positions.push(origin.x + (cell.x + corner[0]) * s, py,
            origin.z + (cell.z + corner[2]) * s);
          normals.push(dx, dy, dz);
          colors.push(tint.r * face.light, tint.g * face.light, tint.b * face.light);
          if (options.swayHeight !== undefined) {
            const t = THREE.MathUtils.clamp(py / Math.max(0.5, options.swayHeight), 0, 1);
            // Adjacent exposed faces can have different bark/leaf colors, but
            // shared corner positions must deform identically in the shader.
            sway.push(Math.pow(t, 1.6));
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    if (options.swayHeight !== undefined) {
      geo.setAttribute('swayWeight', new THREE.Float32BufferAttribute(sway, 1));
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geo.userData.voxelConnectedComponents = this.connectedComponents();
    geo.userData.voxelCount = this.size;
    return geo;
  }
}
