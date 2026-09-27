import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Game, System } from '@/core/Game';
import type { RBody, RCollider, PhysicsOwner } from '@/physics/PhysicsWorld';
import { groups, Layer, QueryMask } from '@/physics/Layers';
import { makePlayerRig, RAGDOLL_PART_NAMES, RIG_JOINTS, type PlayerRig, type RigPartName,
  type RigidPose } from './PlayerRig';
import type { FruitSystem } from '@/fruit/FruitSystem';
import type { RopeSystem } from '@/systems/RopeSystem';
import type { Sunpatch } from '@/world/Sunpatch';
import { clamp } from '@/core/MathUtils';
import { PLAYER_RADIUS, STAND_HEIGHT } from './PlayerController';

/** Ragdoll parts collide with the world but never with each other. */
const RAGDOLL_GROUPS = groups(
  Layer.PLAYER,
  Layer.WORLD | Layer.PROP | Layer.PLANT | Layer.FRUIT | Layer.VEHICLE,
);

interface Part {
  name: RigPartName;
  body: RBody;
  collider: RCollider;
  extraColliders: RCollider[];
}

const _v = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _centre = new THREE.Vector3();
const _partPos = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Comedy, not punishment.
 *
 * A hard impact swaps the kinematic character capsule for a six-body articulated
 * ragdoll, lets it tumble, then stands the player back up somewhere sensible.
 * Recovery is deliberately fast and cannot fail: the brief is explicit that
 * being flattened by a coconut should be funny, not a setback.
 */
export class PlayerRagdoll implements System, PhysicsOwner {
  readonly name = 'ragdoll';
  readonly kind = 'ragdoll';
  readonly id: number = -100;

  private g!: Game;
  private fruitSys!: FruitSystem;
  private rig!: PlayerRig;
  private parts: Part[] = [];
  private joints: RAPIER.ImpulseJoint[] = [];
  private anchor = new THREE.Object3D();
  active = false;
  private timer = 0;
  private settled = 0;
  private minTime = 1.0;
  private maxTime = 3.6;
  /** How many times the player has been flattened; purely for achievements. */
  knockdowns = 0;
  lastSource = '';
  private lastSanePos = new THREE.Vector3();
  private safeGround = new THREE.Vector3();
  private hasSafeGround = false;
  private safeScan = 0;
  private rescueHold = 0;
  private rescueLatched = false;
  lastSpeed = 0;

  /** Six world-space body transforms, sent only while the player is tumbling. */
  networkPose(): number[] | null {
    if (!this.active || this.parts.length !== RAGDOLL_PART_NAMES.length) return null;
    const packet: number[] = [];
    for (const name of RAGDOLL_PART_NAMES) {
      const part = this.parts.find(p => p.name === name);
      if (!part) return null;
      const t = part.body.translation(), q = part.body.rotation();
      packet.push(t.x, t.y, t.z, q.x, q.y, q.z, q.w);
    }
    return packet;
  }

  init(g: Game): void {
    this.g = g;
    this.rig = makePlayerRig();
    g.renderer.scene.add(this.rig.root);
    g.renderer.scene.add(this.anchor);

    g.player.onHardImpact = (speed, source) => this.trigger(speed, source);

    this.fruitSys = g.get<FruitSystem>('fruit');

    g.debug?.addProbe('ragdoll', () => ({
      active: this.active,
      timer: +this.timer.toFixed(2),
      knockdowns: this.knockdowns,
      lastSource: this.lastSource,
      lastSpeed: +this.lastSpeed.toFixed(2),
      parts: this.parts.length,
    }));
    g.debug?.addAction('ragdoll.trigger', (speed = 14, source = 'debug') => {
      this.trigger(speed, source);
      return this.active;
    });
    g.debug?.addAction('ragdoll.recover', () => { this.recover(); return !this.active; });
    g.debug?.addAction('ragdoll.rescue', () => this.rescue());
    g.debug?.addProbe('safeRecovery', () => ({
      checkpoint: this.hasSafeGround ? this.safeGround.toArray() : null,
      holding: +this.rescueHold.toFixed(2),
    }));
  }

  // ---- trigger / recover --------------------------------------------------
  trigger(speed: number, source: string, extraVelocity?: THREE.Vector3): void {
    if (this.active) return;
    const p = this.g.player;
    this.active = true;
    this.timer = 0;
    this.knockdowns++;
    this.lastSource = source;
    this.lastSpeed = speed;

    p.state = 'ragdoll';
    p.setSimulated(false);

    _v.copy(p.velocity);
    if (extraVelocity) _v.add(extraVelocity);
    // Always add a little spin and lift: a body that just slides is not funny.
    _v.y = Math.max(_v.y, 1.6) + Math.min(4, speed * 0.12);

    this.lastSanePos.copy(p.position).setY(p.position.y + 1.05);
    this.buildBodies(p.position, _v, p.yaw);
    this.rig.setVisible(true);
    this.g.playerCamera.setRagdoll(true, this.anchor);
    this.g.playerCamera.addShake(0.05, 0.5, 22);
    this.g.renderer.setFovOffset(6);
    this.g.bus.emit('player:ragdoll', { playerId: p.id, speed, source });
    this.g.bus.emit('audio:sfx', { name: 'thud', position: p.position.clone(), volume: 0.9 });
    this.g.bus.emit('ui:toast', {
      text: pickTaunt(source), sub: `${speed.toFixed(1)} m/s`, kind: 'bad', ms: 2200,
    });
  }

  /**
   * `velocity` is copied on entry rather than used in place: callers pass a
   * shared scratch vector, and this method needs scratch of its own. Aliasing
   * the two once launched the ragdoll at its own world coordinates.
   */
  private buildBodies(origin: THREE.Vector3, velocity: THREE.Vector3, yaw: number): void {
    const phys = this.g.physics;
    const vel = _vel.copy(velocity);
    const torsoCentre = _centre.set(origin.x, origin.y + 1.05, origin.z);
    _q.setFromAxisAngle(UP, yaw);

    const spec: Array<{
      name: Part['name']; offset: THREE.Vector3; halfHeight: number; radius: number;
      mass: number;
    }> = [
      { name: 'torso', offset: new THREE.Vector3(0, 0, 0), halfHeight: 0.21, radius: 0.27,
        mass: 34 },
      // The neck joint is at +.33, but the helmet actually reaches +.77.
      // Centre the head capsule above its neck anchor so the brim, not an
      // invisible low sphere, meets the floor when the worker rolls over.
      { name: 'head', offset: RIG_JOINTS.head.clone().add(new THREE.Vector3(0, 0.23, 0)),
        halfHeight: 0.04, radius: 0.28,
        mass: 5 },
      { name: 'armL', offset: RIG_JOINTS.armL.clone().add(new THREE.Vector3(0, -0.26, 0)),
        halfHeight: 0.31, radius: 0.12, mass: 4 },
      { name: 'armR', offset: RIG_JOINTS.armR.clone().add(new THREE.Vector3(0, -0.26, 0)),
        halfHeight: 0.31, radius: 0.12, mass: 4 },
      { name: 'legL', offset: RIG_JOINTS.legL.clone().add(new THREE.Vector3(0, -0.28, 0)),
        halfHeight: 0.32, radius: 0.14, mass: 9 },
      { name: 'legR', offset: RIG_JOINTS.legR.clone().add(new THREE.Vector3(0, -0.28, 0)),
        halfHeight: 0.32, radius: 0.14, mass: 9 },
    ];

    const byName = new Map<string, Part>();
    for (const s of spec) {
      const pos = _partPos.copy(s.offset).applyQuaternion(_q).add(torsoCentre);
      const body = phys.createDynamic(pos, {
        quat: _q, linearDamping: 0.12, angularDamping: 0.28, ccd: true, canSleep: true,
      });
      // setMass, not setDensity(~0) + setAdditionalMass: the latter gives the
      // body mass but leaves its inertia tensor near zero, so any torque spins
      // it arbitrarily fast and the joint solver diverges. setMass derives the
      // inertia from the capsule's actual geometry.
      const desc = RAPIER.ColliderDesc.capsule(s.halfHeight, s.radius)
        .setFriction(0.7).setRestitution(0.16).setMass(s.mass);
      const collider = phys.attach(body, desc, RAGDOLL_GROUPS);
      const extraColliders: RCollider[] = [];
      if (s.name === 'torso') {
        // The voxel backpack extends 9.6 cm behind the torso capsule. Match
        // its authored bounds so a backward fall rests on the pack surface.
        extraColliders.push(phys.attach(body,
          RAPIER.ColliderDesc.cuboid(0.236, 0.283, 0.108)
            .setTranslation(0, 0, -0.258)
            .setFriction(0.7).setRestitution(0.05), RAGDOLL_GROUPS));
      }
      if (s.name === 'legL' || s.name === 'legR') {
        // The IK-driven boot sweeps around the lower-leg capsule. A round
        // contact shape follows its sole without the empty box corners that
        // held some fallen poses visibly above the floor.
        extraColliders.push(phys.attach(body,
          RAPIER.ColliderDesc.ball(0.22)
            .setTranslation(0, -0.28, 0)
            .setFriction(0.85).setRestitution(0.05), RAGDOLL_GROUPS));
      }
      if (s.name === 'armL' || s.name === 'armR') {
        // The glove is rounded; a broad cuboid's unsupported corners could
        // stop the ragdoll more than 10 cm above the visible hand.
        extraColliders.push(phys.attach(body,
          RAPIER.ColliderDesc.ball(0.15)
            .setTranslation(0, -0.38, 0)
            .setFriction(0.7).setRestitution(0.05), RAGDOLL_GROUPS));
      }
      body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
      body.applyTorqueImpulse({
        x: (Math.random() - 0.5) * s.mass * 0.32,
        y: (Math.random() - 0.5) * s.mass * 0.32,
        z: (Math.random() - 0.5) * s.mass * 0.32,
      }, true);
      const part: Part = { name: s.name, body, collider, extraColliders };
      phys.register(this, body, [collider, ...extraColliders]);
      this.parts.push(part);
      byName.set(s.name, part);
    }

    // Spherical joints hang everything off the torso. Anchors are expressed in
    // each body's local frame, which is why the offsets above are halved here.
    const torso = byName.get('torso')!;
    const link = (childName: string, jointOnTorso: THREE.Vector3, jointOnChild: THREE.Vector3) => {
      const child = byName.get(childName);
      if (!child) return;
      const params = RAPIER.JointData.spherical(
        { x: jointOnTorso.x, y: jointOnTorso.y, z: jointOnTorso.z },
        { x: jointOnChild.x, y: jointOnChild.y, z: jointOnChild.z },
      );
      const j = this.g.physics.world.createImpulseJoint(params, torso.body, child.body, true);
      this.joints.push(j);
    };
    link('head', RIG_JOINTS.head, new THREE.Vector3(0, -0.23, 0));
    link('armL', RIG_JOINTS.armL, new THREE.Vector3(0, 0.26, 0));
    link('armR', RIG_JOINTS.armR, new THREE.Vector3(0, 0.26, 0));
    link('legL', RIG_JOINTS.legL, new THREE.Vector3(0, 0.28, 0));
    link('legR', RIG_JOINTS.legR, new THREE.Vector3(0, 0.28, 0));
  }

  recover(): void {
    if (!this.active) return;
    const torso = this.parts.find((p) => p.name === 'torso');
    const t = torso?.body.translation() ?? this.g.player.position;
    const destination = this.findSafeGround(t.x, t.z, true);
    if (!destination) return;
    this.finishRecovery(destination);
  }

  /** Hold H or use the debug action to leave bad geometry without a penalty. */
  rescue(): boolean {
    const torso = this.active ? this.parts.find((p) => p.name === 'torso') : null;
    const from = torso?.body.translation() ?? this.g.player.position;
    const destination = this.findSafeGround(from.x, from.z, false);
    if (!destination) return false;
    if (this.active) this.finishRecovery(destination);
    else {
      this.releaseConflictingRopes(destination);
      this.g.player.teleport(destination);
    }
    this.safeGround.copy(destination);
    this.hasSafeGround = true;
    this.g.bus.emit('ui:toast', {
      text: 'Back on safe ground', sub: 'Your haul and progress are intact', kind: 'good', ms: 2600,
    });
    return true;
  }

  private finishRecovery(destination: THREE.Vector3): void {
    const p = this.g.player;
    this.releaseConflictingRopes(destination);
    p.teleport(destination);
    this.destroyBodies();
    this.rig.setVisible(false);
    this.timer = 0;
    this.settled = 0;
    p.state = 'active';
    p.setSimulated(true);
    p.velocity.set(0, 0, 0);
    this.g.playerCamera.setRagdoll(false, null);
    this.g.renderer.setFovOffset(0);
    this.active = false;
    this.g.bus.emit('player:recovered', { playerId: p.id });
  }

  private releaseConflictingRopes(destination: THREE.Vector3): void {
    if (!this.g.has('ropes')) return;
    this.g.get<RopeSystem>('ropes').releasePlayerConflicts(destination, this.g.player.id);
  }

  /** The old downward ray accepted any floor, including the unescapable trench. */
  private lowerRavine(x: number, z: number): boolean {
    if (z <= -70 || z >= -46) return false;
    return (x > 0 && x < 40) || (x > -35 && x < -8);
  }

  private standingGround(x: number, z: number): THREE.Vector3 | null {
    const terrain = this.g.get<Sunpatch>('world').terrain;
    const y = terrain.height(x, z);
    if (!Number.isFinite(y) || y < 0.2) return null;
    const hit = this.g.physics.raycast(
      new THREE.Vector3(x, y + 3.5, z), DOWN, 7, QueryMask.groundOnly, this.g.player.body);
    if (!hit || hit.normal.y < Math.cos(THREE.MathUtils.degToRad(45))) return null;
    const foot = new THREE.Vector3(x, hit.point.y + 0.12, z);
    const shape = new RAPIER.Capsule((STAND_HEIGHT - 2 * PLAYER_RADIUS) / 2, PLAYER_RADIUS + 0.02);
    let obstructed = false;
    this.g.physics.world.intersectionsWithShape(
      { x, y: foot.y + STAND_HEIGHT / 2, z }, { x: 0, y: 0, z: 0, w: 1 }, shape,
      (collider) => {
        if (collider.handle === this.g.player.collider.handle) return true;
        obstructed = true; return false;
      }, undefined, QueryMask.solid,
    );
    return obstructed ? null : foot;
  }

  /** Prefer the final standing spot; otherwise search nearby dry, clear ground. */
  private findSafeGround(x: number, z: number, allowHere: boolean): THREE.Vector3 | null {
    const inRavine = this.lowerRavine(x, z);
    if (allowHere && !inRavine) {
      const here = this.standingGround(x, z);
      if (here) return here;
    }
    if (inRavine) {
      const routeExit = x < 0 ? this.standingGround(-12, -43.5) : this.standingGround(14.5, -43.5);
      if (routeExit) return routeExit;
    }
    for (const radius of [4, 8, 12, 16, 22, 30, 40]) {
      for (let i = 0; i < 16; i++) {
        const a = Math.PI / 2 + i * Math.PI * 2 / 16;
        const sx = x + Math.cos(a) * radius;
        const sz = z + Math.sin(a) * radius;
        if (inRavine && sz < -46) continue;
        if (this.lowerRavine(sx, sz)) continue;
        const candidate = this.standingGround(sx, sz);
        if (candidate) return candidate;
      }
    }
    if (this.hasSafeGround) {
      const checkpoint = this.standingGround(this.safeGround.x, this.safeGround.z);
      if (checkpoint) return checkpoint;
    }
    const spawn = this.g.get<Sunpatch>('world').spawnPoint;
    return this.standingGround(spawn.x, spawn.z) ?? spawn.clone();
  }

  private rememberSafeGround(dt: number): void {
    this.safeScan -= dt;
    if (this.safeScan > 0) return;
    this.safeScan = 0.25;
    const p = this.g.player;
    if (!p.grounded || this.lowerRavine(p.position.x, p.position.z)) return;
    const ground = this.standingGround(p.position.x, p.position.z);
    if (!ground || Math.abs(ground.y - p.position.y) > 0.7) return;
    this.safeGround.copy(ground);
    this.hasSafeGround = true;
  }

  private destroyBodies(): void {
    for (const j of this.joints) this.g.physics.world.removeImpulseJoint(j, false);
    this.joints.length = 0;
    for (const part of this.parts) {
      this.g.physics.removeBody(part.body, [part.collider, ...part.extraColliders]);
    }
    this.parts.length = 0;
  }

  // ---- fruit strikes ------------------------------------------------------
  /**
   * Fruit landing on someone is the single funniest thing in the game, so it
   * gets a detector that cannot silently stop working.
   *
   * This deliberately does NOT use Rapier's contact-force events: measured, a
   * coconut striking the kinematic player capsule collides correctly (its speed
   * drops from 14.4 m/s to 0) but produces no contact-force event we receive.
   * Velocity actually lost, plus proximity to the capsule, is both simpler and
   * exactly the quantity the joke depends on.
   */
  private checkFruitStrikes(): void {
    const p = this.g.player;
    if (p.state !== 'active') return;
    const r = PLAYER_RADIUS;
    const footY = p.position.y + r;
    const headY = p.position.y + Math.max(p.height - r, r + 0.01);

    for (const f of this.fruitSys.fruits.values()) {
      if (f.state !== 'free' || f.lastDeltaV < 3.5) continue;
      // Distance from the fruit centre to the capsule's core segment.
      const cy = clamp(f.position.y, footY, headY);
      const dx = f.position.x - p.position.x;
      const dz = f.position.z - p.position.z;
      const dy = f.position.y - cy;
      const reach = f.radius + r + 0.3;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;

      // Heavier and faster hurts more; a fruit's own danger flag lowers the bar.
      const punch = f.lastDeltaV * clamp(f.mass / 3, 0.4, 3.4);
      // World gravity is -22, so a coconut is already doing 11.5 m/s after a
      // three-metre fall: at the old bar of 13 you were flattened by anything
      // that came off any palm, from any height, every time. Raising it puts
      // a legible band underneath — short drops bonk, long ones flatten —
      // which is what makes the knockdown read as a consequence rather than
      // as the weather.
      const threshold = f.def.dangerous ? 18 : 26;
      const onHead = f.position.y > headY - 0.28;
      if (punch < threshold) {
        // Not a knockdown, but it still landed on you.
        //
        // This is the ONLY place in the game that reliably knows a fruit hit
        // the player — Rapier gives us no contact-force event for the
        // kinematic capsule, so `fruit:impact`'s `onPlayer` flag is never
        // actually set and everything hanging off it was dead code. An apple
        // to the head used to produce precisely nothing: no camera movement,
        // no vignette, no reaction of any kind. Now every hit registers and
        // only the big ones flatten you, which is the readable version of
        // "knockdown must not be frustrating".
        if (this.hitCooldown <= 0 && f.lastDeltaV > 4.5) {
          this.hitCooldown = 0.25;
          this.g.bus.emit('player:hit', {
            momentum: f.mass * f.lastDeltaV,
            fromAbove: onHead,
            point: f.position.clone(),
          });
        }
        continue;
      }

      _v.copy(f.velocity).multiplyScalar(clamp(f.mass / 20, 0.25, 1.2));
      _v.y = Math.max(_v.y, 2.4);
      this.trigger(punch, onHead ? `${f.displayName} (head)` : f.displayName, _v);
      return;
    }
  }
  /** Seconds until another sub-knockdown hit may be reported. */
  private hitCooldown = 0;

  // ---- loop ---------------------------------------------------------------
  fixedStep(dt: number): void {
    const holdingRescue = this.g.input.frame.rescue
      && !this.g.get<{ open: boolean }>('shop').open
      && !this.g.get<{ open: boolean }>('book').open;
    if (!holdingRescue) { this.rescueHold = 0; this.rescueLatched = false; }
    else if (!this.rescueLatched) {
      this.rescueHold += dt;
      if (this.rescueHold >= 1.25) {
        this.rescueLatched = true;
        this.rescue();
        return;
      }
    }
    if (this.hitCooldown > 0) this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    if (!this.active) { this.rememberSafeGround(dt); this.checkFruitStrikes(); return; }
    this.timer += dt;
    if (this.timer < this.minTime) return;
    // Get up once the torso has calmed down, or after the hard cap regardless.
    // Only the torso is checked: limbs on spherical joints keep twitching well
    // after the body has visibly stopped, which used to hold recovery open for
    // the entire timeout.
    const torso = this.parts.find((p) => p.name === 'torso');
    const v = torso ? torso.body.linvel() : { x: 0, y: 0, z: 0 };
    const speed = Math.hypot(v.x, v.y, v.z);

    // Safety net. A jointed ragdoll that diverges would otherwise strand the
    // player somewhere unreachable, which is the one failure mode that is not
    // funny. Bail out and stand them up at the last sane position.
    if (torso) {
      const t = torso.body.translation();
      if (!Number.isFinite(t.x + t.y + t.z) || speed > 120 || Math.abs(t.y) > 900) {
        torso.body.setTranslation(
          { x: this.lastSanePos.x, y: this.lastSanePos.y, z: this.lastSanePos.z }, true);
        torso.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.g.bus.emit('debug:log', { text: 'ragdoll diverged; recovered defensively' });
        this.recover();
        return;
      }
      if (speed < 60) this.lastSanePos.set(t.x, t.y, t.z);
    }
    this.settled = speed < 1.1 ? this.settled + dt : 0;
    const wantsUp = this.g.input.frame.jumpPressed || this.g.input.frame.interactPressed;
    if (this.settled > 0.28 || this.timer > this.maxTime || (wantsUp && this.timer > this.minTime)) {
      this.recover();
    }
  }

  frameUpdate(): void {
    if (!this.active) return;
    const poses = {} as Record<RigPartName, RigidPose>;
    for (const part of this.parts) {
      const t = part.body.translation();
      const r = part.body.rotation();
      poses[part.name] = {
        position: new THREE.Vector3(t.x, t.y, t.z),
        quaternion: new THREE.Quaternion(r.x, r.y, r.z, r.w),
      };
      if (part.name === 'head') {
        // The camera derives a stable chase offset from this physical anchor.
        this.anchor.position.set(t.x, t.y + 0.1, t.z);
      }
    }
    this.rig.posePhysics(poses);
  }

  dispose(): void {
    this.destroyBodies();
    this.rig.dispose();
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

const TAUNTS = [
  'FLATTENED', 'DOWN YOU GO', 'OCCUPATIONAL HAZARD', 'THAT WAS AVOIDABLE',
  'WORKPLACE INCIDENT', 'FULL SEND', 'GRAVITY WINS',
];
function pickTaunt(source: string): string {
  if (/coconut/i.test(source)) return 'HEADACHE';
  if (/watermelon|melon/i.test(source)) return 'CRUSHED';
  if (source === 'fall') return 'GRAVITY WINS';
  return TAUNTS[Math.floor(Math.random() * TAUNTS.length)];
}
