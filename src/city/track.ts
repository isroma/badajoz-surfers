/**
 * The track model shared by the engine and the art: the lap's centreline as a smooth curve, its
 * lane layouts, sections, zones and street names. Pure; no three.js.
 *
 * Frame: X east, Z south, Y up (three.js). Heights are relative to the origin's ground.
 * Tangent t = (tx, tz) points in the running direction. Normal n = t rotated to the runner's
 * RIGHT: n = (-tz, tx)  (right = forward × up). `lateral` is + along n.
 * heading = atan2(tx, tz): `object.rotation.y = heading` turns a model whose forward is +Z to face
 * along the track. It is continuous over any s, including across the lap seam: frameAt(s + lap)
 * has heading + the lap's total turning (±2π).
 * curvature = dθ/ds signed, + when turning towards the runner's right.
 */
import type { CityData, CitySection, ZoneId } from "./data";
import { buildStretches, mapLanes, type LaneLayout, type LaneTransition } from "./lanes";
import { findTurns, TURN_LOOKAHEAD, type Turn } from "./turns";
import { computeWalls, fitStretches, type Pinch, type Walls } from "./walls";

export interface TrackFrame {
  /** s as passed to frameAt (not wrapped). */
  s: number;
  x: number;
  z: number;
  /** Road surface height. */
  h: number;
  /** Unit tangent (running direction). */
  tx: number;
  tz: number;
  /** Unit normal towards the runner's right. */
  nx: number;
  nz: number;
  /** atan2(tx, tz), unwrapped and continuous over s. */
  heading: number;
  /** Grade angle, + uphill. */
  pitch: number;
  /** Signed curvature (1/m), + turning right. */
  curvature: number;
}

export interface TrackZone {
  id: ZoneId;
  fromS: number;
  toS: number;
}

export interface TrackStretch {
  fromS: number;
  toS: number;
  layout: LaneLayout;
  section: CitySection;
}

export interface Track {
  readonly lapLength: number;
  readonly zones: readonly TrackZone[];
  /** Frame at any s (wraps, negative ok). C1-continuous position/tangent. Allocation-free with `out`. */
  frameAt(s: number, out?: TrackFrame): TrackFrame;
  /** World position of (s, lateral) at height y above the road surface. */
  toWorld(s: number, lateral: number, y: number, out: { x: number; y: number; z: number }): void;
  /**
   * Nearest point on the centreline. Without `nearS` the whole lap is searched and s is in
   * [0, lap). With `nearS` only ±PROJECT_WINDOW m around it are searched and the returned s is
   * unwrapped to lie near nearS (so it can be negative or ≥ lap).
   */
  project(x: number, z: number, nearS?: number): { s: number; lateral: number };
  /** Piecewise-constant lane layout (changes only at stretch boundaries). */
  layoutAt(s: number): LaneLayout;
  /** Consecutive, covers [0, lapLength). */
  readonly stretches: readonly TrackStretch[];
  sectionAt(s: number): CitySection;
  zoneAt(s: number): { id: ZoneId; fromS: number; toS: number; index: number };
  streetNameAt(s: number): string | null;
  /** Index of the stretch containing s (wrapped). */
  stretchIndexAt(s: number): number;
  /**
   * Every stretch boundary where the layout changes (including the lap seam if it does), in s
   * order: which lane continues into which, which end, which begin.
   */
  readonly transitions: readonly LaneTransition[];
  /**
   * Distance from s to where lane `laneIndex` (index in layoutAt(s)) ends, following it through
   * transitions; null if it continues for at least LANE_END_LOOKAHEAD m.
   */
  laneEndsAhead(s: number, laneIndex: number): number | null;
  /** Nearest building wall per metre on each side (see walls.ts; also via wallClearance()). */
  readonly walls: Walls;
  /** Short places where a wall still reaches into the outer lane (the art clips that face). */
  readonly pinches: readonly Pinch[];
  /** Bends and roundabouts worth guiding (see turns.ts), in s order. */
  readonly turns: readonly Turn[];
  /** The turn s is in, else the next one starting within TURN_LOOKAHEAD m; null if none. */
  turnAhead(s: number): Turn | null;
  /** Measured route noise and the smoothing passes it triggered. */
  readonly smoothing: { readonly chordNoise: number; readonly passes: number };
}

/** laneEndsAhead looks this far. */
export const LANE_END_LOOKAHEAD = 400;

/** Search half-window (m) for project() with a hint. */
export const PROJECT_WINDOW = 80;

export function createFrame(): TrackFrame {
  return { s: 0, x: 0, z: 0, h: 0, tx: 0, tz: 1, nx: -1, nz: 0, heading: 0, pitch: 0, curvature: 0 };
}

/** Largest i with arr[i] <= v (arr ascending, arr[0] <= v). */
function floorIndex(arr: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((arr[mid] as number) <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const TAU = Math.PI * 2;

/** Most Taubin smoothing passes applied to the route samples (see createTrack). */
export const SMOOTH_PASSES_MAX = 10;

/** RMS of (chord / Δs − 1) over the samples: ~0.02 for 0.1 m quantisation, ~0.002 for 0.01 m. */
export function measureChordNoise(X: ArrayLike<number>, Z: ArrayLike<number>, S: ArrayLike<number>, n: number): number {
  let sum = 0;
  for (let i = 1; i < n; i++) {
    const e = Math.hypot(X[i]! - X[i - 1]!, Z[i]! - Z[i - 1]!) / (S[i]! - S[i - 1]!) - 1;
    sum += e * e;
  }
  return Math.sqrt(sum / Math.max(1, n - 1));
}

/** 0 passes at ≤ 0.002 noise, one more per 0.0015, at most SMOOTH_PASSES_MAX. */
export function smoothPassesFor(chordNoise: number): number {
  return Math.max(0, Math.min(SMOOTH_PASSES_MAX, Math.ceil((chordNoise - 0.002) / 0.0015)));
}

/** In-place closed-loop Taubin smoothing of A[0..n). */
function taubin(A: Float64Array, n: number, passes: number): void {
  const tmp = new Float64Array(n);
  for (let k = 0; k < passes; k++) {
    for (const f of [0.5, -0.53]) {
      for (let i = 0; i < n; i++) {
        const a = A[(i - 1 + n) % n]!;
        const b = A[(i + 1) % n]!;
        const v = A[i]!;
        tmp[i] = v + f * ((a + b) / 2 - v);
      }
      A.set(tmp.subarray(0, n));
    }
  }
}
const wrapPi = (a: number): number => a - TAU * Math.round(a / TAU);

export function createTrack(city: CityData): Track {
  const lap = city.meta.lapLength;
  const pts = city.route.points;
  const n = city.route.s.length;
  // Knots 0..n, knot n = knot 0 at s = lap (closes the loop).
  const S = new Float64Array(n + 1);
  const X = new Float64Array(n + 1);
  const Z = new Float64Array(n + 1);
  const H = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    S[i] = city.route.s[i]!;
    X[i] = pts[i * 3]!;
    Z[i] = pts[i * 3 + 1]!;
    H[i] = pts[i * 3 + 2]!;
  }
  // Coordinates quantised to 0.1 m on 2 m samples give ±1.5° of tangent noise. Non-shrinking
  // Taubin passes (λ/μ) remove it while moving points ≤ ~0.12 m; the pass count adapts to the
  // measured chord/ds noise, so a 0.01 m export gets few or none.
  const chordNoise = measureChordNoise(X, Z, city.route.s, n);
  const passes = smoothPassesFor(chordNoise);
  taubin(X, n, passes);
  taubin(Z, n, passes);
  taubin(H, n, passes);
  S[n] = lap;
  X[n] = X[0]!;
  Z[n] = Z[0]!;
  H[n] = H[0]!;

  // Knot derivatives d/ds (Catmull-Rom with non-uniform spacing), periodic.
  const DX = new Float64Array(n + 1);
  const DZ = new Float64Array(n + 1);
  const DH = new Float64Array(n + 1);
  const sAt = (k: number): number => (k < 0 ? S[k + n]! - lap : k > n ? S[k - n]! + lap : S[k]!);
  const at = (A: Float64Array, k: number): number => A[((k % n) + n) % n]!;
  for (let i = 0; i < n; i++) {
    const ds = sAt(i + 1) - sAt(i - 1);
    DX[i] = (at(X, i + 1) - at(X, i - 1)) / ds;
    DZ[i] = (at(Z, i + 1) - at(Z, i - 1)) / ds;
    DH[i] = (at(H, i + 1) - at(H, i - 1)) / ds;
  }
  DX[n] = DX[0]!;
  DZ[n] = DZ[0]!;
  DH[n] = DH[0]!;

  // Unwrapped knot headings and knot curvature.
  const HEAD = new Float64Array(n + 1);
  HEAD[0] = Math.atan2(DX[0]!, DZ[0]!);
  for (let i = 1; i <= n; i++) HEAD[i] = HEAD[i - 1]! + wrapPi(Math.atan2(DX[i]!, DZ[i]!) - Math.atan2(DX[i - 1]!, DZ[i - 1]!));
  const lapTurn = HEAD[n]! - HEAD[0]!;
  const CURV = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const hPrev = i === 0 ? HEAD[n - 1]! - lapTurn : HEAD[i - 1]!;
    const hNext = HEAD[i + 1]!;
    // heading = atan2(tx, tz) increases when turning towards -n (left), so negate.
    CURV[i] = -(hNext - hPrev) / (sAt(i + 1) - sAt(i - 1));
  }
  CURV[n] = CURV[0]!;

  const wrap = (s: number): number => {
    const w = s - lap * Math.floor(s / lap);
    return w >= lap ? 0 : w;
  };

  function frameAt(sIn: number, out: TrackFrame = createFrame()): TrackFrame {
    const laps = Math.floor(sIn / lap);
    let s = sIn - laps * lap;
    if (s >= lap) s = 0;
    const fi = floorIndex(S, s);
    const i = fi >= n ? n - 1 : fi;
    const s0 = S[i]!;
    const d = S[i + 1]! - s0;
    const u = (s - s0) / d;
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = (u3 - 2 * u2 + u) * d;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = (u3 - u2) * d;
    // Derivatives wrt s.
    const g00 = (6 * u2 - 6 * u) / d;
    const g10 = 3 * u2 - 4 * u + 1;
    const g01 = (-6 * u2 + 6 * u) / d;
    const g11 = 3 * u2 - 2 * u;
    const x = h00 * X[i]! + h10 * DX[i]! + h01 * X[i + 1]! + h11 * DX[i + 1]!;
    const z = h00 * Z[i]! + h10 * DZ[i]! + h01 * Z[i + 1]! + h11 * DZ[i + 1]!;
    const h = h00 * H[i]! + h10 * DH[i]! + h01 * H[i + 1]! + h11 * DH[i + 1]!;
    let dx = g00 * X[i]! + g10 * DX[i]! + g01 * X[i + 1]! + g11 * DX[i + 1]!;
    let dz = g00 * Z[i]! + g10 * DZ[i]! + g01 * Z[i + 1]! + g11 * DZ[i + 1]!;
    const dh = g00 * H[i]! + g10 * DH[i]! + g01 * H[i + 1]! + g11 * DH[i + 1]!;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    out.s = sIn;
    out.x = x;
    out.z = z;
    out.h = h;
    out.tx = dx;
    out.tz = dz;
    out.nx = -dz;
    out.nz = dx;
    const hk = HEAD[i]!;
    out.heading = hk + wrapPi(Math.atan2(dx, dz) - hk) + laps * lapTurn;
    out.pitch = Math.atan(dh / len);
    out.curvature = CURV[i]! + (CURV[i + 1]! - CURV[i]!) * u;
    return out;
  }

  const scratch = createFrame();
  function toWorld(s: number, lateral: number, y: number, out: { x: number; y: number; z: number }): void {
    frameAt(s, scratch);
    out.x = scratch.x + scratch.nx * lateral;
    out.z = scratch.z + scratch.nz * lateral;
    out.y = scratch.h + y;
  }

  /** Squared distance from p to segment k (knots k..k+1) and the param t in [0,1]. */
  let segT = 0;
  const segDist2 = (k: number, px: number, pz: number): number => {
    const ax = X[k]!;
    const az = Z[k]!;
    const bx = X[k + 1]! - ax;
    const bz = Z[k + 1]! - az;
    const l2 = bx * bx + bz * bz;
    let t = l2 > 0 ? ((px - ax) * bx + (pz - az) * bz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    segT = t;
    const ex = ax + bx * t - px;
    const ez = az + bz * t - pz;
    return ex * ex + ez * ez;
  };

  const pscratch = createFrame();
  function project(px: number, pz: number, nearS?: number): { s: number; lateral: number } {
    let bestK = 0;
    let bestT = 0;
    let bestD = Infinity;
    if (nearS === undefined) {
      for (let k = 0; k < n; k++) {
        const d = segDist2(k, px, pz);
        if (d < bestD) {
          bestD = d;
          bestK = k;
          bestT = segT;
        }
      }
    } else {
      const c = floorIndex(S, wrap(nearS));
      const span = Math.ceil(PROJECT_WINDOW / city.meta.routeStep) + 1;
      for (let j = -span; j <= span; j++) {
        const k = (((c + j) % n) + n) % n;
        const d = segDist2(k, px, pz);
        if (d < bestD) {
          bestD = d;
          bestK = k;
          bestT = segT;
        }
      }
    }
    let s = S[bestK]! + (S[bestK + 1]! - S[bestK]!) * bestT;
    // Refine on the curve: Newton steps along the tangent, scaled by 1 / (1 − κ·lateral) (a point
    // off a curve moves faster or slower than its foot point).
    for (let it = 0; it < 8; it++) {
      frameAt(s, pscratch);
      const ex = px - pscratch.x;
      const ez = pz - pscratch.z;
      const along = ex * pscratch.tx + ez * pscratch.tz;
      const lat = ex * pscratch.nx + ez * pscratch.nz;
      const ds = along / Math.max(0.25, 1 - pscratch.curvature * lat);
      s += ds;
      if (Math.abs(ds) < 1e-5) break;
    }
    frameAt(s, pscratch);
    const lateral = (px - pscratch.x) * pscratch.nx + (pz - pscratch.z) * pscratch.nz;
    if (nearS === undefined) s = wrap(s);
    else s = nearS + wrapHalf(s - nearS);
    return { s, lateral };
  }
  const wrapHalf = (d: number): number => d - lap * Math.round(d / lap);

  // Sections, stretches, zones.
  const sections = city.sections;
  const secFrom = sections.map((x) => x.fromS);
  // Lanes are fitted between the real walls (walls.ts).
  const walls = computeWalls(city, lap, project);
  const fitted = fitStretches(buildStretches(sections, lap), walls, city.buildings);
  const stretches = fitted.stretches;
  const pinches = fitted.pinches;
  const stFrom = stretches.map((x) => x.fromS);
  const zones: TrackZone[] = city.zones.map((zn) => ({ id: zn.id, fromS: zn.fromS, toS: zn.toS }));
  const zFrom = zones.map((x) => x.fromS);

  const stretchIndexAt = (s: number): number => floorIndex(stFrom, wrap(s));
  const sectionAt = (s: number): CitySection => sections[floorIndex(secFrom, wrap(s))]!;
  const streetNameAt = (s: number): string | null => sectionAt(s).name;

  // Transitions after each stretch (null when the next stretch has the same layout).
  const NS = stretches.length;
  const after: (LaneTransition | null)[] = [];
  const transitions: LaneTransition[] = [];
  for (let i = 0; i < NS; i++) {
    const j = (i + 1) % NS;
    const a = stretches[i]!.layout;
    const b = stretches[j]!.layout;
    if (a === b) {
      after.push(null);
      continue;
    }
    const { map, begins } = mapLanes(a, b);
    const t: LaneTransition = { s: j === 0 ? 0 : stretches[j]!.fromS, fromIndex: i, toIndex: j, map, begins };
    after.push(t);
    transitions.push(t);
  }
  transitions.sort((x, y) => x.s - y.s);

  function laneEndsAhead(s: number, laneIndex: number): number | null {
    let i = stretchIndexAt(s);
    let lane: number | null = laneIndex;
    if (laneIndex < 0 || laneIndex >= stretches[i]!.layout.offsets.length) return 0;
    let dist = stretches[i]!.toS - wrap(s);
    for (let guard = 0; guard <= NS && dist < LANE_END_LOOKAHEAD; guard++) {
      const t = after[i];
      if (t) {
        lane = t.map[lane] ?? null;
        if (lane === null) return dist;
      }
      i = (i + 1) % NS;
      dist += stretches[i]!.toS - stretches[i]!.fromS;
    }
    return null;
  }

  const turns = findTurns(lap, frameAt, sections, streetNameAt, createFrame());
  function turnAhead(s: number): Turn | null {
    const w = wrap(s);
    let best: Turn | null = null;
    let bestD = Infinity;
    for (const t of turns) {
      const len = t.endS - t.s;
      const into = w - t.s - lap * Math.floor((w - t.s) / lap); // distance since the turn start
      if (into <= len) return t;
      const d = lap - into; // distance to the next start of this turn
      if (d <= TURN_LOOKAHEAD && d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  return {
    lapLength: lap,
    zones,
    frameAt,
    toWorld,
    project,
    stretches,
    stretchIndexAt,
    smoothing: { chordNoise, passes },
    layoutAt: (s) => stretches[stretchIndexAt(s)]!.layout,
    sectionAt,
    zoneAt: (s) => {
      const index = floorIndex(zFrom, wrap(s));
      const zn = zones[index]!;
      return { id: zn.id, fromS: zn.fromS, toS: zn.toS, index };
    },
    streetNameAt,
    transitions,
    walls,
    pinches,
    laneEndsAhead,
    turns,
    turnAhead,
  };
}

/**
 * Nearest building wall on each side, per metre of the lap (cached: computed once with the
 * track). `walls.left[i]` / `walls.right[i]` are laterals (≤ 0 / ≥ 0, ±WALL_FAR when none) for
 * s ∈ [i, i + 1).
 */
export function wallClearance(city: CityData, track: Track): Walls {
  const hit = wallCache.get(track);
  if (hit) return hit;
  const w = city.meta.lapLength === track.lapLength ? track.walls : computeWalls(city, track.lapLength, track.project);
  wallCache.set(track, w);
  return w;
}
const wallCache = new WeakMap<Track, Walls>();
