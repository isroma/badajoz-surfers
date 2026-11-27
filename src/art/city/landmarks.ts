/**
 * Landmarks at their real positions, scales and orientations (permanent layer, part of the
 * skyline): Puente Real (deck structure, the central pylon and its stays, white railings), the
 * route's other elevated spans, the Edificio Siglo XXI, the Cathedral and the Ayuntamiento on
 * Plaza de España, the Alcazaba walls (real lines and heights) with merlons and towers, the Torre
 * de Espantaperros, the Puerta de Palmas, the Puente de Palmas (granite arches, cutwaters), the
 * Universidad and Autonomía bridges, the templete of Paseo de San Francisco, storks' nests.
 */
import * as THREE from "three";
import type { CityLandmark } from "../../city/data";
import { Acc } from "./acc";
import { Bag, TS, samples } from "./bag";
import { drawLabel, flatMaterial, signMaterial, signSlot, glassMaterial, glowMaterial, metalMaterial, propMaterial } from "./cmats";
import { PAL } from "../palette";
import type { CityCtx } from "./context";
import { centroid, obb, pointInFlat, ringPoints, signedArea, type P2 } from "./geo";
import type { GroundLayer } from "./ground";
import { T, xf } from "../geom";
import { espantaperros } from "../landmarks/alcazaba";
import { merlons } from "../landmarks/casco";
/** Flat wall colours of the landmark surfaces (the old atlas tile names). */
const FT = { stone: PAL.stone, stonePlain: PAL.stone, tapial: PAL.albero, renderWindows: 0xfcf8f1, glassShop: 0xfcf8f1 } as const;

const CONCRETE = 0xeeece6;
const CONCRETE_SHADE = 0xd6d3cb;
const GRANITE = 0xcfc4ac;
const GRANITE_DARK = 0xb3a78f;
const TAPIAL_COL = 0xd2a26c;

/** Textured wall quad a→b between y0 and y1 (atlas tile `tile`, all bands), normal to the left of a→b... */
function texWall(acc: Acc, ax: number, az: number, ay0: number, ay1: number, bx: number, bz: number, by0: number, by1: number, tile: number, tintIn: THREE.Color, bay = 3.2): void {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.05) return;
  const tint = tintIn.clone().multiply(new THREE.Color(tile));
  acc.set("aTile", tile, tile, tile, 1e4);
  acc.set("aSeed", 0, 2);
  const n = new THREE.Vector3(-(bz - az) / len, 0, (bx - ax) / len);
  const u1 = len / bay;
  const f = (y: number, y0: number): number => 1 + (y - y0) / 3;
  const base = Math.min(ay0, by0);
  acc.quad(
    new THREE.Vector3(ax, ay0, az), new THREE.Vector3(bx, by0, bz), new THREE.Vector3(bx, by1, bz), new THREE.Vector3(ax, ay1, az),
    [0, f(ay0, base)], [u1, f(by0, base)], [u1, f(by1, base)], [0, f(ay1, base)], tint, tint, tint, tint, n,
  );
}

/** Extrude a footprint ring (signed area < 0) with a facade tile, flat top. */
function extrude(acc: Acc, top: Acc, ring: P2[], y0: number, y1: number, tile: number, tint: THREE.Color, roofCol = new THREE.Color(0xcfc6b5)): void {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    texWall(acc, a.x, a.z, y0, y1, b.x, b.z, y0, y1, tile, tint);
  }
  const contour = ring.map((p) => new THREE.Vector2(p.x, p.z));
  let tris: number[][] = [];
  try {
    tris = THREE.ShapeUtils.triangulateShape(contour, []);
  } catch {
    return;
  }
  for (const t of tris) {
    const p0 = ring[t[0]!]!;
    let p1 = ring[t[1]!]!;
    let p2 = ring[t[2]!]!;
    const cy = (p1.z - p0.z) * (p2.x - p0.x) - (p1.x - p0.x) * (p2.z - p0.z);
    if (cy < 0) [p1, p2] = [p2, p1];
    top.tri(new THREE.Vector3(p0.x, y1, p0.z), new THREE.Vector3(p1.x, y1, p1.z), new THREE.Vector3(p2.x, y1, p2.z), [p0.x / 6, p0.z / 6], [p1.x / 6, p1.z / 6], [p2.x / 6, p2.z / 6], roofCol, new THREE.Vector3(0, 1, 0));
  }
}

function cwRing(flat: number[]): P2[] {
  const r = ringPoints(flat);
  return signedArea(r) > 0 ? r.reverse() : r;
}

export function buildLandmarks(ctx: CityCtx, ground: GroundLayer): THREE.Group {
  const g = new THREE.Group();
  g.name = "landmarks";
  const ts = new TS(ctx.track);
  const L = (id: string): CityLandmark | undefined => ctx.landmark(id);
  /** Each landmark is its own group (frustum culling, distance hiding). */
  const part = (name: string, fn: (bag: Bag, fac: Acc, top: Acc) => void): void => {
    const bag = new Bag();
    const fac = bag.acc(flatMaterial());
    const top = bag.acc(propMaterial(true));
    fn(bag, fac, top);
    const grp = new THREE.Group();
    grp.name = name;
    bag.build(grp);
    for (const c of grp.children) {
      c.matrixAutoUpdate = false;
      c.name = c.name || name;
    }
    g.add(grp);
  };
  // grouped by 600 m tiles: few draw calls, still culled by distance
  const tileOf = (s: number): string => {
    const f = ts.f(s);
    return `${Math.floor(f.x / 600)},${Math.floor(f.z / 600)}`;
  };
  const vGroups = new Map<string, [number, number][]>();
  for (const run of viaductRuns(ctx, ts, ground)) {
    const k = tileOf((run[0] + run[1]) / 2);
    vGroups.set(k, [...(vGroups.get(k) ?? []), run]);
  }
  for (const [k, runs] of vGroups) part(`viaducts-${k}`, (bag) => {
    for (const run of runs) elevatedSpans(ctx, bag, ts, ground, run);
  });
  part("puente-real", (bag) => puenteReal(ctx, bag, ts));
  const siglo = L("torre-siglo-xxi");
  if (siglo?.footprint?.[0]) part("siglo-xxi", (bag) => sigloXXI(bag, cwRing(siglo.footprint![0]!), ctx.terrainAt(siglo.x ?? 0, siglo.z ?? 0), 80));
  const cat = L("catedral");
  if (cat?.footprint?.[0]) part("catedral", (bag, fac, top) => catedral(bag, fac, top, cwRing(cat.footprint![0]!), cat.ground ?? 15.9, cat.heightMax ?? 36.5));
  const ayu = L("ayuntamiento");
  if (ayu?.footprint?.[0]) part("ayuntamiento", (bag, fac, top) => ayuntamiento(bag, fac, top, cwRing(ayu.footprint![0]!), ayu.ground ?? 16.5, L("plaza-espana")));
  const pe = L("plaza-espana");
  if (pe?.footprint?.[0]) part("plaza-espana", (bag) => plazaEspana(ctx, bag, pe.footprint![0]!));
  part("murallas", (bag, fac, top) => murallas(ctx, bag, fac, top, false));
  // merlons and towers per wall, so each is culled on its own
  // merlons and towers per 250 m tile (culled by distance at 420 m)
  const wGroups = new Map<string, number[]>();
  (ctx.landmark("murallas")?.walls ?? []).forEach((w, i) => {
    if (w.dist >= 80) return;
    const k = `${Math.floor((w.line[0] ?? 0) / 250)},${Math.floor((w.line[1] ?? 0) / 250)}`;
    wGroups.set(k, [...(wGroups.get(k) ?? []), i]);
  });
  for (const [k, list] of wGroups) part(`murallas-${k}-detail`, (bag, fac, top) => {
    for (const i of list) murallas(ctx, bag, fac, top, true, i);
  });
  const esp = L("torre-espantaperros");
  if (esp?.x !== undefined && esp.z !== undefined) {
    const ex = esp.x;
    const ez = esp.z;
    part("espantaperros", (bag) => {
      const base = esp.ground ?? ctx.terrainAt(ex, ez);
      bag.props.push(xf(ex, base, ez, 1, 0.84, 1));
      espantaperros(bag.props, 0, 0, 0);
      bag.props.pop();
      storkNest(bag, ex, base + 0.84 * 33.4, ez);
    });
  }
  const pp = L("puerta-palmas");
  const pal = L("puente-palmas");
  if (pp?.footprint?.[0] && pal?.footprint?.[0]) part("puerta-palmas", (bag) => puertaPalmas(bag, cwRing(pp.footprint![0]!), pp.ground ?? 0, cwRing(pal.footprint![0]!), ctx));
  part("puente-palmas", (bag, fac) => puentePalmas(ctx, bag, fac, ts));
  for (const id of ["puente-universidad", "puente-autonomia"]) {
    const l = L(id);
    if (l?.footprint?.[0]) part(id, (bag) => simpleBridge(bag, ctx, cwRing(l.footprint![0]!), id === "puente-universidad" ? 1.3 : Math.max(-1.9, ctx.waterLevel + 8)));
  }
  const rGroups = new Map<string, number[]>();
  for (const st of ctx.track.stretches) if (st.section.roundabout) {
    const k = tileOf(st.fromS);
    rGroups.set(k, [...(rGroups.get(k) ?? []), st.fromS]);
  }
  for (const [k, list] of rGroups) part(`roundabouts-${k}`, (bag) => {
    for (const fs of list) roundabouts(ctx, bag, ts, fs);
  });
  part("bar-el-puente", (bag, fac, top) => {
    barElPuente(ctx, bag, fac, top, ts);
    startSign(ctx, bag, ts);
  });
  const tem = L("templete-san-francisco");
  if (tem?.x !== undefined && tem.z !== undefined) {
    const tx = tem.x;
    const tz = tem.z;
    // the bandstand stands beside the runnable surface (moved out of it if the lanes reach it)
    const [px, pz] = keepClear(ctx, tx, tz, 5.3, tem.s);
    part("templete", (bag) => templete(bag, px, ctx.streetLevel(px, pz, tem.s ?? 4150) - 0.13, pz));
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Elevated spans (viaducts / decks) and Puente Real
// ---------------------------------------------------------------------------------------------

function extentsAt(ctx: CityCtx, s: number): [number, number] {
  const lay = ctx.track.layoutAt(s);
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
  return [lo - 0.35, hi + 0.35];
}

/** Deck girders, fascia, piers and railings wherever the route runs > 2 m above the ground. */
function viaductRuns(ctx: CityCtx, ts: TS, ground: GroundLayer): [number, number][] {
  const L = ctx.track.lapLength;
  const step = 2;
  let runStart = -1;
  const runs: [number, number][] = [];
  for (let s = 0; s <= L; s += step) {
    const f = ts.f(s);
    const gap = f.h - ground.heightAt(f.x, f.z);
    const palmas = ctx.track.sectionAt(s).bridge === "Puente de Palmas";
    const up = (gap > 4.5 || (gap > 2.2 && ctx.track.sectionAt(s).bridge !== null)) && !palmas;
    if (up && runStart < 0) runStart = s;
    if (!up && runStart >= 0) {
      if (s - runStart > 8) runs.push([runStart - 4, s + 4]);
      runStart = -1;
    }
  }
  // split long runs so each part is culled on its own
  const out: [number, number][] = [];
  for (const [a, b] of runs) for (let x = a; x < b; x += 160) out.push([x, Math.min(b, x + 160)]);
  return out;
}

function elevatedSpans(ctx: CityCtx, bag: Bag, ts: TS, ground: GroundLayer, run: [number, number]): void {
  const p = bag.props;
  const m = propMaterial(true);
  const runs = [run];
  const pylonS = ctx.landmark("puente-real")?.pylon?.s ?? 826;
  for (const [a, b] of runs) {
    const ss = samples(a, b, 3);
    const deck = bag.acc(m);
    const col = new THREE.Color(CONCRETE);
    const shade = new THREE.Color(CONCRETE_SHADE).multiplyScalar(0.8);
    for (let i = 0; i + 1 < ss.length; i++) {
      const s0 = ss[i]!;
      const s1 = ss[i + 1]!;
      const [lo0, hi0] = extentsAt(ctx, s0);
      const [lo1, hi1] = extentsAt(ctx, s1);
      // fascia (outer faces) from the deck down 1.1 m, underside, and the box girder below
      const P = (s: number, l: number, y: number): THREE.Vector3 => ts.p(s, l, y);
      const face = (l0: number, l1: number, y0: number, y1: number, dir: 1 | -1, c: THREE.Color): void => {
        const A = P(s0, l0, y0), B = P(s1, l1, y0), C = P(s1, l1, y1), D = P(s0, l0, y1);
        if (dir > 0) deck.quad(A, B, C, D, [0, 0], [1, 0], [1, 1], [0, 1], c);
        else deck.quad(B, A, D, C, [0, 0], [1, 0], [1, 1], [0, 1], c);
      };
      face(hi0, hi1, -1.1, 0.25, 1, col);
      face(lo0, lo1, -1.1, 0.25, -1, col);
      // cornice lip
      face(hi0 + 0.15, hi1 + 0.15, -0.35, 0.3, 1, col);
      face(lo0 - 0.15, lo1 - 0.15, -0.35, 0.3, -1, col);
      // underside
      {
        const A = P(s0, lo0, -1.1), B = P(s0, hi0, -1.1), C = P(s1, hi1, -1.1), D = P(s1, lo1, -1.1);
        deck.quad(A, D, C, B, [0, 0], [0, 1], [1, 1], [1, 0], shade);
      }
      // box girder under the middle (sloped webs)
      const g0 = lo0 + 2.2, g1 = hi0 - 2.2, h0 = lo1 + 2.2, h1 = hi1 - 2.2;
      face(g1, h1, -2.6, -1.1, 1, shade);
      face(g0, h0, -2.6, -1.1, -1, shade);
      {
        const A = P(s0, g0, -2.6), B = P(s0, g1, -2.6), C = P(s1, h1, -2.6), D = P(s1, h0, -2.6);
        deck.quad(A, D, C, B, [0, 0], [0, 1], [1, 1], [1, 0], shade);
      }
    }
    // piers
    const nearPylon = (s: number): boolean => Math.abs(s - pylonS) < 150 && ctx.track.sectionAt(s).name === "Puente Real" && s > 520 && s < 960;
    for (let s = Math.ceil((a + 10) / 36) * 36; s < b - 8; s += 36) {
      if (nearPylon(s)) continue;
      const f = ts.f(s);
      const [lo, hi] = extentsAt(ctx, s);
      const bed = Math.min(ground.heightAt(f.x, f.z), ctx.waterLevel) - 2;
      const yTop = f.h - 2.6;
      if (yTop - bed < 1) continue;
      const lay = ctx.track.layoutAt(s);
      const cols = lay.carriageways.length > 1 ? lay.carriageways.map((c) => (c.from + c.to) / 2) : [(lo + hi) / 2];
      const heading = Math.atan2(f.tx, f.tz);
      for (const c of cols) {
        const q = ts.p(s, c, 0);
        p.push(xf(q.x, bed, q.z, 1, 1, 1, 0, heading, 0));
        p.box(0, (yTop - bed) / 2, 0, 3.2, yTop - bed, 1.8, CONCRETE_SHADE, m);
        // cutwater ends
        p.add(T.cyl(10), xf(0, (yTop - bed) / 2, 0, 1.0, yTop - bed, 1.6), CONCRETE_SHADE, m);
        p.pop();
      }
      // pier cap across the deck
      const q0 = ts.p(s, (lo + hi) / 2, -2.6);
      p.push(xf(q0.x, q0.y, q0.z, 1, 1, 1, 0, heading + Math.PI / 2, 0));
      p.box(0, -0.5, 0, hi - lo - 3, 1.0, 2.2, CONCRETE, m);
      p.pop();
    }
    // white steel railings on both outer edges
    railings(bag, ctx, ts, a + 2, b - 2);
  }
}

function railings(bag: Bag, ctx: CityCtx, ts: TS, a: number, b: number): void {
  const p = bag.props;
  const m = metalMaterial();
  const white = 0xf2f2ee;
  for (const side of [1, -1] as const) {
    const ss = samples(a, b, 6);
    for (let i = 0; i + 1 < ss.length; i++) {
      const s0 = ss[i]!;
      const s1 = ss[i + 1]!;
      const l0 = extentsAt(ctx, s0)[side > 0 ? 1 : 0] - side * 0.15;
      const l1 = extentsAt(ctx, s1)[side > 0 ? 1 : 0] - side * 0.15;
      const A = ts.p(s0, l0, 0.15);
      const B = ts.p(s1, l1, 0.15);
      p.beam([A.x, A.y + 1.05, A.z], [B.x, B.y + 1.05, B.z], 0.08, white, m);
      p.beam([A.x, A.y + 0.55, A.z], [B.x, B.y + 0.55, B.z], 0.04, white, m);
      for (let k = 0; k < 3; k++) {
        const t = k / 3;
        const x = A.x + (B.x - A.x) * t;
        const y = A.y + (B.y - A.y) * t;
        const z = A.z + (B.z - A.z) * t;
        p.beam([x, y, z], [x, y + 1.08, z], 0.06, white, m);
      }
    }
  }
}

/** The central pylon of Puente Real and its harp of stays in the median plane. */
function puenteReal(ctx: CityCtx, bag: Bag, ts: TS): void {
  const lm = ctx.landmark("puente-real");
  const py = lm?.pylon;
  if (!py) return;
  const s = py.s;
  const lay = ctx.track.layoutAt(s);
  const med = lay.median[0];
  const mid = med ? (med.from + med.to) / 2 : py.lateral;
  const halfW = med ? Math.max(0.45, (med.to - med.from) / 2 - 0.12) : 0.9;
  const f = ts.f(s);
  const base = ts.p(s, mid, 0);
  const H = py.aboveDeck;
  const heading = Math.atan2(f.tx, f.tz);
  const p = bag.props;
  const m = propMaterial(true);
  // the shaft: narrow across the deck (fits the median), long along it, tapering, down to the river
  const water = ctx.waterLevel;
  p.push(xf(base.x, 0, base.z, 1, 1, 1, 0, heading, 0));
  const segs = 12;
  for (let k = 0; k < segs; k++) {
    const y0 = base.y + (H * k) / segs;
    const y1 = base.y + (H * (k + 1)) / segs;
    const t0 = k / segs;
    const len = 5.6 - 2.4 * t0;
    // in the median at deck level, broadening above the clearance into the real mast's bulk
    const wide = y0 - base.y > 6 ? Math.max(halfW * 2, 2.6 - 1.0 * t0) : halfW * 2;
    p.box(0, (y0 + y1) / 2, 0, wide, y1 - y0 + 0.02, len, CONCRETE, m);
  }
  // crown and anchorage zone
  p.box(0, base.y + H + 0.6, 0, halfW * 1.7, 1.2, 3.0, CONCRETE_SHADE, m);
  p.box(0, base.y + H - 12, 0, halfW * 1.85, 22, 3.4, 0xe6e3dc, m);
  p.box(0, base.y + H + 1.5, 0, 0.5, 0.5, 0.5, 0xff3b30, glowMaterial());
  // below the deck: the pier down to the river bed, wider
  p.box(0, (water - 3 + base.y - 2.6) / 2, 0, 6, base.y - 2.6 - water + 3, 7, CONCRETE_SHADE, m);
  p.pop();
  // stays: a harp/fan in the median plane, anchored along the median both sides
  const top0 = base.y + H - 22;
  const top1 = base.y + H - 1;
  const n = 14;
  for (const dir of [1, -1]) {
    for (let k = 0; k < n; k++) {
      const d = 18 + k * 9.5;
      const sa = s + dir * d;
      if (sa < 516 || sa > 962) continue;
      const anchor = ts.p(sa, mid, 0.4);
      const yTop = top0 + ((top1 - top0) * k) / (n - 1);
      const ax = base.x + f.tx * dir * 1.6;
      const az = base.z + f.tz * dir * 1.6;
      p.beam([anchor.x, anchor.y, anchor.z], [ax, yTop, az], 0.16, 0xf6f6f2, m, 5);
      p.box(anchor.x, anchor.y - 0.15, anchor.z, 0.35, 0.4, 0.5, CONCRETE_SHADE, m);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Buildings with their own models
// ---------------------------------------------------------------------------------------------

/** Edificio Siglo XXI: glass tower on its real footprint, white floor bands and a crown. */
function sigloXXI(bag: Bag, ring: P2[], y0: number, H: number): void {
  const glass = bag.acc(glassMaterial());
  const m = propMaterial(true);
  const top = y0 + H;
  const c = new THREE.Color(PAL.glass);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    glass.quad(new THREE.Vector3(a.x, y0 + 6, a.z), new THREE.Vector3(b.x, y0 + 6, b.z), new THREE.Vector3(b.x, top, b.z), new THREE.Vector3(a.x, top, a.z), [0, 0], [1, 0], [1, 1], [0, 1], c);
  }
  const ctr = centroid(ring);
  const p = bag.props;
  // floor bands slightly proud of the glass, and mullions
  for (let y = y0 + 6; y < top; y += 3.4) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const ox = (a.x + b.x) / 2 - ctr.x;
      const oz = (a.z + b.z) / 2 - ctr.z;
      const ol = Math.hypot(ox, oz) || 1;
      const push = 0.12;
      p.beam([a.x + (ox / ol) * push, y, a.z + (oz / ol) * push], [b.x + (ox / ol) * push, y, b.z + (oz / ol) * push], 0.3, 0xeef0f0, m);
    }
  }
  // podium and crown
  extrudeProps(bag, ring, y0, y0 + 6, 0xd9d6cf, 0.6);
  extrudeProps(bag, ring, top, top + 3, 0xf2f2ee, 0.3);
  p.cyl(ctr.x, top + 3, ctr.z, 0.35, 9, 0xdddddd, 6, m);
  p.box(ctr.x, top + 12.4, ctr.z, 0.5, 0.5, 0.5, 0xff3b30, glowMaterial());
}

/** Plain extruded prism (props material), ring outset by `grow`. */
function extrudeProps(bag: Bag, ring: P2[], y0: number, y1: number, color: number, grow = 0): void {
  const acc = bag.acc(propMaterial(true));
  const c = new THREE.Color(color);
  const ctr = centroid(ring);
  const g = ring.map((p) => {
    const dx = p.x - ctr.x;
    const dz = p.z - ctr.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: p.x + (dx / l) * grow, z: p.z + (dz / l) * grow };
  });
  for (let i = 0; i < g.length; i++) {
    const a = g[i]!;
    const b = g[(i + 1) % g.length]!;
    acc.quad(new THREE.Vector3(a.x, y0, a.z), new THREE.Vector3(b.x, y0, b.z), new THREE.Vector3(b.x, y1, b.z), new THREE.Vector3(a.x, y1, a.z), [0, 0], [1, 0], [1, 1], [0, 1], c);
  }
  const contour = g.map((p) => new THREE.Vector2(p.x, p.z));
  let tris: number[][] = [];
  try {
    tris = THREE.ShapeUtils.triangulateShape(contour, []);
  } catch {
    return;
  }
  for (const t of tris) {
    const p0 = g[t[0]!]!;
    let p1 = g[t[1]!]!;
    let p2 = g[t[2]!]!;
    const cy = (p1.z - p0.z) * (p2.x - p0.x) - (p1.x - p0.x) * (p2.z - p0.z);
    if (cy < 0) [p1, p2] = [p2, p1];
    acc.tri(new THREE.Vector3(p0.x, y1, p0.z), new THREE.Vector3(p1.x, y1, p1.z), new THREE.Vector3(p2.x, y1, p2.z), [0, 0], [0, 0], [0, 0], c, new THREE.Vector3(0, 1, 0));
  }
}

/**
 * Catedral de San Juan Bautista: fortress-like stone nave on the real footprint with merlons and
 * buttresses, and the square tower (36.5 m) at the west end by Plaza de España.
 */
function catedral(bag: Bag, fac: Acc, top: Acc, ring: P2[], g0: number, peak: number): void {
  const tint = new THREE.Color(0xf6eadc);
  const naveTop = g0 + 15.5;
  extrude(fac, top, ring, g0 - 2, naveTop, FT.stone, tint, new THREE.Color(0xc8b79a));
  const p = bag.props;
  const m = propMaterial(true);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    merlons(p, a.x, a.z, b.x, b.z, naveTop, 0.8, 0xc9b590, 0.6);
  }
  // tower at the west end (the corner nearest Plaza de España), aligned with the nave
  const o = obb(ring);
  const w = 11.5;
  // the tower stands at the north-west corner, beside the main (west) facade on the plaza
  let corner = ring[0]!;
  for (const q of ring) if (q.x + q.z < corner.x + corner.z) corner = q;
  const cen = centroid(ring);
  const dl = Math.hypot(cen.x - corner.x, cen.z - corner.z) || 1;
  const tx = corner.x + ((cen.x - corner.x) / dl) * w * 0.75;
  const tz = corner.z + ((cen.z - corner.z) / dl) * w * 0.75;
  const ry = Math.atan2(o.ux, o.uz);
  p.push(xf(tx, g0, tz, 1, 1, 1, 0, ry, 0));
  const H = peak - 7;
  p.box(0, H / 2 - 1, 0, w, H + 2, w, 0xd8c6a2, m);
  p.box(0, 1.5, 0, w + 0.8, 3, w + 0.8, 0xbfae8b, m);
  for (const y of [11, 18, 24]) for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    p.push(xf(0, 0, 0, 1, 1, 1, 0, r, 0));
    p.box(0, y, w / 2 + 0.02, 0.8, 2.4, 0.1, 0x3a2e25, m);
    p.pop();
  }
  // string course, clock, belfry with arches, merlons and pinnacles
  p.box(0, H - 3, 0, w + 0.6, 0.6, w + 0.6, 0xe6d7b6, m);
  p.box(0, H + 2.6, 0, w - 1.6, 5.2, w - 1.6, 0xe3d1ab, m);
  for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    p.push(xf(0, 0, 0, 1, 1, 1, 0, r, 0));
    for (const d of [-2.2, 2.2]) p.box(d, H + 2.8, (w - 1.6) / 2 + 0.02, 1.5, 3.2, 0.1, 0x2a221c, m);
    p.sign("clock", 0, H - 6, w / 2 + 0.06, 2.8);
    p.pop();
  }
  for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    p.box((cx * w) / 2, H + 1.4, (cz * w) / 2, 1.3, 2.8, 1.3, 0xd8c6a2, m);
    p.cone((cx * w) / 2, H + 2.8, (cz * w) / 2, 0.8, 1.5, 0xe6d7b6, 4, m);
  }
  merlons(p, -w / 2, w / 2, w / 2, w / 2, H, 0.8, 0xe6d7b6);
  merlons(p, w / 2, w / 2, w / 2, -w / 2, H, 0.8, 0xe6d7b6);
  merlons(p, w / 2, -w / 2, -w / 2, -w / 2, H, 0.8, 0xe6d7b6);
  merlons(p, -w / 2, -w / 2, -w / 2, w / 2, H, 0.8, 0xe6d7b6);
  p.cone(0, H + 5.2, 0, 3.6, 1.8, 0xb99d72, 4, m);
  p.cyl(0, H + 7, 0, 0.07, 2.2, 0x333333, 4, m);
  p.box(0, H + 8.4, 0, 1.2, 0.12, 0.12, 0x333333, m);
  p.pop();
  storkNest(bag, tx + 4, g0 + H + 0.6, tz + 4);
  // the main portal on the west facade: projecting stone frontispiece with columns and a pediment
  let wi = 0;
  let best = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = -(b.z - a.z) / len;
    if (len > 8 && -nx * len > best) {
      best = -nx * len;
      wi = i;
    }
  }
  const a = ring[wi]!;
  const b = ring[(wi + 1) % ring.length]!;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const pry = Math.atan2(-(b.z - a.z) / len, (b.x - a.x) / len);
  p.push(xf((a.x + b.x) / 2, g0, (a.z + b.z) / 2, 1, 1, 1, 0, pry, 0));
  p.box(0, 6, 0.6, 7, 12, 1.2, 0xe3d2ae, m);
  p.box(0, 2.6, 1.22, 2.6, 5.2, 0.06, 0x4a3426, m);
  for (const dx of [-2.6, -1.8, 1.8, 2.6]) p.cyl(dx, 0, 1.4, 0.28, 7.5, 0xe9dcbf, 10, m);
  p.box(0, 7.8, 1.4, 7.2, 0.6, 0.6, 0xd9c7a2, m);
  p.hexa([[-3.6, 8.1, 1.7], [3.6, 8.1, 1.7], [3.6, 8.1, 0.6], [-3.6, 8.1, 0.6], [-0.2, 10.2, 1.7], [0.2, 10.2, 1.7], [0.2, 10.2, 0.6], [-0.2, 10.2, 0.6]], 0xe3d2ae, m);
  p.sign("escudo", 0, 9.0, 1.75, 1.3);
  p.pop();
}

/** Plaza de España: orange trees and benches round the open square (kept out of the runnable lanes). */
export function plazaEspana(ctx: CityCtx, bag: Bag, flat: number[]): void {
  const ring = cwRing(flat);
  const c = centroid(ring);
  const p = bag.props;
  const m = propMaterial(true);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    for (let d = 4; d < len - 3; d += 9) {
      const t = d / len;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const dl = Math.hypot(c.x - x, c.z - z) || 1;
      const px = x + ((c.x - x) / dl) * 3;
      const pz = z + ((c.z - z) / dl) * 3;
      if (!pointInFlat(px, pz, flat)) continue;
      if (["catedral", "ayuntamiento"].some((id) => ctx.landmark(id)?.footprint?.some((f) => pointInFlat(px, pz, f)) ?? false)) continue;
      const pr = ctx.track.project(px, pz);
      const lay = ctx.track.layoutAt(pr.s);
      if (pr.lateral > lay.left - 1.5 && pr.lateral < lay.right + 1.5) continue;
      const y = ctx.streetLevel(px, pz, pr.s) - 0.13;
      // round tree pit and an orange tree; a bench every other one
      p.cyl(px, y, pz, 0.8, 0.05, 0x8a7a62, 12, m);
      p.cyl(px, y, pz, 0.12, 1.3, 0x6a5a48, 6, m);
      p.add(T.ico1, xf(px, y + 2.0, pz, 1.3, 1.1, 1.3), 0x3d5a2e, m);
      for (let k = 0; k < 5; k++) p.sphere(px + Math.cos(k * 1.3) * 1.1, y + 1.9 + (k % 2) * 0.4, pz + Math.sin(k * 1.3) * 1.1, 0.1, 0.1, 0.1, 0xe8862a, m, 5, 3);
      if ((i + Math.round(d)) % 2 === 0) {
        const bx = px + ((c.x - x) / dl) * 1.6;
        const bz = pz + ((c.z - z) / dl) * 1.6;
        p.box(bx, y + 0.45, bz, 1.8, 0.08, 0.5, 0xbfb6a2, m, Math.atan2(c.x - x, c.z - z) + Math.PI / 2);
        p.box(bx, y + 0.22, bz, 1.5, 0.44, 0.3, 0xb3a994, m, Math.atan2(c.x - x, c.z - z) + Math.PI / 2);
      }
    }
  }
}

/** Ayuntamiento: white neoclassical facade on its footprint, portico, flags and clock gable. */
function ayuntamiento(bag: Bag, fac: Acc, top: Acc, ring: P2[], g0: number, plaza: CityLandmark | undefined): void {
  const H = 15;
  extrude(fac, top, ring, g0 - 2, g0 + H, FT.renderWindows, new THREE.Color(0xfffcf4));
  // the edge facing the plaza gets the portico
  const pc = plaza?.footprint?.[0] ? centroid(ringPoints(plaza.footprint[0])) : { x: 2390, z: 420 };
  let best = 0;
  let bi = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const nx = -(b.z - a.z) / len;
    const nz = (b.x - a.x) / len;
    const score = len * Math.max(0, ((pc.x - mx) * nx + (pc.z - mz) * nz) / Math.hypot(pc.x - mx, pc.z - mz));
    if (score > best) {
      best = score;
      bi = i;
    }
  }
  const a = ring[bi]!;
  const b = ring[(bi + 1) % ring.length]!;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const ry = Math.atan2(-(b.z - a.z) / len, (b.x - a.x) / len);
  const p = bag.props;
  const m = propMaterial(true);
  p.push(xf((a.x + b.x) / 2, g0, (a.z + b.z) / 2, 1, 1, 1, 0, ry, 0));
  p.box(0, 0.3, 1.2, 11, 0.6, 2.4, 0xe9dfc8, m);
  for (const dx of [-3.6, -1.2, 1.2, 3.6]) p.cyl(dx, 0.6, 1.9, 0.4, 9.4, 0xfbf8f0, 10, m);
  p.box(0, 10.9, 1.2, 11, 1.4, 2.6, 0xfbf8f0, m);
  p.hexa([[-5.5, 11.6, 2.5], [5.5, 11.6, 2.5], [5.5, 11.6, 0], [-5.5, 11.6, 0], [-0.2, 14.4, 2.5], [0.2, 14.4, 2.5], [0.2, 14.4, 0], [-0.2, 14.4, 0]], 0xfbf8f0, m);
  p.sign("escudo", 0, 12.6, 2.56, 1.6);
  p.sign("ayuntamiento", 0, 10.9, 2.52, 0.75);
  p.box(0, H + 2, -1, 4, 4, 1, 0xfbf8f0, m);
  p.sign("clock", 0, H + 2.2, -0.45, 2.4);
  const flags: [number, number, number][] = [[0xc60b1e, 0xffc400, 0xc60b1e], [0x007a33, 0xffffff, 0x111111], [0x003399, 0x003399, 0x003399]];
  flags.forEach((cols, k) => {
    const fx = -1.6 + k * 1.6;
    p.beam([fx, 6, 0.3], [fx, 8.6, 2.0], 0.05, 0x888888, m);
    cols.forEach((c, j) => p.box(fx, 8.35 - j * 0.28, 2.3, 1.1, 0.28, 0.05, c, m));
  });
  p.pop();
}

// ---------------------------------------------------------------------------------------------
// Alcazaba: walls, towers
// ---------------------------------------------------------------------------------------------

function murallas(ctx: CityCtx, bag: Bag, fac: Acc, top: Acc, detail: boolean, only = -1): void {
  const lm = ctx.landmark("murallas");
  if (!lm?.walls) return;
  const p = bag.props;
  const m = propMaterial(true);
  const tint = new THREE.Color(0xffffff);
  for (const [wi, w] of lm.walls.entries()) {
    if (only >= 0 && wi !== only) continue;
    const pts = ringPoints(w.line).map((q, i) => ({ ...q, g: w.ground[i] ?? 0, h: Math.max(4, w.height[i] ?? 6) }));
    // ringPoints drops a closing duplicate; walls are polylines, so keep all vertices
    const raw: { x: number; z: number; g: number; h: number }[] = [];
    for (let i = 0; i + 1 < w.line.length; i += 2) raw.push({ x: w.line[i]!, z: w.line[i + 1]!, g: w.ground[i / 2] ?? 0, h: Math.max(4, w.height[i / 2] ?? 6) });
    void pts;
    const near = w.dist < 120;
    const thick = 2.4;
    if (detail && !near) continue;
    for (let i = 0; i + 1 < raw.length; i++) {
      const a = raw[i]!;
      const b = raw[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.3) continue;
      const nx = (-(b.z - a.z) / len) * (thick / 2);
      const nz = ((b.x - a.x) / len) * (thick / 2);
      const ta = a.g + a.h;
      const tb = b.g + b.h;
      // both faces (tapial texture), top
      if (!detail) {
        texWall(fac, a.x + nx, a.z + nz, a.g - 3, ta, b.x + nx, b.z + nz, b.g - 3, tb, FT.tapial, tint, 3.2);
        texWall(fac, b.x - nx, b.z - nz, b.g - 3, tb, a.x - nx, a.z - nz, a.g - 3, ta, FT.tapial, tint, 3.2);
        const c = new THREE.Color(TAPIAL_COL).multiplyScalar(0.9);
        top.quad(new THREE.Vector3(a.x - nx, ta, a.z - nz), new THREE.Vector3(b.x - nx, tb, b.z - nz), new THREE.Vector3(b.x + nx, tb, b.z + nz), new THREE.Vector3(a.x + nx, ta, a.z + nz), [0, 0], [1, 0], [1, 1], [0, 1], c, c, c, c, new THREE.Vector3(0, 1, 0));
        continue;
      }
      if (near) merlons(p, a.x + nx * 0.7, a.z + nz * 0.7, b.x + nx * 0.7, b.z + nz * 0.7, Math.min(ta, tb), 2.0, 0xc4945e, 1.0);
    }
    // square towers at the corners of the near walls
    if (!near || !detail) continue;
    for (let i = 1; i + 1 < raw.length; i++) {
      const a = raw[i - 1]!;
      const b = raw[i]!;
      const c = raw[i + 1]!;
      const a1 = Math.atan2(b.z - a.z, b.x - a.x);
      const a2 = Math.atan2(c.z - b.z, c.x - b.x);
      let d = Math.abs(a2 - a1);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d < 0.6) continue;
      const tw = 6.5;
      const th = b.h + 3;
      p.push(xf(b.x, b.g - 3, b.z, 1, 1, 1, 0, -a1, 0));
      p.box(0, (th + 3) / 2, 0, tw, th + 3, tw, TAPIAL_COL, m);
      merlons(p, -tw / 2, tw / 2 - 0.3, tw / 2, tw / 2 - 0.3, th + 3, 2.0, 0xc4945e, 1.0);
      merlons(p, -tw / 2, -tw / 2 + 0.3, tw / 2, -tw / 2 + 0.3, th + 3, 2.0, 0xc4945e, 1.0);
      merlons(p, tw / 2 - 0.3, -tw / 2, tw / 2 - 0.3, tw / 2, th + 3, 2.0, 0xc4945e, 1.0);
      merlons(p, -tw / 2 + 0.3, -tw / 2, -tw / 2 + 0.3, tw / 2, th + 3, 2.0, 0xc4945e, 1.0);
      p.pop();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Puerta de Palmas and Puente de Palmas
// ---------------------------------------------------------------------------------------------

/** The gate's two round crenellated towers and the renaissance arch, aligned with the bridge. */
function puertaPalmas(bag: Bag, ring: P2[], g0In: number, bridge: P2[], ctx: CityCtx): void {
  let c = centroid(ring);
  const bo = obb(bridge);
  let ry = Math.atan2(bo.ux, bo.uz) + Math.PI / 2;
  let g0 = g0In;
  let half = 3.4;
  // when the lap runs through the gate (a passage in the data), centre the arch on the route and
  // open it to the full runnable width
  const pr = ctx.track.project(c.x, c.z);
  if (Math.abs(pr.lateral) < 6) {
    const lay = ctx.track.layoutAt(pr.s);
    const f = ctx.track.frameAt(pr.s);
    const mid = (lay.left + lay.right) / 2;
    c = { x: f.x + f.nx * mid, z: f.z + f.nz * mid };
    ry = Math.atan2(f.nx, f.nz) + Math.PI / 2;
    half = Math.max(half, (lay.right - lay.left) / 2 + 0.6);
    g0 = f.h;
  }
  const p = bag.props;
  const m = propMaterial(true);
  const spring = Math.max(4.8, half + 1.2);
  const depth = 6;
  const topY = Math.max(11.5, spring + half + 2.2);
  const tr = 3.3;
  const tx = half + 3.5;
  p.push(xf(c.x, g0, c.z, 1, 1, 1, 0, ry, 0));
  for (const sx of [-1, 1]) {
    p.box(sx * (half + (tx - half) / 2), topY / 2, 0, tx - half, topY, depth, GRANITE, m);
    p.add(T.cyl(16), xf(sx * tx, (topY + 1) / 2, 0, tr, topY + 1, tr), GRANITE, m);
    p.add(T.frustum(0.85, 16), xf(sx * tx, 0.7, 0, tr + 0.5, 1.4, tr + 0.5), GRANITE_DARK, m);
    p.add(T.cyl(16), xf(sx * tx, topY + 1.1, 0, tr + 0.4, 1.0, tr + 0.4), GRANITE_DARK, m);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      p.box(sx * tx + Math.sin(a) * (tr + 0.1), topY + 2.2, Math.cos(a) * (tr + 0.1), 0.8, 1.1, 0.55, GRANITE, m, a);
    }
  }
  const n = 12;
  const rOut = half + 1.0;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI;
    const a1 = ((k + 1) / n) * Math.PI;
    const am = (a0 + a1) / 2;
    const xm = (Math.cos(am) * (half + rOut)) / 2;
    const ym = spring + (Math.sin(am) * (half + rOut)) / 2;
    p.add(T.box, xf(xm, ym, 0, 2 * rOut * Math.sin((a1 - a0) / 2) + 0.05, rOut - half, depth + 0.3, 0, 0, am - Math.PI / 2), k % 2 ? GRANITE_DARK : 0xe6dbc4, m);
    const xa = Math.cos(a1) * rOut;
    const xb = Math.cos(a0) * rOut;
    const yLow = spring + Math.min(Math.sin(a0), Math.sin(a1)) * rOut;
    p.box((xa + xb) / 2, (yLow + topY) / 2, 0, Math.abs(xa - xb), topY - yLow, depth, GRANITE, m);
  }
  for (const zf of [depth / 2, -depth / 2]) {
    p.sign("escudo", 0, topY - 1.2, zf + Math.sign(zf) * 0.06, 1.8, zf > 0 ? 0 : Math.PI);
    merlons(p, -half - 1, zf - Math.sign(zf) * 0.4, half + 1, zf - Math.sign(zf) * 0.4, topY, 0.85, GRANITE_DARK, 0.6);
  }
  p.pop();
  storkNest(bag, c.x + Math.sin(ry) * 0 + Math.cos(ry) * tx, g0 + topY + 2.8, c.z - Math.sin(ry) * tx);
}

/** Puente de Palmas: granite parapets on the route's deck, arches and cutwater piers below. */
function puentePalmas(ctx: CityCtx, bag: Bag, fac: Acc, ts: TS): void {
  const bridges = ctx.city.meta.bridges.find((b) => b.name === "Puente de Palmas");
  if (!bridges) return;
  const a = bridges.fromS;
  const b = bridges.toS;
  const half = 3.6;
  const p = bag.props;
  const m = propMaterial(true);
  const tint = new THREE.Color(0xfff6ea);
  const water = ctx.waterLevel;
  const ss = samples(a, b, 6);
  // spandrel faces + parapets along both sides
  for (const side of [1, -1] as const) {
    const lat = side * half;
    for (let i = 0; i + 1 < ss.length; i++) {
      const s0 = ss[i]!;
      const s1 = ss[i + 1]!;
      const A = ts.p(s0, lat, 0);
      const B = ts.p(s1, lat, 0);
      // parapet (outer face, inner face, coping)
      const A2 = ts.p(s0, lat + side * 0.45, 0);
      const B2 = ts.p(s1, lat + side * 0.45, 0);
      if (side > 0) {
        texWall(fac, A2.x, A2.z, A2.y - 1.2, A2.y + 1.0, B2.x, B2.z, B2.y - 1.2, B2.y + 1.0, FT.stonePlain, tint);
        texWall(fac, B.x, B.z, B.y, B.y + 1.0, A.x, A.z, A.y, A.y + 1.0, FT.stonePlain, tint);
      } else {
        texWall(fac, B2.x, B2.z, B2.y - 1.2, B2.y + 1.0, A2.x, A2.z, A2.y - 1.2, A2.y + 1.0, FT.stonePlain, tint);
        texWall(fac, A.x, A.z, A.y, A.y + 1.0, B.x, B.z, B.y, B.y + 1.0, FT.stonePlain, tint);
      }
      p.beam([(A.x + A2.x) / 2, A.y + 1.08, (A.z + A2.z) / 2], [(B.x + B2.x) / 2, B.y + 1.08, (B.z + B2.z) / 2], 0.18, 0xd9d0bc, m);
    }
  }
  // arches: piers every SPAN m
  const SPAN = 16.5;
  const pierW = 3.4;
  for (let s = a + SPAN / 2; s < b - 2; s += SPAN) {
    const f = ts.f(s);
    const heading = Math.atan2(f.tx, f.tz);
    const deck = f.h;
    const bed = water - 3;
    const spring = water + 1.5;
    const r = (SPAN - pierW) / 2;
    const crown = Math.min(spring + r, deck - 1.0);
    const rise = crown - spring;
    // pier with cutwaters (pointed both ends across the flow)
    const q = ts.p(s, 0, 0);
    p.push(xf(q.x, 0, q.z, 1, 1, 1, 0, heading, 0));
    p.box(0, (bed + deck - 0.4) / 2, 0, half * 2 + 0.9, deck - 0.4 - bed, pierW, GRANITE, m);
    for (const sx of [-1, 1]) {
      p.add(T.cyl(4), xf(sx * (half + 0.45), (bed + spring + 2.5) / 2, 0, pierW / Math.SQRT2, spring + 2.5 - bed, pierW / Math.SQRT2, 0, Math.PI / 4, 0), GRANITE_DARK, m);
      p.add(T.cone(4), xf(sx * (half + 0.45), spring + 2.5 + 0.9, 0, pierW / Math.SQRT2, 1.8, pierW / Math.SQRT2, 0, Math.PI / 4, 0), GRANITE, m);
    }
    p.pop();
    // the span to the next pier: spandrels with an arched opening, and the barrel vault
    const sNext = s + SPAN;
    if (sNext > b - 2) break;
    const segs = 6;
    for (const side of [1, -1] as const) {
      const lat = side * (half + 0.45);
      for (let k = 0; k < segs; k++) {
        const t0 = k / segs;
        const t1 = (k + 1) / segs;
        const u0 = s + pierW / 2 + (SPAN - pierW) * t0;
        const u1 = s + pierW / 2 + (SPAN - pierW) * t1;
        const y0 = spring + rise * Math.sin(Math.PI * t0);
        const y1 = spring + rise * Math.sin(Math.PI * t1);
        const A = ts.p(u0, lat, 0);
        const B = ts.p(u1, lat, 0);
        if (side > 0) texWall(fac, A.x, A.z, y0, A.y - 0.2, B.x, B.z, y1, B.y - 0.2, FT.stone, tint);
        else texWall(fac, B.x, B.z, y1, B.y - 0.2, A.x, A.z, y0, A.y - 0.2, FT.stone, tint);
        // intrados
        const C = ts.p(u0, -half - 0.45, 0);
        const D = ts.p(u1, -half - 0.45, 0);
        if (side > 0) {
          const acc = bag.acc(m);
          const col = new THREE.Color(GRANITE_DARK).multiplyScalar(0.75);
          acc.quad(new THREE.Vector3(A.x, y0, A.z), new THREE.Vector3(C.x, y0, C.z), new THREE.Vector3(D.x, y1, D.z), new THREE.Vector3(B.x, y1, B.z), [0, 0], [1, 0], [1, 1], [0, 1], col);
        }
      }
    }
  }
  // classic iron lamps on the parapets
  for (let s = a + 10; s < b; s += 24) {
    for (const side of [1, -1]) {
      const q = ts.p(s + (side > 0 ? 0 : 12), side * (half + 0.2), 1.05);
      p.cyl(q.x, q.y, q.z, 0.12, 0.5, 0x1d2022, 8, m);
      p.cyl(q.x, q.y + 0.5, q.z, 0.06, 2.8, 0x1d2022, 6, m);
      p.cyl(q.x, q.y + 3.3, q.z, 0.17, 0.55, 0xffffff, 6, glowMaterial(), 0.24);
      p.cone(q.x, q.y + 3.85, q.z, 0.3, 0.28, 0x1d2022, 6, m);
    }
  }
}

/** A plain girder bridge across the river on its OSM outline (skyline). */
function simpleBridge(bag: Bag, ctx: CityCtx, ring: P2[], deckY: number): void {
  const o = obb(ring);
  const p = bag.props;
  const m = propMaterial(true);
  const ry = Math.atan2(o.ux, o.uz);
  p.push(xf(o.cx, 0, o.cz, 1, 1, 1, 0, ry, 0));
  const w = o.hw * 2;
  const len = o.hl * 2;
  p.box(0, deckY - 0.8, 0, w, 1.6, len, CONCRETE, m);
  p.box(0, deckY - 2.2, 0, w - 3, 1.4, len, CONCRETE_SHADE, m);
  for (const sx of [-1, 1]) p.box((sx * w) / 2, deckY + 0.55, 0, 0.12, 1.1, len, 0xe8e8e2, metalMaterial());
  for (let z = -len / 2 + 20; z < len / 2 - 10; z += 42) {
    for (const sx of [-1, 1]) p.box((sx * w) / 4, (deckY - 2.9 + ctx.waterLevel - 3) / 2, z, 1.8, deckY - 2.9 - ctx.waterLevel + 3, 1.8, CONCRETE_SHADE, m);
  }
  for (let z = -len / 2 + 10; z < len / 2; z += 30) {
    for (const sx of [-1, 1]) {
      p.cyl((sx * w) / 2 - sx * 0.3, deckY, z, 0.1, 9, 0x8a9096, 6, m);
      p.box((sx * w) / 2 - sx * 1.4, deckY + 9, z, 2.2, 0.15, 0.4, 0x8a9096, m);
    }
  }
  p.pop();
}

/** The templete (music bandstand) of Paseo de San Francisco. */
function templete(bag: Bag, x: number, y: number, z: number): void {
  const p = bag.props;
  const m = propMaterial(true);
  const r = 4.6;
  p.cyl(x, y, z, r + 0.4, 1.4, 0xe2d6bf, 12, m);
  p.cyl(x, y + 1.4, z, r + 0.5, 0.15, 0xc9bca2, 12, m);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    p.cyl(x + Math.cos(a) * r, y + 1.55, z + Math.sin(a) * r, 0.13, 4.2, 0x2d4a3a, 8, m);
    p.box(x + Math.cos(a) * r, y + 2.0, z + Math.sin(a) * r, 0.05, 0.9, 3.4, 0x2d4a3a, m, -a);
  }
  p.cyl(x, y + 5.7, z, r + 0.4, 0.35, 0xe9e2d2, 12, m);
  p.add(T.dome(14, 5), xf(x, y + 6.05, z, r + 0.2, 2.2, r + 0.2), 0x6b8a8a, m);
  p.cyl(x, y + 8.2, z, 0.25, 1.2, 0x2d4a3a, 6, m);
}

/** A stork's nest (twigs) with a stork pair silhouette, on towers and bell gables. */
function storkNest(bag: Bag, x: number, y: number, z: number): void {
  const p = bag.props;
  const m = propMaterial(true);
  p.cyl(x, y, z, 0.95, 0.55, 0x6b5a3e, 10, m, 1.15);
  p.cyl(x, y + 0.5, z, 0.85, 0.08, 0x4e4130, 10, m);
  for (const [dx, dz, ry] of [[-0.25, 0.1, 0.4], [0.3, -0.15, 2.3]] as const) {
    p.push(xf(x + dx, y + 0.55, z + dz, 1, 1, 1, 0, ry, 0));
    p.box(0, 0.42, 0, 0.26, 0.34, 0.55, 0xf4f2ec, m);
    p.box(0, 0.42, -0.25, 0.24, 0.2, 0.22, 0x1d1d1d, m);
    p.cyl(0, 0.55, 0.22, 0.05, 0.35, 0xf4f2ec, 5, m);
    p.box(0, 0.86, 0.3, 0.06, 0.05, 0.28, 0xd8541f, m);
    for (const sx of [-0.06, 0.06]) p.cyl(sx, 0, 0, 0.02, 0.28, 0xd8541f, 4, m);
    p.pop();
  }
}

/**
 * "Bar El Puente": the bar the runner flees from without paying, on the right just before s = 0
 * (by the Avenida de Elvas roundabout exit), with its terrace and the abandoned table.
 */
function barElPuente(ctx: CityCtx, bag: Bag, fac: Acc, top: Acc, ts: TS): void {
  const L = ctx.track.lapLength;
  const s0 = L - 17;
  const s1 = L - 3;
  const lay = ctx.track.layoutAt(L - 8);
  let edge = lay.right;
  for (const w of lay.sidewalks) edge = Math.max(edge, w.to);
  for (const c of lay.carriageways) edge = Math.max(edge, c.to);
  const t0 = edge + 0.4;
  const t1 = edge + 4.4;
  const b0 = t1 + 0.6;
  const b1 = b0 + 7;
  const p = bag.props;
  const m = propMaterial(true);
  // paved patio from the pavement to the bar
  const patio = bag.acc(propMaterial(false));
  const pc = new THREE.Color(0xcfc6b6);
  for (let s = s0 - 2; s < s1 + 2; s += 2) {
    const A = ts.p(s, edge, 0.135);
    const B = ts.p(s, b1, 0.135);
    const C = ts.p(s + 2, b1, 0.135);
    const D = ts.p(s + 2, edge, 0.135);
    patio.quad(A, B, C, D, [0, 0], [1, 0], [1, 1], [0, 1], pc, pc, pc, pc, new THREE.Vector3(0, 1, 0));
  }
  // the bar: a one-storey white pavilion with a glazed front, green awning and its sign
  const ring: P2[] = [];
  for (const [s, l] of [[s0, b0], [s0, b1], [s1, b1], [s1, b0]] as const) {
    const q = ts.p(s, l, 0);
    ring.push({ x: q.x, z: q.z });
  }
  const r = signedArea(ring) > 0 ? ring.reverse() : ring;
  const y0 = ts.p((s0 + s1) / 2, b0, 0).y + 0.13;
  extrude(fac, top, r, y0 - 2, y0 + 3.8, FT.glassShop, new THREE.Color(0xffffff));
  const f = ts.f((s0 + s1) / 2);
  const face = ts.p((s0 + s1) / 2, b0, 0);
  const ry = Math.atan2(-f.nx, -f.nz); // local +Z looks back at the road
  p.push(xf(face.x, y0, face.z, 1, 1, 1, 0, ry, 0));
  const w = s1 - s0;
  p.box(0, 3.55, 0.3, w + 0.4, 0.5, 0.6, 0xf4f1ea, m);
  const uv = signSlot("bar-el-puente", drawLabel("Bar El Puente", "#1f2328", "#ffd98a", { serif: true }));
  p.quad(new THREE.Matrix4().makeScale(6.4, 1.2, 1).setPosition(0, 4.6, 0.08), 0xffffff, signMaterial(), uv);
  p.box(0, 4.6, 0.03, 6.6, 1.35, 0.06, PAL.ink, m);
  // awning over the terrace
  for (let k = 0; k < 8; k++) {
    const x0 = -w / 2 + (k * w) / 8;
    p.add(T.box, xf(x0 + w / 16, 3.05, 1.1, w / 8, 0.04, 2.3, -0.28, 0, 0), k % 2 ? PAL.red : PAL.white, m);
  }
  p.pop();
  // terrace: tables, chairs and parasols; the last one abandoned (plate, half beer, chair pushed back)
  for (let k = 0; k < 3; k++) {
    const s = s0 + 2.5 + k * 4.2;
    const q = ts.p(s, (t0 + t1) / 2, 0.135);
    const abandoned = k === 2;
    p.cyl(q.x, q.y, q.z, 0.04, 0.72, 0x9aa0a6, 6, m);
    p.cyl(q.x, q.y + 0.72, q.z, 0.45, 0.04, 0xd9dcde, 14, m);
    for (const a of [0, Math.PI]) {
      const off = abandoned && a === 0 ? 1.0 : 0.65;
      const cx = q.x + Math.cos(a + ry) * off;
      const cz = q.z + Math.sin(a + ry) * off;
      p.box(cx, q.y + 0.45, cz, 0.42, 0.04, 0.42, 0x9aa0a6, m, a + ry);
      for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]] as const) p.box(cx + dx, q.y + 0.22, cz + dz, 0.035, 0.44, 0.035, 0x9aa0a6, m);
    }
    // parasol
    p.cyl(q.x, q.y + 0.76, q.z, 0.03, 1.7, 0xdddddd, 6, m);
    p.cone(q.x, q.y + 2.3, q.z, 1.5, 0.5, k % 2 ? 0xc8102e : 0xefeadf, 8, m);
    if (abandoned) {
      p.cyl(q.x + 0.12, q.y + 0.76, q.z, 0.14, 0.02, 0xffffff, 12, m);
      p.cyl(q.x + 0.12, q.y + 0.78, q.z, 0.08, 0.03, 0xc47a2c, 8, m);
      p.cyl(q.x - 0.15, q.y + 0.76, q.z + 0.1, 0.04, 0.16, 0xe8b84a, 8, m);
      p.cyl(q.x - 0.15, q.y + 0.92, q.z + 0.1, 0.042, 0.03, 0xfaf6ea, 8, m);
      p.box(q.x, q.y + 0.765, q.z - 0.2, 0.12, 0.005, 0.09, 0xffffff, m);
    } else {
      p.cyl(q.x - 0.1, q.y + 0.76, q.z, 0.035, 0.12, 0xe8b84a, 8, m);
      p.cyl(q.x + 0.15, q.y + 0.76, q.z + 0.1, 0.1, 0.02, 0xffffff, 10, m);
    }
  }
}

/** The blue direction sign at the start: "Puente Real · Badajoz centro", on two posts to the right. */
export function startSign(ctx: CityCtx, bag: Bag, ts: TS): void {
  const s = 70;
  const lay = ctx.track.layoutAt(s);
  let edge = lay.right;
  for (const w of lay.sidewalks) edge = Math.max(edge, w.to);
  const q = ts.p(s, edge + 1.4, 0.13);
  const f = ts.f(s);
  const ry = Math.atan2(-f.tx, -f.tz);
  const p = bag.props;
  p.push(xf(q.x, q.y, q.z, 1, 1, 1, 0, ry, 0));
  for (const x of [-1.9, 1.9]) p.box(x, 1.6, 0.05, 0.12, 3.2, 0.12, PAL.darkGrey, flatMaterial());
  p.box(0, 3.4, 0, 4.6, 1.0, 0.08, 0x1d4f9e, flatMaterial());
  const uv = signSlot("start-sign", drawLabel("Puente Real · Badajoz centro", "#1d4f9e", "#ffffff", { border: "#ffffff" }));
  p.quad(new THREE.Matrix4().makeScale(4.5, 0.85, 1).setPosition(0, 3.4, 0.05), 0xffffff, signMaterial(), uv);
  p.pop();
}


/** Move a round object of radius r centred at (x, z) out of the runnable surface (+ margin). */
function keepClear(ctx: CityCtx, x: number, z: number, r: number, nearS?: number): [number, number] {
  const pr = ctx.track.project(x, z, nearS);
  const lay = ctx.track.layoutAt(pr.s);
  const lo = lay.left - r - 0.6;
  const hi = lay.right + r + 0.6;
  if (pr.lateral <= lo || pr.lateral >= hi) return [x, z];
  const lat = pr.lateral - lo < hi - pr.lateral ? lo : hi;
  const f = ctx.track.frameAt(pr.s);
  return [f.x + f.nx * lat, f.z + f.nz * lat];
}

/** Roundabout islands: granite kerb ring, setts apron, lawn and a flower ring, a fountain on the big ones, chevron signs. */
const roundaboutsDone = new WeakMap<CityCtx, Set<string>>();
function roundabouts(ctx: CityCtx, bag: Bag, ts: TS, only: number): void {
  let done = roundaboutsDone.get(ctx);
  if (!done) roundaboutsDone.set(ctx, (done = new Set()));
  const m = propMaterial(true);
  const p = bag.props;
  for (const st of ctx.track.stretches) {
    const rb = st.section.roundabout;
    if (!rb || st.fromS !== only) continue;
    const key = `${Math.round(rb.cx)},${Math.round(rb.cz)}`;
    if (done.has(key)) continue;
    done.add(key);
    let dmin = Infinity;
    let hSum = 0;
    let n = 0;
    for (let s = st.fromS; s <= st.toS; s += 2) {
      const f = ts.f(s);
      dmin = Math.min(dmin, Math.hypot(f.x - rb.cx, f.z - rb.cz));
      hSum += f.h;
      n++;
    }
    let inner = 0;
    for (const w of st.layout.sidewalks) inner = Math.min(inner, w.from);
    for (const c of st.layout.carriageways) inner = Math.min(inner, c.from);
    inner = Math.min(inner, st.layout.left);
    const R = dmin + inner - 0.05;
    if (R < 3) continue;
    const y = hSum / Math.max(1, n);
    const seg = Math.max(24, Math.round(R * 2.5));
    const acc = bag.acc(m);
    const kerbC = new THREE.Color(0xd2cec6);
    const grass = new THREE.Color(0x7d9648);
    const earth = new THREE.Color(0x8a6e4e);
    const P = (a: number, r: number, yy: number): THREE.Vector3 => new THREE.Vector3(rb.cx + Math.cos(a) * r, yy, rb.cz + Math.sin(a) * r);
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2;
      const a1 = ((k + 1) / seg) * Math.PI * 2;
      // kerb face (outward) and top
      acc.quad(P(a1, R, y - 0.3), P(a0, R, y - 0.3), P(a0, R, y + 0.22), P(a1, R, y + 0.22), [0, 0], [1, 0], [1, 1], [0, 1], kerbC);
      acc.quad(P(a0, R, y + 0.22), P(a0, R - 0.3, y + 0.22), P(a1, R - 0.3, y + 0.22), P(a1, R, y + 0.22), [0, 0], [1, 0], [1, 1], [0, 1], kerbC, kerbC, kerbC, kerbC, new THREE.Vector3(0, 1, 0));
      // lawn (slightly domed) with a ring of flowers / earth
      const rings: [number, number, number, number, THREE.Color][] = [
        [R - 0.3, R - 1.3, 0.24, 0.3, earth],
        [R - 1.3, R * 0.25, 0.3, 0.55, grass],
      ];
      for (const [r0, r1, y0, y1, c] of rings) {
        if (r1 <= 0.2 || r0 <= r1) continue;
        acc.quad(P(a0, r0, y + y0), P(a0, r1, y + y1), P(a1, r1, y + y1), P(a1, r0, y + y0), [0, 0], [1, 0], [1, 1], [0, 1], c, c, c, c, new THREE.Vector3(0, 1, 0));
      }
      acc.tri(P(a0, R * 0.25, y + 0.55), new THREE.Vector3(rb.cx, y + 0.6, rb.cz), P(a1, R * 0.25, y + 0.55), [0, 0], [0, 0], [0, 0], grass, new THREE.Vector3(0, 1, 0));
    }
    // flowers on the earth ring
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const q = P(a, R - 0.8, y + 0.3);
      p.blob(q.x, q.y + 0.12, q.z, 0.28, 0.18, 0.28, k % 3 === 0 ? 0xe5484d : k % 3 === 1 ? 0x8db87a : 0xfcf8f1, m);
    }
    if (R > 15) {
      // a round fountain basin with a jet
      p.cyl(rb.cx, y + 0.5, rb.cz, R * 0.22, 0.6, 0xe2dccf, 20, m);
      p.cyl(rb.cx, y + 1.05, rb.cz, R * 0.2, 0.06, 0x6c8fa0, 20, waterLike());
      p.cyl(rb.cx, y + 1.05, rb.cz, 0.5, 1.2, 0xe2dccf, 10, m);
      p.cone(rb.cx, y + 2.2, rb.cz, 0.35, 2.4, 0xdfeef5, 10, waterLike());
    }
    // chevron signs on the island facing the entry
    const e = ts.f(st.fromS + 3);
    const dx = rb.cx - e.x;
    const dz = rb.cz - e.z;
    const dl = Math.hypot(dx, dz) || 1;
    const sx = e.x + (dx / dl) * (dmin - R + 1.0) + (dx / dl) * 0.5;
    const sz = e.z + (dz / dl) * (dmin - R + 1.0) + (dz / dl) * 0.5;
    const ry = Math.atan2(-dx, -dz);
    p.cyl(sx, y + 0.2, sz, 0.05, 1.1, 0x8a9096, 6, m);
    p.cyl(sx + Math.cos(ry) * 0.9, y + 0.2, sz - Math.sin(ry) * 0.9, 0.05, 1.1, 0x8a9096, 6, m);
    p.push(xf(sx + Math.cos(ry) * 0.45, y + 1.55, sz - Math.sin(ry) * 0.45, 1, 1, 1, 0, ry, 0));
    p.box(0, 0, 0, 1.9, 0.5, 0.04, 0x1d4f9e, m);
    for (let k = 0; k < 3; k++) {
      const x = -0.55 + k * 0.55;
      p.add(T.box, xf(x - 0.06, 0.07, 0.025, 0.08, 0.26, 0.01, 0, 0, -0.6), 0xffffff, m);
      p.add(T.box, xf(x - 0.06, -0.07, 0.025, 0.08, 0.26, 0.01, 0, 0, 0.6), 0xffffff, m);
    }
    p.pop();
  }
}

let waterLikeMat: THREE.Material | null = null;
function waterLike(): THREE.Material {
  return (waterLikeMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 }));
}
