import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Game, System } from '@/core/Game';
import type { Sunpatch } from '@/world/Sunpatch';
import type { RopeSystem, Rope } from './RopeSystem';
import type { Economy } from './Economy';
import type { ToolInventory } from '@/tools/ToolInventory';
import type { RBody, PhysicsOwner } from '@/physics/PhysicsWorld';
import { Groups } from '@/physics/Layers';
import { Palette } from '@/render/Palette';
import { KING_MELON_RADIUS } from '@/world/Landmarks';
import { clamp } from '@/core/MathUtils';

export type LegendaryPhase = 'prepare' | 'tether' | 'detach' | 'drop' | 'recover' | 'complete' | 'failed';

const VINE_COLOR = new THREE.Color().setHex(0x4e8a2e, THREE.SRGBColorSpace);
const MELON_MASS = 2600;
const MELON_RADIUS = KING_MELON_RADIUS;
const PAYOUT = 9500;

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * THE KING MELON.
 *
 * Explicitly not a health bar. Every phase is a physical problem:
 *
 *   PREPARE  you need a rope gun, because the drop is unsurvivable without one
 *   TETHER   restrain it — each rope you attach bleeds off the fall
 *   DETACH   cut the vines; every cut shifts the load onto the ones left
 *   DROP     two and a half tonnes goes where physics says, not where you hoped
 *   RECOVER  get it into the extraction pad down the ravine
 *   PAYOUT
 *
 * Solo is possible on a reduced tether requirement rather than a separate
 * script, so a solo run is the same problem with a wider margin.
 */
export class LegendaryHarvest implements System, PhysicsOwner {
  readonly name = 'legendary';
  readonly kind = 'legendary';
  readonly id: number = -200;

  private g!: Game;
  private world!: Sunpatch;
  private ropes!: RopeSystem;
  private economy!: Economy;
  private tools!: ToolInventory;

  phase: LegendaryPhase = 'prepare';
  body: RBody | null = null;
  mesh!: THREE.Mesh;
  vines: Rope[] = [];
  /** Ropes the players have attached to restrain it. */
  tethers: Rope[] = [];
  requiredTethers = 2;
  cutVines = 0;
  restStart = -1;
  completedAt = -1;
  extractionPad = new THREE.Vector3();
  extractionRadius = 15;
  private padMesh: THREE.Mesh | null = null;
  private anchors: THREE.Vector3[] = [];
  private homePosition = new THREE.Vector3();
  private lookingAtVine: Rope | null = null;
  private announced = new Set<string>();

  init(g: Game): void {
    this.g = g;
    this.world = g.get<Sunpatch>('world');
    this.ropes = g.get<RopeSystem>('ropes');
    this.economy = g.get<Economy>('economy');
    this.tools = g.get<ToolInventory>('tools');

    this.mesh = this.world.built.kingMelon;
    this.homePosition.copy(this.world.kingMelonPos);
    this.setupExtractionPad();
    this.build();

    g.debug?.addProbe('legendary', () => ({
      phase: this.phase,
      vines: this.vines.length,
      cut: this.cutVines,
      tethers: this.tethers.length,
      required: this.requiredTethers,
      pos: this.body ? [
        +this.body.translation().x.toFixed(1),
        +this.body.translation().y.toFixed(1),
        +this.body.translation().z.toFixed(1)] : null,
      speed: this.body ? +len(this.body.linvel()).toFixed(2) : 0,
      mass: this.body ? +this.body.mass().toFixed(0) : 0,
      fixed: this.body ? this.body.isFixed() : null,
      inPad: this.inExtraction(),
      distanceToPad: this.body ? +this.distanceToPad().toFixed(1) : null,
    }));
    g.debug?.addAction('legendary.cut', (n = 1) => {
      for (let i = 0; i < n && this.vines.length; i++) this.cutVine(this.vines[0]);
      return this.cutVines;
    });
    g.debug?.addAction('legendary.phase', () => this.phase);
    g.debug?.addAction('legendary.tether', () => this.attachTetherFromPlayer());
    g.debug?.addAction('legendary.reset', () => { this.reset(); return this.phase; });
    g.debug?.addAction('legendary.nudge', (x: number, y: number, z: number) => {
      this.body?.applyImpulse({ x: x * MELON_MASS, y: y * MELON_MASS, z: z * MELON_MASS }, true);
      return true;
    });
    g.debug?.addAction('legendary.info', () => ({
      home: [this.homePosition.x, this.homePosition.y, this.homePosition.z],
      pad: [this.extractionPad.x, this.extractionPad.y, this.extractionPad.z],
      padRadius: this.extractionRadius,
      anchors: this.anchors.map((a) => [+a.x.toFixed(1), +a.y.toFixed(1), +a.z.toFixed(1)]),
    }));
  }

  // ---- construction -------------------------------------------------------
  private setupExtractionPad(): void {
    // Placed by searching the ravine floor for the lowest point a sensible
    // distance from where the melon lands, so recovering it is downhill work.
    // A hand-picked spot sat on the slope OUT of the ravine, which asked
    // players to push two and a half tonnes uphill.
    // Walk downhill from the drop site and put the pad where the terrain leads.
    //
    // Two hand-authored positions and one ring search all failed the same way:
    // they ignored which way the ground actually falls, so recovery meant
    // shoving two and a half tonnes uphill or sideways across country.
    // Following the gradient guarantees the haul is downhill, whatever the
    // terrain function does later.
    const km = this.homePosition;
    const cursor = new THREE.Vector3(km.x, 0, km.z);
    const grad = new THREE.Vector3();
    let travelled = 0;
    let landing = cursor.clone();
    for (let i = 0; i < 60 && travelled < 42; i++) {
      const e = 2.0;
      const hx = this.world.terrain.height(cursor.x + e, cursor.z)
        - this.world.terrain.height(cursor.x - e, cursor.z);
      const hz = this.world.terrain.height(cursor.x, cursor.z + e)
        - this.world.terrain.height(cursor.x, cursor.z - e);
      grad.set(-hx, 0, -hz);
      if (grad.lengthSq() < 1e-5) break;
      grad.normalize().multiplyScalar(2.0);
      const nx = cursor.x + grad.x;
      const nz = cursor.z + grad.z;
      // Stop before the sea: the extraction pad must be on dry land.
      if (this.world.terrain.height(nx, nz) < 3.5) break;
      cursor.set(nx, 0, nz);
      travelled += 2.0;
      if (travelled >= 28) { landing = cursor.clone(); break; }
      landing = cursor.clone();
    }
    this.extractionPad.set(landing.x, this.world.terrain.height(landing.x, landing.z), landing.z);

    const geo = new THREE.CylinderGeometry(this.extractionRadius, this.extractionRadius, 0.35, 28);
    const mat = new THREE.MeshStandardMaterial({
      color: Palette.gold, roughness: 0.85, transparent: true, opacity: 0.42,
    });
    this.padMesh = new THREE.Mesh(geo, mat);
    this.padMesh.position.copy(this.extractionPad).add(_v.set(0, 0.18, 0));
    this.padMesh.receiveShadow = true;
    this.padMesh.name = 'ExtractionPad';
    this.g.renderer.scene.add(this.padMesh);
  }

  private build(): void {
    const p = this.g.physics;
    this.body = p.createDynamic(this.homePosition, {
      linearDamping: 1.4, angularDamping: 2.2, ccd: true, canSleep: true,
    });
    const desc = RAPIER.ColliderDesc.ball(MELON_RADIUS)
      .setFriction(0.85).setRestitution(0.06).setMass(MELON_MASS)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(90_000);
    const col = p.attach(this.body, desc, Groups.fruit);
    p.register(this, this.body, [col]);
    // Fixed only AFTER the collider is attached. Setting the body fixed first
    // means its mass properties are never computed from the collider, and it
    // comes back as a two-and-a-half-tonne melon that weighs nothing — which
    // silently made every vine and tether unable to hold it.
    //
    // It is held fixed at all because two and a half tonnes on four
    // constraints always creeps a little, and "the legendary fruit is subtly
    // vibrating" is not the first impression to make. Physics takes over the
    // instant the player commits to cutting.
    this.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);

    // Four vines out to the ravine walls. Their lengths are set so the melon
    // hangs still: the sequence only starts moving when one is cut.
    const km = this.homePosition;
    this.anchors = this.world.built.kingMelonAnchors.map((a) => a.clone());
    for (const anchor of this.anchors) {
      const attach = new THREE.Vector3(0, MELON_RADIUS * 0.5, 0);
      // Length is the EXACT rest distance from this anchor to this attach
      // point, so all four vines are taut from the first frame. Deriving it
      // from the melon's centre instead left each vine with a different amount
      // of slack; only the shortest ever engaged, and the melon simply
      // pendulumed seventeen metres down around it.
      const len = anchor.distanceTo(_v.copy(km).add(attach));
      const rope = this.ropes.create(
        { body: null, local: anchor.clone(), ownerId: -1 },
        { body: this.body, local: attach, ownerId: this.id },
        len,
        { color: VINE_COLOR, radius: 0.32, cuttable: true, maxTension: 1e9 },
      );
      this.vines.push(rope);
    }
  }

  reset(): void {
    for (const v of this.vines) this.ropes.remove(v.id);
    for (const t of this.tethers) this.ropes.remove(t.id);
    this.vines.length = 0;
    this.tethers.length = 0;
    this.cutVines = 0;
    this.restStart = -1;
    this.phase = 'prepare';
    if (this.body) this.g.physics.removeBody(this.body);
    this.body = null;
    this.build();
  }

  // ---- interaction --------------------------------------------------------
  /** The vine the player is looking at, within cutting range. */
  private findVineUnderCrosshair(maxDist = 7): Rope | null {
    const p = this.g.player;
    _eye.copy(p.eyePosition);
    p.lookDir(_dir);
    let best: Rope | null = null;
    let bestScore = Infinity;
    for (const v of this.vines) {
      this.ropes.endpoints(v, _a, _b);
      const d = raySegmentDistance(_eye, _dir, _a, _b, maxDist);
      if (d < 1.4 && d < bestScore) { bestScore = d; best = v; }
    }
    return best;
  }

  private cutVine(vine: Rope): void {
    const i = this.vines.indexOf(vine);
    if (i < 0) return;
    this.vines.splice(i, 1);
    this.ropes.remove(vine.id);
    this.cutVines++;
    if (this.body?.isFixed()) {
      this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    }
    this.body?.wakeUp();

    this.g.playerCamera.addShake(0.05 + this.cutVines * 0.02, 0.7, 18);
    this.g.bus.emit('audio:sfx', { name: 'ropeSnap', volume: 1 });
    this.g.bus.emit('ui:toast', {
      text: `VINE ${this.cutVines} OF ${this.cutVines + this.vines.length} CUT`,
      sub: this.vines.length === 1 ? 'One left. It will not hold.'
        : this.vines.length === 0 ? 'Nothing is holding it now.'
          : `${this.vines.length} still holding`,
      kind: this.vines.length <= 1 ? 'bad' : 'info', ms: 2800,
    });

    if (this.vines.length === 0) {
      this.beginDrop();
    } else {
      this.setPhase('detach');
    }
  }

  /**
   * The drop. Enough tethers and it descends under control; too few and they
   * part and it goes wherever two and a half tonnes wants to go.
   *
   * Tethers PAY OUT rather than simply holding: an unbreakable rope that stops
   * the fall dead is not "controlling the drop", it is cancelling it, and the
   * whole phase stops being about anything.
   */
  private beginDrop(): void {
    this.setPhase('drop');
    if (this.body) {
      this.body.setLinearDamping(0.12);
      this.body.setAngularDamping(0.35);
    }
    if (this.tethers.length >= this.requiredTethers) {
      for (const tether of this.tethers) this.ropes.setReel(tether.id, 3.2);
      this.g.bus.emit('ui:celebrate', {
        title: 'LOWER IT', sub: 'THE ROPES ARE HOLDING — FOR NOW', kind: 'legendary',
      });
    } else {
      for (const tether of this.tethers) {
        this.g.bus.emit('rope:snapped', { ropeId: tether.id });
        this.ropes.remove(tether.id);
      }
      this.tethers.length = 0;
      this.g.bus.emit('audio:sfx', { name: 'ropeSnap', volume: 1 });
      this.g.bus.emit('ui:celebrate', {
        title: 'IT IS COMING DOWN', sub: 'NOT ENOUGH ROPE', kind: 'legendary',
      });
    }
  }

  /** Wire a restraining rope from the player to the melon. */
  attachTetherFromPlayer(): boolean {
    if (!this.body) return false;
    const p = this.g.player;
    const t = this.body.translation();
    _v.set(t.x, t.y, t.z);
    const dist = _v.distanceTo(p.position);
    if (dist > 46) {
      this.g.bus.emit('ui:toast', { text: 'Too far to tether', ms: 1600 });
      return false;
    }
    const rope = this.ropes.create(
      { body: null, local: p.position.clone().setY(p.position.y + 0.6), ownerId: -1 },
      { body: this.body, local: new THREE.Vector3(0, 0, 0), ownerId: this.id },
      Math.max(6, dist * 1.05),
      { maxTension: 1e9, radius: 0.09 },
    );
    this.tethers.push(rope);
    this.g.bus.emit('ui:toast', {
      text: `TETHER ${this.tethers.length} / ${this.requiredTethers}`,
      sub: this.tethers.length >= this.requiredTethers
        ? 'Enough to try it' : 'Not enough yet',
      kind: 'good', ms: 2400,
    });
    return true;
  }

  // ---- phases -------------------------------------------------------------
  private setPhase(next: LegendaryPhase): void {
    if (this.phase === next) return;
    this.phase = next;
    this.g.bus.emit('legendary:phase', { id: 'kingMelon', phase: next });
    if (!this.announced.has(next)) {
      this.announced.add(next);
      const blurb = PHASE_BLURB[next];
      if (blurb) this.g.bus.emit('ui:toast', { text: blurb.title, sub: blurb.sub, kind: 'gold', ms: 4200 });
    }
  }

  private distanceToPad(): number {
    if (!this.body) return Infinity;
    const t = this.body.translation();
    return Math.hypot(t.x - this.extractionPad.x, t.z - this.extractionPad.z);
  }

  inExtraction(): boolean {
    if (!this.body) return false;
    const t = this.body.translation();
    return this.distanceToPad() < this.extractionRadius
      && t.y > this.extractionPad.y - 4 && t.y < this.extractionPad.y + MELON_RADIUS * 2.2;
  }

  private complete(): void {
    if (this.phase === 'complete') return;
    this.setPhase('complete');
    this.completedAt = this.g.clock.elapsed;
    const bonus = Math.round(PAYOUT * (1 + this.tethers.length * 0.12));
    this.economy.add(bonus, 'legendary');
    this.economy.addDiscovery(220);
    this.g.bus.emit('legendary:complete', { id: 'kingMelon', payout: bonus });
    this.g.bus.emit('ui:celebrate', {
      title: 'LEGENDARY COMPLETE', sub: `THE KING MELON — $${bonus.toLocaleString('en-US')}`, kind: 'legendary',
    });
    this.g.bus.emit('audio:sfx', { name: 'discovery', volume: 1 });
    this.g.bus.emit('ui:toast', {
      text: 'THE KING MELON', sub: 'Nobody is going to believe this', kind: 'gold', ms: 6000,
    });
    if (this.padMesh) (this.padMesh.material as THREE.MeshStandardMaterial).color.set(0x66dd88);
  }

  private fail(reason: string): void {
    if (this.phase === 'failed' || this.phase === 'complete') return;
    this.setPhase('failed');
    this.g.bus.emit('ui:toast', {
      text: 'THE KING MELON IS GONE', sub: reason, kind: 'bad', ms: 5000,
    });
    // Soft consequences: it grows back. Losing an hour of setup is not funny.
    window.setTimeout(() => { if (this.phase === 'failed') this.reset(); }, 25_000);
  }

  // ---- loop ---------------------------------------------------------------
  fixedStep(dt: number): void {
    if (!this.body) return;

    if (this.phase === 'prepare' || this.phase === 'tether' || this.phase === 'detach') {
      const hasRope = this.tools.owned.has('ropegun');
      if (this.phase === 'prepare' && hasRope) this.setPhase('tether');
      this.lookingAtVine = this.findVineUnderCrosshair();
      if (this.lookingAtVine && this.g.input.frame.interactPressed) {
        if (this.tethers.length < this.requiredTethers && this.vines.length <= 2) {
          this.g.bus.emit('ui:toast', {
            text: 'Restrain it first',
            sub: `${this.tethers.length}/${this.requiredTethers} tethers attached`,
            kind: 'bad', ms: 2600,
          });
        } else {
          this.cutVine(this.lookingAtVine);
        }
      }
    }

    const t = this.body.translation();
    const speed = len(this.body.linvel());

    if (this.phase === 'drop') {
      if (speed < 1.2) {
        this.restStart = this.restStart < 0 ? this.g.clock.elapsed : this.restStart;
        if (this.g.clock.elapsed - this.restStart > 1.0) {
          this.setPhase('recover');
          // Cut it loose so it can be pushed, rolled and winched to the pad.
          for (const tether of this.tethers) this.ropes.remove(tether.id);
          this.tethers.length = 0;
        }
      } else {
        this.restStart = -1;
      }
    }

    if (this.phase === 'recover' || this.phase === 'drop') {
      if (this.inExtraction() && speed < 1.6) {
        this.restStart = this.restStart < 0 ? this.g.clock.elapsed : this.restStart;
        if (this.g.clock.elapsed - this.restStart > 1.4) this.complete();
      }
      if (t.y < -6) this.fail('It went into the sea.');
    }
    void dt;
  }

  frameUpdate(): void {
    if (!this.body) return;
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);

    if (this.padMesh) {
      const active = this.phase === 'drop' || this.phase === 'recover';
      this.padMesh.visible = active || this.phase === 'complete';
      if (active) {
        const pulse = 0.32 + Math.sin(performance.now() / 380) * 0.12;
        (this.padMesh.material as THREE.MeshStandardMaterial).opacity = pulse;
      }
    }

    // Prompts, only when the player is close enough to act.
    const p = this.g.player;
    const dist = Math.hypot(t.x - p.position.x, t.z - p.position.z);
    if (dist > 60) return;
    if (this.lookingAtVine) {
      this.g.bus.emit('ui:prompt', { text: '<b>E</b> Cut the vine' });
    } else if (this.phase === 'prepare' && dist < 40) {
      this.g.bus.emit('ui:prompt', { text: 'You will need a <b>Rope Gun</b> for this' });
    } else if (this.phase === 'recover' && dist < 40) {
      const d = this.distanceToPad();
      this.g.bus.emit('ui:prompt', {
        text: `Get it to the pad — <b>${d.toFixed(0)} m</b>`,
      });
    }
  }

  /** Tension on the remaining vines rises as each one is cut. */
  get loadPerVine(): number {
    return this.vines.length ? MELON_MASS / this.vines.length : Infinity;
  }

  onContact(_other: PhysicsOwner | null, impulse: number): void {
    if (impulse < 60_000) return;
    this.g.playerCamera.addShake(clamp(impulse / 900_000, 0.02, 0.12), 0.55, 16);
    this.g.bus.emit('audio:sfx', { name: 'boom', volume: 0.8 });
    if (this.body) {
      const t = this.body.translation();
      this.g.bus.emit('legendary:landed', {
        id: 'kingMelon', position: new THREE.Vector3(t.x, t.y, t.z), speed: len(this.body.linvel()),
      });
    }
  }

  serialize(): { phase: string; completedAt: number } {
    return { phase: this.phase, completedAt: this.completedAt };
  }
  deserialize(d: { phase?: string; completedAt?: number }): void {
    if (d.phase === 'complete') {
      this.phase = 'complete';
      this.completedAt = d.completedAt ?? 0;
    }
  }
}

const PHASE_BLURB: Partial<Record<LegendaryPhase, { title: string; sub: string }>> = {
  tether: { title: 'PHASE 1 — RESTRAIN IT', sub: 'Rope it to something solid before you cut anything' },
  detach: { title: 'PHASE 2 — CUT THE VINES', sub: 'Every cut puts more load on the rest' },
  drop: { title: 'PHASE 3 — CONTROL THE DROP', sub: 'Two and a half tonnes, going where it wants' },
  recover: { title: 'PHASE 4 — GET IT TO THE PAD', sub: 'Push, rope, winch, or shout at it' },
};

function len(v: { x: number; y: number; z: number }): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** Shortest distance from a ray to a segment, used for aiming at vines. */
function raySegmentDistance(origin: THREE.Vector3, dir: THREE.Vector3,
  a: THREE.Vector3, b: THREE.Vector3, maxDist: number): number {
  // Sample the segment: exact ray/segment closest-approach is overkill for a
  // 1.4 m aim tolerance, and sampling handles the sagging catenary better than
  // treating the vine as a straight line anyway.
  let best = Infinity;
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    _v.copy(a).lerp(b, i / steps);
    _v.sub(origin);
    const along = _v.dot(dir);
    if (along < 0 || along > maxDist) continue;
    const perp = Math.sqrt(Math.max(0, _v.lengthSq() - along * along));
    if (perp < best) best = perp;
  }
  return best;
}
