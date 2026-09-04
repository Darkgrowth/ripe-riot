import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Game, System } from '@/core/Game';
import type { RBody } from '@/physics/PhysicsWorld';
import { Palette } from '@/render/Palette';
import { clamp } from '@/core/MathUtils';

export interface RopeEnd {
  /** null means "pinned to the world at `point`". */
  body: RBody | null;
  /**
   * Rapier handle for `body`. Bodies are re-resolved from this every step:
   * holding a RigidBody across its removal (a tethered fruit gets sold, a
   * plant is despawned) means calling into freed WASM memory, which surfaces
   * as "recursive use of an object" from wasm-bindgen and poisons every
   * subsequent physics call.
   */
  handle?: number;
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
  /**
   * Tension averaged over the last ~0.15 s. Snapping is judged on THIS, not on
   * the instantaneous value: a rope that arrests a walking player inside one
   * fixed step reports the impulse to stop 82 kg in 1/60 s, which is 23 kN and
   * more than any rope in the game is rated for. A sustained load still parts
   * the rope within a few frames; a jolt does not.
   */
  tensionAvg: number;
  /** Winch state: non-zero reels in (negative) or pays out (positive). */
  reelRate: number;
  minLength: number;
  broken: boolean;
  /** Set for ropes the player is personally holding. */
  heldByPlayer: boolean;
  color: THREE.Color;
  /** Drawn radius. Vines are much thicker than rope. */
  radius: number;
  /** Vines can be cut; ropes are released instead. */
  cuttable: boolean;
  /** Latched "is under load" state, so the taut event fires on the edge. */
  taut: boolean;
  /** Seconds until the next creak while heavily loaded. */
  creak: number;
  /** Seconds until this rope may report another tug on the player. */
  tugCool: number;
}

const SEGMENTS = 12;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _n = new THREE.Vector3();
const _imp = new THREE.Vector3();

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
  private materials = new Map<string, THREE.MeshStandardMaterial>();

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
      list: [...this.ropes.values()].map((r) => {
        this.endPoint(r.a, _a); this.endPoint(r.b, _b);
        return {
          id: r.id, len: +r.length.toFixed(2), dist: +_a.distanceTo(_b).toFixed(2),
          tension: +r.tension.toFixed(0), a: r.a.ownerId, b: r.b.ownerId,
        };
      }),
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
    radius?: number; cuttable?: boolean;
  } = {}): Rope {
    const id = this.g.newId();
    const aBody = a.body ?? this.pin(a.local);
    const bBody = b.body ?? this.pin(b.local);
    const aLocal = a.body ? a.local : ZERO;
    const bLocal = b.body ? b.local : ZERO;

    const rope: Rope = {
      id,
      a: { body: aBody, handle: aBody.handle, local: aLocal.clone(), ownerId: a.ownerId },
      b: { body: bBody, handle: bBody.handle, local: bLocal.clone(), ownerId: b.ownerId },
      length, restLength: length, joint: null,
      maxTension: opts.maxTension ?? 2600,
      tension: 0,
      tensionAvg: 0,
      reelRate: 0,
      minLength: opts.minLength ?? 0.8,
      broken: false,
      heldByPlayer: opts.heldByPlayer ?? false,
      color: opts.color ?? Palette.rope,
      radius: opts.radius ?? 0.045,
      cuttable: opts.cuttable ?? false,
      taut: false,
      creak: 0,
      tugCool: 0,
    };
    this.ropes.set(id, rope);
    this.makeMesh(rope);
    this.g.bus.emit('rope:attached', { ropeId: id, aId: a.ownerId, bId: b.ownerId });
    return rope;
  }

  private pin(worldPoint: THREE.Vector3): RBody {
    return this.g.physics.createFixed(worldPoint);
  }

  /** Materials are cached per colour: a handful at most, all flat-shaded. */
  private materialFor(color: THREE.Color): THREE.MeshStandardMaterial {
    const key = color.getHexString();
    let m = this.materials.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: color.clone(), roughness: 0.95, metalness: 0, flatShading: true,
      });
      m.name = `rope:${key}`;
      this.materials.set(key, m);
    }
    return m;
  }

  private makeMesh(rope: Rope): void {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 2),
    ]);
    const geo = new THREE.TubeGeometry(curve, SEGMENTS, rope.radius, 5, false);
    const mesh = new THREE.Mesh(geo, this.materialFor(rope.color));
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
    if (!r) return;
    r.length = clamp(length, r.minLength, r.restLength * 3);
  }

  remove(id: number): void {
    const r = this.ropes.get(id);
    if (!r) return;
    // Pinned ends own a fixed body each; clean those up too, if still present.
    const world = this.g.physics.world;
    if (r.a.ownerId === -1 && r.a.handle !== undefined) {
      const pinA = world.getRigidBody(r.a.handle);
      if (pinA) this.g.physics.removeBody(pinA);
    }
    if (r.b.ownerId === -1 && r.b.handle !== undefined) {
      const pinB = world.getRigidBody(r.b.handle);
      if (pinB) this.g.physics.removeBody(pinB);
    }
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

  /**
   * Solve every rope as a ONE-SIDED distance constraint.
   *
   * Rapier's rope joint was measured not to constrain at all here: a 2.6 tonne
   * King Melon fell straight through three of them, and a tethered player could
   * walk 9 m against a 2.5 m rope. Rather than build the game's signature
   * mechanic on that, ropes are solved directly — which also gives an honest
   * tension in newtons (for strain audio and snapping) and makes winching a
   * change to one number instead of a joint rebuild every frame.
   *
   * Impulses are applied before world.step(), so the solver integrates them.
   */
  fixedStep(dt: number): void {
    const invDt = 1 / dt;
    const world = this.g.physics.world;
    for (const r of [...this.ropes.values()]) {
      // Re-resolve both ends. Either can vanish between steps.
      const bodyA = r.a.handle !== undefined ? world.getRigidBody(r.a.handle) : null;
      const bodyB = r.b.handle !== undefined ? world.getRigidBody(r.b.handle) : null;
      if (!bodyA || !bodyB) { this.remove(r.id); continue; }
      r.a.body = bodyA;
      r.b.body = bodyB;
      if (r.tugCool > 0) r.tugCool = Math.max(0, r.tugCool - dt);

      if (r.reelRate !== 0) this.setLength(r.id, r.length + r.reelRate * dt);
      this.endPoint(r.a, _a);
      this.endPoint(r.b, _b);
      _n.copy(_b).sub(_a);
      const dist = _n.length();
      const slack = r.length - dist;
      if (dist < 1e-5 || slack >= 0) {
        r.tension = 0; r.tensionAvg *= TENSION_DECAY;
        this.setTaut(r, false);
        continue;
      }
      _n.multiplyScalar(1 / dist);

      // The player is a kinematic body as far as Rapier is concerned, which
      // would make them an immovable anchor: a rope tied to a player could
      // hold a melon but never pull the player, and "tethered to a falling
      // two-tonne melon" is half the reason the rope gun exists. Treat the
      // player as a movable mass whose velocity lives on the controller.
      const playerA = this.isPlayer(bodyA);
      const playerB = this.isPlayer(bodyB);
      const invMassA = playerA ? 1 / PLAYER_MASS : movable(bodyA) ? 1 / Math.max(0.001, bodyA.mass()) : 0;
      const invMassB = playerB ? 1 / PLAYER_MASS : movable(bodyB) ? 1 / Math.max(0.001, bodyB.mass()) : 0;
      const invSum = invMassA + invMassB;
      if (invSum <= 0) {
        r.tension = 0; r.tensionAvg *= TENSION_DECAY;
        this.setTaut(r, false);
        continue;
      }

      // Separation speed along the rope, positive when it is being pulled apart.
      const va = playerA ? this.g.player.velocity : bodyA.linvel();
      const vb = playerB ? this.g.player.velocity : bodyB.linvel();
      const vSep = (vb.x - va.x) * _n.x + (vb.y - va.y) * _n.y + (vb.z - va.z) * _n.z;

      // Baumgarte term pulls out the overshoot without letting the rope snap
      // taut in a single step, which would fling everything attached to it.
      const violation = -slack;
      const bias = Math.min(violation * invDt * 0.22, 14);
      const j = (vSep + bias) / invSum;
      if (j < 0) {
        r.tension = 0; r.tensionAvg *= TENSION_DECAY;
        this.setTaut(r, false);
        continue;
      }

      _imp.copy(_n).multiplyScalar(j);
      if (playerA) this.pullPlayer(_imp, 1 / PLAYER_MASS, r);
      else if (invMassA > 0) bodyA.applyImpulseAtPoint({ x: _imp.x, y: _imp.y, z: _imp.z },
        { x: _a.x, y: _a.y, z: _a.z }, true);
      if (playerB) this.pullPlayer(_imp, -1 / PLAYER_MASS, r);
      else if (invMassB > 0) bodyB.applyImpulseAtPoint({ x: -_imp.x, y: -_imp.y, z: -_imp.z },
        { x: _b.x, y: _b.y, z: _b.z }, true);

      r.tension = j * invDt;
      r.tensionAvg += (r.tension - r.tensionAvg) * (1 - TENSION_DECAY);
      // A player leaning on a rope pinned to the world cannot part it: the
      // controller's ground acceleration is a feel number (62 m/s^2, 5 kN on
      // 82 kg), not a force a person can produce. Snapping needs a real load
      // on the other end.
      const leaning = (playerA && invMassB === 0) || (playerB && invMassA === 0);
      if (r.tensionAvg > r.maxTension && !leaning) {
        this.g.bus.emit('rope:snapped', { ropeId: r.id });
        this.g.bus.emit('audio:sfx', { name: 'ropeSnap' });
        this.remove(r.id);
        continue;
      }
      // Going taut is an EDGE, not a die roll. The old code played a strain
      // sound on 2% of the steps a loaded rope spent above half its rating,
      // which is a random noise in the middle of the one moment the player
      // needs to hear precisely: the instant the line bit.
      this.setTaut(r, r.tension > TAUT_N);
      // Sustained heavy load keeps creaking, on a fixed cadence rather than
      // a coin flip, with the pitch riding the load.
      if (r.tensionAvg > r.maxTension * 0.5) {
        r.creak -= dt;
        if (r.creak <= 0) {
          r.creak = 0.42;
          this.g.bus.emit('audio:sfx', {
            name: 'ropeStrain',
            volume: 0.35 + clamp(r.tensionAvg / r.maxTension, 0, 1) * 0.4,
            pitch: clamp(0.9 + r.tensionAvg / r.maxTension, 0.9, 2.0),
          });
        }
      } else {
        r.creak = 0;
      }
    }
  }

  /** Announce the slack/taut edge once, with a little hysteresis. */
  private setTaut(r: Rope, taut: boolean): void {
    if (taut === r.taut) return;
    // Coming off load needs the tension to actually be gone, so a rope
    // hovering around the threshold does not chatter.
    if (!taut && r.tension > TAUT_N * 0.35) return;
    r.taut = taut;
    this.g.bus.emit('rope:taut', { ropeId: r.id, taut, tension: r.tension });
  }

  private isPlayer(b: RBody): boolean {
    const p = this.g.player;
    return p.state === 'active' && b.handle === p.body.handle;
  }

  /** A rope impulse on the player becomes a velocity change on the controller,
   *  which is where player motion actually lives. A hard yank also reads as an
   *  impact, so a player tied to something that falls gets flattened. */
  private pullPlayer(impulse: THREE.Vector3, invMass: number, rope: Rope): void {
    _pull.copy(impulse).multiplyScalar(invMass);
    const p = this.g.player;
    const wanted = _pull.length();
    // A leash, not a wall: the correction is spread over a couple of steps so
    // hitting the end of a rope at a sprint is a sharp tug rather than a
    // teleport, and a sleeping rope does not launch anyone.
    if (wanted > MAX_PLAYER_YANK) _pull.multiplyScalar(MAX_PLAYER_YANK / wanted);
    p.velocity.add(_pull);
    // Ropes pull up as well as along; let the controller leave the ground
    // rather than immediately zeroing the lift as "landed".
    if (_pull.y > 0.6) p.grounded = false;
    // Being yanked was invisible below the ragdoll threshold: sprinting to
    // the end of a tether took 6.5 m/s off you in one step and the camera
    // did not so much as blink. Anything that moves the player this much is
    // worth feeling.
    // Rate-limited per rope: a sustained haul yanks you on every one of the
    // sixty steps in a second, and sixty stacked camera shakes is a seizure,
    // not a tug.
    const felt = _pull.length();
    if (felt > TUG_FELT && rope.tugCool <= 0) {
      rope.tugCool = 0.34;
      this.g.bus.emit('rope:tug', { ropeId: rope.id, speed: felt });
    }
    if (wanted > p.ragdollImpactSpeed) p.onHardImpact?.(wanted, 'rope');
  }

  private endPoint(end: RopeEnd, out: THREE.Vector3): THREE.Vector3 {
    const body = end.handle !== undefined
      ? this.g.physics.world.getRigidBody(end.handle) : null;
    if (!body) return out.copy(end.local);
    const t = body.translation();
    const r = body.rotation();
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
      const radius = rope.radius * (1 + clamp(rope.tension / 3000, 0, 1) * 0.4);
      const geo = new THREE.TubeGeometry(curve, SEGMENTS, radius, 5, false);
      mesh.geometry.dispose();
      mesh.geometry = geo;
    }
  }

  /** World-space endpoints, for hit-testing a rope the player is looking at. */
  endpoints(rope: Rope, a: THREE.Vector3, b: THREE.Vector3): void {
    this.endPoint(rope.a, _a); a.copy(_a);
    this.endPoint(rope.b, _b); b.copy(_b);
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }
}

/** Fixed and kinematic bodies are immovable anchors as far as a rope knows. */
function movable(b: RBody): boolean {
  return !b.isFixed() && !b.isKinematic();
}

const ZERO = new THREE.Vector3(0, 0, 0);
const _v3 = new THREE.Vector3();
const _pull = new THREE.Vector3();
/** What a rope thinks a harvester weighs. Matches the character controller. */
const PLAYER_MASS = 82;
/** Largest velocity change one step may put on the player, m/s. */
const MAX_PLAYER_YANK = 9;
/** Velocity change in one step worth reporting as a tug the player felt. */
const TUG_FELT = 1.2;
/** Tension (N) at which a rope reads as loaded rather than merely straight. */
const TAUT_N = 45;
/** Per-step retention of the smoothed tension: e^(-dt/0.15) at 60 Hz. */
const TENSION_DECAY = Math.exp(-(1 / 60) / 0.15);
