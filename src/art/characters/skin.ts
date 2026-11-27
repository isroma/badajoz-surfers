/**
 * Procedural sculpting toolkit for the characters: smooth welded surfaces (lofts, shaped spheres)
 * with per-vertex colour, roughness and procedurally computed skin weights.
 *
 * Every surface is built in bind space (metres, the character standing at the origin facing -Z).
 * Weights come from inverse-distance-to-bone-segment over a short list of candidate bones per piece,
 * which blends smoothly across joints (elbows, knees, the spine) without visible seams.
 */
import * as THREE from "three";

export type V = THREE.Vector3;
export const v3 = (x = 0, y = 0, z = 0): V => new THREE.Vector3(x, y, z);

/** A bone in bind space: `head` is the joint, `tail` where it points (used for weighting). */
export interface BoneDef {
  name: string;
  parent: number;
  head: V;
  tail: V;
  /** Euler order used when animating this bone. */
  order?: THREE.EulerOrder;
}

export interface Piece {
  pts: V[];
  tris: number[];
  /** Optional per-point ring parameter angle (lofts) or unit direction (spheres), for painting. */
  a?: number[];
  dirs?: V[];
}

/** Colour for a vertex: a hex, or a painter called with the bind-space point and its index. */
export type Paint = number | ((p: V, out: THREE.Color, i: number) => void);

/** Skinning for a piece: one bone (rigid) or IDW over a few candidate bones. */
export interface SkinSpec {
  bones: readonly number[];
  /** Falloff exponent: higher = tighter joints. */
  power?: number;
  /** Optional per-candidate distance multipliers (>1 = less influence). */
  bias?: readonly number[];
}

export interface PieceOpts {
  /** Roughness 0..1 (default 0.8). */
  rough?: number;
  /** Strength of the baked occlusion/variation (0 disables, default 1). */
  shade?: number;
  /** Fabric mottling amplitude (default 0.035). */
  mottle?: number;
}

// ---------------------------------------------------------------------------
// Primitive generators (pure geometry; welded, no uvs)
// ---------------------------------------------------------------------------

export interface Ring {
  c: V;
  /** In-plane axes: `x` is the "width" axis, `y` the "depth" axis. */
  x: V;
  y: V;
  rx: number;
  /** Depth on the +y side and on the -y side. */
  ryP: number;
  ryN: number;
  /** Superellipse exponent (2 = ellipse, higher = boxier). */
  e?: number;
  /** Optional radial multiplier by angle (0 at +x, PI/2 at +y). */
  mod?: (a: number) => number;
}

function sgnPow(v: number, p: number): number {
  return Math.sign(v) * Math.pow(Math.abs(v), p);
}

function ringPoint(r: Ring, a: number, s = 1, out = v3()): V {
  const e = r.e ?? 2;
  const ca = sgnPow(Math.cos(a), 2 / e);
  const sa = sgnPow(Math.sin(a), 2 / e);
  const m = (r.mod ? r.mod(a) : 1) * s;
  const ry = sa >= 0 ? r.ryP : r.ryN;
  return out.copy(r.c).addScaledVector(r.x, r.rx * ca * m).addScaledVector(r.y, ry * sa * m);
}

/**
 * Loft through a list of rings. `capA`/`capB`: 0 = flat fan, >0 = rounded dome of that length as a
 * fraction of the ring's mean radius, <0 = open (no cap).
 */
export function loft(rings: Ring[], segs: number, capA = 0.6, capB = 0.6, angles?: readonly number[]): Piece {
  const pts: V[] = [];
  const tris: number[] = [];
  const ang: number[] = [];
  if (angles) segs = angles.length;
  const angleAt = (i: number): number => (angles ? (angles[i] ?? 0) : (i / segs) * Math.PI * 2);
  const first = rings[0];
  const last = rings[rings.length - 1];
  if (!first || !last || rings.length < 2) return { pts, tris };
  const second = rings[1] ?? last;
  const tA = v3().subVectors(second.c, first.c).normalize();
  const prev = rings[rings.length - 2] ?? first;
  const tB = v3().subVectors(last.c, prev.c).normalize();
  // Winding: outward if x × y points along the loft direction.
  const flip = v3().crossVectors(first.x, first.y).dot(tA) < 0;
  const all: Ring[] = [];
  const CAP_STEPS = 3;
  const mean = (r: Ring): number => (r.rx + (r.ryP + r.ryN) / 2) / 2;
  if (capA > 0) {
    for (let k = CAP_STEPS; k >= 1; k--) {
      const th = (k / (CAP_STEPS + 1)) * (Math.PI / 2);
      const s = Math.cos(th);
      all.push({ ...first, c: first.c.clone().addScaledVector(tA, -Math.sin(th) * capA * mean(first)), rx: first.rx * s, ryP: first.ryP * s, ryN: first.ryN * s });
    }
  }
  all.push(...rings);
  if (capB > 0) {
    for (let k = 1; k <= CAP_STEPS; k++) {
      const th = (k / (CAP_STEPS + 1)) * (Math.PI / 2);
      const s = Math.cos(th);
      all.push({ ...last, c: last.c.clone().addScaledVector(tB, Math.sin(th) * capB * mean(last)), rx: last.rx * s, ryP: last.ryP * s, ryN: last.ryN * s });
    }
  }
  for (const r of all) {
    for (let i = 0; i < segs; i++) {
      pts.push(ringPoint(r, angleAt(i)));
      ang.push(angleAt(i));
    }
  }
  const quad = (a: number, b: number, c: number, d: number): void => {
    if (flip) tris.push(a, c, b, a, d, c);
    else tris.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < all.length - 1; k++) {
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      quad(k * segs + i, k * segs + j, (k + 1) * segs + j, (k + 1) * segs + i);
    }
  }
  const fan = (ringIdx: number, tip: V, outward: boolean): void => {
    const t = pts.length;
    pts.push(tip);
    ang.push(Number.NaN);
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      const a = ringIdx * segs + i;
      const b = ringIdx * segs + j;
      // start cap faces -t, end cap faces +t
      if (outward !== flip) tris.push(a, b, t);
      else tris.push(b, a, t);
    }
  };
  if (capA >= 0) {
    const r0 = all[0];
    if (r0) fan(0, capA > 0 ? first.c.clone().addScaledVector(tA, -capA * mean(first)) : r0.c.clone(), false);
  }
  if (capB >= 0) {
    const rl = all[all.length - 1];
    if (rl) fan(all.length - 1, capB > 0 ? last.c.clone().addScaledVector(tB, capB * mean(last)) : rl.c.clone(), true);
  }
  return { pts, tris, a: ang };
}

/** Angles 0..2PI with `base` uniform samples plus a tight pair at each boundary (crisp painted edges). */
export function edgeAngles(base: number, boundaries: readonly number[], gap = 0.006): number[] {
  const out: number[] = [];
  for (let i = 0; i < base; i++) out.push((i / base) * Math.PI * 2);
  const TAU = Math.PI * 2;
  for (const b0 of boundaries) {
    const b = ((b0 % TAU) + TAU) % TAU;
    out.push((b - gap + TAU) % TAU, (b + gap) % TAU);
  }
  out.sort((x, y) => x - y);
  // drop near-duplicates
  return out.filter((v, i) => i === 0 || v - (out[i - 1] ?? -1) > gap * 0.5);
}

/**
 * Lat-long sphere of unit radius, welded, poles on ±Y. `shape(n, p)` maps the unit direction `n`
 * to the final point `p` (in place), which is how heads, bodies and blobs are sculpted.
 */
export function sphere(w: number, h: number, shape: (n: V, p: V) => void, thetaMax = Math.PI): Piece {
  const pts: V[] = [];
  const tris: number[] = [];
  const dirs: V[] = [];
  const n = v3();
  const full = thetaMax >= Math.PI - 1e-6;
  const push = (x: number, y: number, z: number): void => {
    n.set(x, y, z);
    const p = n.clone();
    dirs.push(n.clone());
    shape(n, p);
    pts.push(p);
  };
  push(0, 1, 0);
  const rows = full ? h - 1 : h;
  for (let j = 1; j <= rows; j++) {
    const th = full ? (j / h) * Math.PI : (j / h) * thetaMax;
    for (let i = 0; i < w; i++) {
      const ph = (i / w) * Math.PI * 2;
      push(Math.sin(th) * Math.sin(ph), Math.cos(th), -Math.sin(th) * Math.cos(ph));
    }
  }
  const ring = (j: number, i: number): number => 1 + (j - 1) * w + (i % w);
  for (let i = 0; i < w; i++) tris.push(0, ring(1, i + 1), ring(1, i));
  for (let j = 1; j < rows; j++) {
    for (let i = 0; i < w; i++) {
      const a = ring(j, i);
      const b = ring(j, i + 1);
      const c = ring(j + 1, i + 1);
      const d = ring(j + 1, i);
      tris.push(a, b, c, a, c, d);
    }
  }
  if (full) {
    push(0, -1, 0);
    const bottom = pts.length - 1;
    for (let i = 0; i < w; i++) tris.push(bottom, ring(h - 1, i), ring(h - 1, i + 1));
  }
  return { pts, tris, dirs };
}

/** Ellipsoid centred at `c` with radii, optionally rotated (Euler YXZ). */
export function ellipsoid(c: V, rx: number, ry: number, rz: number, w = 12, h = 8, rot?: THREE.Euler): Piece {
  const q = rot ? new THREE.Quaternion().setFromEuler(rot) : null;
  return sphere(w, h, (n, p) => {
    p.set(n.x * rx, n.y * ry, n.z * rz);
    if (q) p.applyQuaternion(q);
    p.add(c);
  });
}

/** Rings along a straight or bent polyline with a radius profile (t in 0..1 along the path). */
export function tube(
  path: V[],
  profile: readonly (readonly [number, number, number?, number?])[],
  segs: number,
  steps: number,
  opts: { capA?: number; capB?: number; up?: V; e?: number; mod?: (a: number, t: number) => number; extra?: number[] } = {},
): Piece {
  // cumulative lengths
  const L: number[] = [0];
  for (let i = 1; i < path.length; i++) L.push((L[i - 1] ?? 0) + (path[i] as V).distanceTo(path[i - 1] as V));
  const total = L[L.length - 1] ?? 1;
  const at = (t: number, out: V): V => {
    const d = t * total;
    for (let i = 1; i < path.length; i++) {
      const l0 = L[i - 1] ?? 0;
      const l1 = L[i] ?? 0;
      if (d <= l1 || i === path.length - 1) {
        const k = l1 > l0 ? (d - l0) / (l1 - l0) : 0;
        return out.lerpVectors(path[i - 1] as V, path[i] as V, Math.min(1, Math.max(0, k)));
      }
    }
    return out.copy(path[0] as V);
  };
  const prof = (t: number): [number, number, number] => {
    let a = profile[0];
    let b = profile[profile.length - 1];
    for (let i = 0; i < profile.length - 1; i++) {
      const p0 = profile[i];
      const p1 = profile[i + 1];
      if (p0 && p1 && t >= p0[0] && t <= p1[0]) {
        a = p0;
        b = p1;
        break;
      }
    }
    if (!a || !b) return [0.05, 0.05, 0.05];
    const k = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
    const s = k * k * (3 - 2 * k);
    const ax = a[1];
    const az = a[2] ?? a[1];
    const azn = a[3] ?? az;
    const bx = b[1];
    const bz = b[2] ?? b[1];
    const bzn = b[3] ?? bz;
    return [ax + (bx - ax) * s, az + (bz - az) * s, azn + (bzn - azn) * s];
  };
  const ts: number[] = [];
  for (let i = 0; i <= steps; i++) ts.push(i / steps);
  if (opts.extra) ts.push(...opts.extra);
  ts.sort((x, y) => x - y);
  const up = opts.up ?? v3(0, 0, -1);
  const rings: Ring[] = [];
  const e = 1e-3;
  for (const t of ts) {
    const c = at(t, v3());
    const t0 = at(Math.max(0, t - e), v3());
    const t1 = at(Math.min(1, t + e), v3());
    const tan = t1.sub(t0).normalize();
    // depth axis: `up` made perpendicular to the tangent
    const y = up.clone().addScaledVector(tan, -up.dot(tan)).normalize();
    const x = v3().crossVectors(y, tan).normalize();
    const [rx, ryP, ryN] = prof(t);
    const mod = opts.mod;
    rings.push({ c, x, y, rx, ryP, ryN, e: opts.e, mod: mod ? (a: number) => mod(a, t) : undefined });
  }
  return loft(rings, segs, opts.capA ?? 0.6, opts.capB ?? 0.6);
}

export function transform(p: Piece, m: THREE.Matrix4): Piece {
  for (const v of p.pts) v.applyMatrix4(m);
  return p;
}

// ---------------------------------------------------------------------------
// Noise for colour variation
// ---------------------------------------------------------------------------

function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth value noise, roughly -1..1. */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const k = hash3(xi + dx, yi + dy, zi + dz);
    r += k * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return r * 2 - 1;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

const _c = new THREE.Color();
const _seg = v3();
const _ap = v3();

function segDist(p: V, a: V, b: V): number {
  _seg.subVectors(b, a);
  const l2 = _seg.lengthSq();
  const t = l2 > 0 ? Math.min(1, Math.max(0, _ap.subVectors(p, a).dot(_seg) / l2)) : 0;
  return _ap.copy(a).addScaledVector(_seg, t).distanceTo(p);
}

export class SkinBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private rgh: number[] = [];
  private shd: number[] = [];
  private si: number[] = [];
  private sw: number[] = [];
  private idx: number[] = [];
  private count = 0;

  constructor(private readonly bones: readonly BoneDef[] | null) {}

  get triangles(): number {
    return this.idx.length / 3;
  }

  add(piece: Piece, paint: Paint, skin: SkinSpec | number | null, opts: PieceOpts = {}): this {
    const base = this.count;
    const rough = opts.rough ?? 0.8;
    const shade = opts.shade ?? 1;
    const mottle = opts.mottle ?? 0.035;
    const spec: SkinSpec | null = typeof skin === "number" ? { bones: [skin] } : skin;
    const w: number[] = [0, 0, 0, 0];
    const ix: number[] = [0, 0, 0, 0];
    for (let pi = 0; pi < piece.pts.length; pi++) {
      const p = piece.pts[pi] as V;
      this.pos.push(p.x, p.y, p.z);
      if (typeof paint === "number") _c.set(paint);
      else paint(p, _c, pi);
      // subtle low-frequency mottling so flat fabric reads as cloth
      if (mottle > 0) {
        const n = noise3(p.x * 9, p.y * 9, p.z * 9) * 0.6 + noise3(p.x * 31, p.y * 31, p.z * 31) * 0.4;
        const k = 1 + n * mottle;
        _c.r *= k;
        _c.g *= k;
        _c.b *= k;
      }
      this.col.push(_c.r, _c.g, _c.b);
      this.rgh.push(rough);
      this.shd.push(shade);
      if (spec && this.bones) {
        this.weigh(p, spec, ix, w);
        this.si.push(ix[0] ?? 0, ix[1] ?? 0, ix[2] ?? 0, ix[3] ?? 0);
        this.sw.push(w[0] ?? 0, w[1] ?? 0, w[2] ?? 0, w[3] ?? 0);
      } else {
        this.si.push(0, 0, 0, 0);
        this.sw.push(1, 0, 0, 0);
      }
    }
    for (const t of piece.tris) this.idx.push(base + t);
    this.count += piece.pts.length;
    return this;
  }

  private weigh(p: V, spec: SkinSpec, ix: number[], w: number[]): void {
    const bones = this.bones;
    if (!bones) return;
    const list = spec.bones;
    if (list.length === 1) {
      ix[0] = list[0] ?? 0;
      w[0] = 1;
      ix[1] = ix[2] = ix[3] = 0;
      w[1] = w[2] = w[3] = 0;
      return;
    }
    const power = spec.power ?? 4;
    const cand: { b: number; w: number }[] = [];
    for (let k = 0; k < list.length; k++) {
      const bi = list[k] ?? 0;
      const bd = bones[bi];
      if (!bd) continue;
      const d = Math.max(0.004, segDist(p, bd.head, bd.tail) * (spec.bias?.[k] ?? 1));
      cand.push({ b: bi, w: 1 / Math.pow(d, power) });
    }
    cand.sort((a, b) => b.w - a.w);
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += cand[k]?.w ?? 0;
    for (let k = 0; k < 4; k++) {
      const c = cand[k];
      ix[k] = c ? c.b : 0;
      w[k] = c && sum > 0 ? c.w / sum : 0;
    }
  }

  /**
   * Emit the geometry. Normals are smooth (welded per piece). Baked shading darkens downward-facing
   * surfaces a little (cheap ambient occlusion) so forms read under flat ambient light.
   */
  build(skinned: boolean): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    const nrm = g.getAttribute("normal");
    const col = new Float32Array(this.col);
    for (let i = 0; i < this.count; i++) {
      const s = this.shd[i] ?? 1;
      if (s <= 0) continue;
      const ny = nrm.getY(i);
      const k = 1 - s * (0.16 * (1 - (ny * 0.5 + 0.5)) ** 1.5);
      col[i * 3] = (col[i * 3] ?? 0) * k;
      col[i * 3 + 1] = (col[i * 3 + 1] ?? 0) * k;
      col[i * 3 + 2] = (col[i * 3 + 2] ?? 0) * k;
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("rough", new THREE.Float32BufferAttribute(this.rgh, 1));
    if (skinned) {
      g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(this.si, 4));
      g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(this.sw, 4));
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
