import * as THREE from 'three';
import type { Fruit } from '@/fruit/Fruit';
import type { FruitSystem } from '@/fruit/FruitSystem';
import type { Economy } from '@/systems/Economy';
import {
  BASKET_CAPACITY, BASKET_MAX_ITEM_MASS, DEEP_BASKET_CAPACITY, DEEP_BASKET_MAX_ITEM_MASS,
} from '@/interaction/CarryRules';
import { STICK_HANDS_HIT, STICK_HANDS_PICK } from '@/fruit/FruitTraits';
import type { PeerId } from './Transport';

/**
 * The host's ledger of who owns which fruit, and the only code allowed to
 * change it.
 *
 * The rule the whole file exists to enforce: IF TWO PLAYERS DISAGREE ABOUT A
 * FRUIT, THE HOST DECIDES WHAT IS TRUE. Every gameplay action that changes
 * shared state — a stem breaking, a fruit leaving the ground, a basket
 * emptying at the shed — arrives here as a request from a peer, is validated
 * against this ledger, and either mutates the world or is refused with a
 * reason. Clients may PREDICT the outcome so pressing E still feels instant,
 * but they never get to be right about it.
 *
 * This is deliberately transport-free and Game-free: it takes a small hooks
 * object, so the arbitration can be reasoned about (and tested) without a
 * browser, a socket or a second player.
 */

export type Deny =
  | 'no-fruit'
  | 'held-by-other'
  | 'wrong-state'
  | 'out-of-reach'
  | 'not-yours'
  | 'basket-full'
  | 'too-heavy'
  | 'needs-tool'
  | 'not-at-pad'
  | 'nothing-to-sell'
  | 'already-sold'
  | 'no-such-item'
  | 'already-owned'
  | 'locked'
  | 'too-expensive'
  | 'wrong-phase'
  | 'restrain-first'
  | 'spiky'
  | 'hands-stuck'
  | 'rope-limit';

export const DENY_TEXT: Record<Deny, string> = {
  'no-fruit': 'that fruit is gone',
  'held-by-other': 'someone else got there first',
  'wrong-state': 'it is not where you think it is',
  'out-of-reach': 'too far away',
  'not-yours': 'you are not holding that',
  'basket-full': 'basket is full',
  'too-heavy': 'too heavy for the basket',
  'needs-tool': 'it will not come loose by hand',
  'not-at-pad': 'not standing at the drop-off',
  'nothing-to-sell': 'nothing to sell',
  'already-sold': 'already sold',
  'no-such-item': 'the shed does not sell that',
  'already-owned': 'you already own that',
  'locked': 'not unlocked yet',
  'too-expensive': 'not enough money',
  'wrong-phase': 'not now',
  'restrain-first': 'restrain it first',
  'spiky': 'it is covered in spikes',
  'hands-stuck': 'your hands are full of gluefruit',
  'rope-limit': 'too many ropes out',
};

/** What the host knows about one player's hands. */
export interface Holding {
  peer: PeerId;
  /** Fruit id in hand, or -1. */
  carried: number;
  /** Fruit ids in the basket, in the order they went in. */
  basket: number[];
  /** Last reported foot position, which is what zone checks are measured from. */
  pos: THREE.Vector3;
  name: string;
  /**
   * This player's basket limits, as the host knows them. Upgrades are
   * per-player and bought through the host, so the host is the one place that
   * knows a client paid for a Deep Basket — and the one place that would
   * otherwise refuse their tenth apple with 'basket-full'.
   */
  capacity: number;
  maxItemMass: number;
  /** Shop items the host has sold this peer. A double-click is not two sales. */
  bought: Set<string>;
  /** Reported with the player packet; gates the legendary's first phase. */
  hasRopeGun: boolean;
}

export interface AuthorityHooks {
  fruit: FruitSystem;
  economy: Economy;
  sellPad(): THREE.Vector3;
  sellRadius(): number;
  groundAt(x: number, z: number): number;
  /** The host's own judgement of a flight, for the payout multiplier. */
  evaluate(f: Fruit): void;
  multiplierFor(f: Fruit): number;
  emit(name: string, payload: unknown): void;
  /** The shed's price list, as the host sees it. Null for an unknown item. */
  priceOf(itemId: string): { cost: number; tier: number } | null;
  /** Where a plant stands, for ranging a shake. Null for an unknown plant. */
  plantAt(plantId: number): THREE.Vector3 | null;
}

/** How far from a player's reported position a blast or a shake may land. */
const ACT_RANGE = 22;

/**
 * How far from a player's reported position a fruit may be and still be
 * claimable. Generous on purpose: the real reach is 3.4 m from the eye, the
 * position is a 20 Hz sample of a running person, and a false refusal reads as
 * a broken button. It is not there to police reach, it is there so a peer
 * cannot claim or sell a fruit on the other side of the island.
 */
const CLAIM_RANGE = 7;
/**
 * The same idea for breaking a stem, at the range TOOLS work at.
 *
 * Hand reach is the wrong yardstick here and using it was a real bug: the
 * gate that turns a client's `detach` into an intent sits at the bottom of
 * FruitSystem, so it catches the shaker (11 m), the rope gun and the air
 * cannon as well as the hand. Refusing those at 7 m would have quietly broken
 * every ranged tool in multiplayer while the hand kept working — the kind of
 * failure that ships. What this still refuses is stripping the island from
 * the dock.
 */
const DETACH_RANGE = 48;

const _v = new THREE.Vector3();

export class FruitAuthority {
  private hooks: AuthorityHooks;
  /** fruit id -> the peer holding it (carried OR stowed in their basket). */
  private owner = new Map<number, PeerId>();
  private holdings = new Map<PeerId, Holding>();
  /**
   * Fruit that has been sold or destroyed under this host. A tombstone, not a
   * cache: it is what stops a second sell intent for the same id paying out
   * twice, and what stops a snapshot in flight resurrecting a sold melon.
   */
  private tombstones = new Set<number>();
  /** The tail of that set, for the wire, so clients can drop them at once. */
  private recentGone: number[] = [];

  stats = { claims: 0, denials: 0, sales: 0, spilled: 0, buys: 0 };

  constructor(hooks: AuthorityHooks) { this.hooks = hooks; }

  // ---- ledger -------------------------------------------------------------
  ownerOf(fruitId: number): PeerId | undefined { return this.owner.get(fruitId); }
  isOwned(fruitId: number): boolean { return this.owner.has(fruitId); }
  isSold(fruitId: number): boolean { return this.tombstones.has(fruitId); }
  entries(): Array<[number, PeerId]> { return [...this.owner.entries()]; }
  allHoldings(): Holding[] { return [...this.holdings.values()]; }

  holdingFor(peer: PeerId, name = 'Harvester'): Holding {
    let h = this.holdings.get(peer);
    if (!h) {
      h = {
        peer, carried: -1, basket: [], pos: new THREE.Vector3(), name,
        capacity: BASKET_CAPACITY, maxItemMass: BASKET_MAX_ITEM_MASS,
        bought: new Set(), hasRopeGun: false,
      };
      this.holdings.set(peer, h);
    }
    return h;
  }

  /** Does any player in the session own a rope gun? The legendary asks. */
  anyoneHasRopeGun(): boolean {
    for (const h of this.holdings.values()) if (h.hasRopeGun) return true;
    return false;
  }

  /** Is a point close enough to where this peer says they are standing? */
  nearPeer(peer: PeerId, x: number, y: number, z: number, range = ACT_RANGE): boolean {
    const h = this.holdingFor(peer);
    return Math.hypot(x - h.pos.x, z - h.pos.z) <= range && Math.abs(y - h.pos.y) <= Math.max(14, range);
  }

  /** Everything the host has to forget when it stops being the host. */
  reset(): void {
    this.owner.clear();
    this.holdings.clear();
    this.tombstones.clear();
    this.recentGone.length = 0;
  }

  /** Ids removed recently, newest last. Sent with every snapshot. */
  goneIds(): number[] { return this.recentGone; }

  /**
   * Seed a promoted host's tombstones from what it saw as a client.
   *
   * Every snapshot carries the host's recent `gone` list, and a client that
   * has been applying them knows which fruit was sold or burst. Without this
   * a promotion starts a world with no memory of any of that: a sell intent
   * naming a melon the last host already paid for would find no tombstone,
   * and the one rule the ledger exists to keep — money is created once per
   * fruit — would be broken by a disconnect.
   */
  adoptTombstones(ids: Iterable<number>): number {
    let n = 0;
    for (const id of ids) {
      if (this.tombstones.has(id)) continue;
      this.tombstones.add(id);
      this.recentGone.push(id);
      n++;
    }
    while (this.recentGone.length > 64) this.recentGone.shift();
    return n;
  }

  private noteGone(fruitId: number): void {
    this.tombstones.add(fruitId);
    this.recentGone.push(fruitId);
    if (this.recentGone.length > 64) this.recentGone.shift();
  }

  private inRange(h: Holding, f: Fruit, range = CLAIM_RANGE): boolean {
    // Vertical slack is wide: a player standing under a palm is 9 m below the
    // coconut they are looking at, and a rope gun reaches further still.
    return _v.copy(f.position).sub(h.pos).setY(0).length() <= range + f.radius
      && Math.abs(f.position.y - h.pos.y) <= Math.max(14, range);
  }

  // ---- actions ------------------------------------------------------------
  /**
   * Break a stem. Separate from `claim` because tools detach fruit without
   * taking hold of it — a shaker drops six apples on the grass and claims none.
   */
  detach(peer: PeerId, fruitId: number, byHand: boolean): Deny | null {
    const f = this.hooks.fruit.get(fruitId);
    if (!f || this.tombstones.has(fruitId)) return this.no('no-fruit');
    if (f.state !== 'attached') return this.no('wrong-state');
    const other = this.owner.get(fruitId);
    if (other && other !== peer) return this.no('held-by-other');
    const h = this.holdingFor(peer);
    if (!this.inRange(h, f, byHand ? CLAIM_RANGE : DETACH_RANGE)) return this.no('out-of-reach');
    if (byHand && f.def.attachStrength > 6.0) return this.no('needs-tool');
    this.hooks.fruit.detachAuthoritative(f, 'remote', -1);
    return null;
  }

  /** Is this peer standing close enough to act on this fruit at all? */
  canReach(peer: PeerId, fruitId: number, range = CLAIM_RANGE): boolean {
    const f = this.hooks.fruit.get(fruitId);
    return !!f && this.inRange(this.holdingFor(peer), f, range);
  }

  /**
   * Shake a plant on a peer's behalf. Returns how much came down.
   *
   * Ranged and clamped: the strongest thing in the game that shakes a tree is
   * a full-charge air cannon at 2.1, and a peer on the dock has no business
   * stripping the orchard.
   */
  shake(peer: PeerId, plantId: number, strength: number): number {
    const at = this.hooks.plantAt(plantId);
    if (!at || !this.nearPeer(peer, at.x, at.y, at.z, DETACH_RANGE)) return 0;
    return this.hooks.fruit.shakeAuthoritative(plantId, clamp01(strength, 2.4), -1);
  }

  /**
   * Buy something from the shed. The one place shared money is DESTROYED, and
   * the reason a client's purchase has to come through here: the old shop
   * spent the shared pot locally and was overwritten by the next snapshot,
   * which is a free tool with extra steps.
   *
   * Tools and upgrades are per-player, so ownership is checked per peer; the
   * price, the tier gate and the balance are the host's. Returns the amount
   * actually spent so the reply can say so.
   */
  buy(peer: PeerId, itemId: string): { deny: Deny | null; cost: number } {
    const h = this.holdingFor(peer);
    const entry = this.hooks.priceOf(itemId);
    if (!entry) return { deny: this.no('no-such-item'), cost: 0 };
    if (h.bought.has(itemId)) return { deny: this.no('already-owned'), cost: 0 };
    if (this.hooks.economy.discoveryTier < entry.tier) return { deny: this.no('locked'), cost: 0 };
    if (!this.hooks.economy.spend(entry.cost, `buy:${itemId}:${peer}`)) {
      return { deny: this.no('too-expensive'), cost: 0 };
    }
    this.noteBought(peer, itemId);
    this.stats.buys++;
    return { deny: null, cost: entry.cost };
  }

  /** Record a purchase's per-player consequences on the ledger. */
  noteBought(peer: PeerId, itemId: string): void {
    const h = this.holdingFor(peer);
    h.bought.add(itemId);
    if (itemId === 'bigBasket') { h.capacity = DEEP_BASKET_CAPACITY; h.maxItemMass = DEEP_BASKET_MAX_ITEM_MASS; }
    if (itemId === 'ropegun') h.hasRopeGun = true;
  }

  /**
   * Take hold of a fruit.
   *
   * This is the contention point. Two peers reaching for the same apple both
   * send a `pick`; messages are handled one at a time, so the first one here
   * writes the ledger and the second reads it and is refused. There is no
   * window in between because there is no await in between.
   */
  claim(peer: PeerId, fruitId: number, cause = 'hand'): Deny | null {
    const f = this.hooks.fruit.get(fruitId);
    if (!f || this.tombstones.has(fruitId)) return this.no('no-fruit');
    if (f.state === 'stowed' || f.state === 'gone') return this.no('wrong-state');
    const other = this.owner.get(fruitId);
    if (other && other !== peer) return this.no('held-by-other');
    const h = this.holdingFor(peer);
    if (!this.inRange(h, f)) return this.no('out-of-reach');
    // The hand rules the client already applied, enforced once more here so a
    // client that skipped them gets the same answer everyone else does.
    if (f.hasTrait('spiked') && cause !== 'net') return this.no('spiky');
    if (h.carried >= 0 && h.carried !== fruitId) {
      const held = this.hooks.fruit.get(h.carried);
      if (held && held.stuckHands > 0) return this.no('hands-stuck');
    }
    if (f.state === 'attached') {
      if (f.def.attachStrength > 6.0) return this.no('needs-tool');
      this.hooks.fruit.detachAuthoritative(f, 'remote-hand', -1);
    }
    // Hands are not a stack: taking something new puts the old thing in the
    // basket if it fits and on the ground if it does not. The client does
    // exactly this locally, so mirroring it here keeps the two baskets equal.
    if (h.carried >= 0 && h.carried !== fruitId) this.makeRoom(h);
    f.pickUp(-1);
    if (f.hasTrait('sticky')) {
      f.stuckHands = cause === 'stuck' ? STICK_HANDS_HIT : cause === 'net' ? 0 : STICK_HANDS_PICK;
    }
    this.owner.set(fruitId, peer);
    h.carried = fruitId;
    this.stats.claims++;
    return null;
  }

  private makeRoom(h: Holding): void {
    const held = this.hooks.fruit.get(h.carried);
    h.carried = -1;
    if (!held) return;
    if (held.mass <= h.maxItemMass && h.basket.length < h.capacity) {
      this.hooks.evaluate(held);
      held.stow();
      h.basket.push(held.id);
      return;
    }
    this.spill(held, h, 0);
  }

  /** Put a fruit back into the world at a player's feet, at rest. */
  private spill(f: Fruit, h: Holding, index: number): void {
    const a = index * 1.1;
    f.position.set(h.pos.x + Math.cos(a) * 0.5, 0, h.pos.z + Math.sin(a) * 0.5);
    // At their FEET, not at the terrain under their feet. The two are the same
    // almost everywhere and are not the same on the dock, where the terrain is
    // several metres of seawater: a player who disconnects standing on the
    // drop-off pad — the one place everybody stands — had everything they were
    // carrying placed below the waterline, where the next step deleted it as
    // sunk. Whatever they were standing on will catch it.
    const ground = this.hooks.groundAt(f.position.x, f.position.z);
    f.position.y = Math.max(ground, h.pos.y) + f.radius + 0.12;
    // `release` only accepts a carried fruit, and a basketed one is `stowed`.
    if (f.state !== 'carried') f.state = 'carried';
    f.release(_v.set(0, 0, 0));
    this.stats.spilled++;
  }

  /** Let go: a drop, a throw, or a fruit that grew out of someone's arms. */
  release(peer: PeerId, fruitId: number, at: THREE.Vector3, vel: THREE.Vector3): Deny | null {
    const f = this.hooks.fruit.get(fruitId);
    // Letting go of something already loose is not a failure, it is a message
    // that arrived after the host had reached the same conclusion — most often
    // because the pick that displaced it auto-dropped it a moment earlier.
    if (f && f.state === 'free' && !this.owner.has(fruitId)) return null;
    if (this.owner.get(fruitId) !== peer) return this.no('not-yours');
    if (!f) { this.forget(fruitId, peer); return this.no('no-fruit'); }
    if (f.state !== 'carried') { this.forget(fruitId, peer); return this.no('wrong-state'); }
    // A gluefruit decides when it lets go, not the hand holding it.
    if (f.stuckHands > 0) return this.no('hands-stuck');
    f.position.copy(at);
    const ground = this.hooks.groundAt(at.x, at.z) + f.radius * 0.9;
    if (f.position.y < ground) f.position.y = ground;
    f.release(vel);
    this.forget(fruitId, peer);
    return null;
  }

  /** Into the basket. The host owns the count, so a full basket is a refusal. */
  stow(peer: PeerId, fruitId: number): Deny | null {
    if (this.owner.get(fruitId) !== peer) return this.no('not-yours');
    const f = this.hooks.fruit.get(fruitId);
    if (!f) { this.forget(fruitId, peer); return this.no('no-fruit'); }
    // Already in their basket: the host got there first, by making room for
    // the fruit this player picked up next. Agreeing twice is not an error.
    if (f.state === 'stowed' && this.holdingFor(peer).basket.includes(fruitId)) return null;
    if (f.state !== 'carried') return this.no('wrong-state');
    if (f.stuckHands > 0) return this.no('hands-stuck');
    const h = this.holdingFor(peer);
    if (f.mass > h.maxItemMass) return this.no('too-heavy');
    if (h.basket.length >= h.capacity) return this.no('basket-full');
    // Judge the flight before the fruit stops simulating — once stowed there is
    // no record left to score, and the multiplier is part of the payout.
    this.hooks.evaluate(f);
    f.stow();
    if (h.carried === fruitId) h.carried = -1;
    if (!h.basket.includes(fruitId)) h.basket.push(fruitId);
    return null;
  }

  /**
   * Sell. The one place money is created, and the reason the ledger exists.
   *
   * The request names fruit ids. Every one of them is checked against this
   * peer's own holdings before a cent is paid, which is what the old code got
   * wrong: a client's sell intent ran `sellAll()` on the HOST, emptying the
   * host's basket and paying the host's fruit into the shared pot while the
   * client kept everything it was carrying.
   */
  sell(peer: PeerId, fruitIds: number[]): {
    deny: Deny | null; count: number; total: number; ids: number[]; values: number[];
  } {
    const h = this.holdingFor(peer);
    const pad = this.hooks.sellPad();
    const r = this.hooks.sellRadius();
    const onPad = Math.hypot(h.pos.x - pad.x, h.pos.z - pad.z) < r + 1.2
      && Math.abs(h.pos.y - pad.y) < 4;
    if (!onPad) return { deny: this.no('not-at-pad'), count: 0, total: 0, ids: [], values: [] };

    const batch: Fruit[] = [];
    for (const id of fruitIds) {
      if (this.tombstones.has(id)) continue;          // never pay twice
      if (this.owner.get(id) !== peer) continue;      // not yours to sell
      const f = this.hooks.fruit.get(id);
      if (!f) continue;
      if (f.state !== 'carried' && f.state !== 'stowed') continue;
      if (batch.some((b) => b.id === id)) continue;   // a repeated id is one fruit
      batch.push(f);
    }
    if (!batch.length) return { deny: this.no('nothing-to-sell'), count: 0, total: 0, ids: [], values: [] };

    const result = this.hooks.economy.sell(batch, (f) => this.hooks.multiplierFor(f));
    const ids: number[] = [];
    const values: number[] = [];
    batch.forEach((f, i) => {
      ids.push(f.id);
      values.push(result.lines[i]?.total ?? 0);
      this.noteGone(f.id);
      this.owner.delete(f.id);
      if (h.carried === f.id) h.carried = -1;
      this.hooks.fruit.remove(f);
    });
    h.basket = h.basket.filter((id) => !ids.includes(id));
    this.stats.sales++;
    return { deny: null, count: result.count, total: result.total, ids, values };
  }

  /** Record a fruit this host destroyed, so no snapshot brings it back. */
  destroyed(fruitId: number): void {
    const peer = this.owner.get(fruitId);
    if (peer) this.forget(fruitId, peer);
    this.noteGone(fruitId);
  }

  /**
   * A peer left. Everything in their hands and basket comes back to the world
   * where they were standing, at rest, spread out enough that the solver does
   * not treat nine apples at one point as an explosion.
   *
   * The alternative — leaving the ledger pointing at a peer that no longer
   * exists — is the "stale carried fruit" case: an invisible fruit nobody can
   * ever claim again, still counted, still worth money to nobody.
   */
  forgetPeer(peer: PeerId): { released: number; ids: number[] } {
    const h = this.holdings.get(peer);
    this.holdings.delete(peer);
    const ids: number[] = [];
    if (!h) return { released: 0, ids };
    const owned = [h.carried, ...h.basket].filter((id) => id >= 0);
    // Anything the ledger still attributes to them, even if their own record
    // of it drifted.
    for (const [id, p] of this.owner) if (p === peer && !owned.includes(id)) owned.push(id);
    let n = 0;
    for (let i = 0; i < owned.length; i++) {
      const id = owned[i];
      // Their own record of what they held can drift from the ledger's — most
      // often on a promoted host, whose picture of the old session and whose
      // picture of its OWN hands can name the same fruit for one frame. A
      // fruit somebody else currently owns is not this peer's to drop, and
      // taking it out of live hands is worse than leaving a stale entry.
      const holder = this.owner.get(id);
      if (holder !== undefined && holder !== peer) continue;
      this.owner.delete(id);
      const f = this.hooks.fruit.get(id);
      if (!f || f.state === 'gone') continue;
      if (f.state !== 'carried' && f.state !== 'stowed') continue;
      this.spill(f, h, i);
      ids.push(id);
      n++;
    }
    return { released: n, ids };
  }

  /** The host's own player acted locally; the ledger just records the result. */
  noteLocalCarry(peer: PeerId, fruitId: number): void {
    const h = this.holdingFor(peer);
    const prev = h.carried;
    if (prev >= 0 && prev !== fruitId && this.owner.get(prev) === peer) {
      // The local code already stowed or dropped it; find out which.
      const f = this.hooks.fruit.get(prev);
      if (f?.state === 'stowed') {
        if (!h.basket.includes(prev)) h.basket.push(prev);
      } else {
        this.owner.delete(prev);
      }
    }
    h.carried = fruitId;
    this.owner.set(fruitId, peer);
  }

  noteLocalStow(peer: PeerId, fruitId: number): void {
    const h = this.holdingFor(peer);
    if (h.carried === fruitId) h.carried = -1;
    if (!h.basket.includes(fruitId)) h.basket.push(fruitId);
    this.owner.set(fruitId, peer);
  }

  noteLocalRelease(peer: PeerId, fruitId: number): void {
    this.forget(fruitId, peer);
  }

  noteLocalSold(peer: PeerId, ids: number[]): void {
    const h = this.holdingFor(peer);
    for (const id of ids) {
      this.noteGone(id);
      this.owner.delete(id);
      if (h.carried === id) h.carried = -1;
    }
    h.basket = h.basket.filter((id) => !ids.includes(id));
  }

  /** Keep a peer's reported position, which zone checks are measured from. */
  notePosition(peer: PeerId, x: number, y: number, z: number, name?: string): Holding {
    const h = this.holdingFor(peer, name);
    if (name) h.name = name;
    h.pos.set(x, y, z);
    return h;
  }

  private forget(fruitId: number, peer: PeerId): void {
    this.owner.delete(fruitId);
    const h = this.holdings.get(peer);
    if (!h) return;
    if (h.carried === fruitId) h.carried = -1;
    const i = h.basket.indexOf(fruitId);
    if (i >= 0) h.basket.splice(i, 1);
  }

  private no(reason: Deny): Deny { this.stats.denials++; return reason; }
}

/** A number off the wire, held to 0..max. NaN is 0. */
export function clamp01(v: number, max: number): number {
  return Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0;
}
