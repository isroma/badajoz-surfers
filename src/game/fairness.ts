/**
 * The fairness invariant: at every point of the run there is an OBVIOUS way through. Pure.
 *
 * A lane is passable at a distance when nothing in it there needs more than a plain action:
 * empty, or only plainly jumpable low clutter (PLAIN_JUMP: barriers, cones, bollards, planters,
 * tables, terraces, the street-wide barrier), or only plainly roll-under things (PLAIN_ROLL:
 * banners, scaffolds). Vehicles of every kind and containers never count as passable: a roof or
 * a ramp is always an optional route.
 *
 * Every footprint is in runner distance (moving vehicles: where the runner meets them).
 *
 * Over sampled distances (step), `good(l, d)` says a runner in lane l at d can keep going on
 * passable lanes, changing lanes at the real lane-change times (the target lane passable from the
 * start of the change, the lane left passable until SPARE s after its end). The invariant: every lane that is passable for the next HEADROOM seconds
 * is good: from any lane the runner could reasonably be in, an obvious lane is reachable in time.
 */
import { OBSTACLE_DEFS, type ObstacleKind } from "../contracts";
import { followLane, laneOffset, laneOffsetAt, laneOpenAt, type LayoutFn, type MergeTrack } from "./lanes";
import { laneChangeTime } from "./player";
import type { ObstacleSpawn } from "./spawns";
import { footprintOf } from "./traffic";
import { RUNNER_HALF_WIDTH } from "./tuning";

export const PLAIN_JUMP: ReadonlySet<ObstacleKind> = new Set<ObstacleKind>(["valla", "conos", "bolardos", "maceta", "mesa", "terraza", "valla-larga"]);
export const PLAIN_ROLL: ReadonlySet<ObstacleKind> = new Set<ObstacleKind>(["pancarta", "andamio"]);
/** Seconds to spare after a lane change, and the free run-up a lane must have to count. */
export const SPARE = 0.5;
export const HEADROOM = 1.5;
export const FAIR_STEP = 0.5;
const MAX_LANES = 8;

export interface FairnessOptions {
  layout: LayoutFn;
  /** The real lap's lane geometry (merges, blends) when the layout is the course's. */
  track: MergeTrack | null;
  speed: (d: number) => number;
  step?: number;
}

export interface Violation {
  d: number;
  lane: number;
}

type Spawnish = Omit<ObstacleSpawn, "id">;

/**
 * Traps in [from, to): for each run of distances where a runner in a lane with HEADROOM s of free
 * run-up has no obvious way through, one entry at the end of that run-up (≈ where the blocking
 * row is). Empty = fair.
 */
export function unfairPoints(obstacles: readonly Spawnish[], from: number, to: number, opts: FairnessOptions, limit = 50): Violation[] {
  const step = opts.step ?? FAIR_STEP;
  // Samples on an absolute grid: any window gives the same verdict at the same distance.
  const d0 = Math.floor(from / step) * step;
  const n = Math.max(2, Math.ceil((to - d0) / step));
  const lanes = new Int8Array(n);
  const xs = new Float32Array(n * MAX_LANES);
  const open = new Uint8Array(n * MAX_LANES);
  // Bits per sample and lane: 1 jump, 2 roll, 4 hard.
  const bits = new Uint8Array(n * MAX_LANES);
  for (let i = 0; i < n; i++) {
    const d = d0 + i * step;
    const lay = opts.layout(d);
    const m = Math.min(MAX_LANES, lay.offsets.length);
    lanes[i] = m;
    for (let l = 0; l < m; l++) {
      xs[i * MAX_LANES + l] = opts.track ? laneOffsetAt(opts.track, l, d) : laneOffset(lay, l);
      open[i * MAX_LANES + l] = !opts.track || laneOpenAt(opts.track, l, d) ? 1 : 0;
    }
  }
  for (const o of obstacles) {
    const [a, b] = footprintOf(o);
    if (b < from || a > to) continue;
    const def = OBSTACLE_DEFS[o.kind];
    const half = (o.span ?? def.width) / 2 + RUNNER_HALF_WIDTH;
    const bit = PLAIN_JUMP.has(o.kind) ? 1 : PLAIN_ROLL.has(o.kind) ? 2 : 4;
    const i0 = Math.max(0, Math.floor((a - 0.2 - d0) / step));
    const i1 = Math.min(n - 1, Math.ceil((b + 0.2 - d0) / step));
    for (let i = i0; i <= i1; i++) {
      const m = lanes[i]!;
      for (let l = 0; l < m; l++) if (Math.abs((xs[i * MAX_LANES + l] ?? 0) - o.x) < half) bits[i * MAX_LANES + l]! |= bit;
    }
  }
  const pass = (i: number, l: number): boolean => {
    const k = i * MAX_LANES + l;
    const b = bits[k]!;
    return open[k] === 1 && (b & 4) === 0 && b !== 3;
  };
  // Lane l of sample i as an index at sample i + 1 (-1: gone).
  const next = new Int8Array(n * MAX_LANES).fill(-1);
  for (let i = 0; i + 1 < n; i++) {
    const d = d0 + i * step;
    const same = lanes[i] === lanes[i + 1] && opts.layout(d) === opts.layout(d + step);
    for (let l = 0; l < lanes[i]!; l++) {
      let j: number;
      if (same) j = l;
      else if (opts.track) j = followLane(opts.track, l, d, d + step) ?? -1;
      else {
        // Nearest lane of the next layout.
        const x = xs[i * MAX_LANES + l]!;
        j = 0;
        for (let q = 1; q < lanes[i + 1]!; q++) if (Math.abs(xs[(i + 1) * MAX_LANES + q]! - x) < Math.abs(xs[(i + 1) * MAX_LANES + j]! - x)) j = q;
      }
      next[i * MAX_LANES + l] = j >= 0 && j < lanes[i + 1]! ? j : -1;
    }
  }
  // until[i][l]: first sample ≥ i where the lane (followed) is not passable.
  const until = new Int32Array(n * MAX_LANES);
  const good = new Uint8Array(n * MAX_LANES);
  for (let i = n - 1; i >= 0; i--) {
    for (let l = 0; l < lanes[i]!; l++) {
      const k = i * MAX_LANES + l;
      if (!pass(i, l)) {
        until[k] = i;
        continue;
      }
      const j = i + 1 < n ? next[k]! : -1;
      until[k] = i + 1 >= n ? n + 1_000_000 : j < 0 ? i + 1 : until[(i + 1) * MAX_LANES + j]!;
    }
  }
  /** Lane l at sample i followed k samples on (-1 when it ends). */
  const follow = (i: number, l: number, k: number): number => {
    let lane = l;
    for (let s = 0; s < k && lane >= 0; s++) {
      if (i + s + 1 >= n) return lane;
      lane = next[(i + s) * MAX_LANES + lane]!;
    }
    return lane;
  };
  for (let i = n - 1; i >= 0; i--) {
    const d = d0 + i * step;
    const v = Math.max(1, opts.speed(d));
    for (let l = 0; l < lanes[i]!; l++) {
      const k = i * MAX_LANES + l;
      if (!pass(i, l)) continue;
      if (i + 1 >= n) {
        good[k] = 1;
        continue;
      }
      const j = next[k]!;
      if (j >= 0 && good[(i + 1) * MAX_LANES + j]) {
        good[k] = 1;
        continue;
      }
      for (const dir of [-1, 1]) {
        const m = l + dir;
        if (m < 0 || m >= lanes[i]! || !pass(i, m)) continue;
        // The change takes the real lane-change time, and the lane left behind stays passable
        // SPARE s longer than that (the runner is out of it with time to spare).
        const tc = laneChangeTime((xs[i * MAX_LANES + m] ?? 0) - (xs[k] ?? 0));
        const K = Math.ceil((v * tc) / step);
        const Ks = Math.ceil((v * (tc + SPARE)) / step);
        if (until[k]! <= i + Ks || until[i * MAX_LANES + m]! <= i + K) continue;
        if (i + K >= n) {
          good[k] = 1;
          break;
        }
        const mj = follow(i, m, K);
        if (mj >= 0 && good[(i + K) * MAX_LANES + mj]) {
          good[k] = 1;
          break;
        }
      }
    }
  }
  // One violation per trap: the last sample of each run of samples with a stranded lane (where
  // the blocked rows are; the trap reaches back from there).
  const out: Violation[] = [];
  let run: Violation | null = null;
  for (let i = 0; i < n && out.length < limit; i++) {
    const d = d0 + i * step;
    const H = Math.ceil((HEADROOM * Math.max(1, opts.speed(d))) / step);
    if (i + H >= n) break;
    let hit: Violation | null = null;
    for (let l = 0; l < lanes[i]!; l++) {
      const k = i * MAX_LANES + l;
      if (until[k]! > i + H && !good[k]) {
        hit = { d, lane: l };
        break;
      }
    }
    if (hit) run = hit;
    else if (run) {
      out.push({ d: run.d + HEADROOM * Math.max(1, opts.speed(run.d)), lane: run.lane });
      run = null;
    }
  }
  if (run && out.length < limit) out.push({ d: run.d + HEADROOM * Math.max(1, opts.speed(run.d)), lane: run.lane });
  return out;
}
