import * as THREE from 'three';

export interface TwoBoneResult {
  joint: THREE.Vector3;
  target: THREE.Vector3;
}

/** Geometric two-link solve in the root/target/pole plane. Never returns NaNs. */
export function solveTwoBone(root: THREE.Vector3, goal: THREE.Vector3,
  pole: THREE.Vector3, upperLength: number, lowerLength: number): TwoBoneResult {
  if (!(upperLength > 0 && lowerLength > 0)) throw new Error('two-bone lengths must be positive');
  const along = goal.clone().sub(root);
  const rawDistance = along.length();
  if (rawDistance < 1e-8) along.set(0, -1, 0);
  else along.multiplyScalar(1 / rawDistance);
  const minimum = Math.abs(upperLength - lowerLength) + 1e-5;
  const maximum = upperLength + lowerLength - 1e-5;
  const distance = THREE.MathUtils.clamp(rawDistance, minimum, maximum);
  const target = root.clone().addScaledVector(along, distance);
  const bend = pole.clone().sub(root).addScaledVector(along,
    -pole.clone().sub(root).dot(along));
  if (bend.lengthSq() < 1e-10) {
    bend.set(Math.abs(along.x) < 0.8 ? 1 : 0, Math.abs(along.x) < 0.8 ? 0 : 1, 0);
    bend.addScaledVector(along, -bend.dot(along));
  }
  bend.normalize();
  const alongDistance = (upperLength * upperLength + distance * distance
    - lowerLength * lowerLength) / (2 * distance);
  const bendDistance = Math.sqrt(Math.max(0, upperLength * upperLength
    - alongDistance * alongDistance));
  const joint = root.clone().addScaledVector(along, alongDistance)
    .addScaledVector(bend, bendDistance);
  return { joint, target };
}
