import * as THREE from 'three';
import type { Game, System } from '@/core/Game';
import type { FruitSystem } from '@/fruit/FruitSystem';
import type { Economy } from '@/systems/Economy';
import type { InteractionSystem } from '@/interaction/InteractionSystem';
import { BroadcastTransport, type NetMessage, type PeerId, type Transport } from './Transport';
import { makePlayerRig, SUIT_PRESETS, type PlayerRig } from '@/player/PlayerRig';
import { damp } from '@/core/MathUtils';

/** What a client is allowed to ask the host to do. */
export type IntentKind =
  | 'detach' | 'pick' | 'throw' | 'stow' | 'drop' | 'sell'
  | 'shake' | 'blast' | 'rope' | 'spawn';

export interface Intent {
  kind: IntentKind;
  playerId: PeerId;
  fruitId?: number;
  plantId?: number;
  /** World position, packed as a triple. */
  at?: [number, number, number];
  dir?: [number, number, number];
  power?: number;
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

/** One fruit as it appears on the wire. Deliberately small and flat. */
type FruitPacket = [
  id: number, species: number, variant: number, state: number,
  x: number, y: number, z: number,
  qx: number, qy: number, qz: number, qw: number,
  scale: number, tintR: number, tintG: number, tintB: number,
];

const SPECIES_ORDER = ['apple', 'orange', 'coconut', 'banana', 'watermelon', 'puffmelon', 'vinebomb'];
const VARIANT_ORDER = ['', 'huge', 'tiny', 'pale', 'black', 'glowing', 'ancient', 'unstable', 'golden'];
const STATE_ORDER = ['attached', 'free', 'carried', 'stowed', 'gone'];

const SNAPSHOT_HZ = 15;
const PLAYER_HZ = 20;

/**
 * Host-authoritative co-op.
 *
 * The host owns everything the brief says it should: fruit physics and
 * detachment, ropes, quality, economy and weather. Clients own only their own
 * movement, which they simulate locally and report; everything else they do is
 * an INTENT the host validates and applies. That split is the whole reason this
 * system exists early — retrofitting an authority boundary through a physics
 * game after the fact is a rewrite, not a refactor.
 *
 * What is deliberately not here yet: prediction and reconciliation for
 * client-side fruit interaction (clients see a ~1 frame delay on their own
 * picks), delta compression, and NAT traversal. All three are additive.
 */
export class MultiplayerAuthority implements System {
  readonly name = 'net';
  private g!: Game;
  private fruitSys!: FruitSystem;
  private economy!: Economy;
  private interaction!: InteractionSystem;
  transport: Transport | null = null;
  peers: PeerId[] = [];
  /** Lowest peer id is the host; deterministic and needs no election round. */
  isHost = true;
  hostId: PeerId = '';
  connected = false;
  playerName = 'Harvester';
  suit = 0;

  private remotes = new Map<PeerId, RemoteState>();
  private snapshotTimer = 0;
  private playerTimer = 0;
  private off: Array<() => void> = [];
  /** Fruit the host has told us about, so clients can drop stale ones. */
  private knownRemoteFruit = new Set<number>();
  stats = { sent: 0, received: 0, intents: 0, snapshotBytes: 0 };

  init(g: Game): void {
    this.g = g;
    this.fruitSys = g.get<FruitSystem>('fruit');
    this.economy = g.get<Economy>('economy');
    this.interaction = g.get<InteractionSystem>('interaction');

    g.debug?.addProbe('net', () => ({
      connected: this.connected,
      kind: this.transport?.kind ?? 'none',
      id: this.transport?.id ?? '',
      isHost: this.isHost,
      hostId: this.hostId,
      peers: this.peers.length,
      remotes: this.remotes.size,
      ...this.stats,
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
  }

  // ---- connection ---------------------------------------------------------
  connect(transport: Transport): void {
    this.disconnect();
    this.transport = transport;
    this.connected = true;
    this.off.push(transport.onMessage((m) => this.onMessage(m)));
    this.off.push(transport.onPeerChange((p) => this.onPeers(p)));
    this.onPeers(transport.peers());
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
      this.g.bus.emit('ui:toast', {
        text: this.isHost ? 'You are now the host' : 'Host changed', ms: 2400,
      });
    }
    // Forget remotes that have gone.
    for (const [id, r] of this.remotes) {
      if (!peers.includes(id)) { this.destroyRemote(r); this.remotes.delete(id); }
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
        if (this.isHost) this.sendFullSnapshot(m.from);
        break;
      case 'helloBack':
        this.ensureRemote(m.from!, String(m.name ?? 'Harvester'), Number(m.suit ?? 0));
        break;
      case 'bye': {
        const leaving = this.remotes.get(m.from!);
        if (leaving) {
          this.destroyRemote(leaving);
          this.remotes.delete(m.from!);
          this.g.bus.emit('ui:toast', { text: `${leaving.name} left`, ms: 2200 });
        }
        this.peers = this.peers.filter((p) => p !== m.from);
        break;
      }
      case 'player':
        this.applyPlayerPacket(m);
        break;
      case 'intent':
        if (this.isHost) this.applyIntent(m.intent as Intent);
        break;
      case 'snapshot':
        if (!this.isHost) this.applySnapshot(m);
        break;
      case 'economy':
        if (!this.isHost) {
          const money = Number(m.money ?? 0);
          if (money !== this.economy.money) {
            this.economy.money = money;
            this.g.bus.emit('money:changed', { money, delta: 0, reason: 'sync' });
          }
        }
        break;
      case 'event':
        // Cosmetic, host-originated: toasts, celebrations, stunt chips.
        this.g.bus.emit(m.name as never, m.payload as never);
        break;
      default: break;
    }
  }

  /** Clients call this instead of acting directly on authoritative state. */
  requestIntent(intent: Omit<Intent, 'playerId'>): boolean {
    if (!this.connected || this.isHost) return false;
    this.transport?.send({ t: 'intent', intent: { ...intent, playerId: this.transport.id } });
    this.stats.intents++;
    return true;
  }

  /** True when this peer may mutate authoritative state directly. */
  get authoritative(): boolean { return !this.connected || this.isHost; }

  private applyIntent(intent: Intent): void {
    if (!intent) return;
    this.stats.intents++;
    switch (intent.kind) {
      case 'detach': {
        const f = intent.fruitId !== undefined ? this.fruitSys.get(intent.fruitId) : undefined;
        if (f && f.state === 'attached') this.fruitSys.detach(f, 'remote', -1);
        break;
      }
      case 'shake': {
        if (intent.plantId !== undefined) this.fruitSys.shake(intent.plantId, 1.6, -1);
        break;
      }
      case 'blast': {
        if (intent.at) {
          this.g.physics.explode(
            new THREE.Vector3(intent.at[0], intent.at[1], intent.at[2]),
            4.0, 12 * (intent.power ?? 1));
        }
        break;
      }
      case 'sell': {
        // Selling is shared: co-op money is one pot.
        this.interaction.sellAll();
        break;
      }
      default: break;
    }
  }

  // ---- replication --------------------------------------------------------
  private sendPlayerPacket(): void {
    const p = this.g.player;
    this.transport?.send({
      t: 'player',
      x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(2),
      yaw: +p.yaw.toFixed(3),
      h: +p.height.toFixed(2),
      s: p.state,
      c: this.interaction.carried?.fruit.species ?? null,
    });
    this.stats.sent++;
  }

  private applyPlayerPacket(m: NetMessage): void {
    const r = this.ensureRemote(m.from!, 'Harvester', 0);
    r.targetPos.set(Number(m.x), Number(m.y), Number(m.z));
    r.targetYaw = Number(m.yaw);
    r.height = Number(m.h ?? 1.82);
    r.state = String(m.s ?? 'active');
    r.carrying = (m.c as string | null) ?? null;
    r.lastSeen = performance.now();
  }

  private packFruit(): FruitPacket[] {
    const out: FruitPacket[] = [];
    for (const f of this.fruitSys.fruits.values()) {
      // Attached fruit is deterministic from the world seed on every client, so
      // only fruit that has been disturbed needs to travel.
      if (f.state === 'attached') continue;
      out.push([
        f.id,
        SPECIES_ORDER.indexOf(f.species),
        VARIANT_ORDER.indexOf(f.variant?.id ?? ''),
        STATE_ORDER.indexOf(f.state),
        +f.position.x.toFixed(2), +f.position.y.toFixed(2), +f.position.z.toFixed(2),
        +f.quaternion.x.toFixed(3), +f.quaternion.y.toFixed(3),
        +f.quaternion.z.toFixed(3), +f.quaternion.w.toFixed(3),
        +f.renderScale.toFixed(3),
        +f.tint.r.toFixed(2), +f.tint.g.toFixed(2), +f.tint.b.toFixed(2),
      ]);
    }
    return out;
  }

  private sendSnapshot(to?: PeerId): void {
    if (!this.transport) return;
    const fruit = this.packFruit();
    const msg: NetMessage = { t: 'snapshot', fruit, money: this.economy.money };
    this.transport.send(msg, to);
    this.stats.sent++;
    this.stats.snapshotBytes = JSON.stringify(msg).length;
  }

  private sendFullSnapshot(to?: PeerId): void { this.sendSnapshot(to); }

  private applySnapshot(m: NetMessage): void {
    const list = (m.fruit ?? []) as FruitPacket[];
    const seen = new Set<number>();
    for (const p of list) {
      const [id, sp, va, st, x, y, z, qx, qy, qz, qw, scale, tr, tg, tb] = p;
      seen.add(id);
      let f = this.fruitSys.get(id);
      if (!f) {
        // The host knows about a fruit we do not; materialise it locally as a
        // display-only body. Clients never simulate replicated fruit.
        f = this.fruitSys.spawnFree(
          SPECIES_ORDER[sp] ?? 'apple', new THREE.Vector3(x, y, z),
          VARIANT_ORDER[va] || null);
        f.despawn();            // strip the body: the host owns the physics
        this.fruitSys.fruits.set(f.id, f);
      }
      f.position.set(x, y, z);
      f.quaternion.set(qx, qy, qz, qw);
      f.tint.setRGB(tr, tg, tb);
      const state = STATE_ORDER[st] as typeof f.state;
      if (state && f.state !== state) f.state = state;
      void scale;
    }
    for (const id of this.knownRemoteFruit) {
      if (!seen.has(id)) {
        const f = this.fruitSys.get(id);
        if (f && f.state !== 'attached') this.fruitSys.remove(f);
      }
    }
    this.knownRemoteFruit = seen;

    const money = Number(m.money ?? this.economy.money);
    if (money !== this.economy.money) {
      this.economy.money = money;
      this.g.bus.emit('money:changed', { money, delta: 0, reason: 'sync' });
    }
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
