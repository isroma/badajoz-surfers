/**
 * Guide data for bends and roundabouts (for chevrons, painted arrows and the shell).
 *
 * A bend = a run of samples with |curvature| ≥ BEND_ON of one sign (runs of the same sign less
 * than BEND_JOIN apart are merged). Kept when its heading change is ≥ MIN_TURN_ANGLE or its
 * tightest radius < MAX_TURN_RADIUS (and it turns ≥ MIN_TIGHT_ANGLE). Every roundabout pass
 * (city.roundabouts passFromS..passToS) is ONE turn with `roundabout: true` covering entry,
 * circulation and exit; its direction is that of the net heading change over the pass, or
 * "straight" under STRAIGHT_ANGLE; exitName is the exit arm's name. Bends inside a pass are not
 * listed separately.
 */
import type { TrackFrame } from "./track";

export interface Turn {
  /** Start of the turn (wrapped into [0, lap)). */
  s: number;
  /** End of the turn: s + its length (may exceed the lap length). */
  endS: number;
  /** "straight" only for roundabout passes whose net heading change is < STRAIGHT_ANGLE. */
  direction: "left" | "right" | "straight";
  /** Total heading change, degrees (absolute; for roundabouts the net change over the pass). */
  angle: number;
  /** Tightest radius (m); for roundabouts the data's minRadius of the solved line. */
  radius: number;
  roundabout: boolean;
  /** Ring arc bounds for roundabouts (null otherwise). */
  entryS: number | null;
  exitS: number | null;
  /** Degrees the route goes round the ring centre (data `sweep`, anticlockwise +), null for bends. */
  sweep: number | null;
  /** First street name after the turn. */
  exitName: string | null;
}

export const BEND_ON = 1 / 300;
export const BEND_JOIN = 25;
export const MIN_TURN_ANGLE = 25;
export const MAX_TURN_RADIUS = 60;
/** Roundabout passes turning less than this (degrees, net) are "straight". */
export const STRAIGHT_ANGLE = 20;
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

/** Roundabout fields findTurns needs (city.roundabouts entries fit). */
export interface TurnRoundabout {
  entryS: number;
  exitS: number;
  passFromS: number;
  passToS: number;
  sweep: number;
  minRadius: number;
  arms: readonly { name: string | null; onRoute: "entry" | "exit" | "entry-exit" | null }[];
}

export function findTurns(
  lap: number,
  frameAt: (s: number, out: TrackFrame) => TrackFrame,
  roundabouts: readonly TurnRoundabout[],
  streetNameAt: (s: number) => string | null,
  frame: TrackFrame,
): Turn[] {
  const step = 1;
  const N = Math.ceil(lap / step);
  const curv = new Float64Array(N);
  for (let i = 0; i < N; i++) curv[i] = frameAt(i * step, frame).curvature;
  const wrap = (s: number): number => s - lap * Math.floor(s / lap);
  const heading = (s: number): number => frameAt(s, frame).heading;
  // Passes (unwrapped: toS ≥ fromS).
  const passes = roundabouts.map((rb) => ({ rb, a: rb.passFromS, b: rb.passToS < rb.passFromS ? rb.passToS + lap : rb.passToS }));
  const inPass = (s: number): boolean => passes.some((p) => (s >= p.a && s <= p.b) || (s + lap >= p.a && s + lap <= p.b));
  // Start the scan at the straightest sample outside any pass so no bend straddles the scan seam.
  let s0i = -1;
  for (let i = 0; i < N; i++) if (!inPass(i * step) && (s0i < 0 || Math.abs(curv[i]!) < Math.abs(curv[s0i]!))) s0i = i;
  if (s0i < 0) s0i = 0;

  const regions: Region[] = [];
  let cur: Region | null = null;
  for (let k = 0; k <= N; k++) {
    const i = (s0i + k) % N;
    const kk = curv[i]!;
    const s = s0i * step + k * step;
    const on = Math.abs(kk) >= BEND_ON && !inPass(wrap(s));
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
  const joined: Region[] = [];
  for (const r of regions) {
    const last = joined[joined.length - 1];
    if (last && last.sign === r.sign && r.a - last.b < BEND_JOIN) {
      last.b = r.b;
      last.kMax = Math.max(last.kMax, r.kMax);
    } else joined.push({ ...r });
  }

  const nameAfter = (s: number): string | null => {
    for (let d = 1; d <= 300; d += 5) {
      const n = streetNameAt(wrap(s + d));
      if (n) return n;
    }
    return null;
  };
  const turns: Turn[] = [];
  for (const p of passes) {
    // heading = atan2(tx, tz) grows when turning left (towards −n).
    const net = (heading(p.b) - heading(p.a)) * DEG;
    const exitArm = p.rb.arms.find((a) => a.onRoute === "exit" || a.onRoute === "entry-exit");
    turns.push({
      s: wrap(p.a),
      endS: wrap(p.a) + (p.b - p.a),
      direction: Math.abs(net) < STRAIGHT_ANGLE ? "straight" : net > 0 ? "left" : "right",
      angle: Math.abs(net),
      radius: p.rb.minRadius,
      roundabout: true,
      entryS: p.rb.entryS,
      exitS: p.rb.exitS,
      sweep: p.rb.sweep,
      exitName: exitArm?.name ?? nameAfter(p.b),
    });
  }
  for (const r of joined) {
    const net = (heading(r.b) - heading(r.a)) * DEG;
    const t: Turn = {
      s: wrap(r.a),
      endS: wrap(r.a) + (r.b - r.a),
      direction: net > 0 ? "left" : "right",
      angle: Math.abs(net),
      radius: 1 / r.kMax,
      roundabout: false,
      entryS: null,
      exitS: null,
      sweep: null,
      exitName: nameAfter(r.b),
    };
    if (t.angle >= MIN_TURN_ANGLE || (t.radius < MAX_TURN_RADIUS && t.angle >= MIN_TIGHT_ANGLE)) turns.push(t);
  }
  turns.sort((x, y) => x.s - y.s);
  return turns;
}
