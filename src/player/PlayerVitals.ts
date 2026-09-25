import type { Game, System } from '@/core/Game';

export type VitalsMode = 'solo' | 'coop';

export interface PlayerVitalsOptions {
  mode?: VitalsMode;
  /** The host owns ordinary damage/healing and co-op revive progress. */
  authoritative?: boolean;
  maxHealth?: number;
  soloRecoverySeconds?: number;
  reviveSeconds?: number;
  bleedoutSeconds?: number;
  /** Clear only held fruit and basket contents. Never touch gear or banked money. */
  onLoseUnsecured?: (source: string) => void;
  /** Called once when this local player evacuates after a failed revive. */
  onWipe?: () => void;
  /** The caller chooses and applies a safe position; this never charges a penalty. */
  onGeometryRescue?: () => void;
}

export interface PlayerVitalsNetState {
  revision: number;
  health: number;
  maxHealth: number;
  downed: boolean;
  wiped: boolean;
  reviveProgress: number;
  soloRecoveryRemaining: number;
  bleedoutRemaining: number;
  lastDamageSource: string;
}

/**
 * Local-player failure state. The boss/host decides which attacks land and when
 * the team has failed; this system owns only this player's health and recovery.
 *
 * A client must call applyHostAttack for a host-approved hit. Its local fruit or
 * physics callbacks must not call damage, or every peer could apply the same hit.
 * Absolute net snapshots reconcile the client after packet delay/reordering.
 */
export class PlayerVitals implements System {
  readonly name = 'vitals';
  readonly maxHealth: number;
  readonly soloRecoverySeconds: number;
  readonly reviveSeconds: number;
  readonly bleedoutSeconds: number;

  mode: VitalsMode;
  authoritative: boolean;
  health: number;
  downed = false;
  wiped = false;
  reviveProgress = 0;
  soloRecoveryRemaining = 0;
  bleedoutRemaining = 0;
  /** One field self-recovery gives solo players time to learn an attack. */
  soloRecoveries = 0;
  lastDamageSource = '';

  private g: Game | null = null;
  private offRecovered: (() => void) | null = null;
  private reviverId: string | null = null;
  private revision = 0;
  private lastAppliedNetRevision = -1;
  private seenHostAttacks = new Set<string>();
  private hostAttackOrder: string[] = [];
  private readonly options: PlayerVitalsOptions;

  constructor(options: PlayerVitalsOptions = {}) {
    this.options = options;
    this.mode = options.mode ?? 'solo';
    this.authoritative = options.authoritative ?? true;
    this.maxHealth = finitePositive(options.maxHealth, 100);
    this.health = this.maxHealth;
    this.soloRecoverySeconds = finitePositive(options.soloRecoverySeconds, 3);
    this.reviveSeconds = finitePositive(options.reviveSeconds, 3);
    this.bleedoutSeconds = finitePositive(options.bleedoutSeconds, 15);
  }

  init(g: Game): void {
    this.g = g;
    // A ragdoll can finish after the attack that downed the player and its
    // recovery method sets the controller active. Reassert immediately, before
    // the next player.step can accept input.
    this.offRecovered = g.bus.on('player:recovered', () => {
      if (this.downed) this.syncPlayerState();
    });
    g.debug?.addProbe('vitals', () => ({
      health: this.health,
      maxHealth: this.maxHealth,
      downed: this.downed,
      wiped: this.wiped,
      reviveProgress: this.reviveProgress,
      soloRecoveryRemaining: this.soloRecoveryRemaining,
      bleedoutRemaining: this.bleedoutRemaining,
      source: this.lastDamageSource,
      authoritative: this.authoritative,
    }));
  }

  dispose(): void {
    this.offRecovered?.();
    this.offRecovered = null;
  }

  setAuthority(authoritative: boolean): void {
    this.authoritative = authoritative;
    if (!authoritative) this.setReviveAttempt(null);
  }

  /** Host/offline damage. Returns true only when health actually changed. */
  damage(amount: number, source: string): boolean {
    if (!this.authoritative) return false;
    return this.applyDamage(amount, source);
  }

  /**
   * Explicit host-approved hit for a client. Pass a stable eventId if the
   * transport may deliver the same attack twice. The host is responsible for
   * deciding hit/collision once; this method does no attack detection.
   */
  applyHostAttack(amount: number, source: string, eventId?: string): boolean {
    if (this.authoritative) return false;
    if (eventId && this.seenHostAttacks.has(eventId)) return false;
    const changed = this.applyDamage(amount, source);
    if (changed && eventId) this.rememberHostAttack(eventId);
    return changed;
  }

  private applyDamage(amount: number, source: string): boolean {
    if (!Number.isFinite(amount) || amount <= 0 || this.downed || this.wiped) return false;
    const next = Math.max(0, this.health - amount);
    if (next === this.health) return false;
    this.health = next;
    this.lastDamageSource = source;
    this.revision++;
    if (next === 0) this.enterDowned();
    return true;
  }

  /** Positive healing for an active host/offline player; revival is separate. */
  heal(amount: number): number {
    if (!this.authoritative || !Number.isFinite(amount) || amount <= 0 || this.downed || this.wiped) return 0;
    const healed = Math.min(amount, this.maxHealth - this.health);
    if (healed > 0) {
      this.health += healed;
      this.revision++;
    }
    return healed;
  }

  private enterDowned(): void {
    this.downed = true;
    this.reviveProgress = 0;
    this.reviverId = null;
    this.soloRecoveryRemaining = this.mode === 'solo' && this.soloRecoveries === 0
      ? this.soloRecoverySeconds : 0;
    this.bleedoutRemaining = this.mode === 'coop' ? this.bleedoutSeconds
      : this.soloRecoveries > 0 ? this.soloRecoverySeconds : 0;
    this.syncPlayerState();
    this.g?.bus.emit('player:downed', { playerId: this.g.player.id });
  }

  /** Called with the current in-range, held-interact teammate, or null. */
  setReviveAttempt(byId: string | null): void {
    const next = this.authoritative && this.mode === 'coop' && this.downed && !this.wiped
      && typeof byId === 'string' && byId.length > 0 ? byId : null;
    if (next === this.reviverId) return;
    this.reviverId = next;
    this.reviveProgress = 0;
    this.revision++;
  }

  fixedStep(dt: number): void {
    if (!this.authoritative || !this.downed || this.wiped || !Number.isFinite(dt) || dt <= 0) return;
    // PlayerRagdoll may end a tumble and set the controller active mid-down;
    // reassert this state until the explicit recovery/evacuation transition.
    this.syncPlayerState();
    if (this.mode === 'solo') {
      if (this.soloRecoveries > 0) {
        this.bleedoutRemaining = Math.max(0, this.bleedoutRemaining - dt);
        this.revision++;
        if (this.bleedoutRemaining <= 1e-6) this.evacuate();
        return;
      }
      this.soloRecoveryRemaining = Math.max(0, this.soloRecoveryRemaining - dt);
      this.revision++;
      if (this.soloRecoveryRemaining <= 1e-6) this.revive();
      return;
    }
    if (this.reviverId !== null) {
      this.reviveProgress = Math.min(1, this.reviveProgress + dt / this.reviveSeconds);
      if (this.reviveProgress >= 1) {
        this.revive(this.reviverId);
        return;
      }
    }
    this.bleedoutRemaining = Math.max(0, this.bleedoutRemaining - dt);
    this.revision++;
    if (this.bleedoutRemaining <= 1e-6) this.evacuate();
  }

  /** Successful solo recovery or completed teammate revive preserves the haul. */
  revive(byId = String(this.g?.player.id ?? 'self')): boolean {
    if (!this.authoritative || !this.downed || this.wiped) return false;
    this.downed = false;
    this.health = Math.max(1, Math.round(this.maxHealth * 0.5));
    this.soloRecoveryRemaining = 0;
    this.bleedoutRemaining = 0;
    this.reviveProgress = 0;
    this.reviverId = null;
    if (this.mode === 'solo') this.soloRecoveries++;
    this.revision++;
    this.syncPlayerState();
    this.g?.bus.emit('player:revived', { playerId: this.g.player.id, byId });
    return true;
  }

  /** Failed revive/team wipe. The integration callback clears unsecured haul. */
  evacuate(): boolean {
    if (!this.authoritative || this.wiped) return false;
    if (!this.downed) {
      this.health = 0;
      this.enterDowned();
    }
    this.wiped = true;
    this.soloRecoveryRemaining = 0;
    this.bleedoutRemaining = 0;
    this.reviveProgress = 0;
    this.reviverId = null;
    this.revision++;
    this.options.onLoseUnsecured?.(this.lastDamageSource);
    this.options.onWipe?.();
    return true;
  }

  /** Explicit checkpoint return after evacuation; leaves money and gear alone. */
  restoreAtCheckpoint(): void {
    const wasDown = this.downed;
    this.health = this.maxHealth;
    this.downed = false;
    this.wiped = false;
    this.reviveProgress = 0;
    this.soloRecoveryRemaining = 0;
    this.bleedoutRemaining = 0;
    this.reviverId = null;
    this.soloRecoveries = 0;
    this.revision++;
    this.syncPlayerState();
    if (wasDown) this.g?.bus.emit('player:revived', {
      playerId: this.g.player.id, byId: String(this.g.player.id),
    });
  }

  /** Free relocation for clipping/stuck geometry, available only while active. */
  rescueFromGeometry(): boolean {
    if (this.downed || this.wiped) return false;
    this.options.onGeometryRescue?.();
    return true;
  }

  serializeNetState(): PlayerVitalsNetState {
    return {
      revision: this.revision,
      health: this.health,
      maxHealth: this.maxHealth,
      downed: this.downed,
      wiped: this.wiped,
      reviveProgress: this.reviveProgress,
      soloRecoveryRemaining: this.soloRecoveryRemaining,
      bleedoutRemaining: this.bleedoutRemaining,
      lastDamageSource: this.lastDamageSource,
    };
  }

  /** Client reconciliation. Stale snapshots never roll health or recovery back. */
  applyNetState(state: PlayerVitalsNetState): boolean {
    if (this.authoritative || !Number.isInteger(state.revision)
      || state.revision <= this.lastAppliedNetRevision || !Number.isFinite(state.health)) return false;
    const wasDown = this.downed;
    const wasWiped = this.wiped;
    this.lastAppliedNetRevision = state.revision;
    this.revision = Math.max(this.revision, state.revision);
    this.health = clamp(state.health, 0, this.maxHealth);
    this.wiped = Boolean(state.wiped);
    this.downed = Boolean(state.downed) || this.wiped || this.health === 0;
    this.reviveProgress = this.downed && !this.wiped ? clampFinite(state.reviveProgress, 0, 1) : 0;
    this.soloRecoveryRemaining = this.downed && !this.wiped
      ? clampFinite(state.soloRecoveryRemaining, 0, this.soloRecoverySeconds) : 0;
    this.bleedoutRemaining = this.downed && !this.wiped
      ? clampFinite(state.bleedoutRemaining, 0, this.bleedoutSeconds) : 0;
    this.lastDamageSource = typeof state.lastDamageSource === 'string' ? state.lastDamageSource : '';
    this.syncPlayerState();
    if (!wasDown && this.downed) this.g?.bus.emit('player:downed', { playerId: this.g.player.id });
    if (wasDown && !this.downed) this.g?.bus.emit('player:revived', {
      playerId: this.g.player.id, byId: String(this.g.player.id),
    });
    if (!wasWiped && this.wiped) this.options.onLoseUnsecured?.(this.lastDamageSource);
    return true;
  }

  private syncPlayerState(): void {
    if (!this.g) return;
    if (this.downed) this.g.player.state = 'downed';
    else if (this.g.player.state === 'downed') this.g.player.state = 'active';
  }

  private rememberHostAttack(eventId: string): void {
    this.seenHostAttacks.add(eventId);
    this.hostAttackOrder.push(eventId);
    if (this.hostAttackOrder.length > 128) {
      const old = this.hostAttackOrder.shift();
      if (old) this.seenHostAttacks.delete(old);
    }
  }
}

function finitePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function clampFinite(value: number, lo: number, hi: number): number {
  return Number.isFinite(value) ? clamp(value, lo, hi) : lo;
}
