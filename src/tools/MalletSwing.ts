/** The viewmodel and contact resolver use these same seconds. */
export const MALLET_TIMING = {
  windup: 0.12,
  contactAt: 0.18,
  activeEnd: 0.27,
  total: 0.44,
} as const;

export type MalletPhase = 'ready' | 'windup' | 'active' | 'recover';

/** Fixed-step timing and one attack identity, independent of targets and rendering. */
export class MalletSwing {
  private elapsed = 0;
  private serial = 0;
  private running = false;
  private contacted = false;
  queued = false;

  get currentId(): number { return this.serial; }
  get resolved(): boolean { return this.contacted; }
  get state(): MalletPhase {
    if (!this.running) return 'ready';
    if (this.elapsed < MALLET_TIMING.windup) return 'windup';
    if (this.elapsed < MALLET_TIMING.activeEnd) return 'active';
    return 'recover';
  }

  /** Starts immediately, or remembers one press after the contact beat. */
  press(): number | null {
    if (!this.running) return this.begin();
    if (this.elapsed >= MALLET_TIMING.contactAt) this.queued = true;
    return null;
  }

  step(dt: number): { sample: boolean; activeEnded: boolean; startedId: number | null } {
    if (!this.running || !(dt > 0) || !Number.isFinite(dt))
      return { sample: false, activeEnded: false, startedId: null };
    const before = this.elapsed;
    this.elapsed += dt;
    const sample = !this.contacted && before < MALLET_TIMING.activeEnd
      && this.elapsed >= MALLET_TIMING.contactAt;
    const activeEnded = before < MALLET_TIMING.activeEnd
      && this.elapsed >= MALLET_TIMING.activeEnd;
    let startedId: number | null = null;
    if (this.elapsed >= MALLET_TIMING.total) {
      const queued = this.queued;
      this.cancel();
      if (queued) startedId = this.begin();
    }
    return { sample, activeEnded, startedId };
  }

  markContact(): void { this.contacted = true; }

  cancel(): void {
    this.running = false;
    this.elapsed = 0;
    this.contacted = false;
    this.queued = false;
  }

  private begin(): number {
    this.running = true;
    this.elapsed = 0;
    this.contacted = false;
    this.queued = false;
    return ++this.serial;
  }
}
