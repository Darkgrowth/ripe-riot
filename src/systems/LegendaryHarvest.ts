import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Game, System } from '@/core/Game';
import type { Sunpatch } from '@/world/Sunpatch';
import type { RopeSystem, Rope } from './RopeSystem';
import type { Economy } from './Economy';
import type { ToolInventory } from '@/tools/ToolInventory';
import type { RBody, PhysicsOwner } from '@/physics/PhysicsWorld';
import type { Deny } from '@/net/FruitAuthority';
import { Groups } from '@/physics/Layers';
import { Palette } from '@/render/Palette';
import { KING_MELON_RADIUS } from '@/world/Landmarks';
import { clamp, damp } from '@/core/MathUtils';

export type LegendaryPhase = 'prepare' | 'tether' | 'detach' | 'drop' | 'recover' | 'complete' | 'failed';
const PHASES: LegendaryPhase[] = ['prepare', 'tether', 'detach', 'drop', 'recover', 'complete', 'failed'];

const VINE_COLOR = new THREE.Color().setHex(0x4e8a2e, THREE.SRGBColorSpace);
export const MELON_MASS = 2600;
const MELON_RADIUS = KING_MELON_RADIUS;
export const PAYOUT = 9500;
/** How far a tether's anchor may be from the melon, for both peers' sanity. */
export const TETHER_RANGE = 46;

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * The legendary's state as it travels. Deliberately the minimum two peers
 * need to AGREE about: which phase, which vines are left, where the melon is,
 * and whether it has paid out. Nothing cosmetic — the client draws its own
 * vines and plays its own sounds off these. The tethers are not here at all
 * any more: they are ropes, and ropes travel as ropes.
 */
export interface LegendaryNetState {
  /** Index into PHASES. */
  ph: number;
  /** Bitmask of the vines still holding, by anchor index. */
  vm: number;
  p: [number, number, number];
  q: [number, number, number, number];
  req: number;
  /** Dollars paid on completion, 0 until then. */
  paid: number;
  /** Bumped on every reset so a client rebuilds rather than diffs. */
  gen: number;
}

/** What the legendary needs from the network layer. Null in single player. */
export interface LegendaryNet {
  readonly authoritative: boolean;
  anyoneHasRopeGun(): boolean;
  requestLegendary(intent: { kind: 'lcut'; vine: number }): void;
}

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
 *
 * A TETHER IS A ROPE, NOT A METHOD CALL. The first version kept its own list
 * that only a debug action ever appended to, so the rope gun — the tool the
 * whole encounter is gated on — could rope the melon four times and the cut
 * gate still said "restrain it first". Tethers are now read off the rope
 * system every step: any rope on the melon that is not a vine and is not in
 * somebody's hands counts. Fire at the melon, pin the near end to rock, and
 * that is a tether; a rope you are still holding is a leash, and it says so.
 *
 * In co-op the HOST runs this state machine and pays once. Clients mirror the
 * state in `LegendaryNetState`, send cuts as intents, and keep their melon
 * fixed where the host says it is. Tethers need nothing special: a rope on
 * the melon is a shared rope like any other, so a client's pin arrives on the
 * host as a rope and the host counts it the same way it counts its own.
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
  net: LegendaryNet | null = null;

  phase: LegendaryPhase = 'prepare';
  body: RBody | null = null;
  mesh!: THREE.Mesh;
  vines: Rope[] = [];
  /** Anchor index of each entry in `vines`, kept in step with it. */
  private vineIdx: number[] = [];
  /** Ropes restraining it: derived from the rope system, never appended to. */
  tethers: Rope[] = [];
  requiredTethers = 2;
  cutVines = 0;
  restStart = -1;
  /** Game time the last vine went; the drop has a clock of its own. */
  private dropStart = -1;
  completedAt = -1;
  lastPayout = 0;
  generation = 0;
  extractionPad = new THREE.Vector3();
  extractionRadius = 15;
  private padMesh: THREE.Mesh | null = null;
  private anchors: THREE.Vector3[] = [];
  private homePosition = new THREE.Vector3();
  private lookingAtVine: Rope | null = null;
  private announced = new Set<string>();
  private lastTetherCount = 0;
  /** Client: the melon transform the host last reported, damped into the mesh. */
  private remoteTarget = new THREE.Vector3();
  private remoteQuat = new THREE.Quaternion();
  private hasRemoteTarget = false;
  /** Client: the newest state applied, for the probe. */
  private remoteGen = -1;
  /** Game time the player first came near enough to be told what this is. */
  firstSightAt = -1;

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
      held: this.heldRopesToMelon().length,
      authoritative: this.authoritative,
      gen: this.generation,
      remoteGen: this.remoteGen,
      paid: this.lastPayout,
      pos: this.body ? [
        +this.body.translation().x.toFixed(1),
        +this.body.translation().y.toFixed(1),
        +this.body.translation().z.toFixed(1)] : null,
      speed: this.body ? +len(this.body.linvel()).toFixed(2) : 0,
      mass: this.body ? +this.body.mass().toFixed(0) : 0,
      fixed: this.body ? this.body.isFixed() : null,
      inPad: this.inExtraction(),
      distanceToPad: this.body ? +this.distanceToPad().toFixed(1) : null,
      highTethers: this.tethers.filter((r) => this.tetherIsHigh(r)).length,
      firstSight: +this.firstSightAt.toFixed(1),
    }));
    /** Cut the next vine, skipping the aim but not the authority: on a
     *  client this asks the host, exactly as the E key would. */
    g.debug?.addAction('legendary.cut', (n = 1) => {
      for (let i = 0; i < n && this.vines.length; i++) {
        if (!this.authoritative) {
          this.net!.requestLegendary({ kind: 'lcut', vine: this.vineIdx[i] });
        } else {
          this.cutVine(this.vines[0]);
        }
      }
      return this.cutVines;
    });
    /** Cut the way a player does: the vine under the crosshair, through the gate. */
    g.debug?.addAction('legendary.cutLooking', () => this.tryCut());
    g.debug?.addAction('legendary.phase', () => this.phase);
    g.debug?.addAction('legendary.tether', () => this.attachTetherFromPlayer());
    g.debug?.addAction('legendary.reset', () => { this.reset(); return this.phase; });
    g.debug?.addAction('legendary.nudge', (x: number, y: number, z: number) => {
      this.body?.applyImpulse({ x: x * MELON_MASS, y: y * MELON_MASS, z: z * MELON_MASS }, true);
      return true;
    });
    /** Put the melon somewhere, at rest. Host only: a client's copy goes
     *  where the host says and nowhere else. Stands in for the haul in tests
     *  that are about the payout rather than the physics. */
    g.debug?.addAction('legendary.place', (x: number, y: number, z: number) => {
      if (!this.authoritative || !this.body) return false;
      this.body.setTranslation({ x, y, z }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      return true;
    });
    g.debug?.addAction('legendary.info', () => ({
      home: [this.homePosition.x, this.homePosition.y, this.homePosition.z],
      pad: [this.extractionPad.x, this.extractionPad.y, this.extractionPad.z],
      padRadius: this.extractionRadius,
      anchors: this.anchors.map((a) => [+a.x.toFixed(1), +a.y.toFixed(1), +a.z.toFixed(1)]),
    }));
  }

  /** True when this peer runs the state machine and pays out. */
  get authoritative(): boolean { return !this.net || this.net.authoritative; }

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
    // instant the player commits to cutting. On a client it never does: the
    // host simulates it and the client's copy is moved where the host says.
    this.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);

    // Four vines out to the ravine walls. Their lengths are set so the melon
    // hangs still: the sequence only starts moving when one is cut.
    const km = this.homePosition;
    this.anchors = this.world.built.kingMelonAnchors.map((a) => a.clone());
    this.anchors.forEach((anchor, i) => {
      const attach = new THREE.Vector3(0, MELON_RADIUS * 0.5, 0);
      // Length is the EXACT rest distance from this anchor to this attach
      // point, so all four vines are taut from the first frame. Deriving it
      // from the melon's centre instead left each vine with a different amount
      // of slack; only the shortest ever engaged, and the melon simply
      // pendulumed seventeen metres down around it.
      const length = anchor.distanceTo(_v.copy(km).add(attach));
      // Vines are grown by every peer from the seed and cut by bitmask, so
      // they never travel as ropes.
      const rope = this.ropes.create(
        { kind: 'world', local: anchor.clone(), ownerId: -1 },
        { kind: 'legendary', local: attach, ownerId: this.id },
        length,
        { color: VINE_COLOR, radius: 0.32, cuttable: true, maxTension: 1e9, shared: false },
      );
      this.vines.push(rope);
      this.vineIdx.push(i);
    });
    this.mesh.position.copy(this.homePosition);
    this.mesh.quaternion.identity();
    this.hasRemoteTarget = false;
  }

  reset(): void {
    for (const v of this.vines) this.ropes.remove(v.id, 'cut');
    // Every rope on the melon goes with it: tethers, leashes, other peers'
    // copies of both. On a client the host's snapshot would drop the shared
    // ones anyway; doing it here means a new attempt starts clean at once.
    for (const r of this.ropes.attachedTo(this.id)) this.ropes.remove(r.id, 'gone', !this.authoritative);
    this.vines.length = 0;
    this.vineIdx.length = 0;
    this.tethers.length = 0;
    this.lastTetherCount = 0;
    this.cutVines = 0;
    this.restStart = -1;
    this.dropStart = -1;
    this.lastPayout = 0;
    this.phase = 'prepare';
    this.generation++;
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

  /** Every rope this player is still holding that ends on the melon. */
  private heldRopesToMelon(): Rope[] {
    return this.ropes.attachedTo(this.id).filter((r) => r.heldByPlayer);
  }

  /**
   * Cut the vine under the crosshair, the way the E key does. Returns why not,
   * or null when it cut (or asked the host to).
   */
  tryCut(): Deny | null {
    const vine = this.lookingAtVine ?? this.findVineUnderCrosshair();
    if (!vine) return 'no-fruit';
    if (!this.authoritative) {
      const i = this.vines.indexOf(vine);
      if (i < 0) return 'no-fruit';
      this.net!.requestLegendary({ kind: 'lcut', vine: this.vineIdx[i] });
      return null;
    }
    const deny = this.cutGate();
    if (deny) { this.refuse(deny); return deny; }
    this.cutVine(vine);
    return null;
  }

  /** The rule that makes the tethers matter. */
  private cutGate(): Deny | null {
    if (this.phase !== 'tether' && this.phase !== 'detach') return 'wrong-phase';
    if (this.tethers.length < this.requiredTethers && this.vines.length <= 2) return 'restrain-first';
    return null;
  }

  /** Say why a cut did not happen. Clients hear this from the host. */
  refuse(deny: Deny): void {
    if (deny === 'restrain-first') {
      this.g.bus.emit('ui:toast', {
        text: 'Restrain it first',
        sub: `${this.tethers.length}/${this.requiredTethers} tethers — pin ropes to rock, not to yourself`,
        kind: 'bad', ms: 2600,
      });
    } else if (deny === 'wrong-phase') {
      this.g.bus.emit('ui:toast', { text: 'Not now', ms: 1400 });
    }
  }

  private cutVine(vine: Rope): void {
    const i = this.vines.indexOf(vine);
    if (i < 0) return;
    this.vines.splice(i, 1);
    this.vineIdx.splice(i, 1);
    this.ropes.remove(vine.id, 'cut');
    this.cutVines++;
    if (this.authoritative) {
      if (this.body?.isFixed()) this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      this.body?.wakeUp();
    }

    this.g.playerCamera.addShake(0.05 + this.cutVines * 0.02, 0.7, 18);
    this.g.bus.emit('audio:sfx', { name: 'ropeSnap', volume: 1 });
    this.g.bus.emit('ui:toast', {
      text: `VINE ${this.cutVines} OF ${this.cutVines + this.vines.length} CUT`,
      sub: this.vines.length === 1 ? 'One left. It will not hold.'
        : this.vines.length === 0 ? 'Nothing is holding it now.'
          : `${this.vines.length} still holding`,
      kind: this.vines.length <= 1 ? 'bad' : 'info', ms: 2800,
    });

    if (!this.authoritative) return;
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
    this.dropStart = this.g.clock.elapsed;
    if (this.body) {
      this.body.setLinearDamping(0.12);
      this.body.setAngularDamping(0.35);
    }
    if (this.tethers.length >= this.requiredTethers) {
      // The encounter takes the ropes over. A rope gun's line is rated for a
      // watermelon, not two and a half tonnes; what "enough tethers" buys is
      // that together they hold, and pay out rather than part.
      //
      // They are also winched TAUT at this moment. A rope with slack in it
      // does nothing until the melon has fallen through the slack, and a rope
      // to a low anchor never reaches the end of it at all; taking the slack
      // up is what makes a tether do something from the first metre — lower
      // the melon if its anchor is above it, swing it toward the rim if the
      // anchor is below, which is the failure the design wants to be funny.
      const high = this.tethers.filter((r) => this.tetherIsHigh(r)).length;
      for (const tether of this.tethers) {
        tether.maxTension = 1e9;
        this.ropes.endpoints(tether, _a, _b);
        this.ropes.setLength(tether.id, Math.max(tether.minLength, _a.distanceTo(_b)));
        this.ropes.setReel(tether.id, 3.2);
      }
      this.g.bus.emit('ui:celebrate', {
        title: 'LOWER IT',
        sub: high >= this.requiredTethers ? 'THE ROPES ARE HOLDING — FOR NOW'
          : high > 0 ? 'ONE ROPE IS BELOW IT. HOLD ON.' : 'EVERY ROPE IS BELOW IT. HOLD ON.',
        kind: 'legendary',
      });
    } else {
      for (const tether of this.tethers) {
        this.g.bus.emit('rope:snapped', { ropeId: tether.id });
        this.ropes.remove(tether.id, 'snapped');
      }
      this.tethers.length = 0;
      this.g.bus.emit('audio:sfx', { name: 'ropeSnap', volume: 1 });
      this.g.bus.emit('ui:celebrate', {
        title: 'IT IS COMING DOWN', sub: 'NOT ENOUGH ROPE', kind: 'legendary',
      });
    }
  }

  /**
   * Wire a restraining rope from where the player stands to the melon. The
   * debug path; a player does the same thing with the rope gun and a pin.
   * On a client this is an ordinary shared rope: it goes to the host as a
   * rope request and comes back counted.
   */
  attachTetherFromPlayer(): boolean {
    if (!this.body) return false;
    const p = this.g.player;
    const at = p.position.clone().setY(p.position.y + 0.6);
    const rope = this.makeTether(at, 0, 1e9);
    if (!rope) {
      this.g.bus.emit('ui:toast', { text: 'Too far to tether', ms: 1600 });
      return false;
    }
    this.syncTethers();
    return true;
  }

  /** A fixed anchor to the melon. `len` 0 means "taut from here". */
  private makeTether(at: THREE.Vector3, length: number, rating: number): Rope | null {
    if (!this.body) return null;
    const t = this.body.translation();
    const dist = _v.set(t.x, t.y, t.z).distanceTo(at);
    if (dist > TETHER_RANGE) return null;
    return this.ropes.create(
      { kind: 'world', local: at.clone(), ownerId: -1 },
      { kind: 'legendary', local: new THREE.Vector3(0, 0, 0), ownerId: this.id },
      length > 0 ? length : Math.max(6, dist * 1.05),
      { maxTension: rating, radius: 0.09 },
    );
  }

  /**
   * Read the tethers off the rope system.
   *
   * A rope counts when it ends on the melon, is not a vine, and is not still
   * in somebody's hands — this player's or anyone else's. Runs on every peer:
   * a client counts its own pins and its copies of the host's, so the
   * "TETHER 2 / 2" toast lands on the machine of the person who pinned it.
   */
  private syncTethers(): void {
    this.tethers = this.ropes.attachedTo(this.id).filter((r) =>
      !this.vines.includes(r) && !r.heldByPlayer);
    // A counted tether is the encounter's to hold or to part. A rope gun's
    // line is rated for a watermelon, and two and a half tonnes sagging onto
    // it after the second cut snapped it before the drop it was there for —
    // so the cut gate then said "restrain it first" about ropes the player
    // could see. Whether the tethers part is decided by their COUNT at the
    // drop, which is the design, not by rope physics in the detach phase.
    for (const r of this.tethers) if (r.maxTension < 1e9) r.maxTension = 1e9;
    const n = this.tethers.length;
    if (n === this.lastTetherCount) return;
    const grew = n > this.lastTetherCount;
    this.lastTetherCount = n;
    if (this.phase !== 'tether' && this.phase !== 'detach') return;
    if (grew) {
      // Say where the newest one is anchored, because it decides what the
      // rope will DO: a rope cannot lower a thing from below it.
      const newest = this.tethers[this.tethers.length - 1];
      const high = this.tetherIsHigh(newest);
      this.g.bus.emit('ui:toast', {
        text: `TETHER ${n} / ${this.requiredTethers}`,
        sub: (high ? 'Anchored above it — this one can lower it. ' : 'Anchored below it — this one will swing it. ')
          + (n >= this.requiredTethers ? 'Enough to try.' : 'Not enough yet.'),
        kind: high ? 'good' : 'info', ms: 3200,
      });
    }
  }

  /** Is this tether's fixed end above the melon's centre? Only such a rope
   *  can take the melon's weight; a rope from below can only pull it sideways. */
  private tetherIsHigh(r: Rope): boolean {
    if (!this.body) return false;
    const end = r.a.kind === 'legendary' ? r.b : r.a;
    if (!this.ropes.endPoint(end, _a)) return false;
    return _a.y > this.body.translation().y + 1.0;
  }

  // ---- co-op: host side ---------------------------------------------------
  /** A client asked to cut a vine by anchor index. */
  remoteCut(vine: number, near: (x: number, y: number, z: number, range: number) => boolean): Deny | null {
    if (!this.body) return 'no-fruit';
    const i = this.vineIdx.indexOf(vine);
    if (i < 0) return 'no-fruit';
    const t = this.body.translation();
    if (!near(t.x, t.y, t.z, TETHER_RANGE)) return 'out-of-reach';
    const deny = this.cutGate();
    if (deny) return deny;
    this.cutVine(this.vines[i]);
    return null;
  }

  /** Where the melon is, for ranging a rope aimed at it. */
  get position(): THREE.Vector3 {
    const t = this.body?.translation() ?? this.homePosition;
    return _v.set(t.x, t.y, t.z);
  }

  /** The state a client needs. Sent with every snapshot. */
  netState(): LegendaryNetState {
    const t = this.body?.translation() ?? this.homePosition;
    const q = this.body?.rotation() ?? { x: 0, y: 0, z: 0, w: 1 };
    let vm = 0;
    for (const i of this.vineIdx) vm |= 1 << i;
    return {
      ph: PHASES.indexOf(this.phase), vm,
      p: [+t.x.toFixed(2), +t.y.toFixed(2), +t.z.toFixed(2)],
      q: [+q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.w.toFixed(3)],
      req: this.requiredTethers, paid: this.lastPayout, gen: this.generation,
    };
  }

  // ---- co-op: client side -------------------------------------------------
  /** Make the local copy agree with the host. */
  applyNet(s: LegendaryNetState): void {
    if (this.authoritative || !this.body) return;
    if (this.remoteGen !== s.gen) {
      // A new attempt, or our first sight of this one: start from the seed.
      if (this.remoteGen >= 0 || this.cutVines > 0) this.reset();
      this.remoteGen = s.gen;
    }
    this.requiredTethers = s.req;
    // Vines the host has cut, by anchor index. Cutting locally plays the same
    // snap the host heard, which is the point of mirroring it as a cut rather
    // than as a vine quietly missing from the next frame.
    for (let i = this.vines.length - 1; i >= 0; i--) {
      if (!(s.vm & (1 << this.vineIdx[i]))) this.cutVine(this.vines[i]);
    }
    // The melon goes where the host says. The body is fixed on a client, so
    // this is a teleport for the physics and a damp for the eye.
    this.remoteTarget.set(s.p[0], s.p[1], s.p[2]);
    this.remoteQuat.set(s.q[0], s.q[1], s.q[2], s.q[3]);
    this.hasRemoteTarget = true;
    this.body.setTranslation({ x: s.p[0], y: s.p[1], z: s.p[2] }, false);
    this.body.setRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }, false);
    const phase = PHASES[s.ph] ?? 'prepare';
    if (phase !== this.phase) {
      const was = this.phase;
      this.setPhase(phase);
      if (phase === 'complete') this.celebrate(s.paid, was);
      if (phase === 'failed') {
        this.g.bus.emit('ui:toast', { text: 'THE KING MELON IS GONE', kind: 'bad', ms: 5000 });
      }
    }
    this.lastPayout = s.paid;
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

  /** Host only: the one place the legendary pays. */
  private complete(): void {
    if (this.phase === 'complete' || !this.authoritative) return;
    this.setPhase('complete');
    this.completedAt = this.g.clock.elapsed;
    const bonus = Math.round(PAYOUT * (1 + this.tethers.length * 0.12));
    this.lastPayout = bonus;
    this.economy.add(bonus, 'legendary');
    this.economy.addDiscovery(220);
    this.celebrate(bonus, 'recover');
  }

  /** The presentation of a completion, on every peer. */
  private celebrate(payout: number, _from: LegendaryPhase): void {
    this.g.bus.emit('legendary:complete', { id: 'kingMelon', payout });
    this.g.bus.emit('ui:celebrate', {
      title: 'LEGENDARY COMPLETE', sub: `THE KING MELON — $${payout.toLocaleString('en-US')}`, kind: 'legendary',
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
    void dt;

    if (!this.authoritative) {
      // A client: aim, ask, and count. The host decides everything else.
      this.lookingAtVine = this.findVineUnderCrosshair();
      if (this.lookingAtVine && this.g.input.frame.interactPressed) this.tryCut();
      this.syncTethers();
      return;
    }

    this.syncTethers();

    if (this.phase === 'prepare' || this.phase === 'tether' || this.phase === 'detach') {
      const hasRope = this.tools.owned.has('ropegun') || !!this.net?.anyoneHasRopeGun();
      if (this.phase === 'prepare' && hasRope) this.setPhase('tether');
      this.lookingAtVine = this.findVineUnderCrosshair();
      if (this.lookingAtVine && this.g.input.frame.interactPressed) this.tryCut();
    }

    const t = this.body.translation();
    const speed = len(this.body.linvel());

    if (this.phase === 'drop') {
      const now = this.g.clock.elapsed;
      const grounded = t.y - this.world.terrain.height(t.x, t.z) < MELON_RADIUS + 1.6;
      if (speed < 1.2) {
        this.restStart = this.restStart < 0 ? now : this.restStart;
      } else {
        this.restStart = -1;
      }
      // Down is down. It used to need a full second of stillness, and a melon
      // that four people are already shoving — or one swinging on a low
      // tether — never gets one; the phase stayed DROP with the ropes still
      // on it and nobody could tell why nothing counted.
      const settled = this.restStart >= 0 && now - this.restStart > 1.0;
      const downLongEnough = grounded && now - this.dropStart > 8;
      if (settled || downLongEnough) {
        this.setPhase('recover');
        // Cut it loose so it can be pushed, rolled and winched to the pad.
        for (const tether of this.tethers) this.ropes.remove(tether.id, 'released');
        this.tethers.length = 0;
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
  }

  frameUpdate(dt: number): void {
    if (!this.body) return;
    if (this.authoritative || !this.hasRemoteTarget) {
      const t = this.body.translation();
      const r = this.body.rotation();
      this.mesh.position.set(t.x, t.y, t.z);
      this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    } else {
      // Fifteen host updates a second, smoothed for the eye. The body itself
      // already sits at the latest report, so walking into it is honest.
      this.mesh.position.x = damp(this.mesh.position.x, this.remoteTarget.x, 12, dt);
      this.mesh.position.y = damp(this.mesh.position.y, this.remoteTarget.y, 12, dt);
      this.mesh.position.z = damp(this.mesh.position.z, this.remoteTarget.z, 12, dt);
      this.mesh.quaternion.slerp(this.remoteQuat, 1 - Math.exp(-12 * dt));
    }

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
    const t = this.body.translation();
    const dist = Math.hypot(t.x - p.position.x, t.z - p.position.z);
    if (dist > 60) return;
    if (this.lookingAtVine) {
      this.g.bus.emit('ui:prompt', { text: '<b>E</b> Cut the vine' });
    } else if (this.phase === 'prepare' && dist < 40) {
      this.g.bus.emit('ui:prompt', { text: 'You will need a <b>Rope Gun</b> for this — Merv sells one' });
    } else if ((this.phase === 'tether' || this.phase === 'detach') && this.heldRopesToMelon().length) {
      // The one thing the encounter has to teach: a rope in your hands is a
      // leash, and a leash does not restrain two and a half tonnes. The
      // second thing: rock ABOVE the melon, the towers the vines hang from.
      this.g.bus.emit('ui:prompt', {
        text: `Pin the rope to the rock towers <b>above</b> it — <b>right-click</b> · tethers <b>${this.tethers.length}/${this.requiredTethers}</b>`,
      });
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
  tether: { title: 'PHASE 1 — RESTRAIN IT', sub: 'Rope it, then pin the rope to the rock towers above it — a rope in your hands is a leash' },
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
