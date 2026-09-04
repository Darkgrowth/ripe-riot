import * as THREE from 'three';
import type { Game, System } from '@/core/Game';
import type { Sunpatch } from '@/world/Sunpatch';
import type { FruitSystem } from '@/fruit/FruitSystem';
import { Palette } from '@/render/Palette';
import { clamp } from '@/core/MathUtils';

/**
 * Impact feedback: the visible half of "physics feel".
 *
 * Every fruit already keeps an honest record of how hard it hit (velocity lost
 * in one step, see Fruit.registerImpact) and the audio layer already plays it.
 * Nothing showed it. A watermelon landing beside you and a coconut rolling to a
 * stop made the same picture, which is why the game read as lighter than its
 * numbers: weight is something you SEE happen to the ground.
 *
 * One instanced mesh of low-poly shards, a few hundred at most, simulated on
 * the CPU in the fixed step so they freeze with the world and never touch
 * gameplay. Dust for landings, pulp for bursts, leaves for anything that
 * disturbs a canopy, and a camera thump scaled by momentum and distance so a
 * two-tonne melon coming down is felt before it is understood.
 *
 * Deliberately not a general particle system: no textures, no billboards, no
 * emitter graph. Chunky shards match the art and cost one draw call.
 */
export class ImpactFX implements System {
  readonly name = 'fx';
  private g!: Game;
  private world!: Sunpatch;
  private fruitSys!: FruitSystem;
  private mesh!: THREE.InstancedMesh;
  private colors!: THREE.InstancedBufferAttribute;
  private pool: Particle[] = [];
  private alive = 0;
  private dirty = false;
  spawned = 0;
  /** Set false by the harness to A/B a frame with and without effects. */
  enabled = true;

  init(g: Game): void {
    this.g = g;
    this.world = g.get<Sunpatch>('world');
    this.fruitSys = g.get<FruitSystem>('fruit');

    for (let i = 0; i < MAX; i++) this.pool.push(newParticle());
    // A squashed octahedron: eight triangles, reads as a chip of something
    // from any angle, and never as a sprite.
    const geo = new THREE.OctahedronGeometry(1, 0);
    geo.scale(1, 0.55, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    mat.name = 'fx';
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.name = 'ImpactFX';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3).fill(1), 3);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = this.colors;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    g.renderer.scene.add(this.mesh);

    g.bus.on('fruit:impact', (p) => this.onImpact(p.fruitId, p.species, p.speed, p.point, p.onPlayer));
    g.bus.on('fruit:destroyed', (p) => this.onBurst(p.fruitId, p.species));
    g.bus.on('fruit:detached', (p) => this.onDetach(p.fruitId, p.cause));
    g.bus.on('plant:shaken', (p) => this.onShake(p.position, p.height, p.strength));
    g.bus.on('player:ragdoll', () => this.dustRing(g.player.position, 14, 0.55));
    g.bus.on('legendary:landed', (p) => this.onLegendaryLanding(p.position, p.speed));

    g.debug?.addProbe('fx', () => ({ alive: this.alive, spawned: this.spawned, enabled: this.enabled }));
    g.debug?.addAction('fx.enable', (on: boolean) => { this.enabled = on; return on; });
    g.debug?.addAction('fx.burst', (x: number, y: number, z: number, n = 24) => {
      this.emit(n, _p.set(x, y, z), (q) => {
        q.r = 0.9; q.g = 0.3; q.b = 0.3;
        scatter(q, 2, 6, 0.9);
        q.size = rand(0.08, 0.2); q.life = q.maxLife = rand(0.8, 1.4);
      });
      return this.alive;
    });
  }

  // ---- emitters -----------------------------------------------------------
  private onImpact(fruitId: number, species: string, dv: number, point: THREE.Vector3, onPlayer: boolean): void {
    if (dv < 3.5) return;
    const f = this.fruitSys.get(fruitId);
    const mass = f?.mass ?? 1;
    const size = f?.radius ?? 0.2;
    const pulp = PULP[species] ?? PULP.default;

    // Dust: more of it, and bigger, for heavier and faster. A rolling orange
    // gets a few motes; a watermelon dropped from a ladder gets a cloud.
    const heft = clamp(dv / 14, 0, 1.4) * (0.6 + Math.pow(mass, 0.34) * 0.4);
    const n = clamp(Math.round(4 + heft * 14), 4, 30);
    _p.copy(point);
    if (!onPlayer) _p.y = Math.max(_p.y - size * 0.6, this.groundAt(_p.x, _p.z) + 0.05);
    this.emit(n, _p, (q) => {
      const k = Math.random();
      mixInto(q, DUST, pulp, k < 0.3 ? 0.55 : 0.08);
      scatter(q, 0.8 + heft * 1.2, 2.0 + heft * 2.6, 0.55);
      q.size = rand(0.05, 0.11) * (0.8 + heft * 0.5);
      q.life = q.maxLife = rand(0.35, 0.7);
      q.gravity = 7; q.drag = 3.2; q.bounce = 0;
    });

    // The thump. Momentum over distance: a coconut beside you and the King
    // Melon across the basin should both register, and an apple never should.
    const momentum = mass * dv;
    const d = point.distanceTo(this.g.player.eyePosition);
    const reach = 14 + Math.min(40, momentum / 60);
    if (d < reach && !onPlayer) {
      const near = Math.pow(1 - d / reach, 1.6);
      const amp = clamp(momentum / 900, 0, 1) * 0.06 * near;
      if (amp > 0.0025) this.g.playerCamera.addShake(amp, 0.24 + amp * 3, 30);
    }
  }

  private onBurst(fruitId: number, species: string): void {
    const f = this.fruitSys.get(fruitId);
    if (!f) return;
    const pulp = PULP[species] ?? PULP.default;
    const rind = RIND[species] ?? pulp;
    const r = f.radius;
    const n = clamp(Math.round(18 + r * 60), 18, 64);
    _p.copy(f.position);
    this.emit(n, _p, (q) => {
      const skin = Math.random() < 0.3;
      mixInto(q, skin ? rind : pulp, DUST, 0);
      scatter(q, 1.5 + r * 3, 4 + r * 8, 0.7);
      q.size = rand(0.06, 0.12) + r * rand(0.1, 0.3);
      q.life = q.maxLife = rand(0.9, 1.7);
      q.gravity = 12; q.drag = 0.9; q.bounce = 0.25;
      q.spin = rand(-8, 8);
    });
    // A burst is a landing that went badly; it still thumps.
    const d = f.position.distanceTo(this.g.player.eyePosition);
    if (d < 20) this.g.playerCamera.addShake(0.02 * (1 - d / 20) * (0.5 + r), 0.3, 28);
  }

  private onDetach(fruitId: number, cause: string): void {
    if (cause === 'debug') return;
    const f = this.fruitSys.get(fruitId);
    if (!f) return;
    this.leaves(f.position, clamp(Math.round(3 + f.radius * 8), 3, 8), 0.6);
  }

  private onShake(position: THREE.Vector3, height: number, strength: number): void {
    const n = clamp(Math.round(6 + strength * 12), 6, 32);
    // Leaves come off the canopy, not the trunk.
    const top = position.y + height;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = rand(0.4, 1.0) * height * 0.32;
      _p.set(position.x + Math.cos(a) * rr, top - rand(0.05, 0.55) * height, position.z + Math.sin(a) * rr);
      this.leaves(_p, 1, 0.35 + strength * 0.3);
    }
  }

  /** The King Melon already shakes the camera from its own contact handler;
   *  this only draws the ground reacting to two and a half tonnes. */
  private onLegendaryLanding(position: THREE.Vector3, speed: number): void {
    this.dustRing(position, clamp(Math.round(24 + speed * 1.6), 24, 56), 1.8 + speed * 0.08);
  }

  private leaves(at: THREE.Vector3, n: number, spread: number): void {
    const wind = this.fruitSys.wind;
    this.emit(n, at, (q) => {
      mixInto(q, LEAF_A, LEAF_B, Math.random());
      scatter(q, 0.4, 1.4, 0.2);
      q.vx += wind.x * 0.35 + rand(-spread, spread);
      q.vz += wind.z * 0.35 + rand(-spread, spread);
      q.vy += rand(0.2, 1.2);
      q.size = rand(0.07, 0.13);
      q.life = q.maxLife = rand(1.1, 2.1);
      q.gravity = 1.6; q.drag = 1.4; q.bounce = 0;
      q.spin = rand(-6, 6);
      q.flutter = rand(2, 5);
    });
  }

  private dustRing(at: THREE.Vector3, n: number, speed: number): void {
    _p.copy(at);
    _p.y = this.groundAt(at.x, at.z) + 0.1;
    this.emit(n, _p, (q, i) => {
      mixInto(q, DUST, DUST_DARK, Math.random() * 0.5);
      const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2);
      const s = speed * rand(0.7, 1.3);
      q.vx = Math.cos(a) * s; q.vz = Math.sin(a) * s; q.vy = rand(0.4, 1.4) * speed * 0.5;
      q.size = rand(0.08, 0.16) * (0.7 + speed * 0.2);
      q.life = q.maxLife = rand(0.5, 0.9);
      q.gravity = 5; q.drag = 2.6; q.bounce = 0;
    });
  }

  // ---- pool ---------------------------------------------------------------
  private emit(n: number, at: THREE.Vector3, setup: (q: Particle, i: number) => void): void {
    if (!this.enabled) return;
    for (let i = 0; i < n; i++) {
      // Recycle the oldest when full: a burst always shows, an old mote does not.
      const q = this.alive < MAX ? this.pool[this.alive++] : this.pool[i % MAX];
      resetParticle(q);
      q.x = at.x; q.y = at.y; q.z = at.z;
      setup(q, i);
      q.rot = Math.random() * Math.PI * 2;
      this.spawned++;
    }
    this.dirty = true;
  }

  private groundAt(x: number, z: number): number {
    return Math.max(0, this.world.terrain.height(x, z));
  }

  fixedStep(dt: number): void {
    if (this.alive === 0) return;
    let i = 0;
    while (i < this.alive) {
      const q = this.pool[i];
      q.life -= dt;
      if (q.life <= 0) {
        // Swap-remove keeps the live set contiguous for the upload.
        const last = this.pool[this.alive - 1];
        this.pool[this.alive - 1] = q;
        this.pool[i] = last;
        this.alive--;
        continue;
      }
      q.vy -= q.gravity * dt;
      const k = Math.exp(-q.drag * dt);
      q.vx *= k; q.vy *= k; q.vz *= k;
      if (q.flutter > 0) {
        q.vx += Math.sin(q.life * q.flutter * 2.1 + q.rot) * dt * 2.2;
        q.vz += Math.cos(q.life * q.flutter * 1.7 + q.rot) * dt * 2.2;
      }
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.rot += q.spin * dt;
      // Ground: settle or bounce. Terrain height is a function, so this costs
      // nothing like a raycast.
      const floor = this.groundAt(q.x, q.z) + q.size * 0.5;
      if (q.y < floor) {
        q.y = floor;
        if (q.bounce > 0 && q.vy < -1) { q.vy = -q.vy * q.bounce; q.vx *= 0.6; q.vz *= 0.6; }
        else { q.vy = 0; q.vx *= 0.5; q.vz *= 0.5; q.spin *= 0.5; }
      }
      i++;
    }
    this.dirty = true;
  }

  frameUpdate(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const mesh = this.mesh;
    for (let i = 0; i < this.alive; i++) {
      const q = this.pool[i];
      // Shrink out over the last third of life rather than popping.
      const fade = q.maxLife > 0 ? clamp(q.life / (q.maxLife * 0.35), 0, 1) : 1;
      const s = q.size * (0.35 + 0.65 * fade);
      _q.setFromEuler(_e.set(q.rot * 0.7, q.rot, q.rot * 0.3));
      _m.compose(_v.set(q.x, q.y, q.z), _q, _s.setScalar(s));
      mesh.setMatrixAt(i, _m);
      this.colors.setXYZ(i, q.r, q.g, q.b);
    }
    mesh.count = this.alive;
    mesh.instanceMatrix.needsUpdate = true;
    this.colors.needsUpdate = true;
  }

  dispose(): void {
    this.g.renderer.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------
const MAX = 480;

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number; size: number;
  r: number; g: number; b: number;
  gravity: number; drag: number; bounce: number; spin: number; rot: number; flutter: number;
}

function newParticle(): Particle {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0, size: 0.1,
    r: 1, g: 1, b: 1, gravity: 9, drag: 1, bounce: 0, spin: 0, rot: 0, flutter: 0 };
}
function resetParticle(q: Particle): void {
  q.vx = q.vy = q.vz = 0; q.life = q.maxLife = 0.5; q.size = 0.1;
  q.r = q.g = q.b = 1; q.gravity = 9; q.drag = 1; q.bounce = 0; q.spin = 0; q.rot = 0; q.flutter = 0;
}

/** Random velocity in an upward-biased cone. */
function scatter(q: Particle, minSpeed: number, maxSpeed: number, up: number): void {
  const a = Math.random() * Math.PI * 2;
  const s = rand(minSpeed, maxSpeed);
  const lift = rand(up * 0.4, up * 1.4);
  const flat = Math.sqrt(Math.max(0, 1 - lift * lift * 0.5));
  q.vx = Math.cos(a) * s * flat;
  q.vz = Math.sin(a) * s * flat;
  q.vy = s * lift;
}

function mixInto(q: Particle, a: THREE.Color, b: THREE.Color, t: number): void {
  const j = rand(0.86, 1.1);
  q.r = (a.r + (b.r - a.r) * t) * j;
  q.g = (a.g + (b.g - a.g) * t) * j;
  q.b = (a.b + (b.b - a.b) * t) * j;
}

function rand(lo: number, hi: number): number { return lo + Math.random() * (hi - lo); }

const c = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
const DUST = c(0xd9c69a);
const DUST_DARK = c(0xa88c62);
const LEAF_A = Palette.leaf;
const LEAF_B = Palette.leafDark;

/** What comes out when a species breaks, and what its skin looks like. */
const PULP: Record<string, THREE.Color> = {
  default: c(0xf0e2b0),
  apple: c(0xf6ecc2),
  orange: c(0xffab3a),
  coconut: c(0xf8f2e4),
  banana: c(0xf6e27e),
  watermelon: c(0xf04a5e),
  puffmelon: c(0xdcf5a6),
  vinebomb: c(0xb9ff6e),
  kingmelon: c(0xf04a5e),
};
const RIND: Record<string, THREE.Color> = {
  apple: c(0xd63a3a),
  orange: c(0xf28a1e),
  coconut: c(0x8c6a3f),
  banana: c(0xe8c94a),
  watermelon: c(0x3c8a3c),
  puffmelon: c(0x9ed46a),
  vinebomb: c(0x6fbf3a),
  kingmelon: c(0x2f7a34),
};

const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
