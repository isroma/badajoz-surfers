/**
 * Collision boxes and contact classification. Pure, no three.js.
 *
 * Every axis is tested against the previous tick to decide what kind of contact began:
 * - the Z overlap began (the runner reached the obstacle's front) → "front" (a crash);
 * - the X overlap began (changing lanes into its side) → "side" (a stumble, bounce back);
 * - the Y overlap began (landing on something not walkable, bumping the head) → "clip" (a stumble).
 * A front contact that only clips the obstacle by a little (see MARGINAL_CLIP) is a "clip".
 */
import { OBSTACLE_DEFS, type ObstacleKind } from "../contracts";
import { getCourse } from "./course";
import { followLane, laneOffset, laneOffsetAt, laneOpenAt, layoutAt, type LaneLayout, type LayoutFn } from "./lanes";
import type { ObstacleSpawn } from "./spawns";
import { obstacleCentre } from "./spawns";
import type { PlayerWorld, SurfaceHit } from "./player";
import {
  MARGINAL_CLIP,
  OBSTACLE_SHRINK_TOP,
  OBSTACLE_SHRINK_X,
  RUNNER_HALF_DEPTH,
  STEP_UP,
} from "./tuning";

export interface Aabb {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** Distance range (distance = -z). */
  dMin: number;
  dMax: number;
}

export interface Box {
  spawn: ObstacleSpawn;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  dMin: number;
  dMax: number;
  /** Distance range on the previous tick (differs for moving vehicles). */
  pdMin: number;
  pdMax: number;
  walkable: boolean;
  ramp: boolean;
}

export type ContactType = "front" | "side" | "clip";

export interface Contact {
  type: ContactType;
  spawn: ObstacleSpawn;
}

const EPS = 1e-6;

/** Top of a box at the runner's distance `p` (ramps rise towards -Z). */
export function topAt(box: Box, p: number): number {
  if (!box.ramp) return box.yMax;
  const f = (p + RUNNER_HALF_DEPTH - box.dMin) / (box.dMax - box.dMin);
  return box.yMax * Math.min(1, Math.max(0, f));
}

export function fillBox(box: Box, spawn: ObstacleSpawn, pPrev: number, p: number): Box {
  const def = OBSTACLE_DEFS[spawn.kind];
  const x = spawn.x;
  const halfW = (spawn.span ?? def.width) / 2 - OBSTACLE_SHRINK_X;
  const half = def.length / 2;
  const c = obstacleCentre(spawn, p);
  const pc = obstacleCentre(spawn, pPrev);
  box.spawn = spawn;
  box.xMin = x - halfW;
  box.xMax = x + halfW;
  box.yMin = def.yMin > 0 ? def.yMin + 0.05 : 0;
  // Low barriers forgive a late or low jump a little more (the art keeps their visual height).
  const forgiving = spawn.kind === "valla" || spawn.kind === "conos" || spawn.kind === "bolardos";
  box.yMax = def.walkableTop ? def.yMax : def.yMax - OBSTACLE_SHRINK_TOP - (forgiving ? 0.12 : 0);
  box.dMin = c - half;
  box.dMax = c + half;
  box.pdMin = pc - half;
  box.pdMax = pc + half;
  box.walkable = def.walkableTop;
  box.ramp = def.ramp;
  return box;
}

const overlaps = (aMin: number, aMax: number, bMin: number, bMax: number): boolean =>
  aMin < bMax - EPS && bMin < aMax - EPS;

/**
 * A window of obstacle boxes around the runner. Implements the queries the player physics needs.
 * Reuses its Box objects: no allocation per tick.
 */
export class BoxSet implements PlayerWorld {
  private readonly pool: Box[] = [];
  count = 0;
  private readonly hit: SurfaceHit = { height: 0, id: -1 };

  constructor(
    /** Sorted by `d`. May grow (appended) between calls. */
    private spawns: readonly ObstacleSpawn[],
    private readonly ignore: ReadonlySet<number> | null = null,
    /** Spawns whose |d - p| is below this are considered. */
    private readonly window = 26,
    /** Lane layout by distance (the engine's by default). */
    private readonly layoutFn: LayoutFn = layoutAt,
  ) {}

  layout(p: number): LaneLayout {
    return this.layoutFn(p);
  }

  /** The real lap's continuous lane geometry (lanes.ts) when this set uses the course's layouts. */
  private track(): Parameters<typeof laneOffsetAt>[0] | null {
    if (this.layoutFn !== layoutAt) return null;
    return getCourse()?.track ?? null;
  }

  laneX(lane: number, p: number): number {
    const track = this.track();
    return track ? laneOffsetAt(track, lane, p) : laneOffset(this.layoutFn(p), lane);
  }

  followLane(fromS: number, toS: number, lane: number): number | undefined {
    const track = this.track();
    return track ? followLane(track, lane, fromS, toS) : undefined;
  }

  laneOpen(lane: number, p: number): boolean {
    const track = this.track();
    return track ? laneOpenAt(track, lane, p) : true;
  }

  setSpawns(spawns: readonly ObstacleSpawn[]): void {
    this.spawns = spawns;
  }

  box(i: number): Box | undefined {
    return i < this.count ? this.pool[i] : undefined;
  }

  prepare(pPrev: number, p: number): void {
    const spawns = this.spawns;
    // Binary search for the first spawn with d >= p - window.
    let lo = 0;
    let hi = spawns.length;
    const from = p - this.window;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const s = spawns[mid];
      if (s && s.d < from) lo = mid + 1;
      else hi = mid;
    }
    let n = 0;
    const to = p + this.window;
    for (let i = lo; i < spawns.length; i++) {
      const s = spawns[i];
      if (!s) break;
      if (s.d > to) break;
      if (this.ignore && this.ignore.has(s.id)) continue;
      let box = this.pool[n];
      if (!box) {
        box = {
          spawn: s, xMin: 0, xMax: 0, yMin: 0, yMax: 0, dMin: 0, dMax: 0, pdMin: 0, pdMax: 0, walkable: false, ramp: false,
        };
        this.pool.push(box);
      }
      fillBox(box, s, pPrev, p);
      n++;
    }
    this.count = n;
  }

  /** Highest walkable top under the runner centre that is at most STEP_UP above `feetY`. */
  surface(x: number, p: number, feetY: number): SurfaceHit {
    let best = 0;
    let id = -1;
    for (let i = 0; i < this.count; i++) {
      const b = this.pool[i];
      if (!b || !b.walkable) continue;
      if (x < b.xMin - 0.05 || x > b.xMax + 0.05) continue;
      if (p < b.dMin - RUNNER_HALF_DEPTH || p > b.dMax + RUNNER_HALF_DEPTH) continue;
      const top = topAt(b, p);
      if (top > feetY + STEP_UP + EPS) continue;
      if (top > best) {
        best = top;
        id = b.spawn.id;
      }
    }
    this.hit.height = best;
    this.hit.id = id;
    return this.hit;
  }

  /** Is there an overhead obstacle that would hit a standing runner here? */
  ceiling(x: number, halfWidth: number, p: number, feetY: number, standHeight: number): boolean {
    for (let i = 0; i < this.count; i++) {
      const b = this.pool[i];
      if (!b || b.yMin <= 0) continue;
      if (!overlaps(x - halfWidth, x + halfWidth, b.xMin, b.xMax)) continue;
      if (!overlaps(p - RUNNER_HALF_DEPTH, p + RUNNER_HALF_DEPTH, b.dMin, b.dMax)) continue;
      if (feetY + standHeight > b.yMin && feetY < b.yMax) return true;
    }
    return false;
  }

  /**
   * Classify the most serious contact that began this tick, or null. `prev` and `now` are the
   * runner boxes at the previous and the current tick.
   */
  contact(prev: Aabb, now: Aabb): Contact | null {
    let found: ContactType | null = null;
    let foundSpawn: ObstacleSpawn | null = null;
    const rank = (t: ContactType): number => (t === "front" ? 3 : t === "side" ? 2 : 1);
    for (let i = 0; i < this.count; i++) {
      const b = this.pool[i];
      if (!b) continue;
      const top = topAt(b, now.dMax - RUNNER_HALF_DEPTH);
      const prevTop = topAt(b, prev.dMax - RUNNER_HALF_DEPTH);
      const ox = overlaps(now.xMin, now.xMax, b.xMin, b.xMax);
      const oy = overlaps(now.yMin, now.yMax, b.yMin, top);
      const od = overlaps(now.dMin, now.dMax, b.dMin, b.dMax);
      if (!(ox && oy && od)) continue;
      const px = overlaps(prev.xMin, prev.xMax, b.xMin, b.xMax);
      const py = overlaps(prev.yMin, prev.yMax, b.yMin, prevTop);
      const pd = overlaps(prev.dMin, prev.dMax, b.pdMin, b.pdMax);
      let type: ContactType;
      if (!pd) {
        // Reached its front. A marginal clip (feet just under the top of something low, or the
        // head just touching the bottom of something overhead) is forgiven as a stumble.
        const fromAbove = top - now.yMin;
        const fromBelow = now.yMax - b.yMin;
        const marginal = (!b.walkable && fromAbove < MARGINAL_CLIP) || (b.yMin > 0 && fromBelow < MARGINAL_CLIP * 0.7);
        type = marginal ? "clip" : "front";
      } else if (!px) type = "side";
      else if (!py) type = "clip";
      else continue; // Was already inside (e.g. just stopped ignoring it): let it go.
      if (found === null || rank(type) > rank(found)) {
        found = type;
        foundSpawn = b.spawn;
      }
    }
    if (found === null || foundSpawn === null) return null;
    return { type: found, spawn: foundSpawn };
  }
}

/** Effective obstacle kind lookup helper for tests and the generator. */
export function isLow(kind: ObstacleKind): boolean {
  const def = OBSTACLE_DEFS[kind];
  return def.yMin === 0 && def.yMax < 1.4 && !def.walkableTop;
}
