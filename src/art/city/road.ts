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
import { GROUND_SCALE, type GroundName } from "./textures";
import { PAL } from "../palette";
import type { LaneLayout, TrackStretch } from "./track";

export const KERB = 0.13;
/** Lane and kerb geometry eases over this length after a stretch boundary (src/city TRANSITION_LENGTH). */
const TRANSITION = 12;

const WHITE = new THREE.Color(0xf2f0ea);
const YELLOW = new THREE.Color(0xffffff); // bus-stop zigzags in white: sun yellow is reserved for guidance
const C1 = new THREE.Color(1, 1, 1);

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
  constructor(readonly bag: Bag, readonly ts: TS) {}
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

  strip(mat: THREE.Material, ss: number[], l0: number | ((s: number) => number), l1: number | ((s: number) => number), y: number, scale: number, col = C1, colOuter?: THREE.Color): void {
    const { acc, tint } = this.accFor(mat);
    col = col.clone().multiply(tint);
    if (colOuter) colOuter = colOuter.clone().multiply(tint);
    const L0 = typeof l0 === "number" ? () => l0 : l0;
    const L1 = typeof l1 === "number" ? () => l1 : l1;
    for (let i = 0; i + 1 < ss.length; i++) {
      const s0 = ss[i]!;
      const s1 = ss[i + 1]!;
      const p0 = this.ts.p(s0, L0(s0), y, this.a);
      const p1 = this.ts.p(s0, L1(s0), y, this.b);
      const p2 = this.ts.p(s1, L1(s1), y, this.c);
      const p3 = this.ts.p(s1, L0(s1), y, this.d);
      if (L1(s0) - L0(s0) < 0.01 && L1(s1) - L0(s1) < 0.01) continue;
      const uv = (p: THREE.Vector3): [number, number] => [p.x / scale, p.z / scale];
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
  paint(s0: number, s1: number, l0: number, l1: number, col = WHITE, y = 0.006): void {
    const acc = this.bag.acc(paintMaterial());
    const ss = samples(s0, s1, 2);
    for (let i = 0; i + 1 < ss.length; i++) {
      const a = this.ts.p(ss[i]!, l0, y, this.a);
      const b = this.ts.p(ss[i]!, l1, y, this.b);
      const c = this.ts.p(ss[i + 1]!, l1, y, this.c);
      const d = this.ts.p(ss[i + 1]!, l0, y, this.d);
      acc.quad(a, b, c, d, [a.x / 2, a.z / 2], [b.x / 2, b.z / 2], [c.x / 2, c.z / 2], [d.x / 2, d.z / 2], col, col, col, col, UP);
    }
  }

  /** Paint triangle (track space). */
  paintTri(p: [number, number][], col = WHITE): void {
    const acc = this.bag.acc(paintMaterial());
    const v = p.map(([s, l]) => this.ts.p(s, l, 0.006));
    const [a, b, c] = v;
    if (!a || !b || !c) return;
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
  const P = new RoadPainter(bag, ts);
  const edges: EdgeSample[] = [];
  const hyd = groundMaterial("hydraulic");
  for (const { a, b, st } of piecesOf(ctx, s0, s1)) {
    const lay = st.layout;
    const sec = st.section;
    const zone = ctx.track.zoneAt(a).id;
    const ss = samples(a, b, 2);
    const bridge = sec.bridge !== null;
    const ped = lay.carriageways.length === 0;
    const surf = surfaceOf(sec, zone);
    const surfMat = groundMaterial(surf);
    const [lo, hi] = innerExtents(lay);
    // ease strip edges over TRANSITION m after a stretch boundary when the previous layout has the
    // same strips (lane tapers instead of steps); E(get) turns a layout edge into a function of s
    const prev = ctx.track.layoutAt(st.fromS - 0.5);
    const sameShape = prev !== lay && prev.carriageways.length === lay.carriageways.length && prev.sidewalks.length === lay.sidewalks.length && prev.median.length === lay.median.length;
    const E = (get: (l: LaneLayout) => number | undefined): number | ((s: number) => number) => {
      const v1 = get(lay) ?? 0;
      if (!sameShape) return v1;
      const v0 = get(prev) ?? v1;
      if (Math.abs(v0 - v1) < 0.02) return v1;
      return (s: number) => {
        const t = Math.min(1, Math.max(0, (s - st.fromS) / TRANSITION));
        return v0 + (v1 - v0) * t * t * (3 - 2 * t);
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
      const f = ctx.facadeAt(s, side);
      let w: number;
      if (f !== null && Math.abs(f) > edge + 0.3 && Math.abs(f) < edge + 16) w = Math.abs(f) + 0.3;
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
      P.strip(hyd, ss, E((l) => innerExtents(l)[1]), outerR, yWalk, GROUND_SCALE.hydraulic, C1, shade);
      P.strip(hyd, ss, outerL, E((l) => innerExtents(l)[0]), yWalk, GROUND_SCALE.hydraulic, shade.clone(), C1);
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
        P.strip(surfMat, ss, wf, wt, 0, GROUND_SCALE[surf]);
        return;
      }
      if (inner) {
        // roundabout apron: setts, mountable
        P.strip(groundMaterial("sett"), ss, wf, wt, 0.05, GROUND_SCALE.sett);
        P.kerb(ss, wt, 1, 0, 0.05);
        return;
      }
      P.strip(hyd, ss, wf, wt, KERB, GROUND_SCALE.hydraulic);
    });
    // kerbs at every carriageway edge that meets something raised
    if (!ped) {
      lay.carriageways.forEach((c, ci) => {
        const touchesL = lay.sidewalks.some((w) => Math.abs(w.to - c.from) < 0.05) || lay.median.some((m) => Math.abs(m.to - c.from) < 0.05);
        if (!(ringApron && touchesL && lay.sidewalks.some((w) => Math.abs(w.to - c.from) < 0.05))) P.kerb(ss, E((l) => l.carriageways[ci]?.from), 1);
        P.kerb(ss, E((l) => l.carriageways[ci]?.to), -1);
      });
    }
    // --- medians ------------------------------------------------------------------------------
    for (const m of lay.median) {
      const w = m.to - m.from;
      const lane = lay.kinds.findIndex((k, i) => (k as string) === "median" && lay.offsets[i]! > m.from && lay.offsets[i]! < m.to);
      if (bridge || w < 2.2) {
        P.strip(groundMaterial("granite"), ss, m.from, m.to, KERB + 0.04, 2, new THREE.Color(0.86, 0.85, 0.82));
        P.face(solidGroundMaterial("granite"), ss, m.from, 0, KERB + 0.04, -1);
        P.face(solidGroundMaterial("granite"), ss, m.to, 0, KERB + 0.04, 1);
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
        P.strip(groundMaterial("grass"), ss, m.from + 0.22, m.to - 0.22, KERB + 0.03, GROUND_SCALE.grass);
        P.kerb(ss, m.from + 0.22, -1, 0, KERB + 0.05);
        P.kerb(ss, m.to, 1, 0, KERB + 0.05);
      }
    }

    // --- markings -----------------------------------------------------------------------------
    if (!ped && surf === "asphalt") markings(ctx, P, lay, sec, a, b, st);
    legibility(P, lay, a, b, ped, ss);

    for (const s of ss) {
      edges.push({ s, outerL: outerL(s), outerR: outerR(s), kerbL: lay.carriageways[0]?.from ?? lo, kerbR: lay.carriageways[lay.carriageways.length - 1]?.to ?? hi, bridge, pedestrian: ped, layout: lay });
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
    if (lay.flow[i] === lay.flow[j]) {
      // dashed: 4 m paint, 6 m gap, aligned to the lap's s
      for (let d = Math.floor(a / DASH) * DASH; d < b; d += DASH) {
        const p0 = Math.max(a, d);
        const p1 = Math.min(b, d + 4);
        if (p1 > p0) P.paint(p0, p1, x - 0.06, x + 0.06);
      }
    } else {
      P.paint(a, b, x - 0.2, x - 0.08);
      P.paint(a, b, x + 0.08, x + 0.2);
    }
  }
  // edge lines on avenues and bridges
  if (big) {
    for (const c of lay.carriageways) {
      P.paint(a, b, c.from + 0.3, c.from + 0.45);
      P.paint(a, b, c.to - 0.45, c.to - 0.3);
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
        if (ts >= a && ts < b) P.paintTri([[ts - 1.6, lc], [ts + 1.6, lc - 0.55], [ts + 1.6, lc + 0.55]]);
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
    const x0 = ourCw.to - 0.4;
    for (let k = 0; k < 8; k++) {
      const z0 = f.s - 8 + k * 2;
      const zig = k % 2 === 0;
      P.paintTri([[z0, x0], [z0 + 2, zig ? x0 - 1.1 : x0], [z0 + 2, zig ? x0 - 0.95 : x0 + 0.15]], YELLOW);
      P.paintTri([[z0, x0], [z0 + 2, zig ? x0 - 0.95 : x0 + 0.15], [z0, x0 + 0.15]], YELLOW);
    }
    P.paint(f.s - 9, f.s + 9, ourCw.to - 0.45, ourCw.to - 0.3, YELLOW);
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
function legibility(P: RoadPainter, lay: LaneLayout, a: number, b: number, ped: boolean, ss: number[]): void {
  const lanes = lay.offsets.map((o, i) => ({ from: o - lay.widths[i]! / 2, to: o + lay.widths[i]! / 2, kind: lay.kinds[i] as string, flow: lay.flow[i]! }));
  // runnable path lanes
  for (const l of lanes) {
    if (l.kind === "road" || ped) continue;
    P.paint(a, b, l.from, l.to, RUN, KERB + 0.045);
  }
  if (ped) {
    P.paint(a, b, lay.left, lay.left + 0.08, RUN_EDGE);
    P.paint(a, b, lay.right - 0.08, lay.right, RUN_EDGE);
  } else {
    for (const l of lanes) {
      if (l.kind === "road") continue;
      P.paint(a, b, l.from, l.from + 0.07, RUN_EDGE, KERB + 0.05);
      P.paint(a, b, l.to - 0.07, l.to, RUN_EDGE, KERB + 0.05);
    }
  }
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
    if (!pave || ped) continue;
    for (let k = 0; k + 1 < ss.length; k += 1) {
      const s0 = ss[k]!;
      const s1 = ss[k + 1]!;
      const A = P.ts.p(s0, edge + side * 0.15, KERB);
      const B = P.ts.p(s1, edge + side * 0.15, KERB);
      p.beam([A.x, A.y + 0.9, A.z], [B.x, B.y + 0.9, B.z], 0.06, PAL.darkGrey, m);
      if (k % 2 === 0) p.beam([A.x, A.y, A.z], [A.x, A.y + 0.92, A.z], 0.06, PAL.darkGrey, m);
    }
  }
  // carriageways nobody runs on (the far side of an avenue): a hedge along their edge facing the route
  for (const c of lay.carriageways) {
    if (lanes.some((l) => l.kind === "road" && l.to > c.from && l.from < c.to)) continue;
    const at = c.to <= lay.left + 0.6 ? c.to - 0.45 : c.from >= lay.right - 0.6 ? c.from + 0.45 : null;
    if (at === null) continue;
    for (let k = 0; k + 1 < ss.length; k++) {
      const A = P.ts.p(ss[k]!, at, KERB);
      const B = P.ts.p(ss[k + 1]!, at, KERB);
      p.beam([A.x, A.y + 0.4, A.z], [B.x, B.y + 0.4, B.z], 0.7, HEDGE, m);
    }
  }
  // hedges along medians the runner cannot use
  for (const md of lay.median) {
    const runnable = lanes.some((l) => l.kind !== "road" && l.from >= md.from - 0.1 && l.to <= md.to + 0.1);
    if (runnable) continue;
    const mid = (md.from + md.to) / 2;
    const w = Math.min(0.9, (md.to - md.from) - 0.5);
    if (w < 0.3) continue;
    for (let k = 0; k + 1 < ss.length; k++) {
      const A = P.ts.p(ss[k]!, mid, KERB);
      const B = P.ts.p(ss[k + 1]!, mid, KERB);
      p.beam([A.x, A.y + 0.4, A.z], [B.x, B.y + 0.4, B.z], w, HEDGE, m);
    }
  }
  void b;
}
