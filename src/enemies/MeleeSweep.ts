export type MeleePoint = [number, number, number];
export interface MeleeSurface { id: string; center: MeleePoint; radius: number; }
export interface MeleeContact { id: string; distance: number; point: MeleePoint; direction: MeleePoint; }

const REACH = 2.9;
const HEAD_RADIUS = 0.22;
const ARC = [0, -0.15, 0.15, -0.30, 0.30];

/** Five slim, overlapping arcs across the visible right-to-left mallet sweep. */
export function probeMeleeSweep(origin: MeleePoint, forward: MeleePoint,
  surfaces: MeleeSurface[]): MeleeContact | null {
  if (![...origin, ...forward].every(Number.isFinite)) return null;
  const magnitude = Math.hypot(...forward);
  if (magnitude < 1e-5) return null;
  const [fx, fy, fz] = forward.map(v => v / magnitude);
  let nearest: MeleeContact | null = null;
  for (const angle of ARC) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const direction: MeleePoint = [fx * c + fz * s, fy, fz * c - fx * s];
    for (const surface of surfaces) {
      if (!(surface.radius > 0) || !surface.center.every(Number.isFinite)) continue;
      const dx = surface.center[0] - origin[0];
      const dy = surface.center[1] - origin[1];
      const dz = surface.center[2] - origin[2];
      const radius = surface.radius + HEAD_RADIUS;
      const squareToCenter = dx * dx + dy * dy + dz * dz;
      const along = dx * direction[0] + dy * direction[1] + dz * direction[2];
      const squareCross = squareToCenter - along * along;
      if (squareCross > radius * radius || (along < 0 && squareToCenter > radius * radius)) continue;
      const distance = squareToCenter <= radius * radius ? 0
        : along - Math.sqrt(Math.max(0, radius * radius - squareCross));
      if (distance < 0 || distance > REACH || (nearest && distance >= nearest.distance)) continue;
      nearest = { id: surface.id, distance,
        point: [origin[0] + direction[0] * distance,
          origin[1] + direction[1] * distance,
          origin[2] + direction[2] * distance], direction };
    }
  }
  return nearest;
}
