/**
 * Lane layouts in track space. Everything in the gameplay logic (player lane changes, generator,
 * solver, bots, collisions) asks `layoutAt(distance)` (or an injected `LayoutFn`) where the lanes
 * are and which way traffic flows in them. Lanes are indices into `offsets` (0 = leftmost).
 *
 * Spain drives on the right: with the runner going forward (-Z), same-direction traffic (+1) is in
 * the right-hand lanes and oncoming traffic (-1) in the left-hand ones. 0 = no vehicles
 * (pedestrian streets: only scooters and street clutter).
 *
 * Pure: no three.js.
 */
import { LANE_WIDTH, type ZoneId } from "../contracts";
import { TRANSITION_LENGTH } from "../city/lanes";
import type { Track } from "../city/track";
import { getCourse } from "./course";
import { speedAt, zoneAt } from "./tuning";

export type Flow = 1 | -1 | 0;
export type LaneKind = "road" | "sidewalk" | "pedestrian" | "median";

/**
 * The gameplay view of a lane layout. The real route's layouts (src/city `LaneLayout`) carry all
 * the optional fields; test layouts may give only offsets and flow (then every lane is a 2.6 m
 * road lane, sidewalk-free).
 */
export interface LaneLayout {
  /** Lateral centre of each lane (metres, +X = right), left to right. */
  readonly offsets: readonly number[];
  /** Traffic direction in each lane. */
  readonly flow: readonly Flow[];
  /** Usable width of each lane. */
  readonly widths?: readonly number[];
  readonly kinds?: readonly LaneKind[];
  /** Outer limits of the runnable surface. */
  readonly left?: number;
  readonly right?: number;
}

export type LayoutFn = (distance: number) => LaneLayout;

const THREE_LANES = [-LANE_WIDTH, 0, LANE_WIDTH] as const;

/** Today's track: three lanes everywhere, traffic direction by zone. */
const ZONE_LAYOUTS: Readonly<Record<ZoneId, LaneLayout>> = {
  "puente-real": { offsets: THREE_LANES, flow: [-1, 1, 1] },
  valdepasillas: { offsets: THREE_LANES, flow: [-1, 1, 1] },
  "san-francisco": { offsets: THREE_LANES, flow: [-1, 1, 1] },
  "casco-antiguo": { offsets: THREE_LANES, flow: [0, 0, 0] },
  "alcazaba-palmas": { offsets: THREE_LANES, flow: [0, 0, 0] },
  "margen-derecha": { offsets: THREE_LANES, flow: [-1, -1, 1] },
};

/** Phase 2 reference: Puente Real and the big avenues, two lanes each way. */
export const FOUR_LANES: LaneLayout = { offsets: [-3.9, -1.3, 1.3, 3.9], flow: [-1, -1, 1, 1] };

/** The engine's lane layout at a distance: the real route's when a course is installed. */
export const layoutAt: LayoutFn = (distance) => {
  const course = getCourse();
  return course ? course.layoutAt(distance) : ZONE_LAYOUTS[zoneAt(distance).zone.id];
};

/**
 * Lateral centre of `lane` of `layout` at distance p: the real lap's continuous geometry
 * (`laneOffsetAt`) when `layout` is the installed course's layout at p, else the layout's offset.
 */
export function courseLaneX(layout: LaneLayout, lane: number, p: number): number {
  const course = getCourse();
  if (course && course.layoutAt(p) === layout) return laneOffsetAt(course.track, lane, p);
  return laneOffset(layout, lane);
}

/** Width of a lane (2.6 m when the layout does not say). */
export function laneWidth(layout: LaneLayout, lane: number): number {
  return layout.widths?.[lane] ?? LANE_WIDTH;
}

/** Kind of a lane ("road" when the layout does not say). */
export function laneKind(layout: LaneLayout, lane: number): LaneKind {
  return layout.kinds?.[lane] ?? "road";
}

/**
 * Lane to land in when the layout changes under the runner: the nearest lane of the same kind and
 * flow within 3.5 m if there is one (stay on the sidewalk, stay on your carriageway), else the
 * nearest lane.
 */
export function remapLane(layout: LaneLayout, x: number, kind: LaneKind | null, flow: Flow | null): number {
  let best = -1;
  let bestD = Infinity;
  if (kind !== null) {
    for (let i = 0; i < layout.offsets.length; i++) {
      if (laneKind(layout, i) !== kind || (layout.flow[i] ?? 0) !== flow) continue;
      const d = Math.abs((layout.offsets[i] ?? 0) - x);
      if (d < bestD - 1e-9) {
        best = i;
        bestD = d;
      }
    }
  }
  return best >= 0 && bestD <= 3.5 ? best : nearestLane(layout, x);
}

/** Runnable span of the street (outer edges of the outer lanes). */
export function runnableSpan(layout: LaneLayout): { centre: number; width: number } {
  if (layout.left !== undefined && layout.right !== undefined) return { centre: (layout.left + layout.right) / 2, width: layout.right - layout.left };
  return roadSpan(layout);
}

/** Same lane positions (flow may differ). */
export function sameOffsets(a: LaneLayout, b: LaneLayout): boolean {
  if (a === b || a.offsets === b.offsets) return true;
  if (a.offsets.length !== b.offsets.length) return false;
  for (let i = 0; i < a.offsets.length; i++) if (a.offsets[i] !== b.offsets[i]) return false;
  return true;
}

export function sameLayout(a: LaneLayout, b: LaneLayout): boolean {
  if (a === b) return true;
  if (!sameOffsets(a, b)) return false;
  for (let i = 0; i < a.flow.length; i++) if (a.flow[i] !== b.flow[i]) return false;
  return true;
}

export function laneCount(layout: LaneLayout): number {
  return layout.offsets.length;
}

/** Lateral centre of a lane (clamped to the layout). */
export function laneOffset(layout: LaneLayout, lane: number): number {
  const n = layout.offsets.length;
  const i = lane < 0 ? 0 : lane >= n ? n - 1 : lane;
  return layout.offsets[i] ?? 0;
}

/** Lane whose centre is nearest to `x`; ties go to the right-hand lane. */
export function nearestLane(layout: LaneLayout, x: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < layout.offsets.length; i++) {
    const d = Math.abs((layout.offsets[i] ?? 0) - x);
    if (d <= bestD + 1e-9) {
      best = i;
      bestD = Math.min(bestD, d);
    }
  }
  return best;
}

/**
 * The lane a fresh runner starts in: the road lane nearest the route centreline (the centre of
 * our carriageway), the right-hand one on a tie (Spain keeps right).
 */
export function centreLane(layout: LaneLayout): number {
  // The real layouts name their lanes: start in our kerb lane, "own-1".
  const ids = (layout as LaneLayout & { ids?: readonly string[] }).ids;
  const own = ids?.indexOf("own-1") ?? -1;
  if (own >= 0) return own;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < layout.offsets.length; i++) {
    if ((layout.kinds?.[i] ?? "road") !== "road" && layout.kinds?.some((k) => k === "road")) continue;
    const d = Math.abs(layout.offsets[i] ?? 0);
    if (d < bestD - 0.15 || (Math.abs(d - bestD) <= 0.15 && (layout.offsets[i] ?? 0) > (layout.offsets[best] ?? 0))) {
      best = i;
      bestD = Math.min(bestD, d);
    }
  }
  return best >= 0 ? best : nearestLane(layout, 0);
}

/** Centre and full width of the road surface covered by all lanes (for full-width obstacles). */
export function roadSpan(layout: LaneLayout): { centre: number; width: number } {
  const first = layout.offsets[0] ?? 0;
  const last = layout.offsets[layout.offsets.length - 1] ?? 0;
  return { centre: (first + last) / 2, width: last - first + LANE_WIDTH };
}

/** Lane indices `0..n-1`. */
export function laneIndices(layout: LaneLayout): number[] {
  return layout.offsets.map((_, i) => i);
}

/**
 * First distance in (from, to] where the lane positions differ from those at `from` (sampled
 * every `step` metres), or null.
 */
export function nextOffsetChange(layout: LayoutFn, from: number, to: number, step = 1): number | null {
  const base = layout(from);
  for (let d = from + step; d < to + step; d += step) {
    const at = Math.min(d, to);
    if (!sameOffsets(base, layout(at))) {
      // Refine to ~5 cm.
      let lo = at - step;
      let hi = at;
      while (hi - lo > 0.05) {
        const mid = (lo + hi) / 2;
        if (sameOffsets(base, layout(mid))) lo = mid;
        else hi = mid;
      }
      return hi;
    }
    if (at >= to) break;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Continuous lane geometry on the real lap: boundary blends and merges
// ---------------------------------------------------------------------------

/**
 * A lane that ends tapers into its merge target over its last metres (ease-in-out along the
 * distance), so a runner who stays in it is carried smoothly onto the target. The drawn taper is
 * max(MERGE_LENGTH, MERGE_TIME × the lap-1 planned speed at its end) long.
 */
export const MERGE_LENGTH = 60;
export const MERGE_TIME = 3.2;
/** The boundary blend (a mapped lane whose offset changes) is this long, centred on the boundary. */
export const BLEND_LENGTH = TRANSITION_LENGTH;

/** Planned speed (m/s) at an unbounded distance. */
export type SpeedFn = (s: number) => number;

/** One lane taper (lap-relative s, s0 < s1 ≤ the boundary where the lane ends). */
export interface LaneMerge {
  /**
   * The taper starts (the lane is still at its own offset). It may lie before the stretch's
   * start (the taper then begins in the previous stretch, on the lanes this one continues);
   * negative for a stretch that starts at the lap seam.
   */
  s0: number;
  /** ... and ends: from here the lane coincides with `into` (and the runner is handed to it). */
  s1: number;
  /** Index (in track.stretches) of the stretch the lane belongs to. */
  fromStretch: number;
  /** The ending lane and its merge target: indices in that stretch's layout. */
  lane: number;
  into: number;
  /** Where the stretch (and the lane) ends: the layout boundary (lapLength for the lap seam). */
  end: number;
  /**
   * An opening, not a closing: the lane begins at s0 coinciding with `into` and reaches its own
   * place at s1 (it is not enterable before s1).
   */
  opens?: true;
}

/** The parts of the city Track this needs (so tests can pass a small fake). */
export type MergeTrack = Pick<Track, "lapLength" | "stretches" | "transitions" | "stretchIndexAt">;

interface Geometry {
  merges: LaneMerge[];
  /** By stretch, by lane: the merge of that lane (undefined when it does not end there). */
  byLane: (LaneMerge | undefined)[][];
  /**
   * By stretch, by lane: a taper of the next stretch that may begin here, and its target here
   * (-1: the target only exists in the next stretch, where the taper ends at its start).
   */
  preByLane: ({ m: LaneMerge; into: number } | undefined)[][];
  /** Earliest start any (faster-lap) taper of a merge may have (lap-relative, like s0). */
  earliest: Map<LaneMerge, number>;
  /** Transition after / before each stretch (null: same layout, nothing changes). */
  after: (MergeTrack["transitions"][number] | null)[];
  before: (MergeTrack["transitions"][number] | null)[];
  /** For each stretch, lane → the lane of the previous stretch that continues into it (-1: none). */
  pred: number[][];
  /** Half length of the boundary blend at the start of each stretch, and the most it may grow to. */
  halfIn: number[];
  halfMax: number[];
  /** Largest offset change of a lane that continues across the boundary at each stretch's start. */
  shiftIn: number[];
  /** By stretch, by lane: a lane that begins and opens out of its neighbour over [from, to]. */
  beginIn: ({ from: number; to: number; target: number } | undefined)[][];
}

/** Lanes that begin open out of their neighbour over this many metres. */
export const LANE_OPEN = 20;

const geometries = new WeakMap<object, Geometry>();

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * The lap the geometry is sized for: every taper and blend is long enough for its planned speed
 * (one geometry for all laps; slower laps are simply gentler).
 */
export const GEOMETRY_LAP = 4;

function geometry(track: MergeTrack): Geometry {
  const cached = geometries.get(track);
  if (cached) return cached;
  const v: SpeedFn = (s) => speedAt(s + (GEOMETRY_LAP - 1) * track.lapLength);
  /** The highest of v over [at − back, at]. */
  const vMax = (at: number, back: number): number => {
    let m = 0;
    for (let x = at - back; x <= at; x += 5) m = Math.max(m, v(x));
    return m;
  };
  const st = track.stretches;
  const NS = st.length;
  const after: Geometry["after"] = st.map(() => null);
  const before: Geometry["before"] = st.map(() => null);
  for (const t of track.transitions) {
    after[t.fromIndex] = t;
    before[t.toIndex] = t;
  }
  const len = (k: number): number => st[k]!.toS - st[k]!.fromS;
  const halfMax = st.map((_, k) => Math.min(len(k) / 3, len((k - 1 + NS) % NS) / 3));
  const halfIn = st.map((_, k) => Math.min(BLEND_LENGTH / 2, len(k) / 2, len((k - 1 + NS) % NS) / 2));
  const pred = st.map((s, k) => {
    const out = s.layout.offsets.map(() => -1);
    const t = before[k];
    if (!t) return s.layout.offsets.map((_, i) => i);
    t.map.forEach((j, i) => {
      if (j !== null && j < out.length) out[j] = i;
    });
    return out;
  });
  const merges: LaneMerge[] = [];
  const byLane: Geometry["byLane"] = st.map((s) => s.layout.offsets.map(() => undefined));
  const preByLane: Geometry["preByLane"] = st.map((s) => s.layout.offsets.map(() => undefined));
  const earliest = new Map<LaneMerge, number>();
  const beginIn: Geometry["beginIn"] = st.map((s2) => s2.layout.offsets.map(() => undefined));
  for (let k = 0; k < NS; k++) {
    const t = after[k];
    if (!t) continue;
    const a = st[k]!.layout;
    const survives = (i: number): boolean => t.map[i] !== null && t.map[i] !== undefined;
    const ending = a.offsets.map((_, i) => i).filter((i) => !survives(i));
    if (ending.length === 0) continue;
    const alive = a.offsets.map((_, i) => i).filter(survives);
    if (alive.length === 0) continue;
    // The route's own carriageway: own-1 sits on the centreline; the nearest surviving lane
    // without oncoming traffic is the anchor every ending lane merges towards.
    // (a lane's flow after the boundary counts: opp-1 becomes a ring lane at the Puente Real ring)
    const nb = st[(k + 1) % NS]!.layout;
    const flowOn = (i: number): number => nb.flow[t.map[i] ?? -1] ?? a.flow[i] ?? 0;
    const calm = alive.filter((i) => flowOn(i) !== -1);
    const pool = calm.length > 0 ? calm : alive;
    const anchor = pool.reduce((b, i) => (Math.abs(a.offsets[i] ?? 0) < Math.abs(a.offsets[b] ?? 0) ? i : b));
    const into = new Map<number, number>();
    for (const i of ending) {
      const dir = anchor > i ? 1 : -1;
      const j = i + dir;
      if (j < 0 || j >= a.offsets.length) continue;
      if (!survives(j) || flowOn(j) !== -1) into.set(i, j);
      else {
        // The only neighbour carries oncoming traffic: the nearest calm survivor instead.
        const x = a.offsets[i] ?? 0;
        into.set(i, pool.reduce((b, l) => (Math.abs((a.offsets[l] ?? 0) - x) < Math.abs((a.offsets[b] ?? 0) - x) ? l : b)));
      }
    }
    const depth = (i: number, guard = 0): number => {
      const j = into.get(i);
      if (j === undefined || guard > 8) return 0;
      return survives(j) ? 1 : 1 + depth(j, guard + 1);
    };
    const end = st[k]!.toS;
    const chain = ending.filter((i) => depth(i) > 0);
    const maxDepth = Math.max(1, ...chain.map((i) => depth(i)));
    // Room: this stretch after its start blend; or, when every lane of the merges (and their
    // targets) continues from the previous stretch, that one too after its own start blend.
    const kp = (k - 1 + NS) % NS;
    const ownRoom = len(k) - halfIn[k]! - 1;
    const lanesBefore = chain.every((i) => pred[k]![i]! >= 0 && pred[k]![into.get(i)!]! >= 0) && NS > 1;
    const room = lanesBefore ? ownRoom + halfIn[k]! + len(kp) - halfIn[kp]! - 1 : ownRoom;
    // (the fastest planned speed over the stretch run-up to the end: the pace eases before bends)
    const vEnd = vMax(end, 150);
    const want = Math.max(MERGE_LENGTH, MERGE_TIME * vEnd);
    const L = Math.min(want, room / maxDepth);
    const roomBefore = len(kp) - halfIn[kp]! - 1;
    for (const i of chain) {
      const j = into.get(i)!;
      const d = depth(i);
      // A lane that lives less than a taper's length: closed for its whole life. The lane it
      // continues from tapers onto the target (or the target's start, when it only begins here)
      // in the stretch before, and the runner is handed to the target at the boundary.
      const pi = pred[k]![i] ?? -1;
      // Never taper inside a roundabout: a lane that ends in a ring is closed for its whole life
      // there too (its taper runs before the ring).
      const ring = st[k]!.section.roundabout !== null;
      let busy = pi >= 0 && byLane[kp]!.some((x) => x !== undefined && x.into === pi);
      if (busy && ring && d === 1 && roomBefore >= 2 * want) {
        // Lanes merging into it before the ring go first (outermost first, as in a chain).
        for (const x of byLane[kp]!) {
          if (x && x.into === pi && x.s1 > st[kp]!.toS - want) {
            x.s1 -= want;
            x.s0 -= want;
          }
        }
        busy = false;
      }
      if (d === 1 && (len(k) < want || ring) && pi >= 0 && !busy && roomBefore >= want && NS > 1) {
        const from = st[k]!.fromS;
        const m: LaneMerge = { s0: from - want, s1: from, fromStretch: k, lane: i, into: j, end };
        merges.push(m);
        byLane[k]![i] = m;
        earliest.set(m, from - roomBefore);
        preByLane[kp]![pi] = { m, into: pred[k]![j] ?? -1 };
        continue;
      }
      const s1 = end - (d - 1) * L;
      const m: LaneMerge = { s0: s1 - L, s1, fromStretch: k, lane: i, into: j, end };
      merges.push(m);
      byLane[k]![i] = m;
      earliest.set(m, end - room);
      if (lanesBefore) {
        const pi = pred[k]![i]!;
        const pj = pred[k]![j]!;
        preByLane[kp]![pi] = { m, into: pj };
      }
    }
  }
  // Every lane that begins (no lane before it continues into it) opens out of its neighbour
  // towards the centreline over LANE_OPEN m, so it never appears
  // at full width at once.
  for (let k = 0; k < NS; k++) {
    if (!before[k]) continue;
    const lay = st[k]!.layout;
    for (let i = 0; i < lay.offsets.length; i++) {
      if (pred[k]![i]! >= 0 || beginIn[k]![i]) continue;
      const m0 = byLane[k]![i];
      if (m0 && m0.s1 <= st[k]!.fromS + 1e-6) continue; // never offered at all
      const toward = (lay.offsets[i] ?? 0) < 0 ? i + 1 : i - 1;
      if (toward < 0 || toward >= lay.offsets.length) continue;
      const room = (m0 ? m0.s0 : st[k]!.toS) - st[k]!.fromS;
      beginIn[k]![i] = { from: st[k]!.fromS, to: st[k]!.fromS + Math.min(LANE_OPEN, room / 2, len(k) / 3), target: toward };
    }
  }
  for (let k = 0; k < NS; k++) {
    beginIn[k]!.forEach((o, i) => {
      if (o) merges.push({ s0: o.from, s1: o.to, fromStretch: k, lane: i, into: o.target, end: st[k]!.toS, opens: true });
    });
  }
  merges.sort((x, y) => x.s0 - y.s0);
  const shiftIn = st.map((s2, k) => {
    let m = 0;
    const prev = st[(k - 1 + NS) % NS]!.layout.offsets;
    pred[k]!.forEach((p, i) => {
      if (p >= 0 && before[k]) m = Math.max(m, Math.abs((s2.layout.offsets[i] ?? 0) - (prev[p] ?? 0)));
    });
    return m;
  });
  // Boundary blends: at least BLEND_TIME of running at the geometry's speed, and long enough that
  // the biggest shift there never moves the runner faster than BLEND_RATE m/s.
  const halfFix = st.map((s2, k) => {
    const vb = vMax(s2.fromS + 10, 20);
    return Math.max(halfIn[k]!, Math.min(halfMax[k]!, Math.max((BLEND_TIME * vb) / 2, (1.5 * shiftIn[k]! * vb) / (2 * BLEND_RATE))));
  });
  const g: Geometry = { merges, byLane, preByLane, earliest, after, before, pred, halfIn: halfFix, halfMax, shiftIn, beginIn };
  geometries.set(track, g);
  return g;
}

/**
 * Every lane taper of the lap, by s0 (pure): closings (a lane tapering into `into`) and, marked
 * `opens: true`, openings (a lane that begins coinciding with `into` at s0 and reaches its own
 * place at s1). One geometry for every lap (sized for lap GEOMETRY_LAP): the art draws it, the
 * engine carries the runner along it, the HUD counts down to it.
 */
export function merges(track: MergeTrack): readonly LaneMerge[] {
  return geometry(track).merges;
}

function wrapS(track: MergeTrack, s: number): number {
  const L = track.lapLength;
  const w = s - L * Math.floor(s / L);
  return w >= L ? 0 : w;
}

/** Where a taper starts (one geometry for every lap). */
function startOf(_g: Geometry, m: LaneMerge, _carry: SpeedFn | undefined, _lapBase: number): number {
  return m.s0;
}

/** Engine blends last at least this long (s) at speed, so a 1 m shift never moves the runner faster than ~2.5 m/s. */
export const BLEND_TIME = 0.7;

/** Half length of the blend at the start of stretch k (fixed: see geometry). */
function halfAt(g: Geometry, k: number, _carry: SpeedFn | undefined, _at: number): number {
  return g.halfIn[k]!;
}

/** The engine's boundary blends keep the runner's sideways carry under this (m/s) where they can. */
export const BLEND_RATE = 2.5;

/** A lane's own offset at w in stretch k, with the boundary blends (no tapers). */
function baseOffset(track: MergeTrack, g: Geometry, k: number, i: number, w: number, carry: SpeedFn | undefined, lapBase: number): number {
  const st = track.stretches[k]!;
  const own = st.layout.offsets[i] ?? 0;
  const NS = track.stretches.length;
  const hIn = halfAt(g, k, carry, lapBase + st.fromS);
  if (w < st.fromS + hIn) {
    const p = g.pred[k]![i] ?? -1;
    const prev = track.stretches[(k - 1 + NS) % NS]!.layout.offsets[p];
    if (p >= 0 && prev !== undefined && g.before[k]) return prev + (own - prev) * smooth((w - (st.fromS - hIn)) / (2 * hIn));
    return own;
  }
  const kn = (k + 1) % NS;
  const hOut = halfAt(g, kn, carry, lapBase + st.toS);
  const t = g.after[k];
  if (t && w > st.toS - hOut) {
    const j = t.map[i];
    const next = j === null || j === undefined ? undefined : track.stretches[kn]!.layout.offsets[j];
    if (next !== undefined) return own + (next - own) * smooth((w - (st.toS - hOut)) / (2 * hOut));
  }
  return own;
}

/** Offset of lane `lane` of stretch k at lap-relative w (inside the stretch), with blends and tapers. */
function offsetIn(track: MergeTrack, g: Geometry, k: number, lane: number, w: number, carry: SpeedFn | undefined, lapBase: number, guard = 0): number {
  const n = track.stretches[k]!.layout.offsets.length;
  const i = lane < 0 ? 0 : lane >= n ? n - 1 : lane;
  let base = baseOffset(track, g, k, i, w, carry, lapBase);
  if (guard >= 8) return base;
  const opening = g.beginIn[k]![i];
  if (opening && w < opening.to) {
    const from = offsetIn(track, g, k, opening.target, w, carry, lapBase, guard + 1);
    base = from + (base - from) * smooth((w - opening.from) / (opening.to - opening.from));
  }
  const m = g.byLane[k]![i];
  if (m) {
    if (w >= m.s1) return offsetIn(track, g, k, m.into, w, carry, lapBase, guard + 1);
    const s0 = startOf(g, m, carry, lapBase);
    if (w > s0) return base + (offsetIn(track, g, k, m.into, w, carry, lapBase, guard + 1) - base) * smooth((w - s0) / (m.s1 - s0));
    return base;
  }
  // A taper of the next stretch that already begins here.
  const pre = g.preByLane[k]![i];
  if (pre) {
    const NS = track.stretches.length;
    // In the lap coordinates of the next stretch (the lap seam lies between them for stretch 0).
    const shift = (k + 1) % NS === 0 ? track.lapLength : 0;
    const s0 = startOf(g, pre.m, carry, lapBase + shift) + shift;
    if (w > s0) {
      const kn = (k + 1) % NS;
      const target = pre.into >= 0
        ? offsetIn(track, g, k, pre.into, w, carry, lapBase, guard + 1)
        : offsetIn(track, g, kn, pre.m.into, track.stretches[kn]!.fromS, carry, lapBase + shift, guard + 1);
      return base + (target - base) * smooth((w - s0) / (pre.m.s1 + shift - s0));
    }
  }
  return base;
}

/**
 * Lateral centre of lane `lane` (an index in the layout at s, i.e. `track.layoutAt(s)`) at
 * distance s (any lap): continuous along the distance. Across a layout boundary a lane that
 * continues blends from its old offset to its new one over BLEND_LENGTH centred on the boundary;
 * a lane that ends tapers into its merge target (see `merges`) and then coincides with it. Pure.
 *
 * Without `carry` this is the drawn geometry (the art's). The engine passes the planned speed:
 * on faster laps the runner who stays in an ending lane starts being carried earlier, along a
 * longer taper (MERGE_TIME × speed) that ends at the same place; before the drawn taper starts
 * that keeps them well inside the lane's own width.
 */
export function laneOffsetAt(track: MergeTrack, lane: number, s: number): number {
  const g = geometry(track);
  const k = track.stretchIndexAt(s);
  const w = wrapS(track, s);
  return offsetIn(track, g, k, lane, w, undefined, s - w);
}

/**
 * Lanes the HUD shows at s: false for a lane past the midpoint of its (drawn) taper (the runner
 * can no longer be in it as a separate lane), and for a lane already merged away.
 */
export function laneShownAt(track: MergeTrack, lane: number, s: number): boolean {
  const g = geometry(track);
  const k = track.stretchIndexAt(s);
  const w = wrapS(track, s);
  const opening = g.beginIn[k]?.[lane];
  if (opening && w < (opening.from + opening.to) / 2) return false;
  const m = g.byLane[k]?.[lane];
  if (m) return w < (m.s0 + m.s1) / 2;
  // A taper of the next stretch that starts here (its lane continues from this one).
  const pre = g.preByLane[k]?.[lane];
  if (!pre) return true;
  const shift = (k + 1) % track.stretches.length === 0 ? track.lapLength : 0;
  return w < (pre.m.s0 + pre.m.s1) / 2 + shift;
}

/** The merge lane `lane` (index in the layout at s) is in or heading for in its own stretch, if any. */
export function mergeOf(track: MergeTrack, lane: number, s: number): LaneMerge | undefined {
  const g = geometry(track);
  return g.byLane[track.stretchIndexAt(s)]?.[lane];
}

/** Follow completed tapers inside stretch k up to lap-relative w. */
function settle(g: Geometry, k: number, lane: number, w: number): number {
  for (let guard = 0; guard < 8; guard++) {
    const m = g.byLane[k]?.[lane];
    if (!m || w < m.s1) return lane;
    lane = m.into;
  }
  return lane;
}

/**
 * The index lane `lane` (in the layout at `fromS`) has at `toS` ≥ fromS: through the boundaries'
 * lane maps, and handed to its merge target once a taper is complete. Undefined when the lane
 * cannot be followed (it ends without a target).
 */
export function followLane(track: MergeTrack, lane: number, fromS: number, toS: number): number | undefined {
  const g = geometry(track);
  const NS = track.stretches.length;
  let k = track.stretchIndexAt(fromS);
  const kTo = track.stretchIndexAt(toS);
  let l = lane;
  for (let guard = 0; guard <= NS && (k !== kTo || guard === 0 && toS - fromS >= track.lapLength); guard++) {
    l = settle(g, k, l, Infinity);
    const t = g.after[k];
    if (t) {
      const j = t.map[l];
      if (j === null || j === undefined) return undefined;
      l = j;
    }
    k = (k + 1) % NS;
  }
  return settle(g, kTo, l, wrapS(track, toS));
}

/** Is lane `lane` (index in the layout at s) still there (not merged away) at s? */
export function laneOpenAt(track: MergeTrack, lane: number, s: number): boolean {
  const g = geometry(track);
  const k = track.stretchIndexAt(s);
  const w = wrapS(track, s);
  // A ring lane still opening out of its neighbour is not there yet.
  const opening = g.beginIn[k]?.[lane];
  if (opening && w < opening.to) return false;
  const m = g.byLane[k]?.[lane];
  return !m || w < m.s1;
}

/**
 * The next taper of lane `lane` (index in the layout at s) within `horizon` m, following it
 * through the boundaries: its start and end as unbounded distances, and the side its target is on.
 */
export function laneMergeAhead(track: MergeTrack, lane: number, s: number, horizon: number): { s0: number; s1: number; side: -1 | 1 } | null {
  const g = geometry(track);
  const NS = track.stretches.length;
  const L = track.lapLength;
  let k = track.stretchIndexAt(s);
  const w = wrapS(track, s);
  let base = s - w; // start of the current lap (unbounded)
  let l = lane;
  for (let guard = 0; guard <= NS; guard++) {
    const st = track.stretches[k]!;
    if (base + st.fromS > s + horizon) return null;
    const m = g.byLane[k]?.[l];
    if (m && base + m.s1 > s) {
      const lay = st.layout.offsets;
      const side = (lay[m.into] ?? 0) > (lay[m.lane] ?? 0) ? 1 : -1;
      return base + m.s0 > s + horizon ? null : { s0: base + m.s0, s1: base + m.s1, side };
    }
    const t = g.after[k];
    if (t) {
      const j = t.map[settle(g, k, l, Infinity)];
      if (j === null || j === undefined) return null;
      l = j;
    }
    k = (k + 1) % NS;
    if (k === 0) base += L;
  }
  return null;
}
