import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const color = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

/** Landmark rind and crown, in the original 1.08r × .9r × 1.08r envelope.
 * The caller retains the existing material, transform and physics contract. */
export function buildKingMelonGeometry(radius: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const light = color(0xa9d95c), dark = color(0x173f14);
  const rind = new THREE.SphereGeometry(1, 56, 36);
  const p = rind.getAttribute('position');
  const colors = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const nx = p.getX(i), ny = p.getY(i), nz = p.getZ(i);
    const theta = Math.atan2(nz, nx);
    const latitude = Math.asin(THREE.MathUtils.clamp(ny, -1, 1));
    // Six broad bands retain the pale/dark landmark read. Slightly wandering
    // edges give the rind an organic rhythm without adding noisy speckles.
    const stripe = Math.sin(theta * 6 + Math.sin(latitude * 3.4) * 0.16
      + Math.sin(theta * 3 + latitude * 5) * 0.075);
    c.copy(light).lerp(dark, THREE.MathUtils.smoothstep(stripe, -0.35, 0.15));
    c.multiplyScalar(1 - Math.pow(Math.abs(ny), 4) * 0.22);
    colors.set([c.r, c.g, c.b], i * 3);
    // A shallow crown recess allows a stem to fit inside the established
    // envelope, rather than growing the legendary's collision silhouette.
    const crown = THREE.MathUtils.smoothstep(ny, 0.90, 1) * 0.078;
    p.setXYZ(i, nx * radius * 1.08, (ny * 0.9 - crown) * radius, nz * radius * 1.08);
  }
  rind.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  rind.computeVertexNormals();
  parts.push(rind);

  const append = (g: THREE.BufferGeometry, tint: THREE.Color) => {
    const a = g.getAttribute('position');
    const vertexColors = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) {
      // The inset stem's top is the original .9r top. The original sphere
      // keeps all horizontal extrema and the -.9r bottom exactly unchanged.
      a.setY(i, Math.min(a.getY(i), radius * 0.9));
      vertexColors.set([tint.r, tint.g, tint.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));
    parts.push(g);
  };

  // Broad, overlapping calyx lobes create one legible crown rather than a
  // collection of tiny floating leaves. All five share the rind material.
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    const leaf = new THREE.SphereGeometry(1, 8, 4);
    leaf.scale(radius * 0.115, radius * 0.018, radius * 0.045);
    leaf.rotateY(-a);
    leaf.translate(Math.cos(a) * radius * 0.08, radius * 0.824, Math.sin(a) * radius * 0.08);
    append(leaf, color(i % 2 ? 0x415a26 : 0x536c2d));
  }
  const stemPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.822, 0), new THREE.Vector3(-0.026, 0.847, 0.014),
    new THREE.Vector3(0.025, 0.877, 0.025), new THREE.Vector3(0.025, 0.9, 0.025),
  ].map(v => v.multiplyScalar(radius)));
  append(new THREE.TubeGeometry(stemPath, 10, radius * 0.022, 6, false), color(0x7a7140));
  const stemCut = new THREE.CircleGeometry(radius * 0.022, 6);
  stemCut.rotateX(-Math.PI / 2);
  stemCut.translate(radius * 0.025, radius * 0.9, radius * 0.025);
  append(stemCut, color(0xb4a16b));

  const scar = new THREE.SphereGeometry(1, 10, 4);
  scar.scale(radius * 0.11, radius * 0.016, radius * 0.11);
  scar.translate(0, -radius * 0.883, 0);
  append(scar, color(0x746737));

  // One vertex-coloured geometry, one existing material, no extra draw calls.
  const geometry = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
