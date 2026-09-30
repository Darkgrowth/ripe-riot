import * as THREE from 'three';

// The authored voxel jaw reaches about 1.7 m ahead of its stalk. Keep a
// meaningful gap from that lip during the bite without moving the player.
export const SNAPJAW_CAPTURE_VIEW_DISTANCE = 2.75;

/** Snapjaw's heading points at the throw target; show the held player that lane. */
export function snapjawFlingViewYaw(heading: number): number {
  return heading + Math.PI;
}

/** Adjust only the local camera's horizontal position while Snapjaw holds it. */
export function keepSnapjawOutsideView(cameraPosition: THREE.Vector3,
  snapjawPosition: THREE.Vector3, heading: number): void {
  const dx = cameraPosition.x - snapjawPosition.x;
  const dz = cameraPosition.z - snapjawPosition.z;
  const distance = Math.hypot(dx, dz);
  if (distance >= SNAPJAW_CAPTURE_VIEW_DISTANCE) return;
  const ux = distance > 1e-4 ? dx / distance : Math.sin(heading);
  const uz = distance > 1e-4 ? dz / distance : Math.cos(heading);
  cameraPosition.x = snapjawPosition.x + ux * SNAPJAW_CAPTURE_VIEW_DISTANCE;
  cameraPosition.z = snapjawPosition.z + uz * SNAPJAW_CAPTURE_VIEW_DISTANCE;
}
