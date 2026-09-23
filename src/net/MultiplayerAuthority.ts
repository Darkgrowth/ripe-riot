import * as THREE from 'three';
import type { Game, System } from '@/core/Game';
import type { Fruit } from '@/fruit/Fruit';
import type { FruitSystem, NetGate, NodeChange } from '@/fruit/FruitSystem';
import { FRUIT_IDS, VARIANTS } from '@/fruit/FruitDefs';
import type { Economy } from '@/systems/Economy';
import type { InteractionSystem } from '@/interaction/InteractionSystem';
import type { Shop } from '@/systems/Shop';
import type { ToolInventory } from '@/tools/ToolInventory';
import { TETHER_RANGE, type LegendaryHarvest, type LegendaryNet, type LegendaryNetState } from '@/systems/LegendaryHarvest';
import { HAND_OFFSET, type RopeSystem, type RopeNet, type Rope, type RopeEnd, type RopeGone } from '@/systems/RopeSystem';
import type { Sunpatch } from '@/world/Sunpatch';
import { BroadcastTransport, type NetMessage, type PeerId, type Transport } from './Transport';
import { FruitAuthority, DENY_TEXT, clamp01, type Deny } from './FruitAuthority';
import { makePlayerRig, SUIT_PRESETS, type PlayerRig } from '@/player/PlayerRig';
import { clamp, damp } from '@/core/MathUtils';
import type { IslandCrew, IslandDirector, IslandDirectorState } from '@/systems/IslandDirector';
import type { IslandCharacters, CharacterNetState } from '@/world/IslandCharacters';

/** What a client is allowed to ask the host to do. */
export type IntentKind =
  | 'detach' | 'pick' | 'throw' | 'stow' | 'drop' | 'sell'
  | 'shove' | 'shake' | 'blast' | 'spawn'
  | 'buy'
  | 'lcut'
  | 'rope'
  | 'resync';

/**
 * A rope end on the wire: kind, a reference, and three numbers.
 *
 *   0 world      xyz is the point
 *   1 fruit      ref is the fruit id, xyz the offset in its frame
 *   2 legendary  xyz the offset in the melon's frame
 *   3 hand       ref is an index into the message's peer list (a snapshot),
 *                or -1 for "the sender" (an intent: a client may only ever
 *                tie a rope to itself)
 */
export type EndPacket = [kind: number, ref: number, x: number, y: number, z: number];

/** One shared rope as the host lists it: who made it, their id for it, both
 *  ends, and its length. Lifetime is implied by presence in the list. */
export type RopePacket = [
  ownerIdx: number, cid: number,
  ak: number, aref: number, ax: number, ay: number, az: number,
  bk: number, bref: number, bx: number, by: number, bz: number,
  len: number,
];

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
  radius?: number;
  upBias?: number;
  /** What broke the stem: 'hand' is held to hand reach, tools are not. For a
   *  pick, how the fruit was taken: 'net' may take what hands may not. */
  cause?: string;
  /** Shop item, for `buy`. */
  itemId?: string;
  /** Vine anchor index, for `lcut`. */
  vine?: number;
  /** Rope requests: what to do, the client's id for the rope, its ends. */
  op?: 'create' | 'release' | 'reel';
  cid?: number;
  ea?: EndPacket;
  eb?: EndPacket;
  len?: number;
  rate?: number;
}

/** What a client is waiting to hear back about, and how to undo it. */
interface Pending {
  kind: IntentKind;
  fruitId: number;
  /** Preserve the pickup tool through reconciliation for client feedback. */
  cause?: string;
  /** Every fruit this request touches, for sells. */
  ids: number[];
  /** The branch a predicted pick came off, so a refusal can put it back. */
  plantId: number;
  nodeIndex: number;
  itemId?: string;
  /** The client's id for a rope it asked the host to build. */
  cid?: number;
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
  busy: boolean;
  hasNet: boolean;
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
 * snapshot's own peer list, or -1 for a fruit nobody is holding. `flags` bit 0
 * is a gluefruit stuck fast; `stuckHands` is how long it will still refuse to
 * leave the hands holding it, which the holder's own client enforces.
 *
 * The six velocity numbers are the ones a client has no other way to know. A
 * replica has no body, so its motion is invisible to it — and the instant a
 * client is promoted it has to build a real body for every loose fruit in the
 * world. Without these, a melon rolling down the ravine would be reconstructed
 * at rest wherever the last snapshot caught it, which is exactly the thing a
 * player CAN see. Zero for anything that is not loose.
 */
type FruitPacket = [
  id: number, species: number, variant: number, state: number,
  x: number, y: number, z: number,
  qx: number, qy: number, qz: number, qw: number,
  sizeRoll: number, inflate: number, damage: number, owner: number,
  flags: number, stuckHands: number,
  vx: number, vy: number, vz: number, wx: number, wy: number, wz: number,
];

const END_WORLD = 0, END_FRUIT = 1, END_LEGENDARY = 2, END_HAND = 3;
/** How far from where they stand a client may tie a rope to anything. */
const ROPE_REACH = 42;
/** Ropes one peer may have out at once, host-enforced. The gun keeps four. */
const ROPE_LIMIT = 6;

/**
 * Species and variants travel as indices into these. Derived from the
 * registries, not written out by hand: a hand-written list silently mapped
 * every species it did not know to index -1, which decodes as 'apple' — so
 * the first fruit anyone adds for Island 2 would have replicated as an apple
 * on every client and passed every check that only looked at the host.
 */
const SPECIES_ORDER: string[] = FRUIT_IDS;
const VARIANT_ORDER: string[] = ['', ...VARIANTS.map((v) => v.id)];
const STATE_ORDER = ['attached', 'free', 'carried', 'stowed', 'gone'];

const SNAPSHOT_HZ = 15;
const PLAYER_HZ = 20;
/** Fastest a client may claim to have thrown something, in m/s. */
const MAX_RELEASE_SPEED = 45;
/** How far from where they said they stand a client may claim to let go. */
const MAX_RELEASE_OFFSET = 6;
/** Hardest blast a client may ask for: a full-charge cannon is 1.0. */
const MAX_BLAST_POWER = 1.6;
/** A prediction the host never answers is given back after this long. */
const PENDING_TIMEOUT = 4;
/** Minimum gap between a client's requests for the full attached manifest. */
const RESYNC_INTERVAL = 1.5;
/** How many of the host's `gone` ids a client remembers, against a promotion. */
const SEEN_GONE_MAX = 256;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
/** Stands in for a body's velocity on fruit that has no body. */
const ZERO3 = { x: 0, y: 0, z: 0 };

/**
 * Host-authoritative co-op.
 *
 * The split, stated once: the host owns the WORLD — which fruit exists, whose
 * hands it is in, what it is worth and when it is gone, what the shed has
 * sold and where the legendary is in its sequence. Every client owns exactly
 * one thing, its own player, which it simulates locally and reports.
 * Everything else a client does is an INTENT: a request naming the thing it
 * means, validated against the host's ledger (`FruitAuthority`) and either
 * applied or refused with a reason.
 *
 * Clients PREDICT the cheap, reversible half so the game still feels local —
 * a picked fruit is in your hands on the frame the key went down — and
 * reconcile to the host's answer, which arrives either as a targeted refusal
 * or as the next snapshot. Nothing that creates or destroys money is
 * predicted: a sale and a purchase each cost one round trip.
 *
 * What is deliberately not here yet: delta compression and NAT traversal.
 * Host migration carries what the promoted client could see — its mirror of
 * the ledger, the node log it applied — which is everything but the old
 * host's pending intents.
 */
export class MultiplayerAuthority implements System, NetGate, LegendaryNet, RopeNet {
  readonly name = 'net';
  private g!: Game;
  private fruitSys!: FruitSystem;
  private economy!: Economy;
  private interaction!: InteractionSystem;
  private world!: Sunpatch;
  private ropes!: RopeSystem;
  private shop: Shop | null = null;
  private tools: ToolInventory | null = null;
  private legendary: LegendaryHarvest | null = null;
  transport: Transport | null = null;
  peers: PeerId[] = [];
  /** Lowest peer id is the host; deterministic and needs no election round. */
  isHost = true;
  hostId: PeerId = '';
  /** True once another peer has answered our hello: we know what session this is. */
  established = false;
  private connectedAt = 0;
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
  /** Host: the node-log sequence each peer has told us it has applied. */
  private nodeAck = new Map<PeerId, number>();
  /** Client: fruit the host has said is gone, inherited as tombstones if we
   *  are ever promoted. Bounded; the oldest fall off. */
  private seenGone = new Set<number>();
  /** Whether we have applied a snapshot since connecting. The first one is
   *  the moment this peer's world becomes the session's world. */
  private joinedSnapshot = false;
  /** The last transform we saw for a peer that has left, so a promotion that
   *  lands a moment later knows where to put back what they were holding. */
  private departedAt = new Map<PeerId, THREE.Vector3>();
  /** What the last promotion had to reconstruct. Diagnostic, for the probe:
   *  "the fruit froze" and "there was no fruit to freeze" look identical. */
  lastPromotion: { loose: number; rebuilt: number; spilled: number; at: number } | null = null;
  private lastResync = -Infinity;
  private nextRid = 1;
  /** The last refusal this host issued. Diagnostic: a denial that is correct
   *  and a denial that is a bug look identical from the client's side. */
  lastDeny = '';
  stats = { sent: 0, received: 0, intents: 0, denied: 0, snapshotBytes: 0, manifests: 0 };

  init(g: Game): void {
    this.g = g;
    this.fruitSys = g.get<FruitSystem>('fruit');
    this.economy = g.get<Economy>('economy');
    this.interaction = g.get<InteractionSystem>('interaction');
    this.world = g.get<Sunpatch>('world');
    this.ropes = g.get<RopeSystem>('ropes');
    this.shop = g.has('shop') ? g.get<Shop>('shop') : null;
    this.tools = g.has('tools') ? g.get<ToolInventory>('tools') : null;
    this.legendary = g.has('legendary') ? g.get<LegendaryHarvest>('legendary') : null;
    // The gate that makes stems, shakes and blasts host-only, everywhere at once.
    this.fruitSys.net = this;
    if (this.legendary) this.legendary.net = this;
    // And the one that makes every rope the host's.
    this.ropes.net = this;
    this.ropes.onRemoved = (rope, why) => this.onRopeRemoved(rope, why);

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
      priceOf: (id) => this.shop?.priceOf(id) ?? null,
      plantAt: (id) => this.fruitSys.plants.get(id)?.position ?? null,
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
      nodeSeq: this.fruitSys.nodeSeq,
      ropes: this.ropeSummary(),
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
      capacity: h.capacity, bought: [...h.bought], ropegun: h.hasRopeGun,
    })));
    g.debug?.addAction('net.sold', (id: number) => this.authority.isSold(id));
    g.debug?.addAction('net.pending', () => this.pending.size);
    /** What the last host migration had to rebuild, if this peer was promoted. */
    g.debug?.addAction('net.promotion', () => this.lastPromotion);
    /**
     * Every fruit this peer knows, bucketed by where it is. The conservation
     * check the migration tests are built on: an id belongs to exactly one of
     * these, and the same id must never appear in two of them.
     */
    g.debug?.addAction('net.census', () => {
      const owned = new Map<number, PeerId>(this.isHost
        ? this.authority.entries() : [...this.mirrorOwner.entries()]);
      const attached: number[] = [], loose: number[] = [], carried: number[] = [];
      const basket: number[] = [], frozen: number[] = [];
      for (const f of this.fruitSys.fruits.values()) {
        if (f.state === 'attached') { attached.push(f.id); continue; }
        if (f.state === 'gone') continue;
        if (f.state === 'carried') { carried.push(f.id); continue; }
        if (f.state === 'stowed') { basket.push(f.id); continue; }
        loose.push(f.id);
        // A loose fruit with no body on the authority is the exact failure
        // this whole pass exists to make impossible: a picture of a fruit
        // that nobody is simulating.
        if (this.isHost && !f.body) frozen.push(f.id);
      }
      const sort = (a: number[]) => a.sort((x, y) => x - y);
      return {
        isHost: this.isHost,
        attached: sort(attached), loose: sort(loose),
        carried: sort(carried), basket: sort(basket), frozen: sort(frozen),
        owners: [...owned.entries()].map(([id, peer]) => ({ id, peer })),
        gone: this.isHost ? [...this.authority.goneIds()] : [...this.seenGone],
      };
    });
    /** Every shared rope this peer knows, by wire identity, for the suite. */
    g.debug?.addAction('net.ropes', () => this.ropeSummary());
  }

  /** Shared ropes as (owner, cid) with what they tie, for the probe. */
  private ropeSummary(): Array<{ owner: string; cid: number; mirror: boolean; acked: boolean;
    a: string; b: string; len: number; mine: boolean }> {
    const out: Array<{ owner: string; cid: number; mirror: boolean; acked: boolean;
      a: string; b: string; len: number; mine: boolean }> = [];
    for (const r of this.ropes.ropes.values()) {
      if (!r.net) continue;
      const tag = (e: RopeEnd) => (e.kind === 'fruit' ? `fruit:${e.ownerId}`
        : e.kind === 'peer' ? `peer:${e.peer}` : e.kind);
      out.push({
        owner: r.net.owner, cid: r.net.cid, mirror: r.net.mirror, acked: r.net.acked,
        a: tag(r.a), b: tag(r.b), len: +r.length.toFixed(2), mine: r.net.owner === this.me,
      });
    }
    return out;
  }

  // ---- connection ---------------------------------------------------------
  connect(transport: Transport): void {
    this.disconnect();
    this.transport = transport;
    this.connected = true;
    this.off.push(transport.onMessage((m) => this.onMessage(m)));
    this.off.push(transport.onPeerChange((p) => this.onPeers(p)));
    this.established = false;
    this.connectedAt = performance.now();
    this.hostId = transport.id;
    this.onPeers(transport.peers());
    this.adoptLocalHoldings();
    // A host of nobody, so far: tag our ropes as ours. If a hello turns us
    // into a client, `rehome` after `learnHost` finds nothing left to do and
    // the host learns of these ropes when it asks for... nothing: a client
    // joining an existing session should not bring ropes into it, which is
    // why `leaveSession` removed them on the way out of the last one.
    this.ropes.rehome();
    transport.send({ t: 'hello', name: this.playerName, suit: this.suit, host: this.hostId, est: false, age: 0 });
    this.g.bus.emit('ui:toast', {
      text: 'Co-op session open', sub: `You are ${this.isHost ? 'hosting' : 'joining'}`, ms: 2600,
    });
  }

  disconnect(): void {
    // Say goodbye explicitly. Waiting for the liveness timeout leaves a ghost
    // standing in the orchard for four seconds, which reads as a bug.
    if (this.connected) this.transport?.send({ t: 'bye' });
    // Before `isHost` is reset: a client leaves its ropes behind, a host
    // keeps its own and drops the tags.
    if (this.connected) this.ropes.leaveSession(this.isHost);
    for (const f of this.off) f();
    this.off.length = 0;
    for (const r of this.remotes.values()) this.destroyRemote(r);
    this.remotes.clear();
    this.transport?.close();
    this.transport = null;
    this.connected = false;
    this.isHost = true;
    this.established = false;
    this.peers = [];
    this.authority.reset();
    this.mirrorOwner.clear();
    for (const p of this.pending.values()) {
      if (p.kind === 'pick' && p.cause === 'net') {
        this.g.bus.emit('net:pickResult', { fruitId: p.fruitId, ok: false });
      }
    }
    this.pending.clear();
    this.pendingFruit.clear();
    this.pendingSell.clear();
    this.knownRemoteFruit.clear();
    this.nodeAck.clear();
    this.seenGone.clear();
    this.departedAt.clear();
    this.joinedSnapshot = false;
    this.lastPromotion = null;
    if (this.shop) this.shop.pendingBuy = null;
  }

  private onPeers(peers: PeerId[]): void {
    this.peers = peers;
    // A newcomer does not elect. Until somebody has answered its hello it
    // does not know whether it is joining a session or starting one, and the
    // one thing it must never do is decide it is in charge of a world it has
    // not been told about yet.
    if (!this.established && peers.length) return;
    this.electHost();
    // Forget peers that have gone, and give back everything they were holding.
    for (const [id, r] of this.remotes) {
      if (!peers.includes(id)) { this.dropPeer(id, r.name); }
    }
  }

  /**
   * Who is hosting, given who is here.
   *
   * The incumbent keeps the session. Lowest-id election only decides who
   * starts a session, and who takes over when the host leaves: "lowest id
   * wins" on every change handed the whole world to whichever fresh page
   * happened to roll a small id, which is host migration TO an empty world.
   *
   * Deterministic from the peer list alone, so every remaining peer reaches
   * the same answer without a round of messages about it.
   */
  private electHost(): void {
    const all = [this.me, ...this.peers];
    if (!all.includes(this.hostId)) this.hostId = [...all].sort()[0];
    this.applyHost();
  }

  /**
   * Somebody told us who is hosting. `theirAge` is how long they have been
   * connected, in ms; whoever was here first is the session, and a page that
   * just opened joins it rather than founding a rival with a smaller id.
   */
  private learnHost(claimed: PeerId, theirEstablished: boolean, theirAge: number): void {
    if (this.established) return;
    const me = this.me;
    const myAge = performance.now() - this.connectedAt;
    if (theirEstablished || theirAge > myAge + 500) {
      // Joining a session that exists: whoever they say is host, is.
      this.hostId = claimed;
    } else if (myAge > theirAge + 500) {
      // They are joining us. Our claim stands, whatever it is.
    } else {
      // Two fresh pages found each other at once: the tie goes to the id.
      this.hostId = [me, claimed].sort()[0];
    }
    this.established = true;
    this.applyHost();
    // Now that we know who we are in this session, any rope we brought with
    // us (a solo game's, a former host's) is tagged and, if we are a client,
    // handed to the host.
    this.ropes.rehome();
  }

  private get age(): number { return performance.now() - this.connectedAt; }

  private applyHost(): void {
    const wasHost = this.isHost;
    this.isHost = this.hostId === this.me;
    if (wasHost === this.isHost) return;
    // The ledger belongs to whoever is host.
    this.authority.reset();
    if (this.isHost) { this.promote(); return; }
    this.g.bus.emit('ui:toast', { text: 'Host changed', ms: 2400 });
  }

  /**
   * Become the host of a session that already existed.
   *
   * A promotion has to leave the world INDISTINGUISHABLE from the one the old
   * host was running, because everybody else is still standing in it. Four
   * things have to agree by the time this returns, and not a frame later: the
   * ledger (who owns what), the fruit system (what exists, in which state),
   * the physics world (what is actually simulating) and the ropes (what is
   * tied to what). A player should not be able to tell which machine took
   * over by watching the fruit.
   *
   * The order is the argument:
   *
   *  1. tombstones, so nothing sold or burst can be resurrected by anything
   *     below;
   *  2. the mirror of the old ledger, so the fruit in other players' hands
   *     stays in their hands;
   *  3. our own hands, basket and purchases, which the old ledger booked to us
   *     and this one has just forgotten;
   *  4. anything still booked to a peer who is NOT here, spilled back into the
   *     world through the ordinary recovery path;
   *  5. a real physics body for every loose fruit — the whole point: until now
   *     they were pictures of fruit somebody else was simulating;
   *  6. the ropes, which resolve by fruit id and therefore find exactly the
   *     bodies step 5 just built;
   *  7. the legendary, whose melon a client holds fixed and a host must not;
   *  8. our own requests to a host that has gone, which nobody will answer.
   */
  private promote(): void {
    this.authority.adoptTombstones(this.seenGone);
    // Everybody still here, at the last place we saw them. Every zone check
    // the ledger makes is measured from these, and a peer the new host thinks
    // is standing at the origin has its next sale refused as "not at the
    // drop-off" for a reason nobody in the room could work out.
    for (const r of this.remotes.values()) {
      this.authority.notePosition(r.id, r.targetPos.x, r.targetPos.y, r.targetPos.z, r.name);
    }
    this.adoptMirror();
    this.adoptLocalHoldings();
    const spilled = this.releaseOrphans();
    const { rebuilt, loose } = this.fruitSys.adoptAuthority();
    this.ropes.adoptMirrors();
    this.legendary?.adoptAuthority();
    this.settleOnPromotion();
    this.lastPromotion = { loose, rebuilt, spilled, at: this.g.clock.elapsed };
    const bits: string[] = [];
    if (rebuilt) bits.push(`${rebuilt} loose fruit picked up mid-flight`);
    if (spilled) bits.push(`${spilled} dropped where they were standing`);
    this.g.bus.emit('ui:toast', {
      text: 'You are now the host', sub: bits.length ? bits.join(' · ') : undefined, ms: 2600,
    });
  }

  /**
   * Fruit the ledger books to somebody who is not in the session.
   *
   * The case this exists for is the ordinary one: the host says goodbye, its
   * `bye` reaches us before the transport's liveness timer has noticed it is
   * gone, and by the time we are the host its avatar has already been
   * forgotten — so the loop in `onPeers` that normally spills a departed
   * player's hands finds nothing left to spill. Stating the rule once here
   * makes both orderings safe: the ledger may only name peers who are here,
   * and everything else comes back to the world down the same path a
   * disconnect uses.
   */
  private releaseOrphans(): number {
    const live = new Set<PeerId>([this.me, ...this.peers]);
    const stale = new Set<PeerId>();
    for (const [, peer] of this.authority.entries()) if (!live.has(peer)) stale.add(peer);
    for (const h of this.authority.allHoldings()) if (!live.has(h.peer)) stale.add(h.peer);
    let n = 0;
    for (const peer of stale) n += this.authority.forgetPeer(peer).released;
    return n;
  }

  /**
   * A promoted host cannot be waiting for an answer: the peer that owed it one
   * has gone.
   *
   * Settled here rather than left to `expirePending`, which would forfeit — a
   * few seconds later, and loudly — a pick this peer has just legitimised as
   * the authority, taking the fruit back out of its own hands for no reason a
   * player could follow. A sale is the exception worth telling them about: it
   * genuinely did not happen, and the fruit is still in the basket.
   */
  private settleOnPromotion(): void {
    for (const [rid, p] of [...this.pending]) {
      this.settle(rid);
      if (p.kind === 'pick' && p.cause === 'net') {
        this.g.bus.emit('net:pickResult', { fruitId: p.fruitId, ok: true });
      }
      if (p.kind === 'sell') {
        for (const id of p.ids) this.pendingSell.delete(id);
        this.interaction.saleRefused('the host left mid-sale');
      } else if (p.kind === 'buy') {
        this.shop?.refused(p.itemId ?? '', 'the host left');
      }
    }
    this.pending.clear();
    this.pendingFruit.clear();
    this.pendingSell.clear();
  }

  /** Ids the host has told us are gone. A promotion inherits these as
   *  tombstones rather than starting a world where sold fruit can come back. */
  private noteSeenGone(id: number): void {
    if (this.seenGone.has(id)) return;
    this.seenGone.add(id);
    // Insertion-ordered, so deleting the first key evicts the oldest.
    if (this.seenGone.size > SEEN_GONE_MAX) {
      const oldest = this.seenGone.values().next();
      if (!oldest.done) this.seenGone.delete(oldest.value);
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
    if (r) {
      // Where they were standing, kept past the avatar. If we are promoted a
      // moment from now, this is where the fruit in their hands comes back to
      // the world — rather than the world origin, which is the sea.
      this.departedAt.set(id, r.targetPos.clone());
      this.destroyRemote(r);
      this.remotes.delete(id);
    }
    this.peers = this.peers.filter((p) => p !== id);
    this.nodeAck.delete(id);
    // The HOST said goodbye. Elect its replacement now rather than waiting for
    // the transport's liveness timer to notice: three and a half seconds with
    // nobody simulating is three and a half seconds of every loose fruit on
    // the island standing still, which is the one thing a player can see.
    if (id === this.hostId) this.electHost();
    if (!this.isHost) return;
    const { released } = this.authority.forgetPeer(id);
    // Their ropes go too: a rope tied to a player who is not there any more
    // would hold a melon to a point in the air forever.
    const ropes = this.ropes.removeOwnedBy(id);
    const bits: string[] = [];
    if (released) bits.push(`${released} fruit dropped where they stood`);
    if (ropes) bits.push(`${ropes} rope${ropes > 1 ? 's' : ''} let go`);
    this.g.bus.emit('ui:toast', {
      text: `${name} left`, sub: bits.length ? bits.join(' · ') : undefined, ms: 2400,
    });
  }

  /** Everything the shed has sold this player, as one wire-sized string. */
  private purchasedList(): string {
    const out: string[] = [];
    for (const id of this.shop?.purchased ?? []) out.push(id);
    for (const id of this.tools?.owned ?? []) {
      if (!out.includes(id) && this.shop?.priceOf(id)) out.push(id);
    }
    return out.join(',');
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
    // What this player has already bought is what the ledger enforces.
    for (const id of this.shop?.purchased ?? []) this.authority.noteBought(me, id);
    for (const id of this.tools?.owned ?? []) {
      if (this.shop?.priceOf(id)) this.authority.noteBought(me, id);
    }
  }

  /**
   * A promoted client's first ledger: the last snapshot's picture of who held
   * what, and where they stood. Without this every other player's hands were
   * simply forgotten — their fruit stayed 'carried' with no owner on the new
   * host, untargetable and unsellable, and their next stow was refused as
   * 'not yours'.
   */
  private adoptMirror(): void {
    for (const [id, peer] of this.mirrorOwner) {
      const f = this.fruitSys.get(id);
      if (!f || (f.state !== 'carried' && f.state !== 'stowed')) continue;
      const r = this.remotes.get(peer);
      // Where to consider this player to be standing: their avatar if they are
      // still here, the last place we saw them if they have just left, and the
      // fruit's own position as a last resort — which for something in their
      // hands IS where those hands were, and is a far better place to put it
      // back than the origin the ledger would otherwise use.
      const at = r ? r.targetPos : this.departedAt.get(peer) ?? f.position;
      this.authority.notePosition(peer, at.x, at.y, at.z, r?.name);
      if (f.state === 'carried') this.authority.noteLocalCarry(peer, id);
      else this.authority.noteLocalStow(peer, id);
    }
    this.mirrorOwner.clear();
  }

  // ---- messaging ----------------------------------------------------------
  private onMessage(m: NetMessage): void {
    this.stats.received++;
    switch (m.t) {
      case 'hello': {
        // Two fresh pages saying hello to each other in the same instant: the
        // hello itself carries their claim, so neither has to wait for a
        // helloBack that names the other.
        this.ensureRemote(m.from!, String(m.name ?? 'Harvester'), Number(m.suit ?? 0));
        this.learnHost(String(m.host ?? m.from), m.est === true, Number(m.age ?? 0));
        // Reply so the newcomer learns about us, and who is hosting.
        this.transport?.send({
          t: 'helloBack', name: this.playerName, suit: this.suit,
          host: this.hostId, est: true, age: this.age,
        }, m.from);
        if (this.isHost) {
          this.authority.holdingFor(m.from!, String(m.name ?? 'Harvester'));
          // The attached population first, so the snapshot that follows can
          // place or drop whatever the manifest freed.
          this.sendManifest(m.from);
          this.nodeAck.set(m.from!, this.fruitSys.nodeSeq);
          this.sendSnapshot(m.from);
        }
        break;
      }
      case 'helloBack':
        this.ensureRemote(m.from!, String(m.name ?? 'Harvester'), Number(m.suit ?? 0));
        this.learnHost(String(m.host ?? m.from), m.est === true, Number(m.age ?? 0));
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
      // Only the host's word is the world. A page that has just opened is
      // briefly host of nobody, and nothing it says in that window counts.
      case 'result':
        if (m.from === this.hostId) this.onResult(m);
        break;
      case 'snapshot':
        if (!this.isHost && m.from === this.hostId) this.applySnapshot(m);
        break;
      case 'manifest':
        if (!this.isHost && m.from === this.hostId) {
          this.fruitSys.applyNodeManifest(Number(m.nseq ?? 0), (m.changes ?? []) as NodeChange[]);
        }
        break;
      case 'economy':
        if (!this.isHost && m.from === this.hostId) this.syncEconomy(Number(m.money ?? 0));
        break;
      case 'ropegone':
        if (!this.isHost && m.from === this.hostId) {
          this.onRopeGone(String(m.owner ?? ''), Number(m.cid ?? -1), String(m.why ?? 'gone') as RopeGone);
        }
        break;
      case 'event':
        // Generic wire events are presentation only. Never let a peer inject
        // authoritative sale/pickup notifications into the host's ledger.
        if (!this.isHost && m.from === this.hostId && m.name === 'ui:toast') {
          this.g.bus.emit('ui:toast', m.payload as never);
        }
        break;
      default: break;
    }
  }

  /** Money, and the discovery tier that gates the shed, are the host's. */
  private syncEconomy(money: number, tier?: number, points?: number): void {
    if (typeof points === 'number') this.economy.discoveryPoints = points;
    if (typeof tier === 'number' && tier !== this.economy.discoveryTier) {
      const rose = tier > this.economy.discoveryTier;
      this.economy.discoveryTier = tier;
      if (rose) {
        this.g.bus.emit('ui:toast', {
          text: `DISCOVERY TIER ${tier}`, sub: 'New equipment available at the shed', kind: 'gold', ms: 4200,
        });
      }
    }
    if (money === this.economy.money) return;
    this.economy.money = money;
    this.g.bus.emit('money:changed', { money, delta: 0, reason: 'sync' });
  }

  /** True when this peer may mutate authoritative state directly. */
  get authoritative(): boolean { return !this.connected || this.isHost; }

  /** Event/wildlife eligibility is shared, including a client using the shop. */
  activityCrew(): IslandCrew[] {
    const mine: IslandCrew = { position: this.g.player.position,
      busy: this.g.player.state !== 'active' || !!this.shop?.open
        || this.g.get<{ open: boolean }>('book').open,
      hasNet: !!this.tools?.owned.has('net') };
    return [mine, ...[...this.remotes.values()].map(r => ({ position: r.targetPos,
      busy: r.busy || r.state !== 'active', hasNet: r.hasNet }))];
  }

  get me(): PeerId { return this.transport?.id ?? ''; }

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
  requestPick(f: Fruit, cause = 'hand'): 'apply' | 'predict' | 'refuse' {
    if (!this.connected) return 'apply';
    if (this.isHost) {
      const owner = this.authority.ownerOf(f.id);
      return !owner || owner === this.me ? 'apply' : 'refuse';
    }
    const owner = this.mirrorOwner.get(f.id);
    if (owner && owner !== this.me) return 'refuse';
    if (this.pendingSell.has(f.id)) return 'refuse';
    this.send({ kind: 'pick', fruitId: f.id, cause }, {
      kind: 'pick', fruitId: f.id, ids: [f.id], cause,
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

  /** Ask the host to sell us something. Nothing is spent until it answers. */
  requestBuy(itemId: string): void {
    this.send({ kind: 'buy', itemId },
      { kind: 'buy', fruitId: -1, ids: [], plantId: -1, nodeIndex: -1, itemId });
  }

  /** The local player (host or solo) bought something; the ledger enforces it. */
  noteBought(itemId: string): void {
    if (!this.connected || !this.isHost) return;
    this.authority.noteBought(this.me, itemId);
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

  requestBlast(center: THREE.Vector3, radius: number, strength: number, upBias: number): void {
    if (!this.connected || this.isHost) return;
    this.send({
      kind: 'blast', at: [+center.x.toFixed(2), +center.y.toFixed(2), +center.z.toFixed(2)],
      radius: +radius.toFixed(2), power: +strength.toFixed(2), upBias: +upBias.toFixed(2),
    });
  }

  // ---- LegendaryNet, for the King Melon -----------------------------------
  anyoneHasRopeGun(): boolean { return this.isHost && this.authority.anyoneHasRopeGun(); }

  requestLegendary(intent: { kind: 'lcut'; vine: number }): void {
    if (!this.connected || this.isHost) return;
    // A cut can be refused for a reason the player must hear.
    this.send(intent, { kind: intent.kind, fruitId: -1, ids: [], plantId: -1, nodeIndex: -1 });
  }

  // ---- RopeNet, for the rope system ---------------------------------------
  peerHands(peer: PeerId, out: THREE.Vector3): boolean {
    const r = this.remotes.get(peer);
    if (!r) return false;
    out.copy(r.targetPos).add(HAND_OFFSET);
    return true;
  }

  requestRopeCreate(rope: Rope): void {
    if (!this.connected || this.isHost || !rope.net) return;
    this.send({
      kind: 'rope', op: 'create', cid: rope.net.cid,
      ea: this.encodeEnd(rope.a, null), eb: this.encodeEnd(rope.b, null),
      len: +rope.length.toFixed(2),
    }, { kind: 'rope', fruitId: -1, ids: [], plantId: -1, nodeIndex: -1, cid: rope.net.cid });
  }

  requestRopeRelease(cid: number): void {
    if (!this.connected || this.isHost) return;
    this.send({ kind: 'rope', op: 'release', cid });
  }

  requestRopeReel(cid: number, rate: number): void {
    if (!this.connected || this.isHost) return;
    this.send({ kind: 'rope', op: 'reel', cid, rate: +rate.toFixed(2) });
  }

  /**
   * A rope end for the wire. With a peer list (a snapshot) a hand is an index
   * into it; without one (an intent) a hand is -1, "me", because a client is
   * never allowed to tie anyone but itself.
   */
  private encodeEnd(e: RopeEnd, peers: PeerId[] | null): EndPacket {
    const l = e.local;
    const xyz: [number, number, number] = [+l.x.toFixed(2), +l.y.toFixed(2), +l.z.toFixed(2)];
    switch (e.kind) {
      case 'fruit': return [END_FRUIT, e.ownerId, ...xyz];
      case 'legendary': return [END_LEGENDARY, 0, ...xyz];
      case 'player': return [END_HAND, peers ? peers.indexOf(this.me) : -1, ...xyz];
      case 'peer': return [END_HAND, peers ? peers.indexOf(e.peer ?? '') : -1, ...xyz];
      default: return [END_WORLD, 0, ...xyz];
    }
  }

  /** The inverse. `sender` is who a -1 hand means; null for a snapshot. */
  private decodeEnd(p: EndPacket | undefined, peers: PeerId[], sender: PeerId | null): RopeEnd | null {
    if (!p || p.length < 5) return null;
    const [kind, ref, x, y, z] = p.map(Number);
    if (![x, y, z].every(Number.isFinite)) return null;
    const local = new THREE.Vector3(x, y, z);
    switch (kind) {
      case END_WORLD: return { kind: 'world', local, ownerId: -1 };
      case END_FRUIT: return { kind: 'fruit', local, ownerId: ref };
      case END_LEGENDARY:
        return this.legendary ? { kind: 'legendary', local, ownerId: this.legendary.id } : null;
      case END_HAND: {
        const peer = sender && ref < 0 ? sender : peers[ref];
        if (!peer) return null;
        if (peer === this.me) return { kind: 'player', local, ownerId: this.g.player.id };
        return { kind: 'peer', local, ownerId: -1, peer };
      }
      default: return null;
    }
  }

  /** Host: may this peer tie a rope here? */
  private checkRopeEnd(e: RopeEnd, from: PeerId): Deny | null {
    switch (e.kind) {
      case 'world':
        return this.authority.nearPeer(from, e.local.x, e.local.y, e.local.z, ROPE_REACH) ? null : 'out-of-reach';
      case 'fruit': {
        const f = this.fruitSys.get(e.ownerId);
        if (!f || this.authority.isSold(e.ownerId)) return 'no-fruit';
        if (f.state !== 'attached' && f.state !== 'free') return 'wrong-state';
        return this.authority.canReach(from, e.ownerId, ROPE_REACH) ? null : 'out-of-reach';
      }
      case 'legendary': {
        if (!this.legendary?.body) return 'no-fruit';
        const p = this.legendary.position;
        return this.authority.nearPeer(from, p.x, p.y, p.z, TETHER_RANGE) ? null : 'out-of-reach';
      }
      case 'peer':
        return e.peer === from ? null : 'not-yours';
      default:
        return 'not-yours';
    }
  }

  /** Host: a client's rope request. */
  private applyRope(intent: Intent, from: PeerId): Deny | null {
    const cid = Number(intent.cid ?? -1);
    if (!Number.isFinite(cid) || cid < 0) return 'no-fruit';
    const existing = this.ropes.findByKey(from, cid);
    switch (intent.op) {
      case 'create': {
        if (existing) return null;                      // a resend is the same rope
        const a = this.decodeEnd(intent.ea, [], from);
        const b = this.decodeEnd(intent.eb, [], from);
        if (!a || !b) return 'no-fruit';
        const bad = this.checkRopeEnd(a, from) ?? this.checkRopeEnd(b, from);
        if (bad) return bad;
        let owned = 0;
        for (const r of this.ropes.ropes.values()) if (r.net?.owner === from) owned++;
        if (owned >= ROPE_LIMIT) return 'rope-limit';
        const held = a.kind === 'peer' || b.kind === 'peer';
        this.ropes.create(a, b, clamp(Number(intent.len ?? 4), 0.8, 90), {
          maxTension: held ? 4200 : 5200,
          net: { owner: from, cid, mirror: false, acked: true, bornAt: this.g.clock.elapsed },
        });
        return null;
      }
      case 'release':
        if (existing) this.ropes.remove(existing.id, 'released');
        return null;
      case 'reel':
        if (existing) this.ropes.setReel(existing.id, clamp(Number(intent.rate ?? 0), -2.6, 3.2));
        return null;
      default:
        return 'no-fruit';
    }
  }

  /** Host: a shared rope left the world; everybody else lets go of their copy. */
  private onRopeRemoved(rope: Rope, why: RopeGone): void {
    if (!this.connected || !this.isHost || !rope.net) return;
    this.transport?.send({ t: 'ropegone', owner: rope.net.owner, cid: rope.net.cid, why });
  }

  /** Client: the host says a rope is gone, and why. */
  private onRopeGone(owner: PeerId, cid: number, why: RopeGone): void {
    const r = this.ropes.findByKey(owner, cid);
    if (!r) return;
    this.ropes.remove(r.id, why, true);
    if (why !== 'snapped') return;
    this.g.bus.emit('rope:snapped', { ropeId: r.id });
    if (owner === this.me) {
      this.g.bus.emit('ui:toast', { text: 'Your rope parted', kind: 'bad', ms: 1800 });
    }
  }

  /** Every shared rope the host holds, for the snapshot. */
  private packRopes(peers: PeerId[]): RopePacket[] {
    const out: RopePacket[] = [];
    for (const r of this.ropes.ropes.values()) {
      if (!r.shared || !r.net) continue;
      const ownerIdx = peers.indexOf(r.net.owner);
      if (ownerIdx < 0) continue;
      out.push([ownerIdx, r.net.cid, ...this.encodeEnd(r.a, peers), ...this.encodeEnd(r.b, peers),
        +r.length.toFixed(2)]);
    }
    return out;
  }

  /**
   * Client: make the local ropes agree with the host's list.
   *
   * Our own ropes are matched by cid and only ever have their length
   * corrected — the local copy is the one our tools hold. Everyone else's
   * are mirrored. Anything the host no longer lists is gone, except one of
   * ours that the host has not acknowledged yet: that one is still in the
   * post, and the snapshot that crossed it does not get to kill it.
   */
  private applyRopes(list: RopePacket[], peers: PeerId[]): void {
    const me = this.me;
    const seen = new Set<string>();
    for (const pk of list) {
      const owner = peers[Number(pk[0])];
      const cid = Number(pk[1]);
      if (!owner || !Number.isFinite(cid)) continue;
      seen.add(`${owner}:${cid}`);
      const len = Number(pk[12]);
      if (owner === me) {
        const mine = this.ropes.ropes.get(cid);
        if (mine?.net && !mine.net.mirror) {
          mine.net.acked = true;
          this.ropes.followLength(cid, len);
        }
        continue;
      }
      const existing = this.ropes.findByKey(owner, cid);
      if (existing) { this.ropes.followLength(existing.id, len); continue; }
      const a = this.decodeEnd(pk.slice(2, 7) as EndPacket, peers, null);
      const b = this.decodeEnd(pk.slice(7, 12) as EndPacket, peers, null);
      if (a && b) this.ropes.createMirror(owner, cid, a, b, len);
    }
    const now = this.g.clock.elapsed;
    for (const r of [...this.ropes.ropes.values()]) {
      if (!r.net || seen.has(`${r.net.owner}:${r.net.cid}`)) continue;
      if (r.net.mirror) { this.ropes.remove(r.id, 'gone', true); continue; }
      if (r.net.owner === me && r.net.acked && now - r.net.bornAt > 1.0) {
        this.ropes.remove(r.id, 'gone', true);
      }
    }
  }

  // ---- host: applying intents ---------------------------------------------
  private applyIntent(intent: Intent, from: PeerId): void {
    if (!intent || from !== intent.playerId) return;
    this.stats.intents++;
    const rid = intent.rid ?? -1;
    const fid = intent.fruitId ?? -1;
    const near = (x: number, y: number, z: number, range: number) => this.authority.nearPeer(from, x, y, z, range);
    let deny: Deny | null = null;

    switch (intent.kind) {
      case 'detach':
        deny = this.authority.detach(from, fid, (intent.cause ?? 'hand') === 'hand');
        break;
      case 'pick':
        deny = this.authority.claim(from, fid, intent.cause ?? 'hand');
        break;
      case 'stow':
        deny = this.authority.stow(from, fid);
        break;
      case 'drop':
      case 'throw': {
        const h = this.authority.holdingFor(from);
        _v.copy(h.pos);
        // Where they say they let go has to be within arm's reach of where
        // they say they stand; otherwise a drop is a teleport onto the pad.
        if (intent.at) {
          _v2.set(intent.at[0], intent.at[1], intent.at[2]);
          if (_v2.distanceTo(h.pos) <= MAX_RELEASE_OFFSET) _v.copy(_v2); else _v.y += 1.2;
        } else {
          _v.y += 1.2;
        }
        _v2.set(intent.vel?.[0] ?? 0, intent.vel?.[1] ?? 0, intent.vel?.[2] ?? 0);
        // A client decides how hard it threw, because the throw curve is one
        // implementation and duplicating it here is how two of them drift
        // apart. It does not decide how hard that is ALLOWED to be.
        if (!Number.isFinite(_v2.lengthSq())) _v2.set(0, 0, 0);
        if (_v2.length() > MAX_RELEASE_SPEED) _v2.setLength(MAX_RELEASE_SPEED);
        deny = this.authority.release(from, fid, _v, _v2);
        break;
      }
      case 'sell': {
        const res = this.authority.sell(from, intent.fruitIds ?? []);
        deny = res.deny;
        if (deny) { this.stats.denied++; this.lastDeny = `sell:${deny}`; }
        this.reply(from, rid, intent.kind, deny, {
          fruitId: fid, ids: res.ids, count: res.count, total: res.total, values: res.values,
        });
        if (!deny) this.sendSnapshot();
        return;
      }
      case 'buy': {
        const res = this.authority.buy(from, String(intent.itemId ?? ''));
        deny = res.deny;
        if (deny) { this.stats.denied++; this.lastDeny = `buy:${deny}`; }
        this.reply(from, rid, intent.kind, deny, {
          itemId: intent.itemId, cost: res.cost, money: this.economy.money,
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
      case 'blast': {
        if (!intent.at) break;
        const [x, y, z] = intent.at;
        // A cannon reaches 13 m; anything further is not a shot from here.
        if (!near(x, y, z, 20)) { deny = 'out-of-reach'; break; }
        this.g.physics.explode(new THREE.Vector3(x, y, z),
          clamp01(intent.radius ?? 4, 8), clamp01(intent.power ?? 1, 22 * MAX_BLAST_POWER),
          clamp01(intent.upBias ?? 0.3, 1));
        // Residents react to accepted remote blasts as well as local tools.
        this.g.bus.emit('tool:blast', { toolId: 'remote', point: new THREE.Vector3(x, y, z),
          radius: clamp01(intent.radius ?? 4, 8), power: clamp01((intent.power ?? 1) / 22, 1) });
        break;
      }
      // `null` is success here, so no `??` on these: it reads null as "no
      // answer" and turned every cut and tether the host had just made into
      // a refusal on the wire.
      case 'lcut':
        deny = this.legendary ? this.legendary.remoteCut(intent.vine ?? -1, near) : 'no-fruit';
        break;
      case 'rope':
        deny = this.applyRope(intent, from);
        if (deny) { this.stats.denied++; this.lastDeny = `rope:${intent.op}:${deny}`; }
        if (rid >= 0) this.reply(from, rid, intent.kind, deny, { cid: intent.cid, op: intent.op });
        if (!deny) this.sendSnapshot();
        return;
      case 'resync':
        this.sendManifest(from);
        return;
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
          Number(m.count ?? 0), Number(m.total ?? 0), (m.values ?? []) as number[]);
      } else {
        this.interaction.saleRefused(why);
      }
      return;
    }
    if (kind === 'buy') {
      const itemId = String(m.itemId ?? p?.itemId ?? '');
      if (ok) {
        this.syncEconomy(Number(m.money ?? this.economy.money));
        this.shop?.grant(itemId);
      } else {
        this.shop?.refused(itemId, why);
      }
      return;
    }
    if (kind === 'lcut') {
      if (!ok) this.legendary?.refuse(m.reason as Deny);
      return;
    }
    if (kind === 'rope') {
      const cid = Number(m.cid ?? p?.cid ?? -1);
      const rope = this.ropes.ropes.get(cid);
      if (!rope?.net || rope.net.mirror) return;
      if (ok) { rope.net.acked = true; return; }
      // Refused: the line comes back in, and the player hears why.
      this.ropes.remove(rope.id, 'gone', true);
      this.g.bus.emit('ui:toast', { text: `Rope refused — ${why}`, kind: 'bad', ms: 2000 });
      return;
    }
    if (p?.kind === 'pick' && p.cause === 'net') {
      this.g.bus.emit('net:pickResult', { fruitId: p.fruitId, ok });
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
      } else if (p.kind === 'buy') {
        this.shop?.refused(p.itemId ?? '', 'the host never answered');
      } else if (p.kind === 'rope') {
        const rope = p.cid !== undefined ? this.ropes.ropes.get(p.cid) : undefined;
        if (rope?.net && !rope.net.acked) this.ropes.remove(rope.id, 'gone', true);
      } else if (p.fruitId >= 0) {
        if (p.kind === 'pick' && p.cause === 'net') {
          this.g.bus.emit('net:pickResult', { fruitId: p.fruitId, ok: false });
        }
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
      busy: !!this.shop?.open || this.g.get<{ open: boolean }>('book').open,
      nt: this.tools?.owned.has('net') ? 1 : 0,
      c: held?.species ?? null,
      // The host needs the id, not just the species: it is what lets a carried
      // fruit's authoritative transform follow the hands that are carrying it.
      cf: held?.id ?? -1,
      cx: held ? +held.position.x.toFixed(2) : 0,
      cy: held ? +held.position.y.toFixed(2) : 0,
      cz: held ? +held.position.z.toFixed(2) : 0,
      // Owning a rope gun opens the legendary; the host cannot see our slots.
      rg: this.tools?.owned.has('ropegun') ? 1 : 0,
      // What the shed has sold us. Purchases are per-player and the host is
      // the one that enforces them, so a NEW host that inherited a ledger
      // without them would refuse a Deep Basket its ninth apple and let the
      // same tool be bought — and paid for — twice. Cheap enough to restate
      // continuously, which makes it true again the frame after a migration
      // rather than whenever somebody next opens the shed.
      bt: this.purchasedList(),
      // How much of the attached population's log we have applied.
      ns: this.fruitSys.nodeSeq,
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
    r.busy = m.busy === true;
    r.hasNet = Number(m.nt ?? 0) === 1;
    r.carrying = (m.c as string | null) ?? null;
    r.lastSeen = performance.now();
    if (!this.isHost) return;

    const h = this.authority.notePosition(from, Number(m.x), Number(m.y), Number(m.z), r.name);
    h.hasRopeGun = Number(m.rg ?? 0) === 1;
    // Purchases this peer says it has. Only ever ADDS: the ledger is what
    // stops a second sale of the same item, and a client claiming to own
    // something buys it nothing it has not already paid for — the money was
    // spent through `buy`, here, on whichever host was running at the time.
    for (const id of String(m.bt ?? '').split(',')) {
      if (id && !h.bought.has(id) && this.shop?.priceOf(id)) this.authority.noteBought(from, id);
    }
    this.nodeAck.set(from, Number(m.ns ?? 0));
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
      // Attached fruit is deterministic from the world seed on every client,
      // and its changes travel in the node log, so only fruit that has been
      // disturbed needs to travel here.
      if (f.state === 'attached' || f.state === 'gone') continue;
      const owner = this.authority.ownerOf(f.id);
      // Only a loose fruit has a body, and only a loose fruit is ever rebuilt
      // from this packet by a promotion. The rest travel as six zeros, which
      // JSON spends six bytes each on and nothing else in the game reads.
      const moving = f.state === 'free' && f.body ? f.body : null;
      const v = moving ? moving.linvel() : ZERO3;
      const w = moving ? moving.angvel() : ZERO3;
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
        f.stuck ? 1 : 0, +f.stuckHands.toFixed(1),
        +v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2),
        +w.x.toFixed(2), +w.y.toFixed(2), +w.z.toFixed(2),
      ]);
    }
    return out;
  }

  /** The node log a snapshot should carry: what the slowest peer lacks. */
  private nodeLogFor(to?: PeerId): NodeChange[] {
    let ack = Infinity;
    if (to) ack = this.nodeAck.get(to) ?? 0;
    else for (const p of this.peers) ack = Math.min(ack, this.nodeAck.get(p) ?? 0);
    if (!Number.isFinite(ack)) return [];
    const since = this.fruitSys.nodeChangesSince(ack);
    if (since) return since;
    // Scrolled out of the ring: the laggard needs the whole picture. It will
    // ack the manifest's sequence in its next player packet.
    this.sendManifest(to);
    return [];
  }

  private sendManifest(to?: PeerId): void {
    if (!this.transport || !this.isHost) return;
    const m = this.fruitSys.nodeManifest();
    // `nseq`, not `seq`: the transport stamps its own message counter on
    // `seq`, and the first version shipped the manifest under a number that
    // was really "the thirteenth message this page has sent".
    this.transport.send({ t: 'manifest', nseq: m.seq, changes: m.changes }, to);
    this.stats.manifests++;
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
      tier: this.economy.discoveryTier,
      pts: this.economy.discoveryPoints,
      nseq: this.fruitSys.nodeSeq,
      nlog: this.nodeLogFor(to),
      leg: this.legendary?.netState() ?? null,
      ropes: this.packRopes(peers),
      island: this.g.has('director') ? this.g.get<IslandDirector>('director').netState() : null,
      residents: this.g.has('characters') ? this.g.get<IslandCharacters>('characters').netState() : null,
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

    // The attached population first: anything a node change frees is placed
    // or dropped by the fruit list that follows.
    const nlog = (m.nlog ?? []) as NodeChange[];
    const nseq = Number(m.nseq ?? 0);
    if (!this.fruitSys.applyNodeChanges(nlog) || this.fruitSys.nodeSeq < nseq) {
      this.requestResync();
    }

    // Tombstones next: a fruit the host has destroyed must not be recreated
    // by anything later in this same message.
    for (const id of (m.gone ?? []) as number[]) {
      const f = this.fruitSys.get(id);
      if (f) { this.interaction.reconcile(f, 'gone', false); this.fruitSys.remove(f); }
      this.mirrorOwner.delete(id);
      this.knownRemoteFruit.delete(id);
      this.fruitSys.freedByLog.delete(id);
      this.noteSeenGone(id);
    }

    for (const p of list) {
      const [id, sp, va, st, x, y, z, qx, qy, qz, qw, sizeRoll, inflate, damage, ownerIdx,
        flags = 0, stuckHands = 0, vx = 0, vy = 0, vz = 0, wx = 0, wy = 0, wz = 0] = p;
      seen.add(id);
      // A request about this fruit is still in flight, so this picture of it
      // predates the request and cannot be used to correct it. The host's
      // answer settles it, one way or the other, within the timeout.
      if (this.pendingFruit.has(id) || this.pendingSell.has(id)) continue;
      const owner = ownerIdx >= 0 ? peers[ownerIdx] : undefined;
      if (owner) this.mirrorOwner.set(id, owner); else this.mirrorOwner.delete(id);

      let f = this.fruitSys.get(id);
      if (!f) {
        f = this.fruitSys.spawnReplica(id, SPECIES_ORDER[sp] ?? SPECIES_ORDER[0],
          VARIANT_ORDER[va] || null, sizeRoll);
      }
      const state = (STATE_ORDER[st] ?? 'free') as Fruit['state'];
      const mine = owner === me;
      this.fruitSys.applyRemoteState(f, state);
      if (f.inflate !== inflate) f.setInflation(inflate);
      if (f.damage !== damage) { f.damage = damage; f.refreshTint(); }
      f.stuck = (flags & 1) !== 0;
      f.stuckHands = stuckHands;
      // How fast the host says it is going. Kept whether or not this peer is
      // drawing it from the snapshot, because it is only ever read at the one
      // moment this peer has to build the body itself: a promotion.
      if (state === 'free') { f.netVel.set(vx, vy, vz); f.netAngVel.set(wx, wy, wz); }
      else { f.netVel.set(0, 0, 0); f.netAngVel.set(0, 0, 0); }
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
    // Our FIRST picture of this session sweeps wider: not just the fruit we
    // were told about and have since lost, but everything disturbed that the
    // host does not list at all.
    //
    // The sweep above can only forget what it already knew, and a peer that
    // has just joined knows nothing — so a page that hosted, left and came
    // back kept every fruit the new host had sold or burst while it was away,
    // as ghosts only it could see. The `gone` ring covers the recent ones and
    // is sixty-four deep; this covers the rest, and it is the same rule the
    // ropes already follow when they leave a session: what the host does not
    // have is not part of this world.
    if (!this.joinedSnapshot) {
      this.joinedSnapshot = true;
      for (const f of [...this.fruitSys.fruits.values()]) {
        if (f.state === 'attached' || f.state === 'gone') continue;
        if (seen.has(f.id) || this.pendingFruit.has(f.id) || this.pendingSell.has(f.id)) continue;
        this.interaction.reconcile(f, 'gone', false);
        this.fruitSys.remove(f);
        this.mirrorOwner.delete(f.id);
      }
    }
    // Fruit the node log took off a branch and this snapshot does not place
    // anywhere is fruit the host no longer has: sold, burst, or long gone.
    for (const id of this.fruitSys.freedByLog) {
      if (seen.has(id) || this.pendingFruit.has(id) || this.pendingSell.has(id)) continue;
      const f = this.fruitSys.get(id);
      if (f) { this.interaction.reconcile(f, 'gone', false); this.fruitSys.remove(f); }
    }
    this.fruitSys.freedByLog.clear();
    this.knownRemoteFruit = seen;
    this.syncEconomy(Number(m.money ?? this.economy.money),
      typeof m.tier === 'number' ? m.tier : undefined,
      typeof m.pts === 'number' ? m.pts : undefined);
    if (m.leg) this.legendary?.applyNet(m.leg as LegendaryNetState);
    if (Array.isArray(m.ropes)) this.applyRopes(m.ropes as RopePacket[], peers);
    if (m.island && this.g.has('director')) this.g.get<IslandDirector>('director').applyNet(m.island as IslandDirectorState);
    if (m.residents && this.g.has('characters')) this.g.get<IslandCharacters>('characters').applyNet(m.residents as CharacterNetState);
  }

  private requestResync(): void {
    const now = this.g.clock.elapsed;
    if (now - this.lastResync < RESYNC_INTERVAL) return;
    this.lastResync = now;
    this.send({ kind: 'resync' });
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
      busy: false, hasNet: false,
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
    // A host of nobody has nobody to tell; a newcomer that has not yet been
    // told who hosts must not broadcast its own empty world in the meantime.
    if (this.isHost && this.established) {
      this.stickToRemotes();
      this.snapshotTimer += dt;
      if (this.snapshotTimer >= 1 / SNAPSHOT_HZ) {
        this.snapshotTimer = 0;
        this.sendSnapshot();
      }
    }
  }

  /**
   * Host: a gluefruit that hits another player is theirs now.
   *
   * The host is the only peer that knows how fast a loose fruit is moving,
   * so it makes this call for everyone but itself (its own player is handled
   * in `InteractionSystem`, which sees the same fruit with the same body).
   * The remote is a capsule at its last reported position; the claim goes
   * through the ledger like any other pick and the snapshot puts the fruit in
   * their hands.
   */
  private stickToRemotes(): void {
    for (const f of this.fruitSys.fruits.values()) {
      if (f.state !== 'free' || !f.body || f.stuck || !f.hasTrait('sticky')) continue;
      if (f.speed < 2.5) continue;
      for (const r of this.remotes.values()) {
        if (r.state !== 'active') continue;
        const footY = r.targetPos.y + 0.34;
        const headY = r.targetPos.y + Math.max(r.height - 0.34, 0.35);
        const cy = clamp(f.position.y, footY, headY);
        const dx = f.position.x - r.targetPos.x;
        const dy = f.position.y - cy;
        const dz = f.position.z - r.targetPos.z;
        const reach = f.radius + 0.34 + 0.22;
        if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
        if (this.authority.claim(r.id, f.id, 'stuck') === null) this.sendSnapshot();
        break;
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
