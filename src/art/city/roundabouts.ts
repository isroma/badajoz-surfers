/**
 * Roundabouts, each built as ONE coherent object from `city.roundabouts` (the ring's real centre,
 * island and outer kerbs, lanes and arms): the complete circulating carriageway with its lane lines
 * and direction arrows, the island (kerb, lawn, fountain / monument, blue "sentido giratorio" signs
 * and chevrons facing every entry), every arm's first metres with flared kerbs, splitter islands,
 * give-way lines, zebras, the outer pavement, and barrier rows a few metres into the arms the route
 * does not take. Inside a ring's footprint this object owns the ground: road.ts and the street
 * network draw nothing there (see `inRingFootprint`).
 */
import * as THREE from "three";
import type { CityRoundabout, CityRoundaboutArm } from "../../city/data";
import { PAL } from "../palette";
import type { Bag } from "./bag";
import { SURFACE_COLOUR, flatMaterial, paintMaterial, signMaterial, signSlot } from "./cmats";
import type { CityCtx } from "./context";
import { chevronDraw } from "./guides";
import { newFrame } from "./track";
import { widthOf } from "./network";
import { laneOffsetAt, merges as engineMerges } from "../../game/lanes";

const UP = new THREE.Vector3(0, 1, 0);
const KERB = 0.14;
/** Arms are drawn this far beyond the outer kerb; the street network takes over from there. */
export const ARM_LEN = 14;
const LAWN = new THREE.Color(0xcde5ae);

export interface Ring {
  rb: CityRoundabout;
  /** Height of the ring surface (the route's height round it). */
  y: number;
  /** +1: traffic goes round with increasing angle atan2(z − cz, x − cx); −1 the other way. */
  dir: 1 | -1;
  /** (angle, route height) where the route runs over the ring's footprint. */
  samples: [number, number][];
}

const cache = new WeakMap<CityCtx, Ring[]>();

/** The rings with their surface height and turning direction (from the route going round them). */
export function ringsOf(ctx: CityCtx): Ring[] {
  const hit = cache.get(ctx);
  if (hit) return hit;
  const tr = ctx.track;
  const f = newFrame();
  const out: Ring[] = [];
  for (const rb of ctx.city.roundabouts ?? []) {
    let h = 0;
    let n = 0;
    let cross = 0;
    const samples: [number, number][] = [];
    const L = tr.lapLength;
    const len = (((rb.passToS - rb.passFromS) % L) + L) % L;
    for (let d = 0; d <= len; d += 2) {
      tr.frameAt((rb.passFromS + d) % L, f);
      const rx = f.x - rb.cx;
      const rz = f.z - rb.cz;
      if (Math.hypot(rx, rz) > rb.rOuter + 1) continue;
      h += f.h;
      n++;
      cross += rx * f.tz - rz * f.tx;
      samples.push([Math.atan2(rz, rx), f.h]);
    }
    out.push({ rb, y: n ? h / n : rb.h, dir: cross >= 0 ? 1 : -1, samples });
  }
  cache.set(ctx, out);
  return out;
}

/** Inside a ring's footprint (carriageway, island and outer pavement + margin): the ring owns it. */
export function inRingFootprint(ctx: CityCtx, x: number, z: number, margin = 0): Ring | null {
  for (const r of ringsOf(ctx)) if (Math.hypot(x - r.rb.cx, z - r.rb.cz) < r.rb.rOuter + 2.5 + margin) return r;
  return null;
}

/** The arm's ways as point lists starting at the ring. */
function armLines(arm: CityRoundaboutArm): THREE.Vector2[][] {
  return arm.lines.map((flat) => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) pts.push(new THREE.Vector2(flat[i]!, flat[i + 1]!));
    return pts;
  });
}

/** Point and unit direction (outwards) on a polyline where it reaches distance `d` from the centre. */
function atRadius(pts: THREE.Vector2[], c: THREE.Vector2, d: number): { p: THREE.Vector2; u: THREE.Vector2 } | null {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const da = a.distanceTo(c);
    const db = b.distanceTo(c);
    if ((da - d) * (db - d) > 0 && !(i === 0 && da > d)) continue;
    const t = da === db ? 0 : Math.max(0, Math.min(1, (d - da) / (db - da)));
    const p = a.clone().lerp(b, t);
    const u = b.clone().sub(a).normalize();
    if (db < da) u.negate();
    return { p, u };
  }
  return null;
}


/** Build one ring into the bag. `clear(x, z)` is false where the route's own span lies (outside the ring). */
export function buildRoundabout(ctx: CityCtx, bag: Bag, ring: Ring, onRouteSpan: (x: number, z: number) => boolean): void {
  const { rb, y, dir } = ring;
  const c = new THREE.Vector2(rb.cx, rb.cz);
  const hAt = ringHeight(ring);
  const flat = bag.acc(flatMaterial());
  const paint = bag.acc(paintMaterial());
  const p = bag.props;
  const m = flatMaterial();
  const asphalt = new THREE.Color(SURFACE_COLOUR.asphalt);
  const pave = new THREE.Color(SURFACE_COLOUR.hydraulic);
  const kerbC = new THREE.Color(PAL.kerb);
  const white = new THREE.Color(PAL.white);
  // a few cm under the route's own height: its lane tints and the runner sit on top
  // where the route runs, its own height at that point (no step between the runner and the ring)
  const yAt = (x: number, z: number): number => {
    const pr = ctx.track.project(x, z);
    const hr = hAt(Math.atan2(z - rb.cz, x - rb.cx));
    if (Math.abs(pr.lateral) > 14) return hr - 0.05;
    const fh = ctx.track.frameAt(pr.s).h;
    const t = Math.max(0, (Math.abs(pr.lateral) - 8) / 6);
    return fh * (1 - t) + hr * t - 0.05;
  };
  const P = (a: number, r: number, dy: number): THREE.Vector3 => {
    const x = rb.cx + Math.cos(a) * r;
    const z = rb.cz + Math.sin(a) * r;
    return new THREE.Vector3(x, yAt(x, z) + dy, z);
  };
  const up = (acc: typeof flat, A: THREE.Vector3, B: THREE.Vector3, C: THREE.Vector3, D: THREE.Vector3, col: THREE.Color): void => {
    const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(D, A));
    if (n.y > 0) acc.quad(A, B, C, D, [0, 0], [0, 0], [0, 0], [0, 0], col, col, col, col, UP);
    else acc.quad(A, D, C, B, [0, 0], [0, 0], [0, 0], [0, 0], col, col, col, col, UP);
  };
  const sector = (acc: typeof flat, a0: number, a1: number, r0: number, r1: number, dy: number, col: THREE.Color): void => up(acc, P(a0, r0, dy), P(a0, r1, dy), P(a1, r1, dy), P(a1, r0, dy), col);
  const face = (a0: number, a1: number, r: number, y0: number, y1: number, col: THREE.Color, outward: boolean): void => {
    const A0 = P(a0, r, y0), B0 = P(a1, r, y0), A1 = P(a0, r, y1), B1 = P(a1, r, y1);
    const n = new THREE.Vector3().subVectors(B0, A0).cross(UP);
    const out = new THREE.Vector3(A0.x - rb.cx, 0, A0.z - rb.cz);
    if ((n.dot(out) > 0) === outward) flat.quad(A0, B0, B1, A1, [0, 0], [0, 0], [0, 0], [0, 0], col);
    else flat.quad(B0, A0, A1, B1, [0, 0], [0, 0], [0, 0], [0, 0], col);
  };

  const W = rb.rOuter - rb.rInner;
  const lanes = Math.max(1, rb.lanes);
  const lw = W / lanes;
  const N = Math.max(40, Math.ceil((2 * Math.PI * rb.rOuter) / 3.5));
  const O = c;
  const Ro = rb.rOuter + 0.4;
  const angOf = (q: THREE.Vector2): number => Math.atan2(q.y - rb.cz, q.x - rb.cx);
  const angDiff = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const V3 = (q: THREE.Vector2, dy: number): THREE.Vector3 => new THREE.Vector3(q.x, yAt(q.x, q.y) + dy, q.y);
  const tri = (acc: typeof flat, A: THREE.Vector3, B: THREE.Vector3, C: THREE.Vector3, col: THREE.Color): void => {
    const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
    if (n.y > 0) acc.tri(A, B, C, [0, 0], [0, 0], [0, 0], col, UP);
    else acc.tri(A, C, B, [0, 0], [0, 0], [0, 0], col, UP);
  };

  // --- per arm way: entry or exit, its own width, the street it hands over to, the kerb returns ---
  interface Way { arm: CityRoundaboutArm; pts: THREE.Vector2[]; M: THREE.Vector2; u: THREE.Vector2; n: THREE.Vector2; entry: boolean; w: number; wNet: number; walk: number; fillets: { side: 1 | -1; C: THREE.Vector2; R: number; E1: THREE.Vector2; T: THREE.Vector2; dE: number }[] }
  const ways: Way[] = [];
  for (const arm of rb.arms) {
    const lines = armLines(arm);
    const split = arm.splitter && lines.length >= 2;
    lines.forEach((pts, li) => {
      const at = atRadius(pts, c, rb.rOuter);
      if (!at) return;
      const n = new THREE.Vector2(-at.u.y, at.u.x);
      const inboundRight = new THREE.Vector2(at.u.y, -at.u.x);
      const other = split ? lines.find((o) => o !== pts) : undefined;
      const ao = other ? atRadius(other, c, rb.rOuter) : null;
      const entry = arm.flow === "entry" || (arm.flow === "both" && (!split || !ao || ao.p.clone().sub(at.p).dot(inboundRight) < 0));
      const w = Math.max(3.2, split ? (entry ? arm.widthIn : arm.widthOut) || 3.5 : arm.widthIn + arm.widthOut || 6.5);
      const st = ctx.city.streets.find((s) => s.osmWay === (arm.osmWays[li] ?? arm.osmWays[0]));
      const wn = st ? widthOf(st) : { road: w, walk: 2.4 };
      const way: Way = { arm, pts, M: at.p, u: at.u, n, entry, w, wNet: Math.max(3, wn.road), walk: Math.max(0.8, wn.walk), fillets: [] };
      // kerb returns on the sides that face a street corner (not the splitter side)
      for (const side of [1, -1] as const) {
        if (ao && ao.p.clone().sub(at.p).dot(n) * side > 0) continue;
        const h0 = w / 2;
        for (const R of [9, 7, 5]) {
          const A = at.p.clone().add(n.clone().multiplyScalar(side * (h0 + R))).sub(O);
          const b = A.dot(at.u);
          const disc = b * b - A.lengthSq() + (Ro + R) * (Ro + R);
          if (disc < 0) continue;
          const t = -b + Math.sqrt(disc);
          if (t < 0 || t > ARM_LEN - 2) continue;
          const C = at.p.clone().add(at.u.clone().multiplyScalar(t)).add(n.clone().multiplyScalar(side * (h0 + R)));
          const E1 = at.p.clone().add(at.u.clone().multiplyScalar(t)).add(n.clone().multiplyScalar(side * h0));
          const T = O.clone().add(C.clone().sub(O).normalize().multiplyScalar(Ro));
          way.fillets.push({ side, C, R, E1, T, dE: rb.rOuter + t });
          break;
        }
      }
      ways.push(way);
    });
  }
  // openings in the ring's outer kerb: between a way's two kerb-return tangent points (or its width)
  const openings: [number, number][] = [];
  for (const wy of ways) {
    const a0 = angOf(wy.M);
    const hw = (wy.w / 2 + 0.5) / rb.rOuter;
    let lo = -hw;
    let hi = hw;
    for (const f of wy.fillets) {
      const d = angDiff(angOf(f.T), a0);
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    openings.push([a0 + lo, a0 + hi]);
  }
  const inOpening = (a: number, extra = 0): boolean => openings.some(([l, h]) => {
    const mid = (l + h) / 2;
    return Math.abs(angDiff(a, mid)) < (h - l) / 2 + extra;
  });

  // which ring lanes the runner is ever offered (engine merges: a zero-length merge = never offered)
  const never = new Set<string>();
  for (const mg of engineMerges(ctx.track)) if (mg.s1 - mg.s0 < 0.5) never.add(`${mg.fromStretch}:${mg.lane}`);
  const runBand = new Array<boolean>(lanes).fill(false);
  {
    const f = newFrame();
    const L = ctx.track.lapLength;
    const len = (((rb.passToS - rb.passFromS) % L) + L) % L;
    for (let d = 0; d <= len; d += 2) {
      const s = (rb.passFromS + d) % L;
      ctx.track.frameAt(s, f);
      const si = ctx.track.stretches.findIndex((st) => s >= st.fromS && s < st.toS);
      const lay = ctx.track.layoutAt(s);
      lay.offsets.forEach((_, k) => {
        if (never.has(`${si}:${k}`)) return;
        const o = laneOffsetAt(ctx.track, k, s);
        const r = Math.hypot(f.x + f.nx * o - rb.cx, f.z + f.nz * o - rb.cz);
        const j = Math.floor((r - rb.rInner) / lw);
        if (r > rb.rInner && r < rb.rOuter && j >= 0 && j < lanes) runBand[j] = true;
      });
    }
    if (!runBand.some(Boolean)) runBand.fill(true);
  }

  // --- 1. the circulating carriageway, complete, with lane lines, edge lines and arrows --------
  const offC = new THREE.Color(PAL.roadOff);
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * Math.PI * 2;
    const a1 = ((k + 1) / N) * Math.PI * 2;
    sector(flat, a0, a1, rb.rInner, rb.rOuter + 0.4, 0, asphalt);
    // lanes the runner is never offered: the "off" tint (they do not look like lanes)
    for (let j = 0; j < lanes; j++) if (!runBand[j]) sector(paint, a0, a1, rb.rInner + j * lw, rb.rInner + (j + 1) * lw, 0.008, offC);
    sector(paint, a0, a1, rb.rInner + 0.25, rb.rInner + 0.4, 0.01, white);
    if (!inOpening((a0 + a1) / 2)) sector(paint, a0, a1, rb.rOuter - 0.4, rb.rOuter - 0.25, 0.01, white);
  }
  for (let j = 1; j < lanes; j++) {
    const r = rb.rInner + j * lw;
    const solid = runBand[j - 1] !== runBand[j];
    const n = Math.max(12, Math.round((2 * Math.PI * r) / 6));
    for (let k = 0; k < (solid ? N : n); k++) {
      const a0 = (k / (solid ? N : n)) * Math.PI * 2;
      const a1 = solid ? ((k + 1) / N) * Math.PI * 2 : a0 + 3 / r;
      sector(paint, a0, a1, r - 0.06, r + 0.06, 0.011, white);
    }
  }
  for (let j = 0; j < lanes; j++) {
    if (!runBand[j]) continue;
    const r = rb.rInner + (j + 0.5) * lw;
    const n = Math.max(3, Math.round((2 * Math.PI * r) / 20));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + j * 0.3;
      if (inOpening(a, 0.05)) continue;
      const a1 = a + (dir * 2.2) / r;
      sector(paint, Math.min(a, a1), Math.max(a, a1), r - 0.08, r + 0.08, 0.012, white);
      const h1 = a1 + (dir * 1.4) / r;
      tri(paint, P(a1, r - 0.45, 0.012), P(a1, r + 0.45, 0.012), P(h1, r, 0.012), white);
    }
  }

  // --- 2. the island ------------------------------------------------------------------------------
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * Math.PI * 2;
    const a1 = ((k + 1) / N) * Math.PI * 2;
    face(a0, a1, rb.rInner, -0.05, KERB, kerbC, true);
    sector(flat, a0, a1, rb.rInner - 0.3, rb.rInner, KERB, kerbC);
    sector(flat, a0, a1, Math.max(0.3, rb.rInner * 0.35), rb.rInner - 0.3, KERB + 0.02, LAWN);
    up(flat, P(a0, Math.max(0.3, rb.rInner * 0.35), KERB + 0.02), new THREE.Vector3(rb.cx, y + KERB + 0.06, rb.cz), new THREE.Vector3(rb.cx, y + KERB + 0.06, rb.cz), P(a1, Math.max(0.3, rb.rInner * 0.35), KERB + 0.02), LAWN);
  }
  const tagged = (k: string, v?: RegExp): CityRoundabout["island"] => rb.island.filter((i) => i.tags[k] !== undefined && (!v || v.test(i.tags[k]!)));
  const monuments = [...tagged("historic"), ...tagged("tourism", /artwork/)];
  // one water feature only: a mapped pond (drawn by the ground) wins over a generated fountain
  const mappedPond = ctx.city.water.some((wa) => {
    let sx = 0, sz = 0, n = 0;
    for (let i = 0; i + 1 < wa.ring.length; i += 2) { sx += wa.ring[i]!; sz += wa.ring[i + 1]!; n++; }
    return n > 0 && Math.hypot(sx / n - rb.cx, sz / n - rb.cz) < rb.rInner;
  });
  const fountainTag = [...tagged("amenity", /fountain/), ...tagged("natural", /water/)].length > 0;
  if (!mappedPond && (fountainTag || (monuments.length === 0 && rb.rInner > 12 && tagged("natural", /tree/).length === 0))) {
    const R = Math.min(rb.rInner * 0.3, 6);
    p.cyl(rb.cx, y + KERB, rb.cz, R, 0.6, 0xe2dccf, 20, m);
    p.cyl(rb.cx, y + KERB + 0.55, rb.cz, R - 0.3, 0.08, PAL.water, 20, m);
    p.cyl(rb.cx, y + KERB + 0.6, rb.cz, 0.5, 1.4, 0xe2dccf, 10, m);
    p.cone(rb.cx, y + KERB + 2.0, rb.cz, 0.35, 2.2, 0xdfeef5, 10, m);
  }
  for (const mo of monuments.slice(0, 1)) {
    const x = Math.hypot(mo.x - rb.cx, mo.z - rb.cz) < rb.rInner - 2 ? mo.x : rb.cx;
    const z = x === mo.x ? mo.z : rb.cz;
    p.box(x, y + KERB + 0.6, z, 2.4, 1.2, 2.4, 0xd8cdb8, m);
    p.box(x, y + KERB + 2.2, z, 1.0, 2.0, 1.0, 0xcfc3ab, m);
    p.box(x, y + KERB + 4.0, z, 0.6, 1.8, 0.6, 0x8a8f94, m);
  }

  // signs on the island facing every entry, placed from the world geometry (always inside rInner)
  const chevUv = signSlot(`chevron-${dir > 0 ? "left" : "right"}`, chevronDraw(dir > 0 ? "left" : "right"));
  const signed = new Set<CityRoundaboutArm>();
  for (const wy of ways) {
    if (!wy.entry || signed.has(wy.arm)) continue;
    signed.add(wy.arm);
    const ang = angOf(wy.M);
    const q = P(ang, rb.rInner - 1.2, KERB);
    const ry = Math.atan2(Math.cos(ang), Math.sin(ang)); // local +Z points out at the arm
    p.push(new THREE.Matrix4().makeRotationY(ry).setPosition(q.x, q.y, q.z));
    p.cyl(0, 0, 0, 0.05, 2.2, 0x8a9096, 6, m);
    p.add(new THREE.CylinderGeometry(1, 1, 1, 16).rotateX(Math.PI / 2), new THREE.Matrix4().makeScale(0.36, 0.36, 0.04).setPosition(0, 2.2, 0.06), 0x1f5fbf, m);
    p.box(0, 2.2, 0.09, 0.42, 0.07, 0.02, 0xffffff, m);
    for (const x of [-0.8, 0.8]) p.box(x, 0.45, 0, 0.07, 0.9, 0.07, PAL.darkGrey, m);
    p.box(0, 1.15, -0.03, 1.9, 0.55, 0.05, 0xa7adb3, m);
    p.quad(new THREE.Matrix4().makeScale(1.8, 0.5, 1).setPosition(0, 1.15, 0), 0xffffff, signMaterial(true), chevUv);
    p.pop();
  }

  // --- 3. arms -------------------------------------------------------------------------------------
  const barrier = (ax: number, az: number, bx: number, bz: number): void => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 1.3));
    const ry = Math.atan2(bx - ax, bz - az) + Math.PI / 2;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      p.box(ax + (bx - ax) * t, yAt(ax, az) + 0.45, az + (bz - az) * t, (len / n) * 0.96, 0.9, 0.35, k % 2 ? PAL.white : PAL.danger, m, ry);
      if (k % 2) p.box(ax + (bx - ax) * t, yAt(ax, az) + 0.5, az + (bz - az) * t, (len / n) * 0.97, 0.22, 0.37, PAL.danger, m, ry);
    }
  };
  const exactLane = (q: THREE.Vector2): boolean => {
    const pr = ctx.track.project(q.x, q.y);
    if (Math.abs(pr.lateral) >= 40) return false;
    const lay = ctx.track.layoutAt(pr.s);
    return lay.offsets.some((o, k) => Math.abs(pr.lateral - o) < (lay.widths[k] ?? 0) / 2 + 0.15);
  };
  const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  for (const wy of ways) {
    const halfAt = (d: number): number => wy.w / 2 + (wy.wNet / 2 - wy.w / 2) * smooth((d - rb.rOuter - 4) / (ARM_LEN - 4));
    const zebraD = Math.max(rb.rOuter + 6, ...wy.fillets.map((f) => f.dE + 1));
    let prev: { p: THREE.Vector2; u: THREE.Vector2; h: number; d: number } | null = null;
    for (let d = rb.rOuter - 1; d <= rb.rOuter + ARM_LEN + 0.01; d += 1) {
      const at = atRadius(wy.pts, c, d);
      if (!at) break;
      const cur = { p: at.p, u: at.u, h: halfAt(d), d };
      if (prev) {
        const nA = new THREE.Vector2(-prev.u.y, prev.u.x);
        const nB = new THREE.Vector2(-cur.u.y, cur.u.x);
        const mid = prev.p.clone().add(cur.p).multiplyScalar(0.5);
        const inside = mid.distanceTo(c) < rb.rOuter + 2.5;
        if (inside || !onRouteSpan(mid.x, mid.y)) {
          const V = (pt: THREE.Vector2, n: THREE.Vector2, l: number, dy: number): THREE.Vector3 => new THREE.Vector3(pt.x + n.x * l, yAt(pt.x, pt.y) + dy, pt.y + n.y * l);
          up(flat, V(prev.p, nA, -prev.h, -0.02), V(prev.p, nA, prev.h, -0.02), V(cur.p, nB, cur.h, -0.02), V(cur.p, nB, -cur.h, -0.02), asphalt);
          // pavements beyond the kerb return (flush "dropped kerb" across the zebra), splitter side bare
          for (const sd of [1, -1] as const) {
            const fl = wy.fillets.find((f) => f.side === sd);
            if (!fl || prev.d < fl.dE) continue;
            const pw = wy.walk;
            const drop = prev.d >= zebraD - 0.5 && prev.d <= zebraD + 3.5;
            const yy = drop ? 0.02 : KERB;
            up(flat, V(prev.p, nA, sd * prev.h, yy), V(prev.p, nA, sd * (prev.h + pw), yy), V(cur.p, nB, sd * (cur.h + pw), yy), V(cur.p, nB, sd * cur.h, yy), pave);
            up(paint, V(prev.p, nA, sd * prev.h, yy + 0.01), V(prev.p, nA, sd * (prev.h + 0.25), yy + 0.01), V(cur.p, nB, sd * (cur.h + 0.25), yy + 0.01), V(cur.p, nB, sd * cur.h, yy + 0.01), kerbC);
          }
        }
      }
      prev = cur;
    }
    // kerb returns: asphalt fill to the curved kerb, the pavement continuing round the corner
    for (const f of wy.fillets) {
      const aE = Math.atan2(f.E1.y - f.C.y, f.E1.x - f.C.x);
      const aT = Math.atan2(f.T.y - f.C.y, f.T.x - f.C.x);
      const span = angDiff(aT, aE);
      const k = Math.max(4, Math.ceil(Math.abs(span) * f.R / 1.2));
      const apex = wy.M.clone().add(wy.n.clone().multiplyScalar(f.side * (wy.w / 2)));
      for (let i = 0; i < k; i++) {
        const b0 = aE + (span * i) / k;
        const b1 = aE + (span * (i + 1)) / k;
        const q0 = new THREE.Vector2(f.C.x + Math.cos(b0) * f.R, f.C.y + Math.sin(b0) * f.R);
        const q1 = new THREE.Vector2(f.C.x + Math.cos(b1) * f.R, f.C.y + Math.sin(b1) * f.R);
        const qm = q0.clone().add(q1).multiplyScalar(0.5);
        if (qm.distanceTo(c) > rb.rOuter + 2.5 && onRouteSpan(qm.x, qm.y)) continue;
        tri(flat, V3(apex, -0.02), V3(q0, -0.02), V3(q1, -0.02), asphalt);
        const pw = Math.min(wy.walk, f.R - 0.5);
        const r0 = (q: number): THREE.Vector2 => new THREE.Vector2(f.C.x + Math.cos(q) * (f.R - pw), f.C.y + Math.sin(q) * (f.R - pw));
        up(flat, V3(q0, KERB), V3(q1, KERB), V3(r0(b1), KERB), V3(r0(b0), KERB), pave);
        const k0 = new THREE.Vector2(f.C.x + Math.cos(b0) * (f.R - 0.25), f.C.y + Math.sin(b0) * (f.R - 0.25));
        const k1 = new THREE.Vector2(f.C.x + Math.cos(b1) * (f.R - 0.25), f.C.y + Math.sin(b1) * (f.R - 0.25));
        up(paint, V3(q0, KERB + 0.01), V3(q1, KERB + 0.01), V3(k1, KERB + 0.01), V3(k0, KERB + 0.01), kerbC);
        const F0 = V3(q0, -0.03), F1 = V3(q1, -0.03), G0 = V3(q0, KERB), G1 = V3(q1, KERB);
        flat.quad(F0, F1, G1, G0, [0, 0], [0, 0], [0, 0], [0, 0], kerbC);
        flat.quad(F1, F0, G0, G1, [0, 0], [0, 0], [0, 0], [0, 0], kerbC);
      }
    }
    // give way + "ceda el paso" on entries; zebra over the dropped kerbs; barriers on closed arms
    const across = (d: number, f0: number, f1: number, depth: number, col: THREE.Color): void => {
      const q = atRadius(wy.pts, c, d);
      if (!q) return;
      const n = new THREE.Vector2(-q.u.y, q.u.x);
      const A = q.p.clone().add(n.clone().multiplyScalar(f0));
      const B = q.p.clone().add(n.clone().multiplyScalar(f1));
      const U = q.u.clone().multiplyScalar(depth);
      up(paint, V3(A, 0.01), V3(B, 0.01), V3(B.clone().add(U), 0.01), V3(A.clone().add(U), 0.01), col);
    };
    const split = wy.arm.splitter && wy.arm.lines.length >= 2;
    const entrySide = wy.n.dot(new THREE.Vector2(wy.u.y, -wy.u.x)) > 0 ? 1 : -1;
    const [l0, l1] = split ? [-wy.w / 2, wy.w / 2] : entrySide > 0 ? [0, wy.w / 2] : [-wy.w / 2, 0];
    if (wy.entry) {
      for (let l = Math.min(l0, l1) + 0.3; l + 0.5 < Math.max(l0, l1) - 0.2; l += 1) across(rb.rOuter + 0.4, l, l + 0.5, 0.4, white);
      const q = atRadius(wy.pts, c, rb.rOuter + 4);
      if (q) {
        const n = new THREE.Vector2(-q.u.y, q.u.x);
        const lc = (l0 + l1) / 2;
        const T = q.p.clone().add(n.clone().multiplyScalar(lc));
        const A = q.p.clone().add(n.clone().multiplyScalar(lc - 0.6)).add(q.u.clone().multiplyScalar(2.4));
        const B = q.p.clone().add(n.clone().multiplyScalar(lc + 0.6)).add(q.u.clone().multiplyScalar(2.4));
        tri(paint, V3(T, 0.012), V3(A, 0.012), V3(B, 0.012), white);
      }
    }
    const zq = atRadius(wy.pts, c, zebraD);
    if (zq && !onRouteSpan(zq.p.x, zq.p.y)) {
      const h = halfAt(zebraD);
      for (let l = -h + 0.3; l + 0.5 <= h - 0.2; l += 1) across(zebraD, l, l + 0.5, 3, white);
    }
    if (wy.arm.onRoute === null) {
      const bd = zebraD + 4.5;
      const bq = atRadius(wy.pts, c, bd);
      if (bq) {
        const n = new THREE.Vector2(-bq.u.y, bq.u.x);
        const h = halfAt(bd) + 0.2;
        barrier(bq.p.x - n.x * h, bq.p.y - n.y * h, bq.p.x + n.x * h, bq.p.y + n.y * h);
      }
    }
  }
  // splitter islands between an arm's entry and exit ways, kept clear of the runnable lanes
  for (const arm of rb.arms) {
    if (!arm.splitter) continue;
    const ws = ways.filter((wy) => wy.arm === arm);
    if (ws.length < 2) continue;
    const [wa, wb] = [ws[0]!, ws[1]!];
    const A0 = atRadius(wa.pts, c, rb.rOuter + 1.5);
    const B0 = atRadius(wb.pts, c, rb.rOuter + 1.5);
    const A1 = atRadius(wa.pts, c, rb.rOuter + ARM_LEN);
    const B1 = atRadius(wb.pts, c, rb.rOuter + ARM_LEN);
    if (!A0 || !B0 || !A1 || !B1) continue;
    if (A0.p.distanceTo(B0.p) - wa.w / 2 - wb.w / 2 - 0.6 < 0.8) continue;
    const a0 = A0.p.clone().add(B0.p.clone().sub(A0.p).normalize().multiplyScalar(wa.w / 2 + 0.3));
    const b0 = B0.p.clone().add(A0.p.clone().sub(B0.p).normalize().multiplyScalar(wb.w / 2 + 0.3));
    const apex = A1.p.clone().add(B1.p).multiplyScalar(0.5);
    let pts = [a0, b0, apex];
    const cen = a0.clone().add(b0).add(apex).multiplyScalar(1 / 3);
    if (exactLane(cen)) continue;
    // shrink towards its centre until no corner or edge midpoint lies on a runnable lane
    for (let it = 0; it < 12; it++) {
      const probe = [...pts, ...pts.map((q, i) => q.clone().add(pts[(i + 1) % 3]!).multiplyScalar(0.5))];
      if (!probe.some(exactLane)) break;
      pts = pts.map((q) => cen.clone().add(q.clone().sub(cen).multiplyScalar(0.85)));
    }
    if (pts[0]!.distanceTo(pts[1]!) < 0.8) continue;
    tri(flat, V3(pts[0]!, KERB + 0.02), V3(pts[1]!, KERB + 0.02), V3(pts[2]!, KERB + 0.02), pave);
    for (let i = 0; i < 3; i++) {
      const q0 = pts[i]!;
      const q1 = pts[(i + 1) % 3]!;
      const F0 = V3(q0, -0.02), F1 = V3(q1, -0.02), G1 = V3(q1, KERB + 0.02), G0 = V3(q0, KERB + 0.02);
      flat.quad(F0, F1, G1, G0, [0, 0], [0, 0], [0, 0], [0, 0], kerbC);
      flat.quad(F1, F0, G0, G1, [0, 0], [0, 0], [0, 0], [0, 0], kerbC);
    }
    const nose = pts[0]!.clone().add(pts[1]!).multiplyScalar(0.5).add(A1.u.clone().multiplyScalar(0.6));
    if (!exactLane(nose)) {
      p.cyl(nose.x, yAt(nose.x, nose.y) + KERB, nose.y, 0.04, 1.6, 0x8a9096, 6, m);
      p.cyl(nose.x, yAt(nose.x, nose.y) + KERB + 1.75, nose.y, 0.28, 0.04, 0x1f5fbf, 14, m);
    }
  }

  // --- outer pavement all round, open only between each mouth's kerb-return tangent points -------
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * Math.PI * 2;
    const a1 = ((k + 1) / N) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    if (inOpening(am)) continue;
    const mid = P(am, rb.rOuter + 1.4, 0);
    if (onRouteSpan(mid.x, mid.z) && Math.hypot(mid.x - rb.cx, mid.z - rb.cz) > rb.rOuter + 2.5) continue;
    sector(flat, a0, a1, rb.rOuter + 0.4, rb.rOuter + 2.6, KERB, pave);
    sector(flat, a0, a1, rb.rOuter + 0.4, rb.rOuter + 0.65, KERB + 0.005, kerbC);
    face(a0, a1, rb.rOuter + 0.4, -0.05, KERB, kerbC, false);
  }
}

const heightCache = new WeakMap<Ring, (a: number) => number>();

/** Ring surface height by angle: the route's own height where it runs on the ring, eased between. */
export function ringHeight(ring: Ring): (a: number) => number {
  const hit = heightCache.get(ring);
  if (hit) return hit;
  const B = 72;
  const h: (number | null)[] = new Array(B).fill(null);
  for (const [a, y] of ring.samples) {
    const k = Math.floor(((a / (2 * Math.PI)) % 1 + 1) % 1 * B);
    h[k] = h[k] === null ? y : (h[k]! + y) / 2;
  }
  const known = h.map((v, k) => (v === null ? -1 : k)).filter((k) => k >= 0);
  const out = h.map((v, k) => {
    if (v !== null) return v;
    if (!known.length) return ring.y;
    // interpolate round the circle between the nearest known bins either side
    let lo = k;
    let hi = k;
    let dl = 0;
    let dh = 0;
    while (h[lo] === null) { lo = (lo - 1 + B) % B; dl++; }
    while (h[hi] === null) { hi = (hi + 1) % B; dh++; }
    return (h[lo]! * dh + h[hi]! * dl) / (dl + dh);
  });
  const fn = (a: number): number => {
    const f = ((a / (2 * Math.PI)) % 1 + 1) % 1 * B;
    const k0 = Math.floor(f) % B;
    const k1 = (k0 + 1) % B;
    const t = f - Math.floor(f);
    return out[k0]! * (1 - t) + out[k1]! * t;
  };
  heightCache.set(ring, fn);
  return fn;
}
