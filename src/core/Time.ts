/** Fixed-timestep accumulator. Physics and gameplay run at a fixed rate so the
 *  simulation is reproducible (important for host-authoritative multiplayer and
 *  for the automated test harness); rendering interpolates between steps. */
export const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

export class Clock {
  elapsed = 0;          // simulated seconds since start
  frame = 0;            // rendered frames
  tick = 0;             // fixed steps taken
  alpha = 0;            // render interpolation factor [0,1)
  scale = 1;            // time dilation (slow-mo for stunt cams)
  paused = false;
  private acc = 0;
  private last = 0;
  /** Set > 0 by the debug API to advance a precise number of fixed steps. */
  private forcedSteps = 0;

  /** Returns the number of fixed steps to run this frame. */
  advance(nowMs: number): number {
    if (this.last === 0) this.last = nowMs;
    let real = (nowMs - this.last) / 1000;
    this.last = nowMs;
    if (real > 0.25) real = 0.25; // never spiral after a stall / alt-tab
    this.frame++;

    if (this.forcedSteps > 0) {
      const n = this.forcedSteps;
      this.forcedSteps = 0;
      this.tick += n;
      this.elapsed += n * FIXED_DT;
      this.alpha = 0;
      return n;
    }
    if (this.paused) { this.alpha = 0; return 0; }

    this.acc += real * this.scale;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.acc -= FIXED_DT; steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = 0; // drop the backlog
    this.tick += steps;
    this.elapsed += steps * FIXED_DT;
    this.alpha = this.acc / FIXED_DT;
    return steps;
  }

  stepOnce(n = 1): void { this.forcedSteps += n; }
}
