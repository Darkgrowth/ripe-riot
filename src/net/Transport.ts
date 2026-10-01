/**
 * Wire abstraction. Everything above this file is transport-agnostic, so the
 * same authority code runs over a local channel today and WebRTC later.
 */

export type PeerId = string;

/** Different authored populations may never share deterministic fruit IDs. */
export function roomForMode(room: string, orchardRun: boolean): string {
  return `${orchardRun ? 'orchard-v1' : 'sunpatch'}:${room}`;
}

export interface NetMessage {
  /** Message kind, e.g. 'hello', 'snapshot', 'intent'. */
  t: string;
  /** Sender peer id, filled in by the transport. */
  from?: PeerId;
  /** Target peer, or undefined to broadcast. */
  to?: PeerId;
  /** Monotonic sequence from the sender. */
  seq?: number;
  [k: string]: unknown;
}

export interface Transport {
  readonly id: PeerId;
  readonly kind: string;
  /** Peers currently known, excluding self. */
  peers(): PeerId[];
  send(msg: NetMessage, to?: PeerId): void;
  onMessage(fn: (msg: NetMessage) => void): () => void;
  onPeerChange(fn: (peers: PeerId[]) => void): () => void;
  close(): void;
  /** Simulated one-way latency in ms, for testing. */
  latency: number;
}

function randomId(): PeerId {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Same-machine transport over BroadcastChannel.
 *
 * This is not a stand-in for real networking — it is how local co-op on one
 * machine works, and it makes multiplayer testable end to end right now: two
 * real browser contexts, two real game instances, one real message bus. The
 * WebRTC transport that replaces it for internet play implements this same
 * interface and nothing above it changes.
 */
export class BroadcastTransport implements Transport {
  readonly id: PeerId = randomId();
  readonly kind = 'broadcast';
  latency = 0;
  private ch: BroadcastChannel;
  private handlers = new Set<(m: NetMessage) => void>();
  private peerHandlers = new Set<(p: PeerId[]) => void>();
  /** peer id -> last time we heard from them (ms). */
  private seen = new Map<PeerId, number>();
  private seq = 0;
  private timer: number | null = null;
  private readonly timeout = 3500;

  constructor(room = 'riperiot') {
    this.ch = new BroadcastChannel(`riperiot.${room}`);
    this.ch.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as NetMessage;
      if (!msg || msg.from === this.id) return;
      if (msg.to && msg.to !== this.id) return;
      if (msg.from) this.notePeer(msg.from);
      if (msg.t === 'ping') return;         // liveness only
      if (this.latency > 0) {
        window.setTimeout(() => this.dispatch(msg), this.latency);
      } else {
        this.dispatch(msg);
      }
    };
    // Announce presence and prune peers that go quiet.
    this.timer = window.setInterval(() => {
      this.raw({ t: 'ping' });
      const now = performance.now();
      let changed = false;
      for (const [p, at] of this.seen) {
        if (now - at > this.timeout) { this.seen.delete(p); changed = true; }
      }
      if (changed) this.emitPeers();
    }, 900);
    this.raw({ t: 'ping' });
  }

  private dispatch(msg: NetMessage): void {
    for (const h of this.handlers) h(msg);
  }

  private notePeer(p: PeerId): void {
    const known = this.seen.has(p);
    this.seen.set(p, performance.now());
    if (!known) this.emitPeers();
  }

  private emitPeers(): void {
    const list = this.peers();
    for (const h of this.peerHandlers) h(list);
  }

  private raw(msg: NetMessage): void {
    this.ch.postMessage({ ...msg, from: this.id, seq: this.seq++ });
  }

  peers(): PeerId[] { return [...this.seen.keys()].sort(); }

  send(msg: NetMessage, to?: PeerId): void {
    const out: NetMessage = { ...msg, from: this.id, seq: this.seq++ };
    if (to) out.to = to;
    if (this.latency > 0) window.setTimeout(() => this.ch.postMessage(out), this.latency);
    else this.ch.postMessage(out);
  }

  onMessage(fn: (m: NetMessage) => void): () => void {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  onPeerChange(fn: (p: PeerId[]) => void): () => void {
    this.peerHandlers.add(fn);
    return () => this.peerHandlers.delete(fn);
  }

  close(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.handlers.clear();
    this.peerHandlers.clear();
    this.ch.close();
  }
}

/** In-process transport, for unit tests and solo play. */
export class LoopbackTransport implements Transport {
  readonly id: PeerId = randomId();
  readonly kind = 'loopback';
  latency = 0;
  private handlers = new Set<(m: NetMessage) => void>();
  private peerHandlers = new Set<(p: PeerId[]) => void>();
  private partner: LoopbackTransport | null = null;

  /** Wire two loopback transports together. */
  static pair(): [LoopbackTransport, LoopbackTransport] {
    const a = new LoopbackTransport();
    const b = new LoopbackTransport();
    a.partner = b; b.partner = a;
    queueMicrotask(() => { a.emitPeers(); b.emitPeers(); });
    return [a, b];
  }

  private emitPeers(): void {
    const list = this.peers();
    for (const h of this.peerHandlers) h(list);
  }

  peers(): PeerId[] { return this.partner ? [this.partner.id] : []; }

  send(msg: NetMessage, to?: PeerId): void {
    const p = this.partner;
    if (!p) return;
    if (to && to !== p.id) return;
    const out: NetMessage = { ...msg, from: this.id };
    const deliver = () => { for (const h of p.handlers) h(out); };
    if (this.latency > 0) setTimeout(deliver, this.latency); else queueMicrotask(deliver);
  }

  onMessage(fn: (m: NetMessage) => void): () => void {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }
  onPeerChange(fn: (p: PeerId[]) => void): () => void {
    this.peerHandlers.add(fn);
    return () => this.peerHandlers.delete(fn);
  }
  close(): void { this.handlers.clear(); this.peerHandlers.clear(); this.partner = null; }
}
