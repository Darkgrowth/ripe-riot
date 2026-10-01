/** Host clock gate for an actual Catch Net swing. Client timing claims never
 * decide whether a flying teammate was caught. */
interface Swing { highestId: number; startedAt: number; live: boolean; used: boolean }

export class NetCatchGuard {
  private readonly swings = new Map<string, Swing>();

  start(peer: string, swingId: number, hostTime: number, equippedAndActive: boolean): boolean {
    if (!peer || !Number.isSafeInteger(swingId) || swingId < 1
      || !Number.isFinite(hostTime) || hostTime < 0) return false;
    const previous = this.swings.get(peer);
    if (previous && swingId <= previous.highestId) return false;
    // Even a refused ID is consumed so a late packet cannot become valid when
    // the player equips the net after sending it.
    this.swings.set(peer, { highestId: swingId, startedAt: hostTime,
      live: equippedAndActive, used: false });
    return equippedAndActive;
  }

  /** Inspect host timing without consuming the swing or trusting a client phase. */
  timing(peer: string, swingId: number, hostTime: number): 'invalid' | 'windup' | 'active' | 'expired' {
    const swing = this.swings.get(peer);
    if (!swing?.live || swing.used || swing.highestId !== swingId
      || !Number.isFinite(hostTime)) return 'invalid';
    const elapsed = hostTime - swing.startedAt;
    if (elapsed < 0) return 'invalid';
    if (elapsed < .06) return 'windup';
    return elapsed <= .28 ? 'active' : 'expired';
  }

  catch(peer: string, swingId: number, hostTime: number, validTarget: boolean): boolean {
    if (!validTarget || this.timing(peer, swingId, hostTime) !== 'active') return false;
    this.swings.get(peer)!.used = true;
    return true;
  }

  cancel(peer: string): void {
    const swing = this.swings.get(peer);
    if (swing) swing.live = false;
  }

  clearPeer(peer: string): void { this.swings.delete(peer); }
  clear(): void { this.swings.clear(); }
}

type Point3 = readonly [number, number, number];

/** Coarse host check for the visible net hoop crossing a flying player's
 * torso. A separate physics ray must also establish line of sight. */
export function validNetCatchGeometry(origin: Point3, aim: Point3,
  actor: Point3, eyeHeight: number, victimFeet: Point3): boolean {
  const finite = (point: Point3) => Array.isArray(point) && point.length === 3
    && point.every(Number.isFinite);
  if (!finite(origin) || !finite(aim) || !finite(actor) || !finite(victimFeet)
    || !Number.isFinite(eyeHeight) || eyeHeight < .5 || eyeHeight > 2.5) return false;
  if (Math.hypot(origin[0] - actor[0], origin[2] - actor[2]) > 1.3
    || Math.abs(origin[1] - actor[1] - eyeHeight) > 1) return false;
  const norm = Math.hypot(...aim);
  if (norm < .8 || norm > 1.2) return false;
  if (Math.hypot(victimFeet[0] - actor[0], victimFeet[2] - actor[2]) > 4.8) return false;
  const hx = origin[0] + aim[0] / norm * 2.8;
  const hy = origin[1] + aim[1] / norm * 2.8;
  const hz = origin[2] + aim[2] / norm * 2.8;
  return Math.hypot(victimFeet[0] - hx, victimFeet[1] + .9 - hy, victimFeet[2] - hz) <= 1.45;
}
