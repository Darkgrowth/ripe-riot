/** Host-side replay and cadence gate for player melee swings. */
export type MeleeIntentResult = {
  ok: boolean;
  reason: 'accepted' | 'invalid-id' | 'stale' | 'cadence' | 'inactive';
};

interface PeerSwingState {
  highestId: number;
  lastAcceptedAt: number;
}

const MIN_SWING_GAP = 0.28;

export class MeleeIntentGuard {
  private readonly peers = new Map<string, PeerSwingState>();

  accept(peerId: string, swingId: number, hostTime: number, active: boolean): MeleeIntentResult {
    if (typeof peerId !== 'string' || !peerId.trim()
      || !Number.isSafeInteger(swingId) || swingId < 1
      || !Number.isFinite(hostTime) || hostTime < 0) {
      return { ok: false, reason: 'invalid-id' };
    }

    const previous = this.peers.get(peerId);
    if (previous && swingId <= previous.highestId) return { ok: false, reason: 'stale' };

    // Even a rejected swing consumes its ID: retrying it after recovery must
    // not turn an old request into another damaging hit.
    const state = previous ?? { highestId: 0, lastAcceptedAt: -Infinity };
    state.highestId = swingId;
    this.peers.set(peerId, state);

    if (!active) return { ok: false, reason: 'inactive' };
    if (hostTime - state.lastAcceptedAt < MIN_SWING_GAP)
      return { ok: false, reason: 'cadence' };

    state.lastAcceptedAt = hostTime;
    return { ok: true, reason: 'accepted' };
  }

  clearPeer(peerId: string): void { this.peers.delete(peerId); }
  clear(): void { this.peers.clear(); }
}

/** Check a client's proposed strike origin against its latest reported eye. */
export function validMeleeOrigin(origin: [number, number, number],
  actorPosition: [number, number, number], eyeHeight: number): boolean {
  if (!Array.isArray(origin) || origin.length !== 3
    || !Array.isArray(actorPosition) || actorPosition.length !== 3
    || !origin.every(Number.isFinite) || !actorPosition.every(Number.isFinite)
    || !Number.isFinite(eyeHeight) || eyeHeight <= 0) return false;

  return Math.hypot(origin[0] - actorPosition[0], origin[2] - actorPosition[2]) <= 1.3
    && Math.abs(origin[1] - actorPosition[1] - eyeHeight) <= 1.0;
}
