import * as THREE from 'three';
import type { Game, System } from '@/core/Game';
import type { Fruit } from '@/fruit/Fruit';
import type { FruitSystem, NetGate } from '@/fruit/FruitSystem';
import type { Economy } from '@/systems/Economy';
import type { InteractionSystem } from '@/interaction/InteractionSystem';
import type { Sunpatch } from '@/world/Sunpatch';
import { BroadcastTransport, type NetMessage, type PeerId, type Transport } from './Transport';
import { FruitAuthority, DENY_TEXT, type Deny } from './FruitAuthority';
import { makePlayerRig, SUIT_PRESETS, type PlayerRig } from '@/player/PlayerRig';
import { damp } from '@/core/MathUtils';

/** What a client is allowed to ask the host to do. */
export type IntentKind =
  | 'detach' | 'pick' | 'throw' | 'stow' | 'drop' | 'sell'
  | 'shove' | 'shake' | 'blast' | 'spawn';

export interface Intent {
  kind: IntentKind;
  playerId: PeerId;
  /** Request id, so the host's answer can be matched to what was asked. */
  rid: number;
  fruitId?: number;
  fruitIds?: number[];
  plantId?: number;
  /** World position, packed as a triple. */
  at?: [number, number, number];
  dir?: [number, number, number];
  vel?: [number, number, number];
  power?: number;
  strength?: number;
  /** What broke the stem: 'hand' is held to hand reach, tools are not. */
  cause?: string;
}

/** What a client is waiting to hear back about, and how to undo it. */
interface Pending {
  kind: IntentKind;
  fruitId: number;
  /** Every fruit this request touches, for sells. */
  ids: number[];
  /** The branch a predicted pick came off, so a refusal can put it back. */
  plantId: number;
  nodeIndex: number;
  at: number;
}

interface RemoteState {
  id: PeerId;
  pos: THREE.Vector3;
  targetPos: THREE.Vector3;
  yaw: number;
  targetYaw: number;
  height: number;
  state: string;
  carrying: string | null;
  name: string;
  suit: number;
  rig: PlayerRig;
  lastSeen: number;
}

/**
 * One fruit as it appears on the wire. Deliberately small and flat.
 *
 * `sizeRoll` rather than a rendered scale, because a peer that receives this
 * has to be able to REBUILD the fruit — species, variant and roll give the
 * same mass, radius and traits everywhere, and a replica whose mass is a guess
 * carries wrong, values wrong and sells wrong. `owner` is an index into the
 * snapshot's own peer list, or -1 for a fruit nobody is holding.
 */
type FruitPacket = [
  id: number, species: number, variant: number, state: number,
  x: number, y: number, z: number,
  qx: number, qy: number, qz: number, qw: number,
  sizeRoll: number, inflate: number, damage: number, owner: number,
];

const SPECIES_ORDER = ['apple', 'orange', 'coconut', 'banana', 'watermelon', 'puffmelon', 'vinebomb'];
const VARIANT_ORDER = ['', 'huge', 'tiny', 'pale', 'black', 'glowing', 'ancient', 'unstable', 'golden'];
const STATE_ORDER = ['attached', 'free', 'carried', 'stowed', 'gone'];

const SNAPSHOT_HZ = 15;
const PLAYER_HZ = 20;
/** Fastest a client may claim to have thrown something, in m/s. */
const MAX_RELEASE_SPEED = 45;
/** A prediction the host never answers is given back after this long. */
const PENDING_TIMEOUT = 4;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * Host-authoritative co-op.
 *
 * The split, stated once: the host owns the WORLD — which fruit exists, whose
 * hands it is in, what it is worth and when it is gone. Every client owns
 * exactly one thing, its own player, which it simulates locally and reports.
 * Everything else a client does is an INTENT: a request naming the fruit it
 * means, validated against the host's ledger (`FruitAuthority`) and either
 * applied or refused with a reason.
 *
 * Clients PREDICT the cheap, reversible half so the game still feels local —
 * a picked fruit is in your hands on the frame the key went down — and
 * reconcile to the host's answer, which arrives either as a targeted refusal
 * or as the next snapshot. Nothing that creates money is predicted.
 *
 * What is deliberately not here yet: delta compression, NAT traversal, and
 * host migration that carries the ledger with it (a client promoted to host
 * rebuilds only its own holdings).
 */
export class MultiplayerAuthority implements System, NetGate {
  readonly name = 'net';
  private g!: Game;
  private fruitSys!: FruitSystem;
  private economy!: Economy;
  private interaction!: InteractionSystem;
  private world!: Sunpatch;
  transport: Transport | null = null;
  peers: PeerId[] = [];
  /** Lowest peer id is the host; deterministic and needs no election round. */
  isHost = true;
  hostId: PeerId = '';
  connected = false;
  playerName = 'Harvester';
  suit = 0;

  /** The host's ledger. Live only while this peer is the host. */
  authority!: FruitAuthority;

  private remotes = new Map<PeerId, RemoteState>();
  private snapshotTimer = 0;
  private playerTimer = 0;
  private off: Array<() => void> = [];
  /** Fruit the host has told us about, so clients can drop stale ones. */
  private knownRemoteFruit = new Set<number>();
  /** Client-side mirror of the host's ledger, refreshed by every snapshot. */
  private mirrorOwner = new Map<number, PeerId>();
  /** Requests sent and not yet answered, by request id. */
  private pending = new Map<number, Pending>();
  /**
   * Fruit with a request in flight.
   *
   * Snapshots leave these alone. A snapshot is a picture of the host taken
   * BEFORE it saw the request, so applying it to a fruit we have just
   * predicted is guaranteed to be wrong for exactly one round trip: the fruit
   * pops out of your hands and back in again 66 ms later. The host's answer,
   * not the snapshot that crossed it in the post, is what settles these.
   */
  private pendingFruit = new Set<number>();
  /** Fruit we have asked to sell: no snapshot may bring these back. */
  private pendingSell = new Set<number>();
  private nextRid = 1;
  /** The last refusal this host issued. Diagnostic: a denial that is correct
   *  and a denial that is a bug look identical from the client's side. */
  lastDeny = '';
  stats = { sent: 0, received: 0, intents: 0, denied: 0, snapshotBytes: 0 };

  init(g: Game): void {
    this.g = g;
    this.fruitSys = g.get<FruitSystem>('fruit');
    this.economy = g.get<Economy>('economy');
    this.interaction = g.get<InteractionSystem>('interaction');
    this.world = g.get<Sunpatch>('world');
    // The gate that makes stems and shakes host-only, everywhere at once.
    this.fruitSys.net = this;

    this.authority = new FruitAuthority({
      fruit: this.fruitSys,
      economy: this.economy,
      sellPad: () => this.world.sellPad,
      sellRadius: () => this.world.sellRadius,
      groundAt: (x, z) => this.world.terrain.height(x, z),
      evaluate: (f) => {
        if (g.has('scoring')) g.get<{ evaluate(f: Fruit): void }>('scoring').evaluate(f);
      },
      multiplierFor: (f) => (g.has('scoring')
        ? g.get<{ multiplierFor(f: Fruit): number }>('scoring').multiplierFor(f) : 1),
      emit: (name, payload) => { (g.bus.emit as (n: string, p: unknown) => void)(name, payload); },
    });

    // A melon that bursts is as gone as one that was sold, and for the same
    // reason it must be remembered as gone: the sweep that drops fruit missing
    // from a snapshot takes a frame, and an intent naming it can arrive first.
    g.bus.on('fruit:destroyed', (p) => {
      if (this.connected && this.isHost) this.authority.destroyed(p.fruitId);
    });

    g.debug?.addProbe('net', () => ({
      connected: this.connected,
      kind: this.transport?.kind ?? 'none',
      id: this.transport?.id ?? '',
      isHost: this.isHost,
      hostId: this.hostId,
      peers: this.peers.length,
      remotes: this.remotes.size,
      pending: this.pending.size,
      lastDeny: this.lastDeny,
      owned: this.isHost ? this.authority.entries().length : this.mirrorOwner.size,
      ...this.stats,
      ...this.authority.stats,
    }));
    g.debug?.addAction('net.connect', (room = 'riperiot', latency = 0) => {
      this.connect(new BroadcastTransport(room));
      if (this.transport) this.transport.latency = latency;
      return this.transport?.id ?? '';
    });
    g.debug?.addAction('net.disconnect', () => { this.disconnect(); return this.connected; });
    g.debug?.addAction('net.peers', () => this.peers);
    g.debug?.addAction('net.remotes', () => [...this.remotes.values()].map((r) => ({
      id: r.id, pos: [+r.pos.x.toFixed(2), +r.pos.y.toFixed(2), +r.pos.z.toFixed(2)],
      state: r.state, carrying: r.carrying,
    })));
    g.debug?.addAction('net.isHost', () => this.isHost);
    g.debug?.addAction('net.setName', (n: string) => { this.playerName = n; return n; });
    // ---- the authority surface, for the multiplayer suite -----------------
    g.debug?.addAction('net.id', () => this.transport?.id ?? '');
    /** Who the host says owns each fruit. On a client, the mirror of that. */
    g.debug?.addAction('net.owners', () => {
      const src = this.isHost ? this.authority.entries() : [...this.mirrorOwner.entries()];
      return src.map(([id, peer]) => ({ id, peer }));
    });
    g.debug?.addAction('net.ownerOf', (id: number) =>
      (this.isHost ? this.authority.ownerOf(id) : this.mirrorOwner.get(id)) ?? null);
    /** The host's view of every player's hands. Empty on a client. */
    g.debug?.addAction('net.holdings', () => this.authority.allHoldings().map((h) => ({
      peer: h.peer, carried: h.carried, basket: [...h.basket],
      pos: [+h.pos.x.toFixed(2), +h.pos.y.toFixed(2), +h.pos.z.toFixed(2)],
    })));
    g.debug?.addAction('net.sold', (id: number) => this.authority.isSold(id));
    g.debug?.addAction('net.pending', () => this.pending.size);
  }

  // ---- connection ---------------------------------------------------------
  connect(transport: Transport): void {
    this.disconnect();
    this.transport = transport;
    this.connected = true;
    this.off.push(transport.onMessage((m) => this.onMessage(m)));
    this.off.push(transport.onPeerChange((p) => this.onPeers(p)));
    this.onPeers(transport.peers());
    this.adoptLocalHoldings();
    transport.send({ t: 'hello', name: this.playerName, suit: this.suit });
    this.g.bus.emit('ui:toast', {
      text: 'Co-op session open', sub: `You are ${this.isHost ? 'hosting' : 'joining'}`, ms: 2600,
    });
  }

  disconnect(): void {
    // Say goodbye explicitly. Waiting for the liveness timeout leaves a ghost
    // standing in the orchard for four seconds, which reads as a bug.
    if (this.connected) this.transport?.send({ t: 'bye' });
    for (const f of this.off) f();
    this.off.length = 0;
    for (const r of this.remotes.values()) this.destroyRemote(r);
    this.remotes.clear();
    this.transport?.close();
    this.transport = null;
    this.connected = false;
    this.isHost = true;
    this.peers = [];
    this.authority.reset();
    this.mirrorOwner.clear();
    this.pending.clear();
    this.pendingSell.clear();
    this.knownRemoteFruit.clear();
  }

  private onPeers(peers: PeerId[]): void {
    this.peers = peers;
    const me = this.transport?.id ?? '';
    // Deterministic host selection: everyone sorts the same list the same way.
    const all = [me, ...peers].sort();
    this.hostId = all[0];
    const wasHost = this.isHost;
    this.isHost = this.hostId === me;
    if (wasHost !== this.isHost) {
      // The ledger belongs to whoever is host. A promoted client starts with a
      // clean one holding only what it can see for itself: its own hands.
      this.authority.reset();
      if (this.isHost) this.adoptLocalHoldings();
      this.g.bus.emit('ui:toast', {
        text: this.isHost ? 'You are now the host' : 'Host changed', ms: 2400,
      });
    }
    // Forget peers that have gone, and give back everything they were holding.
    for (const [id, r] of this.remotes) {
      if (!peers.includes(id)) { this.dropPeer(id, r.name); }
    }
  }

  /**
   * A player is gone. Whatever they were holding comes back to the world where
   * they were standing.
   *
   * Doing nothing here is the "stale carried fruit" failure: the ledger keeps
   * pointing at a peer that does not exist, so the fruit can never be claimed,
   * never falls, never sells, and still counts against the island.
   */
  private dropPeer(id: PeerId, name: string): void {
    const r = this.remotes.get(id);
    if (r) { this.destroyRemote(r); this.remotes.delete(id); }
    this.peers = this.peers.filter((p) => p !== id);
    if (!this.isHost) return;
    const { released } = this.authority.forgetPeer(id);
    this.g.bus.emit('ui:toast', {
      text: `${name} left`,
      sub: released ? `${released} fruit dropped where they stood` : undefined,
      ms: 2400,
    });
  }

  /** Tell the ledger what this peer's own player is already holding. */
  private adoptLocalHoldings(): void {
    if (!this.isHost || !this.transport) return;
    const me = this.transport.id;
    const p = this.g.player.position;
    this.authority.notePosition(me, p.x, p.y, p.z, this.playerName);
    for (const f of this.interaction.basket.items) this.authority.noteLocalStow(me, f.id);
    if (this.interaction.carriedId >= 0) {
      this.authority.noteLocalCarry(me, this.interaction.carriedId);
    }
  }

  // ---- messaging ----------------------------------------------------------
  private onMessage(m: NetMessage): void {
    this.stats.received++;
    switch (m.t) {
      case 'hello':
        this.ensureRemote(m.from!, String(m.name ?? 'Harvester'), Number(m.suit ?? 0));
        // Reply so the newcomer learns about us immediately.
        this.transport?.send({ t: 'helloBack', name: this.playerName, suit: this.suit }, m.from);
        if (this.isHost) {
          this.authority.holdingFor(m.from!, String(m.name ?? 'Harvester'));
          this.sendSnapshot(m.from);
        }
        break;
      case 'helloBack':
        this.ensureRemote(m.from!, String(m.name ?? 'Harvester'), Number(m.suit ?? 0));
        break;
      case 'bye': {
        const leaving = this.remotes.get(m.from!);
        this.dropPeer(m.from!, leaving?.name ?? 'A harvester');
        break;
      }
      case 'player':
        this.applyPlayerPacket(m);
        break;
      case 'intent':
        if (this.isHost) this.applyIntent(m.intent as Intent, m.from!);
        break;
      case 'result':
        this.onResult(m);
        break;
      case 'snapshot':
        if (!this.isHost) this.applySnapshot(m);
        break;
      case 'economy':
        if (!this.isHost) this.syncMoney(Number(m.money ?? 0));
        break;
      case 'event':
        // Cosmetic, host-originated: toasts, celebrations, stunt chips.
        this.g.bus.emit(m.name as never, m.payload as never);
        break;
      default: break;
    }
  }

  private syncMoney(money: number): void {
    if (money === this.economy.money) return;
    this.economy.money = money;
    this.g.bus.emit('money:changed', { money, delta: 0, reason: 'sync' });
  }

  /** True when this peer may mutate authoritative state directly. */
  get authoritative(): boolean { return !this.connected || this.isHost; }

  private get me(): PeerId { return this.transport?.id ?? ''; }

  // ---- outgoing requests --------------------------------------------------
  private send(intent: Omit<Intent, 'playerId' | 'rid'>, track?: Omit<Pending, 'at'>): number {
    if (!this.transport) return -1;
    const rid = this.nextRid++;
    this.transport.send({
      t: 'intent', intent: { ...intent, playerId: this.transport.id, rid },
    }, this.hostId);
    this.stats.intents++;
    if (track) {
      this.pending.set(rid, { ...track, at: this.g.clock.elapsed });
      for (const id of track.ids) this.pendingFruit.add(id);
    }
    return rid;
  }

  /** Stop protecting a request's fruit from the snapshot. */
  private settle(rid: number): Pending | undefined {
    const p = this.pending.get(rid);
    this.pending.delete(rid);
    if (!p) return undefined;
    for (const id of p.ids) {
      // A fruit named by two requests at once stays protected until both land.
      if (![...this.pending.values()].some((q) => q.ids.includes(id))) {
        this.pendingFruit.delete(id);
      }
    }
    return p;
  }

  /** Kept for callers that only want to fire and forget. */
  requestIntent(intent: Omit<Intent, 'playerId' | 'rid'>): boolean {
    if (!this.connected || this.isHost) return false;
    this.send(intent);
    return true;
  }

  /**
   * May the local player take hold of this fruit, and if so, how?
   *
   *   'apply'   — you are the authority; do it and tell the ledger.
   *   'predict' — asked the host; go ahead locally, expect to be corrected.
   *   'refuse'  — someone else already has it, as far as anyone here knows.
   */
  requestPick(f: Fruit): 'apply' | 'predict' | 'refuse' {
    if (!this.connected) return 'apply';
    if (this.isHost) {
      const owner = this.authority.ownerOf(f.id);
      return !owner || owner === this.me ? 'apply' : 'refuse';
    }
    const owner = this.mirrorOwner.get(f.id);
    if (owner && owner !== this.me) return 'refuse';
    if (this.pendingSell.has(f.id)) return 'refuse';
    this.send({ kind: 'pick', fruitId: f.id }, {
      kind: 'pick', fruitId: f.id, ids: [f.id],
      plantId: f.attach?.plantId ?? -1, nodeIndex: f.attach?.nodeIndex ?? -1,
    });
    return 'predict';
  }

  /** The local player now has this fruit in hand. */
  noteCarry(fruitId: number): void {
    if (!this.connected) return;
    if (this.isHost) this.authority.noteLocalCarry(this.me, fruitId);
  }

  /** The local player put this fruit in their basket. */
  noteStow(fruitId: number): void {
    if (!this.connected) return;
    if (this.isHost) { this.authority.noteLocalStow(this.me, fruitId); return; }
    this.send({ kind: 'stow', fruitId },
      { kind: 'stow', fruitId, ids: [fruitId], plantId: -1, nodeIndex: -1 });
  }

  /** The local player let this fruit go, at a position and a velocity. */
  noteRelease(fruitId: number, at: THREE.Vector3, vel: THREE.Vector3): void {
    if (!this.connected) return;
    if (this.isHost) { this.authority.noteLocalRelease(this.me, fruitId); return; }
    this.send({
      kind: 'drop', fruitId,
      at: [+at.x.toFixed(2), +at.y.toFixed(2), +at.z.toFixed(2)],
      vel: [+vel.x.toFixed(2), +vel.y.toFixed(2), +vel.z.toFixed(2)],
    }, { kind: 'drop', fruitId, ids: [fruitId], plantId: -1, nodeIndex: -1 });
  }

  /** The local player sold these. Host-side bookkeeping only. */
  noteSold(ids: number[]): void {
    if (!this.connected || !this.isHost) return;
    this.authority.noteLocalSold(this.me, ids);
  }

  requestSell(ids: number[]): void {
    for (const id of ids) this.pendingSell.add(id);
    this.send({ kind: 'sell', fruitIds: ids },
      { kind: 'sell', fruitId: -1, ids: [...ids], plantId: -1, nodeIndex: -1 });
  }

  requestShove(fruitId: number, dir: THREE.Vector3): void {
    this.send({ kind: 'shove', fruitId, dir: [+dir.x.toFixed(3), +dir.y.toFixed(3), +dir.z.toFixed(3)] });
  }

  // ---- NetGate, for FruitSystem -------------------------------------------
  requestDetach(fruitId: number, cause = 'hand'): void {
    if (!this.connected || this.isHost) return;
    this.send({ kind: 'detach', fruitId, cause });
  }

  requestShake(plantId: number, strength: number): void {
    if (!this.connected || this.isHost) return;
    this.send({ kind: 'shake', plantId, strength });
  }

  // ---- host: applying intents ---------------------------------------------
  private applyIntent(intent: Intent, from: PeerId): void {
    if (!intent || from !== intent.playerId) return;
    this.stats.intents++;
    const rid = intent.rid ?? -1;
    const fid = intent.fruitId ?? -1;
    let deny: Deny | null = null;

    switch (intent.kind) {
      case 'detach':
        deny = this.authority.detach(from, fid, (intent.cause ?? 'hand') === 'hand');
        break;
      case 'pick':
        deny = this.authority.claim(from, fid);
        break;
      case 'stow':
        deny = this.authority.stow(from, fid);
        break;
      case 'drop':
      case 'throw': {
        const at = intent.at
          ? _v.set(intent.at[0], intent.at[1], intent.at[2])
          : _v.copy(this.authority.holdingFor(from).pos);
        _v2.set(intent.vel?.[0] ?? 0, intent.vel?.[1] ?? 0, intent.vel?.[2] ?? 0);
        // A client decides how hard it threw, because the throw curve is one
        // implementation and duplicating it here is how two of them drift
        // apart. It does not decide how hard that is ALLOWED to be.
        if (_v2.length() > MAX_RELEASE_SPEED) _v2.setLength(MAX_RELEASE_SPEED);
        deny = this.authority.release(from, fid, at, _v2);
        break;
      }
      case 'sell': {
        const res = this.authority.sell(from, intent.fruitIds ?? []);
        deny = res.deny;
        if (deny) { this.stats.denied++; this.lastDeny = `sell:${deny}`; }
        this.reply(from, rid, intent.kind, deny, {
          fruitId: fid, ids: res.ids, count: res.count, total: res.total,
        });
        if (!deny) this.sendSnapshot();
        return;
      }
      case 'shake':
        this.authority.shake(from, intent.plantId ?? -1, intent.strength ?? 1.6);
        break;
      case 'shove': {
        const f = this.fruitSys.get(fid);
        const d = intent.dir;
        if (!f || !d) break;
        // Leaning on a melon is a push, and a push needs a person next to it.
        if (!this.authority.canReach(from, fid)) { deny = 'out-of-reach'; break; }
        // Leaning on something oversized breaks its stem first, exactly as it
        // does for the player standing next to the host.
        if (f.state === 'attached') this.authority.detach(from, fid, false);
        _v.set(d[0], d[1], d[2]);
        if (_v.lengthSq() > 1e-6) this.interaction.applyShove(f, _v.normalize());
        break;
      }
      case 'blast':
        if (intent.at) {
          this.g.physics.explode(
            new THREE.Vector3(intent.at[0], intent.at[1], intent.at[2]),
            4.0, 12 * (intent.power ?? 1));
        }
        break;
      default: break;
    }

    if (deny) { this.stats.denied++; this.lastDeny = `${intent.kind}:${deny}`; }
    if (rid >= 0) this.reply(from, rid, intent.kind, deny, { fruitId: fid });
    // Answer with the world as well as with a verdict: a claim that changed
    // hands should be visible to everyone on the next frame, not in 66 ms.
    if (!deny) this.sendSnapshot();
  }

  private reply(to: PeerId, rid: number, kind: IntentKind, deny: Deny | null,
    extra: Record<string, unknown>): void {
    if (rid < 0) return;
    this.transport?.send({
      t: 'result', rid, kind, ok: !deny, reason: deny ?? undefined, ...extra,
    }, to);
  }

  // ---- client: reconciling ------------------------------------------------
  private onResult(m: NetMessage): void {
    const rid = Number(m.rid ?? -1);
    const p = this.settle(rid);
    const kind = m.kind as IntentKind;
    const ok = m.ok === true;
    const why = DENY_TEXT[m.reason as Deny] ?? String(m.reason ?? 'refused');

    if (kind === 'sell') {
      const asked = p?.ids ?? [];
      for (const id of asked) this.pendingSell.delete(id);
      if (ok) {
        this.interaction.settleSale((m.ids ?? []) as number[],
          Number(m.count ?? 0), Number(m.total ?? 0));
      } else {
        this.interaction.saleRefused(why);
      }
      return;
    }
    if (ok || !p) return;

    // Refused. Give the fruit back before the snapshot gets here, so the hand
    // empties on the same frame the refusal lands rather than a beat later.
    if (p.kind === 'pick') {
      this.interaction.forfeit(p.fruitId, why);
      const f = this.fruitSys.get(p.fruitId);
      // Only put it back on the branch if the host still thinks it is there.
      // If someone else took it, the host's copy is in their hands and the
      // snapshot — not us — decides where it is.
      const hostHasIt = this.mirrorOwner.has(p.fruitId) || this.knownRemoteFruit.has(p.fruitId);
      if (f && !hostHasIt && p.plantId >= 0) {
        this.fruitSys.reattach(f, p.plantId, p.nodeIndex);
      }
    } else if (p.kind === 'stow' || p.kind === 'drop') {
      this.interaction.forfeit(p.fruitId, why);
    }
  }

  /** Hand back anything the host never answered. */
  private expirePending(): void {
    if (!this.pending.size) return;
    const now = this.g.clock.elapsed;
    for (const [rid, p] of [...this.pending]) {
      if (now - p.at < PENDING_TIMEOUT) continue;
      this.settle(rid);
      if (p.kind === 'sell') {
        for (const id of p.ids) this.pendingSell.delete(id);
        this.interaction.saleRefused('no answer');
      } else if (p.fruitId >= 0) {
        this.interaction.forfeit(p.fruitId, 'the host never answered');
      }
    }
  }

  // ---- replication --------------------------------------------------------
  private sendPlayerPacket(): void {
    const p = this.g.player;
    const held = this.interaction.carried?.fruit ?? null;
    this.transport?.send({
      t: 'player',
      x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(2),
      yaw: +p.yaw.toFixed(3),
      h: +p.height.toFixed(2),
      s: p.state,
      c: held?.species ?? null,
      // The host needs the id, not just the species: it is what lets a carried
      // fruit's authoritative transform follow the hands that are carrying it.
      cf: held?.id ?? -1,
      cx: held ? +held.position.x.toFixed(2) : 0,
      cy: held ? +held.position.y.toFixed(2) : 0,
      cz: held ? +held.position.z.toFixed(2) : 0,
    });
    this.stats.sent++;
  }

  private applyPlayerPacket(m: NetMessage): void {
    const from = m.from!;
    const r = this.ensureRemote(from, 'Harvester', 0);
    r.targetPos.set(Number(m.x), Number(m.y), Number(m.z));
    r.targetYaw = Number(m.yaw);
    r.height = Number(m.h ?? 1.82);
    r.state = String(m.s ?? 'active');
    r.carrying = (m.c as string | null) ?? null;
    r.lastSeen = performance.now();
    if (!this.isHost) return;

    this.authority.notePosition(from, Number(m.x), Number(m.y), Number(m.z), r.name);
    // A fruit's carrier owns its transform while they carry it — but only
    // because the host said they could, and only for as long as the ledger
    // agrees. An id we do not have booked out to them moves nothing.
    const cf = Number(m.cf ?? -1);
    if (cf < 0 || this.authority.ownerOf(cf) !== from) return;
    const f = this.fruitSys.get(cf);
    if (!f || f.state !== 'carried') return;
    f.position.set(Number(m.cx), Number(m.cy), Number(m.cz));
    f.quaternion.setFromAxisAngle(UP, Number(m.yaw));
  }

  private packFruit(peers: PeerId[]): FruitPacket[] {
    const out: FruitPacket[] = [];
    for (const f of this.fruitSys.fruits.values()) {
      // Attached fruit is deterministic from the world seed on every client, so
      // only fruit that has been disturbed needs to travel.
      if (f.state === 'attached' || f.state === 'gone') continue;
      const owner = this.authority.ownerOf(f.id);
      out.push([
        f.id,
        SPECIES_ORDER.indexOf(f.species),
        VARIANT_ORDER.indexOf(f.variant?.id ?? ''),
        STATE_ORDER.indexOf(f.state),
        +f.position.x.toFixed(2), +f.position.y.toFixed(2), +f.position.z.toFixed(2),
        +f.quaternion.x.toFixed(3), +f.quaternion.y.toFixed(3),
        +f.quaternion.z.toFixed(3), +f.quaternion.w.toFixed(3),
        +f.sizeRoll.toFixed(4), +f.inflate.toFixed(3), +f.damage.toFixed(3),
        owner ? peers.indexOf(owner) : -1,
      ]);
    }
    return out;
  }

  private sendSnapshot(to?: PeerId): void {
    if (!this.transport || !this.isHost) return;
    const peers = [this.me, ...this.peers];
    const msg: NetMessage = {
      t: 'snapshot',
      fruit: this.packFruit(peers),
      peers,
      gone: this.authority.goneIds(),
      money: this.economy.money,
    };
    this.transport.send(msg, to);
    this.stats.sent++;
    this.stats.snapshotBytes = JSON.stringify(msg).length;
  }

  private applySnapshot(m: NetMessage): void {
    const list = (m.fruit ?? []) as FruitPacket[];
    const peers = (m.peers ?? []) as PeerId[];
    const me = this.me;
    const seen = new Set<number>();

    // Tombstones first: a fruit the host has destroyed must not be recreated
    // by anything later in this same message.
    for (const id of (m.gone ?? []) as number[]) {
      const f = this.fruitSys.get(id);
      if (f) { this.interaction.reconcile(f, 'gone', false); this.fruitSys.remove(f); }
      this.mirrorOwner.delete(id);
      this.knownRemoteFruit.delete(id);
    }

    for (const p of list) {
      const [id, sp, va, st, x, y, z, qx, qy, qz, qw, sizeRoll, inflate, damage, ownerIdx] = p;
      seen.add(id);
      // A request about this fruit is still in flight, so this picture of it
      // predates the request and cannot be used to correct it. The host's
      // answer settles it, one way or the other, within the timeout.
      if (this.pendingFruit.has(id) || this.pendingSell.has(id)) continue;
      const owner = ownerIdx >= 0 ? peers[ownerIdx] : undefined;
      if (owner) this.mirrorOwner.set(id, owner); else this.mirrorOwner.delete(id);

      let f = this.fruitSys.get(id);
      if (!f) {
        f = this.fruitSys.spawnReplica(id, SPECIES_ORDER[sp] ?? 'apple',
          VARIANT_ORDER[va] || null, sizeRoll);
      }
      const state = (STATE_ORDER[st] ?? 'free') as Fruit['state'];
      const mine = owner === me;
      this.fruitSys.applyRemoteState(f, state);
      if (f.inflate !== inflate) f.setInflation(inflate);
      if (f.damage !== damage) { f.damage = damage; f.refreshTint(); }
      // Whoever is carrying a fruit draws it; the snapshot does not get to
      // fight the local carry spring for the transform of a fruit in my hands.
      if (!mine || state !== 'carried') {
        f.position.set(x, y, z);
        f.quaternion.set(qx, qy, qz, qw);
      }
      this.interaction.reconcile(f, state, mine);
    }

    for (const id of this.knownRemoteFruit) {
      if (seen.has(id) || this.pendingFruit.has(id) || this.pendingSell.has(id)) continue;
      const f = this.fruitSys.get(id);
      if (!f || f.state === 'attached') continue;
      this.interaction.reconcile(f, 'gone', false);
      this.fruitSys.remove(f);
      this.mirrorOwner.delete(id);
    }
    this.knownRemoteFruit = seen;
    this.syncMoney(Number(m.money ?? this.economy.money));
  }

  // ---- remote avatars -----------------------------------------------------
  private ensureRemote(id: PeerId, name: string, suit: number): RemoteState {
    let r = this.remotes.get(id);
    if (r) return r;
    const preset = SUIT_PRESETS[suit % SUIT_PRESETS.length];
    const rig = makePlayerRig(preset.colors);
    rig.setVisible(true);
    this.g.renderer.scene.add(rig.root);
    r = {
      id, name, suit,
      pos: new THREE.Vector3(), targetPos: new THREE.Vector3(),
      yaw: 0, targetYaw: 0, height: 1.82, state: 'active', carrying: null,
      rig, lastSeen: performance.now(),
    };
    this.remotes.set(id, r);
    if (this.isHost) this.authority.holdingFor(id, name);
    this.g.bus.emit('ui:toast', { text: `${name} joined`, kind: 'good', ms: 2600 });
    return r;
  }

  private destroyRemote(r: RemoteState): void {
    this.g.renderer.scene.remove(r.rig.root);
    r.rig.dispose();
  }

  // ---- loop ---------------------------------------------------------------
  fixedStep(dt: number): void {
    if (!this.connected) return;
    this.expirePending();
    this.playerTimer += dt;
    if (this.playerTimer >= 1 / PLAYER_HZ) {
      this.playerTimer = 0;
      this.sendPlayerPacket();
    }
    if (this.isHost) {
      this.snapshotTimer += dt;
      if (this.snapshotTimer >= 1 / SNAPSHOT_HZ) {
        this.snapshotTimer = 0;
        this.sendSnapshot();
      }
    }
  }

  frameUpdate(dt: number): void {
    // Remote avatars interpolate toward their last reported transform. At
    // 20 Hz this is smooth enough that nobody notices, and it never predicts
    // wrongly, which matters more in a game where players stand on each other.
    for (const r of this.remotes.values()) {
      r.pos.x = damp(r.pos.x, r.targetPos.x, 14, dt);
      r.pos.y = damp(r.pos.y, r.targetPos.y, 14, dt);
      r.pos.z = damp(r.pos.z, r.targetPos.z, 14, dt);
      let dy = r.targetYaw - r.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      r.yaw = damp(r.yaw, r.yaw + dy, 16, dt);
      this.poseRig(r);
    }
  }

  /** Stand the rig up at the reported transform, with a simple walk cycle. */
  private poseRig(r: RemoteState): void {
    const rig = r.rig;
    const torsoY = r.pos.y + r.height * 0.62;
    rig.root.position.set(r.pos.x, 0, r.pos.z);
    rig.root.rotation.y = r.yaw;

    const down = r.state !== 'active' ? 0.75 : 0;
    rig.torso.position.set(0, torsoY - down * 0.6, 0);
    rig.torso.rotation.set(down * 1.4, 0, 0);
    rig.head.position.set(0, torsoY + 0.33 - down * 0.5, down * 0.3);
    rig.head.rotation.set(down * 1.2, 0, 0);

    const t = performance.now() / 1000;
    const moving = r.pos.distanceToSquared(r.targetPos) > 0.004;
    const swing = moving && !down ? Math.sin(t * 8) * 0.6 : 0;
    rig.armL.position.set(-0.34, torsoY + 0.16 - down * 0.5, 0);
    rig.armR.position.set(0.34, torsoY + 0.16 - down * 0.5, 0);
    rig.armL.rotation.set(swing, 0, 0.12);
    rig.armR.rotation.set(-swing, 0, -0.12);
    rig.legL.position.set(-0.14, torsoY - 0.38 - down * 0.4, 0);
    rig.legR.position.set(0.14, torsoY - 0.38 - down * 0.4, 0);
    rig.legL.rotation.set(-swing, 0, 0);
    rig.legR.rotation.set(swing, 0, 0);
  }

  dispose(): void { this.disconnect(); }
}

const UP = new THREE.Vector3(0, 1, 0);
