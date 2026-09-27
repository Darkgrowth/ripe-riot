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
  /** Local repair fixtures, carried onto the merged geometry for capture QA. */
  readonly authoredProps: Array<{ id: string; matrix: number[]; details: Record<string, unknown> }> = [];

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

  recordProp(id: string, details: Record<string, unknown>): this {
    this.authoredProps.push({ id, matrix: this.xform.toArray(), details }); return this;
  }

  /** Add a world-space decorative mesh without disturbing an active local frame. */
  worldMesh(g: THREE.BufferGeometry, color: PropColor): this {
    const frame = this.xform.clone();
    this.xform.identity(); this.emit(g, color); this.xform.copy(frame);
    return this;
  }

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
    at: [number, number, number] = [0, 0, 0], visual?: THREE.BufferGeometry): this {
    const g = visual ?? new THREE.IcosahedronGeometry(r, seg);
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
    merged.userData.authoredProps = this.authoredProps;
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

  const padX = Math.max(22, w * 0.045), padY = Math.max(20, h * 0.075);
  const availableWidth = w - padX * 2;
  const font = (size: number, weight = 800) => `${weight} ${size}px Segoe UI, system-ui, sans-serif`;
  const measure = (text: string) => c.measureText(text).width;
  const wrap = (text: string): string[] => {
    const rows: string[] = [];
    let row = '';
    for (const word of text.trim().split(/\s+/)) {
      const next = row ? `${row} ${word}` : word;
      if (row && measure(next) > availableWidth) { rows.push(row); row = word; }
      else row = next;
    }
    if (row) rows.push(row);
    return rows;
  };
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = opts.fg ?? '#3a2109';
  const painted: Array<{ text: string; fontSize: number; x: number; y: number; width: number; height: number }> = [];
  const paint = (text: string, size: number, y: number, weight = 800) => {
    c.font = font(size, weight);
    c.fillText(text, w / 2, y);
    painted.push({ text, fontSize: size, x: w / 2, y, width: measure(text), height: size * 1.2 });
  };
  let bodyTop = padY;
  if (opts.title) {
    let size = Math.min(h * 0.20, (h - padY * 2) * 0.32);
    c.font = font(size, 900);
    while (measure(opts.title) > availableWidth && size > 1) { size *= 0.96; c.font = font(size, 900); }
    paint(opts.title, size, padY + size * 0.6, 900);
    bodyTop += size * 1.2 + Math.max(10, h * 0.045);
  }
  const bodyHeight = h - padY - bodyTop;
  let bodySize = h * 0.125 * (opts.lineScale ?? 1);
  let rows: string[] = [];
  for (let attempt = 0; attempt < 160; attempt++) {
    c.font = font(bodySize);
    rows = lines.flatMap(wrap);
    if (rows.length * bodySize * 1.22 <= bodyHeight && rows.every(row => measure(row) <= availableWidth)) break;
    bodySize *= 0.96;
  }
  const step = bodySize * 1.22;
  const top = bodyTop + (bodyHeight - rows.length * step) / 2;
  rows.forEach((row, i) => paint(row, bodySize, top + (i + 0.5) * step));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.userData.signLayout = { title: opts.title ?? '', sourceLines: lines, width: w, height: h,
    padding: { x: padX, y: padY }, painted };
  return tex;
}

/** Attach a front-only legend to a real, blank-backed board in the prop batch. */
export function finishWorldSign(b: PropBuilder, mesh: THREE.Mesh, width: number, height: number,
  texture: THREE.CanvasTexture, id?: string): void {
  const layout = texture.userData.signLayout;
  const label = id ?? (layout?.title || layout?.sourceLines?.[0] || 'board');
  const signId = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  mesh.name = `Sign:${signId}`;
  mesh.userData.signAudit = { id: signId, width, height, layout, frontOnly: true, backingDepth: 0.08 };
  const material = mesh.material as THREE.MeshStandardMaterial;
  material.side = THREE.FrontSide;
  const backing = new THREE.BoxGeometry(width + 0.07, height + 0.07, 0.08);
  backing.translate(0, 0, -0.048);
  mesh.updateMatrix(); backing.applyMatrix4(mesh.matrix);
  b.worldMesh(backing, new THREE.Color().setHex(0x634d37, THREE.SRGBColorSpace));
}
