import * as THREE from 'three';
import type { Game, System } from '@/core/Game';
import type { Fruit } from '@/fruit/Fruit';
import type { FruitSystem } from '@/fruit/FruitSystem';
import type { Sunpatch } from '@/world/Sunpatch';
import type { Economy } from '@/systems/Economy';
import type { MultiplayerAuthority } from '@/net/MultiplayerAuthority';
import type { EncounterSystem } from '@/enemies/EncounterSystem';
import type { PlayerVitals } from '@/player/PlayerVitals';
import { clamp, damp } from '@/core/MathUtils';
import { QueryMask } from '@/physics/Layers';
import { PLAYER_RADIUS } from '@/player/PlayerController';
import {
  BASKET_CAPACITY, BASKET_MAX_ITEM_MASS,
  canHandCarry, carryClassFor, refusalReason, type CarryClass,
} from './CarryRules';
import { STICK_HANDS_HIT, STICK_HANDS_PICK } from '@/fruit/FruitTraits';

/** How a fruit came into the hands. The host is told, because the net may
 *  take what bare hands may not and a gluefruit that HIT you sticks longer. */
export type PickCause = 'hand' | 'net' | 'stuck';

/** Anything the player can carry in their hands. Fruit for now; crates later. */
export interface Carried {
  fruit: Fruit;
  /** Two-handed haul: slower, held low, cannot be stowed. */
  heavy: boolean;
  /** Presentation class, refreshed every step because fruit can change size. */
  cls: CarryClass;
}

export interface BasketState {
  items: Fruit[];
  capacity: number;
  /** Heaviest single fruit the basket will take, in kg. */
  maxItemMass: number;
  massCarried: number;
}

const REACH = 3.4;
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _hold = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * Everything the player does with their hands: looking at things, picking them
 * up, hauling them, throwing them, and selling them.
 *
 * The rule that shapes the whole early game lives here: light fruit goes in the
 * basket automatically so harvesting stays fast, and anything heavier than the
 * basket allows must be carried in both hands. That single threshold is what
 * turns a watermelon from "an apple worth more" into a logistics problem.
 */
export class InteractionSystem implements System {
  readonly name = 'interaction';
  private g!: Game;
  private fruitSys!: FruitSystem;
  private world!: Sunpatch;
  private economy!: Economy;

  carried: Carried | null = null;
  basket: BasketState = {
    items: [], capacity: BASKET_CAPACITY, maxItemMass: BASKET_MAX_ITEM_MASS, massCarried: 0,
  };

  /** What the player is currently looking at, if anything. */
  target: Fruit | null = null;
  targetKind: 'fruit' | 'sell' | 'shop' | 'shake' | 'shove' | 'spiky' | null = null;
  /** Game time of the last "it will not let go" toast, so it does not spam. */
  private stuckToastAt = -9;
  /** Times the local player has been pricked, for the harness. */
  pricks = 0;
  private targetPlantId = -1;
  promptText: string | null = null;
  private revivingPeer: string | null = null;
  private lastEscapeRequest = -1;

  /** Smoothed hand position offsets, so carrying has weight. */
  private handSway = new THREE.Vector3();
  /** Offset of the held fruit from the hand point, its velocity, and where
   *  the hand point was last frame (the spring's driving term). */
  private handLag = new THREE.Vector3();
  private handLagVel = new THREE.Vector3();
  private lastHold = new THREE.Vector3();
  /**
   * The same lag resolved into the camera's own axes (right / up / forward),
   * which is what the first-person presentation needs. The world spring stays
   * the authority on weight; this is only a change of basis.
   */
  readonly handLagView = new THREE.Vector3();
  /** 1 the instant something is picked, decaying: widens the swing cap so
   *  the fruit springs off the branch rather than teleporting to the hand. */
  private snap = 0;
  /** 0..1 wind-up, written by whichever tool is doing the throwing. */
  throwCharge = 0;
  private nearSellPad = false;
  private sellCooldown = 0;
  /** Why the last pickup was refused, for the probe and the harness. */
  lastRefusal: string | null = null;
  /** Free fruit resting on the sell pad, with the time they arrived. */
  private padFruit = new Map<number, number>();
  /** Sells asked for but not yet answered by the host, for the probe. */
  pendingSells = 0;
  private net!: MultiplayerAuthority | null;

  init(g: Game): void {
    this.g = g;
    this.fruitSys = g.get<FruitSystem>('fruit');
    this.world = g.get<Sunpatch>('world');
    this.economy = g.get<Economy>('economy');
    // Every system is registered before any of them initialises, so this
    // resolves even though the net system comes up after this one.
    this.net = g.has('net') ? g.get<MultiplayerAuthority>('net') : null;

    g.debug?.addProbe('interaction', () => ({
      carrying: this.carried ? {
        id: this.carried.fruit.id, species: this.carried.fruit.species,
        heavy: this.carried.heavy, mass: +this.carried.fruit.mass.toFixed(1),
        cls: this.carried.cls, diameter: +this.carried.fruit.diameter.toFixed(2),
      } : null,
      carryClass: this.carryClass,
      lastRefusal: this.lastRefusal,
      basket: this.basket.items.length,
      basketMass: +this.basket.massCarried.toFixed(1),
      basketValue: this.basketValue(),
      target: this.target ? { id: this.target.id, species: this.target.species } : null,
      targetKind: this.targetKind,
      prompt: this.promptText,
      nearSellPad: this.nearSellPad,
      // The ids are what the multiplayer suite asserts on: "both peers agree
      // this fruit is gone" is a statement about identity, not about counts.
      carriedId: this.carried?.fruit.id ?? -1,
      basketIds: this.basket.items.map((f) => f.id),
      pendingSells: this.pendingSells,
      stuckHands: this.carried ? +this.carried.fruit.stuckHands.toFixed(2) : 0,
      pricks: this.pricks,
    }));
    g.debug?.addAction('interact', () => this.tryInteract());
    g.debug?.addAction('throw', (power = 1) => this.throwHeld(power));
    /** The harness's drop is a reset, so it lets go of anything — gluefruit included. */
    g.debug?.addAction('drop', () => this.dropHeld(true));
    g.debug?.addAction('carry.class', (diameter: number, mass: number) =>
      carryClassFor(diameter, mass));
    g.debug?.addAction('pickup', (id: number, cause: PickCause = 'hand') => {
      const f = this.fruitSys.get(id);
      return f ? this.pickUp(f, cause) : false;
    });
    g.debug?.addAction('shove', (id?: number) => {
      const f = id === undefined ? this.target : this.fruitSys.get(id);
      return f ? this.shove(f) : false;
    });
    g.debug?.addAction('sell', () => this.sellAll());
    g.debug?.addAction('stow', () => this.stowHeld());
    g.debug?.addAction('basket.list', () => this.basket.items.map((f) => ({
      id: f.id, species: f.species, quality: f.quality, value: f.value(),
    })));
    g.debug?.addAction('basket.clear', () => { this.basket.items.length = 0; this.basket.massCarried = 0; });
  }

  /** Presentation class of whatever is in the player's hands right now. */
  get carryClass(): CarryClass {
    return this.carried?.cls ?? 'small';
  }

  // ---- per-frame ----------------------------------------------------------
  fixedStep(dt: number): void {
    const input = this.g.input.frame;
    const encounters = this.g.has('encounters') ? this.g.get<EncounterSystem>('encounters') : null;
    const vitals = this.g.has('vitals') ? this.g.get<PlayerVitals>('vitals') : null;
    const myId = this.net?.me || 'solo';
    const captured = !!encounters?.isCaptured(myId);
    if (captured && !vitals?.downed && this.g.player.state === 'active') this.g.player.state = 'captured';
    if (!captured && this.g.player.state === 'captured') this.g.player.state = vitals?.downed ? 'downed' : 'active';
    this.sellCooldown = Math.max(0, this.sellCooldown - dt);
    this.refreshCarryClass();
    this.updateTarget();
    this.updateSellPad(dt);

    if (this.g.player.state === 'captured') {
      this.promptText = '<b>Hold E</b> to pry open Snapjaw';
      if (input.interact && this.g.clock.elapsed - this.lastEscapeRequest > 0.18) {
        encounters?.tryEscape(myId);
        this.lastEscapeRequest = this.g.clock.elapsed;
      }
      return;
    }

    if (this.g.player.state !== 'active') {
      if (this.revivingPeer) { this.net?.requestRevive(this.revivingPeer, false); this.revivingPeer = null; }
      // A short slapstick ragdoll drops the item. A serious downed state keeps
      // the haul available for rescue; only evacuation forfeits it.
      if (this.g.player.state === 'ragdoll' && this.carried) this.dropHeld(true);
      return;
    }

    const snapjaw = encounters?.snapshot().encounters.find(e => e.kind === 'snapjaw');
    const captiveId = snapjaw?.capturedVictimId;
    const captive = captiveId && captiveId !== myId ? this.net?.nearbyCaptured(captiveId) : null;
    if (captive) {
      this.promptText = `<b>E</b> Free ${captive.name} from Snapjaw`;
      if (input.interactPressed) { encounters?.tryRescue(captive.id, myId); return; }
    }
    const downed = !captive ? this.net?.nearbyDowned() : null;
    if (downed) this.promptText = `<b>Hold E</b> Revive ${downed.name}`;
    const nextRevive = downed && input.interact ? downed.id : null;
    if (this.revivingPeer !== nextRevive) {
      if (this.revivingPeer) this.net?.requestRevive(this.revivingPeer, false);
      if (nextRevive) this.net?.requestRevive(nextRevive, true);
      this.revivingPeer = nextRevive;
    }
    if (nextRevive) return;

    this.catchStickyHits();
    if (input.interactPressed) this.tryInteract();
    // The mouse buttons belong to the equipped tool (ToolInventory routes them);
    // this system only owns E, and the state of what is in your hands.
    if (!this.carried) this.throwCharge = 0;

    this.g.player.carryLoad = (this.carried?.heavy ? this.carried.fruit.mass : 0)
      + this.basket.massCarried * 0.25;
  }

  frameUpdate(dt: number): void {
    this.updateHeldTransform(dt);
    this.g.bus.emit('ui:prompt', { text: this.promptText, priority: 'action' });
  }

  /**
   * Fruit does not stay the size it was when you picked it up.
   *
   * A Puff Melon triples in diameter in about two thirds of a second, and it
   * starts doing that the instant it leaves the bush — which is to say, in your
   * hands. The old code had no opinion about this at all: the fruit simply kept
   * growing at the hold point until a 1.7 m sphere contained the camera.
   *
   * One guard, checked every step, covers every way a carried thing can change
   * size — inflation now, and whatever grows or shrinks later — rather than one
   * special case per trait.
   */
  private refreshCarryClass(): void {
    const c = this.carried;
    // The local player's carried fruit is drawn by the first-person rig, not by
    // the world batch. Remote clients still get it at true size and position.
    this.fruitSys.renderer.hiddenId = c ? c.fruit.id : -1;
    if (!c) return;
    const f = c.fruit;
    if (!canHandCarry(f.diameter, f.mass)) { this.escapeFromHands(f); return; }
    c.cls = carryClassFor(f.diameter, f.mass);
  }

  /**
   * Hand it back to the world, safely.
   *
   * "Safely" is doing real work here: the fruit was being drawn 0.7 m from the
   * eye and is now, say, 1.7 m across, so releasing it in place would spawn a
   * body overlapping the player capsule and the solver would answer by firing
   * one of them across the island. It goes out in front, above the ground, with
   * a shove — which also happens to be the funniest reading of the event.
   */
  private escapeFromHands(f: Fruit): void {
    const p = this.g.player;
    p.lookDir(_dir);
    _dir.y = 0;
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1);
    _dir.normalize();
    // Generous: a body that spawns even slightly inside the player capsule is
    // resolved by the solver, and the solver's idea of "resolved" for a 1.7 m
    // ball against a person is to fire one of them across the island.
    const clearance = PLAYER_RADIUS + f.radius + 0.9;
    // …and into ROOM. Handed back straight ahead regardless, a melon that
    // inflated beside an apple tree went into the canopy and sat there
    // touching two trunks and two attached apples at once — a cage of fixed
    // colliders the solver cannot push a ball out of — at 78% of the frame,
    // going nowhere. Each candidate spot is checked two ways, because each
    // check is blind to something: the ray misses thin trunks beside its
    // line and the sphere overlap only sees colliders that have an owner.
    // Ahead, behind, either side; failing all of those, straight up.
    _eye.copy(p.eyePosition);
    let found = false;
    for (const turn of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
      _v2.copy(_dir).applyAxisAngle(UP_AXIS, turn);
      if (this.g.physics.raycast(_eye, _v2, clearance + f.radius, QueryMask.solid, p.body)) continue;
      _hold.copy(_eye).addScaledVector(_v2, clearance);
      const g = this.world.terrain.height(_hold.x, _hold.z) + f.radius + 0.08;
      if (_hold.y < g) _hold.y = g;
      if (!this.roomFor(f, _hold)) continue;
      _dir.copy(_v2);
      f.position.copy(_hold);
      found = true;
      break;
    }
    if (!found) {
      _dir.set(0, 0, 0);
      f.position.copy(_eye);
      f.position.y += f.radius + 0.6;
    }
    const ground = this.world.terrain.height(f.position.x, f.position.z) + f.radius + 0.08;
    if (f.position.y < ground) f.position.y = ground;
    // UP, hard, and away. Handing a 1.1 m ball back to the world 1.3 m from the
    // eye and letting it drift is just the original bug with extra steps: it
    // fills the frame for as long as it takes to fall. It has to LEAVE, and a
    // balloon bursting upward out of your arms is also the funnier reading.
    _v.copy(p.velocity).multiplyScalar(0.5).addScaledVector(_dir, 3.0);
    _v.y += 6.5;
    // Restart the escape clock so the buoyancy trait gives it the full 2.4 g of
    // lift it gives a fruit that has just come off the bush. Without this a
    // melon that spent ten seconds in your hands escapes with no escape in it.
    f.detachedAt = this.g.clock.elapsed;
    this.letGo(f, _v);
    // Newton gets a say: shoving a melon off your chest shoves you too.
    p.velocity.addScaledVector(_dir, -1.6);
    this.carried = null;
    this.throwCharge = 0;
    this.handLag.set(0, 0, 0);
    this.handLagVel.set(0, 0, 0);
    this.handLagView.set(0, 0, 0);
    this.fruitSys.renderer.hiddenId = -1;
    this.g.playerCamera.addRecoil(0, -0.03);
    this.g.playerCamera.addShake(0.02, 0.4, 22);
    this.g.bus.emit('audio:sfx', {
      name: 'throw', volume: 0.55, pitch: 0.7, position: f.position.clone(),
    });
    this.g.bus.emit('ui:toast', {
      text: `${f.displayName} got away from you`,
      sub: `${f.diameter.toFixed(1)} m across — rope it, net it, or shove it home`,
      kind: 'bad', ms: 2600,
    });
  }

  /** Is there nothing but air (and the player) where this fruit would go? */
  private roomFor(f: Fruit, at: THREE.Vector3): boolean {
    const hits = this.g.physics.overlapSphere(at, f.radius + 0.15, QueryMask.anything, _overlap);
    for (const o of hits) {
      if (o === f || o.kind === 'player' || o.kind === 'ragdoll') continue;
      return false;
    }
    return true;
  }

  /**
   * Push something you cannot lift.
   *
   * The recovery path for oversized fruit has to exist or "you cannot pick that
   * up" is just a wall. The impulse lands ABOVE the centre, so a round fruit
   * topples into a roll rather than skating, and it scales down with mass so a
   * 370 kg melon takes real work while an inflated Puff Melon goes bounding.
   */
  shove(f: Fruit): boolean {
    const p = this.g.player;
    if (this.net && !this.net.authoritative) {
      // A shove is a change to a body the host is simulating, so it goes over
      // as an intent. The camera kick and the thud still fire locally, because
      // both are presentation and neither can be wrong.
      p.lookDir(_dir);
      _dir.y = clamp(_dir.y, -0.25, 0.12);
      _dir.normalize();
      this.net.requestShove(f.id, _dir);
      this.g.playerCamera.addRecoil(0, -0.014);
      this.g.playerCamera.addShake(0.010, 0.22, 20);
      return true;
    }
    if (f.state === 'attached') this.fruitSys.detach(f, 'shove', p.id);
    p.lookDir(_dir);
    _dir.y = clamp(_dir.y, -0.25, 0.12);
    _dir.normalize();
    if (!this.applyShove(f, _dir, p.id)) return false;
    this.g.playerCamera.addRecoil(0, -0.014);
    this.g.playerCamera.addShake(0.010, 0.22, 20);
    this.g.bus.emit('fruit:grabbed', {
      fruitId: f.id, species: f.species, mass: f.mass, heavy: true,
    });
    return true;
  }

  /**
   * The world half of a shove: the impulse and the thud, with no camera in it.
   *
   * Shared with the host's handler for a remote peer's shove intent. The one
   * implementation matters more than it looks — the first version of the
   * remote path re-derived the impulse from memory, lost the lower clamp and
   * the off-centre application point, and so a melon shoved by a client
   * skated instead of toppling into a roll while the host's own shoves rolled
   * correctly. Two implementations of one rule is two rules.
   */
  applyShove(f: Fruit, dir: THREE.Vector3, byPlayerId = -1): boolean {
    if (f.state !== 'free' || !f.body) return false;
    // Leaning on a gluefruit peels it off whatever it was stuck to.
    if (f.stuck) f.unstick();
    // A person puts a bounded amount of push into a shove; heavier things just
    // move less. sqrt keeps a 370 kg melon budgeable rather than immovable.
    const power = clamp(26 * Math.sqrt(Math.max(1, f.mass)) * 0.55, 18, 420);
    _v.copy(dir).multiplyScalar(power);
    // ABOVE the centre and behind it, so a round fruit topples into a roll
    // rather than skating away flat.
    _v2.copy(f.position);
    _v2.y += f.radius * 0.55;
    _v2.addScaledVector(dir, -f.radius * 0.6);
    f.body.applyImpulseAtPoint({ x: _v.x, y: _v.y, z: _v.z },
      { x: _v2.x, y: _v2.y, z: _v2.z }, true);
    f.lastToucherId = byPlayerId;
    this.g.bus.emit('audio:sfx', {
      name: 'thud', volume: 0.42, pitch: clamp(1.2 / Math.pow(Math.max(0.5, f.mass), 0.22), 0.5, 1.2),
      position: f.position.clone(),
    });
    return true;
  }

  // ---- targeting ----------------------------------------------------------
  private updateTarget(): void {
    const p = this.g.player;
    _eye.copy(p.eyePosition);
    p.lookDir(_dir);
    this.target = null;
    this.targetKind = null;
    this.targetPlantId = -1;
    this.fruitSys.renderer.highlightId = -1;

    // Selling wins over picking when you are standing on the pad with goods.
    if (this.nearSellPad && (this.basket.items.length > 0 || this.carried)) {
      this.targetKind = 'sell';
      const n = this.basket.items.length + (this.carried ? 1 : 0);
      const value = this.basketValue() + (this.carried ? this.carried.fruit.value() : 0);
      this.promptText = `<b>E</b> Sell ${n} fruit — <b>$${value}</b>`;
      return;
    }

    // Big fruit needs a wider reach: standing far enough back to see a 1.7 m
    // Puff Melon at all already puts its surface outside a 3.4 m grab.
    const f = this.fruitSys.lookTarget(_eye, _dir, REACH + 1.6, 13);
    if (f && (f.state === 'attached' || f.state === 'free')
      && _eye.distanceTo(f.position) - f.radius < REACH) {
      this.target = f;
      this.fruitSys.renderer.highlightId = f.id;
      const q = f.damage > 0.001 ? ` <b>${f.quality}</b>` : '';
      if (f.hasTrait('spiked')) {
        // The prompt is the whole lesson: the verb is missing on purpose.
        this.targetKind = 'spiky';
        this.promptText = `${f.displayName} — <b>too spiky to hold</b> · net it, rope it or blast it`;
        return;
      }
      if (!canHandCarry(f.diameter, f.mass)) {
        // Naming the obstacle is what turns "the button does nothing" into a
        // puzzle. It is also the only place the game ever teaches that shoving
        // is a thing you can do.
        this.targetKind = 'shove';
        this.promptText = `<b>E</b> Shove ${f.displayName} — <b>too big to carry</b>`;
        return;
      }
      this.targetKind = 'fruit';
      const verb = f.state === 'attached' ? 'Pick' : 'Grab';
      this.promptText = `<b>E</b> ${verb} ${f.displayName}${q} — $${f.value()}`;
      return;
    }

    // Bare hands on a trunk still shakes it, just badly.
    const hit = this.g.physics.raycast(_eye, _dir, REACH, QueryMask.interact, p.body);
    if (hit?.owner?.kind === 'plant') {
      this.targetKind = 'shake';
      this.targetPlantId = hit.owner.id;
      this.promptText = '<b>E</b> Shake the tree';
      return;
    }

    this.promptText = null;
  }

  private updateSellPad(dt: number): void {
    const pad = this.world.sellPad;
    const r = this.world.sellRadius;
    const p = this.g.player.position;
    this.nearSellPad = Math.hypot(p.x - pad.x, p.z - pad.z) < r + 1.2
      && Math.abs(p.y - pad.y) < 4;

    // Fruit that comes to rest on the pad sells itself. This is what makes
    // firing produce at the shop from a hilltop a legitimate strategy.
    //
    // Host only. Every peer can see a melon land on the pad, and if every peer
    // banked it the island would pay out once per player — the plainest
    // duplicate payout there is.
    if (!this.fruitSys.authoritative) { this.padFruit.clear(); return; }
    const now = this.g.clock.elapsed;
    for (const f of this.fruitSys.fruits.values()) {
      if (f.state !== 'free') { this.padFruit.delete(f.id); continue; }
      const inside = Math.hypot(f.position.x - pad.x, f.position.z - pad.z) < r
        && f.position.y > pad.y - 1 && f.position.y < pad.y + 3.2;
      if (!inside) { this.padFruit.delete(f.id); continue; }
      if (f.speed > 1.4) { this.padFruit.set(f.id, now); continue; }
      const since = this.padFruit.get(f.id);
      if (since === undefined) { this.padFruit.set(f.id, now); continue; }
      if (now - since > 0.55) {
        this.padFruit.delete(f.id);
        // Landing produce in the drop-off under its own power is a stunt, not
        // an accident, and the scoring system should see it that way.
        if (this.g.has('scoring')) {
          this.g.get<{ awardDelivery(f: Fruit): void }>('scoring').awardDelivery(f);
        }
        this.sellFruit([f], 'delivered');
      }
    }
    void dt;
  }

  /**
   * A gluefruit that hits you is yours now.
   *
   * Detected here, on the peer that simulates the fruit: the host for its own
   * player, and (in `MultiplayerAuthority`) the host for everyone else's,
   * because a client's copy of a loose fruit has no body and no speed. The
   * claim goes through the ordinary pick path, so the ledger, the basket
   * rule and the "hands full" logic all apply exactly as they would to a
   * deliberate pick — it just was not deliberate.
   */
  private catchStickyHits(): void {
    if (!this.fruitSys.authoritative) return;
    const p = this.g.player;
    if (this.carried && this.carried.fruit.stuckHands > 0) return;
    const footY = p.position.y + PLAYER_RADIUS;
    const headY = p.position.y + Math.max(p.height - PLAYER_RADIUS, PLAYER_RADIUS + 0.01);
    for (const f of this.fruitSys.fruits.values()) {
      if (f.state !== 'free' || !f.body || f.stuck || !f.hasTrait('sticky')) continue;
      if (f.speed < 2.5) continue;
      const cy = clamp(f.position.y, footY, headY);
      const dx = f.position.x - p.position.x;
      const dy = f.position.y - cy;
      const dz = f.position.z - p.position.z;
      const reach = f.radius + PLAYER_RADIUS + 0.22;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      if (this.pickUp(f, 'stuck')) break;
    }
  }

  /**
   * Spikefruit and bare hands. The refusal is physical rather than textual:
   * a shove backwards, the hurt vignette, a yelp, and the one sentence that
   * names the tools that do work. It happens every time, because a player
   * who forgets should be reminded in the same voice.
   */
  private prick(f: Fruit): false {
    const p = this.g.player;
    this.pricks++;
    this.lastRefusal = 'spiky';
    _dir.copy(p.position).sub(f.position).setY(0);
    if (_dir.lengthSq() < 1e-4) p.lookDir(_dir).negate().setY(0);
    _dir.normalize();
    _v.copy(_dir).multiplyScalar(2.6);
    _v.y += 1.3;
    p.addImpulseVelocity(_v, false, 'spikefruit');
    // The bonk path already owns the camera, the vignette and the thud.
    this.g.bus.emit('player:hit', { momentum: 95, fromAbove: false, point: f.position.clone() });
    this.g.bus.emit('ui:toast', {
      text: 'OW', sub: `${f.displayName}. Net it, rope it, or blast it to the shed.`, kind: 'bad', ms: 2400,
    });
    // Leaning on it still moves it a little, the way leaning on anything does.
    if (f.state === 'free' && f.body) {
      f.applyImpulse(_v2.copy(_dir).multiplyScalar(-f.mass * 1.4).setY(f.mass * 0.6));
    }
    return false;
  }

  /** Something in the hands refuses to leave them. Says so, not too often. */
  private stuckRefusal(f: Fruit): void {
    const now = this.g.clock.elapsed;
    if (now - this.stuckToastAt < 0.7) return;
    this.stuckToastAt = now;
    this.g.playerCamera.addRecoil(0, -0.008);
    this.g.bus.emit('audio:sfx', { name: 'netCatch', volume: 0.3, pitch: 0.55 });
    this.g.bus.emit('ui:toast', {
      text: `${f.displayName} — it is not letting go`,
      sub: `${f.stuckHands.toFixed(1)} s`, kind: 'bad', ms: 1200,
    });
  }

  // ---- actions ------------------------------------------------------------
  tryInteract(): boolean {
    if (this.targetKind === 'sell') {
      const r = this.sellAll();
      return r.count > 0 || !!r.requested;
    }
    if (this.targetKind === 'spiky' && this.target) return this.prick(this.target);
    if (this.targetKind === 'shove' && this.target) return this.shove(this.target);
    if (this.targetKind === 'shake' && this.targetPlantId >= 0) {
      const dropped = this.fruitSys.shake(this.targetPlantId, 0.55, this.g.player.id);
      this.g.playerCamera.addShake(0.012, 0.28, 30);
      this.g.bus.emit('audio:sfx', { name: 'rustle', position: this.g.player.position.clone() });
      // A client's shake is a request; "nothing budged" is not ours to say.
      if (dropped === 0 && this.fruitSys.authoritative) {
        this.g.bus.emit('ui:toast', { text: 'Nothing budged', sub: 'You need a proper shaker', ms: 1600 });
      }
      return dropped > 0;
    }
    if (this.target) return this.pickUp(this.target);
    return false;
  }

  /**
   * Refuse a pick out loud. Both refusal paths — too big, and already
   * somebody else's — should thump rather than silently do nothing.
   */
  private refusePick(f: Fruit, reason: string, sub: string): false {
    this.lastRefusal = reason;
    this.g.playerCamera.addRecoil(0, -0.012);
    this.g.playerCamera.addShake(0.008, 0.2, 18);
    this.g.bus.emit('audio:sfx', {
      name: 'thud', volume: 0.3, pitch: 0.55, position: f.position.clone(),
    });
    this.g.bus.emit('ui:toast', {
      text: `${f.displayName} — ${reason}`, sub, kind: 'bad', ms: 2400,
    });
    return false;
  }

  pickUp(f: Fruit, cause: PickCause = 'hand'): boolean {
    // Re-picking what you are already holding would stow it and immediately
    // take it back out, which reads as "the pick key did nothing".
    if (this.carried?.fruit === f) return false;
    if (f.state === 'stowed' || f.state === 'gone') return false;
    // The two hand rules. A spikefruit is never touched; the net's hoop is
    // not a hand. And a gluefruit in the hands keeps them until it is done.
    if (cause !== 'net' && f.hasTrait('spiked')) return this.prick(f);
    if (this.carried && this.carried.fruit.stuckHands > 0) {
      return this.refusePick(f, 'hands full',
        `${this.carried.fruit.displayName} is stuck to you for ${this.carried.fruit.stuckHands.toFixed(1)} s`);
    }
    // Size is checked BEFORE the stem, so a Puff Melon that has already
    // inflated on the bush is refused rather than torn free and then dropped.
    if (!canHandCarry(f.diameter, f.mass)) {
      this.lastRefusal = refusalReason(f.diameter, f.mass);
      this.g.playerCamera.addRecoil(0, -0.012);
      this.g.playerCamera.addShake(0.008, 0.2, 18);
      this.g.bus.emit('audio:sfx', {
        name: 'thud', volume: 0.3, pitch: 0.55, position: f.position.clone(),
      });
      this.g.bus.emit('ui:toast', {
        text: `${f.displayName} — ${this.lastRefusal}`,
        sub: 'Shove it, rope it, net it or blast it home', kind: 'bad', ms: 2400,
      });
      // Refusing is not the same as doing nothing: leaning on it moves it.
      this.shove(f);
      return false;
    }
    // Bare hands only work on fruit that is ready to come off. Checked before
    // the claim, so a hopeless tug never books the fruit out to anybody.
    if (f.state === 'attached' && f.def.attachStrength > 6.0) {
      // A refusal is an interaction too: it should thump, not just print.
      this.g.bus.emit('audio:sfx', {
        name: 'stow', volume: 0.3, pitch: 0.5, position: f.position.clone(),
      });
      this.g.playerCamera.addRecoil(0, -0.008);
      this.g.bus.emit('ui:toast', {
        text: `${f.displayName} will not come loose`,
        sub: 'It needs proper equipment', kind: 'bad', ms: 2000,
      });
      return false;
    }
    // ---- authority: is this fruit mine to take? --------------------------
    //
    // On the host and in single player this reads the ledger and writes it.
    // On a client it sends a `pick` intent and returns `predict`: everything
    // below then runs LOCALLY so the fruit is in your hands on the frame the
    // key went down, and the host's answer either confirms that silently or
    // arrives as a `deny` that runs `forfeit` and takes it back out again.
    const claim = this.net ? this.net.requestPick(f, cause) : 'apply';
    if (claim === 'refuse') {
      return this.refusePick(f, 'someone else has it', 'Wait for them to put it down');
    }
    if (f.state === 'attached') {
      if (claim === 'predict') {
        // The stem is the host's to break. Locally we only take the fruit off
        // the branch so the hands have something in them; `requestPick` has
        // already remembered which node it came from, and a denial puts it
        // back on exactly that one.
        this.fruitSys.releaseAttachment(f);
      } else {
        this.fruitSys.detach(f, 'hand', this.g.player.id);
      }
      // The snap of a stem giving way. Bigger fruit lets go lower and harder.
      this.g.bus.emit('audio:sfx', {
        name: 'pick', position: f.position.clone(),
        volume: clamp(0.7 + f.mass * 0.05, 0.7, 1.1),
        pitch: clamp(1.35 / Math.pow(Math.max(0.4, f.mass), 0.26), 0.62, 1.35),
      });
      this.g.playerCamera.addRecoil(0, clamp(0.004 + f.mass * 0.0016, 0.004, 0.02));
    }
    // Make room: stow whatever is in hand if the basket will take it.
    if (this.carried) {
      if (!this.stowHeld()) {
        this.dropHeld();
      }
    }
    const from = _v2.copy(f.position);
    f.pickUp(this.g.player.id);
    this.carried = {
      fruit: f,
      heavy: f.mass > this.basket.maxItemMass,
      cls: carryClassFor(f.diameter, f.mass),
    };
    this.net?.noteCarry(f.id);
    this.lastRefusal = null;
    if (f.hasTrait('sticky')) {
      // The same numbers the host writes, so the two clocks agree.
      f.stuckHands = cause === 'stuck' ? STICK_HANDS_HIT : cause === 'net' ? 0 : STICK_HANDS_PICK;
      if (f.stuckHands > 0) {
        this.g.bus.emit('audio:sfx', { name: 'netCatch', volume: 0.45, pitch: 0.5, position: f.position.clone() });
        this.g.bus.emit('ui:toast', {
          text: cause === 'stuck' ? `${f.displayName} — it stuck to you` : `${f.displayName} — stuck to your hands`,
          sub: cause === 'stuck' ? 'You are holding it now. Nobody asked you.' : 'It comes off in a moment. Or at the shed.',
          kind: 'bad', ms: 2400,
        });
      }
    }
    this.holdPoint(this.lastHold, this.carried.heavy, f.radius);
    // Start the spring displaced by where the fruit actually was, so it flies
    // into the hand from the branch.
    this.handLag.copy(from).sub(this.lastHold);
    if (this.handLag.lengthSq() > 0.81) this.handLag.setLength(0.9);
    this.handLagVel.set(0, 0, 0);
    this.snap = 1;
    // Taking hold of something is an action, and it used to be a silent one:
    // grabbing loose fruit off the ground — the commonest thing you do after
    // a tree shake — made no sound and did not move the hands at all. Weight
    // rides on the pitch, so a coconut lands lower in the ear than an apple.
    this.g.bus.emit('fruit:grabbed', {
      fruitId: f.id, species: f.species, mass: f.mass, heavy: this.carried.heavy,
    });
    this.g.bus.emit('audio:sfx', {
      name: this.carried.heavy ? 'thud' : 'stow',
      volume: this.carried.heavy ? 0.34 : 0.5,
      pitch: clamp(1.5 / Math.pow(Math.max(0.4, f.mass), 0.3), 0.55, 1.5),
      position: f.position.clone(),
    });
    if (this.carried.heavy) {
      // Hoisting a two-hander is a physical event, not a notification.
      this.g.playerCamera.addRecoil(0, -0.022);
      this.g.playerCamera.addShake(0.012, 0.22, 18);
      this.g.bus.emit('ui:toast', {
        text: `${f.displayName} — ${f.mass.toFixed(1)} kg`,
        sub: 'Too big for the basket. Both hands.', ms: 2400,
      });
    }
    return true;
  }

  /** Put the held fruit in the basket. Returns false if it will not fit. */
  stowHeld(): boolean {
    if (!this.carried) return false;
    const f = this.carried.fruit;
    if (f.stuckHands > 0) { this.stuckRefusal(f); return false; }
    if (f.mass > this.basket.maxItemMass) return false;
    if (this.basket.items.length >= this.basket.capacity) {
      this.g.bus.emit('ui:toast', { text: 'Basket is full', kind: 'bad', ms: 1600 });
      return false;
    }
    // Evaluate before stowing: once stowed the fruit stops simulating and its
    // flight record can no longer be judged.
    if (this.g.has('scoring')) {
      this.g.get<{ evaluate(f: Fruit): void }>('scoring').evaluate(f);
    }
    f.stow();
    this.basket.items.push(f);
    this.basket.massCarried += f.mass;
    this.carried = null;
    this.net?.noteStow(f.id);
    this.g.bus.emit('fruit:stowed', { fruitId: f.id, species: f.species });
    this.g.bus.emit('audio:sfx', { name: 'stow' });
    return true;
  }

  /** Let go. `force` is for the moments the hands stop being yours: a
   *  knockdown, a reset. A gluefruit otherwise has a say in this. */
  dropHeld(force = false): void {
    if (!this.carried) return;
    const f = this.carried.fruit;
    if (!force && f.stuckHands > 0) { this.stuckRefusal(f); return; }
    if (force) f.stuckHands = 0;
    this.releasePoint(f);
    _v.copy(this.g.player.velocity).multiplyScalar(0.6);
    this.letGo(f, _v);
    this.carried = null;
  }

  /**
   * Hand a fruit back to the world.
   *
   * The one place a carried fruit turns back into a physical object, because
   * the authority rule for it is subtle enough to be worth stating once: the
   * HOST creates the body and simulates it; a client only changes what its
   * copy is called. A client that ran `release` would spawn a dynamic body the
   * host knows nothing about, simulate it against its own terrain, and then
   * fight the incoming snapshots for the next several seconds — two apples in
   * two places with one id, which is exactly the disagreement the host is
   * supposed to settle.
   */
  private letGo(f: Fruit, vel: THREE.Vector3, angular?: THREE.Vector3): void {
    this.net?.noteRelease(f.id, f.position, vel);
    if (this.fruitSys.authoritative) f.release(vel, angular);
    else this.fruitSys.applyRemoteState(f, 'free');
  }

  /**
   * Tip the basket out on the ground. Lives here rather than on the basket
   * tool so that emptying nine fruit into the world goes through the same
   * authority path as dropping one.
   */
  tipOutBasket(): number {
    const items = [...this.basket.items];
    if (!items.length) return 0;
    this.basket.items.length = 0;
    this.basket.massCarried = 0;
    const p = this.g.player;
    p.lookDir(_dir);
    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      const a = (i / items.length) * Math.PI * 2;
      f.position.copy(p.eyePosition)
        .addScaledVector(_dir, 1.1)
        .add(_v.set(Math.cos(a) * 0.35, -0.4 + i * 0.05, Math.sin(a) * 0.35));
      f.state = 'carried';                       // so release takes the normal path
      this.letGo(f, _v2.set(Math.cos(a) * 1.1, 0.6, Math.sin(a) * 1.1));
    }
    return items.length;
  }

  /**
   * Where a released fruit starts: where it was DRAWN, not the ideal hand
   * point. Now that heavy fruit trails the hands by up to a third of a metre,
   * releasing it from the ideal point pops it across that gap on the frame it
   * leaves your hands.
   */
  private releasePoint(f: Fruit): void {
    this.holdPoint(_hold, this.carried?.heavy ?? false, f.radius);
    f.position.copy(_hold).add(this.handLag);
    // …but never below the ground. Dropping a watermelon while looking at your
    // feet used to start it half-buried, and Rapier's answer to a body born
    // inside the terrain is to evict it at speed.
    const ground = this.world.terrain.height(f.position.x, f.position.z) + f.radius * 0.9;
    if (f.position.y < ground) f.position.y = ground;
  }

  throwHeld(power = 1): void {
    if (!this.carried) return;
    const f = this.carried.fruit;
    if (f.stuckHands > 0) { this.stuckRefusal(f); return; }
    this.releasePoint(f);
    // Heavier fruit leaves your hands slower. A watermelon is a shot put.
    //
    // The old curve saturated against its own upper clamp below about 3 kg, so
    // an apple, an orange and a banana bunch all left the hand at exactly
    // 21 m/s and the weight in the HUD was a lie. This one has no ceiling to
    // hit in the light range, so every species throws differently:
    //   orange 1.0 kg 21.0   apple 1.1 kg 20.0   banana 2.6 kg 12.4
    //   coconut 3.4 kg 10.7  watermelon 22 kg 4.7 (a shot put, as advertised)
    const base = 15.5 * clamp(1.35 / Math.pow(Math.max(0.35, f.mass), 0.55), 0.30, 1.45);
    this.g.player.lookDir(_dir);
    _v.copy(_dir).multiplyScalar(base * power);
    _v.y += 1.4 * power;
    _v.add(this.g.player.velocity);
    // Spin scales with how hard it was thrown; a lobbed melon should not
    // leave the hand rotating like a shuriken.
    const spin = 3 + power * 5 * clamp(2.5 / Math.max(0.5, f.mass), 0.3, 1.6);
    this.letGo(f, _v, _v2.set(
      (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin));
    this.carried = null;
    // Follow-through: heavier releases kick the view harder and lower.
    const heft = clamp(Math.pow(f.mass, 0.45) * 0.5, 0.4, 2.2);
    this.g.playerCamera.addRecoil((Math.random() - 0.5) * 0.012 * heft, 0.022 * power * heft);
    this.g.playerCamera.addShake(0.006 * power * heft, 0.18, 24);
    this.g.bus.emit('audio:sfx', {
      name: 'throw', volume: 0.45 + power * 0.55,
      pitch: clamp(1.45 / Math.pow(Math.max(0.4, f.mass), 0.28), 0.6, 1.45),
    });
    // A watermelon shot-put and a lobbed orange should not move the arms the
    // same amount; `heft` is already the measure of that.
    this.g.bus.emit('tool:fired', { toolId: 'hand', power: clamp(heft * power, 0.3, 1.8) });
  }

  // ---- selling ------------------------------------------------------------
  basketValue(): number {
    let v = 0;
    for (const f of this.basket.items) v += f.value();
    return v;
  }

  /**
   * Sell everything in the basket and in your hands.
   *
   * On a client this does NOT sell anything. It names the fruit ids it
   * believes it is holding and asks the host, which is the only correction
   * that matters in this whole pass: the old sell intent carried no ids at
   * all, so the host ran `sellAll()` on ITS OWN basket — the requesting client
   * kept its fruit, the host lost its own, and the money that appeared
   * belonged to neither of them.
   *
   * The sale is not predicted. Everything else here can be taken back
   * silently if the host disagrees; money cannot, and a basket that empties a
   * frame early buys nothing worth the risk of paying twice.
   */
  sellAll(): { count: number; total: number; requested?: boolean } {
    if (this.sellCooldown > 0) return { count: 0, total: 0 };
    const batch: Fruit[] = [...this.basket.items];
    if (this.carried) batch.push(this.carried.fruit);
    if (!batch.length) return { count: 0, total: 0 };
    this.sellCooldown = 0.25;
    if (this.net && !this.net.authoritative) {
      this.pendingSells++;
      this.net.requestSell(batch.map((f) => f.id));
      return { count: 0, total: 0, requested: true };
    }
    this.carried = null;
    this.basket.items.length = 0;
    this.basket.massCarried = 0;
    return this.sellFruit(batch, 'counter');
  }

  /**
   * The host has settled a sale we asked for: drop those fruit locally and let
   * the broadcast economy carry the money. Called only on a client.
   */
  settleSale(ids: number[], count: number, total: number, values: number[] = []): void {
    this.pendingSells = Math.max(0, this.pendingSells - 1);
    const sold = new Set(ids);
    // The harvest book listens for sales. On the host the economy emits
    // these; here the host's valuation arrives with the answer, so the
    // client's records grow by what it actually sold.
    ids.forEach((id, i) => {
      const f = this.fruitSys.get(id);
      if (!f) return;
      this.g.bus.emit('fruit:sold', {
        fruitId: id, species: f.species, value: values[i] ?? 0, quality: f.quality, mass: f.mass,
      });
    });
    if (this.carried && sold.has(this.carried.fruit.id)) this.carried = null;
    this.basket.items = this.basket.items.filter((f) => !sold.has(f.id));
    this.basket.massCarried = this.basket.items.reduce((m, f) => m + f.mass, 0);
    for (const id of ids) {
      const f = this.fruitSys.get(id);
      if (f) this.fruitSys.remove(f);
    }
    this.fruitSys.renderer.hiddenId = this.carried ? this.carried.fruit.id : -1;
    if (!count) return;
    this.g.bus.emit('audio:sfx', { name: 'sale' });
    this.g.bus.emit('ui:toast', {
      text: `Sold ${count} — $${total}`, sub: 'Paid into the shared pot', kind: 'gold', ms: 2600,
    });
  }

  /** Id of the fruit in the player's hands, or -1. Sent with every player packet. */
  get carriedId(): number { return this.carried?.fruit.id ?? -1; }

  /**
   * The host refused something we predicted. Give it back.
   *
   * This is the whole cost of predicting: for the ~30 ms it takes the host to
   * answer, two players can both believe they are holding the same apple. One
   * of them is wrong, and this is what being wrong looks like — the fruit
   * leaves your hands, the world state comes from the next snapshot, and you
   * are told why rather than watching it vanish.
   */
  forfeit(fruitId: number, why: string): void {
    let had = false;
    if (this.carried?.fruit.id === fruitId) { this.carried = null; had = true; }
    const i = this.basket.items.findIndex((f) => f.id === fruitId);
    if (i >= 0) {
      this.basket.massCarried = Math.max(0, this.basket.massCarried - this.basket.items[i].mass);
      this.basket.items.splice(i, 1);
      had = true;
    }
    this.fruitSys.renderer.hiddenId = this.carried ? this.carried.fruit.id : -1;
    this.handLag.set(0, 0, 0);
    this.handLagVel.set(0, 0, 0);
    this.handLagView.set(0, 0, 0);
    if (!had) return;
    const f = this.fruitSys.get(fruitId);
    this.g.bus.emit('audio:sfx', { name: 'thud', volume: 0.3, pitch: 0.5 });
    this.g.bus.emit('ui:toast', {
      text: f ? `${f.displayName} was not yours` : 'That one got away',
      sub: why, kind: 'bad', ms: 2200,
    });
  }

  /**
   * Make the local hands and basket agree with the host, quietly.
   *
   * Called for every fruit in every snapshot. `forfeit` is the loud version,
   * for the moment a request is refused; this is the backstop that runs
   * fifteen times a second and means no desync can survive longer than that,
   * whatever caused it — a dropped message, a rejoin, a host migration, a
   * prediction that was simply wrong.
   */
  reconcile(f: Fruit, state: Fruit['state'], mine: boolean): void {
    const inBasket = this.basket.items.indexOf(f);
    const inHand = this.carried?.fruit === f;
    if (!mine || state === 'gone' || state === 'free') {
      // Not ours (any more). Let go of the local copy; the world transform is
      // the host's business and the snapshot has already set it.
      if (inHand) this.carried = null;
      if (inBasket >= 0) this.basket.items.splice(inBasket, 1);
    } else if (state === 'carried') {
      if (inBasket >= 0) this.basket.items.splice(inBasket, 1);
      if (!inHand) {
        // Whatever displaced it locally is somebody else's story now.
        if (this.carried) this.carried = null;
        this.carried = {
          fruit: f, heavy: f.mass > this.basket.maxItemMass,
          cls: carryClassFor(f.diameter, f.mass),
        };
        this.holdPoint(this.lastHold, this.carried.heavy, f.radius);
        this.handLag.set(0, 0, 0);
        this.handLagVel.set(0, 0, 0);
        // A gluefruit the host put in our hands: the host saw it hit us.
        if (f.hasTrait('sticky') && f.stuckHands > 0) {
          this.g.bus.emit('audio:sfx', { name: 'netCatch', volume: 0.45, pitch: 0.5 });
          this.g.playerCamera.addRecoil(0, -0.02);
          this.g.bus.emit('ui:toast', {
            text: `${f.displayName} — it stuck to you`,
            sub: 'You are holding it now. Nobody asked you.', kind: 'bad', ms: 2400,
          });
        }
      }
    } else if (state === 'stowed') {
      if (inHand) this.carried = null;
      if (inBasket < 0) this.basket.items.push(f);
    }
    this.basket.massCarried = this.basket.items.reduce((m, x) => m + x.mass, 0);
    this.fruitSys.renderer.hiddenId = this.carried ? this.carried.fruit.id : -1;
  }

  /** The host refused a sale. Nothing was predicted, so nothing is undone. */
  saleRefused(why: string): void {
    this.pendingSells = Math.max(0, this.pendingSells - 1);
    this.g.bus.emit('ui:toast', { text: 'Sale refused', sub: why, kind: 'bad', ms: 2200 });
  }

  private sellFruit(batch: Fruit[], how: string): { count: number; total: number } {
    const scoring = this.g.has('scoring')
      ? this.g.get<{ multiplierFor(f: Fruit): number }>('scoring')
      : null;
    const result = this.economy.sell(batch, scoring ? (f) => scoring.multiplierFor(f) : undefined);
    // Tombstone them on the way out, so no snapshot still in flight — ours or
    // anyone's — can put a sold fruit back on the island.
    this.net?.noteSold(batch.map((f) => f.id));
    for (const f of batch) this.fruitSys.remove(f);
    this.g.bus.emit('audio:sfx', { name: 'sale' });
    const best = result.lines.reduce((a, b) => (b.total > a.total ? b : a), result.lines[0]);
    // Say what the stunts were worth. A bonus the player cannot see is a
    // bonus that does not exist, and "+$41 from stunts" is the line that
    // makes someone try the stupid route again on the next load.
    const bonus = result.stuntBonus > 0 ? ` &nbsp;<b>+$${result.stuntBonus} stunts</b>` : '';
    this.g.bus.emit('ui:toast', {
      text: `Sold ${result.count} — $${result.total}`,
      sub: (result.count > 1 ? `Best: ${best.displayName} $${best.total}` : `${best.quality} · ${best.mass} kg`) + bonus,
      kind: 'gold', ms: 2600,
    });
    void how;
    return { count: result.count, total: result.total };
  }

  // ---- held-item presentation --------------------------------------------
  /**
   * Where the WORLD copy of a carried fruit sits.
   *
   * Note what this is and is not. It is not framing — the first-person view
   * draws its own proxy and ignores this entirely. It is the honest position of
   * a real object: what other players see you holding, and where the thing
   * starts from when you let go. So the only rule it has to obey is that the
   * fruit never intersects the player who is holding it, which for anything
   * bigger than a coconut means standing it off further than an apple.
   */
  private holdPoint(out: THREE.Vector3, heavy: boolean, radius = 0.2): THREE.Vector3 {
    const p = this.g.player;
    p.lookDir(_dir);
    const dist = Math.max(heavy ? 1.15 : 0.85, PLAYER_RADIUS + radius + 0.28);
    const drop = heavy ? -0.45 : -0.18;
    const side = heavy ? 0 : 0.28;
    out.copy(p.eyePosition).addScaledVector(_dir, dist);
    p.right(_v);
    out.addScaledVector(_v, side);
    out.y += drop;
    return out;
  }

  private updateHeldTransform(dt: number): void {
    if (!this.carried) { this.handLagView.set(0, 0, 0); return; }
    const f = this.carried.fruit;
    this.holdPoint(_hold, this.carried.heavy, f.radius);

    // A spring between the hands and the fruit, softened by mass.
    //
    // This is the only place a player can FEEL what a fruit weighs while
    // walking around with it, so the numbers matter: an apple is stiff enough
    // to look glued to the hands, a 22 kg watermelon swings a fifth of a metre
    // wide of a turn and takes a beat to catch up. The offset is `fruit minus
    // hands`: moving the hands displaces it, the spring pulls it back.
    //
    // (An earlier version computed this offset and then never added it to the
    // fruit, which is why every species used to carry like the same
    // polystyrene prop no matter what the HUD said it weighed.)
    const stiff = clamp(105 / (1 + f.mass * 0.55), 11, 95);
    const damping = 2 * Math.sqrt(stiff) * 0.78;
    // This runs on the RENDER step, whose dt is whatever the frame took. An
    // explicit spring integrated over a 200 ms hitch explodes; clamping the
    // step just makes the fruit catch up a frame later, which nobody sees.
    const h = Math.min(dt, 1 / 30);
    _v.copy(_hold).sub(this.lastHold);
    this.lastHold.copy(_hold);
    this.handLag.sub(_v);
    this.handLagVel.addScaledVector(this.handLag, -stiff * h);
    this.handLagVel.multiplyScalar(Math.exp(-damping * h));
    this.handLag.addScaledVector(this.handLagVel, h);
    // Cap the swing so a heavy fruit stays in frame rather than orbiting.
    // The cap opens up briefly at the moment of the pick so the fruit visibly
    // springs off the branch into the hand instead of teleporting there: the
    // detach snap is the whole physical read of "I took that".
    this.snap = Math.max(0, this.snap - dt * 4.5);
    const swing = clamp(0.05 + f.mass * 0.012, 0.05, 0.32) + this.snap * 0.75;
    if (this.handLag.lengthSq() > swing * swing) this.handLag.setLength(swing);

    const p = this.g.player;
    const bobAmp = this.carried.heavy ? 0.055 : 0.03;
    this.handSway.set(
      Math.sin(p.bobPhase) * bobAmp * 0.5,
      Math.abs(Math.cos(p.bobPhase)) * bobAmp,
      0,
    );
    f.position.copy(_hold).add(this.handSway).add(this.handLag);
    // Heavy things sag in the hands rather than floating at hand height.
    f.position.y -= clamp(f.mass * 0.0045, 0, 0.10);
    // Charging a throw pulls the fruit back and up.
    if (this.throwCharge > 0.01) {
      p.lookDir(_dir);
      f.position.addScaledVector(_dir, -this.throwCharge * 0.35);
      f.position.y += this.throwCharge * 0.18;
    }
    _e.set(p.pitch * 0.35, p.yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    f.quaternion.slerp(_q, Math.min(1, dt * 9));

    // Resolve the world swing into camera axes for the first-person rig. Doing
    // it here rather than in the viewmodel keeps one definition of "how far the
    // fruit is trailing the hands", which is the number `feel.mjs carry` reads.
    p.lookDir(_dir);
    p.right(_v);
    _v2.crossVectors(_v, _dir).normalize();          // right x forward = up
    this.handLagView.set(
      this.handLag.dot(_v), this.handLag.dot(_v2), -this.handLag.dot(_dir));
  }

  get throwPower(): number { return this.throwCharge; }
}

const _v2 = new THREE.Vector3();
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const _overlap: import('@/physics/PhysicsWorld').PhysicsOwner[] = [];
