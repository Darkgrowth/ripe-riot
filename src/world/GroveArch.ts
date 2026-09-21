import * as THREE from 'three';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import type { Terrain } from './Terrain';
import { PropBuilder, signTexture, finishWorldSign } from './PropBuilder';

const C = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

/** A weathered, open stone arch behind the existing cave grove. The harvest
 * floor stays open; render and collision share the same closed rock surface. */
export function buildGroveArch(b: PropBuilder, physics: PhysicsWorld,
  terrain: Terrain, signs: THREE.Mesh[]): void {
  const positions: number[] = [], indices: number[] = [];
  const sections = 12, cx = 60, cz = -25;
  const outerX = [9.2, 9.0, 8.8, 7.6, 6.2, 3.4, 0.5, -2.5, -5.3, -7.8, -8.9, -9.3, -9.2];
  const outerY = [0, 2.9, 5.0, 6.7, 7.0, 7.8, 8.2, 8.0, 7.1, 6.8, 5.4, 3.1, 0];
  const innerX = [5.4, 5.4, 5.0, 4.8, 3.2, 1.3, -0.7, -2.5, -4, -5.1, -5.4, -5.6, -5.6];
  const innerY = [0, 2.0, 3.0, 3.8, 4.4, 4.9, 4.7, 4.5, 4.1, 3.6, 2.8, 1.6, 0];
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i <= sections; i++) {
      for (let ring = 0; ring < 3; ring++) {
        const t = ring / 2;
        const x = cx + outerX[i] * (1 - t) + innerX[i] * t;
        const z = cz + (side ? -1.65 : 1.55) + Math.sin(i * 2.1) * 0.36
          + (ring === 1 ? (side ? -0.35 : 0.75 + Math.sin(i * 1.8) * 0.4) : 0);
        const y = i === 0 || i === sections ? terrain.height(x, z) - 0.28
          : 4.5 + outerY[i] * (1 - t) + innerY[i] * t;
        positions.push(x, y, z);
      }
    }
  }
  const back = (sections + 1) * 3;
  const quad = (a: number, bb: number, c: number, d: number) => indices.push(a, bb, c, a, c, d);
  for (let i = 0; i < sections; i++) {
    const a = i * 3, n = a + 3;
    for (let ring = 0; ring < 2; ring++) {
      quad(a + ring, n + ring, n + ring + 1, a + ring + 1);
      quad(back + a + ring, back + a + ring + 1, back + n + ring + 1, back + n + ring);
    }
    quad(a, back + a, back + n, n);
    quad(a + 2, n + 2, back + n + 2, back + a + 2);
  }
  for (let ring = 0; ring < 2; ring++) {
    quad(ring, ring + 1, back + ring + 1, back + ring);
    quad(sections * 3 + ring, back + sections * 3 + ring,
      back + sections * 3 + ring + 1, sections * 3 + ring + 1);
  }
  const vertices = new Float32Array(positions), faces = new Uint32Array(indices);
  physics.createTrimesh(vertices, faces);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(faces, 1));
  geometry.computeVertexNormals();
  const stone = C(0x69756b), pale = C(0x919a85), dark = C(0x4c5d54);
  const tint = new THREE.Color();
  b.reset().mesh(geometry, y => tint.copy(stone).lerp(
    Math.sin(y * 1.3) > 0.25 ? pale : dark, 0.28));

  // Thin mineral seams and moss shelves are embedded in the arch surface;
  // a few broad shapes keep it geological at a distance rather than tiled.
  const moss = C(0x5c7952);
  for (const [x, y, z, width] of [[52.3, 8.0, -23.3, 2.0], [67.9, 7.4, -23.25, 1.6],
    [58.6, 12.25, -24.4, 2.2]] as const) {
    b.reset().translate(x, y, z).scale(width, 0.15, 0.7).sphere(0.7, 0, moss, false);
  }
  // A practical warning at the grove entrance. The post is outside the fruit
  // cluster and has a matching small collider; the sign itself is decorative.
  const sx = 54.0, sz = -3.4, sy = terrain.height(sx, sz);
  b.reset().box(0.16, 1.85, 0.16, C(0x79573d), true, [sx, sy + 0.8, sz]);
  b.box(2.35, 0.80, 0.13, C(0x354e43), false, [sx, sy + 1.75, sz]);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.18, 0.65),
    new THREE.MeshStandardMaterial({ map: signTexture(['SPIKES & STICKY THINGS', 'BRING YOUR TOOLS'],
      { title: 'CAVE GROVE', w: 640, h: 240, bg: '#d8d4ad', fg: '#27483e', accent: '#a36c45' }),
    roughness: 1, color: 0xc7c2ac, envMapIntensity: 0.12 }));
  sign.name = 'GroveWarning';
  sign.position.set(sx, sy + 1.75, sz + 0.17);
  finishWorldSign(b, sign, 2.18, 0.65, (sign.material as THREE.MeshStandardMaterial).map as THREE.CanvasTexture,
    'cave-grove-warning');
  signs.push(sign);
  b.reset();
}
