/** requestAnimationFrame loop with a fixed-step simulation and render interpolation. */
import { TICK } from "./tuning";

const MAX_TICKS_PER_FRAME = 12;

export interface LoopHandlers {
  /** One fixed simulation step of TICK seconds. */
  tick(dt: number): void;
  /** Render; `alpha` in [0,1) is how far we are between the last two ticks, `dt` the frame time. */
  render(alpha: number, dt: number): void;
}

export class Loop {
  private acc = 0;
  private last = -1;
  private raf = 0;
  /** Smoothed frames per second. */
  fps = 60;

  constructor(private readonly handlers: LoopHandlers) {}

  start(): void {
    const frame = (now: number): void => {
      this.raf = requestAnimationFrame(frame);
      const dt = this.last < 0 ? TICK : Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
      this.acc += dt;
      let n = 0;
      while (this.acc >= TICK && n < MAX_TICKS_PER_FRAME) {
        this.handlers.tick(TICK);
        this.acc -= TICK;
        n++;
      }
      if (n === MAX_TICKS_PER_FRAME) this.acc = 0;
      this.handlers.render(this.acc / TICK, dt);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.last = -1;
  }
}
