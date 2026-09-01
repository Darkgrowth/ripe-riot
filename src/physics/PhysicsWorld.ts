import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FIXED_DT } from '@/core/Time';
import { Groups, QueryMask } from './Layers';

export type RBody = RAPIER.RigidBody;
export type RCollider = RAPIER.Collider;

/** Anything that owns a physics body registers itself so contacts can be routed. */
export interface PhysicsOwner {
  readonly id: number;
  readonly kind: string;
  onContact?(other: PhysicsOwner | null, impulse: number, point: THREE.Vector3, normal: THREE.Vector3): void;
  onSensorEnter?(other: PhysicsOwner | null): void;
  onSensorExit?(other: PhysicsOwner | null): void;
}

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  collider: RCollider;
  body: RBody | null;
  owner: PhysicsOwner | null;
}

const _v = new THREE.Vector3();

export class PhysicsWorld {
  world!: RAPIER.World;
  private events!: RAPIER.EventQueue;
  private ownerByCollider = new Map<number, PhysicsOwner>();
  private ownerByBody = new Map<number, PhysicsOwner>();
  private ray!: RAPIER.Ray;
  gravity = -22;

  static async load(): Promise<void> { await RAPIER.init(); }

  init(): void {
    this.world = new RAPIER.World({ x: 0, y: this.gravity, z: 0 });
    this.world.timestep = FIXED_DT;
    // A slightly relaxed solver: this game wants comedy, not stacking accuracy.
    this.world.numSolverIterations = 6;
    this.events = new RAPIER.EventQueue(true);
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  get raw(): typeof RAPIER { return RAPIER; }

  step(): void {
    this.world.step(this.events);
    this.drainEvents();
  }

  private drainEvents(): void {
    this.events.drainCollisionEvents((h1, h2, started) => {
      const c1 = this.world.getCollider(h1);
      const c2 = this.world.getCollider(h2);
      if (!c1 || !c2) return;
      const o1 = this.ownerByCollider.get(h1) ?? null;
      const o2 = this.ownerByCollider.get(h2) ?? null;
      if (c1.isSensor()) {
        if (started) o1?.onSensorEnter?.(o2); else o1?.onSensorExit?.(o2);
      }
      if (c2.isSensor()) {
        if (started) o2?.onSensorEnter?.(o1); else o2?.onSensorExit?.(o1);
      }
    });
    this.events.drainContactForceEvents((ev) => {
      const h1 = ev.collider1();
      const h2 = ev.collider2();
      const o1 = this.ownerByCollider.get(h1) ?? null;
      const o2 = this.ownerByCollider.get(h2) ?? null;
      if (!o1 && !o2) return;
      const impulse = ev.totalForceMagnitude() * FIXED_DT; // force -> impulse
      const c1 = this.world.getCollider(h1);
      const p = c1 ? c1.translation() : { x: 0, y: 0, z: 0 };
      const n = ev.maxForceDirection();
      const point = new THREE.Vector3(p.x, p.y, p.z);
      const normal = new THREE.Vector3(n.x, n.y, n.z);
      o1?.onContact?.(o2, impulse, point, normal);
      o2?.onContact?.(o1, impulse, point, normal);
    });
  }

  // ---- registration -------------------------------------------------------
  register(owner: PhysicsOwner, body: RBody | null, colliders: RCollider[]): void {
    if (body) this.ownerByBody.set(body.handle, owner);
    for (const c of colliders) this.ownerByCollider.set(c.handle, owner);
  }

  unregister(body: RBody | null, colliders: RCollider[]): void {
    if (body) this.ownerByBody.delete(body.handle);
    for (const c of colliders) this.ownerByCollider.delete(c.handle);
  }

  ownerOfBody(b: RBody | null): PhysicsOwner | null {
    return b ? this.ownerByBody.get(b.handle) ?? null : null;
  }

  removeBody(body: RBody | null, colliders: RCollider[] = []): void {
    if (!body) return;
    this.unregister(body, colliders);
    this.world.removeRigidBody(body);
  }

  // ---- creation helpers ---------------------------------------------------
  createDynamic(pos: THREE.Vector3, opts: {
    linearDamping?: number; angularDamping?: number; ccd?: boolean;
    canSleep?: boolean; quat?: THREE.Quaternion;
  } = {}): RBody {
    let d = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z);
    if (opts.quat) d = d.setRotation({ x: opts.quat.x, y: opts.quat.y, z: opts.quat.z, w: opts.quat.w });
    d = d.setLinearDamping(opts.linearDamping ?? 0.06)
      .setAngularDamping(opts.angularDamping ?? 0.25)
      .setCcdEnabled(opts.ccd ?? false)
      .setCanSleep(opts.canSleep ?? true);
    return this.world.createRigidBody(d);
  }

  createFixed(pos: THREE.Vector3, quat?: THREE.Quaternion): RBody {
    let d = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
    if (quat) d = d.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    return this.world.createRigidBody(d);
  }

  createKinematic(pos: THREE.Vector3): RBody {
    return this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z),
    );
  }

  attach(body: RBody, desc: RAPIER.ColliderDesc, collisionGroups: number): RCollider {
    desc.setCollisionGroups(collisionGroups);
    return this.world.createCollider(desc, body);
  }

  /** Static trimesh, used for terrain and authored geometry. */
  createTrimesh(verts: Float32Array, indices: Uint32Array, collisionGroups = Groups.world):
    { body: RBody; collider: RCollider } {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.trimesh(verts, indices).setFriction(0.95).setRestitution(0.02);
    const collider = this.attach(body, desc, collisionGroups);
    return { body, collider };
  }

  // ---- queries ------------------------------------------------------------
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number,
    mask: number = QueryMask.solid, excludeBody?: RBody | null): RayHit | null {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.world.castRayAndGetNormal(
      this.ray, maxDist, true, undefined, mask, undefined, excludeBody ?? undefined,
    );
    if (!hit) return null;
    const c = hit.collider;
    const t = hit.timeOfImpact;
    const n = hit.normal;
    return {
      point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t),
      normal: new THREE.Vector3(n.x, n.y, n.z),
      distance: t,
      collider: c,
      body: c.parent(),
      owner: this.ownerByCollider.get(c.handle) ?? null,
    };
  }

  /** All owners whose collider intersects a sphere. */
  overlapSphere(center: THREE.Vector3, radius: number, mask: number, out: PhysicsOwner[] = []): PhysicsOwner[] {
    out.length = 0;
    const shape = new RAPIER.Ball(radius);
    this.world.intersectionsWithShape(
      { x: center.x, y: center.y, z: center.z }, { x: 0, y: 0, z: 0, w: 1 }, shape,
      (c) => {
        const o = this.ownerByCollider.get(c.handle);
        if (o && !out.includes(o)) out.push(o);
        return true;
      },
      undefined, mask,
    );
    return out;
  }

  /** Radial impulse. Returns the bodies actually pushed. */
  explode(center: THREE.Vector3, radius: number, strength: number, upBias = 0.35): RBody[] {
    const pushed: RBody[] = [];
    const shape = new RAPIER.Ball(radius);
    this.world.intersectionsWithShape(
      { x: center.x, y: center.y, z: center.z }, { x: 0, y: 0, z: 0, w: 1 }, shape,
      (c) => {
        const b = c.parent();
        if (!b || b.isFixed() || pushed.includes(b)) return true;
        const t = b.translation();
        _v.set(t.x - center.x, t.y - center.y, t.z - center.z);
        const d = _v.length();
        const falloff = Math.max(0, 1 - d / radius);
        if (falloff <= 0) return true;
        if (d < 0.001) _v.set(0, 1, 0); else _v.multiplyScalar(1 / d);
        _v.y += upBias;
        _v.normalize().multiplyScalar(strength * falloff * falloff * Math.max(0.2, b.mass()));
        b.applyImpulse({ x: _v.x, y: _v.y, z: _v.z }, true);
        pushed.push(b);
        return true;
      },
      undefined, QueryMask.anything,
    );
    return pushed;
  }

  get bodyCount(): number { return this.world.bodies.len(); }

  get activeBodyCount(): number {
    let n = 0;
    this.world.bodies.forEach((b) => { if (!b.isSleeping() && !b.isFixed()) n++; });
    return n;
  }
}
