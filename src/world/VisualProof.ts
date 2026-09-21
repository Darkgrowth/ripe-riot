// Local ground/understorey palette bounds retained from the orchard review.
// Pruned tree geometry now spans Sunpatch; these bounds affect ground dressing
// only, never plant seeds, attachment points or terrain height.
export const ORCHARD_PROOF = { x: -13, z: 13, radius: 9 } as const;

export function inOrchardProof(x: number, z: number): boolean {
  return Math.hypot(x - ORCHARD_PROOF.x, z - ORCHARD_PROOF.z) < ORCHARD_PROOF.radius;
}

export function orchardProofWeight(x: number, z: number): number {
  const d = Math.hypot(x - ORCHARD_PROOF.x, z - ORCHARD_PROOF.z);
  const t = Math.max(0, Math.min(1, (d - 9) / 7));
  return 1 - t * t * (3 - 2 * t);
}
