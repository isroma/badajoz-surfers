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
  /** The underlying track model (the engine maps track space to the world with it). */
  readonly track: Track;
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
    track,
  };
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
