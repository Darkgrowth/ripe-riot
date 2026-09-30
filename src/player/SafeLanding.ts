import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld, RBody, RCollider } from '@/physics/PhysicsWorld';
import { QueryMask } from '@/physics/Layers';
import { PLAYER_RADIUS, STAND_HEIGHT } from './PlayerDimensions';

/** The same physical standing-space probe serves ragdoll recovery and throws. */
export interface SafeLandingWorld {
  physics: PhysicsWorld;
  terrain: { height(x: number, z: number): number };
  playerBody?: RBody | null;
  playerCollider?: RCollider | null;
}

export interface LandingPoint { x: number; z: number }

export interface SafeLandingRequest {
  /** Preferred aim, e.g. a teammate's position for a Snapjaw throw. */
  desired: LandingPoint;
  /** Encounter clearing centre and horizontal radius. */
  center: LandingPoint;
  maxRadius: number;
  /** A known clearing spot, still checked for dryness, slope and clearance. */
  fallback: LandingPoint;
}

const DOWN = new THREE.Vector3(0, -1, 0);
const MAX_QUERY_RADIUS = 40;
const RING_SAMPLES = 16;

/** Return a standing foot position only when dry ground and the whole capsule fit. */
export function findStandingGround(world: SafeLandingWorld, x: number, z: number): THREE.Vector3 | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const y = world.terrain.height(x, z);
  if (!Number.isFinite(y) || y < 0.2) return null;
  const hit = world.physics.raycast(
    new THREE.Vector3(x, y + 3.5, z), DOWN, 7, QueryMask.groundOnly, world.playerBody);
  if (!hit || hit.normal.y < Math.cos(THREE.MathUtils.degToRad(45))) return null;
  const foot = new THREE.Vector3(x, hit.point.y + 0.12, z);
  const shape = new RAPIER.Capsule((STAND_HEIGHT - 2 * PLAYER_RADIUS) / 2, PLAYER_RADIUS + 0.02);
  let obstructed = false;
  world.physics.world.intersectionsWithShape(
    { x, y: foot.y + STAND_HEIGHT / 2, z }, { x: 0, y: 0, z: 0, w: 1 }, shape,
    (collider) => {
      if (collider.handle === world.playerCollider?.handle) return true;
      obstructed = true;
      return false;
    }, undefined, QueryMask.solid,
  );
  return obstructed ? null : foot;
}

/**
 * Find a deterministic, bounded encounter landing. No raw aim or unchecked
 * fallback can place the player outside the clearing or in water/geometry.
 */
export function findSafeLanding(world: SafeLandingWorld, request: SafeLandingRequest): THREE.Vector3 | null {
  const { desired, center, fallback } = request;
  const radius = Math.min(request.maxRadius, MAX_QUERY_RADIUS);
  if (!Number.isFinite(desired.x + desired.z + center.x + center.z + fallback.x + fallback.z + radius)
    || radius <= 0) return null;

  const inside = (x: number, z: number): boolean =>
    Math.hypot(x - center.x, z - center.z) <= radius + 1e-6;
  const tryAt = (x: number, z: number): THREE.Vector3 | null =>
    inside(x, z) ? findStandingGround(world, x, z) : null;

  // Keep an out-of-bounds teammate aim in the same direction, at the edge.
  const dx = desired.x - center.x, dz = desired.z - center.z;
  const distance = Math.hypot(dx, dz);
  const scale = distance > radius ? radius / distance : 1;
  const aimX = center.x + dx * scale, aimZ = center.z + dz * scale;
  const direct = tryAt(aimX, aimZ);
  if (direct) return direct;

  // Inspect near the aimed point before using the authored fallback. The fixed
  // order makes solo and host decisions repeatable without any RNG state.
  for (const ring of [1.5, 3, 4.5, 6, 8]) {
    if (ring > radius * 2) break;
    for (let sample = 0; sample < RING_SAMPLES; sample++) {
      const angle = sample * Math.PI * 2 / RING_SAMPLES;
      const candidate = tryAt(aimX + Math.cos(angle) * ring, aimZ + Math.sin(angle) * ring);
      if (candidate) return candidate;
    }
  }
  return tryAt(fallback.x, fallback.z);
}
