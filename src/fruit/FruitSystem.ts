import type { HarvestSiteDefinition } from '@/enemies/HarvestSites';
import { impulseForChaosImpact, type ChaosImpact } from '@/enemies/ChaosImpact';
import * as THREE from 'three';
import type { Game, System } from '@/core/Game';
import { Fruit } from './Fruit';
import { FruitRenderer } from './FruitRenderer';
import { FRUIT, VARIANTS, VARIANT_RATE, type FruitDef } from './FruitDefs';
import type { TraitContext } from './FruitTraits';
import { PlantSystem, type Plant } from '@/plants/Plants';
import type { PlantType } from '@/plants/PlantGeometry';
import type { Sunpatch } from '@/world/Sunpatch';
import { Rng } from '@/core/Rng';
import { QueryMask } from '@/physics/Layers';
import { buildVineSupports } from '@/world/VineSupports';
import type { VisualMode } from '@/art/voxel/VisualMode';
import { ORCHARD_RUN } from '@/world/OrchardLayout';

interface Regrow { plantId: number; nodeIndex: number; species: string; readyAt: number; }

/**
 * The authority gate, as narrow as it can be made.
 *
 * `MultiplayerAuthority` installs itself here during its own init. Everything
 * else in the game keeps calling `detach` and `shake` exactly as before; on a
 * peer that is not the host those two calls stop mutating the world and become
 * requests instead. Putting the gate at the bottom of the stack rather than at
 * each of the nine call sites is the difference between "clients cannot break
 * stems" and "clients cannot break stems yet, in the paths someone remembered".
 */
export interface NetGate {
  /** True when this peer may change shared state directly. */
  readonly authoritative: boolean;
  /** `cause` travels because the host validates a hand differently from a
   *  tool: bare hands reach 3.4 m, a shaker reaches eleven. */
  requestDetach(fruitId: number, cause: string): void;
  requestShake(plantId: number, strength: number): void;
  requestBlast(center: THREE.Vector3, radius: number, strength: number, upBias: number): void;
}

/**
 * One change to the attached population since the world was seeded: a node
 * emptied (`fruitId` -1) or refilled by regrowth with a fruit the host built.
 *
 * Attached fruit is deterministic from the seed and never travels in a
 * snapshot, which is right for 458 fruit at 15 Hz and wrong the moment a
 * branch regrows: each peer used to regrow on its own clock with its own ids,
 * so after a few minutes two players stood under the same tree looking at
 * different apples, and a joiner arriving late saw fruit the host had sold
 * an hour ago. This log is how the host's attached population reaches
 * everyone else — as a sequence of node changes, compacted per node for a
 * late joiner and streamed by sequence number after that.
 */
export interface NodeChange {
  seq: number;
  plantId: number;
  nodeIndex: number;
  fruitId: number;
  species: string;
  variant: string | null;
  sizeRoll: number;
}
/** How many recent node changes a snapshot may carry before a client resyncs. */
export const NODE_LOG_RING = 96;

interface HabitatSpec {
  landmark: string;
  plants: Array<{ type: PlantType; count: number; scale?: [number, number] }>;
  /** Extra vertical offset, for vines that hang from above. */
  lift?: number;
  /**
   * Multiplier on the rare-variant rate for everything planted here. The
   * far, high and hidden corners of the island pay better than the orchard
   * by the dock, which is what makes walking there worth the walk.
   */
  rare?: number;
}

/** Which plant grows which fruit. */
const PLANT_FRUIT: Record<PlantType, string | null> = {
  appleTree: 'apple',
  orangeTree: 'orange',
  palm: 'coconut',
  bananaPlant: 'banana',
  melonVine: 'watermelon',
  puffBush: 'puffmelon',
  vinebombVine: 'vinebomb',
  boulderBush: 'boulderplum',
  gumTree: 'gluefruit',
  spikeShrub: 'spikefruit',
};

/**
 * Sunpatch's authored planting plan, arranged as an escalation: the route
 * from the dock reaches the orchard first (apples, oranges, a few melons),
 * the beach second (coconuts, which hurt), and everything stranger is
 * inland and uphill from there — the waterfall for things that float and
 * stick, the hill farm for things that weigh, the cave and the ridge for
 * things you cannot touch, and the ravine for the one thing you came for.
 */
const HABITATS: HabitatSpec[] = [
  // Scale ranges are deliberately wide. The shipped orchard used the default
  // 0.85-1.2, and thirty trees within 30% of one height read as a plantation
  // of clones; pushing the range past 2:1 gives the canopy a skyline.
  { landmark: 'orchard', plants: [
    { type: 'appleTree', count: 26, scale: [0.78, 1.5] },
    { type: 'orangeTree', count: 10, scale: [0.8, 1.32] },
    { type: 'melonVine', count: 5 },
  ] },
  { landmark: 'hillFarm', rare: 1.4, plants: [
    { type: 'appleTree', count: 8, scale: [0.85, 1.4] },
    { type: 'melonVine', count: 5 }, { type: 'puffBush', count: 4 },
    { type: 'boulderBush', count: 3 },
  ] },
  { landmark: 'palmBeach', plants: [
    { type: 'palm', count: 17, scale: [0.8, 1.45] },
    { type: 'bananaPlant', count: 6 },
  ] },
  { landmark: 'caveOrchard', rare: 2.0, plants: [
    { type: 'palm', count: 7 }, { type: 'orangeTree', count: 4 },
    { type: 'spikeShrub', count: 4 }, { type: 'gumTree', count: 2 },
  ] },
  { landmark: 'waterfall', rare: 1.3, plants: [
    { type: 'bananaPlant', count: 7 }, { type: 'puffBush', count: 5 },
    { type: 'gumTree', count: 4 },
  ] },
  { landmark: 'ridge', rare: 2.6, plants: [
    { type: 'puffBush', count: 5 }, { type: 'boulderBush', count: 2 },
    { type: 'spikeShrub', count: 3 },
  ] },
];

/**
 * Planting that exists purely to look at: palms and broadleaf cover along the
 * dock-shop-orchard route, which crossed forty metres of empty ground.
 *
 * They are planted through the same PlantSystem as everything else, so they
 * share its instanced batches (no new draw call) and its wind sway, and they
 * simply never have `growOn` called on them — no fruit, no colliderful change
 * to the harvest loop, no new system.
 */
const DECOR: Array<{ type: PlantType; x: number; z: number; scale: number; fruit?: boolean }> = [
  // Shoreline either side of the dock head.
  { type: 'palm', x: 66.5, z: 55.0, scale: 1.25 },
  { type: 'palm', x: 64.0, z: 51.5, scale: 1.10 },
  { type: 'palm', x: 51.0, z: 70.5, scale: 1.20 },
  { type: 'palm', x: 47.0, z: 67.0, scale: 1.05 },
  // Framing the walk up to the shop, set back off the path on both sides.
  // These two CARRY coconuts: the first heavy fruit a new player meets should
  // be within sight of the shed, so the first time somebody climbs a ladder
  // and drops one on a friend happens in the first ten minutes, not on the
  // far side of the island.
  { type: 'palm', x: 52.5, z: 63.5, scale: 1.15, fruit: true },
  { type: 'palm', x: 53.5, z: 46.0, scale: 1.30, fruit: true },
  { type: 'bananaPlant', x: 43.5, z: 60.5, scale: 1.15 },
  { type: 'bananaPlant', x: 47.5, z: 45.5, scale: 1.00 },
  // The long middle stretch.
  { type: 'palm', x: 33.0, z: 57.5, scale: 1.20 },
  { type: 'palm', x: 24.0, z: 53.0, scale: 1.35 },
  { type: 'palm', x: 12.5, z: 45.5, scale: 1.25 },
  { type: 'palm', x: 8.0, z: 31.5, scale: 1.10 },
  { type: 'bananaPlant', x: 27.5, z: 41.0, scale: 1.10 },
  { type: 'puffBush', x: 21.5, z: 48.0, scale: 1.10 },
  // Orchard approach: a heavier canopy, so the trees start before the fence.
  { type: 'palm', x: 1.0, z: 38.0, scale: 1.15 },
  { type: 'bananaPlant', x: -4.0, z: 37.5, scale: 1.20 },
  { type: 'puffBush', x: -14.0, z: 36.5, scale: 1.15 },
  { type: 'bananaPlant', x: -19.5, z: 34.5, scale: 1.10 },
  // Waterfall basin shore.
  { type: 'palm', x: 44.0, z: 6.5, scale: 1.30 },
  { type: 'palm', x: 26.5, z: 7.5, scale: 1.15 },
  { type: 'bananaPlant', x: 39.5, z: -2.0, scale: 1.10 },
];

/** The single colliderless approach bush omitted from the pilot sightline. */
export function skipVoxelPilotDecor(visualMode: VisualMode,
  decor: { type: PlantType; x: number; z: number; fruit?: boolean }): boolean {
  if (visualMode !== 'voxel' || decor.fruit) return false;
  return decor.type === 'puffBush' && decor.x === -14 && decor.z === 36.5;
}

/** Vinebombs hang from anchors above the ground, so they get their own pass. */
const VINEBOMB_SITES: Array<[number, number]> = [
  [30, -26], [40, -20], [24, -6], [46, -6],
  [14, -50], [-2, -54], [22, -56], [-14, -46],
  [58, -16], [66, -4],
];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * Owns every fruit and plant on the island: spawning, the per-step trait
 * update, activation of far-away fruit, regrowth, and the instanced renderer.
 */
export class FruitSystem implements System {
  readonly name = 'fruit';
  plants!: PlantSystem;
  renderer!: FruitRenderer;
  fruits = new Map<number, Fruit>();
  private g!: Game;
  private world!: Sunpatch;
  private rng = new Rng('fruit-spawn');
  private regrow: Regrow[] = [];
  private hillHarvestPlantId = -1;
  private coopVinePlantId = -1;
  readonly harvestSites: HarvestSiteDefinition[] = [];
  beforeHarvest: ((plantId: number, cause: string) => boolean) | null = null;
  private oneTimePlants = new Set<number>();
  private ctx!: TraitContext;
  private activationTimer = 0;
  private disposeVineSupports: (() => void) | null = null;
  /** Installed by MultiplayerAuthority; null in single player, where you are
   *  the authority by definition. */
  net: NetGate | null = null;
  /** Fruit whose static collider is currently enabled. */
  private nearbyIds = new Set<number>();
  /** Highest node-change sequence number known here (issued or applied). */
  nodeSeq = 0;
  /** The recent tail of node changes, for the wire. Newest last. */
  private nodeLog: NodeChange[] = [];
  /** Latest change per node — everything a late joiner needs, bounded by node count. */
  private nodeDelta = new Map<string, NodeChange>();
  /** Fruit a node change freed that no snapshot has yet placed or dropped. */
  freedByLog = new Set<number>();
  /** Rare-variant multiplier of the habitat each plant was planted in. */
  private rareByPlant = new Map<number, number>();
  private appliedChaosImpacts = new Set<string>();
  activationRadius = 42;
  wind = new THREE.Vector3(0.6, 0, 0.35).normalize().multiplyScalar(2.2);

  stats = { attached: 0, free: 0, carried: 0, stowed: 0, total: 0 };

  constructor(private readonly visualMode: VisualMode = 'baseline') {}

  init(g: Game): void {
    this.g = g;
    this.world = g.get<Sunpatch>('world');
    this.plants = new PlantSystem(g.renderer.scene, g.physics, this.visualMode);
    this.renderer = new FruitRenderer(g.renderer.scene, this.visualMode, g.renderer.camera);
    this.ctx = {
      wind: this.wind,
      dt: 1 / 60,
      elapsed: 0,
      emit: (name, payload) => {
        (g.bus.emit as (n: string, p: unknown) => void)(name, payload);
      },
      explode: (center, radius, strength) => { g.physics.explode(center, radius, strength); },
    };
    Fruit.context = this.ctx;
    this.plants.setWind(this.wind.clone().normalize(), 0.1);
    this.populate();
    const vineOrigins = [...this.plants.all()].filter(p => p.type === 'vinebombVine').map(p => p.position);
    this.disposeVineSupports = buildVineSupports(vineOrigins, this.world.terrain, g.physics, g.renderer.scene);
    this.registerDebug();
  }

  private registerDebug(): void {
    const d = this.g.debug;
    if (!d) return;
    d.addProbe('fruit', () => ({
      ...this.stats,
      plants: this.plants.count,
      drawn: this.renderer.lastDrawn,
      species: this.renderer.speciesCount,
      drawBatches: this.renderer.activeDrawBatches,
      regrowQueued: this.regrow.length,
      byState: this.countByState(),
    }));
    d.addAction('fruit.spawn', (species: string, x: number, y: number, z: number,
      variant: string | null = null, size = 0.5) =>
      this.spawnFree(species, new THREE.Vector3(x, y, z), variant, undefined, size).id);
    d.addAction('fruit.info', (id: number) => {
      const f = this.fruits.get(id);
      if (!f) return null;
      return {
        id: f.id, species: f.species, variant: f.variant?.id ?? null, state: f.state,
        pos: [+f.position.x.toFixed(2), +f.position.y.toFixed(2), +f.position.z.toFixed(2)],
        mass: +f.mass.toFixed(2), size: +f.renderScale.toFixed(3),
        damage: +f.damage.toFixed(3), quality: f.quality, value: f.value(),
        speed: +f.speed.toFixed(2), peakSpeed: +f.maxSpeedSinceDetach.toFixed(2),
        inflate: +f.inflate.toFixed(2),
        // The two halves of the migration story, side by side: what this
        // peer's own body is doing, and what the host last said it was doing.
        // On a replica the first is all zeros and the second is not; on a
        // promoted host they have to agree, or the fruit was rebuilt at rest.
        hasBody: !!f.body,
        vel: [+f.velocity.x.toFixed(2), +f.velocity.y.toFixed(2), +f.velocity.z.toFixed(2)],
        netVel: [+f.netVel.x.toFixed(2), +f.netVel.y.toFixed(2), +f.netVel.z.toFixed(2)],
        travelled: +f.travelled.toFixed(2), peak: +f.peakHeight.toFixed(2),
        stuck: f.stuck, stuckHands: +f.stuckHands.toFixed(2),
        traits: f.traits.map((t) => t.id),
      };
    });
    // Inflation is normally a race against a two-thirds-of-a-second animation,
    // which is not a thing a test can stand still inside. This pins a Puff
    // Melon at an exact size so the carry rules can be checked at the boundary
    // rather than near it.
    d.addAction('fruit.inflate', (id: number, v: number, keepGrowing = false) => {
      const f = this.fruits.get(id);
      if (!f) return null;
      f.inflateTarget = Math.max(f.inflateTarget, v);
      f.setInflation(v);
      f.inflating = keepGrowing;
      return { inflate: +f.inflate.toFixed(3), diameter: +f.diameter.toFixed(3),
        mass: +f.mass.toFixed(2) };
    });
    d.addAction('fruit.list', (state?: string) => {
      const out: unknown[] = [];
      for (const f of this.fruits.values()) {
        if (state && f.state !== state) continue;
        out.push({ id: f.id, species: f.species, state: f.state, variant: f.variant?.id ?? null });
      }
      return out;
    });
    d.addAction('fruit.nearest', (x: number, y: number, z: number, species?: string,
      state?: string) => {
      let best: Fruit | null = null; let bestD = Infinity;
      _v.set(x, y, z);
      for (const f of this.fruits.values()) {
        if (!f.visible) continue;
        // Held fruit is not a harvest target; offering it makes callers loop.
        if (f.state === 'carried') continue;
        if (state && f.state !== state) continue;
        if (species && f.species !== species) continue;
        const dd = f.position.distanceToSquared(_v);
        if (dd < bestD) { bestD = dd; best = f; }
      }
      return best ? { id: best.id, species: best.species, state: best.state,
        pos: [+best.position.x.toFixed(2), +best.position.y.toFixed(2), +best.position.z.toFixed(2)],
        dist: +Math.sqrt(bestD).toFixed(2) } : null;
    });
    d.addAction('fruit.body', (id: number) => {
      const f = this.fruits.get(id);
      if (!f) return null;
      const b = f.body;
      return {
        hasBody: !!b,
        sleeping: b ? b.isSleeping() : null,
        colliders: f.colliders.length,
        enabled: f.colliders.map((c) => c.isEnabled()),
        groups: f.colliders.map((c) => c.collisionGroups().toString(16)),
        mass: b ? +b.mass().toFixed(3) : null,
        translation: b ? [+b.translation().x.toFixed(2), +b.translation().y.toFixed(2),
          +b.translation().z.toFixed(2)] : null,
        bodyType: b ? b.bodyType() : null,
      };
    });
    d.addAction('fruit.detach', (id: number) => {
      const f = this.fruits.get(id);
      if (!f) return false;
      this.detach(f, 'debug', -1);
      return true;
    });
    d.addAction('fruit.impulse', (id: number, x: number, y: number, z: number) => {
      const f = this.fruits.get(id);
      if (!f?.body) return false;
      f.applyImpulse(_v.set(x, y, z));
      return true;
    });
    d.addAction('fruit.despawnAllFree', () => {
      let n = 0;
      for (const f of this.fruits.values()) {
        if (f.state === 'free') { this.remove(f); n++; }
      }
      return n;
    });
    d.addAction('plant.shake', (plantId: number, strength: number) => this.shake(plantId, strength, -1));
    /** Regrow every emptied branch now, ignoring the timer and the
     *  don't-pop-in-someone's-face guard. Host only; a client has no say. */
    d.addAction('fruit.regrowNow', () => {
      if (!this.authoritative) return 0;
      let n = 0;
      for (const r of this.regrow.splice(0)) {
        const plant = this.plants.get(r.plantId);
        if (plant && this.growFruitAt(plant, r.nodeIndex, r.species, undefined, true)) n++;
      }
      return n;
    });
    d.addAction('fruit.nodeOf', (plantId: number, nodeIndex: number) =>
      this.plants.get(plantId)?.nodes[nodeIndex]?.fruitId ?? null);
    d.addAction('fruit.nodeSeq', () => this.nodeSeq);
    d.addAction('fruit.attachedIds', () => {
      const out: number[] = [];
      for (const f of this.fruits.values()) if (f.state === 'attached') out.push(f.id);
      return out.sort((a, b) => a - b);
    });
    d.addAction('plant.nearest', (x: number, y: number, z: number, type?: string,
      withFruit = false) => {
      let best: Plant | null = null; let bestD = Infinity;
      _v.set(x, y, z);
      for (const p of this.plants.all()) {
        if (type && p.type !== type) continue;
        if (withFruit && !p.nodes.some((n) => n.fruitId >= 0)) continue;
        const dd = p.position.distanceToSquared(_v);
        if (dd < bestD) { bestD = dd; best = p; }
      }
      return best ? { id: best.id, type: best.type,
        pos: [+best.position.x.toFixed(2), +best.position.y.toFixed(2), +best.position.z.toFixed(2)],
        fruit: best.nodes.filter((n) => n.fruitId >= 0).length,
        dist: +Math.sqrt(bestD).toFixed(2) } : null;
    });
    d.addAction('wind.set', (x: number, z: number, strength: number) => {
      this.setWind(new THREE.Vector3(x, 0, z).normalize(), strength);
      return strength;
    });
  }

  private countByState(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const f of this.fruits.values()) {
      const k = `${f.species}:${f.state}`;
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }

  // ---- world population ---------------------------------------------------
  private populate(): void {
    if ((this.world as Sunpatch & { orchardRun?: boolean }).orchardRun) {
      this.populateOrchardRun();
      return;
    }
    for (const h of HABITATS) {
      const lm = this.world.at(h.landmark);
      for (const spec of h.plants) {
        this.scatter(spec.type, lm.position, lm.radius, spec.count, spec.scale, h.rare ?? 1);
      }
    }
    // Decorative planting: no fruit, so no growOn — except the two marked.
    for (const d of DECOR) {
      const y = this.world.terrain.height(d.x, d.z);
      if (y < 1.0) continue;
      const p = this.plants.plant(this.g.newId(), d.type, new THREE.Vector3(d.x, y, d.z),
        this.rng, { scale: d.scale, hiddenCosmetic: skipVoxelPilotDecor(this.visualMode, d) });
      if (d.fruit) this.growOn(p);
    }
    // Hanging vinebomb vines at authored cliff sites.
    for (const [x, z] of VINEBOMB_SITES) {
      const y = this.world.terrain.height(x, z);
      if (y < 1) continue;
      const p = this.plants.plant(this.g.newId(), 'vinebombVine',
        new THREE.Vector3(x, y + 4.6, z), this.rng, { scale: this.rng.range(0.9, 1.25) });
      if (x === 22 && z === -56) {
        // Existing dry shelf west of this vine gives a missed launch somewhere
        // players can chase. A nearby area shake can release this one; the
        // other vines retain their stronger, less predictable stems.
        this.coopVinePlantId = p.id;
        p.nodes[0].grip = 0.36;
      }
      this.growOn(p);
    }
    // One repeatable hill-farm harvest sits on the shoulder above the orchard.
    // The scattered nests on the flat plateau teach the fruit's weight; this
    // one gives a released plum somewhere to roll. Keep its ordinary size and
    // value fixed so a player can choose hands, rope, or a later cannon here.
    // Placing it last leaves every existing seeded plant and fruit unchanged.
    const x = -35, z = -11.5;
    const y = this.world.terrain.height(x, z);
    const nest = this.plants.plant(this.g.newId(), 'boulderBush',
      new THREE.Vector3(x, y, z), this.rng);
    this.hillHarvestPlantId = nest.id;
    // A full area shake can release this one without forcing a hand pickup,
    // so a line pinned before detachment remains a useful plan.
    nest.nodes[0].grip = 0.85;
    this.growFruitAt(nest, 0, 'boulderplum');
    this.populateHarvestSites(nest);
    this.g.bus.emit('debug:log', {
      text: `populated: ${this.plants.count} plants, ${this.fruits.size} fruit`,
    });
  }

  /** Compact, deterministic cargo. No far-away crop population or regrowth. */
  private populateOrchardRun(): void {
    const cropRng = new Rng('orchard-extraction-v1');
    const plant = (type: PlantType, species: string, x: number, z: number,
      count: number, scale = 1, grip = .3): Plant => {
      const p = this.plants.plant(this.g.newId(), type, this.world.groundAt(x, z, 0), cropRng, { scale });
      this.oneTimePlants.add(p.id);
      this.plants.updateNodes(p, 0);
      for (let i = 0; i < Math.min(count, p.nodes.length); i++) {
        p.nodes[i].grip = grip;
        this.growFruitAt(p, i, species, { id: this.g.newId(), variantId: null, sizeRoll: .5 });
      }
      return p;
    };
    // Quiet pocket, deliberately worth less than the whole contract.
    plant('appleTree', 'apple', -15, 32, 6, .9, .18);
    plant('orangeTree', 'orange', -18, 35, 5, .95, .2);
    const loaded = plant('appleTree', 'apple', ...ORCHARD_RUN.loadedTree, 10, 1.15, .2);
    plant('orangeTree', 'orange', -28, 30, 6, 1.1, .2);
    plant('melonVine', 'watermelon', -24, 20, 2, 1.1, .15);
    const puffs = [plant('puffBush', 'puffmelon', -22, 24, 2, 1, .3),
      plant('puffBush', 'puffmelon', -28, 23, 2, 1, .3),
      plant('puffBush', 'puffmelon', -32, 19, 2, .9, .3)];
    plant('gumTree', 'gluefruit', -27, 15, 5, .9, .22);
    plant('gumTree', 'gluefruit', -31, 20, 4, .9, .22);
    plant('boulderBush', 'boulderplum', ...ORCHARD_RUN.boulderBank, 1, 1.1, .28);
    plant('boulderBush', 'boulderplum', -36, 27, 1, 1, .28);
    this.harvestSites.push({ id: 'orchard-mimic', kind: 'mimic', plantId: loaded.id,
      fruitIds: [loaded, ...puffs].flatMap(p => p.nodes.filter(n => n.fruitId >= 0).map(n => n.fruitId)),
      position: loaded.position.toArray() as [number, number, number] });
    // Canopy at the edge keeps the playable pocket visually distinct from sea.
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      const x = -23 + Math.cos(a) * 27, z = 24 + Math.sin(a) * 25;
      // Keep the crate opening and shore approach unobstructed.
      if (x > -10 && z > 19 && z < 37) continue;
      const p = this.plants.plant(this.g.newId(), i % 2 ? 'orangeTree' : 'appleTree',
        this.world.groundAt(x, z, 0), cropRng, { scale: 1.2 + (i % 3) * .12 });
      this.oneTimePlants.add(p.id);
    }
    this.g.debug?.addAction('orchard.layout', () => ({
      plants: this.plants.count,
      cargo: [...this.fruits.values()].map(f => ({ id: f.id, species: f.species,
        value: f.value(), mass: f.mass, pos: f.position.toArray(), plant: f.attach?.plantId })),
      totalValue: [...this.fruits.values()].reduce((n, f) => n + f.value(), 0),
    }));
  }

  private populateHarvestSites(hillNest: Plant): void {
    // Append after all existing seeded plants/fruit. Their IDs and random rolls
    // remain unchanged, and every peer receives the same authored identities.
    const cropRng = new Rng('sunpatch-authored-harvests');
    const x = -23, z = 25;
    const melon = this.plants.plant(this.g.newId(), 'melonVine',
      new THREE.Vector3(x, this.world.terrain.height(x, z), z), cropRng, { scale: 1.25 });
    const first = melon.nodes[0];
    first.local.set(0, .38, .3);
    for (const [nx, ny, nz] of [[-.74, .4, -.25], [.72, .4, -.3]])
      melon.nodes.push({ local: new THREE.Vector3(nx, ny, nz), world: new THREE.Vector3(),
        quat: new THREE.Quaternion(), fruitId: -1, grip: .12 });
    first.grip = .12;
    this.plants.updateNodes(melon, 0);
    for (let i = 0; i < melon.nodes.length; i++)
      this.growFruitAt(melon, i, 'watermelon', { id: this.g.newId(), variantId: null, sizeRoll: .5 });
    const cacheX = -26.8, cacheZ = 9.1;
    const cache = this.plants.plant(this.g.newId(), 'puffBush',
      new THREE.Vector3(cacheX, this.world.terrain.height(cacheX, cacheZ), cacheZ), cropRng, { scale: 1.1 });
    this.plants.updateNodes(cache, 0);
    for (let i = 0; i < Math.min(2, cache.nodes.length); i++) {
      cache.nodes[i].grip = .3;
      this.growFruitAt(cache, i, 'puffmelon', { id: this.g.newId(), variantId: null, sizeRoll: .5 });
    }
    for (const [id, kind, plant] of [
      ['orchard-mimic', 'mimic', melon], ['snapjaw-cache', 'snapjaw', cache],
      ['spitter-slope', 'spitter', hillNest],
    ] as const) {
      this.oneTimePlants.add(plant.id);
      this.harvestSites.push({ id, kind, plantId: plant.id,
        fruitIds: plant.nodes.filter(n => n.fruitId >= 0).map(n => n.fruitId),
        position: plant.position.toArray() as [number, number, number] });
    }
    // Append the collateral fruit after every established authored identity.
    // It can be picked normally, while the existing orchard site ledger tracks
    // its detached/consumed state across old and new saves.
    const puffX = -22.7, puffZ = 24.2;
    const orchardPuff = this.plants.plant(this.g.newId(), 'puffBush',
      new THREE.Vector3(puffX, this.world.terrain.height(puffX, puffZ), puffZ),
      cropRng, { scale: 0.95 });
    this.plants.updateNodes(orchardPuff, 0);
    for (let i = 0; i < Math.min(2, orchardPuff.nodes.length); i++) {
      orchardPuff.nodes[i].grip = 0.28;
      this.growFruitAt(orchardPuff, i, 'puffmelon',
        { id: this.g.newId(), variantId: null, sizeRoll: .5 });
    }
    this.oneTimePlants.add(orchardPuff.id);
    this.harvestSites.find(site => site.id === 'orchard-mimic')?.fruitIds.push(
      ...orchardPuff.nodes.filter(node => node.fruitId >= 0).map(node => node.fruitId));
  }

  private scatter(type: PlantType, center: THREE.Vector3, radius: number, count: number,
    scaleRange?: [number, number], rare = 1): void {
    const terrain = this.world.terrain;
    let placed = 0;
    let attempts = 0;
    const minGap = type === 'palm' ? 4.2 : type === 'melonVine' || type === 'boulderBush' ? 2.4 : 4.6;
    const placedPts: THREE.Vector3[] = [];
    while (placed < count && attempts < count * 60) {
      attempts++;
      // Rejection-sample a disc, biased outward so groves are not centre-heavy.
      const a = this.rng.range(0, Math.PI * 2);
      const r = radius * Math.sqrt(this.rng.range(0.04, 1));
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      const y = terrain.height(x, z);
      if (y < 1.1) continue;                       // not in the sea
      const slope = terrain.slope(x, z);
      const maxSlope = type === 'palm' ? 0.34 : 0.28;
      if (slope > maxSlope) continue;              // not on a cliff
      // Keep the worn route open. Without this the orchard grew straight
      // across its own avenue and the walk in had no readable line through it.
      if (terrain.pathWeight(x, z) > 0.28) continue;
      _v.set(x, y, z);
      let tooClose = false;
      for (const p of placedPts) {
        if (p.distanceToSquared(_v) < minGap * minGap) { tooClose = true; break; }
      }
      if (tooClose) continue;
      placedPts.push(_v.clone());
      const scale = scaleRange ? this.rng.range(scaleRange[0], scaleRange[1]) : undefined;
      const plant = this.plants.plant(this.g.newId(), type, _v.clone(), this.rng,
        scale !== undefined ? { scale } : {});
      if (rare !== 1) this.rareByPlant.set(plant.id, rare);
      this.growOn(plant);
      placed++;
    }
  }

  /** Fill a plant's attach nodes with fruit, respecting the species' yield. */
  private growOn(plant: Plant): void {
    const speciesId = PLANT_FRUIT[plant.type];
    if (!speciesId) return;
    const def = FRUIT[speciesId];
    const want = this.rng.int(def.perPlant[0], def.perPlant[1]);
    this.plants.updateNodes(plant, 0);
    const free = plant.nodes.map((_, i) => i).filter((i) => plant.nodes[i].fruitId < 0);
    shuffle(free, this.rng);
    for (let k = 0; k < Math.min(want, free.length); k++) {
      this.growFruitAt(plant, free[k], speciesId);
    }
  }

  /**
   * Grow a fruit into a node. `given` rebuilds one the host already rolled
   * (a client mirroring regrowth); `log` records the change for the wire.
   */
  private growFruitAt(plant: Plant, nodeIndex: number, speciesId: string,
    given?: { id: number; variantId: string | null; sizeRoll: number }, log = false): Fruit | null {
    const node = plant.nodes[nodeIndex];
    if (!node || node.fruitId >= 0) return null;
    // Keep the authored hill challenge hand-catchable on every regrowth.
    // Replicas still use the host's explicit recipe in `given`.
    const fixedHillPlum = plant.id === this.hillHarvestPlantId && nodeIndex === 0;
    const coopVine = plant.id === this.coopVinePlantId && nodeIndex === 0;
    const rolledVariant = given || fixedHillPlum ? null
      : this.rollVariant(this.rareByPlant.get(plant.id) ?? 1);
    const variantId = given ? given.variantId : fixedHillPlum || coopVine ? null : rolledVariant;
    const id = given ? given.id : this.g.newId();
    if (given) this.g.reserveId(id);
    const rolledSize = given || fixedHillPlum ? 0 : this.rng.next();
    const f = new Fruit(this.g.physics, id, speciesId, variantId,
      given ? given.sizeRoll : fixedHillPlum || coopVine ? 0.5 : rolledSize);
    f.attachTo({
      plantId: plant.id, nodeIndex,
      position: node.world.clone(), quaternion: node.quat.clone(),
    });
    // Keep the attach point live: the plant writes into these each frame.
    f.attach!.position = node.world;
    f.attach!.quaternion = node.quat;
    f.syncToAttachment();
    if (f.hasTrait('elastic')) {
      f.tension = this.rng.range(13, 21);
      // Always some sideways in it. Two independent draws could land near
      // zero together and fire the fruit straight up into its own vine,
      // which is a launch nobody sees and a stunt nobody can attempt.
      const ang = this.rng.range(0, Math.PI * 2);
      const lat = this.rng.range(0.35, 0.6);
      f.tensionDir.set(Math.cos(ang) * lat, 1, Math.sin(ang) * lat).normalize();
      // A hanging vine on a steep cliff can roll an upward direction that
      // still points INTO the ground. Turn only that blocked azimuth toward
      // open air; keep the tension, elevation, node position and RNG draws.
      const groundNormal = this.world.terrain.normal(f.position.x, f.position.z, _v2);
      if (f.tensionDir.dot(groundNormal) < 0) {
        f.tensionDir.x *= -1;
        f.tensionDir.z *= -1;
      }
      if (coopVine) {
        // The visible open shelf is the same target for either releaser and
        // on every regrowth. This is still the ordinary elastic launch.
        f.tension = 11;
        f.tensionDir.set(-0.9, 0.15, 0.05).normalize();
      }
    }
    node.fruitId = f.id;
    this.fruits.set(f.id, f);
    if (log) this.logNode(plant.id, nodeIndex, f);
    return f;
  }

  private rollVariant(rateMul = 1): string | null {
    if (!this.rng.chance(Math.min(0.5, VARIANT_RATE * rateMul))) return null;
    return this.rng.weighted(VARIANTS.map((v) => v.id), VARIANTS.map((v) => v.weight));
  }

  // ---- queries ------------------------------------------------------------
  get(id: number): Fruit | undefined { return this.fruits.get(id); }

  /** Attached or free fruit whose centre is inside a sphere. */
  near(point: THREE.Vector3, radius: number, out: Fruit[] = []): Fruit[] {
    out.length = 0;
    const r2 = radius * radius;
    for (const f of this.fruits.values()) {
      if (!f.visible || f.state === 'carried') continue;
      if (f.position.distanceToSquared(point) <= r2) out.push(f);
    }
    return out;
  }

  /**
   * The fruit the player is looking at: prefers whatever a ray hits, then falls
   * back to the closest fruit inside a forgiving cone. Picking should never feel
   * like a precision test.
   */
  lookTarget(eye: THREE.Vector3, dir: THREE.Vector3, maxDist: number, coneDeg = 11): Fruit | null {
    const hit = this.g.physics.raycast(eye, dir, maxDist, QueryMask.solidFruit, this.g.player.body);
    if (hit?.owner && hit.owner.kind === 'fruit') {
      const f = this.fruits.get(hit.owner.id);
      if (f && f.visible) return f;
    }
    const blocked = hit ? hit.distance : maxDist;
    const cosLimit = Math.cos(THREE.MathUtils.degToRad(coneDeg));
    let best: Fruit | null = null;
    let bestScore = -Infinity;
    for (const f of this.fruits.values()) {
      if (!f.visible || f.state === 'carried' || f.state === 'stowed') continue;
      _v.copy(f.position).sub(eye);
      const d = _v.length();
      if (d > maxDist || d > blocked + f.radius + 0.4) continue;
      _v.multiplyScalar(1 / Math.max(1e-4, d));
      const dot = _v.dot(dir);
      if (dot < cosLimit) continue;
      // Prefer close and central.
      const score = dot * 2.4 - d / maxDist;
      if (score > bestScore) { bestScore = score; best = f; }
    }
    return best;
  }

  /**
   * The first fruit along a ray, by its sphere rather than by its collider.
   *
   * Exists because a client has no collider for fruit the host simulates, so
   * a physics ray from a client's rope gun can hit a tree and never the
   * watermelon lying under it. Attached and free fruit both count; nothing in
   * anyone's hands does.
   */
  rayFruit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number):
    { fruit: Fruit; distance: number; point: THREE.Vector3 } | null {
    let best: Fruit | null = null;
    let bestT = maxDist;
    for (const f of this.fruits.values()) {
      if (f.state !== 'attached' && f.state !== 'free') continue;
      _v.copy(f.position).sub(origin);
      const along = _v.dot(dir);
      if (along < 0 || along - f.radius > bestT) continue;
      const perp2 = _v.lengthSq() - along * along;
      const r = f.radius + 0.06;
      if (perp2 > r * r) continue;
      const t = along - Math.sqrt(Math.max(0, r * r - perp2));
      if (t < bestT) { bestT = Math.max(0, t); best = f; }
    }
    if (!best) return null;
    return { fruit: best, distance: bestT, point: origin.clone().addScaledVector(dir, bestT) };
  }

  // ---- actions ------------------------------------------------------------
  /** True when this peer owns shared state. Always true in single player. */
  get authoritative(): boolean { return !this.net || this.net.authoritative; }

  /** Apply one host-owned swept encounter impact, including stems that are too
   * far from any player to have an active collider. */
  applyChaosImpact(impact: ChaosImpact, allowedAttachedIds: ReadonlySet<number> = new Set()): number[] {
    if (!this.authoritative || !impact.epoch || !Number.isSafeInteger(impact.id) || impact.id < 1) return [];
    const key = `${impact.epoch}:${impact.id}`;
    if (this.appliedChaosImpacts.has(key)) return [];
    this.appliedChaosImpacts.add(key);
    if (this.appliedChaosImpacts.size > 128) {
      const oldest = this.appliedChaosImpacts.values().next().value;
      if (oldest) this.appliedChaosImpacts.delete(oldest);
    }

    const affected: number[] = [];
    for (const f of this.fruits.values()) {
      if (f.state !== 'free' && !(f.state === 'attached' && allowedAttachedIds.has(f.id))) continue;
      const velocity = impulseForChaosImpact(impact, [f.position.x, f.position.y, f.position.z]);
      if (!velocity) continue;
      if (f.state === 'attached') this.detachAuthoritative(f, 'chaos-impact', -1, undefined, true);
      if (f.state !== 'free') continue;
      f.applyImpulse(new THREE.Vector3(...velocity).multiplyScalar(f.mass));
      affected.push(f.id);
    }
    return affected;
  }

  /**
   * Break a stem.
   *
   * On a client this does NOT break the stem: it asks the host to, and returns.
   * The fruit comes off when the host says so, one snapshot later — which for
   * the paths that matter is invisible, because picking by hand predicts the
   * carry locally and the detach is bookkeeping the player never sees.
   */
  detach(f: Fruit, cause: string, playerId = -1, inheritVel?: THREE.Vector3): void {
    if (f.state !== 'attached') return;
    if (!this.authoritative) { this.net!.requestDetach(f.id, cause); return; }
    this.detachAuthoritative(f, cause, playerId, inheritVel);
  }

  /** The mutation itself, with no authority question asked. Host only. */
  detachAuthoritative(f: Fruit, cause: string, playerId = -1, inheritVel?: THREE.Vector3, approved = false): void {
    if (f.state !== 'attached') return;
    const at = f.attach;
    if (at && !approved && this.beforeHarvest && !this.beforeHarvest(at.plantId, cause)) return;
    this.aimElastic(f, playerId);
    f.detach(this.ctx, cause, playerId, inheritVel);
    if (at) {
      const plant = this.plants.get(at.plantId);
      const node = plant?.nodes[at.nodeIndex];
      if (node && node.fruitId === f.id) {
        node.fruitId = -1;
        // Schedule regrowth so the island does not strip-mine itself.
        if (!this.oneTimePlants.has(at.plantId)) this.regrow.push({
          plantId: at.plantId, nodeIndex: at.nodeIndex, species: f.species,
          readyAt: this.g.clock.elapsed + this.rng.range(95, 190),
        });
        this.logNode(at.plantId, at.nodeIndex, null);
      }
    }
  }

  /**
   * A blast is a change to bodies the host simulates. On a client the
   * cannon's bang, kick and FOV punch all still happen — they are the
   * player's — but the fruit only moves when the host says so.
   */
  blast(center: THREE.Vector3, radius: number, strength: number, upBias: number): number {
    if (!this.authoritative) { this.net!.requestBlast(center, radius, strength, upBias); return 0; }
    // A blast is the one thing that peels a stuck gluefruit off a cliff from
    // a distance; the radial impulse skips fixed bodies, so free them first.
    const r2 = radius * radius;
    for (const f of this.fruits.values()) {
      if (f.stuck && f.body && f.position.distanceToSquared(center) <= r2) f.unstick();
    }
    return this.g.physics.explode(center, radius, strength, upBias).length;
  }

  // ---- the attached population, for the wire --------------------------------
  private logNode(plantId: number, nodeIndex: number, f: Fruit | null): void {
    const change: NodeChange = {
      seq: ++this.nodeSeq, plantId, nodeIndex,
      fruitId: f ? f.id : -1, species: f ? f.species : '',
      variant: f?.variant?.id ?? null, sizeRoll: f ? +f.sizeRoll.toFixed(4) : 0,
    };
    this.recordNode(change);
  }

  private recordNode(change: NodeChange): void {
    this.nodeLog.push(change);
    if (this.nodeLog.length > NODE_LOG_RING) this.nodeLog.shift();
    this.nodeDelta.set(`${change.plantId}:${change.nodeIndex}`, change);
  }

  /** Changes after `seq`, or null if they have scrolled out of the ring. */
  nodeChangesSince(seq: number): NodeChange[] | null {
    if (seq >= this.nodeSeq) return [];
    const first = this.nodeLog[0];
    if (!first || first.seq > seq + 1) return null;
    return this.nodeLog.filter((c) => c.seq > seq);
  }

  /** Everything that differs from the seed, one entry per node. */
  nodeManifest(): { seq: number; changes: NodeChange[] } {
    return { seq: this.nodeSeq, changes: [...this.nodeDelta.values()] };
  }

  /**
   * Apply node changes from the host, in order. Returns false on a gap, which
   * means the caller must ask for the manifest.
   *
   * A change is recorded here too, with the host's own sequence number, so a
   * client promoted to host carries on the log from where the old host left
   * it rather than starting a new one nobody else can follow.
   */
  applyNodeChanges(changes: NodeChange[]): boolean {
    for (const c of changes) {
      if (c.seq <= this.nodeSeq) continue;
      if (c.seq > this.nodeSeq + 1) return false;
      this.applyNode(c);
      this.nodeSeq = c.seq;
      this.recordNode(c);
    }
    return true;
  }

  /** A full picture of the attached population, for a joiner or after a gap. */
  applyNodeManifest(seq: number, changes: NodeChange[]): void {
    // The host's numbering replaces ours outright. A peer that played solo
    // before joining has a log of its own, and keeping its higher sequence
    // would make every later change from the host look already applied.
    this.nodeLog.length = 0;
    this.nodeDelta.clear();
    for (const c of changes) {
      this.applyNode(c);
      this.recordNode(c);
    }
    this.nodeSeq = seq;
  }

  private applyNode(c: NodeChange): void {
    const plant = this.plants.get(c.plantId);
    const node = plant?.nodes[c.nodeIndex];
    if (!plant || !node) return;
    if (node.fruitId === c.fruitId) return;
    // Whatever hangs there now is not what the host has there.
    if (node.fruitId >= 0) {
      const old = this.fruits.get(node.fruitId);
      if (old && old.state === 'attached') {
        this.releaseAttachment(old);
        // Bodiless and loose: the snapshot either places it (the host has
        // it loose or in hands) or, by not mentioning it, says it is gone.
        this.freedByLog.add(old.id);
      }
      node.fruitId = -1;
    }
    if (c.fruitId >= 0) {
      this.freedByLog.delete(c.fruitId);
      const existing = this.fruits.get(c.fruitId);
      if (existing) this.remove(existing);
      this.growFruitAt(plant, c.nodeIndex, c.species, {
        id: c.fruitId, variantId: c.variant, sizeRoll: c.sizeRoll,
      });
      // The host has grown it; nothing here should grow a second one.
      const i = this.regrow.findIndex((r) => r.plantId === c.plantId && r.nodeIndex === c.nodeIndex);
      if (i >= 0) this.regrow.splice(i, 1);
    }
  }

  /**
   * Point a Vinebomb where the player is looking as they cut it loose.
   *
   * The stored vine tension was a fixed random direction, so releasing one was
   * a lottery: it fired somewhere upward and you found out where afterwards.
   * That is fine for a hazard and useless for a stunt tool — the brief wants
   * it "controllable enough for deliberate attempts". The vine still owns most
   * of the launch, so it never becomes a gun, but the way you pull it off
   * decides where it goes.
   */
  private aimElastic(f: Fruit, playerId: number): void {
    if (f.attach?.plantId === this.coopVinePlantId) return;
    if (playerId < 0 || playerId !== this.g.player.id || !f.hasTrait('elastic')) return;
    this.g.player.lookDir(_v);
    f.tensionDir.multiplyScalar(0.45).addScaledVector(_v, 0.55);
    // A vine cannot fire you into the dirt: it is anchored above the fruit.
    f.tensionDir.y = Math.max(f.tensionDir.y, 0.34);
    f.tensionDir.normalize();
  }

  /** Shake a plant hard enough and its weaker fruit lets go. */
  shake(plantId: number, strength: number, playerId = -1): number {
    if (!this.authoritative) {
      // Shake the plant locally anyway: the sway is pure presentation and the
      // tool should look like it did something on the frame you swung it. What
      // does not happen locally is any fruit coming off.
      this.plants.shakePlant(plantId, strength);
      this.net!.requestShake(plantId, strength);
      return 0;
    }
    return this.shakeAuthoritative(plantId, strength, playerId);
  }

  /** The mutation itself, with no authority question asked. Host only. */
  shakeAuthoritative(plantId: number, strength: number, playerId = -1): number {
    const plant = this.plants.get(plantId);
    if (!plant) return 0;
    const amount = this.plants.shakePlant(plantId, strength);
    if (this.beforeHarvest && !this.beforeHarvest(plantId, 'shake')) return 0;
    if (strength > 0.3) {
      this.g.bus.emit('plant:shaken', {
        plantId, position: plant.position, height: plant.height, strength,
      });
    }
    let dropped = 0;
    const force = amount * 4.5;
    for (const node of plant.nodes) {
      if (node.fruitId < 0) continue;
      const f = this.fruits.get(node.fruitId);
      if (!f) continue;
      if (force > f.def.attachStrength * node.grip) {
        _v.set(this.rng.range(-0.7, 0.7), 0.4, this.rng.range(-0.7, 0.7));
        this.detachAuthoritative(f, 'shake', playerId, _v, true);
        dropped++;
      }
    }
    return dropped;
  }

  /**
   * Spawn a fruit already loose in the world — used by events, tests and debug
   * tools. Detach traits fire, because a free fruit is by definition one that
   * has come off its plant: a Puff Melon spawned in mid-air should be inflating
   * on the way down, not sitting there like an apple.
   */
  spawnFree(speciesId: string, pos: THREE.Vector3, variantId: string | null = null,
    vel?: THREE.Vector3, sizeRoll = 0.5): Fruit {
    const f = new Fruit(this.g.physics, this.g.newId(), speciesId, variantId, sizeRoll);
    f.position.copy(pos);
    f.state = 'carried';           // so release() takes the normal path
    f.release(vel ?? _v2.set(0, 0, 0));
    f.detachedAt = this.g.clock.elapsed;
    f.detachPosition.copy(pos);
    this.fruits.set(f.id, f);
    for (const trait of f.traits) trait.onDetach?.(f, this.ctx);
    this.g.bus.emit('fruit:spawned', { fruitId: f.id, species: speciesId });
    return f;
  }

  remove(f: Fruit): void {
    f.despawn();
    this.fruits.delete(f.id);
  }

  /** Restore the extraction tombstones without traits, prizes or regrowth. */
  restoreRunFruitIds(ids: number[]): void {
    for (const id of ids) {
      const f = this.get(id);
      if (!f) continue;
      const at = f.attach;
      if (at) {
        this.releaseAttachment(f);
        if (this.authoritative) this.logNode(at.plantId, at.nodeIndex, null);
      }
      this.remove(f);
    }
  }

  // ---- replication --------------------------------------------------------
  /**
   * Build a display-only copy of a fruit the HOST owns, under the HOST'S ID.
   *
   * The id is the whole point. The old replication path called `spawnFree`,
   * which minted a fresh local id and then filed the fruit under it — so a
   * client's copy of host fruit 5031 was its own fruit 5044, the next snapshot
   * did not recognise it, and a second copy appeared. It only ever looked
   * correct because two clients that boot the same world consume ids in the
   * same order, so the numbers happened to line up until something diverged.
   *
   * Species + variant + roll rebuilds the fruit exactly: same size, same mass,
   * same traits. A replica gets no body — the host owns the physics — and no
   * detach traits fire, because a replica is not a fruit that has just come off
   * a plant, it is a picture of one that did somewhere else.
   */
  spawnReplica(id: number, speciesId: string, variantId: string | null, sizeRoll: number): Fruit {
    const existing = this.fruits.get(id);
    if (existing) return existing;
    const f = new Fruit(this.g.physics, id, speciesId, variantId, sizeRoll);
    f.state = 'free';
    this.fruits.set(id, f);
    this.g.reserveId(id);
    return f;
  }

  /**
   * Take over the physics of every fruit this peer was only drawing.
   *
   * Called once, by the promotion path, at the instant a client becomes the
   * host. Every LOOSE fruit gets a real body at the transform and velocity the
   * last snapshot reported; everything attached, carried, stowed or gone is
   * left alone, because those states are body-less on a host too — attached
   * fruit has a static collider the activation sweep manages, and carried or
   * stowed fruit has none by design.
   *
   * Species-agnostic on purpose. A reconstructed Boulder Plum, Gluefruit or
   * Spikefruit is rebuilt by exactly the same call as an apple, out of the
   * descriptor the replica has been carrying since it arrived.
   */
  adoptAuthority(): { loose: number; rebuilt: number; failed: number } {
    let loose = 0, rebuilt = 0, failed = 0;
    for (const f of this.fruits.values()) {
      if (f.state !== 'free') continue;
      loose++;
      if (f.body) continue;                  // already ours; nothing to rebuild
      if (f.adoptRemoteBody()) rebuilt++; else failed++;
    }
    // A client keeps a log of node changes it has applied but not yet placed.
    // As host there is nobody left to place them, and the set only ever means
    // "something the next snapshot must account for".
    this.freedByLog.clear();
    return { loose, rebuilt, failed };
  }

  /**
   * Move a local fruit to the state the host says it is in.
   *
   * The transitions are not interchangeable with assigning `f.state`: coming
   * off a plant has to free the plant's node (or the branch stays occupied
   * forever and never regrows), and every state but `free` has to be sure the
   * fruit is not still holding a physics body a client has no business
   * simulating.
   */
  applyRemoteState(f: Fruit, want: Fruit['state']): void {
    if (f.state === want) {
      // Already in the right state, but possibly still SIMULATED here. That
      // happens when this peer was the host a moment ago — two clients can
      // promote at once from different views of who is left, and one of them
      // then learns the other won. Two machines integrating the same melon is
      // worse than neither: both advance it, the snapshot corrects one of them
      // fifteen times a second, and the fruit stutters between two futures.
      if (want === 'free') this.handBack(f);
      return;
    }
    if (f.state === 'attached') this.releaseAttachment(f);
    switch (want) {
      case 'carried': f.pickUp(-1); break;
      case 'stowed': f.stow(); break;
      case 'gone': this.remove(f); break;
      default:
        // Free, but simulated by the host: strip any body we happen to hold.
        this.handBack(f);
        f.state = 'free';
        break;
    }
  }

  /**
   * Give a loose fruit's physics back to whoever is the host, keeping the
   * motion it had. The exact inverse of `Fruit.adoptRemoteBody`, and the
   * reason a peer can change roles in either direction without the fruit
   * either freezing or being simulated twice.
   */
  private handBack(f: Fruit): void {
    if (!f.body) return;
    const v = f.body.linvel();
    const w = f.body.angvel();
    f.netVel.set(v.x, v.y, v.z);
    f.netAngVel.set(w.x, w.y, w.z);
    this.g.physics.removeBody(f.body, f.colliders);
    f.body = null;
    f.colliders.length = 0;
  }

  /** Local-only bookkeeping for a stem the host broke: free the node, drop the
   *  static collider, and queue the regrowth so both peers refill the tree. */
  releaseAttachment(f: Fruit): void {
    const at = f.attach;
    f.setNearby(false);
    this.nearbyIds.delete(f.id);
    f.attach = null;
    f.state = 'free';
    if (!at) return;
    const node = this.plants.get(at.plantId)?.nodes[at.nodeIndex];
    if (node && node.fruitId === f.id) {
      node.fruitId = -1;
      if (!this.oneTimePlants.has(at.plantId)) this.regrow.push({
        plantId: at.plantId, nodeIndex: at.nodeIndex, species: f.species,
        readyAt: this.g.clock.elapsed + this.rng.range(95, 190),
      });
    }
  }

  /** Restore only authored prizes, without replaying a harvest or minting a new ID. */
  restoreHarvestPrize(id: number, saved: { position: [number, number, number]; damage: number } | null): void {
    const f = this.get(id);
    if (!f || !this.harvestSites.some(s => s.fruitIds.includes(id))) return;
    const at = f.attach;
    if (at) {
      this.releaseAttachment(f);
      this.logNode(at.plantId, at.nodeIndex, null);
    }
    if (!saved) { this.remove(f); return; }
    if (f.body) { this.g.physics.removeBody(f.body, f.colliders); f.body = null; f.colliders.length = 0; }
    f.position.set(...saved.position);
    f.damage = saved.damage; f.refreshTint();
    f.state = 'carried'; f.release(new THREE.Vector3());
  }

  /**
   * Put a fruit back on the branch it came from.
   *
   * The undo half of a client's optimistic pick. A prediction the host refuses
   * has to leave NOTHING behind — not a free-floating apple where a branch
   * used to be, and not a regrowth entry that would eventually grow a second
   * apple into the same node.
   */
  reattach(f: Fruit, plantId: number, nodeIndex: number): boolean {
    const plant = this.plants.get(plantId);
    const node = plant?.nodes[nodeIndex];
    if (!node || (node.fruitId >= 0 && node.fruitId !== f.id)) return false;
    if (f.body) { this.g.physics.removeBody(f.body, f.colliders); f.body = null; f.colliders.length = 0; }
    f.attachTo({ plantId, nodeIndex, position: node.world, quaternion: node.quat });
    f.syncToAttachment();
    f.heldBy = -1;
    node.fruitId = f.id;
    const i = this.regrow.findIndex((r) => r.plantId === plantId && r.nodeIndex === nodeIndex);
    if (i >= 0) this.regrow.splice(i, 1);
    return true;
  }

  // ---- loop ---------------------------------------------------------------
  fixedStep(dt: number): void {
    this.ctx.dt = dt;
    this.ctx.elapsed = this.g.clock.elapsed;
    this.plants.step(dt, this.g.clock.elapsed);

    let attached = 0, free = 0, carried = 0, stowed = 0;
    for (const f of this.fruits.values()) {
      switch (f.state) {
        case 'attached': f.syncToAttachment(); attached++; break;
        case 'free': free++; break;
        case 'carried': carried++; break;
        case 'stowed': stowed++; break;
        default: break;
      }
      f.step(this.ctx);
    }
    this.stats = { attached, free, carried, stowed, total: this.fruits.size };

    this.sweepGone();
    this.updateActivation(dt);
    this.updateRegrowth();
  }

  private sweepGone(): void {
    for (const [id, f] of this.fruits) {
      if (f.state === 'gone') this.fruits.delete(id);
    }
  }

  /**
   * Attached fruit only gets a collider when a player is close enough to
   * interact with it. Hundreds of colliders across the island would be pure
   * broadphase cost for nothing.
   */
  private updateActivation(dt: number): void {
    this.activationTimer -= dt;
    if (this.activationTimer > 0) return;
    this.activationTimer = 0.2;
    const p = this.g.player.position;
    const r2 = this.activationRadius * this.activationRadius;
    for (const f of this.fruits.values()) {
      if (f.state !== 'attached') {
        if (this.nearbyIds.delete(f.id)) f.setNearby(false);
        continue;
      }
      const close = f.position.distanceToSquared(p) < r2;
      const was = this.nearbyIds.has(f.id);
      if (close === was) continue;
      f.setNearby(close);
      if (close) this.nearbyIds.add(f.id); else this.nearbyIds.delete(f.id);
    }
  }

  private updateRegrowth(): void {
    // Regrowth is the host's to roll. A client keeps the queue — it takes
    // over if it is ever promoted — but grows nothing on its own clock.
    if (!this.regrow.length || !this.authoritative) return;
    const now = this.g.clock.elapsed;
    for (let i = this.regrow.length - 1; i >= 0; i--) {
      const r = this.regrow[i];
      if (r.readyAt > now) continue;
      this.regrow.splice(i, 1);
      const plant = this.plants.get(r.plantId);
      if (!plant) continue;
      const node = plant.nodes[r.nodeIndex];
      if (!node || node.fruitId >= 0) continue;
      // Do not pop fruit into existence in someone's face.
      if (node.world.distanceToSquared(this.g.player.position) < 18 * 18) {
        r.readyAt = now + 12;
        this.regrow.push(r);
        continue;
      }
      this.growFruitAt(plant, r.nodeIndex, r.species, undefined, true);
    }
  }

  frameUpdate(): void {
    this.renderer.update(this.fruits.values());
  }

  setWind(dir: THREE.Vector3, strength: number): void {
    this.wind.copy(dir).multiplyScalar(strength);
    this.ctx.wind.copy(this.wind);
    this.plants.setWind(dir, Math.min(0.55, 0.04 + strength * 0.05));
  }

  defOf(species: string): FruitDef { return FRUIT[species]; }

  dispose(): void {
    this.disposeVineSupports?.();
    this.renderer.dispose();
    this.plants.dispose();
    this.fruits.clear();
  }
}

function shuffle<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
