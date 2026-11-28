/**
 * The course: what the gameplay needs to know about the real lap, in track space (distance s
 * along the route, lateral metres + to the runner's right). Built once from the city data and the
 * track model (src/city); pure, no three.js.
 *
 * The engine installs one course with `setCourse` at start-up; tuning (zones, lap length) and the
 * lane layouts read it. Without a course (some unit tests) the old straight 3-lane stand-in is
 * used.
 */
import type { CityData } from "../city/data";
import type { Track } from "../city/track";
import type { LaneLayout as CityLaneLayout } from "../city/lanes";
import type { ZoneId } from "../contracts";
import { YAW_RATE_MAX, headingTarget } from "./turning";

/** A stop line: a real traffic signal or zebra crossing on the route. */
export interface StopLine {
  s: number;
  kind: "signal" | "crossing" | "giveway";
}

export interface CourseZone {
  id: ZoneId;
  fromS: number;
  toS: number;
}

/** A lane-layout boundary: which lane of the old layout continues as which lane of the new one. */
export interface LaneTransition {
  /** Distance of the boundary within the lap. */
  s: number;
  /** map[oldLane] = newLane, or null when the old lane ends there. */
  map: readonly (number | null)[];
}

/** A turn of the route worth announcing (a bend sharper than a gentle curve, or a roundabout). */
export interface Turn {
  /** Where the turn starts (within the lap). */
  s: number;
  /** Where it ends (may exceed the lap length). */
  endS: number;
  /** "straight" = through a roundabout (net turn under 20°). */
  direction: "left" | "right" | "straight";
  roundabout: boolean;
  street: string | null;
}

export interface Course {
  readonly lapLength: number;
  readonly zones: readonly CourseZone[];
  layoutAt(s: number): CityLaneLayout;
  streetNameAt(s: number): string | null;
  /** Usable clearance between facades (m) at s, when known (narrow old-town streets). */
  clearanceAt(s: number): number | null;
  /** Signals and crossings on the route, sorted by s (one lap). */
  readonly stopLines: readonly StopLine[];
  /** Bus stops beside our carriageway (right side), sorted by s. */
  readonly busStops: readonly { s: number; lateral: number; name: string | null }[];
  /** Bars, cafés and restaurants beside the route (to put their terraces outside), sorted by s. */
  readonly bars: readonly { s: number; side: "left" | "right"; name: string }[];
  /** Trees near the route in track space (median and sidewalk lanes keep clear of them), sorted by s. */
  readonly trees: readonly { s: number; lateral: number; r: number }[];
  /** Stretches under real arches and gates: nothing tall there (no vehicles, scaffolds or banners). */
  readonly lowClearance: readonly [number, number][];
  /**
   * Where the route runs through a building (OSM tunnel sections and building passages: Arco del
   * Peso, Puerta de Palmas), lap-relative [from, to], sorted: see `inPassage`.
   */
  readonly passages: readonly [number, number][];
  /** Layout boundaries with their lane maps, sorted by s (one lap). */
  readonly transitions: readonly LaneTransition[];
  /** Turns to announce, sorted by s (one lap). */
  readonly turns: readonly Turn[];
  /** The underlying track model (the engine maps track space to the world with it). */
  readonly track: Track;
  /**
   * Building walls beside the route, per metre of the lap (built on first use, then free): see
   * `wallsBetween`.
   */
  walls(): Walls;
  /**
   * The route's bendiness, per metre (built on first use): |curvature| averaged over 15 m, and
   * the pace factor it gives (see `paceFactor`), eased over PACE_EASE m.
   */
  bends(): Bends;
}

export interface Bends {
  /** Smoothed |curvature| (1/m) per metre of the lap. */
  readonly curvature: Float32Array;
  /** Speed factor per metre of the lap (PACE_MIN..1). */
  readonly pace: Float32Array;
  /**
   * Highest speed (m/s) per metre at which the chase camera's smoothed heading (turning.ts) turns
   * no faster than PACE_YAW_RATE, eased in over CAP_EASE m: the run never outpaces the camera.
   */
  readonly cap: Float32Array;
}

/**
 * The pace keeps the camera's smoothed heading turning no faster than this (just over its soft
 * yaw cap: the runner then stays well inside the middle of the screen even on lap 4).
 */
export const PACE_YAW_RATE = 1.2 * YAW_RATE_MAX;
/** The speed cap through bends eases in over at least this many metres. */
export const CAP_EASE = 24;

/** Tight bends slow the run down to this factor (at radius PACE_TIGHT m), not at all from PACE_OPEN m. */
export const PACE_MIN = 0.85;
export const PACE_TIGHT = 12;
export const PACE_OPEN = 35;
/** The pace eases over this many metres. */
export const PACE_EASE = 16;

/** Speed factor for a bend of radius `r` (m). Pure. */
export function paceFactor(r: number): number {
  const t = Math.min(1, Math.max(0, (PACE_OPEN - r) / (PACE_OPEN - PACE_TIGHT)));
  return 1 - (1 - PACE_MIN) * t * t * (3 - 2 * t);
}

function buildBends(track: Track): Bends {
  const L = track.lapLength;
  const n = Math.ceil(L) + 1;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = Math.abs(track.frameAt(i).curvature);
  // Moving averages over the lap (wrapping): 15 m of curvature, then PACE_EASE m of pace.
  const average = (src: Float32Array, half: number): Float32Array => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = -half; j <= half; j++) sum += src[(((i + j) % (n - 1)) + (n - 1)) % (n - 1)] ?? 0;
      out[i] = sum / (2 * half + 1);
    }
    return out;
  };
  const curvature = average(raw, 7);
  const pace0 = new Float32Array(n);
  for (let i = 0; i < n; i++) pace0[i] = paceFactor(1 / Math.max(1e-6, curvature[i] ?? 0));
  // Ease: the slowest of the coming PACE_EASE/2 m, then a moving average (slows before the bend).
  const ahead = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 1;
    for (let j = 0; j <= PACE_EASE / 2; j++) m = Math.min(m, pace0[(i + j) % (n - 1)] ?? 1);
    ahead[i] = m;
  }
  // Yaw demand: the camera's smoothed heading, per metre; the speed that keeps its rate at 90% of
  // PACE_YAW_RATE (Constitución, Minayo: ~12 m/s); the lowest of the coming CAP_EASE m, averaged.
  const heading = (x: number): number => track.frameAt(x).heading;
  const target = new Float64Array(n + 2);
  for (let i = -1; i <= n; i++) target[i + 1] = headingTarget(heading, i);
  const want = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const rate = Math.abs((target[i + 2] ?? 0) - (target[i] ?? 0)) / 2;
    want[i] = Math.min(60, (0.9 * PACE_YAW_RATE) / Math.max(1e-6, rate));
  }
  const soon = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 60;
    for (let j = 0; j <= CAP_EASE; j++) m = Math.min(m, want[(i + j) % (n - 1)] ?? 60);
    soon[i] = m;
  }
  const cap = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 60;
    for (let j = -CAP_EASE / 2; j <= 0; j++) m = Math.min(m, soon[(((i + j) % (n - 1)) + (n - 1)) % (n - 1)] ?? 60);
    cap[i] = m;
  }
  return { curvature, pace: average(ahead, PACE_EASE / 2), cap: average(cap, CAP_EASE / 2) };
}

/** Value of a per-metre lap table at distance s (any lap), linearly interpolated. */
export function tableAt(table: Float32Array, lapLength: number, s: number): number {
  const w = ((s % lapLength) + lapLength) % lapLength;
  const i = Math.floor(w);
  const f = w - i;
  const a = table[i] ?? 0;
  const b = table[Math.min(table.length - 1, i + 1)] ?? a;
  return a + (b - a) * f;
}

/**
 * The nearest building wall on each side of the route centreline, per metre of the lap (bin i
 * covers [i, i + 1) m): `left[i]` ≤ 0 (lateral of the nearest wall on the runner's left), `right[i]`
 * ≥ 0; ±WALL_FAR when there is none within WALL_FAR. Inside passages (tunnels, arches) the
 * section's clearance stands in for the walls of the building the route runs through.
 */
export interface Walls {
  readonly left: Float32Array;
  readonly right: Float32Array;
}

/** Walls further than this from the centreline are ignored. */
export const WALL_FAR = 30;

/** Shapes the reworked city core may provide (read defensively: older cores lack them). */
interface CoreExtras {
  transitions?: readonly { s?: number; fromS?: number; at?: number; map?: readonly (number | null | undefined)[] }[];
  turns?: readonly { s?: number; endS?: number; direction?: string; angle?: number; roundabout?: boolean; exitName?: string | null; street?: string | null }[];
}

const sameKindFlow = (a: CityLaneLayout, i: number, b: CityLaneLayout, j: number): boolean =>
  a.kinds[i] === b.kinds[j] && a.flow[i] === b.flow[j];

/**
 * Lane maps at every layout boundary: the core's when it provides them; else each lane continues
 * as the nearest lane of the same kind and flow within 3.5 m (else the nearest lane within 3.5 m),
 * and ends when there is none.
 */
function buildTransitions(track: Track): LaneTransition[] {
  const extras = track as Track & CoreExtras;
  if (Array.isArray(extras.transitions) && extras.transitions.length > 0) {
    return extras.transitions
      .map((t) => ({ s: t.s ?? t.fromS ?? t.at ?? 0, map: (t.map ?? []).map((v: number | null | undefined) => (typeof v === "number" && v >= 0 ? v : null)) }))
      .sort((a, b) => a.s - b.s);
  }
  const out: LaneTransition[] = [];
  const st = track.stretches;
  for (let k = 0; k < st.length; k++) {
    const prev = st[(k + st.length - 1) % st.length];
    const cur = st[k];
    if (!prev || !cur) continue;
    const a = prev.layout;
    const b = cur.layout;
    const map = a.offsets.map((x, i) => {
      let best: number | null = null;
      let bestD = 3.5;
      for (let pass = 0; pass < 2 && best === null; pass++) {
        for (let j = 0; j < b.offsets.length; j++) {
          if (pass === 0 && !sameKindFlow(a, i, b, j)) continue;
          const d = Math.abs((b.offsets[j] ?? 0) - x);
          if (d <= bestD) {
            best = j;
            bestD = d;
          }
        }
      }
      return best;
    });
    out.push({ s: cur.fromS, map });
  }
  return out.sort((x, y) => x.s - y.s);
}

/** Turns: the core's when provided, else every stretch of ≥ 25° of heading change within 40 m, and every roundabout. */
function buildTurns(track: Track): Turn[] {
  const extras = track as Track & CoreExtras;
  if (Array.isArray(extras.turns) && extras.turns.length > 0) {
    return extras.turns
      .map((t): Turn => {
        const roundabout = t.roundabout === true;
        const straight = roundabout && Math.abs(t.angle ?? 90) < 20;
        return {
          s: t.s ?? 0,
          endS: t.endS ?? (t.s ?? 0) + 30,
          direction: straight ? "straight" : t.direction === "left" ? "left" : "right",
          roundabout,
          street: t.exitName ?? t.street ?? null,
        };
      })
      .sort((a, b) => a.s - b.s);
  }
  const out: Turn[] = [];
  const step = 5;
  const window = 40;
  let lastEnd = -Infinity;
  for (let s = 0; s < track.lapLength; s += step) {
    const sec = track.sectionAt(s);
    const ring = sec.roundabout !== null;
    const h0 = track.frameAt(s).heading;
    const h1 = track.frameAt(s + window).heading;
    // heading grows when turning left (towards -n)
    const turn = h1 - h0;
    if (s < lastEnd) continue;
    if (Math.abs(turn) > (25 * Math.PI) / 180 || (ring && !track.sectionAt(s - step).roundabout)) {
      const roundabout = ring || track.sectionAt(s + window / 2).roundabout !== null;
      // on a roundabout the way you go is where you leave it: the net turn over the ring
      let dir = turn;
      if (roundabout) {
        let e = s;
        while (e < s + 400 && track.sectionAt(e).roundabout !== null) e += step;
        dir = track.frameAt(e + 10).heading - track.frameAt(s - 10).heading;
        lastEnd = e;
      } else lastEnd = s + window;
      out.push({ s, endS: lastEnd, direction: roundabout && Math.abs(dir) < (20 * Math.PI) / 180 ? "straight" : dir > 0 ? "left" : "right", roundabout, street: track.streetNameAt(s + window) });
    }
  }
  return out;
}

const CROSSING_LATERAL = 12;
const BUS_STOP_LATERAL = 12;
const TREE_LATERAL = 26;

/** Build the course from the city data and its track. */
export function buildCourse(city: CityData, track: Track): Course {
  const lap = track.lapLength;
  const stopLines: StopLine[] = [];
  const busStops: { s: number; lateral: number; name: string | null }[] = [];
  for (const f of city.furniture) {
    if ((f.type === "traffic_signals" || f.type === "crossing") && Math.abs(f.lateral) < CROSSING_LATERAL) {
      stopLines.push({ s: f.s, kind: f.type === "traffic_signals" ? "signal" : "crossing" });
    }
    if (f.type === "bus_stop" && f.lateral > 0 && f.lateral < BUS_STOP_LATERAL) busStops.push({ s: f.s, lateral: f.lateral, name: f.name ?? null });
  }
  // Give way at roundabout entries.
  for (let i = 0; i < track.stretches.length; i++) {
    const st = track.stretches[i];
    const prev = track.stretches[(i + track.stretches.length - 1) % track.stretches.length];
    if (st && prev && st.section.roundabout && !prev.section.roundabout) stopLines.push({ s: Math.max(0, st.fromS - 2), kind: "giveway" });
  }
  stopLines.sort((a, b) => a.s - b.s);
  busStops.sort((a, b) => a.s - b.s);
  const bars = city.pois
    .filter((p) => /^amenity:(bar|cafe|restaurant|pub|ice_cream|fast_food)$/.test(p.category) && p.dist < 30)
    .map((p) => ({ s: p.s, side: p.side, name: p.name }))
    .sort((a, b) => a.s - b.s);

  // Trees: project onto the route through a coarse grid of route samples (then a local refine).
  const pts = city.route.points;
  const S = city.route.s;
  const cell = 30;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < S.length; i++) {
    const key = `${Math.floor((pts[i * 3] ?? 0) / cell)},${Math.floor((pts[i * 3 + 1] ?? 0) / cell)}`;
    let list = grid.get(key);
    if (!list) grid.set(key, (list = []));
    list.push(i);
  }
  let walls: Walls | null = null;
  let bends: Bends | null = null;
  const trees: { s: number; lateral: number; r: number }[] = [];
  const T = city.trees;
  for (let i = 0; i + 4 < T.length; i += 5) {
    const x = T[i] ?? 0;
    const z = T[i + 1] ?? 0;
    const gx = Math.floor(x / cell);
    const gz = Math.floor(z / cell);
    let best = -1;
    let bestD = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const k of grid.get(`${gx + dx},${gz + dz}`) ?? []) {
          const d = Math.hypot((pts[k * 3] ?? 0) - x, (pts[k * 3 + 1] ?? 0) - z);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
      }
    }
    if (best < 0 || bestD > TREE_LATERAL + 5) continue;
    const p = track.project(x, z, S[best] ?? 0);
    if (Math.abs(p.lateral) > TREE_LATERAL) continue;
    const s = ((p.s % lap) + lap) % lap;
    // Trunk plus a little: the crown is above the runner, the trunk is what matters.
    trees.push({ s, lateral: p.lateral, r: 0.6 });
  }
  trees.sort((a, b) => a.s - b.s);

  const lowClearance: [number, number][] = [];
  for (const p of city.meta.passesThrough) if (p.passage) lowClearance.push([p.s[0] - 30, p.s[1] + 30]);
  for (const l of city.landmarks) {
    if ((l.id === "puerta-palmas" || l.id === "puerta-capitel" || l.id === "puerta-pilar") && l.s !== undefined && Math.abs(l.lateral ?? 99) < 25) {
      lowClearance.push([l.s - 25, l.s + 25]);
    }
  }
  lowClearance.sort((a, b) => a[0] - b[0]);
  const passages: [number, number][] = [];
  for (const sec of city.sections) if (sec.tunnel) passages.push([sec.fromS, sec.toS]);
  for (const p of city.meta.passesThrough) if (p.passage) passages.push([p.s[0], p.s[1]]);
  passages.sort((a, b) => a[0] - b[0]);
  // Overlapping ones (a tunnel section inside its building passage) become one.
  const merged: [number, number][] = [];
  for (const p of passages) {
    const last = merged[merged.length - 1];
    if (last && p[0] <= last[1]) last[1] = Math.max(last[1], p[1]);
    else merged.push([p[0], p[1]]);
  }

  return {
    lapLength: lap,
    zones: track.zones.map((z) => ({ id: z.id, fromS: z.fromS, toS: z.toS })),
    layoutAt: (s) => track.layoutAt(s),
    streetNameAt: (s) => track.streetNameAt(s),
    clearanceAt: (s) => {
      const sec = track.sectionAt(s);
      return sec.clearance ?? sec.facadeWidth ?? null;
    },
    stopLines,
    busStops,
    bars,
    trees,
    lowClearance,
    passages: merged,
    transitions: buildTransitions(track),
    turns: buildTurns(track),
    track,
    walls: () => (walls ??= buildWalls(city, track)),
    bends: () => (bends ??= buildBends(track)),
  };
}

/**
 * The city core's building walls (track.walls, src/city/walls.ts); inside tunnel sections the
 * section's clearance stands in for the building the route runs through.
 */
function buildWalls(city: CityData, track: Track): Walls {
  const left = Float32Array.from(track.walls.left);
  const right = Float32Array.from(track.walls.right);
  const n = left.length;
  // Buildings the route runs through or under (arcades, overhangs: meta.passesThrough) are not
  // walls for the camera: such a bin takes the nearest ordinary wall within 15 m on that side.
  const through = new Set(city.meta.passesThrough.map((p) => p.id));
  const fill = (out: Float32Array, src: Float32Array, who: Int32Array, far: number): void => {
    const flagged = (i: number): boolean => {
      const b = who[i] ?? -1;
      return b >= 0 && through.has(city.buildings[b]?.id ?? "");
    };
    for (let i = 0; i < n; i++) {
      if (!flagged(i)) continue;
      let v = far;
      for (let d = 1; d <= 15; d++) {
        for (const j of [i - d, i + d]) {
          const k = ((j % n) + n) % n;
          if (!flagged(k)) v = far < 0 ? Math.max(v, src[k] ?? far) : Math.min(v, src[k] ?? far);
        }
        if (v !== far) break;
      }
      out[i] = v;
    }
  };
  fill(left, track.walls.left, track.walls.leftBuilding, -WALL_FAR);
  fill(right, track.walls.right, track.walls.rightBuilding, WALL_FAR);
  for (const sec of city.sections) {
    if (!sec.tunnel) continue;
    const half = (sec.clearance ?? sec.facadeWidth ?? sec.width) / 2;
    for (let i = Math.floor(sec.fromS); i < Math.ceil(sec.toS) && i < n; i++) {
      left[i] = Math.max(left[i] ?? -WALL_FAR, -half);
      right[i] = Math.min(right[i] ?? WALL_FAR, half);
    }
  }
  return { left, right };
}

/** The tightest walls (left ≤ 0 ≤ right, track lateral) over the route between s0 and s1 (any lap). */
export function wallsBetween(walls: Walls, lapLength: number, s0: number, s1: number, out: { left: number; right: number }): { left: number; right: number } {
  let l = -WALL_FAR;
  let r = WALL_FAR;
  const n = walls.left.length;
  for (let s = Math.floor(s0); s <= Math.floor(s1); s++) {
    const i = ((s % lapLength) + lapLength) % lapLength;
    const bin = Math.min(n - 1, Math.floor(i));
    l = Math.max(l, walls.left[bin] ?? -WALL_FAR);
    r = Math.min(r, walls.right[bin] ?? WALL_FAR);
  }
  out.left = l;
  out.right = r;
  return out;
}

let current: Course | null = null;
const listeners: ((c: Course | null) => void)[] = [];

/** Install the course for the whole engine (tuning, lanes, generator). */
export function setCourse(course: Course | null): void {
  current = course;
  for (const l of listeners) l(course);
}

export function getCourse(): Course | null {
  return current;
}

/** Called whenever the course changes (tuning keeps its zone tables in sync). */
export function onCourse(listener: (c: Course | null) => void): void {
  listeners.push(listener);
  // A module loaded after the course was installed still gets it.
  if (current) listener(current);
}

/** Entries of a sorted-by-s list within [from, to) of the unbounded distance (wraps laps). */
export function inRange<T extends { s: number }>(list: readonly T[], lapLength: number, from: number, to: number): { item: T; s: number }[] {
  const out: { item: T; s: number }[] = [];
  if (list.length === 0 || to <= from) return out;
  const firstLap = Math.floor(from / lapLength);
  const lastLap = Math.floor(to / lapLength);
  for (let k = firstLap; k <= lastLap; k++) {
    const base = k * lapLength;
    for (const item of list) {
      const s = item.s + base;
      if (s >= from && s < to) out.push({ item, s });
    }
  }
  return out;
}

/** Is [from, to] (unbounded distance) inside a low-clearance stretch (an arch, a gate)? */
export function underArch(course: Course | null, from: number, to: number): boolean {
  if (!course) return false;
  const L = course.lapLength;
  for (const [a, b] of course.lowClearance) {
    for (let k = Math.floor(from / L) - 1; k <= Math.floor(to / L) + 1; k++) {
      if (to > a + k * L && from < b + k * L) return true;
    }
  }
  return false;
}

/** Nothing (no obstacle, no pickup above PASSAGE_PICKUP_Y) from this far before a passage... */
export const PASSAGE_BEFORE = 15;
/** ...to this far after it. */
export const PASSAGE_AFTER = 10;
export const PASSAGE_PICKUP_Y = 1.2;

/** Does [from, to] (unbounded distance) touch a passage under a building, with its margins? */
export function inPassage(course: Course | null, from: number, to: number): boolean {
  if (!course) return false;
  const L = course.lapLength;
  for (const [a, b] of course.passages) {
    for (let k = Math.floor(from / L) - 1; k <= Math.floor(to / L) + 1; k++) {
      if (to > a - PASSAGE_BEFORE + k * L && from < b + PASSAGE_AFTER + k * L) return true;
    }
  }
  return false;
}

/** The lane `lane` continues as after the layout boundary between `fromS` and `toS` (or null: it ends). */
export function mapLane(course: Course | null, fromS: number, toS: number, lane: number): number | null | undefined {
  if (!course) return undefined;
  const L = course.lapLength;
  for (const { item } of inRange(course.transitions, L, fromS - 0.5, toS + 0.5)) return item.map[lane] ?? null;
  return undefined;
}

/** Distance ahead (from s) to where `lane` ends, within `horizon` metres, or null. */
export function laneEndAhead(course: Course | null, s: number, lane: number, horizon: number): number | null {
  if (!course) return null;
  let l: number | null = lane;
  for (const { item, s: at } of inRange(course.transitions, course.lapLength, s + 0.01, s + horizon)) {
    if (l === null) break;
    const next: number | null = item.map[l] ?? null;
    if (next === null) return at - s;
    l = next;
  }
  return null;
}
