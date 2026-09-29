import * as THREE from 'three';
import type { PropBuilder } from './PropBuilder';
import type { Terrain } from './Terrain';

/** Open uphill. The receiving apron is inside the original extraction volume;
 * these visible timbers stop the real sphere rather than changing that volume. */
export const MELON_RECEIVER_RAIL = [[-2, -47], [3, -39], [22, -39], [27, -49]] as const;

export function buildMelonReceiver(b: PropBuilder, terrain: Terrain): void {
  const wood = new THREE.Color().setHex(0xb18453, THREE.SRGBColorSpace);
  const endgrain = new THREE.Color().setHex(0xd7ab71, THREE.SRGBColorSpace);
  const iron = new THREE.Color().setHex(0x475d54, THREE.SRGBColorSpace);
  const points: THREE.Vector3[] = [];
  for (let i = 1; i < MELON_RECEIVER_RAIL.length; i++) {
    const a = MELON_RECEIVER_RAIL[i - 1], c = MELON_RECEIVER_RAIL[i];
    const spans = Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 3.2);
    for (let n = i === 1 ? 0 : 1; n <= spans; n++) {
      const t = n / spans, x = a[0] + (c[0] - a[0]) * t, z = a[1] + (c[1] - a[1]) * t;
      points.push(new THREE.Vector3(x, terrain.height(x, z), z));
    }
  }
  for (const p of points) {
    b.reset().translate(p.x, p.y, p.z);
    b.roundedBox(.82, 8.25, .82, .055, wood, true, [0, 3.975, 0]);
    b.roundedBox(.98, .22, .98, .035, endgrain, false, [0, 8.02, 0]);
    for (const height of [2.55, 6.55])
      b.roundedBox(.89, .18, .89, .025, iron, false, [0, height, 0]);
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], c = points[i], delta = c.clone().sub(a);
    const middle = a.clone().add(c).multiplyScalar(.5);
    for (const height of [3.1, 5.1, 7.1]) {
      b.reset().translate(middle.x, middle.y + height, middle.z)
        .rotateY(-Math.atan2(delta.z, delta.x))
        .rotateZ(Math.atan2(delta.y, Math.hypot(delta.x, delta.z)));
      // Every rail has matching collision. The 2.6 m space beneath it lets
      // players follow the existing ravine exit through the larger openings.
      b.roundedBox(delta.length() + .25, 1.0, .72, .045, wood, true);
      b.box(delta.length() - .12, .11, .03, endgrain, false, [0, .27, -.375]);
    }
  }
  b.reset();
}
