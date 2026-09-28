import { MALLET_TIMING } from '../tools/MalletSwing.ts';

/** Cosmetic first-person pose. Collision and swing identity stay in MalletSwing. */
export interface MalletViewPose {
  rootX: number;
  rootY: number;
  rootYaw: number;
  toolRoll: number;
  toolPitch: number;
  leftLag: number;
  contact: number;
  impact: number;
}

const HEAD_VIEW_X = 0.16 * 0.62;
const ease = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * The mallet waits at the right edge, pulls back, then its head reaches the
 * camera-centred melee sweep at the shared contact beat. The return is quiet.
 * `baseX` is the aspect-dependent ready offset computed by ViewmodelSystem.
 */
export function sampleMalletViewPose(seconds: number, duration: number,
  baseX: number, impact = 0, fit = 1): MalletViewPose {
  const t = Math.max(0, Math.min(MALLET_TIMING.total,
    seconds * MALLET_TIMING.total / Math.max(.05, duration)));
  const centreX = -baseX - HEAD_VIEW_X * fit;
  let rootX = 0, rootY = 0, rootYaw = 0, toolRoll = 0, toolPitch = 0, leftLag = 0;
  if (t > 0 && t <= MALLET_TIMING.windup) {
    const u = ease(t / MALLET_TIMING.windup);
    rootX = mix(0, .055, u); rootY = mix(0, -.045, u);
    rootYaw = mix(0, -.24, u); toolRoll = mix(0, -.23, u);
    toolPitch = mix(0, -.13, u); leftLag = mix(0, .018, u);
  } else if (t <= MALLET_TIMING.contactAt && t > MALLET_TIMING.windup) {
    const u = ease((t - MALLET_TIMING.windup)
      / (MALLET_TIMING.contactAt - MALLET_TIMING.windup));
    rootX = mix(.055, centreX, u); rootY = mix(-.045, .029, u);
    rootYaw = mix(-.24, 0, u); toolRoll = mix(-.23, 0, u);
    toolPitch = mix(-.13, 0, u); leftLag = mix(.018, 0, u);
  } else if (t <= MALLET_TIMING.activeEnd && t > MALLET_TIMING.contactAt) {
    const u = ease((t - MALLET_TIMING.contactAt)
      / (MALLET_TIMING.activeEnd - MALLET_TIMING.contactAt));
    rootX = mix(centreX, centreX - .075, u); rootY = mix(.029, -.025, u);
    rootYaw = mix(0, .23, u); toolRoll = mix(0, .29, u);
    toolPitch = mix(0, .10, u); leftLag = mix(0, -.020, u);
  } else if (t > MALLET_TIMING.activeEnd && t < MALLET_TIMING.total) {
    const u = ease((t - MALLET_TIMING.activeEnd)
      / (MALLET_TIMING.total - MALLET_TIMING.activeEnd));
    rootX = mix(centreX - .075, 0, u); rootY = mix(-.025, 0, u);
    rootYaw = mix(.23, 0, u); toolRoll = mix(.29, 0, u);
    toolPitch = mix(.10, 0, u); leftLag = mix(-.020, 0, u);
  }
  const contact = Math.max(0, 1 - Math.abs(t - MALLET_TIMING.contactAt) / .105);
  return { rootX, rootY: rootY - impact * .009, rootYaw,
    toolRoll, toolPitch: toolPitch + impact * .055, leftLag, contact, impact };
}

/** A few cosmetic hold frames at contact; no gameplay state reads this. */
export class MalletVisualTimeline {
  elapsed: number = MALLET_TIMING.total;
  /** Visual contact may pause briefly; this never drives gameplay or swing IDs. */
  presentationElapsed: number = MALLET_TIMING.total;
  duration: number = MALLET_TIMING.total;
  active = false;
  impactStrength = 0;
  private hold = 0;
  private swingId = -1;
  private resolved = false;

  start(duration: number, swingId: number): void {
    this.elapsed = 0;
    this.presentationElapsed = 0;
    this.duration = Math.max(.05, duration);
    this.active = true;
    this.impactStrength = 0;
    this.hold = 0;
    this.swingId = swingId;
    this.resolved = false;
  }

  /** Only the current, still-visible swing may produce a contact reaction. */
  impact(swingId: number, outcome: 'whoosh' | 'blocked' | 'protected' | 'hit'): boolean {
    if (!this.active || this.resolved || swingId !== this.swingId) return false;
    this.resolved = true;
    if (outcome === 'whoosh') return true;
    this.impactStrength = outcome === 'hit' ? 1 : outcome === 'protected' ? .65 : .4;
    const contactTime = MALLET_TIMING.contactAt * this.duration / MALLET_TIMING.total;
    const activeEnd = MALLET_TIMING.activeEnd * this.duration / MALLET_TIMING.total;
    if (this.active && this.elapsed >= contactTime - .025 && this.elapsed <= activeEnd)
      this.hold = outcome === 'hit' ? .036 : outcome === 'protected' ? .026 : .014;
    return true;
  }

  step(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    this.impactStrength *= Math.exp(-15 * dt);
    if (!this.active) return;
    const paused = Math.min(dt, this.hold);
    this.hold -= paused;
    // The simulated age always advances. Only the displayed pose pauses and
    // then catches up, so a hit cannot shift the next authoritative swing.
    this.elapsed = Math.min(this.duration, this.elapsed + dt);
    this.presentationElapsed = Math.min(this.elapsed,
      this.presentationElapsed + (dt - paused) * 1.4);
    if (this.elapsed >= this.duration) {
      this.active = false;
      this.presentationElapsed = this.duration;
    }
  }

  cancel(): void {
    this.elapsed = this.duration;
    this.presentationElapsed = this.duration;
    this.active = false;
    this.impactStrength = 0;
    this.hold = 0;
    this.swingId = -1;
    this.resolved = false;
  }
}
