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
import { getCourse } from "./course";
import { zoneAt } from "./tuning";

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
