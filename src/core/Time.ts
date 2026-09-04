/** Fixed-timestep accumulator. Physics and gameplay run at a fixed rate so the
 *  simulation is reproducible (important for host-authoritative multiplayer and
 *  for the automated test harness); rendering interpolates between steps. */
export const FIXED_DT = 1 / 60;
/**
 * The most real time one frame is allowed to represent. A stall longer than
 * this (alt-tab, a GC pause, a shader compile) is simply forgotten rather than
 * replayed as a burst of catch-up steps.
 */
export const MAX_FRAME_DT = 0.25;
/**
 * Most fixed steps one frame may run: the spiral-of-death guard.
 *
 * Derived from the frame-time clamp rather than written beside it. The two used
 * to be separate numbers (0.25 s and 5), and because five steps is only 83 ms
 * the game ran in SLOW MOTION below about 12 fps: at 10 fps the world advanced
 * at 83% speed, at 5 fps at 42%. With the cap matched to the clamp a slow frame
 * costs frame rate and nothing else, which is the whole point of a fixed step.
 */
export const MAX_STEPS_PER_FRAME = Math.round(MAX_FRAME_DT / FIXED_DT);

export class Clock {
  elapsed = 0;          // simulated seconds since start
  frame = 0;            // rendered frames
  tick = 0;             // fixed steps taken
  alpha = 0;            // render interpolation factor [0,1)
  scale = 1;            // time dilation (slow-mo for stunt cams)
  paused = false;
  /** Steps dropped on the floor by the spiral guard, for the debug overlay. */
  dropped = 0;
  private acc = 0;
  private last = 0;
  /** Set > 0 by the debug API to advance a precise number of fixed steps. */
  private forcedSteps = 0;

  /** Returns the number of fixed steps to run this frame. */
  advance(nowMs: number): number {
    if (this.last === 0) this.last = nowMs;
    let real = (nowMs - this.last) / 1000;
    this.last = nowMs;
    if (real > MAX_FRAME_DT) real = MAX_FRAME_DT; // never spiral after a stall / alt-tab
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
    if (steps === MAX_STEPS_PER_FRAME && this.acc >= FIXED_DT) {
      // Only reachable when a single frame represented more than the clamp
      // allows, i.e. never in practice; kept so the guard is honest.
      this.dropped += Math.floor(this.acc / FIXED_DT);
      this.acc = 0;
    }
    this.tick += steps;
    this.elapsed += steps * FIXED_DT;
    this.alpha = this.acc / FIXED_DT;
    return steps;
  }

  stepOnce(n = 1): void { this.forcedSteps += n; }
}
