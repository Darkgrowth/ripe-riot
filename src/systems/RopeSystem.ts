import * as THREE from 'three';
import type { Game, System } from '@/core/Game';
import type { RBody } from '@/physics/PhysicsWorld';
import type { FruitSystem } from '@/fruit/FruitSystem';
import { Palette } from '@/render/Palette';
import { clamp } from '@/core/MathUtils';

/**
 * What a rope end is tied to.
 *
 *   world      a fixed point in space (a pin on rock, a vine anchor)
 *   fruit      a fruit, by id, whether it is on the branch or loose
 *   legendary  the King Melon's body
 *   player     THIS peer's own player
 *   peer       another peer's player, known only by reported position
 *
 * Ends are resolved from these every step rather than from cached bodies.
 * Two reasons. Holding a Rapier body across its removal calls into freed WASM
 * memory and poisons every later physics call — the first rope system learned
 * that the hard way. And a fruit changes bodies during its life: a static
 * collider on the branch, a dynamic one once it is loose, none in someone's
 * hands. A rope fired at an apple on the tree used to stay tied to a point in
 * the air when the apple came down; resolving by fruit id follows it.
 */
export type RopeEndKind = 'world' | 'fruit' | 'legendary' | 'player' | 'peer';

export interface RopeEnd {
  kind: RopeEndKind;
  /** World point for 'world'; an offset in the target's local frame otherwise. */
  local: THREE.Vector3;
  /** Gameplay id of the thing held: fruit id, legendary id, local player id, else -1. */
  ownerId: number;
  /** Transport id of the player, for 'peer' ends. */
  peer?: string;
}

/**
 * How a rope is known on the wire. Ropes are identified by WHO MADE THEM and
 * THEIR OWN ID for it — `(owner, cid)` — so a peer never has to re-key a rope
 * it has already handed to its tools. The host's own ropes use its rope ids
 * as cids. A `mirror` is this peer's cosmetic copy of a rope some other peer
 * owns; it is never solved against anything this peer simulates except its
 * own player, and it is never reported back.
 */
export interface RopeNetId {
  owner: string;
  cid: number;
  mirror: boolean;
  /** Client: the host has acknowledged this rope, so its absence from a
   *  snapshot means it is gone rather than not yet arrived. */
  acked: boolean;
  /** Game time it was made, so a just-fired rope survives the snapshot that
   *  crossed its request in the post. */
  bornAt: number;
}

export interface Rope {
  id: number;
  a: RopeEnd;
  b: RopeEnd;
  length: number;
  restLength: number;
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
  /** One end is in somebody's hands (this player's or a remote one's). */
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
  /** Travels to other peers. Vines do not: both peers grow them from the seed. */
  shared: boolean;
  net?: RopeNetId;
}

/** What the rope system needs from the network layer. Null in single player. */
export interface RopeNet {
  readonly authoritative: boolean;
  readonly connected: boolean;
  readonly me: string;
  /** Where a remote player's hands are. False if that peer is gone. */
  peerHands(peer: string, out: THREE.Vector3): boolean;
  requestRopeCreate(rope: Rope): void;
  requestRopeRelease(cid: number): void;
  requestRopeReel(cid: number, rate: number): void;
}

export type RopeGone = 'released' | 'snapped' | 'gone' | 'cut';

/** The resolved state of one end, for this step. */
interface EndState {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** A dynamic body this peer simulates and may push. */
  body: RBody | null;
  /** The local player: pushed through the controller, not through Rapier. */
  player: boolean;
  /** For the impulse split. 0 is immovable. A movable thing simulated by
   *  ANOTHER peer still has its real inverse mass here, so this peer applies
   *  only its own share of the correction to the end it owns. */
  invMass: number;
  /** A gluefruit stuck fast: immovable until pulled hard enough. */
  stuck: boolean;
  fruitId: number;
}

const SEGMENTS = 12;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _n = new THREE.Vector3();
const _imp = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _pull = new THREE.Vector3();
const _ea: EndState = newEndState();
const _eb: EndState = newEndState();

function newEndState(): EndState {
  return {
    alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), body: null,
    player: false, invMass: 0, stuck: false, fruitId: -1,
  };
}

/**
 * Ropes as maximum-distance constraints rather than chains of jointed segments.
 *
 * A ten-segment rope per tether looks marginally better and costs an order of
 * magnitude more solver work, and it goes unstable exactly when the game is at
 * its most interesting (a two-tonne melon on four tethers). One constraint plus
 * a drawn catenary gives the same gameplay — goes taut, transmits force, can be
 * winched, can snap — and stays stable under load.
 *
 * In co-op every rope is shared state and the HOST owns it. A client's rope
 * gun creates a local rope and asks; the host builds the same rope, and from
 * then on the client's copy follows the host's length and lifetime. What the
 * client still solves locally is the one end it owns — its own player — so a
 * leash tugs on the frame it goes taut rather than a round trip later. The
 * other end is a stand-in with the real thing's mass, so the client's player
 * gets exactly the share of the correction it would get if both bodies were
 * here, and the host applies the other share to the fruit.
 */
export class RopeSystem implements System {
  readonly name = 'ropes';
  private g!: Game;
  private fruitSys!: FruitSystem;
  private legendary: { body: RBody | null; id: number; authoritative: boolean } | null = null;
  ropes = new Map<number, Rope>();
  private group = new THREE.Group();
  private meshes = new Map<number, THREE.Mesh>();
  private material!: THREE.MeshStandardMaterial;
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  /** Installed by MultiplayerAuthority. Null in single player. */
  net: RopeNet | null = null;
  /** Host: told whenever a shared rope leaves the world, and why. */
  onRemoved: ((rope: Rope, why: RopeGone) => void) | null = null;
  /** Last reel rate sent to the host per rope, for throttling. */
  private sentReel = new Map<number, { rate: number; at: number }>();

  init(g: Game): void {
    this.g = g;
    this.fruitSys = g.get<FruitSystem>('fruit');
    this.group.name = 'Ropes';
    g.renderer.scene.add(this.group);
    this.material = new THREE.MeshStandardMaterial({
      color: Palette.rope, roughness: 0.95, metalness: 0, flatShading: true,
    });
    this.material.name = 'rope';

    g.debug?.addProbe('ropes', () => ({
      count: this.ropes.size,
      shared: [...this.ropes.values()].filter((r) => r.shared).length,
      mirrors: [...this.ropes.values()].filter((r) => r.net?.mirror).length,
      taut: [...this.ropes.values()].filter((r) => r.tension > 0.05).length,
      list: [...this.ropes.values()].map((r) => {
        this.endPoint(r.a, _a); this.endPoint(r.b, _b);
        return {
          id: r.id, len: +r.length.toFixed(2), dist: +_a.distanceTo(_b).toFixed(2),
          tension: +r.tension.toFixed(0), a: r.a.ownerId, b: r.b.ownerId,
          ak: r.a.kind, bk: r.b.kind, held: r.heldByPlayer,
          owner: r.net?.owner ?? null, cid: r.net?.cid ?? null,
          mirror: r.net?.mirror ?? false, acked: r.net?.acked ?? null,
        };
      }),
    }));
    g.debug?.addAction('rope.count', () => this.ropes.size);
    g.debug?.addAction('rope.clear', () => { const n = this.ropes.size; this.clear(); return n; });
    /** Ropes whose ends are at least one of `kinds`, by id, for the suites. */
    g.debug?.addAction('rope.on', (ownerId: number) => this.attachedTo(ownerId).map((r) => r.id));
    /** Tie a fruit to a world point, the way the debug and the tests do. */
    g.debug?.addAction('rope.tieFruit', (fruitId: number, x: number, y: number, z: number,
      len: number, maxTension = 1e9) => {
      const r = this.create(
        { kind: 'world', local: new THREE.Vector3(x, y, z), ownerId: -1 },
        { kind: 'fruit', local: new THREE.Vector3(0, 0, 0), ownerId: fruitId },
        len, { maxTension },
      );
      return r.id;
    });
    g.debug?.addAction('rope.reel', (id: number, rate: number) => { this.setReel(id, rate); return rate; });
    g.debug?.addAction('rope.release', (id: number) => { this.remove(id, 'released'); return this.ropes.size; });
  }

  private get leg(): { body: RBody | null; id: number; authoritative: boolean } | null {
    if (!this.legendary && this.g.has('legendary')) {
      this.legendary = this.g.get<{ body: RBody | null; id: number; authoritative: boolean }>('legendary');
    }
    return this.legendary;
  }

  /** True when this peer decides rope lifetimes. Always true in single player. */
  get authoritative(): boolean { return !this.net || this.net.authoritative; }
  private get isClient(): boolean { return !!this.net && this.net.connected && !this.net.authoritative; }

  /**
   * Create a rope between two ends.
   *
   * Shared ropes (the default) exist on every peer: on the host directly, on
   * a client as a local copy plus a request the host answers by building its
   * own. Pass `shared: false` for things every peer grows for itself, like
   * the legendary's vines.
   */
  create(a: RopeEnd, b: RopeEnd, length: number, opts: {
    maxTension?: number; minLength?: number; color?: THREE.Color;
    radius?: number; cuttable?: boolean; shared?: boolean; net?: RopeNetId;
  } = {}): Rope {
    const id = this.g.newId();
    const shared = opts.shared ?? true;
    const rope: Rope = {
      id,
      a: { kind: a.kind, local: a.local.clone(), ownerId: a.ownerId, peer: a.peer },
      b: { kind: b.kind, local: b.local.clone(), ownerId: b.ownerId, peer: b.peer },
      length, restLength: length,
      maxTension: opts.maxTension ?? 2600,
      tension: 0,
      tensionAvg: 0,
      reelRate: 0,
      minLength: opts.minLength ?? 0.8,
      broken: false,
      heldByPlayer: isHand(a) || isHand(b),
      color: opts.color ?? Palette.rope,
      radius: opts.radius ?? 0.045,
      cuttable: opts.cuttable ?? false,
      taut: false,
      creak: 0,
      tugCool: 0,
      shared,
      net: opts.net,
    };
    if (shared && !rope.net && this.net?.connected) {
      rope.net = {
        owner: this.net.me, cid: id, mirror: false,
        acked: this.net.authoritative, bornAt: this.g.clock.elapsed,
      };
    }
    this.ropes.set(id, rope);
    this.makeMesh(rope);
    // A rope on a fruit restrains it: a Vinebomb on a line does not launch as
    // hard. Host-side state, so only the peer that owns the fruit writes it.
    if (this.fruitSys.authoritative) {
      for (const end of [a, b]) {
        if (end.kind !== 'fruit') continue;
        const f = this.fruitSys.get(end.ownerId);
        if (f) f.restraint = Math.min(0.95, f.restraint + 0.42);
      }
    }
    this.g.bus.emit('rope:attached', { ropeId: id, aId: a.ownerId, bId: b.ownerId });
    if (rope.net && !rope.net.mirror && this.isClient) this.net!.requestRopeCreate(rope);
    return rope;
  }

  /** Client: a cosmetic copy of a rope some other peer owns. */
  createMirror(owner: string, cid: number, a: RopeEnd, b: RopeEnd, length: number): Rope {
    return this.create(a, b, length, {
      maxTension: 1e9,
      net: { owner, cid, mirror: true, acked: true, bornAt: this.g.clock.elapsed },
    });
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
    if (!r) return;
    r.reelRate = rate;
    // A client winches its own copy for feel and tells the host, which winches
    // the real one. The ramp calls this every step; the host does not need
    // sixty messages a second to follow a number that moves smoothly.
    if (r.net && !r.net.mirror && this.isClient) {
      const last = this.sentReel.get(id);
      const now = this.g.clock.elapsed;
      const changed = !last || Math.abs(last.rate - rate) > 0.2
        || (rate === 0) !== (last.rate === 0) || now - last.at > 0.5;
      if (changed) {
        this.sentReel.set(id, { rate, at: now });
        this.net!.requestRopeReel(r.net.cid, rate);
      }
    }
  }

  setLength(id: number, length: number): void {
    const r = this.ropes.get(id);
    if (!r) return;
    r.length = clamp(length, r.minLength, r.restLength * 3);
  }

  /** Client: the host's word on how long one of our ropes is. */
  followLength(id: number, length: number): void {
    const r = this.ropes.get(id);
    if (!r) return;
    // Only correct real drift: fighting the local winch every 66 ms for a
    // few centimetres reads as a stutter on the line.
    if (Math.abs(r.length - length) > 0.3) r.length = length;
  }

  /**
   * Remove a rope. `why` is what the other peers hear: a snap is a sound and
   * a toast, a release is silent.
   */
  remove(id: number, why: RopeGone = 'released', fromHost = false): void {
    const r = this.ropes.get(id);
    if (!r) return;
    const mesh = this.meshes.get(id);
    if (mesh) { this.group.remove(mesh); mesh.geometry.dispose(); this.meshes.delete(id); }
    this.ropes.delete(id);
    this.sentReel.delete(id);
    if (!r.net) return;
    if (r.net.mirror) return;
    if (this.isClient) {
      // Ours, and we let go: the host has to let go of the real one too.
      if (!fromHost) this.net!.requestRopeRelease(r.net.cid);
    } else if (this.onRemoved) {
      this.onRemoved(r, why);
    }
  }

  clear(): void {
    for (const id of [...this.ropes.keys()]) this.remove(id, 'gone');
  }

  /** Every rope currently attached to a given entity id. */
  attachedTo(ownerId: number): Rope[] {
    const out: Rope[] = [];
    for (const r of this.ropes.values()) {
      if (r.a.ownerId === ownerId || r.b.ownerId === ownerId) out.push(r);
    }
    return out;
  }

  /** A shared rope by its wire identity. */
  findByKey(owner: string, cid: number): Rope | null {
    for (const r of this.ropes.values()) {
      if (r.net && r.net.owner === owner && r.net.cid === cid) return r;
    }
    return null;
  }

  /** Host: everything a departed peer was holding comes down with them. */
  removeOwnedBy(peer: string): number {
    let n = 0;
    for (const r of [...this.ropes.values()]) {
      if (r.net?.owner === peer || r.a.peer === peer || r.b.peer === peer) {
        this.remove(r.id, 'gone');
        n++;
      }
    }
    return n;
  }

  /** Every cosmetic copy goes; used when leaving a session. */
  dropMirrors(): void {
    for (const r of [...this.ropes.values()]) if (r.net?.mirror) this.remove(r.id, 'gone', true);
  }

  /**
   * Promoted to host: the mirrors were somebody's real ropes and now they are
   * ours to keep, and our own ropes need no acknowledgement any more.
   */
  adoptMirrors(): void {
    for (const r of this.ropes.values()) {
      if (!r.net) continue;
      r.net.mirror = false;
      r.net.acked = true;
    }
  }

  /**
   * Leaving a session. The ropes were the host's: a client that leaves
   * leaves them behind, all of them, because the host has already dropped
   * its copies and a local line to a fruit nobody else agrees about is a
   * ghost. A host that leaves keeps its own ropes — going solo is seamless
   * for the peer that was already the authority — but they stop being
   * anybody's on the wire until `rehome` tags them for the next session.
   */
  leaveSession(wasHost: boolean): void {
    for (const r of [...this.ropes.values()]) {
      if (!r.net) continue;
      if (!wasHost || r.net.mirror) { this.remove(r.id, 'gone', true); continue; }
      r.net = undefined;
    }
    this.sentReel.clear();
  }

  /**
   * Joining a session with ropes already out (a host that played solo first,
   * or one that hosted, left and came back): every shared rope without a
   * wire identity becomes ours, and if we are a client the host is asked to
   * build each one.
   */
  rehome(): void {
    if (!this.net?.connected) return;
    for (const r of this.ropes.values()) {
      if (!r.shared || r.net) continue;
      r.net = {
        owner: this.net.me, cid: r.id, mirror: false,
        acked: this.net.authoritative, bornAt: this.g.clock.elapsed,
      };
      if (this.isClient) this.net.requestRopeCreate(r);
    }
  }

  // ---- resolution ---------------------------------------------------------
  /**
   * Where an end is right now, and what may be pushed to move it.
   *
   * The whole authority story for ropes is in the `invMass` this returns. A
   * body this peer simulates gets its real inverse mass and gets pushed. A
   * body some other peer simulates (a replica fruit on a client, a remote
   * player on the host) ALSO gets its real inverse mass — so the split is the
   * same on both machines — but nothing here pushes it; the peer that owns it
   * applies that share. An immovable thing gets zero.
   */
  private resolve(end: RopeEnd, out: EndState): EndState {
    out.alive = true;
    out.body = null;
    out.player = false;
    out.invMass = 0;
    out.stuck = false;
    out.fruitId = -1;
    out.vel.set(0, 0, 0);
    switch (end.kind) {
      case 'world':
        out.pos.copy(end.local);
        return out;
      case 'player': {
        const p = this.g.player;
        out.pos.copy(p.position).add(end.local);
        if (p.state === 'active') {
          out.player = true;
          out.invMass = 1 / PLAYER_MASS;
          out.vel.copy(p.velocity);
        }
        return out;
      }
      case 'peer': {
        if (!this.net || !end.peer || !this.net.peerHands(end.peer, out.pos)) {
          out.alive = false;
          return out;
        }
        out.invMass = 1 / PLAYER_MASS;
        return out;
      }
      case 'fruit': {
        const f = this.fruitSys.get(end.ownerId);
        if (!f || f.state === 'gone' || f.state === 'carried' || f.state === 'stowed') {
          out.alive = false;
          return out;
        }
        out.fruitId = f.id;
        out.pos.copy(end.local).applyQuaternion(f.quaternion).add(f.position);
        out.stuck = f.stuck;
        if (f.body && f.state === 'free') {
          if (f.stuck) return out;                       // fixed until pulled free
          out.body = f.body;
          out.invMass = 1 / Math.max(0.001, f.body.mass());
          const v = f.body.linvel();
          out.vel.set(v.x, v.y, v.z);
        } else if (f.state === 'free' && !this.fruitSys.authoritative && !f.stuck) {
          // The host simulates it; we only take our share of the correction.
          out.invMass = 1 / Math.max(0.001, f.mass);
        }
        // Attached fruit is part of the tree as far as a rope knows.
        return out;
      }
      case 'legendary': {
        const leg = this.leg;
        const body = leg?.body ?? null;
        if (!leg || !body) { out.alive = false; return out; }
        const t = body.translation();
        const r = body.rotation();
        _q.set(r.x, r.y, r.z, r.w);
        out.pos.copy(end.local).applyQuaternion(_q).add(_v3.set(t.x, t.y, t.z));
        if (!leg.authoritative) {
          // A client's melon is a fixed body moved to where the host says;
          // the real one is two and a half tonnes that the host is solving.
          out.invMass = 1 / Math.max(1, body.mass() || MELON_MASS_FALLBACK);
        } else if (!body.isFixed()) {
          out.body = body;
          out.invMass = 1 / Math.max(1, body.mass());
          const v = body.linvel();
          out.vel.set(v.x, v.y, v.z);
        }
        return out;
      }
      default:
        out.alive = false;
        return out;
    }
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
    for (const r of [...this.ropes.values()]) {
      const A = this.resolve(r.a, _ea);
      const B = this.resolve(r.b, _eb);
      // Either end can vanish between steps: the fruit was sold, the peer left.
      if (!A.alive || !B.alive) { this.remove(r.id, 'gone', !this.authoritative); continue; }
      if (r.tugCool > 0) r.tugCool = Math.max(0, r.tugCool - dt);

      if (r.reelRate !== 0) this.setLength(r.id, r.length + r.reelRate * dt);
      _n.copy(B.pos).sub(A.pos);
      const dist = _n.length();
      const slack = r.length - dist;
      if (dist < 1e-5 || slack >= 0) {
        r.tension = 0; r.tensionAvg *= TENSION_DECAY;
        this.setTaut(r, false);
        continue;
      }
      _n.multiplyScalar(1 / dist);

      // A gluefruit stuck to something comes free when a rope pulls on it
      // hard enough — the other end has to be able to pull, not just hang.
      if (this.fruitSys.authoritative && -slack > 0.12) {
        if (A.stuck && (B.player || B.invMass > 0 || B.body)) this.unstickFruit(A.fruitId);
        if (B.stuck && (A.player || A.invMass > 0 || A.body)) this.unstickFruit(B.fruitId);
      }

      const invSum = A.invMass + B.invMass;
      if (invSum <= 0) {
        r.tension = 0; r.tensionAvg *= TENSION_DECAY;
        this.setTaut(r, false);
        continue;
      }

      // Separation speed along the rope, positive when it is being pulled apart.
      const vSep = (B.vel.x - A.vel.x) * _n.x + (B.vel.y - A.vel.y) * _n.y + (B.vel.z - A.vel.z) * _n.z;

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
      if (A.player) this.pullPlayer(_imp, 1 / PLAYER_MASS, r);
      else if (A.body) A.body.applyImpulseAtPoint({ x: _imp.x, y: _imp.y, z: _imp.z },
        { x: A.pos.x, y: A.pos.y, z: A.pos.z }, true);
      if (B.player) this.pullPlayer(_imp, -1 / PLAYER_MASS, r);
      else if (B.body) B.body.applyImpulseAtPoint({ x: -_imp.x, y: -_imp.y, z: -_imp.z },
        { x: B.pos.x, y: B.pos.y, z: B.pos.z }, true);

      r.tension = j * invDt;
      r.tensionAvg += (r.tension - r.tensionAvg) * (1 - TENSION_DECAY);
      // A player leaning on a rope pinned to the world cannot part it: the
      // controller's ground acceleration is a feel number (62 m/s^2, 5 kN on
      // 82 kg), not a force a person can produce. Snapping needs a real load
      // on the other end. And only the host parts a shared rope: a client's
      // copy has a stand-in on one end and would snap at the wrong moment.
      const leaning = (A.player && B.invMass === 0) || (B.player && A.invMass === 0);
      const mayPart = this.authoritative && !r.net?.mirror;
      if (mayPart && r.tensionAvg > r.maxTension && !leaning) {
        this.g.bus.emit('rope:snapped', { ropeId: r.id });
        this.remove(r.id, 'snapped');
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

  private unstickFruit(id: number): void {
    const f = this.fruitSys.get(id);
    if (f?.stuck) f.unstick();
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

  /** World position of an end right now. Writes `out`; false if it is gone. */
  endPoint(end: RopeEnd, out: THREE.Vector3): boolean {
    const s = this.resolve(end, _ea);
    out.copy(s.pos);
    return s.alive;
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

  /** World-space endpoints, for hit-testing a rope the player is looking at.
   *  Writes into both arguments; never pass a vector the caller still needs. */
  endpoints(rope: Rope, a: THREE.Vector3, b: THREE.Vector3): void {
    this.endPoint(rope.a, a);
    this.endPoint(rope.b, b);
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }
}

function isHand(e: RopeEnd): boolean { return e.kind === 'player' || e.kind === 'peer'; }

/** What a rope thinks a harvester weighs. Matches the character controller. */
export const PLAYER_MASS = 82;
/** Where a rope ties to a person: chest height above the feet. */
export const HAND_OFFSET = new THREE.Vector3(0, 1.2, 0);
/** A client's melon body reports no mass while fixed; the real one weighs this. */
const MELON_MASS_FALLBACK = 2600;
/** Largest velocity change one step may put on the player, m/s. */
const MAX_PLAYER_YANK = 9;
/** Velocity change in one step worth reporting as a tug the player felt. */
const TUG_FELT = 1.2;
/** Tension (N) at which a rope reads as loaded rather than merely straight. */
const TAUT_N = 45;
/** Per-step retention of the smoothed tension: e^(-dt/0.15) at 60 Hz. */
const TENSION_DECAY = Math.exp(-(1 / 60) / 0.15);
