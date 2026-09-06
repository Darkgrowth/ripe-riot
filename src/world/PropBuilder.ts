import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { Groups } from '@/physics/Layers';

/**
 * Accumulates authored static geometry into a single vertex-coloured mesh, so
 * an entire dock, shed and boat cost one draw call between them. Colliders are
 * registered as they are added, which keeps the visual and the collision
 * definition of a prop on the same line of code.
 */
/** A flat colour, or a function of the primitive's local Y — which is how a
 *  post gets a dark waterline band without becoming two primitives. */
export type PropColor = THREE.Color | ((y: number) => THREE.Color);

export class PropBuilder {
  private parts: THREE.BufferGeometry[] = [];
  private physics: PhysicsWorld | null;
  private xform = new THREE.Matrix4();
  private stack: THREE.Matrix4[] = [];
  /** Set false for decorative geometry that should not be collidable. */
  solid = true;
  triangles = 0;

  constructor(physics: PhysicsWorld | null) {
    this.physics = physics;
    this.xform.identity();
  }

  // ---- transform stack ----------------------------------------------------
  push(): this { this.stack.push(this.xform.clone()); return this; }
  pop(): this { this.xform.copy(this.stack.pop() ?? new THREE.Matrix4().identity()); return this; }
  translate(x: number, y: number, z: number): this {
    this.xform.multiply(_tmp.makeTranslation(x, y, z)); return this;
  }
  rotateY(a: number): this { this.xform.multiply(_tmp.makeRotationY(a)); return this; }
  rotateX(a: number): this { this.xform.multiply(_tmp.makeRotationX(a)); return this; }
  rotateZ(a: number): this { this.xform.multiply(_tmp.makeRotationZ(a)); return this; }
  scale(x: number, y: number, z: number): this {
    this.xform.multiply(_tmp.makeScale(x, y, z)); return this;
  }
  reset(): this { this.xform.identity(); this.stack.length = 0; return this; }

  // ---- primitives ---------------------------------------------------------
  /** Axis-aligned box in the current frame. Sizes are full extents. */
  box(w: number, h: number, d: number, color: PropColor, collide = this.solid,
    at: [number, number, number] = [0, 0, 0]): this {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(at[0], at[1], at[2]);
    this.emit(g, color);
    if (collide && this.physics) {
      _pos.set(at[0], at[1], at[2]).applyMatrix4(this.xform);
      this.xform.decompose(_dc, _dq, _ds);
      const body = this.physics.createFixed(_pos, _dq);
      const desc = RAPIER.ColliderDesc.cuboid(
        (w * _ds.x) / 2, (h * _ds.y) / 2, (d * _ds.z) / 2).setFriction(0.85);
      this.physics.attach(body, desc, Groups.prop);
    }
    return this;
  }

  cylinder(rTop: number, rBot: number, h: number, seg: number, color: PropColor,
    collide = this.solid, at: [number, number, number] = [0, 0, 0]): this {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
    g.translate(at[0], at[1], at[2]);
    this.emit(g, color);
    if (collide && this.physics) {
      _pos.set(at[0], at[1], at[2]).applyMatrix4(this.xform);
      this.xform.decompose(_dc, _dq, _ds);
      const body = this.physics.createFixed(_pos, _dq);
      const r = Math.max(rTop, rBot) * Math.max(_ds.x, _ds.z);
      const desc = RAPIER.ColliderDesc.cylinder((h * _ds.y) / 2, r).setFriction(0.85);
      this.physics.attach(body, desc, Groups.prop);
    }
    return this;
  }

  /** Decorative geometry with no collider, from any geometry you built. */
  mesh(g: THREE.BufferGeometry, color: PropColor): this {
    this.emit(g, color);
    return this;
  }

  sphere(r: number, seg: number, color: PropColor, collide = this.solid,
    at: [number, number, number] = [0, 0, 0]): this {
    const g = new THREE.IcosahedronGeometry(r, seg);
    g.translate(at[0], at[1], at[2]);
    this.emit(g, color);
    if (collide && this.physics) {
      _pos.set(at[0], at[1], at[2]).applyMatrix4(this.xform);
      this.xform.decompose(_dc, _dq, _ds);
      const body = this.physics.createFixed(_pos, _dq);
      this.physics.attach(body, RAPIER.ColliderDesc.ball(r * _ds.x).setFriction(0.9), Groups.prop);
    }
    return this;
  }

  /**
   * A solid box that exists only to physics.
   *
   * The dock deck was one collider box drawn as well as collided with, sitting
   * directly under eighteen planks — so it filled every seam between them and
   * the deck rendered as a single flat slab of tan. Separating the two lets the
   * planking be planking and the collision be one cheap cuboid.
   */
  collider(w: number, h: number, d: number, at: [number, number, number] = [0, 0, 0]): this {
    if (!this.physics) return this;
    _pos.set(at[0], at[1], at[2]).applyMatrix4(this.xform);
    this.xform.decompose(_dc, _dq, _ds);
    const body = this.physics.createFixed(_pos, _dq);
    const desc = RAPIER.ColliderDesc.cuboid(
      (w * _ds.x) / 2, (h * _ds.y) / 2, (d * _ds.z) / 2).setFriction(0.85);
    this.physics.attach(body, desc, Groups.prop);
    return this;
  }

  /** A sensor volume that reports overlaps but never blocks movement. */
  trigger(w: number, h: number, d: number, at: [number, number, number],
    owner: { id: number; kind: string; onSensorEnter?: (o: unknown) => void }): void {
    if (!this.physics) return;
    _pos.set(at[0], at[1], at[2]).applyMatrix4(this.xform);
    this.xform.decompose(_dc, _dq, _ds);
    const body = this.physics.createFixed(_pos, _dq);
    const desc = RAPIER.ColliderDesc.cuboid((w * _ds.x) / 2, (h * _ds.y) / 2, (d * _ds.z) / 2)
      .setSensor(true)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const col = this.physics.attach(body, desc, Groups.trigger);
    this.physics.register(owner as never, body, [col]);
  }

  private emit(g: THREE.BufferGeometry, color: PropColor): void {
    const flat = g.index ? g.toNonIndexed() : g;
    if (flat !== g) g.dispose();
    flat.applyMatrix4(this.xform);
    const pos = flat.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const c = typeof color === 'function' ? color(pos.getY(i)) : color;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // Strip anything the merge would choke on; we only need pos/normal/color.
    for (const k of Object.keys(flat.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'color') flat.deleteAttribute(k);
    }
    this.triangles += pos.count / 3;
    this.parts.push(flat);
  }

  /** Merge everything added so far into one geometry. */
  finish(): THREE.BufferGeometry | null {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    if (!merged) throw new Error('prop merge failed (attribute mismatch)');
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    return merged;
  }
}

const _tmp = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _dc = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _ds = new THREE.Vector3();

/** Canvas-generated sign texture — no image assets to ship or licence. */
export function signTexture(lines: string[], opts: {
  w?: number; h?: number; bg?: string; fg?: string; accent?: string; title?: string;
  /** Multiplier on the body text size, for boards that are one short word. */
  lineScale?: number;
} = {}): THREE.CanvasTexture {
  const w = opts.w ?? 512;
  const h = opts.h ?? 320;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  c.fillStyle = opts.bg ?? '#e0c491';
  c.fillRect(0, 0, w, h);
  // Plank seams and a border, so the sign reads as carpentry.
  c.strokeStyle = 'rgba(120,86,44,0.35)';
  c.lineWidth = 3;
  for (let y = h / 4; y < h; y += h / 4) {
    c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
  }
  c.strokeStyle = opts.accent ?? '#7a4a1e';
  c.lineWidth = 12;
  c.strokeRect(9, 9, w - 18, h - 18);

  c.textAlign = 'center';
  c.fillStyle = opts.fg ?? '#3a2109';
  let y = 62;
  if (opts.title) {
    c.font = `900 ${Math.round(h * 0.20)}px Segoe UI, system-ui, sans-serif`;
    c.fillText(opts.title, w / 2, y);
    y += h * 0.13;
  }
  c.font = `800 ${Math.round(h * 0.125 * (opts.lineScale ?? 1))}px Segoe UI, system-ui, sans-serif`;
  if (!opts.title) y = 20;
  const step = (h - y - 26) / Math.max(1, lines.length);
  for (const line of lines) {
    c.fillText(line, w / 2, y + step * 0.75);
    y += step;
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
