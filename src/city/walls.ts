/**
 * Real building walls beside the route, and fitting the lane layouts between them.
 *
 * `computeWalls`: for each metre of the lap, the lateral of the nearest building footprint edge on
 * the left (≤ 0) and on the right (≥ 0). Footprint edges are sampled every WALL_SAMPLE m and
 * projected onto the track (near the building's own `s`); buildings flagged `passage` (the Arco
 * del Peso, which the route runs through) are ignored; nothing beyond WALL_FAR counts (±WALL_FAR
 * when there is no wall).
 *
 * `fitStretches`: per stretch and side, the metres where the wall comes within FIT_MARGIN of the
 * outer lane edge are grouped into runs. Runs shorter than PINCH_MAX are tolerated (reported as
 * pinches); while longer runs remain, the outermost lane on that side is narrowed (keeping its
 * inner edge, never below NARROW_MIN; road lanes are never narrowed) down to the 3rd percentile of
 * the clearance over those runs minus FIT_MARGIN, or dropped when less than NARROW_MIN remains
 * (keeping ≥ 2 lanes); when FIT_MARGIN leaves < NARROW_MIN but CHECK_MARGIN does not, the lane
 * is kept at NARROW_MIN. Pavement strips for drawing are clamped to the wall line.
 * Shared-street fallback: a one-way, non-ring stretch whose road lane plus one ≥ NARROW_MIN lane
 * still leaves an intrusion run ≥ SHARED_TRIGGER m (old-town streets 5 m between walls) becomes "ped-1", "ped-2" (flow 0, kind
 * pedestrian, no vehicles), each as wide as its side allows (≤ SHARED_MAX), inner edges on the
 * centreline. Whatever still intrudes by more than CHECK_MARGIN is returned as a pinch.
 */
import type { CityData } from "./data";
import type { LaneLayout } from "./lanes";
import { relayout, sharedStreet } from "./lanes";

export const WALL_FAR = 30;
export const WALL_SAMPLE = 0.5;
export const FIT_MARGIN = 0.3;
export const CHECK_MARGIN = 0.2;
export const NARROW_MIN = 1.6;
export const PINCH_MAX = 25;
/** Lane width cap of the shared-street fallback. */
export const SHARED_MAX = 2.4;
/** A remaining intrusion this long on a one-way street triggers the shared-street fallback. */
export const SHARED_TRIGGER = 12;

export interface Walls {
  /** Bin size (m): bin i covers s ∈ [i, i + 1). */
  readonly step: 1;
  /** Lateral of the nearest wall on the left per metre (≤ 0; −WALL_FAR when none). */
  readonly left: Float32Array;
  /** Lateral of the nearest wall on the right per metre (≥ 0; +WALL_FAR when none). */
  readonly right: Float32Array;
  /** Index into city.buildings of that nearest wall (−1 when none). */
  readonly leftBuilding: Int32Array;
  readonly rightBuilding: Int32Array;
}

export interface Pinch {
  fromS: number;
  toS: number;
  side: "left" | "right";
  /** How far (m) the wall reaches inside the outer lane edge, at worst. */
  intrusion: number;
  /** Ids of the buildings whose faces intrude (city.buildings[].id). */
  buildings: string[];
  /** True when the pipeline already flags one of them as reaching into the carriageway. */
  flagged: boolean;
}

type Project = (x: number, z: number, nearS?: number) => { s: number; lateral: number };

export function computeWalls(city: CityData, lap: number, project: Project): Walls {
  const n = Math.ceil(lap);
  const left = new Float32Array(n).fill(-WALL_FAR);
  const right = new Float32Array(n).fill(WALL_FAR);
  const leftBuilding = new Int32Array(n).fill(-1);
  const rightBuilding = new Int32Array(n).fill(-1);
  for (const [bi, b] of city.buildings.entries()) {
    if (b.passage || b.dist > WALL_FAR) continue;
    const r = b.ring;
    const m = r.length >> 1;
    let hint = b.s;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const ax = r[2 * i]!;
      const az = r[2 * i + 1]!;
      const bx = r[2 * j]!;
      const bz = r[2 * j + 1]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / WALL_SAMPLE));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        const p = project(ax + (bx - ax) * t, az + (bz - az) * t, hint);
        hint = p.s;
        if (Math.abs(p.lateral) > WALL_FAR) continue;
        const bin = ((Math.floor(p.s) % n) + n) % n;
        if (p.lateral < 0) {
          if (p.lateral > left[bin]!) {
            left[bin] = p.lateral;
            leftBuilding[bin] = bi;
          }
        } else if (p.lateral < right[bin]!) {
          right[bin] = p.lateral;
          rightBuilding[bin] = bi;
        }
      }
    }
  }
  return { step: 1, left, right, leftBuilding, rightBuilding };
}

interface FitStretch {
  fromS: number;
  toS: number;
  layout: LaneLayout;
  section: { roundabout: unknown };
}

const percentile = (vals: number[], p: number): number => {
  const v = [...vals].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.max(0, Math.floor((p / 100) * v.length)))] ?? 0;
};

/** Metre bins of [fromS, toS). */
function bins(fromS: number, toS: number, n: number): number[] {
  const out: number[] = [];
  for (let s = Math.floor(fromS); s < Math.ceil(toS); s++) out.push(((s % n) + n) % n);
  return out;
}

/** Runs of consecutive true entries (indices into `flags`). */
function runs(flags: boolean[]): [number, number][] {
  const out: [number, number][] = [];
  let a = -1;
  flags.forEach((f, i) => {
    if (f && a < 0) a = i;
    if (!f && a >= 0) {
      out.push([a, i]);
      a = -1;
    }
  });
  if (a >= 0) out.push([a, flags.length]);
  return out;
}

/** Metres (as clearance values) inside runs ≥ PINCH_MAX where the wall is within `margin` of `edge`. */
function longRuns(clear: number[], edge: number, margin: number): number[] {
  const bad = clear.map((c) => c - margin < edge);
  return runs(bad)
    .filter(([a, b]) => b - a >= PINCH_MAX)
    .flatMap(([a, b]) => clear.slice(a, b));
}

/** True when the wall is within CHECK_MARGIN of `edge` over a run of at least `len` metres. */
function runsAtLeast(clear: number[], edge: number, len: number): boolean {
  return runs(clear.map((c) => c - CHECK_MARGIN < edge)).some(([a, b]) => b - a >= len);
}

/** Fits one side (sign +1 right, −1 left). Returns the new layout. */
function fitSide(layout: LaneLayout, clear: number[], sign: 1 | -1): LaneLayout {
  let l = layout;
  for (let guard = 0; guard < 6; guard++) {
    const edge = sign > 0 ? l.right : -l.left;
    const inLong = longRuns(clear, edge, FIT_MARGIN);
    if (inLong.length === 0) return l;
    const p3 = percentile(inLong, 3);
    // Prefer the comfortable margin; accept the minimum one if that is what lets the lane stay.
    const target = Math.min(edge - 0.01, p3 - FIT_MARGIN);
    const k = sign > 0 ? l.offsets.length - 1 : 0;
    if (l.kinds[k] === "road" || l.kinds[k] === "median") return l; // never narrowed: left to pinches
    const inner = sign > 0 ? l.offsets[k]! - l.widths[k]! / 2 : -(l.offsets[k]! + l.widths[k]! / 2);
    let avail = target - inner;
    if (avail < NARROW_MIN && p3 - CHECK_MARGIN - inner >= NARROW_MIN) avail = NARROW_MIN;
    if (avail >= NARROW_MIN) {
      const w = Math.min(l.widths[k]!, avail);
      l = relayout(l, k, sign * (inner + w / 2), w, sign * p3);
    } else if (l.offsets.length > 2) {
      l = relayout(l, k, null, 0, sign * p3);
    } else {
      // Cannot drop below 2 lanes: narrow to the minimum and leave the rest to pinches.
      if (l.widths[k]! > NARROW_MIN) l = relayout(l, k, sign * (inner + NARROW_MIN / 2), NARROW_MIN, sign * p3);
      return l;
    }
  }
  return l;
}

/** Fits every stretch's layout between the walls and lists the remaining pinches. */
export function fitStretches<T extends FitStretch>(
  stretches: readonly T[],
  walls: Walls,
  buildings: readonly { id: string; passesThrough?: true }[],
): { stretches: T[]; pinches: Pinch[] } {
  const n = walls.left.length;
  const byId = new Map<string, LaneLayout>();
  const out = stretches.map((st) => {
    const b = bins(st.fromS, st.toS, n);
    const R = b.map((i) => walls.right[i]!);
    const L = b.map((i) => -walls.left[i]!);
    let l = fitSide(fitSide(st.layout, R, 1), L, -1);
    // Shared-street fallback: a one-way street too narrow for its lane plus one pavement lane
    // between the walls becomes two narrow lanes without vehicles (see header).
    const stuck = runsAtLeast(R, l.right, SHARED_TRIGGER) || runsAtLeast(L, -l.left, SHARED_TRIGGER);
    if (stuck && !st.section.roundabout && l.kinds.includes("road") && !l.flow.includes(-1)) {
      const wl = Math.min(SHARED_MAX, percentile(L, 3) - CHECK_MARGIN);
      const wr = Math.min(SHARED_MAX, percentile(R, 3) - CHECK_MARGIN);
      if (wl >= NARROW_MIN && wr >= NARROW_MIN) l = sharedStreet(wl, wr, percentile(L, 3), percentile(R, 3));
    }
    const shared = byId.get(l.id) ?? l;
    byId.set(l.id, shared);
    return { ...st, layout: shared };
  });

  // Remaining intrusions (beyond CHECK_MARGIN), grouped per side across stretch boundaries.
  const pinches: Pinch[] = [];
  for (const side of ["left", "right"] as const) {
    let cur: Pinch | null = null;
    for (const st of out) {
      for (const i of bins(st.fromS, st.toS, n)) {
        const intr = side === "right" ? st.layout.right - (walls.right[i]! - CHECK_MARGIN) : -(st.layout.left - (walls.left[i]! + CHECK_MARGIN));
        if (intr > 0) {
          const bi = (side === "right" ? walls.rightBuilding : walls.leftBuilding)[i]!;
          const bld = buildings[bi];
          if (!(cur && cur.toS === i)) {
            if (cur) pinches.push(cur);
            cur = { fromS: i, toS: i, side, intrusion: 0, buildings: [], flagged: false };
          }
          cur.toS = i + 1;
          cur.intrusion = Math.max(cur.intrusion, intr + CHECK_MARGIN);
          if (bld && !cur.buildings.includes(bld.id)) cur.buildings.push(bld.id);
          if (bld?.passesThrough) cur.flagged = true;
        }
      }
    }
    if (cur) pinches.push(cur);
  }
  pinches.sort((a, b) => a.fromS - b.fromS);
  // Stretch bins overlap by one metre at boundaries: merge touching pinches of the same side.
  const merged: Pinch[] = [];
  for (const p of pinches) {
    const prev = [...merged].reverse().find((q) => q.side === p.side);
    if (prev && p.fromS <= prev.toS) {
      prev.toS = Math.max(prev.toS, p.toS);
      prev.intrusion = Math.max(prev.intrusion, p.intrusion);
      for (const id of p.buildings) if (!prev.buildings.includes(id)) prev.buildings.push(id);
      prev.flagged ||= p.flagged;
    } else merged.push(p);
  }
  for (const p of merged) p.intrusion = Math.round(p.intrusion * 100) / 100;
  return { stretches: out, pinches: merged };
}
