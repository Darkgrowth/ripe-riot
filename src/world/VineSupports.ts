import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld, RBody } from '@/physics/PhysicsWorld';
import { Groups } from '@/physics/Layers';
import type { Terrain } from './Terrain';
import { PropBuilder } from './PropBuilder';

/** Rooted, crooked branches supporting the existing vine origins. Fruit nodes,
 * plant RNG and harvest clearances stay intact; no floating anchor posts. */
export function buildVineSupports(anchors: THREE.Vector3[], terrain: Terrain,
  physics: PhysicsWorld, scene: THREE.Scene): () => void {
  const b = new PropBuilder(null), bodies: RBody[] = [];
  const bark = new THREE.Color(0x735c3f), young = new THREE.Color(0x58774a);
  const leaf = new THREE.Color(0x648653), up = new THREE.Vector3(0, 1, 0);
  const fixtures: Array<{ root: number[]; anchor: number[] }> = [];
  function limb(a: THREE.Vector3, z: THREE.Vector3, r0: number, r1: number, solid = true) {
    const axis = z.clone().sub(a), length = axis.length(), centre = a.clone().add(z).multiplyScalar(.5);
    const q = new THREE.Quaternion().setFromUnitVectors(up, axis.normalize());
    const geometry = new THREE.CylinderGeometry(r1, r0, length, 9);
    geometry.applyQuaternion(q); geometry.translate(centre.x, centre.y, centre.z);
    b.mesh(geometry, r0 > .1 ? bark : young);
    if (solid) {
      const body = physics.createFixed(centre, q);
      physics.attach(body, RAPIER.ColliderDesc.capsule(length / 2, Math.max(r0, r1)).setFriction(.9), Groups.prop);
      bodies.push(body);
    }
  }
  anchors.forEach((anchor, index) => {
    let root = anchor.clone(), best = -Infinity;
    // Root on the uphill side, away from the hanging fruit's pickup space.
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6 + index * .31;
      const x = anchor.x + Math.cos(angle) * 1.65, z = anchor.z + Math.sin(angle) * 1.65;
      const ground = terrain.height(x, z);
      if (ground < anchor.y - .6 && ground > best) { best = ground; root.set(x, ground - .12, z); }
    }
    if (!Number.isFinite(best)) root.set(anchor.x + 1.65, terrain.height(anchor.x + 1.65, anchor.z) - .12, anchor.z);
    const knee = root.clone().lerp(anchor, .48); knee.y = root.y + (anchor.y - root.y) * .57;
    const fork = root.clone().lerp(anchor, .72); fork.y = anchor.y + .18;
    limb(root, knee, .19, .14); limb(knee, fork, .14, .10); limb(fork, anchor, .10, .065);
    for (let j = 0; j < 3; j++) {
      const angle = index * .7 + j * 2.1;
      const tip = fork.clone().add(new THREE.Vector3(Math.cos(angle) * .7, .25 + j * .1, Math.sin(angle) * .7));
      limb(fork, tip, .055, .023, false);
      const foliage = new THREE.IcosahedronGeometry(.43, 1);
      foliage.scale(1.2, .58, .85); foliage.translate(tip.x, tip.y, tip.z);
      b.mesh(foliage, leaf);
      const toe = root.clone().add(new THREE.Vector3(Math.cos(angle) * .48, 0, Math.sin(angle) * .48));
      toe.y = terrain.height(toe.x, toe.z) - .025;
      limb(toe, root.clone().addScaledVector(up, .32), .035, .075, false);
    }
    fixtures.push({ root: root.toArray(), anchor: anchor.toArray() });
  });
  const geometry = b.finish();
  if (!geometry) return () => {};
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Rooted vine supports'; mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.supports = fixtures; scene.add(mesh);
  return () => { mesh.removeFromParent(); geometry.dispose(); material.dispose(); bodies.forEach(body => physics.removeBody(body)); };
}
