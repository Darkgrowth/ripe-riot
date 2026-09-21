import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Game, System } from '@/core/Game';
import type { RBody, RCollider, PhysicsOwner } from '@/physics/PhysicsWorld';
import { groups, Layer } from '@/physics/Layers';
import { makePlayerRig, RIG_JOINTS, type PlayerRig } from './PlayerRig';
import type { FruitSystem } from '@/fruit/FruitSystem';
import { clamp } from '@/core/MathUtils';
import { PLAYER_RADIUS } from './PlayerController';

/** Ragdoll parts collide with the world but never with each other. */
const RAGDOLL_GROUPS = groups(
  Layer.PLAYER,
  Layer.WORLD | Layer.PROP | Layer.PLANT | Layer.FRUIT | Layer.VEHICLE,
);

interface Part {
  name: keyof PlayerRig & string;
  body: RBody;
  collider: RCollider;
  mesh: THREE.Mesh;
  /** Offset from the body's centre to the mesh origin. */
  meshOffset: THREE.Vector3;
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
  lastSpeed = 0;

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
      mass: number; mesh: THREE.Mesh; meshOffset: THREE.Vector3;
    }> = [
      { name: 'torso', offset: new THREE.Vector3(0, 0, 0), halfHeight: 0.16, radius: 0.24,
        mass: 34, mesh: this.rig.torso, meshOffset: new THREE.Vector3(0, 0, 0) },
      { name: 'head', offset: RIG_JOINTS.head.clone(), halfHeight: 0.04, radius: 0.19,
        mass: 5, mesh: this.rig.head, meshOffset: new THREE.Vector3(0, -0.12, 0) },
      { name: 'armL', offset: RIG_JOINTS.armL.clone().add(new THREE.Vector3(0, -0.26, 0)),
        halfHeight: 0.20, radius: 0.10, mass: 4, mesh: this.rig.armL,
        meshOffset: new THREE.Vector3(0, 0.26, 0) },
      { name: 'armR', offset: RIG_JOINTS.armR.clone().add(new THREE.Vector3(0, -0.26, 0)),
        halfHeight: 0.20, radius: 0.10, mass: 4, mesh: this.rig.armR,
        meshOffset: new THREE.Vector3(0, 0.26, 0) },
      { name: 'legL', offset: RIG_JOINTS.legL.clone().add(new THREE.Vector3(0, -0.28, 0)),
        halfHeight: 0.22, radius: 0.12, mass: 9, mesh: this.rig.legL,
        meshOffset: new THREE.Vector3(0, 0.28, 0) },
      { name: 'legR', offset: RIG_JOINTS.legR.clone().add(new THREE.Vector3(0, -0.28, 0)),
        halfHeight: 0.22, radius: 0.12, mass: 9, mesh: this.rig.legR,
        meshOffset: new THREE.Vector3(0, 0.28, 0) },
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
      body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
      body.applyTorqueImpulse({
        x: (Math.random() - 0.5) * s.mass * 0.32,
        y: (Math.random() - 0.5) * s.mass * 0.32,
        z: (Math.random() - 0.5) * s.mass * 0.32,
      }, true);
      const part: Part = { name: s.name, body, collider, mesh: s.mesh, meshOffset: s.meshOffset };
      phys.register(this, body, [collider]);
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
    link('head', RIG_JOINTS.head, new THREE.Vector3(0, 0, 0));
    link('armL', RIG_JOINTS.armL, new THREE.Vector3(0, 0.26, 0));
    link('armR', RIG_JOINTS.armR, new THREE.Vector3(0, 0.26, 0));
    link('legL', RIG_JOINTS.legL, new THREE.Vector3(0, 0.28, 0));
    link('legR', RIG_JOINTS.legR, new THREE.Vector3(0, 0.28, 0));
  }

  recover(): void {
    if (!this.active) return;
    const torso = this.parts.find((p) => p.name === 'torso');
    const p = this.g.player;
    if (torso) {
      const t = torso.body.translation();
      // Stand up where the torso ended up, lifted clear of the ground.
      _v.set(t.x, t.y + 0.15, t.z);
      const hit = this.g.physics.raycast(
        _v.clone().setY(_v.y + 2.5), DOWN, 8, 0xffff_ffff, null);
      if (hit) _v.y = hit.point.y + 0.06;
      p.teleport(_v);
    }
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

  private destroyBodies(): void {
    for (const j of this.joints) this.g.physics.world.removeImpulseJoint(j, false);
    this.joints.length = 0;
    for (const part of this.parts) {
      this.g.physics.removeBody(part.body, [part.collider]);
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
    if (this.hitCooldown > 0) this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    if (!this.active) { this.checkFruitStrikes(); return; }
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
    for (const part of this.parts) {
      const t = part.body.translation();
      const r = part.body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      _v.copy(part.meshOffset).applyQuaternion(_q);
      part.mesh.position.set(t.x + _v.x, t.y + _v.y, t.z + _v.z);
      part.mesh.quaternion.copy(_q);
      if (part.name === 'head') {
        // The camera derives a stable chase offset from this physical anchor.
        this.anchor.position.set(t.x, t.y + 0.1, t.z);
      }
    }
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
