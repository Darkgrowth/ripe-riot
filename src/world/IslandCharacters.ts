import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game, System } from '@/core/Game';
import type { Fruit } from '@/fruit/Fruit';
import type { FruitSystem } from '@/fruit/FruitSystem';
import type { RopeSystem } from '@/systems/RopeSystem';
import type { Sunpatch } from './Sunpatch';
import { voxelGullBodyGeometry, voxelGullFaceGeometry, voxelGullWingGeometry } from '../art/voxel/VoxelGull';

type Point = [number, number, number];
type GullPhase = 'perched' | 'approach' | 'return' | 'scared';
export interface CharacterNetState {
  enabled: boolean;
  phase: GullPhase; elapsed: number; duration: number; cooldown: number; grace: number;
  target: number; pecked: boolean; cycle: number; from: Point; to: Point;
}
interface DirectorView { id: number | string; kind: string; phase: string; result?: string; }
interface CrewMember { position: THREE.Vector3; busy?: boolean; }

const C = (n: number) => new THREE.Color().setHex(n, THREE.SRGBColorSpace);
const SKIN = 0xc98959, SKIN_LIGHT = 0xe5ac76, TEAL = 0x397c72, INK = 0x293c3a;
const CREAM = 0xe7d9ae, SHIRT = 0xd5a64e, HAIR = 0x684b37;
const LINES = [
  'Merv: The fruit is insured. You are not.',
  'Merv: Finally. Stock that cannot walk out on me.',
  'Merv: That sale paid for the sign. Try not to hit it.',
  'Merv: Free delivery from the trees. Duck.',
  'Merv: Customer says urgent. Still looking for the door.',
  'Merv: On time and mostly fruit. Full marks.',
  'Merv: They ate the napkins. Crisis over.',
  'Merv: That bruise is now a limited edition.',
  'Merv: I sold you that cannon. My solicitor says otherwise.',
  'Merv: That gull owes me rent.',
  'Merv: King Melon secured. Head back to the dock boat to settle the expedition.',
  'Merv: Mind the coconuts. They have declined mediation.',
  'Merv: Paid in full. Sunpatch is still yours to harvest.',
] as const;

/** Two small island residents. Only the host may let the gull touch physics.
 * Their poses are decorative; no NPC colliders narrow the harvest routes. */
export class IslandCharacters implements System {
  readonly name = 'characters';
  private g!: Game;
  private world!: Sunpatch;
  private fruit!: FruitSystem;
  private root = new THREE.Group();
  private merv = new THREE.Group();
  private head = new THREE.Group();
  private arms: THREE.Group[] = [];
  private gull = new THREE.Group();
  private wings: THREE.Group[] = [];
  private gullHead = new THREE.Group();
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
  private home = new THREE.Vector3();
  private mervAt = new THREE.Vector3();
  private state: CharacterNetState = { enabled: true, phase: 'perched', elapsed: 0, duration: 1,
    cooldown: 0, grace: 12, target: -1, pecked: false, cycle: 0, from: [0, 0, 0], to: [0, 0, 0] };
  private scan = 0;
  private rimAt = new THREE.Vector3(Infinity, Infinity, Infinity);
  private rimTarget = -1;
  private talkCooldown = 0;
  private talkSeen = new Set<number>();
  private gesture = 0;
  private duckTimer = 0;
  private duckCooldown = 0;
  private pendingComment: number | null = null;
  private saleTotal = 0;
  private gullCues = new Set<string>();
  private nearBefore = false;
  private directorKey = '';
  private off: Array<() => void> = [];
  caption = { text: '', remaining: 0 };
  readonly stats = { pecks: 0, aborted: 0, scares: 0, lastFruit: -1, lastDeltaSpeed: 0 };

  init(g: Game): void {
    this.g = g; this.world = g.get<Sunpatch>('world'); this.fruit = g.get<FruitSystem>('fruit');
    this.root.name = 'IslandCharacters'; this.material.name = 'island-character-colors';
    this.material.envMapIntensity = 0.3;
    this.buildMerv(); this.buildGull();
    // Existing shop local frame, confirmed against Landmarks. Merv's back is
    // in front of the shallow hatch panel; his waist sits behind the counter.
    const shop = new THREE.Vector3(45, this.world.terrain.height(45, 52), 52);
    this.mervAt.set(0.65, 0.34, 3.04).applyAxisAngle(UP, -0.9).add(shop);
    this.merv.position.copy(this.mervAt); this.merv.rotation.y = -0.9;
    this.merv.scale.setScalar(0.90);
    // Existing orchard fence post: height 1.42, centered 0.62 above ground.
    // Keeping the bird here makes it part of the first harvesting loop.
    this.home.set(-12.5, this.world.terrain.height(-12.5, 32.8) + 1.33, 32.8);
    const cache: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const a = i * Math.PI * 2 / 9, r = 0.37 + Math.sin(i * 2.7) * 0.055;
      cache.push(box([Math.sin(a) * r, 0.025 + (i % 3) * 0.009, Math.cos(a) * r],
        [0.035, 0.035, 0.32], i % 2 ? HAIR : 0x9c8357, [0.07, a + Math.PI / 2, 0.09]));
    }
    for (let i = 0; i < 3; i++) {
      const feather = new THREE.OctahedronGeometry(1);
      feather.scale(0.046, 0.013, 0.16); feather.rotateY(i * 1.9);
      feather.translate((i - 1) * 0.14, 0.027, Math.sin(i * 2) * 0.14);
      cache.push(paint(feather, i === 1 ? 0xa6b2b1 : CREAM));
    }
    const cacheMesh = mesh(cache, this.material, 'GullTwigCache');
    cacheMesh.position.set(-12.5, this.world.terrain.height(-12.5, 31.9) + 0.025, 31.9);
    this.root.add(cacheMesh);
    this.state.from = this.home.toArray() as Point; this.state.to = [...this.state.from];
    this.gull.position.copy(this.home);
    this.root.add(this.merv, this.gull); g.renderer.scene.add(this.root);
    this.off.push(g.bus.on('fruit:sold', p => { this.gesture = 2.2; this.saleTotal += p.value; }));
    this.off.push(g.bus.on('legendary:complete', () => this.speak([10])));
    this.off.push(g.bus.on('expedition:settled', () => this.speak([12])));
    this.off.push(g.bus.on('fruit:impact', p => {
      if (p.speed > 5 && p.point.distanceToSquared(this.mervAt) < 100) this.speak([7]);
      if (p.speed > 5 && p.point.distanceToSquared(this.mervAt) < 36) this.duck();
      if (p.speed > 6 && p.point.distanceToSquared(this.gull.position) < 36) this.scare();
    }));
    this.off.push(g.bus.on('tool:blast', p => {
      if (p.point.distanceToSquared(this.mervAt) < 225) { this.gesture = 2; this.speak([8]); }
      if (p.point.distanceToSquared(this.mervAt) < 144) this.duck();
      if (p.point.distanceToSquared(this.gull.position) < 144) this.scare();
    }));
    // The director is polled as well, so late joiners and host changes do not
    // need an event replay to give Merv the current reaction.
    this.off.push(g.bus.on('island:event', () => this.observeDirector()));
    const info = () => ({ ...this.netState(), ...this.stats,
      gull: this.gull.position.toArray(), merv: this.mervAt.toArray(), caption: this.caption,
      talkCooldown: this.talkCooldown, spoken: [...this.talkSeen], duck: this.duckTimer });
    g.debug?.addProbe('characters', info);
    g.debug?.addProbe('characters.info', info);
    g.debug?.addAction('characters.info', info);
    const start = (id?: number) => {
      if (!this.fruit.authoritative) return false;
      const target = id === undefined ? this.chooseTarget() : this.fruit.get(id);
      return !!target && this.startApproach(target);
    };
    g.debug?.addAction('characters.gull', start);
    g.debug?.addAction('characters.startGull', start);
    g.debug?.addAction('characters.enable', (on: boolean) => {
      if (!this.fruit.authoritative) return this.state.enabled;
      this.state.enabled = !!on; this.state.grace = 12;
      this.state.phase = 'perched'; this.state.target = -1; this.state.pecked = true;
      this.state.from = this.home.toArray() as Point; this.state.to = [...this.state.from];
      return this.state.enabled;
    });
    g.debug?.addAction('characters.visible', (on: boolean) => { this.root.visible = !!on; return this.root.visible; });
    g.debug?.addAction('characters.reset', (automatic = false) => {
      if (!this.fruit.authoritative) return false;
      this.state = { enabled: automatic, phase: 'perched', elapsed: 0, duration: 1,
        cooldown: 45, grace: 12, target: -1, pecked: false, cycle: 0,
        from: this.home.toArray() as Point, to: this.home.toArray() as Point };
      this.gull.position.copy(this.home); this.scan = 0; this.rimTarget = -1;
      this.talkSeen.clear(); this.talkCooldown = 0; this.caption = { text: '', remaining: 0 };
      this.gesture = 0; this.nearBefore = false; this.directorKey = '';
      this.duckTimer = 0; this.duckCooldown = 0; this.pendingComment = null; this.saleTotal = 0; this.gullCues.clear();
      Object.assign(this.stats, { pecks: 0, aborted: 0, scares: 0, lastFruit: -1, lastDeltaSpeed: 0 });
      return true;
    });
    g.debug?.addAction('characters.scare', () => this.scare());
    g.debug?.addAction('characters.speak', (index = 0) => this.speak([Math.max(0, Math.min(11, index | 0))], true));
  }

  private crew(): CrewMember[] {
    if (this.g.has('director')) return this.g.get<{ crew(): CrewMember[] }>('director').crew();
    if (this.g.has('net')) {
      const net = this.g.get<{ activityCrew?: () => CrewMember[] }>('net');
      if (net.activityCrew) return net.activityCrew();
    }
    return [{ position: this.g.player.position }];
  }

  private eligible(f: Fruit, checkRim = true): boolean {
    if (f.state !== 'free' || !f.body || f.stuck || f.stuckHands > 0 || f.heldBy >= 0
      || f.restraint > 0 || f.mass > 8 || f.speed > 1.8 || f.destroyed) return false;
    if (!['apple', 'orange'].includes(f.species)) return false;
    if (f.position.distanceToSquared(this.home) > 34 * 34) return false;
    const pad = this.world.sellPad;
    if (Math.hypot(f.position.x - pad.x, f.position.z - pad.z) < this.world.sellRadius + 3) return false;
    if (this.crew().some(p => p.position.distanceToSquared(f.position) < 3.4 * 3.4)) return false;
    if (this.g.has('ropes')) for (const rope of this.g.get<RopeSystem>('ropes').ropes.values()) {
      if (!rope.broken && ((rope.a.kind === 'fruit' && rope.a.ownerId === f.id)
        || (rope.b.kind === 'fruit' && rope.b.ownerId === f.id))) return false;
    }
    return !checkRim || this.safeRim(f);
  }

  private safeRim(f: Fruit): boolean {
    // Cache during approach; only refresh if the target moves half a metre.
    // Do not nudge fruit beside a drop, steep bank or the water.
    const ground = this.world.terrain.height(f.position.x, f.position.z);
    if (ground < 1.25 || f.position.y - ground > f.radius + 0.65) return false;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const h = this.world.terrain.height(f.position.x + Math.cos(a) * 1.5,
        f.position.z + Math.sin(a) * 1.5);
      if (h < 1.0 || Math.abs(h - ground) > 0.50) return false;
    }
    return true;
  }

  private chooseTarget(): Fruit | undefined {
    let chosen: Fruit | undefined, best = Infinity;
    for (const f of this.fruit.fruits.values()) {
      const d = f.position.distanceToSquared(this.home);
      if (d < best && this.eligible(f)) { chosen = f; best = d; }
    }
    return chosen;
  }

  private startApproach(f: Fruit): boolean {
    if (!this.fruit.authoritative || !this.state.enabled || !this.eligible(f) || this.state.phase !== 'perched') return false;
    this.state.target = f.id; this.state.pecked = false; this.state.cycle++;
    this.rimTarget = f.id; this.rimAt.copy(f.position);
    this.state.cooldown = 45;
    const at = f.position.clone(); at.y += f.radius + 0.16;
    this.move('approach', at, 3.2); this.speak([9]);
    return true;
  }

  private move(phase: GullPhase, to: THREE.Vector3, duration: number): void {
    this.state.phase = phase; this.state.elapsed = 0; this.state.duration = duration;
    this.state.from = this.gull.position.toArray() as Point; this.state.to = to.toArray() as Point;
  }

  private scare(): boolean {
    if (!this.fruit?.authoritative || !this.state.enabled || this.state.phase === 'scared') return false;
    this.stats.scares++; this.state.cycle++; this.state.pecked = true; this.state.target = -1; this.state.cooldown = 45;
    this.move('scared', this.home.clone().add(new THREE.Vector3(0, 3, 0)), 2.5);
    return true;
  }

  fixedStep(dt: number): void {
    if (!this.fruit.authoritative || !this.state.enabled) return;
    this.state.grace = Math.max(0, this.state.grace - dt);
    this.state.cooldown = Math.max(0, this.state.cooldown - dt);
    this.state.elapsed += dt;
    if (this.state.phase === 'perched') {
      // A resident should acknowledge nearby players even when there is no
      // safe unattended fruit. This uses the existing replicated flight state.
      const crew = this.crew();
      if (this.state.grace <= 0 && this.state.cooldown <= 0
        && crew.some(p => !p.busy && p.position.distanceToSquared(this.home) < 2.4 * 2.4)) {
        this.scare(); return;
      }
      this.scan -= dt;
      if (this.scan <= 0 && this.state.grace <= 0 && this.state.cooldown <= 0
        && this.crew().some(p => !p.busy)) {
        this.scan = 2;
        const f = this.chooseTarget(); if (f) this.startApproach(f);
      }
      // Small inspection lap over the post, not another fruit attempt. Reuse
      // return with identical endpoints so late join/migration retain its arc.
      // It does not consume or reset the fruit-interference cooldown.
      if (this.state.phase === 'perched' && this.state.grace <= 0 && this.state.elapsed >= 18
        && crew.some(p => !p.busy && p.position.distanceToSquared(this.home) < 28 * 28)) {
        this.state.target = -1; this.state.pecked = true;
        this.gull.position.copy(this.home);
        this.move('return', this.home, 4.2);
      }
      return;
    }
    if (this.state.phase === 'approach') {
      const f = this.fruit.get(this.state.target);
      const moved = !!f && (this.rimTarget !== f.id || f.position.distanceToSquared(this.rimAt) > 0.25);
      if (!f || !this.eligible(f, false) || (moved && !this.safeRim(f))
        || f.position.distanceToSquared(_point.fromArray(this.state.to)) > 2.25) {
        this.stats.aborted++; this.state.pecked = true; this.state.target = -1;
        this.move('return', this.home, 2.8); return;
      }
      if (moved) { this.rimTarget = f.id; this.rimAt.copy(f.position); }
      if (this.state.elapsed >= this.state.duration) {
        if (!this.state.pecked) {
          // Latch before touching physics. Migration carries this latch, so a
          // new host cannot deliver the same peck a second time.
          this.state.pecked = true;
          _point.copy(this.home).sub(f.position).setY(0).normalize().multiplyScalar(0.75);
          _point.y = 0.35;
          this.stats.lastDeltaSpeed = _point.length();
          f.applyImpulse(_point.multiplyScalar(f.mass));
          this.stats.pecks++; this.stats.lastFruit = f.id;
        }
        this.move('return', this.home, 3.0);
      }
    } else if (this.state.elapsed >= this.state.duration) {
      if (this.state.phase === 'scared') this.move('return', this.home, 3.0);
      else {
        this.state.phase = 'perched'; this.state.elapsed = 0; this.state.target = -1;
        this.state.from = this.home.toArray() as Point; this.state.to = [...this.state.from];
      }
    }
  }

  private speak(preferred: number[], force = false): boolean {
    const index = preferred.find(i => !this.talkSeen.has(i));
    if (index === undefined) return false;
    if (!force && (this.talkCooldown > 0 || this.g.player.position.distanceToSquared(this.mervAt) > 225)) {
      // Merv comments when you return to the shed, rather than speaking from
      // the dock or the far ridge. The settled chapter takes priority.
      if (index === 12 || (index === 10 && this.pendingComment !== 12)
        || (index === 9 && this.pendingComment === null)) this.pendingComment = index;
      return false;
    }
    this.talkSeen.add(index); this.talkCooldown = 30; this.gesture = 2.4;
    this.caption = { text: LINES[index], remaining: 4.2 };
    this.g.bus.emit('ui:toast', { text: LINES[index], kind: 'info', ms: 4200 });
    this.g.bus.emit('audio:sfx', { name: 'mervMutter', position: this.mervAt.clone(), volume: 0.48 });
    return true;
  }

  private duck(): void {
    if (this.duckCooldown > 0) return;
    this.duckTimer = 0.8; this.duckCooldown = 2.5;
  }

  private gullCue(kind: string, pitch: number): void {
    const key = `${this.state.cycle}:${kind}`;
    if (this.gullCues.has(key)) return;
    this.gullCues.add(key);
    if (this.gullCues.size > 48) this.gullCues.delete(this.gullCues.values().next().value!);
    this.g.bus.emit('audio:sfx', { name: 'gullSquawk', position: this.gull.position.clone(), volume: 0.32, pitch });
  }

  private observeDirector(): void {
    if (!this.g.has('director')) return;
    const p = this.g.get<{ getPresentation(): DirectorView | null }>('director').getPresentation();
    if (!p || p.phase === 'idle') return;
    const key = `${p.id}:${p.phase}:${p.result ?? ''}`;
    if (key === this.directorKey) return;
    this.directorKey = key;
    if (p.result === 'success' || p.result === 'complete') this.speak([5]);
    else if (p.result === 'failed' || p.result === 'expired' || p.result === 'missed') this.speak([6]);
    else if (/order|rush/i.test(p.kind) && p.phase === 'active') this.speak([4]);
    else if (p.phase === 'warning') this.speak([3]);
  }

  frameUpdate(dt: number): void {
    this.talkCooldown = Math.max(0, this.talkCooldown - dt);
    this.caption.remaining = Math.max(0, this.caption.remaining - dt);
    this.gesture = Math.max(0, this.gesture - dt);
    this.duckTimer = Math.max(0, this.duckTimer - dt);
    this.duckCooldown = Math.max(0, this.duckCooldown - dt);
    // Batch all actual sale lines before choosing a reaction. An ordinary
    // apple must not consume the exceptional-sale joke before its batch ends.
    if (this.saleTotal > 0) {
      this.speak(this.saleTotal >= 150 ? [2] : [1]);
      this.saleTotal = 0;
    }
    this.observeDirector();
    const near = this.g.player.position.distanceToSquared(this.mervAt) < 12 * 12;
    // A conclusion saved for the player's return takes precedence over a
    // greeting, which would otherwise delay it by another thirty seconds.
    if (near && this.pendingComment !== null) {
      if (this.talkSeen.has(this.pendingComment) || this.speak([this.pendingComment])) this.pendingComment = null;
    }
    if (near && !this.nearBefore) this.speak([0, 11]);
    this.nearBefore = near;
    const time = this.g.clock.elapsed;
    this.head.rotation.y = near ? THREE.MathUtils.clamp(
      Math.atan2(this.g.player.position.x - this.mervAt.x, this.g.player.position.z - this.mervAt.z) + 0.9, -0.48, 0.48) : Math.sin(time * 0.28) * 0.12;
    const duck = Math.min(1, this.duckTimer * 5);
    this.merv.scale.y = 0.90 - duck * 0.055;
    this.head.position.y = 1.63 - duck * 0.20;
    this.head.rotation.z = Math.sin(time * 1.4) * 0.015;
    this.head.rotation.x = duck * 0.24 + (this.gesture > 0 ? Math.sin(time * 5) * 0.055 : 0);
    this.arms[1].rotation.z = this.gesture > 0 ? -0.14 - Math.sin(time * 4.8) * 0.12 : 0;
    this.arms[0].rotation.x = Math.sin(time * 1.2) * 0.025 - duck * 0.75;
    this.arms[1].rotation.x = -duck * 0.75;
    if (!this.fruit.authoritative) this.state.elapsed = this.state.phase === 'perched'
      ? this.state.elapsed + dt : Math.min(this.state.duration, this.state.elapsed + dt);
    const t = THREE.MathUtils.clamp(this.state.elapsed / this.state.duration, 0, 1);
    const flight = this.state.phase !== 'perched';
    const inspection = this.state.phase === 'return' && this.state.target < 0
      && _point.fromArray(this.state.from).distanceToSquared(_from.fromArray(this.state.to)) < 0.001;
    const perchTime = this.state.elapsed;
    const hopTime = perchTime % 9;
    const hop = !flight && hopTime > 3 && hopTime < 3.8
      ? Math.abs(Math.sin((hopTime - 3) / 0.8 * Math.PI * 2)) * 0.16 : 0;
    const preen = !flight && perchTime % 18 > 11 && perchTime % 18 < 13.5;
    this.gull.position.fromArray(this.state.from).lerp(_point.fromArray(this.state.to), t * t * (3 - 2 * t));
    if (flight) this.gull.position.y += Math.sin(t * Math.PI) * 2.0;
    else this.gull.position.y += hop;
    if (inspection) {
      this.gull.position.x += Math.sin(t * Math.PI) * 1.8;
      this.gull.position.z += Math.sin(t * Math.PI * 2) * 0.6;
    }
    _point.fromArray(this.state.to).sub(_from.fromArray(this.state.from));
    this.gull.rotation.y = flight && _point.lengthSq() > 0.01 ? Math.atan2(_point.x, _point.z) : -0.9;
    if (inspection) this.gull.rotation.y = Math.atan2(
      Math.cos(t * Math.PI) * 1.8, Math.cos(t * Math.PI * 2) * 1.2);
    this.gull.rotation.z = flight ? Math.sin(t * Math.PI * 2) * 0.12 : preen ? 0.13 : 0;
    this.wings[0].rotation.z = flight ? 0.12 + Math.sin(time * 13) * 0.60 : 0.92;
    this.wings[1].rotation.z = -this.wings[0].rotation.z;
    if (!flight && hop > 0) {
      this.wings[0].rotation.z = 0.55; this.wings[1].rotation.z = -0.55;
    }
    let watching: THREE.Vector3 | undefined;
    let nearest = 18 * 18;
    if (!flight) for (const member of this.crew()) {
      const distance = member.position.distanceToSquared(this.home);
      if (distance < nearest) { nearest = distance; watching = member.position; }
    }
    this.gullHead.rotation.y = preen ? 1.25 : watching ? THREE.MathUtils.clamp(
      Math.atan2(watching.x - this.home.x, watching.z - this.home.z) - this.gull.rotation.y, -0.9, 0.9)
      : Math.sin(perchTime * 0.75) * 0.45;
    this.gullHead.rotation.z = !flight && !preen ? Math.sin(perchTime * 1.7) * 0.16 : 0;
    this.gullHead.rotation.x = preen ? 0.75 : this.state.phase === 'approach' && t > 0.85 ? 0.5 : Math.sin(time * 0.9) * 0.07;
    if (this.state.phase === 'approach') this.gullCue('approach', 1);
    if (this.state.phase === 'scared') this.gullCue('scared', 1.2);
    if (this.state.pecked && this.state.target >= 0) this.gullCue('peck', 1.15);
  }

  netState(): CharacterNetState { return { ...this.state, from: [...this.state.from], to: [...this.state.to] }; }
  applyNet(s: CharacterNetState | null): void {
    if (!s || !['perched', 'approach', 'return', 'scared'].includes(s.phase)
      || !Array.isArray(s.from) || s.from.length !== 3 || !Array.isArray(s.to) || s.to.length !== 3
      || typeof s.enabled !== 'boolean' || typeof s.pecked !== 'boolean'
      || !Number.isInteger(s.target) || !Number.isInteger(s.cycle)
      || ![...s.from, ...s.to, s.duration, s.elapsed, s.cooldown, s.grace].every(Number.isFinite)) return;
    this.state = { ...s, from: [...s.from], to: [...s.to], duration: Math.max(0.1, s.duration),
      cooldown: Math.max(0, s.cooldown), grace: Math.max(0, s.grace) };
  }

  private buildMerv(): void {
    // main.ts selects the pilot mode before systems initialise. Keep the
    // original resident in baseline and comparison fixtures.
    if (typeof window !== 'undefined'
      && (window as unknown as { __RIPE_VISUAL_MODE?: string }).__RIPE_VISUAL_MODE === 'voxel') {
      this.buildVoxelMerv(); return;
    }
    this.merv.name = 'Merv';
    this.merv.add(mesh([
      ellipsoid([0, 0.92, 0], [0.36, 0.54, 0.24], SHIRT),
      ellipsoid([0, 0.93, 0.115], [0.33, 0.43, 0.20], TEAL),
      box([0, 0.73, 0.286], [0.32, 0.22, 0.025], 0x2a5b55),
      box([0, 0.845, 0.304], [0.34, 0.026, 0.025], CREAM),
      box([-0.19, 1.33, 0.19], [0.063, 0.31, 0.046], CREAM, [0, 0, -0.16]),
      box([0.19, 1.33, 0.19], [0.063, 0.31, 0.046], CREAM, [0, 0, 0.16]),
      ellipsoid([-0.19, 0.38, 0], [0.15, 0.36, 0.16], INK),
      ellipsoid([0.19, 0.38, 0], [0.15, 0.36, 0.16], INK),
      ellipsoid([-0.19, 0.09, 0.10], [0.17, 0.11, 0.26], HAIR),
      ellipsoid([0.19, 0.09, 0.10], [0.17, 0.11, 0.26], HAIR),
      ellipsoid([0, 1.51, 0], [0.13, 0.14, 0.13], SKIN),
    ], this.material, 'MervApron'));
    this.head.position.y = 1.63;
    const face: THREE.BufferGeometry[] = [
      ellipsoid([0, 0.16, 0], [0.28, 0.32, 0.25], SKIN_LIGHT),
      ellipsoid([0, -0.015, 0.01], [0.23, 0.15, 0.23], SKIN),
      ellipsoid([-0.275, 0.13, 0], [0.075, 0.115, 0.07], SKIN),
      ellipsoid([0.275, 0.13, 0], [0.075, 0.115, 0.07], SKIN),
      ellipsoid([0, 0.11, 0.259], [0.078, 0.082, 0.096], SKIN),
      ellipsoid([-0.073, 0.02, 0.245], [0.10, 0.046, 0.041], HAIR),
      ellipsoid([0.073, 0.02, 0.245], [0.10, 0.046, 0.041], HAIR),
      box([0, -0.042, 0.237], [0.105, 0.018, 0.018], INK),
      cylinder([0, 0.41, 0], 0.42, 0.43, 0.055, CREAM),
      cylinder([0, 0.53, 0], 0.245, 0.30, 0.20, 0xd3b86d),
      cylinder([0, 0.455, 0], 0.291, 0.307, 0.07, TEAL),
    ];
    for (const s of [-1, 1]) {
      face.push(ellipsoid([s * 0.104, 0.197, 0.225], [0.051, 0.044, 0.028], CREAM));
      face.push(ellipsoid([s * 0.098, 0.196, 0.248], [0.019, 0.025, 0.015], INK));
      face.push(box([s * 0.107, 0.259, 0.222], [0.106, 0.032, 0.032], HAIR, [0, 0, s * -0.11]));
    }
    this.head.add(mesh(face, this.material, 'MervFace')); this.merv.add(this.head);
    for (const s of [-1, 1]) {
      const arm = new THREE.Group(); arm.position.set(s * 0.32, 1.33, 0);
      arm.add(mesh([
        ellipsoid([s * 0.09, -0.17, 0.05], [0.15, 0.27, 0.15], SHIRT),
        ellipsoid([s * 0.12, -0.31, 0.25], [0.115, 0.115, 0.26], SKIN),
        ellipsoid([s * 0.10, -0.29, 0.48], [0.14, 0.078, 0.14], SKIN_LIGHT),
        ellipsoid([s * 0.005, -0.25, 0.47], [0.055, 0.055, 0.09], SKIN),
      ], this.material, 'MervArm'));
      this.arms.push(arm); this.merv.add(arm);
    }
  }

  private buildVoxelMerv(): void {
    this.merv.name = 'Merv';
    const shirt = 0xb86b49, shirtLight = 0xd18a60, apron = 0x327568;
    const apronDark = 0x24574f, straw = 0xe8d29a, strawShade = 0xc6a865;
    const leather = 0x62483a, sole = 0x322f2d, skinShadow = 0xb4764d;

    // Broad apron, rolled sleeves, and a straw shop hat read as a merchant at
    // the game camera; stepped hems and small bevels share the worker's voxel
    // vocabulary without copying the worker's yellow uniform or backpack.
    const body: THREE.BufferGeometry[] = [
      roundedBox([0, 1.00, 0], [0.67, 0.93, 0.39], shirt, 0.055),
      roundedBox([0, 0.80, 0.225], [0.62, 0.83, 0.095], apron, 0.026),
      roundedBox([0, 1.31, 0.223], [0.44, 0.30, 0.105], apron, 0.025),
      roundedBox([0, 0.42, 0.254], [0.63, 0.09, 0.105], apronDark, 0.018),
      roundedBox([0, 1.06, 0.291], [0.32, 0.18, 0.035], apronDark, 0.012),
      roundedBox([0, 1.12, 0.311], [0.25, 0.025, 0.02], straw, 0.006),
      roundedBox([-0.14, 0.78, 0.29], [0.11, 0.032, 0.025], strawShade, 0.005),
      roundedBox([0, 1.51, 0], [0.17, 0.17, 0.17], SKIN, 0.026),
    ];
    for (const s of [-1, 1]) {
      body.push(roundedBox([s * 0.20, 1.40, 0.20], [0.085, 0.31, 0.08],
        straw, 0.015, [0, 0, s * 0.15]));
      body.push(roundedBox([s * 0.18, 0.39, 0], [0.27, 0.64, 0.29],
        0x645b4b, 0.035));
      body.push(roundedBox([s * 0.18, 0.12, 0.09], [0.32, 0.20, 0.42],
        leather, 0.036));
      body.push(roundedBox([s * 0.18, 0.041, 0.105], [0.34, 0.075, 0.44],
        sole, 0.014));
      body.push(roundedBox([s * 0.18, 0.59, 0.025], [0.28, 0.075, 0.31],
        0x8e795c, 0.012));
    }
    this.merv.add(mesh(body, this.material, 'MervVoxelApron'));

    this.head.position.y = 1.63;
    const face: THREE.BufferGeometry[] = [
      roundedBox([0, 0.14, 0], [0.51, 0.55, 0.44], SKIN_LIGHT, 0.058),
      roundedBox([0, -0.056, 0.012], [0.42, 0.17, 0.42], SKIN, 0.035),
      roundedBox([0, 0.095, 0.251], [0.12, 0.13, 0.095], SKIN, 0.025),
      roundedBox([0, -0.07, 0.231], [0.11, 0.023, 0.024], INK, 0.006),
      roundedBox([0, 0.42, 0], [0.81, 0.075, 0.69], straw, 0.023),
      roundedBox([0, 0.52, 0], [0.46, 0.21, 0.43], strawShade, 0.035),
      roundedBox([0, 0.454, 0], [0.48, 0.065, 0.45], apron, 0.014),
      roundedBox([0, 0.635, 0], [0.37, 0.018, 0.34], straw, 0.006),
    ];
    for (const s of [-1, 1]) {
      face.push(roundedBox([s * 0.26, 0.09, 0], [0.075, 0.14, 0.12],
        skinShadow, 0.021));
      face.push(roundedBox([s * 0.105, 0.174, 0.232], [0.055, 0.067, 0.025],
        CREAM, 0.01));
      face.push(roundedBox([s * 0.105, 0.168, 0.252], [0.023, 0.034, 0.016],
        INK, 0.004));
      face.push(roundedBox([s * 0.105, 0.255, 0.229], [0.14, 0.039, 0.038],
        HAIR, 0.012, [0, 0, -s * 0.08]));
      face.push(roundedBox([s * 0.085, -0.003, 0.242], [0.17, 0.065, 0.047],
        HAIR, 0.018, [0, 0, s * 0.13]));
    }
    this.head.add(mesh(face, this.material, 'MervVoxelFace'));
    this.merv.add(this.head);

    for (const s of [-1, 1]) {
      const arm = new THREE.Group(); arm.position.set(s * 0.32, 1.33, 0);
      arm.add(mesh([
        roundedBox([s * 0.09, -0.14, 0.015], [0.26, 0.34, 0.27],
          shirt, 0.040),
        roundedBox([s * 0.10, -0.30, 0.035], [0.265, 0.09, 0.28],
          shirtLight, 0.018),
        roundedBox([s * 0.11, -0.34, 0.20], [0.20, 0.19, 0.38],
          SKIN, 0.036),
        roundedBox([s * 0.10, -0.32, 0.41], [0.22, 0.12, 0.17],
          SKIN_LIGHT, 0.027),
        roundedBox([s * 0.005, -0.28, 0.435], [0.07, 0.07, 0.11],
          SKIN_LIGHT, 0.017),
      ], this.material, 'MervVoxelArm'));
      this.arms.push(arm); this.merv.add(arm);
    }
  }

  private buildGull(): void {
    if (typeof window !== 'undefined'
      && (window as unknown as { __RIPE_VISUAL_MODE?: string }).__RIPE_VISUAL_MODE === 'voxel') {
      this.buildVoxelGull(); return;
    }
    this.gull.name = 'SunpatchGull';
    this.gull.add(mesh([
      ellipsoid([0, 0.23, 0], [0.20, 0.23, 0.35], 0xf0eee0),
      ellipsoid([0, 0.32, -0.10], [0.205, 0.13, 0.26], 0xa6b2b1),
      box([0, 0.20, -0.38], [0.24, 0.048, 0.26], 0xe1e4db, [0.20, 0, 0]),
      box([-0.085, 0.07, 0.03], [0.025, 0.13, 0.027], 0xd5933c),
      box([0.085, 0.07, 0.03], [0.025, 0.13, 0.027], 0xd5933c),
      ellipsoid([-0.085, 0.014, 0.08], [0.065, 0.02, 0.10], 0xd5933c),
      ellipsoid([0.085, 0.014, 0.08], [0.065, 0.02, 0.10], 0xd5933c),
    ], this.material, 'GullBody'));
    this.gullHead.position.set(0, 0.40, 0.19);
    this.gullHead.add(mesh([
      ellipsoid([0, 0.02, 0.06], [0.15, 0.17, 0.16], 0xf7f3e3),
      ellipsoid([0, -0.017, 0.24], [0.057, 0.048, 0.14], 0xe6b544),
      ellipsoid([0, -0.035, 0.32], [0.041, 0.030, 0.042], 0xac583d),
      ellipsoid([-0.128, 0.055, 0.125], [0.023, 0.026, 0.025], INK),
      ellipsoid([0.128, 0.055, 0.125], [0.023, 0.026, 0.025], INK),
    ], this.material, 'GullFace'));
    this.gull.add(this.gullHead);
    for (const s of [-1, 1]) {
      const wing = new THREE.Group(); wing.position.set(s * 0.15, 0.32, -0.02);
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.13); shape.lineTo(0.37, 0.20); shape.lineTo(0.78, 0.02);
      shape.lineTo(0.70, -0.06); shape.lineTo(0.59, -0.065); shape.lineTo(0.53, -0.13);
      shape.lineTo(0.43, -0.13); shape.lineTo(0.35, -0.22); shape.lineTo(0, -0.20); shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.038, bevelEnabled: false, steps: 1 });
      g.rotateX(-Math.PI / 2);
      const p = g.getAttribute('position'), colors = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) C(p.getX(i) > 0.52 ? 0x34474a : 0xcad1ca).toArray(colors, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const wm = new THREE.Mesh(g, this.material); wm.scale.x = s; wm.castShadow = true;
      wing.add(wm); this.gull.add(wing); this.wings.push(wing);
    }
  }

  private buildVoxelGull(): void {
    this.gull.name = 'SunpatchGull';
    const body = new THREE.Mesh(voxelGullBodyGeometry(), this.material);
    body.name = 'GullVoxelBody'; body.castShadow = true; body.receiveShadow = true;
    this.gull.add(body);

    this.gullHead.position.set(0, 0.40, 0.19);
    const face = new THREE.Mesh(voxelGullFaceGeometry(), this.material);
    face.name = 'GullVoxelFace'; face.castShadow = true; face.receiveShadow = true;
    this.gullHead.add(face); this.gull.add(this.gullHead);

    for (const s of [-1, 1]) {
      const wing = new THREE.Group(); wing.position.set(s * 0.15, 0.32, -0.02);
      const feathers = new THREE.Mesh(voxelGullWingGeometry(), this.material);
      feathers.name = 'GullVoxelWing'; feathers.scale.x = s;
      feathers.castShadow = true; feathers.receiveShadow = true;
      wing.add(feathers); this.gull.add(wing); this.wings.push(wing);
    }
  }

  dispose(): void {
    for (const off of this.off) off(); this.off.length = 0;
    this.root.removeFromParent();
    this.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.material.dispose();
  }
}

function paint(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  if (g.index) { const flat = g.toNonIndexed(); g.dispose(); g = flat; }
  const colors = new Float32Array(g.getAttribute('position').count * 3), c = C(color);
  for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); return g;
}
function ellipsoid(at: Point, size: Point, color: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 12, 8); g.scale(...size); g.translate(...at); return paint(g, color);
}
function box(at: Point, size: Point, color: number, rotation: Point = [0, 0, 0]): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(...size); g.rotateX(rotation[0]); g.rotateY(rotation[1]); g.rotateZ(rotation[2]);
  g.translate(...at); return paint(g, color);
}
function roundedBox(at: Point, size: Point, color: number, radius: number,
  rotation: Point = [0, 0, 0]): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(...size, 2, radius);
  g.rotateX(rotation[0]); g.rotateY(rotation[1]); g.rotateZ(rotation[2]);
  g.translate(...at); return paint(g, color);
}
function cylinder(at: Point, top: number, bottom: number, height: number, color: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(top, bottom, height, 14); g.translate(...at); return paint(g, color);
}
function mesh(parts: THREE.BufferGeometry[], material: THREE.Material, name: string): THREE.Mesh {
  const g = mergeGeometries(parts, false); if (!g) throw new Error(`Cannot merge ${name}`);
  for (const p of parts) p.dispose(); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, material); m.name = name; m.castShadow = true; m.receiveShadow = true; return m;
}
const UP = new THREE.Vector3(0, 1, 0), _point = new THREE.Vector3(), _from = new THREE.Vector3();
