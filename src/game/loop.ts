/** requestAnimationFrame loop with a fixed-step simulation and render interpolation. */
import { TICK } from "./tuning";

const MAX_TICKS_PER_FRAME = 12;

/**
 * Frame time → fixed ticks. Slow motion scales the time fed into the accumulator, so the number
 * of ticks and the interpolation factor stay consistent with the simulation's real progress
 * (no double steps, never backwards). Pure: no DOM.
 */
export class StepClock {
  private acc = 0;

  /** Returns how many fixed ticks to run for a frame of `dt` seconds at `timeScale`. */
  frame(dt: number, timeScale = 1): number {
    this.acc += dt * Math.max(0, timeScale);
    let n = 0;
    while (this.acc >= TICK && n < MAX_TICKS_PER_FRAME) {
      this.acc -= TICK;
      n++;
    }
    if (n === MAX_TICKS_PER_FRAME && this.acc >= TICK) this.acc = 0;
    return n;
  }

  /** How far we are between the last tick and the next one, in [0, 1). */
  get alpha(): number {
    return this.acc / TICK;
  }
}

export interface LoopHandlers {
  /** One fixed simulation step of TICK seconds. */
  tick(dt: number): void;
  /** Render; `alpha` in [0,1) is how far we are between the last two ticks, `dt` the frame time. */
  render(alpha: number, dt: number): void;
  /** Simulation speed (slow motion below 1). */
  timeScale?(): number;
}

export class Loop {
  private readonly clock = new StepClock();
  private last = -1;
  private raf = 0;
  private running = false;
  /** Smoothed frames per second. */
  fps = 60;

  constructor(private readonly handlers: LoopHandlers) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const frame = (now: number): void => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(frame);
      const dt = this.last < 0 ? TICK : Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
      const n = this.clock.frame(dt, this.handlers.timeScale?.() ?? 1);
      for (let i = 0; i < n; i++) this.handlers.tick(TICK);
      this.handlers.render(this.clock.alpha, dt);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.last = -1;
  }
}
