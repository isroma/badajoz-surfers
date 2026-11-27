/**
 * Adaptive quality governor. Pure (no DOM): the engine feeds it one sample per rendered frame and
 * applies the level it returns.
 *
 * - The display's refresh interval is estimated from the fastest sustained frames (the 10th
 *   percentile of each window, the lowest over the recent windows), also while the menu shows.
 *   The target is that refresh, but never faster than 60 fps (a 144 Hz display running at 60 is
 *   fine).
 * - A window (~1 s of frames) is slow when its average interval exceeds SLOW × target AND the
 *   frames really are late: the measured work per frame (tick + render, CPU) is a big part of the
 *   target, or many frames missed a refresh. Two slow windows in a row step the level down.
 * - FAST_WINDOWS windows in a row under FAST × target step it back up (not within UP_DELAY s of a
 *   step down).
 * - Frames longer than MAX_FRAME_MS (a hitch, a throttled background tab) are ignored, and any
 *   window with a hidden or unfocused page, or outside play, is thrown away.
 * - Nothing is persisted.
 */
export type QualityLevel = 0 | 1 | 2 | 3;

export interface FrameSample {
  /** rAF interval (ms), unclamped. */
  intervalMs: number;
  /** Time spent in the frame's ticks and render (ms). */
  workMs: number;
  /** The page is hidden / does not have focus. */
  hidden: boolean;
  focused: boolean;
  /** Decisions allowed now (playing, ready + 2 s); false in the menu, paused, loading. */
  active: boolean;
}

export const SLOW = 1.25;
export const FAST = 1.08;
export const MAX_FRAME_MS = 100;
export const WINDOW_MS = 1000;
export const FAST_WINDOWS = 5;
export const SLOW_WINDOWS = 2;
export const UP_DELAY = 10;
/** Work above this share of the target, or this share of frames missing a refresh, confirms a slow window. */
export const WORK_SHARE = 0.7;
export const MISSED_SHARE = 0.2;
const MIN_TARGET_MS = 1000 / 60;
const REFRESH_HISTORY = 20;

export class QualityGovernor {
  level: QualityLevel;
  /** Average interval of the last complete window (ms). */
  frameMs = 16.7;
  /** Estimated refresh interval (ms), null until a window was seen. */
  refreshMs: number | null = null;
  private readonly intervals: number[] = [];
  private work = 0;
  private sum = 0;
  private spoiled = false;
  private slowWindows = 0;
  private fastWindows = 0;
  private readonly fastest: number[] = [];
  /** Seconds of (counted) frames since the last step down. */
  private sinceDown = Infinity;

  constructor(level: QualityLevel = 0, private readonly pinned = false) {
    this.level = level;
  }

  /** Feed one frame; returns the level to use (changes at most once per window). */
  frame(f: FrameSample): QualityLevel {
    if (this.pinned) return this.level;
    if (f.hidden || !f.focused) this.spoiled = true;
    if (!(f.intervalMs > 0) || f.intervalMs > MAX_FRAME_MS) return this.level;
    this.intervals.push(f.intervalMs);
    this.sum += f.intervalMs;
    this.work += Math.max(0, f.workMs);
    if (!f.active) this.spoiled = true;
    if (this.sum < WINDOW_MS) return this.level;
    const n = this.intervals.length;
    const avg = this.sum / n;
    const work = this.work / n;
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(n * 0.1)] ?? avg;
    const spoiled = this.spoiled;
    this.intervals.length = 0;
    this.sum = 0;
    this.work = 0;
    this.spoiled = false;
    // Refresh from any window of a visible, focused page (the menu counts).
    if (!(f.hidden || !f.focused)) {
      this.fastest.push(p10);
      if (this.fastest.length > REFRESH_HISTORY) this.fastest.shift();
      this.refreshMs = Math.min(...this.fastest);
    }
    if (spoiled || this.refreshMs === null) {
      this.slowWindows = this.fastWindows = 0;
      return this.level;
    }
    this.frameMs = avg;
    this.sinceDown += avg * n / 1000;
    const refresh = this.refreshMs;
    const target = Math.max(refresh, MIN_TARGET_MS);
    let missed = 0;
    for (const x of sorted) if (x > refresh * 1.5 && x > target * 1.2) missed++;
    const late = work > WORK_SHARE * target || missed / n > MISSED_SHARE;
    if (avg > SLOW * target && late) {
      this.slowWindows++;
      this.fastWindows = 0;
    } else if (avg < FAST * target) {
      this.fastWindows++;
      this.slowWindows = 0;
    } else {
      this.slowWindows = this.fastWindows = 0;
    }
    if (this.slowWindows >= SLOW_WINDOWS && this.level < 3) {
      this.level = (this.level + 1) as QualityLevel;
      this.slowWindows = 0;
      this.sinceDown = 0;
    } else if (this.fastWindows >= FAST_WINDOWS && this.level > 0 && this.sinceDown > UP_DELAY) {
      this.level = (this.level - 1) as QualityLevel;
      this.fastWindows = 0;
    }
    return this.level;
  }
}
