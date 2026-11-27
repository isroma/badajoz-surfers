/**
 * Lane merges: where a lane ends at a stretch boundary (`track.transitions`, map entry null) it
 * tapers into its neighbour over its last 60 m (two lanes ending on one side merge in sequence,
 * outermost first, over [−120, −60] and [−60, 0] m); lanes that begin open with the mirror taper
 * over 20 m. Geometry comes straight from the engine (src/game/lanes.ts `merges` / `laneOffsetAt`).
 */
import type { LaneLayout, Track } from "./track";
import { laneOffsetAt, merges as engineMerges } from "../../game/lanes";

export const MERGE_LEN = 60;
export const OPEN_LEN = 20;

export interface LaneMerge {
  /** Taper window in s (s0 < s1); the lane is gone (merged) at s1, or fully open at s1 for `begins`. */
  s0: number;
  s1: number;
  /** The lane's layout and index (the stretch before for endings, after for beginnings). */
  layout: LaneLayout;
  lane: number;
  kind: string;
  /** Outer edge of the lane (the side that vanishes) at full width and fully merged. */
  edgeFull: number;
  edgeGone: number;
  /** +1: the lane vanishes towards larger laterals (its outer edge is on the right), else -1. */
  side: 1 | -1;
  begins: boolean;
  track: Track;
}


/** The outer edge of a merging lane at s: the engine's lane centre (laneOffsetAt) + half its width. */
export function mergeEdgeAt(m: LaneMerge, s: number): number {
  const w = (m.layout.widths[m.lane] ?? 3) / 2;
  const c = laneOffsetAt(m.track, m.lane, Math.min(s, m.s1 - 0.01));
  return Math.max(Math.min(c + m.side * w, Math.max(m.edgeFull, m.edgeGone)), Math.min(m.edgeFull, m.edgeGone));
}

const cache = new WeakMap<Track, LaneMerge[]>();

/** The engine's merges (src/game/lanes.ts), as the art draws them: the funnel IS the runner's path. */
export function laneMerges(track: Track): LaneMerge[] {
  const hit = cache.get(track);
  if (hit) return hit;
  const out: LaneMerge[] = [];
  for (const m of engineMerges(track)) {
    const layout = track.stretches[m.fromStretch]?.layout;
    if (!layout) continue;
    const o = layout.offsets[m.lane] ?? 0;
    const oi = layout.offsets[m.into] ?? 0;
    const side: 1 | -1 = o < oi ? -1 : 1;
    const w = (layout.widths[m.lane] ?? 3) / 2;
    out.push({
      s0: m.s0, s1: m.s1, layout, lane: m.lane, kind: layout.kinds[m.lane] as string,
      edgeFull: o + side * w, edgeGone: oi + side * ((layout.widths[m.into] ?? 3) / 2), side, begins: false,
      track,
    });
  }
  cache.set(track, out);
  return out;
}

/** Merges whose taper overlaps [a, b). */
export function mergesIn(track: Track, a: number, b: number): LaneMerge[] {
  return laneMerges(track).filter((m) => m.s1 > a && m.s0 < b);
}
