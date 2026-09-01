import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Game, System } from '@/core/Game';
import type { RBody } from '@/physics/PhysicsWorld';
import { Palette } from '@/render/Palette';
import { clamp } from '@/core/MathUtils';

export interface RopeEnd {
  /** null means "pinned to the world at `point`". */
  body: RBody | null;
  /** Anchor in the body's local frame, or world space if body is null. */
  local: THREE.Vector3;
  /** Which fruit/entity this end is holding, for gameplay queries. */
  ownerId: number;
}

export interface Rope {
  id: number;
  a: RopeEnd;
  b: RopeEnd;
  length: number;
  restLength: number;
  joint: RAPIER.ImpulseJoint | null;
  /** Ropes snap above this tension so nothing can be trivially trivialised. */
  maxTension: number;
  tension: number;
  /** Winch state: non-zero reels in (negative) or pays out (positive). */
  reelRate: number;
  minLength: number;
  broken: boolean;
  /** Set for ropes the player is personally holding. */
  heldByPlayer: boolean;
  color: THREE.Color;
}

const SEGMENTS = 12;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Ropes as maximum-distance constraints rather than chains of jointed segments.
 *
 * A ten-segment rope per tether looks marginally better and costs an order of
 * magnitude more solver work, and it goes unstable exactly when the game is at
 * its most interesting (a two-tonne melon on four tethers). One constraint plus
 * a drawn catenary gives the same gameplay — goes taut, transmits force, can be
 * winched, can snap — and stays stable under load.
 */
export class RopeSystem implements System {
  readonly name = 'ropes';
  private g!: Game;
  ropes = new Map<number, Rope>();
  private group = new THREE.Group();
  private meshes = new Map<number, THREE.Mesh>();
  private material!: THREE.MeshStandardMaterial;
  private geoPool: THREE.TubeGeometry[] = [];

  init(g: Game): void {
    this.g = g;
    this.group.name = 'Ropes';
    g.renderer.scene.add(this.group);
    this.material = new THREE.MeshStandardMaterial({
      color: Palette.rope, roughness: 0.95, metalness: 0, flatShading: true,
    });
    this.material.name = 'rope';

    g.debug?.addProbe('ropes', () => ({
      count: this.ropes.size,
      taut: [...this.ropes.values()].filter((r) => r.tension > 0.05).length,
      list: [...this.ropes.values()].map((r) => ({
        id: r.id, len: +r.length.toFixed(2), tension: +r.tension.toFixed(2),
        a: r.a.ownerId, b: r.b.ownerId,
      })),
    }));
    g.debug?.addAction('rope.count', () => this.ropes.size);
    g.debug?.addAction('rope.clear', () => { const n = this.ropes.size; this.clear(); return n; });
  }

  /**
   * Create a rope between two ends. Either end may be a world point (body null),
   * which is how a rope gets pinned to terrain or a cliff.
   */
  create(a: RopeEnd, b: RopeEnd, length: number, opts: {
    maxTension?: number; minLength?: number; color?: THREE.Color; heldByPlayer?: boolean;
  } = {}): Rope {
    const id = this.g.newId();
    const aBody = a.body ?? this.pin(a.local);
    const bBody = b.body ?? this.pin(b.local);
    const aLocal = a.body ? a.local : ZERO;
    const bLocal = b.body ? b.local : ZERO;

    const params = RAPIER.JointData.rope(
      length,
      { x: aLocal.x, y: aLocal.y, z: aLocal.z },
      { x: bLocal.x, y: bLocal.y, z: bLocal.z },
    );
    const joint = this.g.physics.world.createImpulseJoint(params, aBody, bBody, true);

    const rope: Rope = {
      id,
      a: { body: aBody, local: aLocal.clone(), ownerId: a.ownerId },
      b: { body: bBody, local: bLocal.clone(), ownerId: b.ownerId },
      length, restLength: length, joint,
      maxTension: opts.maxTension ?? 2600,
      tension: 0,
      reelRate: 0,
      minLength: opts.minLength ?? 0.8,
      broken: false,
      heldByPlayer: opts.heldByPlayer ?? false,
      color: opts.color ?? Palette.rope,
    };
    this.ropes.set(id, rope);
    this.makeMesh(rope);
    this.g.bus.emit('rope:attached', { ropeId: id, aId: a.ownerId, bId: b.ownerId });
    return rope;
  }

  private pin(worldPoint: THREE.Vector3): RBody {
    return this.g.physics.createFixed(worldPoint);
  }

  private makeMesh(rope: Rope): void {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 2),
    ]);
    const geo = new THREE.TubeGeometry(curve, SEGMENTS, 0.045, 5, false);
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.name = `Rope:${rope.id}`;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    this.group.add(mesh);
    this.meshes.set(rope.id, mesh);
  }

  /** Change a rope's length over time. Negative reels in. */
  setReel(id: number, rate: number): void {
    const r = this.ropes.get(id);
    if (r) r.reelRate = rate;
  }

  setLength(id: number, length: number): void {
    const r = this.ropes.get(id);
    if (!r || !r.joint) return;
    r.length = clamp(length, r.minLength, r.restLength * 3);
    // Rapier has no setter for a rope joint's limit, so it is rebuilt. Cheap:
    // there are never more than a handful of ropes in play.
    this.g.physics.world.removeImpulseJoint(r.joint, true);
    const params = RAPIER.JointData.rope(
      r.length,
      { x: r.a.local.x, y: r.a.local.y, z: r.a.local.z },
      { x: r.b.local.x, y: r.b.local.y, z: r.b.local.z },
    );
    r.joint = this.g.physics.world.createImpulseJoint(params, r.a.body!, r.b.body!, true);
  }

  remove(id: number): void {
    const r = this.ropes.get(id);
    if (!r) return;
    if (r.joint) this.g.physics.world.removeImpulseJoint(r.joint, true);
    // Pinned ends own a fixed body each; clean those up too.
    if (r.a.ownerId === -1 && r.a.body) this.g.physics.removeBody(r.a.body);
    if (r.b.ownerId === -1 && r.b.body) this.g.physics.removeBody(r.b.body);
    const mesh = this.meshes.get(id);
    if (mesh) { this.group.remove(mesh); mesh.geometry.dispose(); this.meshes.delete(id); }
    this.ropes.delete(id);
  }

  clear(): void {
    for (const id of [...this.ropes.keys()]) this.remove(id);
  }

  /** Every rope currently attached to a given entity id. */
  attachedTo(ownerId: number): Rope[] {
    const out: Rope[] = [];
    for (const r of this.ropes.values()) {
      if (r.a.ownerId === ownerId || r.b.ownerId === ownerId) out.push(r);
    }
    return out;
  }

  fixedStep(dt: number): void {
    for (const r of [...this.ropes.values()]) {
      if (r.reelRate !== 0) {
        this.setLength(r.id, r.length + r.reelRate * dt);
      }
      // Tension is read from the joint's applied impulse, which is what makes
      // "the rope is about to go" legible to the player and to the audio system.
      const imp = r.joint ? (r.joint as unknown as { impulses?: Float32Array }).impulses : undefined;
      let mag = 0;
      if (imp && imp.length) {
        for (let i = 0; i < Math.min(3, imp.length); i++) mag += imp[i] * imp[i];
        mag = Math.sqrt(mag) / dt;
      } else {
        // Fall back to geometric strain when the binding does not expose impulses.
        this.endPoint(r.a, _a);
        this.endPoint(r.b, _b);
        mag = Math.max(0, _a.distanceTo(_b) - r.length) * 900;
      }
      r.tension = mag;
      if (mag > r.maxTension) {
        this.g.bus.emit('rope:snapped', { ropeId: r.id });
        this.g.bus.emit('audio:sfx', { name: 'ropeSnap' });
        this.remove(r.id);
      }
    }
  }

  private endPoint(end: RopeEnd, out: THREE.Vector3): THREE.Vector3 {
    if (!end.body) return out.copy(end.local);
    const t = end.body.translation();
    const r = end.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    return out.copy(end.local).applyQuaternion(_q).add(_v3.set(t.x, t.y, t.z));
  }

  frameUpdate(): void {
    for (const rope of this.ropes.values()) {
      const mesh = this.meshes.get(rope.id);
      if (!mesh) continue;
      this.endPoint(rope.a, _a);
      this.endPoint(rope.b, _b);
      const span = _a.distanceTo(_b);
      // Slack rope sags; taut rope is a straight line under visible strain.
      const slack = Math.max(0, rope.length - span);
      const sag = Math.min(rope.length * 0.34, slack * 0.55 + 0.04);
      _mid.copy(_a).lerp(_b, 0.5).setY(Math.min(_a.y, _b.y) - sag + Math.abs(_a.y - _b.y) * 0.12);
      const curve = new THREE.CatmullRomCurve3([_a.clone(), _mid.clone(), _b.clone()]);
      const radius = 0.04 + clamp(rope.tension / 3000, 0, 1) * 0.018;
      const geo = new THREE.TubeGeometry(curve, SEGMENTS, radius, 5, false);
      mesh.geometry.dispose();
      mesh.geometry = geo;
    }
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
    for (const g of this.geoPool) g.dispose();
  }
}

const ZERO = new THREE.Vector3(0, 0, 0);
const _v3 = new THREE.Vector3();
