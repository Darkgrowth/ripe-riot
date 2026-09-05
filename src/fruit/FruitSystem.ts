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
}

interface HabitatSpec {
  landmark: string;
  plants: Array<{ type: PlantType; count: number; scale?: [number, number] }>;
  /** Extra vertical offset, for vines that hang from above. */
  lift?: number;
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
};

/** Sunpatch's authored planting plan. */
const HABITATS: HabitatSpec[] = [
  // Scale ranges are deliberately wide. The shipped orchard used the default
  // 0.85-1.2, and thirty trees within 30% of one height read as a plantation
  // of clones; pushing the range past 2:1 gives the canopy a skyline.
  { landmark: 'orchard', plants: [
    { type: 'appleTree', count: 26, scale: [0.78, 1.5] },
    { type: 'orangeTree', count: 10, scale: [0.8, 1.32] },
    { type: 'melonVine', count: 5 },
  ] },
  { landmark: 'hillFarm', plants: [
    { type: 'appleTree', count: 8, scale: [0.85, 1.4] },
    { type: 'melonVine', count: 5 }, { type: 'puffBush', count: 4 },
  ] },
  { landmark: 'palmBeach', plants: [
    { type: 'palm', count: 17, scale: [0.8, 1.45] },
    { type: 'bananaPlant', count: 6 },
  ] },
  { landmark: 'caveOrchard', plants: [
    { type: 'palm', count: 7 }, { type: 'orangeTree', count: 4 },
  ] },
  { landmark: 'waterfall', plants: [
    { type: 'bananaPlant', count: 7 }, { type: 'puffBush', count: 5 },
  ] },
  { landmark: 'ridge', plants: [
    { type: 'puffBush', count: 5 },
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
const DECOR: Array<{ type: PlantType; x: number; z: number; scale: number }> = [
  // Shoreline either side of the dock head.
  { type: 'palm', x: 66.5, z: 55.0, scale: 1.25 },
  { type: 'palm', x: 64.0, z: 51.5, scale: 1.10 },
  { type: 'palm', x: 51.0, z: 70.5, scale: 1.20 },
  { type: 'palm', x: 47.0, z: 67.0, scale: 1.05 },
  // Framing the walk up to the shop, set back off the path on both sides.
  { type: 'palm', x: 52.5, z: 63.5, scale: 1.15 },
  { type: 'palm', x: 53.5, z: 46.0, scale: 1.30 },
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
  private ctx!: TraitContext;
  private activationTimer = 0;
  /** Installed by MultiplayerAuthority; null in single player, where you are
   *  the authority by definition. */
  net: NetGate | null = null;
  /** Fruit whose static collider is currently enabled. */
  private nearbyIds = new Set<number>();
  activationRadius = 42;
  wind = new THREE.Vector3(0.6, 0, 0.35).normalize().multiplyScalar(2.2);

  stats = { attached: 0, free: 0, carried: 0, stowed: 0, total: 0 };

  init(g: Game): void {
    this.g = g;
    this.world = g.get<Sunpatch>('world');
    this.plants = new PlantSystem(g.renderer.scene, g.physics);
    this.renderer = new FruitRenderer(g.renderer.scene);
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
        travelled: +f.travelled.toFixed(2), peak: +f.peakHeight.toFixed(2),
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
    for (const h of HABITATS) {
      const lm = this.world.at(h.landmark);
      for (const spec of h.plants) {
        this.scatter(spec.type, lm.position, lm.radius, spec.count, spec.scale);
      }
    }
    // Decorative planting: no fruit, so no growOn.
    for (const d of DECOR) {
      const y = this.world.terrain.height(d.x, d.z);
      if (y < 1.0) continue;
      this.plants.plant(this.g.newId(), d.type, new THREE.Vector3(d.x, y, d.z),
        this.rng, { scale: d.scale });
    }
    // Hanging vinebomb vines at authored cliff sites.
    for (const [x, z] of VINEBOMB_SITES) {
      const y = this.world.terrain.height(x, z);
      if (y < 1) continue;
      const p = this.plants.plant(this.g.newId(), 'vinebombVine',
        new THREE.Vector3(x, y + 4.6, z), this.rng, { scale: this.rng.range(0.9, 1.25) });
      this.growOn(p);
    }
    this.g.bus.emit('debug:log', {
      text: `populated: ${this.plants.count} plants, ${this.fruits.size} fruit`,
    });
  }

  private scatter(type: PlantType, center: THREE.Vector3, radius: number, count: number,
    scaleRange?: [number, number]): void {
    const terrain = this.world.terrain;
    let placed = 0;
    let attempts = 0;
    const minGap = type === 'palm' ? 4.2 : type === 'melonVine' ? 2.4 : 4.6;
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

  private growFruitAt(plant: Plant, nodeIndex: number, speciesId: string): Fruit | null {
    const node = plant.nodes[nodeIndex];
    if (!node || node.fruitId >= 0) return null;
    const variantId = this.rollVariant();
    const f = new Fruit(this.g.physics, this.g.newId(), speciesId, variantId, this.rng.next());
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
      f.tensionDir.set(this.rng.range(-0.4, 0.4), 1, this.rng.range(-0.4, 0.4)).normalize();
    }
    node.fruitId = f.id;
    this.fruits.set(f.id, f);
    return f;
  }

  private rollVariant(): string | null {
    if (!this.rng.chance(VARIANT_RATE)) return null;
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

  // ---- actions ------------------------------------------------------------
  /** True when this peer owns shared state. Always true in single player. */
  get authoritative(): boolean { return !this.net || this.net.authoritative; }

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
  detachAuthoritative(f: Fruit, cause: string, playerId = -1, inheritVel?: THREE.Vector3): void {
    if (f.state !== 'attached') return;
    const at = f.attach;
    this.aimElastic(f, playerId);
    f.detach(this.ctx, cause, playerId, inheritVel);
    if (at) {
      const plant = this.plants.get(at.plantId);
      const node = plant?.nodes[at.nodeIndex];
      if (node && node.fruitId === f.id) {
        node.fruitId = -1;
        // Schedule regrowth so the island does not strip-mine itself.
        this.regrow.push({
          plantId: at.plantId, nodeIndex: at.nodeIndex, species: f.species,
          readyAt: this.g.clock.elapsed + this.rng.range(95, 190),
        });
      }
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
        this.detachAuthoritative(f, 'shake', playerId, _v);
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
   * Move a local fruit to the state the host says it is in.
   *
   * The transitions are not interchangeable with assigning `f.state`: coming
   * off a plant has to free the plant's node (or the branch stays occupied
   * forever and never regrows), and every state but `free` has to be sure the
   * fruit is not still holding a physics body a client has no business
   * simulating.
   */
  applyRemoteState(f: Fruit, want: Fruit['state']): void {
    if (f.state === want) return;
    if (f.state === 'attached') this.releaseAttachment(f);
    switch (want) {
      case 'carried': f.pickUp(-1); break;
      case 'stowed': f.stow(); break;
      case 'gone': this.remove(f); break;
      default:
        // Free, but simulated by the host: strip any body we happen to hold.
        if (f.body) f.pickUp(-1);
        f.state = 'free';
        break;
    }
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
      this.regrow.push({
        plantId: at.plantId, nodeIndex: at.nodeIndex, species: f.species,
        readyAt: this.g.clock.elapsed + this.rng.range(95, 190),
      });
    }
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
    if (!this.regrow.length) return;
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
      this.growFruitAt(plant, r.nodeIndex, r.species);
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
