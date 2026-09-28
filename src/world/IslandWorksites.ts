import * as THREE from 'three';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import type { Terrain } from './Terrain';
import { PropBuilder, signTexture, finishWorldSign } from './PropBuilder';
import type { VisualMode } from '@/art/voxel/VisualMode';
import { voxelBarrelGeometry } from '@/art/voxel/VoxelShop';
import { VoxelVolume } from '@/art/voxel/VoxelSurface';

const color = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
const WOOD = color(0x886043), EDGE = color(0x513d31), CUT = color(0xb78b57);
const TEAL = color(0x326d65), CLOTH = color(0xd8c790), CORAL = color(0xb45d41);
const ROPE = color(0x9e865a), METAL = color(0x47524b);

/** Continuous, terrain-rooted supports for the four existing vine endpoints.
 * The same indexed surface is used for rendering and rope/player collision. */
export function buildAnchorCrags(b: PropBuilder, physics: PhysicsWorld,
  terrain: Terrain, anchors: THREE.Vector3[]): void {
  const stone = color(0x777e69), band = color(0xa09c80);
  const lower = color(0x686f5b), warm = color(0x898772), crown = color(0x858970);
  anchors.forEach((anchor, n) => {
    const ground = terrain.height(anchor.x, anchor.z);
    const height = anchor.y - ground + 0.6;
    const sides = 14;
    const rings = [0, 0.12, 0.36, 0.39, 0.66, 0.69, 0.91, 1];
    const radii = [4.1, 3.7, 3.05, 2.55, 2.1, 1.7, 1.3, 0.85];
    const vertices: number[] = [], indices: number[] = [];
    rings.forEach((t, r) => {
      for (let i = 0; i < sides; i++) {
        const angle = i / sides * Math.PI * 2 + n * 0.63;
        const radius = radii[r] * (1 + Math.sin(i * 2.4 + n) * 0.13);
        const x = anchor.x + Math.cos(angle) * radius + Math.sin(t * Math.PI) * 0.6;
        const z = anchor.z + Math.sin(angle) * radius;
        const y = r === 0 ? terrain.height(x, z) - 0.35
          : ground + t * height + Math.sin(i * 1.8 + n) * Math.sin(t * Math.PI) * 0.38;
        vertices.push(x, y, z);
        if (r < rings.length - 1) {
          const a = r * sides + i, next = r * sides + (i + 1) % sides;
          indices.push(a, a + sides, next, next, a + sides, next + sides);
        }
      }
    });
    const cap = vertices.length / 3;
    vertices.push(anchor.x, anchor.y + 0.85, anchor.z);
    for (let i = 0; i < sides; i++) indices.push(cap,
      (rings.length - 1) * sides + (i + 1) % sides, (rings.length - 1) * sides + i);
    const positions = new Float32Array(vertices), faces = new Uint32Array(indices);
    physics.createTrimesh(positions, faces);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(faces, 1));
    geometry.computeVertexNormals();
    b.reset().mesh(geometry, y => {
      const t = (y - ground) / height;
      // Broad strata follow the existing ledges, retaining the exact surface
      // used by ropes. Quiet value changes read as geology from the approach.
      if (t < 0.12) return lower;
      if (t < 0.36) return warm;
      if (t < 0.405) return band;
      if (t < 0.66) return stone;
      if (t < 0.705) return band;
      return crown;
    });
  });
  b.reset();
}

/** Small, authored workplaces off the harvesting route. All detail joins the
 * island's existing prop batch; only readable sign faces add meshes. */
export function buildIslandWorksites(b: PropBuilder, terrain: Terrain,
  signs: THREE.Mesh[], visualMode: VisualMode = 'baseline'): void {
  const voxel = visualMode === 'voxel';
  const post = (x: number, z: number, top: number, width = 0.22) => {
    const bottom = terrain.height(x, z) - 0.15;
    b.reset();
    if (voxel) {
      b.roundedBox(width, top - bottom, width, 0.035, WOOD, true, [x, (top + bottom) / 2, z]);
      b.roundedBox(width + 0.10, 0.20, width + 0.10, 0.035, EDGE, false, [x, top - 0.25, z]);
      b.roundedBox(width + 0.08, 0.24, width + 0.08, 0.035, CUT, false,
        [x, terrain.height(x, z) + 0.10, z]);
    } else {
      b.box(width, top - bottom, width, WOOD, true, [x, (top + bottom) / 2, z]);
      b.box(width + 0.045, 0.12, width + 0.045, EDGE, false, [x, top - 0.25, z]);
    }
  };
  const sign = (x: number, y: number, z: number, width: number, height: number,
    title: string, lines: string[]) => {
    b.reset();
    if (voxel) {
      b.roundedBox(width + 0.20, height + 0.18, 0.14, 0.045, WOOD, false, [x, y, z]);
      for (const side of [-1, 1])
        b.roundedBox(0.12, height + 0.24, 0.17, 0.035, EDGE, false,
          [x + side * (width / 2 + 0.08), y, z]);
    } else b.box(width + 0.18, height + 0.16, 0.13, EDGE, false, [x, y, z]);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({ map: signTexture(lines, { title, w: 768, h: 256,
        bg: '#e5d6aa', fg: '#23443b', accent: '#a85338' }), roughness: 1,
        color: 0xb9b0a2, envMapIntensity: 0.12 }));
    // The rear rails are .12 m deep; put the legend in front of their full
    // front extent, with the new blank backing between text and supports.
    mesh.position.set(x, y, z + 0.15);
    finishWorldSign(b, mesh, width, height, (mesh.material as THREE.MeshStandardMaterial).map as THREE.CanvasTexture,
      `worksite-${title}`);
    mesh.name = `WorksiteSign:${title}`;
    signs.push(mesh);
  };
  const coil = (x: number, y: number, z: number, radius: number) => {
    b.reset().translate(x, y, z);
    for (let i = 0; i < 3; i++) {
      const g = new THREE.TorusGeometry(radius - i * 0.065, 0.033, 4, 18);
      g.rotateX(Math.PI / 2); g.translate(0, i * 0.03, 0);
      b.mesh(g, ROPE);
    }
  };
  const barrel = (x: number, y: number, z: number) => {
    b.reset().translate(x, y, z);
    if (voxel) {
      b.cylinderCollider(0.44, 1.0, [0, 0.5, 0]);
      const staves = voxelBarrelGeometry().clone();
      staves.scale(1.12, 1, 1.12); staves.translate(0, 0.5, 0);
      b.meshColored(staves);
    } else {
      b.cylinder(0.42, 0.44, 1.0, 10, CUT, true, [0, 0.5, 0]);
      for (const h of [0.16, 0.81]) b.cylinder(0.451, 0.451, 0.065, 10, METAL, false, [0, h, 0]);
      b.cylinder(0.39, 0.39, 0.055, 10, WOOD, false, [0, 1.015, 0]);
    }
  };

  // HILL FARM: broad striped awning, sorting bench and rope supplies. The
  // opening faces the approach; the established melon vines remain outside.
  const hx = -16, hz = -25, hy = terrain.height(hx, hz);
  for (const x of [-2.9, 2.9]) for (const z of [-1.7, 1.7]) post(hx + x, hz + z, hy + 3.4);
  b.reset().translate(hx, hy, hz);
  b.recordProp('hill-farm-workstation', { kind: 'workstation', focus: [0, 1.2, -0.55],
    note: 'Sorting bench legs follow terrain; empty trays stay inside bench footprint.',
    style: voxel ? 'rounded-voxel-frame-and-canvas' : 'baseline' });
  for (const z of [-1.7, 1.7]) b.box(6.2, 0.19, 0.22, EDGE, false, [0, 3.18, z]);
  b.box(5.8, 0.13, 0.12, WOOD, false, [0, 2.62, -1.78]);
  for (const x of [-1, 1]) {
    b.push().translate(x * 2.55, 2.86, 1.7).rotateZ(x * 0.7);
    b.box(0.13, 0.9, 0.13, WOOD, false); b.pop();
  }
  // In voxel mode the awning is five broad upholstered panels, with an actual
  // ridge, visible rafter ends and a deep front hem. The original ten thin
  // strips remain in baseline mode.
  if (voxel) {
    b.roundedBox(6.08, 0.20, 0.30, 0.055, CUT, false, [0, 3.68, 0]);
    for (const x of [-2.72, -1.36, 0, 1.36, 2.72]) {
      b.roundedBox(0.18, 0.18, 3.95, 0.04, WOOD, false, [x, 3.27, 0]);
      b.roundedBox(0.27, 0.18, 0.22, 0.04, EDGE, false, [x, 3.30, 1.81]);
    }
    for (let i = 0; i < 5; i++) {
      const x = -2.43 + i * 1.215;
      const tint = i % 2 ? TEAL : CLOTH;
      for (const side of [-1, 1]) {
        b.push().translate(x, 3.48, side * 0.96).rotateX(side * 0.27);
        b.roundedBox(1.20, 0.13, 2.09, 0.055, tint, false);
        b.pop();
      }
      b.roundedBox(1.18, 0.34, 0.12, 0.055, tint, false, [x, 3.13, 1.97]);
      b.roundedBox(1.18, 0.055, 0.13, 0.025, EDGE, false, [x, 2.95, 1.99]);
    }
    for (const side of [-1, 1]) {
      b.push().translate(side * 2.57, 2.83, -1.70).rotateZ(-side * 0.60);
      b.roundedBox(0.19, 1.02, 0.18, 0.04, CUT, false);
      b.pop();
    }
  } else for (let i = 0; i < 10; i++) {
    for (const side of [-1, 1]) {
      b.push().translate(-2.925 + i * 0.65, 3.52, side * 0.96).rotateX(side * 0.2);
      b.box(0.648, 0.07, 1.98, i % 2 ? TEAL : CLOTH, false);
      b.pop();
    }
    b.box(0.648, 0.26 + (i % 2) * 0.07, 0.055, i % 2 ? TEAL : CLOTH, false,
      [-2.925 + i * 0.65, 3.18, 1.96]);
  }
  // Sorting table: a single matching collider underneath the slatted top.
  for (const x of [-1.85, 1.85]) for (const z of [-0.9, -0.18]) {
    const bottom = terrain.height(hx + x, hz + z) - hy - 0.12;
    if (voxel) b.roundedBox(0.15, 1.0 - bottom, 0.15, 0.035, EDGE, true,
      [x, (1.0 + bottom) / 2, z]);
    else b.box(0.15, 1.0 - bottom, 0.15, EDGE, true, [x, (1.0 + bottom) / 2, z]);
  }
  b.collider(4.3, 0.16, 1.25, [0, 1.0, -0.55]);
  for (let i = 0; i < 6; i++) {
    const at: [number, number, number] = [0, 1.01, -1.07 + i * 0.208];
    if (voxel) b.roundedBox(4.3, 0.13, 0.195, 0.035, i % 2 ? WOOD : CUT, false, at);
    else b.box(4.3, 0.13, 0.195, i % 2 ? WOOD : CUT, false, at);
  }
  // Empty sorting trays are recognisably containers, never fake harvest fruit.
  for (const x of [-1.35, 0.05]) {
    if (voxel) {
      b.roundedBox(1.12, 0.07, 0.73, 0.03, CUT, false, [x, 1.10, -0.57]);
      for (const z of [-0.94, -0.2])
        b.roundedBox(1.16, 0.24, 0.085, 0.035, TEAL, false, [x, 1.22, z]);
      for (const side of [-1, 1]) {
        b.roundedBox(0.085, 0.24, 0.76, 0.035, TEAL, false,
          [x + side * 0.55, 1.22, -0.57]);
        b.roundedBox(0.11, 0.07, 0.24, 0.025, EDGE, false,
          [x + side * 0.56, 1.35, -0.57]);
      }
    } else {
      b.box(1.1, 0.05, 0.7, CUT, false, [x, 1.10, -0.57]);
      for (const z of [-0.94, -0.2]) b.box(1.15, 0.24, 0.055, TEAL, false, [x, 1.22, z]);
      for (const side of [-1, 1]) b.box(0.055, 0.24, 0.75, TEAL, false, [x + side * 0.55, 1.22, -0.57]);
    }
  }
  // A few long worn edges and small nail heads give the table a handled
  // surface. Keep its open front and the original collider exactly as built.
  for (const [x, z, length] of [[-1.45, -0.09, 0.56], [0.54, -0.09, 0.83],
    [1.22, -0.98, 0.44], [-0.4, -1.16, 0.7]]) {
    b.box(length, 0.009, 0.018, CLOTH, false, [x, 1.08, z]);
  }
  for (const x of [-2.02, 2.02]) for (const z of [-0.98, -0.36]) {
    b.cylinder(0.022, 0.022, 0.012, 6, METAL, false, [x, 1.082, z]);
  }
  // Spare slatted trays under the back of the sorting bench: storage stays
  // inside the existing table footprint and does not become a new obstacle.
  for (const x of [-1.74, -0.76]) for (const z of [-0.85, -0.37]) {
    const bottom = terrain.height(hx + x, hz + z) - hy - 0.06;
    b.box(0.1, 0.3175 - bottom, 0.1, EDGE, false, [x, (0.3175 + bottom) / 2, z]);
  }
  for (const layer of [0, 1]) {
    const y = 0.34 + layer * 0.235;
    b.box(1.15, 0.045, 0.65, WOOD, false, [-1.25, y, -0.61]);
    for (const z of [-0.94, -0.28]) b.box(1.18, 0.19, 0.045, CUT, false, [-1.25, y + 0.1175, z]);
    for (const x of [-1.82, -0.68]) b.box(0.045, 0.19, 0.65, CUT, false, [x, y + 0.1175, -0.61]);
  }
  // Hanging rope and a long harvesting hook flank the sign. Their dark,
  // simple outlines survive the normal camera without becoming clutter.
  for (let i = 0; i < 3; i++) {
    const loop = new THREE.TorusGeometry(0.24 - i * 0.036, 0.024, 4, 16);
    loop.scale(1, 1.5, 1); loop.translate(-2.25, 2.2 - i * 0.012, -1.69);
    b.mesh(loop, ROPE);
  }
  b.box(0.065, 1.14, 0.065, CUT, false, [2.22, 2.05, -1.64]);
  b.box(0.075, 0.075, 0.17, METAL, false, [2.22, 2.62, -1.685]);
  const hook = new THREE.TorusGeometry(0.15, 0.034, 5, 12, Math.PI * 1.42);
  hook.rotateZ(-0.9); hook.translate(2.22, 2.59, -1.64); b.mesh(hook, METAL);
  barrel(hx + 2.15, terrain.height(hx + 2.15, hz - 0.6), hz - 0.6);
  coil(hx + 1.25, hy + 1.11, hz - 0.5, 0.35);
  sign(hx, hy + 2.62, hz - 1.73, 3.5, 0.92, 'HILL FARM', ['BIG FRUIT. SMALL MARGINS.']);

  // PALM BEACH: a low, airy striped shade, backless bench and drying rack.
  const bx = -54, bz = 57, by = Math.max(...[-2, 2].flatMap(x => [-1.2, 1.2]
    .map(z => terrain.height(bx + x, bz + z))));
  for (const x of [-2, 2]) for (const z of [-1.2, 1.2]) post(bx + x, bz + z, by + 2.7);
  b.reset().translate(bx, by, bz);
  b.recordProp('palm-beach-rest-stop', { kind: 'workstation', focus: [0, 0.7, -0.7],
    note: 'Extended bench feet root into actual sand height.' });
  if (voxel) {
    for (let i = 0; i < 4; i++) {
      const x = -1.8 + i * 1.2;
      b.push().translate(x, 2.75 + x * x * 0.025, 0).rotateZ(x * 0.05);
      b.roundedBox(1.19, 0.12, 3.05, 0.045, i % 2 ? CORAL : CLOTH, false);
      b.roundedBox(1.15, 0.27, 0.12, 0.045, i % 2 ? CORAL : CLOTH,
        false, [0, -0.13, 1.5]);
      b.pop();
    }
    for (const x of [-1.95, 0, 1.95])
      b.roundedBox(0.15, 0.16, 3.15, 0.035, WOOD, false, [x, 2.62, 0]);
  } else for (let i = 0; i < 8; i++) {
    const x = -2.1 + i * 0.6;
    b.push().translate(x, 2.75 + x * x * 0.025, 0).rotateZ(x * 0.05);
    b.box(0.61, 0.045, 3.05, i % 2 ? CORAL : CLOTH, false);
    b.box(0.605, 0.18, 0.06, i % 2 ? CORAL : CLOTH, false, [0, -0.105, 1.5]);
    b.pop();
  }
  b.box(4.5, 0.15, 0.18, WOOD, false, [0, 2.64, 1.2]);
  b.box(4.0, 0.13, 0.12, WOOD, false, [0, 1.84, -1.3]);
  b.box(3.4, 0.18, 0.63, CUT, true, [0, 0.52, -0.7]);
  for (const x of [-1.3, 1.3]) b.box(0.2, 0.6, 0.42, EDGE, true, [x, 0.19, -0.7]);
  // Sun-worn seat edges and a folded workcloth belong to the rest stop.
  for (const [x, length] of [[-1.05, 0.72], [0.16, 0.43], [1.08, 0.39]]) {
    b.box(length, 0.008, 0.018, CLOTH, false, [x, 0.615, -0.414]);
  }
  b.box(0.63, 0.055, 0.42, TEAL, false, [-0.83, 0.638, -0.71]);
  b.box(0.57, 0.04, 0.4, CLOTH, false, [-0.80, 0.682, -0.72]);
  b.box(0.11, 0.045, 0.405, CORAL, false, [-0.64, 0.704, -0.72]);
  // Extended feet root the bench into the gently sloping sand.
  for (const x of [-1.3, 1.3]) post(bx + x, bz - 0.7, by + 0.4, 0.19);
  coil(bx + 1.2, by + 0.64, bz - 0.7, 0.32);
  sign(bx, by + 1.84, bz - 1.25, 2.8, 0.68, 'PALM BEACH', ['TAKE FIVE. MIND THE COCONUTS.']);
  const rackX = bx + 3.1, rackZ = bz - 1.3, rackY = terrain.height(rackX, rackZ);
  for (const x of [-0.65, 0.65]) post(rackX + x, rackZ, rackY + 2.15, 0.14);
  b.reset().translate(rackX, rackY, rackZ);
  b.recordProp('palm-beach-net-rack', { kind: 'workstation', focus: [0, 1.3, 0] });
  if (voxel) {
    b.roundedBox(1.65, 0.16, 0.18, 0.04, WOOD, false, [0, 2.07, 0]);
    b.roundedBox(1.44, 0.13, 0.16, 0.035, CUT, false, [0, 0.68, 0]);
    // Six broad lines in each direction retain a net silhouette without a
    // fine wire grid that disappears at ordinary camera distance.
    for (let i = 0; i < 6; i++) {
      b.box(0.04, 1.28, 0.04, ROPE, false, [-0.55 + i * 0.22, 1.36, 0]);
      b.box(1.25, 0.04, 0.04, ROPE, false, [0, 0.81 + i * 0.21, 0]);
    }
    for (const x of [-0.66, 0.66])
      b.roundedBox(0.18, 1.43, 0.16, 0.04, WOOD, false, [x, 1.37, 0]);
  } else {
    b.box(1.65, 0.1, 0.12, WOOD, false, [0, 2.07, 0]);
    for (let i = 0; i < 8; i++) b.box(0.018, 1.2, 0.018, ROPE, false, [-0.61 + i * 0.175, 1.39, 0]);
    for (let i = 0; i < 8; i++) b.box(1.25, 0.018, 0.018, ROPE, false, [0, 0.8 + i * 0.165, 0]);
  }
  // Net binding and wooden floats tell the drying rack's story at a glance.
  for (const x of [-0.56, -0.19, 0.19, 0.56]) {
    b.box(0.075, 0.12, 0.07, CUT, false, [x, 2.05, 0.018]);
    b.push().translate(x, 1.9, 0).rotateZ(Math.PI / 2);
    b.cylinder(0.055, 0.055, 0.13, 6, CORAL, false); b.pop();
  }

  // RAVINE APPROACH: low staging supplies off the extraction corridor.
  const rx = -5, rz = -40, ry = terrain.height(rx, rz);
  for (const x of [-1.55, 1.55]) post(rx + x, rz, ry + 2.35);
  sign(rx, ry + 1.85, rz, 3.1, 1.05, 'THE KING MELON', ['TETHER. CUT. HAUL.', 'BRING ROPE. BRING FRIENDS.']);
  const sy = terrain.height(rx - 2.6, rz + 0.6);
  barrel(rx - 2.6, sy, rz + 0.6);
  coil(rx - 2.6, sy + 1.07, rz + 0.6, 0.38);

  // Oversized harvest reel, west of the staging board and barrel. It stays
  // south of the hill track and outside the melon-to-dock extraction line.
  // This is stored equipment, not an interactable winch or an extra anchor.
  const wx = rx + 3.5, wz = rz + 2.5;
  const wy = Math.max(...[-0.8, 0.8].flatMap(x => [-0.86, 0.86]
    .map(z => terrain.height(wx + x, wz + z))));
  b.reset().translate(wx, wy, wz);
  b.recordProp('ravine-harvest-reel', { kind: 'workstation', focus: [0, 1.38, 0],
    note: 'Existing solid feet extend to terrain; reel and handles unchanged.',
    style: voxel ? 'stepped-voxel-rims' : 'baseline' });
  for (const z of [-0.86, 0.86]) {
    if (voxel) {
      b.roundedBox(1.75, 0.22, 0.32, 0.055, EDGE, true, [0, 0.11, z]);
      b.roundedBox(0.28, 1.40, 0.28, 0.055, WOOD, true, [0, 0.79, z]);
    } else {
      b.box(1.75, 0.22, 0.32, EDGE, true, [0, 0.11, z]);
      b.box(0.28, 1.40, 0.28, WOOD, true, [0, 0.79, z]);
    }
    for (const side of [-1, 1]) {
      b.push().translate(side * 0.33, 0.69, z).rotateZ(side * 0.52);
      if (voxel) b.roundedBox(0.17, 1.25, 0.20, 0.04, CUT, true);
      else b.box(0.17, 1.25, 0.20, CUT, true);
      b.pop();
    }
    // Feet extend to their actual ground height on this sloped shoulder.
    for (const x of [-0.7, 0.7]) {
      const bottom = terrain.height(wx + x, wz + z) - wy - 0.12;
      if (voxel) b.roundedBox(0.27, 0.13 - bottom, 0.30, 0.04, EDGE,
        true, [x, (bottom + 0.13) / 2, z]);
      else b.box(0.27, 0.13 - bottom, 0.30, EDGE, true, [x, (bottom + 0.13) / 2, z]);
    }
  }
  // Drum axis runs front-to-back, so the approach sees a clear circular reel.
  b.push().translate(0, 1.38, 0).rotateX(Math.PI / 2);
  if (voxel) b.cylinderCollider(0.76, 1.08);
  else b.cylinder(0.76, 0.76, 1.08, 12, ROPE, true);
  b.cylinder(0.14, 0.14, 2.02, 8, METAL, true);
  for (const side of [-1, 1]) {
    if (voxel) b.cylinderCollider(1.02, 0.14, [0, side * 0.61, 0]);
    else b.cylinder(1.02, 1.02, 0.14, 12, CUT, true, [0, side * 0.61, 0]);
  }
  b.pop();
  if (voxel) {
    const drum = voxelHarvestDrumGeometry();
    drum.translate(0, 1.38, 0);
    b.meshColored(drum);
  }
  for (let i = 0; i < 8; i++) {
    const winding = new THREE.TorusGeometry(0.77, voxel ? 0.075 : 0.063,
      voxel ? 3 : 4, voxel ? 12 : 16);
    winding.translate(0, 1.38, -0.49 + i * 0.14);
    b.mesh(winding, i % 2 ? ROPE : CLOTH);
  }
  for (const side of [-1, 1]) {
    if (voxel) {
      const rim = voxelReelRimGeometry();
      rim.translate(0, 1.38, side * 0.687);
      b.meshColored(rim);
      b.roundedBox(1.50, 0.18, 0.05, 0.02, WOOD,
        false, [0, 1.38, side * 0.83]);
      b.roundedBox(0.18, 1.50, 0.05, 0.02, WOOD,
        false, [0, 1.38, side * 0.83]);
    } else {
      const rim = new THREE.TorusGeometry(0.91, 0.045, 4, 12);
      rim.translate(0, 1.38, side * 0.687);
      b.mesh(rim, TEAL);
      b.box(1.50, 0.15, 0.035, WOOD, false, [0, 1.38, side * 0.69]);
      b.box(0.15, 1.50, 0.035, WOOD, false, [0, 1.38, side * 0.69]);
    }
  }
  // Short offset crank with a thick wooden handle, sharing the reel's batch.
  b.box(0.55, 0.13, 0.13, METAL, true, [0.23, 1.38, 1.02]);
  b.push().translate(0.48, 1.38, 1.18).rotateX(Math.PI / 2);
  b.cylinder(0.10, 0.10, 0.32, 8, WOOD, true);
  b.pop();
  b.reset();
}

/** A coarse, connected pair of rim layers for the stored harvest reel. */
export function voxelReelRimGeometry(): THREE.BufferGeometry {
  const volume = new VoxelVolume();
  const cell = 0.14;
  for (let x = -7; x <= 7; x++) for (let y = -7; y <= 7; y++) {
    const r = Math.hypot(x * cell, y * cell);
    if (r < 0.70 || r > 1.04) continue;
    for (let z = 0; z < 2; z++)
      volume.put(x, y, z, (x + y) % 4 === 0 ? 0x3b7a70 : 0x2f6d64);
  }
  const geometry = volume.geometry({ cellSize: cell,
    origin: new THREE.Vector3(-cell / 2, -cell / 2, -cell) });
  geometry.name = 'VoxelHarvestReelRim';
  return geometry;
}

/** Coarse continuous rope drum inside the two flanges. */
export function voxelHarvestDrumGeometry(): THREE.BufferGeometry {
  const volume = new VoxelVolume();
  const cell = 0.14;
  for (let z = -4; z <= 3; z++) for (let x = -6; x <= 6; x++) {
    for (let y = -6; y <= 6; y++) {
      if (Math.hypot(x * cell, y * cell) > 0.80) continue;
      volume.put(x, y, z, z % 3 === 0 ? 0xb09a70 : 0x9e865a);
    }
  }
  const geometry = volume.geometry({ cellSize: cell,
    origin: new THREE.Vector3(-cell / 2, -cell / 2, 0) });
  geometry.name = 'VoxelHarvestDrum';
  return geometry;
}

