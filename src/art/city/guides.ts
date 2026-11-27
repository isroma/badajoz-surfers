/**
 * Route guidance (docs/design.md, "Guide arrows"): sun-yellow chevron boards on the outside of
 * every bend in `track.turns` (round the island on roundabouts), yellow arrows painted on the
 * runnable road lanes ~40 m before, red-and-white barriers closing the side streets and the
 * roundabout exits the route does not take, and 60 m barrier tapers + merge arrows where a lane
 * ends (`track.transitions`). Built per chunk, flat material + the text atlas.
 */
import * as THREE from "three";
import { PAL } from "../palette";
import type { Bag, TS } from "./bag";
import { flatMaterial, paintMaterial, signMaterial, signSlot } from "./cmats";
import type { CityCtx } from "./context";
import type { LaneLayout } from "./track";

const SUN = new THREE.Color(PAL.sun);
const WHITE = new THREE.Color(PAL.white);

function chevronDraw(dir: "left" | "right"): (ctx: CanvasRenderingContext2D, w: number, h: number) => void {
  return (ctx, w, h) => {
    ctx.fillStyle = "#ffc53d";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#1f2328";
    const s = dir === "left" ? -1 : 1;
    for (let k = 0; k < 3; k++) {
      const cx = w / 2 + (k - 1) * 120;
      ctx.beginPath();
      ctx.moveTo(cx - s * 30, 12);
      ctx.lineTo(cx + s * 30, h / 2);
      ctx.lineTo(cx - s * 30, h - 12);
      ctx.lineTo(cx - s * 6, h - 12);
      ctx.lineTo(cx + s * 54, h / 2);
      ctx.lineTo(cx - s * 6, 12);
      ctx.closePath();
      ctx.fill();
    }
  };
}

/** A chevron board on two posts, facing back down the route at s. */
function board(bag: Bag, ts: TS, s: number, lat: number, dir: "left" | "right"): void {
  const f = ts.f(s);
  const p = ts.p(s, lat, 0);
  const ry = Math.atan2(-f.tx, -f.tz); // +Z faces the approaching runner
  const b = bag.props;
  const m = flatMaterial();
  b.push(new THREE.Matrix4().makeRotationY(ry).setPosition(p.x, p.y, p.z));
  for (const x of [-0.8, 0.8]) b.box(x, 0.55, 0, 0.08, 1.1, 0.08, PAL.darkGrey, m);
  const uv = signSlot(`chevron-${dir}`, chevronDraw(dir));
  b.box(0, 1.45, -0.03, 2.1, 0.62, 0.05, PAL.ink, m);
  b.quad(new THREE.Matrix4().makeScale(2.0, 0.56, 1).setPosition(0, 1.45, 0), 0xffffff, signMaterial(true), uv);
  b.pop();
}

/** A red-and-white barrier block (the guide's danger stripes) centred at p, along direction ry. */
function barrier(bag: Bag, x: number, y: number, z: number, ry: number, len = 1.3, white = false): void {
  const b = bag.props;
  b.box(x, y + 0.45, z, len, 0.9, 0.35, white ? PAL.white : PAL.danger, flatMaterial(), ry);
}

/** A row of barriers from a to b (alternating red / white). */
function barrierRow(bag: Bag, ax: number, ay: number, az: number, bx: number, bz: number): void {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / 1.3));
  const ry = Math.atan2(bx - ax, bz - az) + Math.PI / 2;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    barrier(bag, ax + (bx - ax) * t, ay, az + (bz - az) * t, ry, (len / n) * 0.96, k % 2 === 1);
  }
}

/** Painted arrow (in track space) at s in a lane centred on `lat`; `bend` -1 left, 0 straight, +1 right. */
function arrow(bag: Bag, ts: TS, s: number, lat: number, bend: number, col: THREE.Color): void {
  const acc = bag.acc(paintMaterial());
  const P = (ds: number, dl: number): THREE.Vector3 => ts.p(s + ds, lat + dl, 0.008);
  const up = new THREE.Vector3(0, 1, 0);
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void => acc.quad(a, b, c, d, [0, 0], [0, 0], [0, 0], [0, 0], col, col, col, col, up);
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.y > 0) acc.tri(a, b, c, [0, 0], [0, 0], [0, 0], col, up);
    else acc.tri(a, c, b, [0, 0], [0, 0], [0, 0], col, up);
  };
  // shaft
  quad(P(0, -0.12), P(0, 0.12), P(3, 0.12), P(3, -0.12));
  if (bend === 0) {
    tri(P(3, -0.45), P(3, 0.45), P(4.8, 0));
    return;
  }
  // a bent head towards the turn
  const sgn = bend;
  quad(P(3, -0.12), P(3, 0.12), P(4.2, 0.12 + sgn * 0.6), P(4.2, -0.12 + sgn * 0.6));
  tri(P(3.9, sgn * 0.15), P(4.5, sgn * 1.05), P(5.0, sgn * 0.35));
}

/** Lateral span of a lane. */
function laneSpan(l: LaneLayout, i: number): [number, number] {
  const o = l.offsets[i] ?? 0;
  const w = (l.widths[i] ?? 3) / 2;
  return [o - w, o + w];
}

export function buildGuides(ctx: CityCtx, bag: Bag, ts: TS, s0: number, s1: number): void {
  const tr = ctx.track;
  const L = tr.lapLength;
  const inChunk = (s: number): boolean => {
    const w = ((s % L) + L) % L;
    return w >= s0 && w < s1;
  };
  // --- turns -----------------------------------------------------------------------------------
  for (const t of tr.turns ?? []) {
    const straightRing = t.roundabout && Math.abs(t.angle) < 20;
    const dir: "left" | "right" = t.roundabout ? "left" : t.direction;
    // chevron boards along the bend, every 9 m, on the outside (island side on roundabouts)
    const a = t.roundabout && t.entryS !== null ? t.entryS : t.s;
    const b = t.roundabout && t.exitS !== null ? t.exitS : t.endS;
    for (let s = a; s <= b; s += 9) {
      if (!inChunk(s)) continue;
      const lay = tr.layoutAt(s);
      if (lay.carriageways.length === 0) continue; // pedestrian streets and plazas: painted arrows only
      const islandSide = t.roundabout || dir === "right" ? -1 : 1;
      const outside = t.roundabout ? -1 : dir === "right" ? -1 : 1;
      void islandSide;
      const lat = outside > 0 ? lay.right + 1.4 : lay.left - 1.4;
      board(bag, ts, s, lat, dir);
    }
    // the exit of a roundabout: a board pointing out of the ring
    if (t.roundabout && t.exitS !== null && inChunk(t.exitS - 4)) {
      const lay = tr.layoutAt(t.exitS - 4);
      board(bag, ts, t.exitS - 4, lay.left - 1.4, "right");
    }
    // painted arrows ~40 m before, in every own road lane
    const as = t.s - 40;
    if (inChunk(as)) {
      const lay = tr.layoutAt(as);
      const bend = straightRing ? 0 : t.direction === "left" ? -1 : 1;
      lay.kinds.forEach((k, i) => {
        if (k !== "road" || lay.flow[i] !== 1) return;
        arrow(bag, ts, as, lay.offsets[i]!, bend, SUN);
      });
    }
  }
  // --- side streets the route does not take: closed with barriers ---------------------------
  for (const j of ctx.city.junctions) {
    if (j.s < s0 || j.s >= s1) continue;
    const lay = tr.layoutAt(j.s);
    const f = ts.f(j.s);
    // branch direction from its compass bearing (clockwise from north; north = -Z)
    const br = (j.bearing * Math.PI) / 180;
    const dx = Math.sin(br);
    const dz = -Math.cos(br);
    const side = dx * f.nx + dz * f.nz > 0 ? 1 : -1;
    let edge = side > 0 ? lay.right : lay.left;
    for (const w of lay.sidewalks) edge = side > 0 ? Math.max(edge, w.to) : Math.min(edge, w.from);
    // walk out along the branch until we are 2.5 m beyond the route's paved edge
    let d = 3;
    for (; d < 40; d += 1) {
      const x = j.x + dx * d;
      const z = j.z + dz * d;
      const pr = tr.project(x, z, j.s);
      if (Math.abs(pr.lateral) > Math.abs(edge) + 2.5) break;
    }
    const cx = j.x + dx * d;
    const cz = j.z + dz * d;
    // never on the route itself (branches running alongside it)
    const prc = tr.project(cx, cz, j.s);
    const lc = tr.layoutAt(prc.s);
    if (prc.lateral > lc.left - 2 && prc.lateral < lc.right + 2) continue;
    const half = Math.max(2.5, ((j.lanes ?? 2) * 3.2) / 2 + 1);
    const y = ctx.streetLevel(cx, cz, j.s) - 0.13;
    barrierRow(bag, cx - dz * half, y, cz + dx * half, cx + dz * half, cz - dx * half);
  }
  // --- lanes that end: a 60 m barrier taper and merge arrows; new lanes open with a short taper -
  for (const t of tr.transitions ?? []) {
    const from = tr.stretches[t.fromIndex]?.layout;
    const to = tr.stretches[t.toIndex]?.layout;
    if (!from || !to) continue;
    t.map.forEach((dst, i) => {
      if (dst !== null || from.kinds[i] !== "road") return; // only carriageway lanes get barrier tapers
      const [lo, hi] = laneSpan(from, i);
      const inner = (from.offsets[i] ?? 0) < 0 ? hi : lo; // the side the runner should move to
      const outer = inner === hi ? lo : hi;
      for (let k = 0; k <= 24; k++) {
        const s = t.s - 60 + k * 2.5;
        if (!inChunk(s)) continue;
        const lat = outer + (inner - outer) * (k / 24);
        const q = ts.p(s, lat, 0);
        const f = ts.f(s);
        barrier(bag, q.x, q.y, q.z, Math.atan2(f.tx, f.tz), 1.1, k % 2 === 1);
      }
      for (const ds of [-55, -35]) {
        const s = t.s + ds;
        if (inChunk(s)) arrow(bag, ts, s, from.offsets[i] ?? 0, inner > outer ? 1 : -1, WHITE);
      }
    });
    for (const i of t.begins) {
      if (to.kinds[i] !== "road") continue;
      const [lo, hi] = laneSpan(to, i);
      const inner = (to.offsets[i] ?? 0) < 0 ? hi : lo;
      const outer = inner === hi ? lo : hi;
      for (let k = 0; k <= 8; k++) {
        const s = t.s + k * 2.5;
        if (!inChunk(s)) continue;
        const lat = inner + (outer - inner) * (k / 8);
        const q = ts.p(s, lat, 0);
        const f = ts.f(s);
        barrier(bag, q.x, q.y, q.z, Math.atan2(f.tx, f.tz), 1.1, k % 2 === 1);
      }
    }
  }
}
