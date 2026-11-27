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
/** Seconds of HUD head start after the run begins. */
export const HEAD_START = 4;

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export class Chaser {
  gap = CHASER_INTRO;
  private mode: "intro" | "chase" | "stumble" | "grab" | "arrive" = "intro";
  private since = 0;
  private from = CHASER_INTRO;
  /** Extra metres he drops back by (e.g. while the runner flies). Eased. */
  lag = 0;
  private lagNow = 0;

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
    this.headStart = true;
  }

  /** Right after "go" the HUD shows a head start (0.5 fading to 0 over HEAD_START s). */
  private headStart = false;

  /** Jump straight to far behind (debug warp). */
  far(): void {
    this.mode = "chase";
    this.since = 10;
    this.gap = CHASER_FAR;
  }

  stumble(): void {
    this.headStart = false;
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
    this.lagNow += (this.lag - this.lagNow) * Math.min(1, dt * 0.8);
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

  /** Gap including the extra lag. */
  get distance(): number {
    return this.gap + this.lagNow;
  }

  /** For the HUD: like `value`, but capped by the head start at the beginning of a run. */
  get hudValue(): number {
    const v = this.value;
    if (this.headStart && this.mode === "chase" && this.since < HEAD_START) {
      return Math.min(v, 0.5 * (1 - this.since / HEAD_START));
    }
    return v;
  }

  /** 0 = far behind, 1 = on your heels. */
  get value(): number {
    return Math.min(1, Math.max(0, 1 - (this.gap - CHASER_HEELS) / (CHASER_FAR - CHASER_HEELS)));
  }
}

export interface PathSample {
  x: number;
  y: number;
  rolling: boolean;
  airborne: boolean;
}

/**
 * The runner's recent path (by distance), so the waiter can follow it a few metres behind:
 * same lane changes, jumps over the same barriers, onto the same roofs. Pure ring buffer.
 */
export class PathRecorder {
  private readonly ps: Float64Array;
  private readonly xs: Float32Array;
  private readonly ys: Float32Array;
  private readonly flags: Uint8Array;
  private head = 0;
  private count = 0;

  constructor(private readonly capacity = 2048) {
    this.ps = new Float64Array(capacity);
    this.xs = new Float32Array(capacity);
    this.ys = new Float32Array(capacity);
    this.flags = new Uint8Array(capacity);
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  private at(i: number): number {
    // i-th oldest sample's slot.
    return (this.head - this.count + i + this.capacity * 2) % this.capacity;
  }

  record(p: number, x: number, y: number, rolling: boolean, airborne: boolean): void {
    if (this.count > 0) {
      const last = this.ps[this.at(this.count - 1)] ?? 0;
      if (p < last) this.clear(); // Went backwards (warp/new run): start over.
      else if (p - last < 0.05) return;
    }
    const slot = this.head;
    this.ps[slot] = p;
    this.xs[slot] = x;
    this.ys[slot] = y;
    this.flags[slot] = (rolling ? 1 : 0) | (airborne ? 2 : 0);
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }

  /** Where the runner was when at distance `p`. False if `p` is older than the history. */
  sample(p: number, out: PathSample): boolean {
    if (this.count === 0) return false;
    const first = this.ps[this.at(0)] ?? 0;
    if (p < first) return false;
    let lo = 0;
    let hi = this.count - 1;
    if (p >= (this.ps[this.at(hi)] ?? 0)) lo = hi;
    else {
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if ((this.ps[this.at(mid)] ?? 0) <= p) lo = mid;
        else hi = mid;
      }
    }
    const a = this.at(lo);
    const b = this.at(Math.min(lo + 1, this.count - 1));
    const pa = this.ps[a] ?? 0;
    const pb = this.ps[b] ?? 0;
    const t = pb > pa ? Math.min(1, Math.max(0, (p - pa) / (pb - pa))) : 0;
    out.x = (this.xs[a] ?? 0) + ((this.xs[b] ?? 0) - (this.xs[a] ?? 0)) * t;
    out.y = (this.ys[a] ?? 0) + ((this.ys[b] ?? 0) - (this.ys[a] ?? 0)) * t;
    const f = this.flags[a] ?? 0;
    out.rolling = (f & 1) !== 0;
    out.airborne = (f & 2) !== 0;
    return true;
  }
}
