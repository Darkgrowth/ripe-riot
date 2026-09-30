export type Point3 = readonly [number, number, number];

export interface ChaosImpact {
  epoch: string;
  id: number;
  kind: string;
  from: Point3;
  to: Point3;
  radius: number;
  horizontalSpeed: number;
  lift: number;
}

// These are velocity changes, not force magnitudes. Keep even malformed network
// payloads inside a recoverable launch range before a controller applies them.
const MAX_SWEEP_RADIUS = 6;
const MAX_HORIZONTAL_SPEED = 18;
const MAX_LIFT = 8;

function bounded(value: number, maximum: number): number {
  if (value === Infinity) return maximum;
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(0, value));
}

function finitePoint(point: Point3): boolean {
  return Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
}

/** Returns a bounded launch velocity when target lies inside the XZ swept capsule. */
export function impulseForChaosImpact(impact: ChaosImpact, target: Point3): Point3 | null {
  if (!finitePoint(impact.from) || !finitePoint(impact.to) || !finitePoint(target)) return null;

  const dx = impact.to[0] - impact.from[0];
  const dz = impact.to[2] - impact.from[2];
  const length = Math.hypot(dx, dz);
  if (!Number.isFinite(length)) return null;

  const forwardX = length > 0 ? dx / length : 0;
  const forwardZ = length > 0 ? dz / length : 0;
  const rawAlong = length > 0
    ? (target[0] - impact.from[0]) * forwardX + (target[2] - impact.from[2]) * forwardZ
    : 0;
  if (!Number.isFinite(rawAlong)) return null;
  const along = Math.min(length, Math.max(0, rawAlong));
  const closestX = impact.from[0] + forwardX * along;
  const closestZ = impact.from[2] + forwardZ * along;
  const distance = Math.hypot(target[0] - closestX, target[2] - closestZ);
  if (!Number.isFinite(distance) || distance > bounded(impact.radius, MAX_SWEEP_RADIUS) + 1e-9) return null;

  // A stationary impact pushes away from its center; exact overlap chooses +X.
  const radialX = target[0] - impact.from[0];
  const radialZ = target[2] - impact.from[2];
  const radialLength = Math.hypot(radialX, radialZ);
  const directionX = length > 0 ? forwardX : radialLength > 0 ? radialX / radialLength : 1;
  const directionZ = length > 0 ? forwardZ : radialLength > 0 ? radialZ / radialLength : 0;
  const speed = bounded(impact.horizontalSpeed, MAX_HORIZONTAL_SPEED);
  const result: Point3 = [directionX * speed, bounded(impact.lift, MAX_LIFT), directionZ * speed];
  return result.every(Number.isFinite) ? result : null;
}
