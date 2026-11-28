/**
 * The route's road surface for one chunk, drawn from the lane layouts: carriageways (asphalt,
 * setts or pavers per the section's surface), granite kerbs, hydraulic-tile pavements out to the
 * facades, medians (planted, or a runnable promenade), pedestrian streets, roundabout islands,
 * and Spanish road markings (lane lines, give-way at roundabout entries, zebras at the real
 * crossings, stop lines at signals, bus-stop zigzags, arrows), manholes and kerb drains.
 */
import * as THREE from "three";
import type { CitySection } from "../../city/data";
import { Bag, TS, samples } from "./bag";
import { SURFACE_COLOUR, flatMaterial, groundMaterial, paintMaterial, solidGroundMaterial } from "./cmats";
import type { CityCtx } from "./context";
import { hash01 } from "./shared";
import { laneOffsetAt, merges as engineMerges } from "../../game/lanes";
import { clipOutsideRings, inRingFootprint, onAnyCarriageway, ringsOf } from "./roundabouts";
import { GROUND_SCALE, type GroundName } from "./textures";
import { PAL } from "../palette";
import type { LaneLayout, TrackStretch } from "./track";

export const KERB = 0.13;
/** Lane and kerb geometry eases over this length after a stretch boundary (src/city TRANSITION_LENGTH). */
const TRANSITION = 12;

const WHITE = new THREE.Color(0xf2f0ea);
const YELLOW = new THREE.Color(0xffffff); // bus-stop zigzags in white: sun yellow is reserved for guidance
const C1 = new THREE.Color(1, 1, 1);
/** Height of a runnable sidewalk: flush with the road (just above it). */
const FLUSH = 0.035;
/** Tint of pavements that are not runnable: lighter than the pavement colour, so they recede. */
const WALK_OFF = new THREE.Color(1.03, 1.045, 1.07);

/** Per-sample pavement extents, kept for the furniture (lamps at the kerb, terraces). */
export interface EdgeSample {
  s: number;
  /** Outer pavement limits (lateral), left (< 0) and right (> 0). */
  outerL: number;
  outerR: number;
  /** Kerb lines of the outermost carriageways (or the paved strip of pedestrian streets). */
  kerbL: number;
  kerbR: number;
  bridge: boolean;
  pedestrian: boolean;
  layout: LaneLayout;
}

function surfaceOf(sec: CitySection, zone: string): GroundName {
  // the flat style: carriageways are road colour whatever their paving; pedestrian ways are the runnable path colour
  void zone;
  return sec.pedestrian ? "slabs" : "asphalt";
}

class RoadPainter {
  constructor(readonly bag: Bag, readonly ts: TS, readonly wide: (s: number) => LaneLayout = (s) => ts.track.layoutAt(s)) {}
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly d = new THREE.Vector3();

  /** Horizontal strip between laterals l0 < l1 (per sample functions allowed) at height y. */
  /** The accumulator for a surface: road-side surfaces all go to the road atlas (one draw call). */
  private accFor(mat: THREE.Material): { acc: ReturnType<Bag["acc"]>; tint: THREE.Color } {
    // every road-side surface goes into the one flat material, its palette colour in the vertices
    const surf = mat.userData["surface"] as GroundName | undefined;
    if (!surf) return { acc: this.bag.acc(mat), tint: C1 };
    return { acc: this.bag.acc(flatMaterial()), tint: new THREE.Color(SURFACE_COLOUR[surf]) };
  }

  strip(mat: THREE.Material, ss: number[], l0: number | ((s: number) => number), l1: number | ((s: number) => number), yIn: number | ((s: number) => number), scale: number, col = C1, colOuter?: THREE.Color): void {
    const Y = typeof yIn === "number" ? () => yIn : yIn;
    const { acc, tint } = this.accFor(mat);
    col = col.clone().multiply(tint);
    if (colOuter) colOuter = colOuter.clone().multiply(tint);
    const L0 = typeof l0 === "number" ? () => l0 : l0;
    const L1 = typeof l1 === "number" ? () => l1 : l1;
    for (let i = 0; i + 1 < ss.length; i++) {
      const s0 = ss[i]!;
      const s1 = ss[i + 1]!;
      const p0 = this.ts.p(s0, L0(s0), Y(s0), this.a);
      const p1 = this.ts.p(s0, L1(s0), Y(s0), this.b);
      const p2 = this.ts.p(s1, L1(s1), Y(s1), this.c);
      const p3 = this.ts.p(s1, L0(s1), Y(s1), this.d);
      if (L1(s0) - L0(s0) < 0.01 && L1(s1) - L0(s1) < 0.01) continue;
      const uv = (p: THREE.Vector3): [number, number] => [p.x / scale, p.z / scale];
      const cxq = (p0.x + p1.x + p2.x + p3.x) / 4;
      const czq = (p0.z + p1.z + p2.z + p3.z) / 4;
      if (this.exclude !== null && this.exclude(cxq, czq, 10)) {
        // near a roundabout: cut the strip across into ≤ 1.5 m pieces so it stops exactly at the
        // ring's footprint (a wide piece dropped whole left bare ground at the mouths)
        const w = Math.max(L1(s0) - L0(s0), L1(s1) - L0(s1));
        const k = Math.max(1, Math.ceil(w / 1.5));
        for (let j = 0; j < k; j++) {
          const la = (t: number, s: number): number => L0(s) + (L1(s) - L0(s)) * t;
          const q0 = this.ts.p(s0, la(j / k, s0), Y(s0));
          const q1 = this.ts.p(s0, la((j + 1) / k, s0), Y(s0));
          const q2 = this.ts.p(s1, la((j + 1) / k, s1), Y(s1));
          const q3 = this.ts.p(s1, la(j / k, s1), Y(s1));
          const cOut = j === 0 ? colOuter ?? col : col;
          if (!this.offRoad && this.exclude !== null) {
            // stop exactly at the ring's footprint circle (no sliver of bare ground, no overlap)
            const poly = clipOutsideRings(this.ctxRef!, [q0, q1, q2, q3]);
            if (poly !== null) {
              for (let t = 1; t + 1 < poly.length; t++) {
                const A = poly[0]!, B = poly[t]!, C = poly[t + 1]!;
                const nn = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
                if (nn.y > 0) acc.tri(A, B, C, uv(A), uv(B), uv(C), cOut, UP);
                else acc.tri(A, C, B, uv(A), uv(C), uv(B), cOut, UP);
              }
              continue;
            }
          }
          acc.quad(q0, q1, q2, q3, uv(q0), uv(q1), uv(q2), uv(q3), cOut, col, col, cOut, UP);
        }
        continue;
      }
      if (this.owned(cxq, czq, p0, p1, p2, p3)) continue;
      acc.quad(p0, p1, p2, p3, uv(p0), uv(p1), uv(p2), uv(p3), colOuter ?? col, col, col, colOuter ?? col, UP);
    }
  }

  /** Vertical face at lateral l from y0 to y1, facing +n (dir 1) or -n (dir -1). */
  face(mat: THREE.Material, ss: number[], l: number | ((s: number) => number), y0: number, y1: number, dir: 1 | -1, col = C1): void {
    const { acc, tint } = this.accFor(mat);
    col = col.clone().multiply(tint);
    const Lf = typeof l === "number" ? () => l : l;
    for (let i = 0; i + 1 < ss.length; i++) {
      const s0 = ss[i]!;
      const s1 = ss[i + 1]!;
      const a = this.ts.p(s0, Lf(s0), y0, this.a);
      const b = this.ts.p(s1, Lf(s1), y0, this.b);
      const c = this.ts.p(s1, Lf(s1), y1, this.c);
      const d = this.ts.p(s0, Lf(s0), y1, this.d);
      if (this.owned((a.x + b.x) / 2, (a.z + b.z) / 2, a, b)) continue;
      const u0 = s0 / 2;
      const u1 = s1 / 2;
      if (dir > 0) acc.quad(a, b, c, d, [u0, y0], [u1, y0], [u1, y1], [u0, y1], col);
      else acc.quad(b, a, d, c, [u1, y0], [u0, y0], [u0, y1], [u1, y1], col);
    }
  }

  /** Granite kerb: top strip + face down to the road. `dir` = which way the face looks. */
  kerb(ss: number[], l: number | ((s: number) => number), dir: 1 | -1, low = 0, high = KERB): void {
    const g = solidGroundMaterial("granite");
    const Lf = typeof l === "number" ? () => l : l;
    const w = 0.22;
    this.face(g, ss, Lf, low, high, dir, new THREE.Color(0.82, 0.8, 0.77));
    this.strip(g, ss, (s) => (dir > 0 ? Lf(s) - w : Lf(s)), (s) => (dir > 0 ? Lf(s) : Lf(s) + w), high + 0.012, 1.2, new THREE.Color(0.92, 0.9, 0.86));
  }

  /** Paint rectangle in track space (s0..s1 along, l0..l1 across). */
  /** A rounded, kerbed nose closing a median of half-width hw centred on lateral c at s (towards dir·s). */
  nose(s: number, c: number, hw: number, dir: 1 | -1, top?: THREE.Color): void {
    const r = Math.max(0.3, hw - 0.22);
    const f = this.ts.f(s);
    const o = this.ts.p(s, c, 0);
    const grass = this.bag.acc(flatMaterial());
    const kerbC = new THREE.Color(0.82, 0.8, 0.77);
    const lawn = top ?? new THREE.Color(SURFACE_COLOUR.grass);
    const n = 10;
    const pt = (a: number, rr: number, dy: number): THREE.Vector3 => {
      // a = 0 … π sweeps from one median edge round the front to the other
      const along = Math.sin(a) * rr * dir;
      const across = -Math.cos(a) * rr;
      return new THREE.Vector3(o.x + f.tx * along + f.nx * across, o.y + dy, o.z + f.tz * along + f.nz * across);
    };
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI;
      const a1 = ((k + 1) / n) * Math.PI;
      const C = new THREE.Vector3(o.x, o.y + KERB + 0.03, o.z);
      const A = pt(a0, r, KERB + 0.03), B = pt(a1, r, KERB + 0.03);
      const nn = new THREE.Vector3().subVectors(A, C).cross(new THREE.Vector3().subVectors(B, C));
      if (nn.y > 0) grass.tri(C, A, B, [0, 0], [0, 0], [0, 0], lawn, UP);
      else grass.tri(C, B, A, [0, 0], [0, 0], [0, 0], lawn, UP);
      // kerb top and face round the nose
      const A1 = pt(a0, r + 0.22, KERB + 0.05), B1 = pt(a1, r + 0.22, KERB + 0.05);
      const A0 = pt(a0, r, KERB + 0.05), B0 = pt(a1, r, KERB + 0.05);
      const nk = new THREE.Vector3().subVectors(A1, A0).cross(new THREE.Vector3().subVectors(B0, A0));
      if (nk.y > 0) grass.quad(A0, A1, B1, B0, [0, 0], [0, 0], [0, 0], [0, 0], kerbC, kerbC, kerbC, kerbC, UP);
      else grass.quad(A0, B0, B1, A1, [0, 0], [0, 0], [0, 0], [0, 0], kerbC, kerbC, kerbC, kerbC, UP);
      const F0 = pt(a0, r + 0.22, 0), F1 = pt(a1, r + 0.22, 0);
      grass.quad(F0, F1, B1, A1, [0, 0], [0, 0], [0, 0], [0, 0], kerbC);
      grass.quad(F1, F0, A1, B1, [0, 0], [0, 0], [0, 0], [0, 0], kerbC);
    }
  }

  /** Distance (m) from the route at s to the nearest roundabout's footprint (∞ when none). */
  ringGap: (s: number, l?: number) => number = () => Infinity;
  /** Ground the roundabout objects own (inside a ring's footprint the route draws nothing). */
  exclude: ((x: number, z: number, margin: number) => boolean) | null = null;
  ctxRef: CityCtx | null = null;
  /** Centroid inside the footprint, or any corner inside the ring's outer kerb (+0.4 m). */
  private owned(x: number, z: number, ...corners: THREE.Vector3[]): boolean {
    // runnable-lane tints (offRoad paint) stay on top of the roundabout object
    if (this.exclude === null || this.offRoad) return false;
    return this.exclude(x, z, -1) || corners.some((c) => this.exclude!(c.x, c.z, -3.2));
  }

  /** While true, paint is clipped to the carriageways actually laid at each s (road markings never on paving). */
  roadOnly = false;
  /** While true, paint avoids every carriageway actually laid at each s (path colour never on a road). */
  offRoad = false;

  private cwAt(s: number, l: number): { from: number; to: number } | null {
    return this.ts.track.layoutAt(s).carriageways.find((c) => l >= c.from - 0.01 && l <= c.to + 0.01) ?? null;
  }

  paint(s0: number, s1: number, l0In: number, l1In: number, col = WHITE, yIn: number | ((s: number) => number) = 0.006): void {
    const Yp = typeof yIn === "number" ? () => yIn : yIn;
    const acc = this.bag.acc(paintMaterial());
    const ss = samples(s0, s1, 2);
    for (let i = 0; i + 1 < ss.length; i++) {
      let l0 = l0In;
      let l1 = l1In;
      if (this.roadOnly) {
        const mid = (l0 + l1) / 2;
        const c0 = this.cwAt(ss[i]!, mid);
        const c1 = this.cwAt(ss[i + 1]!, mid);
        if (!c0 || !c1) continue;
        l0 = Math.max(l0, c0.from, c1.from);
        l1 = Math.min(l1, c0.to, c1.to);
        if (l1 - l0 < 0.05) continue;
      }
      if (this.offRoad) {
        // path paint never over a carriageway actually laid at either end of the piece
        const cws = [...this.ts.track.layoutAt(ss[i]!).carriageways, ...this.ts.track.layoutAt(ss[i + 1]!).carriageways];
        let pieces: [number, number][] = [[l0, l1]];
        for (const c of cws) pieces = pieces.flatMap(([p0, p1]) => (c.to <= p0 || c.from >= p1 ? [[p0, p1]] : ([[p0, c.from], [c.to, p1]] as [number, number][]).filter(([q0, q1]) => q1 - q0 > 0.05)));
        if (pieces.length !== 1 || pieces[0]![0] !== l0 || pieces[0]![1] !== l1) {
          for (const [q0, q1] of pieces) this.paint(ss[i]!, ss[i + 1]!, q0, q1, col, yIn);
          continue;
        }
      }
      const a = this.ts.p(ss[i]!, l0, Yp(ss[i]!), this.a);
      const b = this.ts.p(ss[i]!, l1, Yp(ss[i]!), this.b);
      const c = this.ts.p(ss[i + 1]!, l1, Yp(ss[i + 1]!), this.c);
      const d = this.ts.p(ss[i + 1]!, l0, Yp(ss[i + 1]!), this.d);
      if (this.owned((a.x + b.x + c.x + d.x) / 4, (a.z + b.z + c.z + d.z) / 4, a, b, c, d)) continue;
      acc.quad(a, b, c, d, [a.x / 2, a.z / 2], [b.x / 2, b.z / 2], [c.x / 2, c.z / 2], [d.x / 2, d.z / 2], col, col, col, col, UP);
    }
  }

  /** Paint triangle (track space). */
  paintTri(p: [number, number][], col = WHITE): void {
    if (this.roadOnly && p.some(([s, l]) => !this.cwAt(s, l))) return;
    const acc = this.bag.acc(paintMaterial());
    const v = p.map(([s, l]) => this.ts.p(s, l, 0.006));
    const [a, b, c] = v;
    if (!a || !b || !c) return;
    if (this.owned((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3, a, b, c)) return;
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const [q, r] = n.y > 0 ? [b, c] : [c, b];
    acc.tri(a, q, r, [a.x / 2, a.z / 2], [q.x / 2, q.z / 2], [r.x / 2, r.z / 2], col, UP);
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** Stretches overlapping [s0, s1). */
function piecesOf(ctx: CityCtx, s0: number, s1: number): { a: number; b: number; st: TrackStretch }[] {
  const out: { a: number; b: number; st: TrackStretch }[] = [];
  for (const st of ctx.track.stretches) {
    const a = Math.max(s0, st.fromS);
    const b = Math.min(s1, st.toS);
    if (b - a > 0.01) out.push({ a, b, st });
  }
  return out;
}

export interface RoadResult {
  edges: EdgeSample[];
}

/** Lateral limits of the paved/runnable stuff, without the outer pavement. */
function innerExtents(lay: LaneLayout): [number, number] {
  let lo = lay.left;
  let hi = lay.right;
  for (const c of lay.carriageways) {
    lo = Math.min(lo, c.from);
    hi = Math.max(hi, c.to);
  }
  for (const w of lay.sidewalks) {
    lo = Math.min(lo, w.from);
    hi = Math.max(hi, w.to);
  }
  return [lo, hi];
}

export function buildRoadChunk(ctx: CityCtx, bag: Bag, ts: TS, s0: number, s1: number): RoadResult {
  const P = new RoadPainter(bag, ts, (s) => ctx.wideLayout(s));
  P.exclude = (x, z, margin) => inRingFootprint(ctx, x, z, margin) !== null;
  P.ctxRef = ctx;
  P.ringGap = (s, l = 0) => {
    const q = ts.p(s, l, 0);
    let gap = Infinity;
    for (const r of ringsOf(ctx)) gap = Math.min(gap, Math.hypot(q.x - r.rb.cx, q.z - r.rb.cz) - (r.rb.rOuter + 2.5));
    return gap;
  };
  const edges: EdgeSample[] = [];
  const hyd = groundMaterial("hydraulic");
  for (const { a, b, st } of piecesOf(ctx, s0, s1)) {
    const lay = st.layout;
    const sec = st.section;
    const zone = ctx.track.zoneAt(a).id;
    // 4 m samples on straights, 2 m on curves (fewer triangles, same shape)
    let kmax = 0;
    for (let q = a; q <= b; q += 4) kmax = Math.max(kmax, Math.abs(ts.f(q).curvature));
    const ss = samples(a, b, kmax < 0.012 ? 4 : 2);
    const bridge = sec.bridge !== null;
    const ped = lay.carriageways.length === 0;
    const surf = surfaceOf(sec, zone);
    const surfMat = groundMaterial(surf);
    const [lo, hi] = innerExtents(lay);
    // ease strip edges over TRANSITION m after a stretch boundary when the previous layout has the
    // same strips (lane tapers instead of steps); E(get) turns a layout edge into a function of s
    // stretch boundaries blend like the engine's lanes (laneOffsetAt): a smoothstep over
    // TRANSITION m centred on the boundary, when the neighbouring layout has the same strips
    const prev = ctx.track.layoutAt(st.fromS - 0.5);
    const next = ctx.track.layoutAt(st.toS + 0.5);
    const same = (o: LaneLayout): boolean => o !== lay && o.carriageways.length === lay.carriageways.length && o.sidewalks.length === lay.sidewalks.length && o.median.length === lay.median.length;
    const samePrev = same(prev);
    const sameNext = same(next);
    const sm = (t: number): number => {
      const k = Math.min(1, Math.max(0, t));
      return k * k * (3 - 2 * k);
    };
    const E = (get: (l: LaneLayout) => number | undefined): number | ((s: number) => number) => {
      const v1 = get(lay) ?? 0;
      const v0 = samePrev ? get(prev) ?? v1 : v1;
      const v2 = sameNext ? get(next) ?? v1 : v1;
      if (Math.abs(v0 - v1) < 0.02 && Math.abs(v2 - v1) < 0.02) return v1;
      return (s: number) => {
        if (s < st.fromS + TRANSITION / 2) return v0 + (v1 - v0) * sm((s - st.fromS + TRANSITION / 2) / TRANSITION);
        if (s > st.toS - TRANSITION / 2) return v1 + (v2 - v1) * sm((s - st.toS + TRANSITION / 2) / TRANSITION);
        return v1;
      };
    };
    const curvatureLimit = (s: number, side: 1 | -1, want: number): number => {
      // keep the inner edge of a tight curve from folding over itself
      const k = ts.f(s).curvature;
      if (k * side > 0.002) return Math.min(want, 0.85 / Math.abs(k));
      return want;
    };

    // --- pavement out to the facades ---------------------------------------------------------
    const outer = (s: number, side: 1 | -1): number => {
      const edge = side > 0 ? hi : -lo;
      if (bridge) return edge + 0.35;
      // out to the real wall (track.walls) when there is one close by: one surface wall to wall
      const wi = Math.min(ctx.track.walls.left.length - 1, Math.max(0, Math.floor(s)));
      const f = side > 0 ? ctx.track.walls.right[wi]! : ctx.track.walls.left[wi]!;
      let w: number;
      if (Math.abs(f) > edge - 0.05 && Math.abs(f) < 16) w = Math.max(edge, Math.abs(f)) + 0.3;
      else w = edge + (ped ? 1.5 : zone === "puente-real" || zone === "margen-derecha" ? 2.5 : 3.5);
      return curvatureLimit(s, side, w);
    };
    const smooth = (side: 1 | -1): number[] => {
      const raw = ss.map((s) => outer(s, side));
      // median of 5, then limit how fast the pavement edge may move (no jagged, stepped edges)
      const med = raw.map((_, i) => {
        const w = raw.slice(Math.max(0, i - 2), i + 3).sort((p, q) => p - q);
        return w[Math.floor(w.length / 2)] ?? raw[i]!;
      });
      // the median above used to wash out a one-sample curvature spike at a sharp corner, so the
      // inner pavement folded over the carriageway: re-apply the limit with the window's worst curve
      for (let i = 0; i < med.length; i++) {
        let k = 0;
        for (let d = -8; d <= 8; d += 1) {
          const c = ts.f(ss[i]! + d).curvature * side;
          if (c > k) k = c;
        }
        if (k > 0.002) med[i] = Math.min(med[i]!, 0.85 / k);
      }
      for (let i = 1; i < med.length; i++) med[i] = Math.min(med[i]!, med[i - 1]! + 0.5);
      for (let i = med.length - 2; i >= 0; i--) med[i] = Math.min(med[i]!, med[i + 1]! + 0.5);
      return med;
    };
    const oR = smooth(1);
    const oL = smooth(-1);
    const idx = (s: number): number => Math.max(0, Math.min(ss.length - 1, ss.findIndex((v) => Math.abs(v - s) < 1e-6)));
    const outerR = (s: number): number => oR[idx(s)] ?? hi + 2;
    const outerL = (s: number): number => -(oL[idx(s)] ?? -lo + 2);
    const yWalk = ped ? 0 : KERB;
    const shade = new THREE.Color(0.8, 0.79, 0.77);
    if (!bridge) {
      // pedestrian streets: one flat surface wall to wall, in the path colour; garden paths are
      // bordered by lawn and low hedges
      const mid = ts.f((a + b) / 2);
      const garden = ped && ctx.greenAt(mid.x, mid.z);
      const outerMat = garden ? groundMaterial("grass") : ped ? groundMaterial("slabs") : hyd;
      const sh = C1; // one pavement tone (no shaded band beside the runnable sidewalk)
      void shade;
      if (garden) {
        for (const side of [1, -1] as const) {
          const lat = side > 0 ? lay.right + 0.35 : lay.left - 0.35;
          for (let k = 0; k + 1 < ss.length; k++) {
            const A = ts.p(ss[k]!, lat, 0);
            const B = ts.p(ss[k + 1]!, lat, 0);
            bag.props.beam([A.x, A.y + 0.3, A.z], [B.x, B.y + 0.3, B.z], 0.5, PAL.trees[2], flatMaterial());
          }
        }
      }
      P.strip(outerMat, ss, E((l) => innerExtents(l)[1]), outerR, yWalk, GROUND_SCALE.hydraulic, C1, sh);
      P.strip(outerMat, ss, outerL, E((l) => innerExtents(l)[0]), yWalk, GROUND_SCALE.hydraulic, sh.clone(), C1);
      // narrow old-town streets: a darker strip where the floor meets the walls, so the street floor reads
      const narrow = (oR[Math.floor(oR.length / 2)] ?? 99) + (oL[Math.floor(oL.length / 2)] ?? 99) < 16;
      if (!garden && narrow) {
        const dk = new THREE.Color(0.8, 0.77, 0.72);
        P.strip(outerMat, ss, (s) => outerR(s) - 0.45, outerR, yWalk + 0.008, GROUND_SCALE.hydraulic, dk, dk);
        P.strip(outerMat, ss, outerL, (s) => outerL(s) + 0.45, yWalk + 0.008, GROUND_SCALE.hydraulic, dk, dk);
      }
      // skirts so no gap shows where the terrain falls away
      P.face(groundMaterial("granite"), ss, outerR, yWalk - 4.5, yWalk, 1, new THREE.Color(0.6, 0.58, 0.55));
      P.face(groundMaterial("granite"), ss, outerL, yWalk - 4.5, yWalk, -1, new THREE.Color(0.6, 0.58, 0.55));
    }

    // --- carriageways -------------------------------------------------------------------------
    lay.carriageways.forEach((_, ci) => {
      P.strip(surfMat, ss, E((l) => l.carriageways[ci]?.from), E((l) => l.carriageways[ci]?.to), 0, GROUND_SCALE[surf]);
    });
    // --- sidewalks (layout strips) ------------------------------------------------------------
    const ringApron = sec.roundabout !== null;
    lay.sidewalks.forEach((w, wi) => {
      const inner = ringApron && w.to <= lay.carriageways[0]!.from + 0.01;
      const wf = E((l) => l.sidewalks[wi]?.from);
      const wt = E((l) => l.sidewalks[wi]?.to);
      if (ped) {
        // a street without carriageway (pedestrian or shared street) is paved, even where the
        // section is tagged asphalt: one floor, wall to wall (asphalt here left dark bands beside
        // the lanes' runnable paint)
        if (surf === "asphalt") P.strip(groundMaterial("slabs"), ss, wf, wt, 0, GROUND_SCALE.hydraulic);
        else P.strip(surfMat, ss, wf, wt, 0, GROUND_SCALE[surf]);
        return;
      }
      if (inner) {
        // roundabout apron: setts, mountable
        P.strip(groundMaterial("sett"), ss, wf, wt, 0.05, GROUND_SCALE.sett);
        P.kerb(ss, wt, 1, 0, 0.05);
        return;
      }
      // pavements nobody runs on recede: a lighter paving (the runnable ones carry the warmer
      // runnable colour and its edge lines on top, see legibility)
      const runnable = lay.offsets.some((o, k) => lay.kinds[k] !== "road" && o > w.from - 0.1 && o < w.to + 0.1);
      if (runnable) {
        // a runnable sidewalk is a lane: flush with the road (a painted edge, no step), and one clear
        // kerb where it meets the raised pavement beyond it
        P.strip(hyd, ss, wf, wt, FLUSH, GROUND_SCALE.hydraulic, C1);
        const outerSide = w.from >= 0 ? 1 : -1;
        P.face(solidGroundMaterial("granite"), ss, outerSide > 0 ? wt : wf, FLUSH, KERB, outerSide > 0 ? -1 : 1, new THREE.Color(0.82, 0.8, 0.77));
      } else P.strip(hyd, ss, wf, wt, KERB, GROUND_SCALE.hydraulic, WALK_OFF);
    });
    // kerbs at every carriageway edge that meets something raised
    if (!ped) {
      lay.carriageways.forEach((c, ci) => {
        const touchesL = lay.sidewalks.some((w) => Math.abs(w.to - c.from) < 0.05) || lay.median.some((m) => Math.abs(m.to - c.from) < 0.05);
        // no raised kerb against a runnable sidewalk (it is flush: stepping onto it is a lane change)
        const runnableAt = (edge: number): boolean => lay.sidewalks.some((w) => (Math.abs(w.to - edge) < 0.05 || Math.abs(w.from - edge) < 0.05) && lay.offsets.some((o, k) => lay.kinds[k] !== "road" && o > w.from - 0.1 && o < w.to + 0.1));
        if (!(ringApron && touchesL && lay.sidewalks.some((w) => Math.abs(w.to - c.from) < 0.05)) && !runnableAt(c.from)) P.kerb(ss, E((l) => l.carriageways[ci]?.from), 1);
        if (!runnableAt(c.to)) P.kerb(ss, E((l) => l.carriageways[ci]?.to), -1);
      });
    }
    // --- medians ------------------------------------------------------------------------------
    for (const m of lay.median) {
      const w = m.to - m.from;
      const lane = lay.kinds.findIndex((k, i) => (k as string) === "median" && lay.offsets[i]! > m.from && lay.offsets[i]! < m.to);
      const mk = sec.medianKind;
      if (bridge || w < 2.2 || (mk !== null && mk !== "planting" && mk !== "promenade" && mk !== "unmapped")) {
        // hard median: also ends before a roundabout (road surface beyond it)
        const away = (q: number): boolean => bridge || (P.ringGap(q, m.from) >= 4 && P.ringGap(q, m.to) >= 4);
        for (const run of runsOf(ss, away)) {
          if (m.to - m.from < 0.8) {
            // too narrow for a kerbed island: a painted hatched gore between the carriageways
            for (let q = run[0]!; q < run[run.length - 1]! - 1e-6; q += 3) {
              P.paint(q, Math.min(q + 3, run[run.length - 1]!), m.from, m.from + 0.12);
              P.paint(q, Math.min(q + 3, run[run.length - 1]!), m.to - 0.12, m.to);
              P.paintTri([[q, m.from], [q + 0.6, m.from], [q + 1.5, m.to]]);
            }
            continue;
          }
          P.strip(groundMaterial("granite"), run, m.from, m.to, KERB + 0.04, 2, new THREE.Color(0.86, 0.85, 0.82));
          P.face(solidGroundMaterial("granite"), run, m.from, 0, KERB + 0.04, -1);
          P.face(solidGroundMaterial("granite"), run, m.to, 0, KERB + 0.04, 1);
          // where the island begins or ends towards a ring: a rounded, kerbed nose (a splitter)
          for (const [end, dirN] of [[run[0]!, -1], [run[run.length - 1]!, 1]] as const) {
            if (away(end + dirN * 2.5)) continue;
            P.nose(end, (m.from + m.to) / 2, (m.to - m.from) / 2, dirN, new THREE.Color(0.86, 0.85, 0.82));
          }
        }
        for (const run of runsOf(ss, (q) => !away(q))) P.strip(surfMat, run, m.from, m.to, 0, GROUND_SCALE[surf]);
      } else if (lane >= 0) {
        // runnable boulevard: albero promenade in the lane width, planting either side
        const lc = lay.offsets[lane]!;
        const lw = lay.widths[lane]! / 2;
        const p0 = Math.max(m.from + 0.3, lc - lw);
        const p1 = Math.min(m.to - 0.3, lc + lw);
        P.strip(groundMaterial("albero"), ss, p0, p1, KERB, GROUND_SCALE.albero);
        P.strip(groundMaterial("grass"), ss, m.from + 0.22, p0, KERB + 0.02, GROUND_SCALE.grass);
        P.strip(groundMaterial("grass"), ss, p1, m.to - 0.22, KERB + 0.02, GROUND_SCALE.grass);
        P.kerb(ss, m.from + 0.22, -1, 0, KERB + 0.05);
        P.kerb(ss, m.to, 1, 0, KERB + 0.05);
      } else {
        // a real median: lawn between kerbs; it ENDS before a roundabout at a rounded, kerbed nose,
        // and the carriageway surface continues where it stopped (nothing reaches the ring's mouth)
        const mid = (m.from + m.to) / 2;
        const away = (q: number): boolean => P.ringGap(q, mid) >= 3 + (m.to - m.from) / 2 && P.ringGap(q, m.from) >= 3 && P.ringGap(q, m.to) >= 3;
        for (const run of runsOf(ss, away)) {
          P.strip(groundMaterial("grass"), run, m.from + 0.22, m.to - 0.22, KERB + 0.03, GROUND_SCALE.grass);
          P.kerb(run, m.from + 0.22, -1, 0, KERB + 0.05);
          P.kerb(run, m.to, 1, 0, KERB + 0.05);
          for (const [end, dirN] of [[run[0]!, -1], [run[run.length - 1]!, 1]] as const) {
            if (away(end + dirN * 2.5)) continue; // a nose only where the ring comes next
            P.nose(end, mid, (m.to - m.from) / 2, dirN);
          }
        }
        for (const run of runsOf(ss, (q) => !away(q))) P.strip(surfMat, run, m.from, m.to, 0, GROUND_SCALE[surf]);
      }
    }

    // --- markings -----------------------------------------------------------------------------
    if (!ped && surf === "asphalt") {
      P.roadOnly = true;
      markings(ctx, P, lay, sec, a, b, st);
      P.roadOnly = false;
    }
    legibility(P, lay, a, b, ped, ss, !bridge && (sec.medianKind === "planting" || sec.medianKind === "unmapped" || sec.medianKind === null), bridge);

    for (const s of ss) {
      edges.push({ s, outerL: outerL(s), outerR: outerR(s), kerbL: lay.carriageways[0]?.from ?? lo, kerbR: lay.carriageways[lay.carriageways.length - 1]?.to ?? hi, bridge, pedestrian: ped, layout: ctx.wideLayout(s) });
    }
  }
  return { edges };
}

const DASH = 10;

function markings(ctx: CityCtx, P: RoadPainter, lay: LaneLayout, sec: CitySection, a: number, b: number, st: TrackStretch): void {
  const roadLanes: number[] = [];
  lay.kinds.forEach((k, i) => {
    if (k === "road") roadLanes.push(i);
  });
  const big = sec.dual || sec.highway === "trunk" || sec.highway === "primary" || sec.highway === "secondary" || sec.bridge !== null;
  // lane dividers
  for (let k = 0; k + 1 < roadLanes.length; k++) {
    const i = roadLanes[k]!;
    const j = roadLanes[k + 1]!;
    if (j !== i + 1) continue;
    const x = (lay.offsets[i]! + lay.widths[i]! / 2 + lay.offsets[j]! - lay.widths[j]! / 2) / 2;
    const inCw = lay.carriageways.some((c) => x > c.from + 0.3 && x < c.to - 0.3);
    if (!inCw) continue;
    // a divider never runs inside a lane: not where the two lanes are merging (the engine's
    // laneOffsetAt brings them together), and the lanes' own edges decide where it is
    const span = (p0: number, p1: number, l0: number, l1: number): void => {
      for (let q = p0; q < p1 - 1e-6; q += 1) {
        const q1 = Math.min(p1, q + 1);
        const m = (q + q1) / 2;
        const oi = laneOffsetAt(ctx.track, i, m);
        const oj = laneOffsetAt(ctx.track, j, m);
        // overlapping lanes: skip while one of them is merging/opening (the engine's taper), or
        // when they overlap a lot; a small overlap where widths change keeps the line continuous
        const overlap = (lay.widths[i]! + lay.widths[j]!) / 2 - Math.abs(oj - oi);
        if (overlap > 0.3 || (overlap > 0.05 && (mergingAt(ctx, i, m) || mergingAt(ctx, j, m)))) continue;
        const dx = (oi + lay.widths[i]! / 2 + oj - lay.widths[j]! / 2) / 2 - x;
        // nor where the line would fall inside a third lane (lanes re-ordering at a stretch boundary)
        const lc = (l0 + l1) / 2 + dx;
        if (lay.offsets.some((_, k) => k !== i && k !== j && Math.abs(lc - laneOffsetAt(ctx.track, k, m)) < lay.widths[k]! / 2 - 0.2)) continue;
        P.paint(q, q1, l0 + dx, l1 + dx);
      }
    };
    if (lay.flow[i] === lay.flow[j]) {
      // dashed: 4 m paint, 6 m gap, aligned to the lap's s
      for (let d = Math.floor(a / DASH) * DASH; d < b; d += DASH) {
        const p0 = Math.max(a, d);
        const p1 = Math.min(b, d + 4);
        if (p1 > p0) span(p0, p1, x - 0.06, x + 0.06);
      }
    } else {
      span(a, b, x - 0.2, x - 0.08);
      span(a, b, x + 0.08, x + 0.2);
    }
  }
  // edge lines on avenues and bridges
  if (big) {
    for (const c of lay.carriageways) {
      // at the very kerb: an edge line never lies inside the outer lanes
      // (not at a ring's mouth: the ring's own kerb lines take over there)
      for (let q = a; q < b - 1e-6; q += 2) {
        const q1 = Math.min(b, q + 2);
        if (P.ringGap((q + q1) / 2) < 6) continue;
        P.paint(q, q1, c.from + 0.05, c.from + 0.2);
        P.paint(q, q1, c.to - 0.2, c.to - 0.05);
      }
    }
  }
  const ourCw = lay.carriageways.find((c) => c.from <= 0.01 && c.to >= -0.01) ?? lay.carriageways[lay.carriageways.length - 1];
  // give way at the roundabout entries + arrows on the approach
  if (ourCw) {
    const L = ctx.track.lapLength;
    for (const other of ctx.track.stretches) {
      if (!other.section.roundabout) continue;
      const entry = other.fromS;
      const prev = ctx.track.layoutAt(entry - 1);
      if (prev === other.layout) continue;
      const pc = prev.carriageways.find((c) => c.from <= 0.01 && c.to >= -0.01);
      if (!pc) continue;
      const lineS = entry - 1.5;
      if (lineS >= a && lineS < b) {
        for (let l = pc.from + 0.3; l < pc.to - 0.3; l += 1.0) P.paint(lineS - 0.2, lineS + 0.2, l, Math.min(l + 0.5, pc.to - 0.3));
      }
      // "ceda el paso" triangles (point towards the runner) and straight arrows
      prev.kinds.forEach((k, i) => {
        if (k !== "road" || prev.flow[i] !== 1) return;
        const lc = prev.offsets[i]!;
        const ts = entry - 7;
        void ts; // no "ceda" triangle in the runner's lanes: only the give-way line crosses them
        const as = ((entry - 28) % L + L) % L;
        if (as >= a && as + 5 < b) arrow(P, as, lc);
      });
    }
  }
  // zebra crossings at the real crossings
  for (const f of ctx.city.furniture) {
    if (f.type !== "crossing" || f.s < a || f.s >= b) continue;
    const cw = lay.carriageways.find((c) => f.lateral > c.from - 1.5 && f.lateral < c.to + 1.5);
    if (!cw) continue;
    zebra(P, f.s, cw.from, cw.to);
  }
  // stop lines at traffic signals
  for (const f of ctx.city.furniture) {
    if (f.type !== "traffic_signals" || f.s < a || f.s >= b) continue;
    const cw = lay.carriageways.find((c) => f.lateral > c.from - 3 && f.lateral < c.to + 3) ?? ourCw;
    if (!cw) continue;
    P.paint(f.s - 4.4, f.s - 4.0, cw.from + 0.3, cw.to - 0.3);
    if (f.s - 3 > a && f.s + 3 < b) zebra(P, f.s, cw.from, cw.to);
  }
  // bus stops: yellow zigzag along the right kerb
  for (const f of ctx.city.furniture) {
    if (f.type !== "bus_stop" || f.s < a || f.s >= b || f.lateral < 0 || f.lateral > 12 || !ourCw) continue;
    // a kerb line only: no zig-zag inside the runner's lane
    if (P.ringGap(f.s) > 12) P.paint(f.s - 9, f.s + 9, ourCw.to - 0.2, ourCw.to - 0.05, YELLOW);
  }
  // manholes and kerb drains
  const grey = new THREE.Color(0.32, 0.31, 0.3);
  const iron = new THREE.Color(0.22, 0.21, 0.2);
  for (let s = Math.ceil(a / 17) * 17; s < b; s += 17) {
    const h = hash01(Math.round(s), 31);
    const c = lay.carriageways[Math.floor(h * lay.carriageways.length)];
    if (!c) continue;
    if (h < 0.6) {
      const l = c.from + (c.to - c.from) * (0.25 + 0.5 * hash01(Math.round(s), 7));
      P.paint(s - 0.35, s + 0.35, l - 0.35, l + 0.35, iron);
    }
    // gully grate by the right kerb
    P.paint(s + 3, s + 3.9, c.to - 0.62, c.to - 0.22, grey);
  }
  void st;
}

function zebra(P: RoadPainter, s: number, from: number, to: number): void {
  for (let l = from + 0.5; l + 0.5 <= to - 0.3; l += 1.0) P.paint(s - 2, s + 2, l, l + 0.5);
}

function arrow(P: RoadPainter, s: number, l: number): void {
  P.paint(s, s + 3.2, l - 0.08, l + 0.08);
  P.paintTri([[s + 3.2, l - 0.4], [s + 3.2, l + 0.4], [s + 5, l]]);
}

const RUN = new THREE.Color(PAL.runnable);
const RUN_EDGE = new THREE.Color(PAL.runnable).multiplyScalar(0.82);
const OFF = new THREE.Color(PAL.roadOff);
const DANGER = new THREE.Color(PAL.danger);
const HEDGE = PAL.trees[2];

/**
 * Make the runnable surface unmistakable (docs/design.md): runnable sidewalk / median /
 * pedestrian lanes in the path colour with a subtle edge line; carriageway not covered by any
 * lane in the "off" road tint; a red edge on oncoming lanes; railings where non-runnable pavement
 * continues beyond the runnable edge; hedges on medians the runner cannot use.
 */
function legibility(P: RoadPainter, lay: LaneLayout, a: number, b: number, ped: boolean, ss: number[], planted: boolean, _bridge: boolean): void {
  const lanes = lay.offsets.map((o, i) => ({ from: o - lay.widths[i]! / 2, to: o + lay.widths[i]! / 2, kind: lay.kinds[i] as string, flow: lay.flow[i]! }));
  // runnable path lanes
  P.offRoad = true;
  // lanes in the runnable colour on every surface, pedestrian streets included (the rest of the
  // floor to the walls stays in pavement colour)
  const yRun = ped ? 0.045 : FLUSH + 0.045;
  for (const l of lanes) {
    if (l.kind === "road") continue;
    P.paint(a, b, l.from, l.to, RUN, yRun);
    P.paint(a, b, l.from, l.from + 0.07, RUN_EDGE, yRun + 0.005);
    P.paint(a, b, l.to - 0.07, l.to, RUN_EDGE, yRun + 0.005);
  }
  P.offRoad = false;
  // carriageway the runner cannot use
  for (const c of lay.carriageways) {
    const cover = lanes.filter((l) => l.kind === "road" && l.to > c.from && l.from < c.to);
    const lo = Math.min(...cover.map((l) => l.from), c.to);
    const hi = Math.max(...cover.map((l) => l.to), c.from);
    if (cover.length === 0) P.paint(a, b, c.from, c.to, OFF);
    else {
      if (lo - c.from > 0.4) P.paint(a, b, c.from, lo, OFF);
      if (c.to - hi > 0.4) P.paint(a, b, hi, c.to, OFF);
    }
  }
  // oncoming lanes: red edge at their outer side
  const onc = lanes.filter((l) => l.kind === "road" && l.flow === -1);
  if (onc.length) {
    const outer = Math.min(...onc.map((l) => l.from));
    P.paint(a, b, outer + 0.05, outer + 0.2, DANGER);
  }
  // separation: railing beyond the runnable edge where more (non-runnable) pavement continues
  const p = P.bag.props;
  const m = flatMaterial();
  for (const side of [1, -1] as const) {
    const edge = side > 0 ? lay.right : lay.left;
    const pave = lay.sidewalks.some((w) => (side > 0 ? w.to > edge + 0.8 : w.from < edge - 0.8));
    // (on bridges too: the walkway beside the runner reads as fenced off)
    if (!pave || ped) continue;
    for (let k = 0; k + 1 < ss.length; k += 1) {
      const s0 = ss[k]!;
      const s1 = ss[k + 1]!;
      const A = P.ts.p(s0, edge + side * 0.15, KERB);
      const B = P.ts.p(s1, edge + side * 0.15, KERB);
      if (P.exclude?.(A.x, A.z, -1) || P.exclude?.(B.x, B.z, -1) || P.ringGap(s0, edge) < 8) continue; // the roundabout's own ground and mouth
      if (P.ctxRef && (onAnyCarriageway(P.ctxRef, A.x, A.z, 0.1) || onAnyCarriageway(P.ctxRef, B.x, B.z, 0.1))) continue; // never on a road
      p.beam([A.x, A.y + 0.9, A.z], [B.x, B.y + 0.9, B.z], 0.06, PAL.darkGrey, m);
      if (k % 2 === 0) p.beam([A.x, A.y, A.z], [A.x, A.y + 0.92, A.z], 0.06, PAL.darkGrey, m);
    }
  }
  // carriageways nobody runs on (the far side of an avenue): a hedge along their edge facing the route
  for (const c of lay.carriageways) {
    if (lanes.some((l) => l.kind === "road" && l.to > c.from && l.from < c.to)) continue;
    // on the median side of that carriageway's kerb (a hedge never stands on the road itself)
    const at = c.to <= lay.left + 0.6 ? c.to + 0.45 : c.from >= lay.right - 0.6 ? c.from - 0.45 : null;
    if (at !== null && !lay.median.some((md) => at > md.from + 0.2 && at < md.to - 0.2)) continue;
    if (at === null) continue;
    for (let k = 0; k + 1 < ss.length; k++) {
      // not where a neighbouring stretch makes this carriageway runnable (boundary blends)
      const wl = P.wide(ss[k]!);
      if (at > wl.left - 0.5 && at < wl.right + 0.5 && !lay.median.some((md) => at > md.from && at < md.to)) continue;
      const A = P.ts.p(ss[k]!, at, KERB);
      const B = P.ts.p(ss[k + 1]!, at, KERB);
      if (P.exclude?.(A.x, A.z, -1)) continue;
      p.beam([A.x, A.y + 0.4, A.z], [B.x, B.y + 0.4, B.z], 0.7, HEDGE, m);
    }
  }
  // hedges along planted medians the runner cannot use (concrete reservations stay bare)
  if (planted) for (const md of lay.median) {
    const runnable = lanes.some((l) => l.kind !== "road" && l.from >= md.from - 0.1 && l.to <= md.to + 0.1);
    if (runnable) continue;
    const mid = (md.from + md.to) / 2;
    const w = Math.min(0.9, (md.to - md.from) - 0.5);
    if (w < 0.3) continue;
    for (let k = 0; k + 1 < ss.length; k++) {
      const wl = P.wide(ss[k]!);
      if (wl.offsets.some((o, j) => Math.abs(mid - o) < (wl.widths[j] ?? 0) / 2 + w / 2 + 0.2)) continue;
      const A = P.ts.p(ss[k]!, mid, KERB);
      const B = P.ts.p(ss[k + 1]!, mid, KERB);
      if (P.exclude?.(A.x, A.z, -1) || P.ringGap(ss[k]!) < 8) continue; // the hedge stops before the nose
      p.beam([A.x, A.y + 0.4, A.z], [B.x, B.y + 0.4, B.z], w, HEDGE, m);
    }
  }
  void b;
}

/** Consecutive runs of samples where pred holds (each run shares its end samples with the next). */
function runsOf(ss: number[], pred: (s: number) => boolean): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < ss.length; i++) {
    const ok = pred(ss[i]!);
    if (ok) cur.push(ss[i]!);
    else {
      if (cur.length) {
        cur.push(ss[i]!);
        if (cur.length > 1) out.push(cur);
      }
      cur = [];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

const mergeCache = new WeakMap<object, readonly { s0: number; s1: number; fromStretch: number; lane: number; into: number }[]>();
/** Lane k of the stretch at s is in one of the engine's tapers (as the ending lane or its target). */
function mergingAt(ctx: CityCtx, k: number, s: number): boolean {
  let ms = mergeCache.get(ctx.track);
  if (!ms) mergeCache.set(ctx.track, (ms = engineMerges(ctx.track)));
  // any taper here moves the lanes: be conservative about which index it names across stretches
  return ms.some((m) => s > m.s0 - 4 && s < m.s1 + 4 && (m.lane === k || m.into === k || m.lane === k + 1 || m.lane === k - 1));
}
