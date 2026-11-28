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

function armWidth(arm: CityRoundaboutArm): number {
  if (arm.splitter && arm.lines.length >= 2) return Math.max(arm.widthIn, arm.widthOut, 3.2);
  return Math.max(3.2, arm.widthIn + arm.widthOut || 6.5);
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

  const inLane = (x: number, z: number): boolean => {
    const pr = ctx.track.project(x, z);
    if (Math.abs(pr.lateral) >= 40) return false;
    return [ctx.wideLayout(pr.s), ctx.track.layoutAt(pr.s)].some((lay) => lay.offsets.some((o, k) => Math.abs(pr.lateral - o) < (lay.widths[k] ?? 0) / 2 + 0.3));
  };
  const W = rb.rOuter - rb.rInner;
  const lanes = Math.max(1, rb.lanes);
  const lw = W / lanes;
  const N = Math.max(40, Math.ceil((2 * Math.PI * rb.rOuter) / 3.5));
  const arms = rb.arms.map((arm) => ({ arm, lines: armLines(arm), w: armWidth(arm) }));
  // angular half-openings of the arms at the outer kerb (pavement and edge line break there)
  const openings: [number, number][] = [];
  for (const a of arms) {
    for (const ln of a.lines) {
      const at = atRadius(ln, c, rb.rOuter);
      if (!at) continue;
      const ang = Math.atan2(at.p.y - rb.cz, at.p.x - rb.cx);
      openings.push([ang, (a.w / 2 + 2.2) / rb.rOuter]);
    }
  }
  const angDiff = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const inOpening = (a: number, extra = 0): boolean => openings.some(([o, h]) => angDiff(a, o) < h + extra);

  // --- 1. the circulating carriageway, complete, with lane lines, edge lines and arrows --------
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * Math.PI * 2;
    const a1 = ((k + 1) / N) * Math.PI * 2;
    sector(flat, a0, a1, rb.rInner, rb.rOuter + 0.4, 0, asphalt);
    // inner edge line (solid), outer edge line broken at the arms
    sector(paint, a0, a1, rb.rInner + 0.25, rb.rInner + 0.4, 0.01, white);
    if (!inOpening((a0 + a1) / 2)) sector(paint, a0, a1, rb.rOuter - 0.4, rb.rOuter - 0.25, 0.01, white);
  }
  for (let j = 1; j < lanes; j++) {
    const r = rb.rInner + j * lw;
    const n = Math.max(12, Math.round((2 * Math.PI * r) / 6));
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2;
      const a1 = a0 + (3 / r);
      sector(paint, a0, a1, r - 0.06, r + 0.06, 0.01, white);
    }
  }
  for (let j = 0; j < lanes; j++) {
    const r = rb.rInner + (j + 0.5) * lw;
    const n = Math.max(3, Math.round((2 * Math.PI * r) / 20));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + j * 0.3;
      if (inOpening(a, 0.05)) continue;
      // shaft along the ring direction, then the head
      const a1 = a + (dir * 2.2) / r;
      sector(paint, Math.min(a, a1), Math.max(a, a1), r - 0.08, r + 0.08, 0.012, white);
      const h0 = a1;
      const h1 = a1 + (dir * 1.4) / r;
      const A = P(h0, r - 0.45, 0.012), B = P(h0, r + 0.45, 0.012), T = P(h1, r, 0.012);
      const nn = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(T, A));
      if (nn.y > 0) paint.tri(A, B, T, [0, 0], [0, 0], [0, 0], white, UP);
      else paint.tri(A, T, B, [0, 0], [0, 0], [0, 0], white, UP);
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
  const fountains = [...tagged("amenity", /fountain/), ...tagged("natural", /water/)];
  const monuments = [...tagged("historic"), ...tagged("tourism", /artwork/)];
  if (fountains.length || (monuments.length === 0 && rb.rInner > 12 && tagged("natural", /tree/).length === 0)) {
    // a simple low-poly fountain at the centre
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

  // signs on the island facing every entry: blue "sentido giratorio obligatorio" disc + chevrons
  const chevUv = signSlot(`chevron-${dir > 0 ? "left" : "right"}`, chevronDraw(dir > 0 ? "left" : "right"));
  for (const a of arms) {
    if (a.arm.flow === "exit") continue;
    const at = a.lines.map((ln) => atRadius(ln, c, rb.rOuter)).find((v) => v !== null);
    if (!at) continue;
    const ang = Math.atan2(at.p.y - rb.cz, at.p.x - rb.cx);
    const q = P(ang, rb.rInner - 1.0, KERB);
    const tx = -Math.sin(ang) * 1.2;
    const tz = Math.cos(ang) * 1.2;
    if (inLane(q.x, q.z) || inLane(q.x + tx, q.z + tz) || inLane(q.x - tx, q.z - tz)) continue;
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
  for (const a of arms) {
    const w = a.w;
    const entryLines: THREE.Vector2[][] = [];
    for (const ln of a.lines) {
      // carriageway with flared kerbs, from just inside the ring to ARM_LEN beyond it
      let prev: { p: THREE.Vector2; u: THREE.Vector2; h: number } | null = null;
      for (let d = rb.rOuter - 1; d <= rb.rOuter + ARM_LEN + 0.01; d += 1) {
        const at = atRadius(ln, c, d);
        if (!at) break;
        const flare = Math.max(0, 1 - (d - rb.rOuter) / 8) * 1.8;
        const cur = { p: at.p, u: at.u, h: w / 2 + flare };
        if (prev) {
          const nA = new THREE.Vector2(-prev.u.y, prev.u.x);
          const nB = new THREE.Vector2(-cur.u.y, cur.u.x);
          const mid = prev.p.clone().add(cur.p).multiplyScalar(0.5);
          const inside = mid.distanceTo(c) < rb.rOuter + 2.5;
          if (inside || !onRouteSpan(mid.x, mid.y)) {
            const V = (pt: THREE.Vector2, n: THREE.Vector2, l: number, dy: number): THREE.Vector3 => new THREE.Vector3(pt.x + n.x * l, yAt(pt.x, pt.y) + dy, pt.y + n.y * l);
            up(flat, V(prev.p, nA, -prev.h, -0.02), V(prev.p, nA, prev.h, -0.02), V(cur.p, nB, cur.h, -0.02), V(cur.p, nB, -cur.h, -0.02), asphalt);
            // pavements either side (outside the ring's own pavement) with their kerb line
            if (mid.distanceTo(c) > rb.rOuter + 2.4 && !a.arm.splitter) {
              for (const sd of [1, -1]) {
                up(flat, V(prev.p, nA, sd * prev.h, KERB), V(prev.p, nA, sd * (prev.h + 2.4), KERB), V(cur.p, nB, sd * (cur.h + 2.4), KERB), V(cur.p, nB, sd * cur.h, KERB), pave);
                up(paint, V(prev.p, nA, sd * prev.h, KERB + 0.01), V(prev.p, nA, sd * (prev.h + 0.25), KERB + 0.01), V(cur.p, nB, sd * (cur.h + 0.25), KERB + 0.01), V(cur.p, nB, sd * cur.h, KERB + 0.01), kerbC);
              }
            }
          }
        }
        prev = cur;
      }
      // which half carries traffic INTO the ring (keep right: inbound right = (u.z, −u.x) here)
      const at0 = atRadius(ln, c, rb.rOuter + 0.6);
      if (!at0) continue;
      const nrm = new THREE.Vector2(-at0.u.y, at0.u.x);
      const inboundRight = new THREE.Vector2(at0.u.y, -at0.u.x);
      const entrySide = nrm.dot(inboundRight) > 0 ? 1 : -1;
      const isEntry = a.arm.flow !== "exit" && (!a.arm.splitter || a.lines.length < 2 || (() => {
        const other = a.lines.find((o) => o !== ln);
        const ao = other ? atRadius(other, c, rb.rOuter + 0.6) : null;
        return !ao || ao.p.clone().sub(at0.p).dot(inboundRight) < 0;
      })());
      if (isEntry) entryLines.push(ln);
      const [l0, l1] = !a.arm.splitter || a.lines.length < 2 ? (entrySide > 0 ? [0, w / 2] : [-w / 2, 0]) : [-w / 2, w / 2];
      const across = (d: number, f0: number, f1: number, depth: number, col: THREE.Color): void => {
        const q = atRadius(ln, c, d);
        if (!q) return;
        const n = new THREE.Vector2(-q.u.y, q.u.x);
        const yq = yAt(q.p.x, q.p.y);
        const A = new THREE.Vector3(q.p.x + n.x * f0, yq + 0.01, q.p.y + n.y * f0);
        const B = new THREE.Vector3(q.p.x + n.x * f1, yq + 0.01, q.p.y + n.y * f1);
        const C = B.clone().add(new THREE.Vector3(q.u.x * depth, 0, q.u.y * depth));
        const D = A.clone().add(new THREE.Vector3(q.u.x * depth, 0, q.u.y * depth));
        up(paint, A, B, C, D, col);
      };
      if (isEntry) {
        // give-way line (dashed) and the "ceda el paso" triangle
        for (let l = Math.min(l0, l1) + 0.3; l + 0.5 < Math.max(l0, l1) - 0.2; l += 1) across(rb.rOuter + 0.4, l, l + 0.5, 0.4, white);
        const q = atRadius(ln, c, rb.rOuter + 4);
        if (q) {
          const n = new THREE.Vector2(-q.u.y, q.u.x);
          const lc = (l0 + l1) / 2;
          const yq = yAt(q.p.x, q.p.y) + 0.012;
          const T = new THREE.Vector3(q.p.x + n.x * lc, yq, q.p.y + n.y * lc);
          const A = new THREE.Vector3(q.p.x + n.x * (lc - 0.6) + q.u.x * 2.4, yq, q.p.y + n.y * (lc - 0.6) + q.u.y * 2.4);
          const B = new THREE.Vector3(q.p.x + n.x * (lc + 0.6) + q.u.x * 2.4, yq, q.p.y + n.y * (lc + 0.6) + q.u.y * 2.4);
          const nn = new THREE.Vector3().subVectors(A, T).cross(new THREE.Vector3().subVectors(B, T));
          if (nn.y > 0) paint.tri(T, A, B, [0, 0], [0, 0], [0, 0], white, UP);
          else paint.tri(T, B, A, [0, 0], [0, 0], [0, 0], white, UP);
        }
      }
      // zebra across the whole way, ~6 m back from the ring
      const zq = atRadius(ln, c, rb.rOuter + 6);
      if (zq && !onRouteSpan(zq.p.x, zq.p.y)) for (let l = -w / 2 + 0.3; l + 0.5 <= w / 2 - 0.2; l += 1) across(rb.rOuter + 6, l, l + 0.5, 3, white);
      // arms the route does not take: barrier row a few metres in, the junction stays visible
      if (a.arm.onRoute === null) {
        const bq = atRadius(ln, c, rb.rOuter + 10.5);
        if (bq) {
          const n = new THREE.Vector2(-bq.u.y, bq.u.x);
          barrier(bq.p.x - n.x * (w / 2 + 0.2), bq.p.y - n.y * (w / 2 + 0.2), bq.p.x + n.x * (w / 2 + 0.2), bq.p.y + n.y * (w / 2 + 0.2));
        }
      }
    }
    // splitter island between the arm's entry and exit ways
    if (a.arm.splitter && a.lines.length >= 2) {
      const A0 = atRadius(a.lines[0]!, c, rb.rOuter + 1.5);
      const B0 = atRadius(a.lines[1]!, c, rb.rOuter + 1.5);
      const A1 = atRadius(a.lines[0]!, c, rb.rOuter + ARM_LEN);
      const B1 = atRadius(a.lines[1]!, c, rb.rOuter + ARM_LEN);
      if (A0 && B0 && A1 && B1) {
        const shrink = (pa: THREE.Vector2, pb: THREE.Vector2): THREE.Vector2 => pa.clone().add(pb.clone().sub(pa).normalize().multiplyScalar(w / 2 + 0.3));
        const gap = A0.p.distanceTo(B0.p) - w - 0.6;
        const cen = A0.p.clone().add(B0.p).add(A1.p).add(B1.p).multiplyScalar(0.25);
        if (gap > 0.8 && !inLane(cen.x, cen.y) && !inLane(A0.p.clone().add(B0.p).multiplyScalar(0.5).x, A0.p.clone().add(B0.p).multiplyScalar(0.5).y)) {
          const a0 = shrink(A0.p, B0.p);
          const b0 = shrink(B0.p, A0.p);
          const apex = A1.p.clone().add(B1.p).multiplyScalar(0.5);
          const V = (q: THREE.Vector2, dy: number): THREE.Vector3 => new THREE.Vector3(q.x, yAt(q.x, q.y) + dy, q.y);
          const T = [V(a0, KERB + 0.02), V(b0, KERB + 0.02), V(apex, KERB + 0.02)] as const;
          const nn = new THREE.Vector3().subVectors(T[1], T[0]).cross(new THREE.Vector3().subVectors(T[2], T[0]));
          if (nn.y > 0) flat.tri(T[0], T[1], T[2], [0, 0], [0, 0], [0, 0], pave, UP);
          else flat.tri(T[0], T[2], T[1], [0, 0], [0, 0], [0, 0], pave, UP);
          // kerb faces round it
          const pts = [a0, b0, apex];
          for (let i = 0; i < 3; i++) {
            const q0 = pts[i]!;
            const q1 = pts[(i + 1) % 3]!;
            const F0 = V(q0, -0.02), F1 = V(q1, -0.02), G1 = V(q1, KERB + 0.02), G0 = V(q0, KERB + 0.02);
            flat.quad(F0, F1, G1, G0, [0, 0], [0, 0], [0, 0], [0, 0], kerbC);
            flat.quad(F1, F0, G0, G1, [0, 0], [0, 0], [0, 0], [0, 0], kerbC);
          }
          // keep-right sign on the nose
          const nose = a0.clone().add(b0).multiplyScalar(0.5).add(A1.u.clone().multiplyScalar(0.8));
          p.cyl(nose.x, yAt(nose.x, nose.y) + KERB, nose.y, 0.04, 1.6, 0x8a9096, 6, m);
          p.cyl(nose.x, yAt(nose.x, nose.y) + KERB + 1.75, nose.y, 0.28, 0.04, 0x1f5fbf, 14, m);
        }
      }
    }
    void entryLines;
  }

  // --- outer pavement all round, broken at the arms (dropped kerbs at the crossings) -------------
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
