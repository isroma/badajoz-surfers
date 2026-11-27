/**
 * Body sculpting: torso garments, necks, skulls, limbs, hands, shoes, hair and hats, all as smooth
 * welded surfaces skinned to the human rig. Outfits (src/art/outfits.ts) compose these.
 */
import * as THREE from "three";
import { P } from "../proportions";
import { B, armPoints, legPoints } from "./rig";
import { headPoint, shellPiece, skullPiece, surf, type HeadCfg } from "./face";
import { SkinBuilder, edgeAngles, ellipsoid, loft, tube, v3, type Paint, type Piece, type PieceOpts, type Ring, type SkinSpec, type V } from "./skin";

export type Side = -1 | 1;
export const SIDES: readonly Side[] = [-1, 1];

const _c = new THREE.Color();
const _v = v3();

/** Mix two hex colours. */
export function mix(a: number, b: number, t: number): number {
  return _c.set(a).lerp(new THREE.Color(b), t).getHex();
}
export function shade(a: number, k: number): number {
  return _c.set(a).multiplyScalar(k).getHex();
}

// ---------------------------------------------------------------------------
// Torso
// ---------------------------------------------------------------------------

/** [y, half width, front depth, back depth, z offset?] */
export type TorsoRow = readonly [number, number, number, number, number?];

export function yRings(rows: readonly TorsoRow[], e = 2.4, mod?: (a: number, y: number) => number): Ring[] {
  return rows.map(([y, w, f, bk, dz]) => ({
    c: v3(0, y, dz ?? 0),
    x: v3(1, 0, 0),
    y: v3(0, 0, -1),
    rx: w,
    ryP: f,
    ryN: bk,
    e,
    mod: mod ? (a: number) => mod(a, y) : undefined,
  }));
}

export const TORSO_SKIN: SkinSpec = {
  bones: [B.hips, B.spine, B.chest, B.neck, B.clavL, B.clavR],
  power: 3,
  bias: [1, 1, 1, 1.4, 1.25, 1.25],
};

/** Resample a row table to a fine, smooth (Catmull-Rom) set of rings so painted details stay crisp. */
export function fineRows(rows: readonly TorsoRow[], step = 0.018, extra: readonly number[] = []): TorsoRow[] {
  const ys: number[] = [];
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return [];
  for (let y = first[0]; y < last[0] - 1e-4; y += step) ys.push(y);
  ys.push(last[0]);
  for (const e of extra) if (e > first[0] && e < last[0]) ys.push(e);
  ys.sort((a, b) => a - b);
  const out: TorsoRow[] = [];
  const col = (r: TorsoRow, k: number): number => (k === 4 ? (r[4] ?? 0) : (r[k] as number));
  for (const y of ys) {
    let i = 0;
    while (i < rows.length - 2 && (rows[i + 1] as TorsoRow)[0] < y) i++;
    const r1 = rows[i] as TorsoRow;
    const r2 = rows[i + 1] as TorsoRow;
    const r0 = rows[i - 1] ?? r1;
    const r3 = rows[i + 2] ?? r2;
    const t = (y - r1[0]) / (r2[0] - r1[0] || 1);
    const cr = (k: number): number => {
      const p0 = col(r0, k);
      const p1 = col(r1, k);
      const p2 = col(r2, k);
      const p3 = col(r3, k);
      const t2 = t * t;
      const t3 = t2 * t;
      return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    };
    out.push([y, cr(1), cr(2), cr(3), cr(4)]);
  }
  return out;
}

export function torso(b: SkinBuilder, rows: readonly TorsoRow[], paint: Paint, opts: PieceOpts & { e?: number; capBottom?: number; capTop?: number; segs?: number; extra?: number[]; step?: number; mod?: (a: number, y: number) => number; angles?: number[] } = {}): void {
  const fine = fineRows(rows, opts.step ?? 0.032, opts.extra);
  b.add(loft(yRings(fine, opts.e ?? 2.4, opts.mod), opts.segs ?? 20, opts.capBottom ?? 0, opts.capTop ?? 0, opts.angles), paint, TORSO_SKIN, opts);
}

/**
 * Torso painted by ring angle (0 = right side, PI/2 = front centre, PI = left, 3PI/2 = back), with
 * extra columns at `edges` so vertical stripes and openings stay crisp.
 */
export function torsoA(b: SkinBuilder, rows: readonly TorsoRow[], paint: (p: V, a: number, out: THREE.Color) => void, edges: readonly number[], opts: PieceOpts & { e?: number; segs?: number; extra?: number[]; step?: number } = {}): void {
  const fine = fineRows(rows, opts.step ?? 0.034, opts.extra);
  const piece = loft(yRings(fine, opts.e ?? 2.4), 0, 0, 0, edgeAngles(opts.segs ?? 20, edges, 0.007));
  const A = piece.a ?? [];
  b.add(piece, (p, out, i) => paint(p, A[i] ?? Number.NaN, out), TORSO_SKIN, opts);
}

/** Athletic runner torso (hoodie-sized). Used by most outfits. */
export const HOODIE_ROWS: readonly TorsoRow[] = [
  [0.925, 0.172, 0.124, 0.13],
  [0.955, 0.174, 0.125, 0.13],
  [0.975, 0.167, 0.119, 0.124],
  [1.06, 0.158, 0.112, 0.11],
  [1.16, 0.168, 0.12, 0.11],
  [1.26, 0.184, 0.128, 0.116],
  [1.34, 0.196, 0.122, 0.12],
  [1.4, 0.195, 0.108, 0.114],
  [1.445, 0.168, 0.088, 0.096],
  [1.48, 0.11, 0.072, 0.076],
  [1.51, 0.068, 0.058, 0.06],
];

/** Fitted shirt torso (slimmer at the waist). */
export const FITTED_ROWS: readonly TorsoRow[] = [
  [0.93, 0.158, 0.11, 0.112],
  [1.0, 0.152, 0.106, 0.104],
  [1.08, 0.148, 0.104, 0.1],
  [1.17, 0.16, 0.112, 0.104],
  [1.27, 0.178, 0.122, 0.11],
  [1.35, 0.19, 0.115, 0.113],
  [1.405, 0.188, 0.1, 0.108],
  [1.45, 0.158, 0.082, 0.09],
  [1.483, 0.1, 0.066, 0.07],
  [1.51, 0.062, 0.056, 0.058],
];

export function neck(b: SkinBuilder, skin: number, r = 0.056): void {
  b.add(
    tube([v3(0, 1.44, 0.006), v3(0, 1.585, 0.014)], [[0, r * 1.12, r * 1.05, r * 1.1], [0.5, r, r * 0.95, r * 1.02], [1, r, r * 0.92, r * 1.02]], 14, 4, { capA: 0, capB: 0 }),
    skin,
    { bones: [B.chest, B.neck, B.head], power: 3 },
    { rough: 0.6 },
  );
}

// ---------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------

export interface HairSpec {
  /** Thickness where the hair covers (metres); <= 0 outside. */
  fn: (n: V) => number;
  color: number | ((n: V, out: THREE.Color) => void);
  rough?: number;
  puff?: (n: V, p: V) => void;
  /** The shell only needs to reach this far down (radians from the crown). */
  thetaMax?: number;
  /** Paint only (no volume shell): for heads under a hat or cap. */
  flat?: boolean;
}

/**
 * The skull, with the hair region painted onto the skin (soft, gap-free hairline) and, when given,
 * a hair volume shell that rises out of the painted area.
 */
export function skull(b: SkinBuilder, h: HeadCfg, paint?: Paint, hair?: HairSpec): void {
  const piece = skullPiece(h);
  const dirs = piece.dirs ?? [];
  const hc = new THREE.Color();
  const sk = new THREE.Color();
  b.add(piece, (p, out, i) => {
    if (paint === undefined) sk.set(h.skin);
    else if (typeof paint === "number") sk.set(paint);
    else paint(p, sk, i);
    const n = dirs[i];
    if (hair && n) {
      const k = Math.max(0, Math.min(1, (hair.fn(n) + 0.002) / 0.006));
      if (typeof hair.color === "number") hc.set(hair.color);
      else hair.color(n, hc);
      out.copy(sk).lerp(hc, k);
    } else out.copy(sk);
  }, B.head, { rough: 0.58, mottle: 0.02 });
  if (hair && !hair.flat) {
    const fn = hair.fn;
    const col = hair.color;
    shell(b, h, (n) => fn(n) - 0.004, typeof col === "number" ? col : (p, out) => col(headDir(h, p), out), { rough: hair.rough ?? 0.7, mottle: 0.08, thetaMax: hair.thetaMax ?? 2.2 }, hair.puff);
  }
}

export function headDir(h: HeadCfg, p: V): V {
  return _v.subVectors(p, h.c).set(_v.x / h.r[0], _v.y / h.r[1], _v.z / h.r[2]).normalize();
}

export function ears(b: SkinBuilder, h: HeadCfg, skin: number, size = 1): void {
  for (const s of SIDES) {
    const p = surf(h, s * 1.5, 0.0, v3());
    p.x += s * 0.004;
    p.z += 0.006;
    b.add(ellipsoid(p, 0.013 * size, 0.031 * size, 0.022 * size, 9, 7, new THREE.Euler(0, s * -0.35, s * 0.08)), skin, B.head, { rough: 0.6 });
    // inner fold
    const q = p.clone().add(v3(s * 0.006, 0.002, -0.002));
    b.add(ellipsoid(q, 0.008 * size, 0.019 * size, 0.012 * size, 6, 4, new THREE.Euler(0, s * -0.35, 0)), shade(skin, 0.82), B.head, { rough: 0.6 });
  }
}

export function nose(b: SkinBuilder, h: HeadCfg, skin: number, size = 1, tint = 0): void {
  const nrm = v3();
  const p = surf(h, 0, -0.2, v3(), nrm);
  const col = tint ? mix(skin, 0xd0604a, tint) : skin;
  const k = size;
  // bridge from between the eyes into a rounded tip, with soft nostril wings
  b.add(tube([p.clone().add(v3(0, 0.032 * k, 0.01)), p.clone().add(v3(0, 0.012 * k, -0.002 * k)), p.clone().add(v3(0, -0.004 * k, -0.01 * k))], [[0, 0.007 * k, 0.003 * k, 0.008 * k], [0.55, 0.009 * k, 0.007 * k, 0.01 * k], [1, 0.013 * k, 0.011 * k, 0.012 * k]], 8, 5, { up: v3(0, 0, -1), capA: 0.4, capB: 0.8 }), col, B.head, { rough: 0.5 });
  for (const s of SIDES) {
    b.add(ellipsoid(p.clone().add(v3(s * 0.0115 * k, -0.007 * k, 0.002)), 0.0072 * k, 0.0065 * k, 0.008 * k, 7, 5), col, B.head, { rough: 0.55 });
  }
}

/** Hair/cap region shell. `inside(n)` > 0 where it covers (value = thickness in metres). */
export function shell(b: SkinBuilder, h: HeadCfg, inside: (n: V) => number, paint: Paint, opts: PieceOpts & { res?: number; thetaMax?: number } = {}, puff?: (n: V, p: V) => void): void {
  const r = opts.res ?? 1;
  const tm = opts.thetaMax ?? Math.PI;
  const rows = Math.max(4, Math.round(19 * r * (tm / Math.PI)));
  b.add(shellPiece(h, inside, Math.round(26 * r), tm < Math.PI ? rows : Math.round(20 * r), puff, tm), paint, B.head, { rough: 0.7, ...opts });
}

const sm = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Short hair: top, back and sides, with a hairline above the face and a sideburn. */
export function shortHair(thick = 0.009, line = 0.42): (n: V) => number {
  return (n) => {
    const f = sm(0.1, -0.8, n.z);
    const aboveEar = 0.42 * sm(0.55, 0.95, Math.abs(n.x)) * (1 - f) * sm(0.55, -0.3, n.z);
    const hairY = -0.5 + (line + 0.5) * f + aboveEar;
    const k = sm(hairY - 0.05, hairY + 0.03, n.y);
    const sideburn = sm(0.78, 0.9, Math.abs(n.x)) * sm(-0.3, -0.12, n.y) * sm(-0.6, -0.3, n.z) * sm(0.1, -0.15, n.z);
    const m = Math.max(k, sideburn);
    return -0.008 + (thick + 0.008) * Math.min(1, m * 1.6);
  };
}

// ---------------------------------------------------------------------------
// Arms and hands
// ---------------------------------------------------------------------------

export type Profile = readonly (readonly [number, number, number?, number?])[];

export function armSkin(side: Side): SkinSpec {
  return side < 0
    ? { bones: [B.clavL, B.armL, B.foreL, B.handL], power: 4, bias: [1.7, 1, 1, 1.2] }
    : { bones: [B.clavR, B.armR, B.foreR, B.handR], power: 4, bias: [1.7, 1, 1, 1.2] };
}

/** A sleeve or bare arm from the shoulder ball (t = 0) to the wrist (t = 1). */
export function arm(b: SkinBuilder, side: Side, profile: Profile, paint: Paint, opts: PieceOpts & { from?: number; to?: number; capA?: number; capB?: number } = {}): void {
  const a = armPoints(side);
  const from = opts.from ?? 0;
  const to = opts.to ?? 1;
  const path = [a.j, a.e, a.w];
  const L1 = a.j.distanceTo(a.e);
  const L2 = a.e.distanceTo(a.w);
  const at = (t: number): V => {
    const d = t * (L1 + L2);
    return d <= L1 ? a.j.clone().lerp(a.e, d / L1) : a.e.clone().lerp(a.w, (d - L1) / L2);
  };
  const sub: V[] = [at(from)];
  for (const p of path) {
    const tp = p === a.j ? 0 : p === a.e ? L1 / (L1 + L2) : 1;
    if (tp > from && tp < to) sub.push(p.clone());
  }
  sub.push(at(to));
  // remap the profile into the sub range
  const prof = profile.map(([t, ...r]) => [(t - from) / (to - from), ...r] as const).filter(([t]) => t >= -0.2 && t <= 1.2) as unknown as Profile;
  b.add(tube(sub, prof, 12, Math.max(4, Math.round((to - from) * 12)), { capA: opts.capA ?? 0.55, capB: opts.capB ?? 0.4, up: v3(0, 0, -1) }), paint, armSkin(side), opts);
}

/** Mitten hand with a thumb, gently curled. Palm faces the body; built along the bind arm. */
export function hand(b: SkinBuilder, side: Side, skin: number, opts: PieceOpts & { glove?: number; size?: number } = {}): void {
  const a = armPoints(side);
  const k = opts.size ?? 1;
  const col = opts.glove ?? skin;
  const rot = new THREE.Matrix4().makeRotationZ(side * P.armOut).setPosition(a.w);
  const add = (p: Piece): void => {
    for (const q of p.pts) q.applyMatrix4(rot);
    b.add(p, col, side < 0 ? B.handL : B.handR, { rough: 0.55, ...opts });
  };
  const inX = -side; // towards the body
  // palm
  add(ellipsoid(v3(inX * 0.004, -0.05 * k, 0.002), 0.025 * k, 0.055 * k, 0.041 * k, 9, 7));
  // curled fingers
  add(ellipsoid(v3(inX * 0.014, -0.098 * k, -0.002), 0.024 * k, 0.034 * k, 0.039 * k, 9, 6, new THREE.Euler(0, 0, inX * 0.5)));
  // thumb along the front
  add(tube([v3(inX * 0.012, -0.028 * k, -0.03 * k), v3(inX * 0.02, -0.058 * k, -0.047 * k), v3(inX * 0.026, -0.083 * k, -0.046 * k)], [[0, 0.015 * k], [0.6, 0.0125 * k], [1, 0.011 * k]], 6, 3, { capA: 0.8, capB: 0.9 }));
}

// ---------------------------------------------------------------------------
// Legs and shoes
// ---------------------------------------------------------------------------

export function legSkin(side: Side): SkinSpec {
  return side < 0
    ? { bones: [B.hips, B.thighL, B.shinL, B.footL], power: 4, bias: [1.5, 1, 1, 1] }
    : { bones: [B.hips, B.thighR, B.shinR, B.footR], power: 4, bias: [1.5, 1, 1, 1] };
}

/** Leg from the hip ball (t = 0) through the knee (~0.51) to the ankle (t = 1). */
export function leg(b: SkinBuilder, side: Side, profile: Profile, paint: Paint, opts: PieceOpts & { from?: number; to?: number; capA?: number; capB?: number; extra?: number[] } = {}): void {
  const l = legPoints(side);
  const from = opts.from ?? 0;
  const to = opts.to ?? 1;
  const L1 = l.h.distanceTo(l.k);
  const L2 = l.k.distanceTo(l.a);
  const tk = L1 / (L1 + L2);
  const at = (t: number): V => (t <= tk ? l.h.clone().lerp(l.k, t / tk) : l.k.clone().lerp(l.a, (t - tk) / (1 - tk)));
  const path: V[] = [at(from)];
  if (tk > from && tk < to) path.push(l.k.clone());
  path.push(at(to));
  const prof = profile.map(([t, ...r]) => [(t - from) / (to - from), ...r] as const) as unknown as Profile;
  const extra = opts.extra?.map((t) => (t - from) / (to - from)).filter((t) => t > 0 && t < 1);
  b.add(tube(path, prof, 12, Math.max(4, Math.round((to - from) * 14)), { capA: opts.capA ?? 0.9, capB: opts.capB ?? 0.6, up: v3(0, 0, -1), extra }), paint, legSkin(side), opts);
}

/** Athletic bare leg profile: [t, half width, front, back]. */
export const LEG_PROFILE: Profile = [
  [0, 0.092],
  [0.12, 0.092, 0.094, 0.092],
  [0.3, 0.083, 0.087, 0.082],
  [0.45, 0.066, 0.07, 0.063],
  [0.52, 0.06, 0.064, 0.057],
  [0.6, 0.058, 0.057, 0.069],
  [0.7, 0.057, 0.053, 0.072],
  [0.84, 0.045, 0.044, 0.049],
  [0.95, 0.037, 0.037, 0.04],
  [1, 0.035],
];

/** Height (y) on the bind leg for a t value. */
export function legY(t: number): number {
  return P.hipY + (P.ankleY - P.hipY) * t;
}

export interface ShoeLook {
  upper: number;
  sole: number;
  accent: number;
  laces: number;
  /** "trainer" (default), "boot" (taller shaft), "flat" (low shoe), "sandal" (straps over skin), "bird" (orange costume feet). */
  kind?: "trainer" | "boot" | "flat" | "sandal" | "bird";
  skin?: number;
}

export function shoe(b: SkinBuilder, side: Side, look: ShoeLook): void {
  const l = legPoints(side);
  const x = l.a.x;
  const skin: SkinSpec = side < 0 ? { bones: [B.footL, B.toeL], power: 5 } : { bones: [B.footR, B.toeR], power: 5 };
  const kind = look.kind ?? "trainer";
  const ring = (z: number, y: number, w: number, up: number, down: number, e = 2.6): Ring => ({ c: v3(x, y, z), x: v3(1, 0, 0), y: v3(0, 1, 0), rx: w, ryP: up, ryN: down, e });
  if (kind === "bird") {
    // costume stork feet: three long orange toes over a rounded foot
    b.add(loft([ring(0.06, 0.06, 0.04, 0.04, 0.05), ring(0.0, 0.065, 0.05, 0.06, 0.06), ring(-0.08, 0.04, 0.05, 0.035, 0.035), ring(-0.12, 0.03, 0.04, 0.025, 0.028)], 14, 0.7, 0.8), look.upper, skin, { rough: 0.5 });
    for (const dx of [-0.035, 0, 0.035]) {
      b.add(tube([v3(x + dx * 0.4, 0.02, -0.08), v3(x + dx, 0.016, -0.17), v3(x + dx * 1.4, 0.012, -0.23)], [[0, 0.016], [1, 0.008]], 6, 3, { capA: 0.3, capB: 0.6 }), look.accent, skin, { rough: 0.5 });
    }
    return;
  }
  if (kind === "sandal") {
    // bare foot with a leather sole and straps
    b.add(loft([ring(0.06, 0.05, 0.034, 0.03, 0.035), ring(0.0, 0.055, 0.042, 0.045, 0.045), ring(-0.08, 0.035, 0.046, 0.028, 0.025), ring(-0.15, 0.03, 0.04, 0.02, 0.02), ring(-0.18, 0.028, 0.032, 0.016, 0.016)], 14, 0.7, 0.8), look.skin ?? 0xd99a6c, skin, { rough: 0.6 });
    b.add(loft([ring(0.072, 0.012, 0.042, 0.012, 0.012, 3.2), ring(-0.06, 0.012, 0.05, 0.012, 0.012, 3.2), ring(-0.19, 0.012, 0.04, 0.012, 0.012, 3.2)], 14, 0.5, 0.5), look.sole, skin, { rough: 0.7 });
    for (const z of [-0.09, -0.02, 0.04]) {
      b.add(tube([v3(x - 0.05, 0.02, z), v3(x, z > 0 ? 0.1 : 0.075, z - 0.005), v3(x + 0.05, 0.02, z)], [[0, 0.006, 0.004], [1, 0.006, 0.004]], 6, 6, { capA: 0.3, capB: 0.3, up: v3(0, 0, -1) }), look.upper, skin, { rough: 0.6 });
    }
    return;
  }
  const tall = kind === "boot" ? 0.07 : 0;
  const low = kind === "flat" ? 0.012 : 0;
  // upper: heel (+z) to toe (-z)
  const rows: Ring[] = [
    ring(0.07, 0.072 + tall * 0.5, 0.036, 0.032 + tall * 0.5, 0.05),
    ring(0.05, 0.078 + tall * 0.5, 0.045, 0.052 + tall * 0.6 - low, 0.058),
    ring(0.0, 0.074 + tall * 0.4, 0.05, 0.062 + tall * 0.6 - low * 2, 0.056),
    ring(-0.06, 0.062, 0.052, 0.044 - low, 0.044),
    ring(-0.12, 0.052, 0.053, 0.032 - low * 0.5, 0.034),
    ring(-0.165, 0.046, 0.047, 0.024, 0.028),
    ring(-0.19, 0.042, 0.034, 0.017, 0.022),
  ];
  const ac = look.accent;
  const up = look.upper;
  b.add(loft(rows, 12, 0.6, 0.9), (p, out) => {
    const sideAmt = Math.abs(p.x - x);
    // a swoosh-free accent band along the side and a toe cap
    const band = kind === "trainer" && sideAmt > 0.035 && p.y > 0.035 && p.y < 0.07 - (p.z + 0.12) * 0.25 && p.z > -0.13 && p.z < 0.05;
    const heel = kind === "trainer" && p.z > 0.045 && p.y > 0.07;
    out.set(band || heel ? ac : up);
  }, skin, { rough: kind === "trainer" ? 0.6 : 0.32 });
  // sole
  const sr = (z: number, w: number): Ring => ring(z, 0.017, w, 0.017, 0.017, 3.4);
  b.add(loft([sr(0.078, 0.04), sr(0.05, 0.05), sr(0.0, 0.054), sr(-0.06, 0.057), sr(-0.13, 0.057), sr(-0.18, 0.048), sr(-0.2, 0.034)], 10, 0.5, 0.7), (p, out) => {
    out.set(p.y < 0.008 ? shade(look.sole, 0.72) : look.sole);
  }, skin, { rough: 0.75, shade: 0.6 });
  if (kind === "trainer") {
    // laces across the instep
    for (let i = 0; i < 2; i++) {
      const z = -0.015 - i * 0.035;
      const y = 0.074 + 0.054 - i * 0.012;
      b.add(tube([v3(x - 0.022, y - 0.006, z), v3(x, y + 0.002, z - 0.004), v3(x + 0.022, y - 0.006, z)], [[0, 0.0055], [1, 0.0055]], 4, 2, { capA: 0, capB: 0 }), look.laces, skin, { rough: 0.8, shade: 0.4 });
    }
  }
}

// ---------------------------------------------------------------------------
// Shorts / trousers / skirts
// ---------------------------------------------------------------------------

export const PELVIS_SKIN: SkinSpec = { bones: [B.hips, B.spine], power: 3 };

export function pelvis(b: SkinBuilder, paint: Paint, opts: PieceOpts & { top?: number; scale?: number } = {}): void {
  const s = opts.scale ?? 1;
  const top = opts.top ?? 1.06;
  const rows: TorsoRow[] = [
    [top, 0.142 * s, 0.096 * s, 0.092 * s],
    [0.99, 0.152 * s, 0.102 * s, 0.104 * s],
    [0.92, 0.164 * s, 0.104 * s, 0.124 * s],
    [0.86, 0.14 * s, 0.085 * s, 0.098 * s],
    [0.83, 0.08, 0.06, 0.06],
  ];
  b.add(loft(yRings(rows, 2.3).reverse().map((r) => r), 26, 0.6, 0), paint, PELVIS_SKIN, opts);
}

/** A shorts/trouser leg tube around the thigh, from above the hip joint to `toT` along the leg. */
export function garmentLeg(b: SkinBuilder, side: Side, toT: number, rTop: number, rHem: number, paint: Paint, opts: PieceOpts & { flare?: number; inner?: number; extra?: number[] } = {}): void {
  const prof: Profile = [
    [-0.04, rTop * 0.95],
    [0.05, rTop],
    [Math.min(0.5, toT * 0.6), (rTop + rHem) / 2 + 0.004],
    [toT, rHem + (opts.flare ?? 0)],
  ];
  const l = legPoints(side);
  const L1 = l.h.distanceTo(l.k);
  const L2 = l.k.distanceTo(l.a);
  const tk = L1 / (L1 + L2);
  const at = (t: number): V => (t <= tk ? l.h.clone().lerp(l.k, t / tk) : l.k.clone().lerp(l.a, (t - tk) / (1 - tk)));
  const start = at(0).add(v3(side * -0.008, 0.035, 0));
  const path: V[] = [start];
  if (toT > tk) path.push(l.k.clone());
  path.push(at(toT));
  const total = 1;
  const remap = prof.map(([t, r]) => [Math.max(0, Math.min(1, (t + 0.04) / (toT + 0.04))) * total, r] as const);
  const inner = opts.inner ?? shade(typeof paint === "number" ? paint : 0x333333, 0.45);
  const skin: SkinSpec = side < 0
    ? { bones: [B.hips, B.thighL, B.shinL], power: 3, bias: [0.75, 1, 1] }
    : { bones: [B.hips, B.thighR, B.shinR], power: 3, bias: [0.75, 1, 1] };
  // extra rings near the hem keep painted hem bands crisp
  const extra = [0.93, 0.955, 0.975, 0.99].map((k) => k);
  const piece = tube(path, remap, 14, Math.max(5, Math.round(toT * 12)), { capA: 0.5, capB: 0, up: v3(0, 0, -1), extra: opts.extra ?? extra });
  const end = path[path.length - 1] as V;
  b.add(piece, (p, out) => {
    // the hem's closing disc reads as the shadowed inside of the garment
    if (Math.abs(p.y - end.y) < 0.003 && p.distanceTo(end) < rHem * 0.6) out.set(inner);
    else if (typeof paint === "number") out.set(paint);
    else paint(p, out, 0);
  }, skin, opts);
}

// ---------------------------------------------------------------------------
// Hats
// ---------------------------------------------------------------------------

/** Baseball cap: crown shell, front brim and a top button. */
export function cap(b: SkinBuilder, h: HeadCfg, crown: number, brim: number, under: number, button = crown): void {
  const line = (n: V): number => 0.2 + 0.36 * -n.z - 0.02 * Math.abs(n.x);
  shell(b, h, (n) => {
    const k = sm(line(n) - 0.05, line(n) + 0.02, n.y);
    return k > 0.01 ? 0.004 + 0.007 * k + 0.008 * Math.max(0, n.y) : -0.012;
  }, (p, out) => {
    // panel seams and a small back opening
    const n = headDir(h, p);
    const seam = Math.abs(n.x) < 0.03 && n.y > 0.3;
    out.set(seam ? shade(crown, 0.8) : crown);
  }, { rough: 0.85, mottle: 0.04, thetaMax: 1.95 });
  // brim: a curved plate along the front edge
  const N = 9;
  const path: V[] = [];
  for (let i = 0; i <= N; i++) {
    const a = -0.9 + (1.8 * i) / N;
    const yaw = a;
    // find where the crown's edge crosses this yaw
    let pitch = 0.6;
    const n = v3();
    for (let k = 0; k < 40; k++) {
      n.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      if (n.y < line(n)) break;
      pitch -= 0.02;
    }
    const p = surf(h, yaw, pitch - 0.015, v3());
    p.add(v3(0, 0.005, 0));
    path.push(p);
  }
  const pts: V[] = [];
  const tris: number[] = [];
  const LEN = 7;
  for (let j = 0; j <= LEN; j++) {
    for (let i = 0; i <= N; i++) {
      const a = -0.9 + (1.8 * i) / N;
      const base = path[i] as V;
      const out = v3(Math.sin(a), 0, -Math.cos(a));
      const len = 0.08 * Math.cos(a * 0.95) ** 1.6 * (j / LEN);
      const droop = -0.022 * (j / LEN) ** 1.6 * (0.5 + 0.5 * a * a) - 0.006 * (j / LEN);
      pts.push(base.clone().addScaledVector(out, len).add(v3(0, droop, 0)));
    }
  }
  // thickness: duplicate underneath
  const top = pts.length;
  for (let k = 0; k < top; k++) pts.push((pts[k] as V).clone().add(v3(0, -0.007, 0)));
  const W = N + 1;
  for (let j = 0; j < LEN; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * W + i;
      tris.push(a, a + 1, a + W + 1, a, a + W + 1, a + W);
      tris.push(top + a, top + a + W + 1, top + a + 1, top + a, top + a + W, top + a + W + 1);
    }
  }
  // rim around the outer edge and the sides
  const edge = (a: number, c: number): void => {
    tris.push(a, c, top + c, a, top + c, top + a);
  };
  for (let i = 0; i < N; i++) edge(LEN * W + i, LEN * W + i + 1);
  for (let j = 0; j < LEN; j++) {
    edge(j * W, (j + 1) * W);
    edge((j + 1) * W + N, j * W + N);
  }
  b.add({ pts, tris }, (p, out) => {
    const idx = pts.indexOf(p);
    out.set(idx >= top ? under : brim);
  }, B.head, { rough: 0.8, shade: 0.6 });
  const tp = headPoint(h, v3(0, 1, 0), v3());
  b.add(ellipsoid(tp.add(v3(0, 0.018, 0)), 0.013, 0.007, 0.013, 8, 5), button, B.head, { rough: 0.7 });
}
