import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Game, System } from '@/core/Game';
import type { Sunpatch } from '@/world/Sunpatch';
import type { RopeSystem, Rope } from './RopeSystem';
import type { Economy } from './Economy';
import type { KingVine } from '@/boss/KingVine';
import type { RBody, PhysicsOwner } from '@/physics/PhysicsWorld';
import type { Deny } from '@/net/FruitAuthority';
import { Groups } from '@/physics/Layers';
import { Palette } from '@/render/Palette';
import { KING_MELON_RADIUS } from '@/world/Landmarks';
import { clamp, damp } from '@/core/MathUtils';
import type { VisualMode } from '@/art/voxel/VisualMode';
import { QueryMask } from '@/physics/Layers';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KING_MELON_CUT_ROW } from '@/world/LegendaryLayout';

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

/** A single noncolliding mesh of separated amber pieces just inside the
 * authoritative circular pad. The gaps make the extraction boundary readable
 * against grass without inventing another physics target. */
export function buildVoxelExtractionBorderGeometry(radius: number): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [], colors: number[] = [];
  const inner = radius - 1.0, outer = radius - 0.18;
  const height = 0.10;
  const pale = new THREE.Color().setHex(0xffd67a, THREE.SRGBColorSpace);
  const dark = new THREE.Color().setHex(0xc4863e, THREE.SRGBColorSpace);
  const add = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3,
    normal: THREE.Vector3, tint: THREE.Color): void => {
    for (const point of [a, b, c]) {
      positions.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
      colors.push(tint.r, tint.g, tint.b);
    }
  };
  for (let i = 0; i < 24; i++) {
    const step = Math.PI * 2 / 24;
    const a0 = (i + 0.10) * step, a1 = (i + 0.90) * step;
    const point = (r: number, a: number, y: number) =>
      new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    const i0 = point(inner, a0, height), i1 = point(inner, a1, height);
    const o0 = point(outer, a0, height), o1 = point(outer, a1, height);
    const b0 = point(outer, a0, 0), b1 = point(outer, a1, 0);
    const tint = i % 2 ? dark : pale;
    const side = tint.clone().multiplyScalar(0.72);
    const up = new THREE.Vector3(0, 1, 0);
    const outward = new THREE.Vector3(Math.cos((a0 + a1) * 0.5), 0,
      Math.sin((a0 + a1) * 0.5));
    add(i0, o1, o0, up, tint); add(i0, i1, o1, up, tint);
    add(b0, o1, b1, outward, side); add(b0, o0, o1, outward, side);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = 'VoxelExtractionBorder';
  return geometry;
}

/** Amber planks mark the receiving apron at the open timber cradle. Each
 * vertex follows the ground; the former horizontal disk was mostly buried. */
export function buildExtractionApronGeometry(height: (x: number, z: number) => number): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  const stripe = (ax: number, az: number, bx: number, bz: number): void => {
    const length = Math.hypot(bx - ax, bz - az), count = Math.ceil(length / 1.1);
    for (let i = 0; i < count; i++) {
      const fraction = (i + .5) / count;
      const geometry = new THREE.BoxGeometry(length / count * .78, .10, .28);
      geometry.rotateY(-Math.atan2(bz - az, bx - ax));
      geometry.translate(ax + (bx - ax) * fraction, .13, az + (bz - az) * fraction);
      const p = geometry.attributes.position;
      for (let j = 0; j < p.count; j++) p.setY(j, p.getY(j) + height(p.getX(j), p.getZ(j)));
      geometry.computeVertexNormals(); pieces.push(geometry);
    }
  };
  stripe(4, -47, 18, -47); stripe(18, -47, 18, -44);
  stripe(18, -44, 4, -44); stripe(4, -44, 4, -47);
  // Approach arrows point down the fall line into the cradle.
  stripe(9, -49.5, 11.5, -47.8); stripe(14, -49.5, 11.5, -47.8);
  const geometry = mergeGeometries(pieces, false)!;
  for (const piece of pieces) piece.dispose();
  geometry.name = 'TerrainFollowingExtractionApron';
  return geometry;
}

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
  /** Ropes that controlled the drop, retained for payout after release. */
  dtc: number;
  /** Dollars paid on completion, 0 until then. */
  paid: number;
  /** Bumped on every reset so a client rebuilds rather than diffs. */
  gen: number;
}

/** What the legendary needs from the network layer. Null in single player. */
export interface LegendaryNet {
  readonly authoritative: boolean;
  anyoneHasRopeGun(): boolean;
  requestLegendary(intent: { kind: 'lcut'; vine: number;
    at: [number, number, number]; dir: [number, number, number] }): void;
}

/**
 * THE KING MELON.
 *
 * Explicitly not a health bar. Every phase is a physical problem:
 *
 *   PREPARE  subdue the King Vine that guards the stem
 *   TETHER   cut the holding vines; optional ropes can tame the fall
 *   DETACH   cut the vines; every cut shifts the load onto the ones left
 *   DROP     two and a half tonnes goes where physics says, not where you hoped
 *   RECOVER  get it into the extraction pad down the ravine
 *   PAYOUT
 *
 * The direct action route needs no Rope Gun. Tethers still give a more
 * controlled drop and a payout bonus; zero ropes leaves a short ground haul.
 *
 * A TETHER IS A ROPE, NOT A METHOD CALL. The first version kept its own list
 * that only a debug action ever appended to, so a player could rope the melon
 * four times and the cut gate still said "restrain it first". Tethers now come from the rope
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
  constructor(private readonly visualMode: VisualMode = 'baseline') {}

  private g!: Game;
  private world!: Sunpatch;
  private ropes!: RopeSystem;
  private economy!: Economy;
  private boss: KingVine | null = null;
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
  /** Ropes that actually controlled the drop, retained after they are released. */
  dropTetherCount = 0;
  cutVines = 0;
  restStart = -1;
  private extractionRestStart = -1;
  private submergedAt = -1;
  private failedAt = -1;
  /** Game time the last vine went; the drop has a clock of its own. */
  private dropStart = -1;
  completedAt = -1;
  lastPayout = 0;
  generation = 0;
  extractionPad = new THREE.Vector3();
  extractionRadius = 15;
  private padMesh: THREE.Mesh | null = null;
  private padBorder: THREE.Mesh | null = null;
  private anchors: THREE.Vector3[] = [];
  private cutRootVisuals: Array<{ group: THREE.Group; stem: THREE.Mesh; label: THREE.Sprite }> = [];
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
    this.boss = g.has('kingVine') ? g.get<KingVine>('kingVine') : null;

    this.mesh = this.world.built.kingMelon;
    this.homePosition.copy(this.world.kingMelonPos);
    this.setupExtractionPad();
    this.build();

    g.debug?.addProbe('legendary', () => ({
      phase: this.phase,
      vines: this.vines.length,
      cut: this.cutVines,
      tethers: this.tethers.length,
      dropTetherCount: this.dropTetherCount,
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
          this.requestCut(this.vineIdx[i]);
        } else {
          const deny = this.cutGate();
          if (deny) { this.refuse(deny); break; }
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
      cutPoints: this.cutPoints(),
    }));
  }

  /** True when this peer runs the state machine and pays out. */
  get authoritative(): boolean { return !this.net || this.net.authoritative; }
  /** Extraction unlocks only after the King Vine is subdued. */
  get guardianSubdued(): boolean { return this.boss?.subdued ?? false; }

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
      if (travelled >= 20) { landing = cursor.clone(); break; }
      landing = cursor.clone();
    }
    this.extractionPad.set(landing.x, this.world.terrain.height(landing.x, landing.z), landing.z);

    const geo = buildExtractionApronGeometry((x, z) => this.world.terrain.height(x, z));
    const mat = new THREE.MeshStandardMaterial({
      color: Palette.gold, roughness: 0.85, transparent: true, opacity: 0.8,
      emissive: 0x50310c, emissiveIntensity: 0.16,
    });
    this.padMesh = new THREE.Mesh(geo, mat);
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
    this.buildCutRoots();
  }

  /** Four deliberate cutting ties beside the existing ravine staging board.
   * The load-bearing vine endpoints stay exactly where physics authored them. */
  cutPoints(): Array<{ vine: number; position: [number, number, number]; remaining: boolean }> {
    return [0, 1, 2, 3].map(vine => {
      const x = KING_MELON_CUT_ROW.x + vine * KING_MELON_CUT_ROW.spacing, z = KING_MELON_CUT_ROW.z;
      return { vine, position: [x, this.world.terrain.height(x, z) + 1.18, z],
        remaining: this.vineIdx.includes(vine) };
    });
  }

  private clearCutRoots(): void {
    for (const { group } of this.cutRootVisuals) {
      group.removeFromParent();
      group.traverse(object => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
        if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if ('map' in material) (material.map as THREE.Texture | null)?.dispose();
            material.dispose();
          }
        }
      });
    }
    this.cutRootVisuals = [];
  }

  private buildCutRoots(): void {
    this.clearCutRoots();
    const up = new THREE.Vector3(0, 1, 0);
    const segment = (a: THREE.Vector3, b: THREE.Vector3, width: number) => {
      const delta = b.clone().sub(a);
      const geometry = new THREE.BoxGeometry(width, Math.max(.01, delta.length()), width);
      geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, delta.normalize()));
      geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      return geometry;
    };
    for (const point of this.cutPoints()) {
      const [x, y, z] = point.position, base = y - 1.18;
      const group = new THREE.Group(); group.name = `KingMelonCutTie${point.vine + 1}`;
      const anchor = this.anchors[point.vine];
      const pieces: THREE.BufferGeometry[] = [];
      const radial = new THREE.Vector3(x - anchor.x, 0, z - anchor.z).normalize();
      const foot = anchor.clone().addScaledVector(radial, 4.4);
      foot.y = this.world.terrain.height(foot.x, foot.z) + .13;
      let previous = new THREE.Vector3(x, base + .13, z);
      const steps = Math.ceil(Math.hypot(foot.x - x, foot.z - z) / 1.1);
      for (let i = 1; i <= steps; i++) {
        const next = new THREE.Vector3(x, 0, z).lerp(foot, i / steps);
        next.y = this.world.terrain.height(next.x, next.z) + .13;
        pieces.push(segment(previous, next, .16)); previous = next;
      }
      const anchorGround = this.world.terrain.height(anchor.x, anchor.z);
      for (const [fraction, radius] of [[.12, 3.7], [.36, 3.05], [.39, 2.55],
        [.66, 2.1], [.69, 1.7], [.91, 1.3], [1, .85]]) {
        const next = anchor.clone().addScaledVector(radial, radius + .25);
        next.y = anchorGround + (anchor.y - anchorGround + .6) * fraction;
        pieces.push(segment(previous, next, .17)); previous = next;
      }
      pieces.push(segment(previous, anchor, .17));
      const trail = new THREE.Mesh(mergeGeometries(pieces),
        new THREE.MeshStandardMaterial({ color: VINE_COLOR, roughness: 1 }));
      pieces.forEach(piece => piece.dispose());
      trail.name = `VineRootTrail${point.vine + 1}`; group.add(trail);
      const stump = new THREE.Mesh(new THREE.BoxGeometry(.46, .55, .46),
        new THREE.MeshStandardMaterial({ color: 0x47692d, roughness: 1 }));
      stump.position.set(x, base + .275, z); group.add(stump);
      const stem = new THREE.Mesh(new THREE.BoxGeometry(.34, .94, .34),
        new THREE.MeshStandardMaterial({ color: 0x72a044, roughness: 1 }));
      stem.position.set(x, base + .93, z); group.add(stem);
      const band = new THREE.Mesh(new THREE.BoxGeometry(.49, .20, .49),
        new THREE.MeshStandardMaterial({ color: 0xf1bd52, roughness: .85 }));
      band.position.y = .25; stem.add(band);
      const plate = document.createElement('canvas'); plate.width = 256; plate.height = 96;
      const ink = plate.getContext('2d')!;
      ink.fillStyle = '#d8a347'; ink.fillRect(0, 0, 256, 96);
      ink.fillStyle = '#273d29'; ink.fillRect(6, 6, 244, 84);
      ink.fillStyle = '#ffe2a1'; ink.font = 'bold 48px sans-serif';
      ink.textAlign = 'center'; ink.textBaseline = 'middle';
      ink.fillText(`CUT ${point.vine + 1}`, 128, 49);
      const texture = new THREE.CanvasTexture(plate); texture.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
      // Keep the billboard above the stem: at a downward close-up angle the
      // physical gold band otherwise crosses the label's lettering.
      label.position.set(x, base + 1.70, z + .30); label.scale.set(.78, .2925, 1);
      group.add(label); this.g.renderer.scene.add(group);
      this.cutRootVisuals.push({ group, stem, label });
    }
  }

  reset(): void {
    if (this.padMesh) this.padMesh.visible = false;
    if (this.padBorder) this.padBorder.visible = false;
    for (const v of this.vines) this.ropes.remove(v.id, 'cut');
    // Every rope on the melon goes with it: tethers, leashes, other peers'
    // copies of both. On a client the host's snapshot would drop the shared
    // ones anyway; doing it here means a new attempt starts clean at once.
    for (const r of this.ropes.attachedTo(this.id)) this.ropes.remove(r.id, 'gone', !this.authoritative);
    this.vines.length = 0;
    this.vineIdx.length = 0;
    this.tethers.length = 0;
    this.lastTetherCount = 0;
    this.dropTetherCount = 0;
    this.cutVines = 0;
    this.restStart = -1;
    this.extractionRestStart = -1;
    this.submergedAt = -1;
    this.failedAt = -1;
    this.announced.delete('ridge-recovery');
    this.dropStart = -1;
    this.lastPayout = 0;
    this.firstSightAt = -1;
    this.phase = 'prepare';
    this.generation++;
    if (this.body) this.g.physics.removeBody(this.body);
    this.body = null;
    this.build();
  }

  // ---- interaction --------------------------------------------------------
  /** The vine the player is looking at, within cutting range. */
  private findVineUnderCrosshair(): Rope | null {
    const p = this.g.player;
    _eye.copy(p.eyePosition);
    p.lookDir(_dir);
    let best: Rope | null = null;
    let bestScore = Infinity;
    for (const v of this.vines) {
      const i = this.vines.indexOf(v);
      const contact = this.cutContact(this.vineIdx[i], _eye, _dir);
      if (contact && contact.distanceTo(_eye) < bestScore) {
        bestScore = contact.distanceTo(_eye); best = v;
      }
    }
    return best;
  }

  /** Shared aim check for the local E key and host-validated client requests. */
  validateCutAim(vine: number, origin: THREE.Vector3, direction: THREE.Vector3): boolean {
    return this.cutContact(vine, origin, direction) !== null;
  }

  private cutContact(vine: number, origin: THREE.Vector3, direction: THREE.Vector3): THREE.Vector3 | null {
    const index = this.vineIdx.indexOf(vine);
    if (index < 0 || ![...origin.toArray(), ...direction.toArray()].every(Number.isFinite)
      || direction.lengthSq() < .01) return null;
    const dir = direction.clone().normalize();
    const visible = (point: THREE.Vector3, reach: number, tolerance: number): boolean => {
      const delta = point.clone().sub(origin), length = delta.length(), along = delta.dot(dir);
      if (length > reach || along <= 0 || delta.clone().addScaledVector(dir, -along).length() > tolerance)
        return false;
      const hit = this.g.physics.raycast(origin, delta.divideScalar(length),
        length, QueryMask.solid, this.g.player.body);
      return !hit || hit.distance >= length - .08;
    };
    const point = new THREE.Vector3(...this.cutPoints()[vine].position);
    if (visible(point, 3.4, .38)) return point;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    this.ropes.endpoints(this.vines[index], a, b);
    for (let i = 0; i <= 12; i++) {
      const sample = a.clone().lerp(b, i / 12);
      if (visible(sample, 7, 1.4)) return sample;
    }
    return null;
  }

  private requestCut(vine: number): void {
    const p = this.g.player, direction = p.lookDir(new THREE.Vector3());
    this.net!.requestLegendary({ kind: 'lcut', vine,
      at: p.eyePosition.toArray() as [number, number, number],
      dir: direction.toArray() as [number, number, number] });
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
    const vine = this.findVineUnderCrosshair();
    if (!vine) return 'no-fruit';
    if (!this.authoritative) {
      const i = this.vines.indexOf(vine);
      if (i < 0) return 'no-fruit';
      this.requestCut(this.vineIdx[i]);
      return null;
    }
    const deny = this.cutGate();
    if (deny) { this.refuse(deny); return deny; }
    this.cutVine(vine);
    return null;
  }

  /** The boss is the cut gate. Ropes are an optional drop-control tactic. */
  private cutGate(): Deny | null {
    if (!this.guardianSubdued) return 'wrong-phase';
    if (this.phase !== 'tether' && this.phase !== 'detach') return 'wrong-phase';
    return null;
  }

  /** Say why a cut did not happen. Clients hear this from the host. */
  refuse(deny: Deny): void {
    if (deny === 'wrong-phase') {
      this.g.bus.emit('ui:toast', this.guardianSubdued
        ? { text: 'Not now', ms: 1400 }
        : { text: 'King Vine guards the stem', sub: 'Subdue it before cutting the holding vines',
          kind: 'bad', ms: 2600 });
    }
  }

  private cutVine(vine: Rope, present = true): void {
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

    if (present) {
      this.g.playerCamera.addShake(0.05 + this.cutVines * 0.02, 0.7, 18);
      this.g.bus.emit('audio:sfx', { name: 'ropeSnap', volume: 1 });
      this.g.bus.emit('ui:toast', {
        text: `VINE ${this.cutVines} OF ${this.cutVines + this.vines.length} CUT`,
        sub: this.vines.length === 1 ? 'One left. It will not hold.'
          : this.vines.length === 0 ? 'Nothing is holding it now.'
            : `${this.vines.length} still holding`,
        kind: this.vines.length <= 1 ? 'bad' : 'info', ms: 2800,
      });
    }

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
    this.dropTetherCount = this.tethers.length >= this.requiredTethers ? this.tethers.length : 0;
    if (this.body) {
      this.body.setLinearDamping(0.12);
      this.body.setAngularDamping(0.35);
    }
    if (this.dropTetherCount > 0) {
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
      this.armTethers();
      this.g.bus.emit('ui:celebrate', {
        title: 'LOWER IT',
        sub: high >= this.requiredTethers ? 'THE ROPES ARE HOLDING — FOR NOW'
          : high > 0 ? 'ONE ROPE IS BELOW IT. HOLD ON.' : 'EVERY ROPE IS BELOW IT. HOLD ON.',
        kind: 'legendary',
      });
    } else {
      const hadRope = this.tethers.length > 0;
      for (const tether of this.tethers) {
        this.g.bus.emit('rope:snapped', { ropeId: tether.id });
        this.ropes.remove(tether.id, 'snapped');
      }
      this.tethers.length = 0;
      if (hadRope) this.g.bus.emit('audio:sfx', { name: 'ropeSnap', volume: 1 });
      this.g.bus.emit('ui:celebrate', {
        title: 'IT IS COMING DOWN',
        sub: hadRope ? 'THE ROPE PARTED — FOLLOW IT TO THE PAD' : 'FOLLOW IT TO THE PAD',
        kind: 'legendary',
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
          + (n >= this.requiredTethers ? 'Enough for a controlled drop.' : 'Another makes the drop gentler.'),
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
  remoteCut(vine: number, near: (x: number, y: number, z: number, range: number) => boolean,
    origin?: THREE.Vector3, direction?: THREE.Vector3): Deny | null {
    if (!this.body) return 'no-fruit';
    const i = this.vineIdx.indexOf(vine);
    if (i < 0) return 'no-fruit';
    if (!origin || !direction || !near(origin.x, origin.y, origin.z, 2.8)
      || !this.validateCutAim(vine, origin, direction)) return 'out-of-reach';
    const deny = this.cutGate();
    if (deny) return deny;
    this.cutVine(this.vines[i]);
    return null;
  }

  /**
   * Take the slack out of every tether and rate it for two and a half tonnes.
   *
   * Shared by the drop itself and by a host promoted into one: the ratings the
   * old host raised at `beginDrop` live on the OLD HOST'S copies of the ropes,
   * and a promoted client's own tethers are still rated for a watermelon.
   */
  private armTethers(): void {
    for (const tether of this.tethers) {
      tether.maxTension = 1e9;
      this.ropes.endpoints(tether, _a, _b);
      this.ropes.setLength(tether.id, Math.max(tether.minLength, _a.distanceTo(_b)));
      this.ropes.setReel(tether.id, 3.2);
    }
  }

  /**
   * Promoted to host in the middle of the encounter.
   *
   * Everything the encounter is ABOUT arrives in the snapshot and has already
   * been applied: the phase, which vines are cut, where the melon is, what it
   * paid, which attempt this is. One thing does not, and cannot: a client
   * holds the melon as a FIXED body and teleports it wherever the host says,
   * because the real one is two and a half tonnes that only the host solves.
   * A fixed melon under a promoted host is a legendary fruit hanging in the
   * air that no rope, shove or winch will ever move again.
   *
   * Nothing here re-runs a phase. `complete` pays in exactly one place and
   * guards on the phase it has already reached, so a promotion during the
   * payout inherits it rather than repeating it.
   */
  adoptAuthority(): void {
    if (!this.authoritative || !this.body) return;
    // Draw from the body again, not from the host's last reported transform.
    this.hasRemoteTarget = false;
    this.remoteGen = -1;
    this.syncTethers();
    const moving = this.phase === 'drop' || this.phase === 'recover';
    this.extractionRestStart = -1;
    this.submergedAt = -1;
    this.failedAt = -1;
    if (moving || this.cutVines > 0) {
      if (this.body.isFixed()) this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      this.body.wakeUp();
    }
    if (moving) {
      // The damping `beginDrop` set, which a client never had cause to apply.
      this.body.setLinearDamping(0.12);
      this.body.setAngularDamping(0.35);
    }
    if (this.phase === 'drop') {
      // How long it has already been falling was the old host's measurement.
      // Restarting the clock only delays the eight-second "it is down"
      // fallback; the stillness test is what normally ends the phase.
      this.dropStart = this.g.clock.elapsed;
      this.restStart = -1;
      this.armTethers();
    }
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
      req: this.requiredTethers, dtc: this.dropTetherCount,
      paid: this.lastPayout, gen: this.generation,
    };
  }

  // ---- co-op: client side -------------------------------------------------
  /** Make the local copy agree with the host. */
  applyNet(s: LegendaryNetState): void {
    if (this.authoritative || !this.body) return;
    const live = this.remoteGen >= 0;
    if (this.remoteGen !== s.gen) {
      // A new attempt, or our first sight of this one: start from the seed.
      if (this.remoteGen >= 0 || this.cutVines > 0) this.reset();
      this.remoteGen = s.gen;
    }
    this.requiredTethers = s.req;
    this.dropTetherCount = Math.max(0, s.dtc ?? 0);
    // A first snapshot restores history silently; subsequent cuts are live.
    for (let i = this.vines.length - 1; i >= 0; i--) {
      if (!(s.vm & (1 << this.vineIdx[i]))) this.cutVine(this.vines[i], live);
    }
    // The melon goes where the host says. The body is fixed on a client, so
    // this is a teleport for the physics and a damp for the eye.
    this.remoteTarget.set(s.p[0], s.p[1], s.p[2]);
    this.remoteQuat.set(s.q[0], s.q[1], s.q[2], s.q[3]);
    this.hasRemoteTarget = true;
    this.body.setTranslation({ x: s.p[0], y: s.p[1], z: s.p[2] }, false);
    this.body.setRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }, false);
    const phase = PHASES[s.ph] ?? 'prepare';
    if (!live) {
      this.phase = phase;
      this.announced.add(phase);
      if (phase === 'complete' && this.padMesh) {
        (this.padMesh.material as THREE.MeshStandardMaterial).color.set(0x66dd88);
      }
    } else if (phase !== this.phase) {
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
    if (next !== 'prepare' && next !== 'tether' && next !== 'detach') this.lookingAtVine = null;
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
    const bonus = Math.round(PAYOUT * (1 + this.dropTetherCount * 0.12));
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
    this.failedAt = this.g.clock.elapsed;
    this.g.bus.emit('ui:toast', {
      text: 'THE KING MELON IS GONE', sub: `${reason} It will regrow in 25 seconds — try again at the vine ties.`,
      kind: 'bad', ms: 7000,
    });
  }

  // ---- loop ---------------------------------------------------------------
  fixedStep(dt: number): void {
    if (!this.body) return;
    void dt;

    const canInteract = this.g.player.state === 'active' && this.g.input.enabled;
    if (!this.authoritative) {
      // A client: aim, ask, and count. The host decides everything else.
      this.lookingAtVine = canInteract && this.guardianSubdued ? this.findVineUnderCrosshair() : null;
      if (canInteract && this.lookingAtVine && this.g.input.frame.interactPressed) this.tryCut();
      this.syncTethers();
      return;
    }

    // Retry follows game time and survives host promotion. The guardian stays
    // subdued; only the physical harvest attempt regrows.
    if (this.phase === 'failed') {
      if (this.failedAt < 0) this.failedAt = this.g.clock.elapsed;
      if (this.g.clock.elapsed - this.failedAt >= 25) this.reset();
      return;
    }

    this.syncTethers();

    if (this.phase === 'prepare' || this.phase === 'tether' || this.phase === 'detach') {
      if (this.phase === 'prepare' && this.guardianSubdued) this.setPhase('tether');
      this.lookingAtVine = canInteract && this.guardianSubdued ? this.findVineUnderCrosshair() : null;
      if (canInteract && this.lookingAtVine && this.g.input.frame.interactPressed) this.tryCut();
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
        this.extractionRestStart = this.extractionRestStart < 0
          ? this.g.clock.elapsed : this.extractionRestStart;
        if (this.g.clock.elapsed - this.extractionRestStart > 1.4) this.complete();
      } else {
        this.extractionRestStart = -1;
      }
      // A radius-5.6 sphere rests with its center ABOVE a shallow basin. The
      // old center<-6 check could never notice this unrecoverable wet landing.
      const settledInWater = t.y < MELON_RADIUS * .4 && speed < 1.2
        && this.world.terrain.height(t.x, t.z) < -1.5;
      this.submergedAt = settledInWater
        ? (this.submergedAt < 0 ? this.g.clock.elapsed : this.submergedAt) : -1;
      if (t.y < -6 || (this.submergedAt >= 0 && this.g.clock.elapsed - this.submergedAt > 4)) {
        this.fail('It settled too deep in the water.');
      }
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

    this.updatePadVisuals();
    for (let i = 0; i < this.cutRootVisuals.length; i++) {
      const remaining = this.vineIdx.includes(i), visual = this.cutRootVisuals[i];
      visual.stem.visible = remaining; visual.label.visible = remaining;
    }

    // Prompts, only when the player is close enough to act.
    const p = this.g.player;
    const t = this.body.translation();
    const dist = Math.hypot(t.x - p.position.x, t.z - p.position.z);
    if (dist > 60) return;
    if (this.lookingAtVine) {
      this.g.bus.emit('ui:prompt', { text: '<b>E</b> Cut the vine tie', priority: 'action' });
    } else if (this.phase === 'prepare' && dist < 40) {
      if (this.firstSightAt < 0) this.firstSightAt = this.g.clock.elapsed;
      if (this.g.clock.elapsed - this.firstSightAt < 4.5) {
        this.g.bus.emit('ui:prompt', {
          text: '<b>Subdue King Vine</b> — dodge its warning, then hit the exposed stem', priority: 'hint',
        });
      }
    } else if ((this.phase === 'tether' || this.phase === 'detach') && this.heldRopesToMelon().length) {
      // An optional rope can control the fall only when pinned to rock above.
      this.g.bus.emit('ui:prompt', {
        text: `Optional: pin to rock <b>above</b> it for a gentler drop — <b>right-click</b> · tethers <b>${this.tethers.length}/${this.requiredTethers}</b>`,
        priority: 'context',
      });
    } else if (this.phase === 'recover' && dist < 40) {
      if (t.y > 30 && t.z < -64 && !this.announced.has('ridge-recovery')) {
        this.announced.add('ridge-recovery');
        this.g.bus.emit('ui:toast', {
          text: 'THE MELON LANDED ON THE RIDGE',
          sub: 'Follow the marked path behind the hill farm, then push it downhill into the timber receiver.',
          kind: 'gold', ms: 8000,
        });
      }
      const d = this.distanceToPad();
      this.g.bus.emit('ui:prompt', {
        text: `Get it to the pad — <b>${d.toFixed(0)} m</b>`,
        priority: 'context',
      });
    }
  }

  private updatePadVisuals(): void {
    if (!this.padMesh) return;
    const active = this.phase === 'drop' || this.phase === 'recover';
    this.padMesh.visible = active || this.phase === 'complete';
    if (this.padBorder) this.padBorder.visible = this.padMesh.visible;
    if (active) {
      const pulse = 0.78 + Math.sin(performance.now() / 380) * 0.12;
      (this.padMesh.material as THREE.MeshStandardMaterial).opacity = pulse;
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

  serialize(): { phase: string; completedAt: number; payout?: number;
    position?: [number, number, number]; rotation?: [number, number, number, number] } {
    const saved: ReturnType<LegendaryHarvest['serialize']> = {
      phase: this.phase, completedAt: this.completedAt,
    };
    if (this.phase === 'complete' && this.body) {
      const p = this.body.translation(), q = this.body.rotation();
      saved.position = [p.x, p.y, p.z];
      saved.rotation = [q.x, q.y, q.z, q.w];
      saved.payout = this.lastPayout;
    }
    return saved;
  }
  deserialize(d: { phase?: string; completedAt?: number; payout?: number;
    position?: [number, number, number]; rotation?: [number, number, number, number] }): void {
    if (d.phase === 'complete') {
      this.phase = 'complete';
      this.completedAt = d.completedAt ?? 0;
      this.lastPayout = Number.isFinite(d.payout) && d.payout! > 0 ? d.payout! : PAYOUT;
      // A fresh build hangs the melon from four vines. A completed save must
      // restore the extracted world state, including saves from before the
      // final transform was recorded.
      this.cutVines += this.vines.length;
      for (const vine of this.vines) this.ropes.remove(vine.id, 'cut');
      this.vines.length = 0;
      this.vineIdx.length = 0;
      const p = Array.isArray(d.position) && d.position.length === 3
        && d.position.every(Number.isFinite) ? d.position
        : [this.extractionPad.x, this.extractionPad.y + MELON_RADIUS + 0.2, this.extractionPad.z];
      const q = Array.isArray(d.rotation) && d.rotation.length === 4
        && d.rotation.every(Number.isFinite) ? d.rotation : [0, 0, 0, 1];
      this.body?.setTranslation({ x: p[0], y: p[1], z: p[2] }, false);
      this.body?.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, false);
      this.mesh.position.set(p[0], p[1], p[2]);
      this.mesh.quaternion.set(q[0], q[1], q[2], q[3]);
      if (this.padMesh) (this.padMesh.material as THREE.MeshStandardMaterial).color.set(0x66dd88);
    }
  }

  dispose(): void {
    this.clearCutRoots();
    for (const mesh of [this.padBorder, this.padMesh]) {
      if (!mesh) continue;
      this.g?.renderer?.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.padBorder = null;
    this.padMesh = null;
  }
}

const PHASE_BLURB: Partial<Record<LegendaryPhase, { title: string; sub: string }>> = {
  tether: { title: 'PHASE 1 — FREE THE FRUIT', sub: 'Cut its vines. Ropes to the towers can control the drop, but are optional.' },
  detach: { title: 'PHASE 2 — CUT THE VINES', sub: 'Every cut puts more load on the rest' },
  drop: { title: 'PHASE 3 — FOLLOW THE DROP', sub: 'Two and a half tonnes, going where it wants' },
  recover: { title: 'PHASE 4 — GET IT TO THE PAD', sub: 'Push, rope, winch, or shout at it' },
};

function len(v: { x: number; y: number; z: number }): number {
  return Math.hypot(v.x, v.y, v.z);
}
