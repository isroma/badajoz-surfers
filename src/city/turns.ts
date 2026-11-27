/**
 * Guide data for bends and roundabouts (for chevrons, painted arrows and the shell).
 *
 * A bend = a run of samples with |curvature| ≥ BEND_ON of one sign (runs of the same sign less
 * than BEND_JOIN apart are merged). Kept when its heading change is ≥ MIN_TURN_ANGLE or its
 * tightest radius < MAX_TURN_RADIUS (and it turns ≥ MIN_TIGHT_ANGLE). Every roundabout pass (ring section ± RING_REACH) becomes ONE
 * turn with `roundabout: true` that swallows the entry / around / exit bends; its direction is
 * that of the net heading change when ≥ MIN_TURN_ANGLE, else that of the ring itself.
 */
import type { CitySection } from "./data";
import type { TrackFrame } from "./track";

export interface Turn {
  /** Start of the turn (wrapped into [0, lap)). */
  s: number;
  /** End of the turn: s + its length (may exceed the lap length). */
  endS: number;
  direction: "left" | "right";
  /** Total heading change, degrees (absolute; for roundabouts the net entry→exit change). */
  angle: number;
  /** Tightest radius (m); for roundabouts the ring's real radius. */
  radius: number;
  roundabout: boolean;
  /** Ring section bounds for roundabouts (null otherwise). */
  entryS: number | null;
  exitS: number | null;
  /** First street name after the turn. */
  exitName: string | null;
}

export const BEND_ON = 1 / 300;
export const BEND_JOIN = 25;
export const MIN_TURN_ANGLE = 25;
export const MAX_TURN_RADIUS = 60;
export const RING_REACH = 40;
/** A tight (< MAX_TURN_RADIUS) bend must still turn at least this much (filters kinks). */
export const MIN_TIGHT_ANGLE = 15;
/** turnAhead looks this far. */
export const TURN_LOOKAHEAD = 150;

interface Region {
  a: number;
  b: number;
  sign: number;
  kMax: number;
}

const DEG = 180 / Math.PI;

export function findTurns(
  lap: number,
  frameAt: (s: number, out: TrackFrame) => TrackFrame,
  sections: readonly CitySection[],
  streetNameAt: (s: number) => string | null,
  frame: TrackFrame,
): Turn[] {
  const step = 1;
  const N = Math.ceil(lap / step);
  const curv = new Float64Array(N);
  for (let i = 0; i < N; i++) curv[i] = frameAt(i * step, frame).curvature;
  // Start the scan at the straightest sample so no bend straddles the scan seam.
  let s0i = 0;
  for (let i = 1; i < N; i++) if (Math.abs(curv[i]!) < Math.abs(curv[s0i]!)) s0i = i;
  const heading = (s: number): number => frameAt(s, frame).heading;
  const wrap = (s: number): number => s - lap * Math.floor(s / lap);

  // Regions in unwrapped s from s0.
  const regions: Region[] = [];
  let cur: Region | null = null;
  for (let k = 0; k <= N; k++) {
    const i = (s0i + k) % N;
    const kk = curv[i]!;
    const s = s0i * step + k * step;
    const on = Math.abs(kk) >= BEND_ON;
    const sign = Math.sign(kk);
    if (on && cur && cur.sign === sign) {
      cur.b = s;
      cur.kMax = Math.max(cur.kMax, Math.abs(kk));
    } else {
      if (cur) regions.push(cur);
      cur = on ? { a: s, b: s, sign, kMax: Math.abs(kk) } : null;
    }
  }
  if (cur) regions.push(cur);
  // Join same-sign regions separated by a short straight.
  const joined: Region[] = [];
  for (const r of regions) {
    const last = joined[joined.length - 1];
    if (last && last.sign === r.sign && r.a - last.b < BEND_JOIN) {
      last.b = r.b;
      last.kMax = Math.max(last.kMax, r.kMax);
    } else joined.push({ ...r });
  }

  // Ring spans in the same unwrapped frame.
  const s0 = s0i * step;
  const unwrap = (s: number): number => (s < s0 ? s + lap : s);
  const rings: { a: number; b: number; entry: number; exit: number; r: number }[] = [];
  for (const sec of sections) {
    if (!sec.roundabout || sec.pedestrian) continue;
    const entry = unwrap(sec.fromS);
    const exit = entry + (sec.toS - sec.fromS);
    const last = rings[rings.length - 1];
    if (last && Math.abs(last.exit - entry) < 1) {
      last.exit = exit;
      last.b = exit + RING_REACH;
    } else rings.push({ a: entry - RING_REACH, b: exit + RING_REACH, entry, exit, r: sec.roundabout.r });
  }

  const nameAfter = (s: number): string | null => {
    for (let d = 1; d <= 300; d += 5) {
      const n = streetNameAt(wrap(s + d));
      if (n) return n;
    }
    return null;
  };
  const mk = (a: number, b: number, radius: number, ring: (typeof rings)[number] | null): Turn => {
    const net = (heading(b) - heading(a)) * DEG;
    let dirSign = Math.sign(net);
    if (ring && Math.abs(net) < MIN_TURN_ANGLE) dirSign = Math.sign(heading(ring.exit) - heading(ring.entry));
    // heading = atan2(tx, tz) grows when turning left (towards −n).
    return {
      s: wrap(a),
      endS: wrap(a) + (b - a),
      direction: dirSign > 0 ? "left" : "right",
      angle: Math.abs(net),
      radius,
      roundabout: ring !== null,
      entryS: ring ? wrap(ring.entry) : null,
      exitS: ring ? wrap(ring.exit) : null,
      exitName: nameAfter(b),
    };
  };

  const used = new Set<Region>();
  const turns: Turn[] = [];
  for (const ring of rings) {
    let a = ring.entry;
    let b = ring.exit;
    for (const r of joined) {
      if (r.b >= ring.a && r.a <= ring.b) {
        used.add(r);
        a = Math.min(a, Math.max(r.a, ring.a));
        b = Math.max(b, Math.min(r.b, ring.b));
      }
    }
    turns.push(mk(a, b, ring.r, ring));
  }
  for (const r of joined) {
    if (used.has(r)) continue;
    const t = mk(r.a, r.b, 1 / r.kMax, null);
    if (t.angle >= MIN_TURN_ANGLE || (t.radius < MAX_TURN_RADIUS && t.angle >= MIN_TIGHT_ANGLE)) turns.push(t);
  }
  turns.sort((x, y) => x.s - y.s);
  return turns;
}
