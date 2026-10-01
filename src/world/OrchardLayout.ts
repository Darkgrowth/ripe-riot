/** One shared authored layout for planting, terrain, threats and safe recovery. */
export const ORCHARD_RUN = {
  crate: [-7, 27] as const,
  spawn: [-3, 31] as const,
  safeRadius: 6,
  mimic: [-23, 22] as const,
  snapjaw: [-29, 17] as const,
  loadedTree: [-23, 27] as const,
  boulderBank: [-34, 25] as const,
};

export function inOrchardSafeZone(x: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(z)
    && Math.hypot(x - ORCHARD_RUN.crate[0], z - ORCHARD_RUN.crate[1]) <= ORCHARD_RUN.safeRadius;
}
