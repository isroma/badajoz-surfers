/**
 * The angry waiter. Pure: tracks how far behind the runner he is. Normally far back; right at
 * the heels after a stumble, then he falls back over STUMBLE_WINDOW seconds.
 */
import { STUMBLE_WINDOW } from "./tuning";

/** Gap (m) when the waiter is "far behind". */
export const CHASER_FAR = 24;
/** Gap at the heels after a stumble. */
export const CHASER_HEELS = 1.7;
/** Gap during the start countdown (in view, behind the runner). */
export const CHASER_INTRO = 4.5;
/** Gap when he grabs the runner. */
export const CHASER_GRAB = 0.55;

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export class Chaser {
  gap = CHASER_INTRO;
  private mode: "intro" | "chase" | "stumble" | "grab" | "arrive" = "intro";
  private since = 0;
  private from = CHASER_INTRO;

  reset(): void {
    this.gap = CHASER_INTRO;
    this.mode = "intro";
    this.since = 0;
    this.from = CHASER_INTRO;
  }

  /** The run started: he falls back from the intro position. */
  go(): void {
    this.mode = "chase";
    this.since = 0;
    this.from = this.gap;
  }

  /** Jump straight to far behind (debug warp). */
  far(): void {
    this.mode = "chase";
    this.since = 10;
    this.gap = CHASER_FAR;
  }

  stumble(): void {
    this.mode = "stumble";
    this.since = 0;
    this.from = this.gap;
  }

  grab(): void {
    this.mode = "grab";
    this.since = 0;
    this.from = this.gap;
  }

  /** After a crash he runs up to the runner. */
  arrive(): void {
    this.mode = "arrive";
    this.since = 0;
    this.from = this.gap;
  }

  /** Recently stumbled and still close enough to grab on a second stumble. */
  get close(): boolean {
    return this.mode === "stumble" && this.since < STUMBLE_WINDOW;
  }

  update(dt: number): void {
    this.since += dt;
    switch (this.mode) {
      case "intro":
        this.gap = CHASER_INTRO;
        break;
      case "chase":
        this.gap = this.from + (CHASER_FAR - this.from) * smooth(this.since / 4);
        break;
      case "stumble": {
        // Close in fast (0.35 s), hold briefly, then fall back over the rest of the window.
        const closeIn = smooth(this.since / 0.35);
        const back = smooth((this.since - 1.2) / (STUMBLE_WINDOW - 1.2));
        const near = this.from + (CHASER_HEELS - this.from) * closeIn;
        this.gap = near + (CHASER_FAR - CHASER_HEELS) * back;
        if (this.since >= STUMBLE_WINDOW) {
          this.mode = "chase";
          this.since = 10;
          this.from = CHASER_FAR;
        }
        break;
      }
      case "grab":
        this.gap = this.from + (CHASER_GRAB - this.from) * smooth(this.since / 0.35);
        break;
      case "arrive":
        this.gap = this.from + (1.3 - this.from) * smooth(this.since / 1.0);
        break;
    }
  }

  /** 0 = far behind, 1 = on your heels. */
  get value(): number {
    return Math.min(1, Math.max(0, 1 - (this.gap - CHASER_HEELS) / (CHASER_FAR - CHASER_HEELS)));
  }
}
