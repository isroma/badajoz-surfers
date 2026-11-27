/**
 * Heads and faces. The head is a sculpted sphere (`headPoint`), shared by the skinned body (skull,
 * hair and hat shells) and the face mesh. The face mesh (eyes, lids, brows, mouth, teeth,
 * moustache) is a small separate mesh parented to the head bone whose expressions are morph
 * targets: every expression is the same procedural face rebuilt with one parameter at 1.
 */
import * as THREE from "three";
import { P } from "../proportions";
import { SkinBuilder, ellipsoid, loft, sphere, tube, v3, type Piece, type Ring, type V } from "./skin";

export interface HeadCfg {
  c: V;
  r: readonly [number, number, number];
  jaw: number;
  chin: number;
  cheek: number;
  brow: number;
  skin: number;
  /** Eye placement (radians on the head sphere) and size. */
  eyeYaw: number;
  eyePitch: number;
  eyeR: number;
  iris: number;
  browColor: number;
  browThick: number;
  browPitch: number;
  mouthPitch: number;
  mouthW: number;
  moustache: number | null;
  lash: number;
  /** Lid colour (skin, or a painted mask). */
  lid: number;
}

export const FX = {
  blink: 0,
  smile: 1,
  frown: 2,
  open: 3,
  grit: 4,
  smirk: 5,
  oh: 6,
  browAngry: 7,
  browWorried: 8,
  browUp: 9,
  lookX: 10,
  lookY: 11,
  squint: 12,
  wide: 13,
} as const;
export const FACE_CHANNELS = 14;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const gauss = (x: number, m: number, s: number): number => Math.exp(-((x - m) ** 2) / (2 * s * s));

export function runnerHead(skin: number): HeadCfg {
  return {
    c: v3(...P.headC),
    r: P.headR,
    jaw: 0.3,
    chin: 0.12,
    cheek: 0.08,
    brow: 0.5,
    skin,
    eyeYaw: 0.36,
    eyePitch: 0.05,
    eyeR: 0.0235,
    iris: 0x6a4026,
    browColor: 0x2c1a10,
    browThick: 0.0095,
    browPitch: 0.31,
    mouthPitch: -0.45,
    mouthW: 0.27,
    moustache: null,
    lash: 0x1c120c,
    lid: skin,
  };
}

export function waiterHead(skin: number): HeadCfg {
  return {
    c: v3(P.headC[0], P.headC[1] - 0.004, P.headC[2]),
    r: [0.108, 0.13, 0.12],
    jaw: 0.12,
    chin: 0.05,
    cheek: 0.14,
    brow: 0.7,
    skin,
    eyeYaw: 0.36,
    eyePitch: 0.12,
    eyeR: 0.02,
    iris: 0x3b2a1c,
    browColor: 0x151110,
    browThick: 0.013,
    browPitch: 0.34,
    mouthPitch: -0.53,
    mouthW: 0.2,
    moustache: 0x17110d,
    lash: 0x140e0a,
    lid: skin,
  };
}

/** Sculpted head surface for a unit direction (front is -Z). */
export function headPoint(h: HeadCfg, n: V, out: V): V {
  let x = n.x;
  const y = n.y;
  let z = n.z;
  const low = smoothstep(0.1, -0.95, y);
  const front = smoothstep(0.35, -0.85, z);
  // narrower jaw and chin, mostly near the chin so the jaw angle stays square
  x *= 1 - h.jaw * low * low * (0.5 + 0.5 * front);
  // chin forward
  z -= h.chin * low * front * 0.14 * smoothstep(-0.3, -0.85, y);
  // a slightly flatter face plane
  if (z < 0) z *= 1 - 0.07 * front * (1 - low);
  // cheeks
  x *= 1 + h.cheek * gauss(y, -0.25, 0.25) * front;
  // rounder back of the skull, flatter nape
  if (z > 0) z *= 1 + 0.07 * smoothstep(-0.3, 0.5, y) - 0.06 * smoothstep(-0.2, -0.8, y);
  // brow ridge
  z -= h.brow * 0.05 * gauss(y, 0.3, 0.09) * front * gauss(x, 0, 0.55);
  // soft eye sockets
  for (const s of [-1, 1]) {
    const k = gauss(x, s * Math.sin(h.eyeYaw), 0.13) * gauss(y, Math.sin(h.eyePitch), 0.11) * front;
    z += 0.035 * k;
  }
  return out.set(h.c.x + x * h.r[0], h.c.y + y * h.r[1], h.c.z + z * h.r[2]);
}

export function dir(yaw: number, pitch: number, out: V): V {
  return out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

const _n = v3();
const _a = v3();
const _b = v3();
const _p = v3();

/** Surface point at (yaw, pitch) and its outward normal. */
export function surf(h: HeadCfg, yaw: number, pitch: number, out: V, nrm?: V): V {
  headPoint(h, dir(yaw, pitch, _n), out);
  if (nrm) {
    const e = 0.004;
    headPoint(h, dir(yaw + e, pitch, _n), _a).sub(out);
    headPoint(h, dir(yaw, pitch + e, _n), _b).sub(out);
    nrm.crossVectors(_b, _a).normalize();
    // make sure it points away from the head centre
    if (_p.subVectors(out, h.c).dot(nrm) < 0) nrm.negate();
  }
  return out;
}

/** The skull as a skinned piece (welded sphere through `headPoint`). */
export function skullPiece(h: HeadCfg, w = 22, hh = 17): Piece {
  return sphere(w, hh, (n, p) => headPoint(h, n, p));
}

/**
 * A shell over the head: pushed out by `off(n)` where positive, buried where negative. This is how
 * hair and caps get crisp edges where they cross the skin.
 */
export function shellPiece(h: HeadCfg, off: (n: V) => number, w = 22, hh = 16, puff?: (n: V, p: V) => void, thetaMax = Math.PI): Piece {
  return sphere(w, hh, (n, p) => {
    headPoint(h, n, p);
    _p.subVectors(p, h.c);
    const len = _p.length();
    const k = (len + off(n)) / len;
    p.copy(h.c).addScaledVector(_p, k);
    if (puff) puff(n, p);
  }, thetaMax);
}

// ---------------------------------------------------------------------------
// The face mesh
// ---------------------------------------------------------------------------

type Params = Float32Array;

function eyeFrame(h: HeadCfg, side: -1 | 1): { c: V; fwd: V; up: V; side: V } {
  const s = v3();
  const nrm = v3();
  surf(h, side * h.eyeYaw, h.eyePitch, s, nrm);
  const c = s.clone().addScaledVector(nrm, -h.eyeR * 0.5);
  const fwd = nrm.clone().lerp(v3(0, 0, -1), 0.7).normalize();
  const up = v3(0, 1, 0).addScaledVector(fwd, -fwd.y).normalize();
  const sd = v3().crossVectors(up, fwd).normalize(); // points to -X? make it +X
  if (sd.x < 0) sd.negate();
  return { c, fwd, up, side: sd };
}

function onEye(f: { c: V; fwd: V; up: V; side: V }, r: number, theta: number, phi: number, out: V): V {
  // theta from the up pole, phi around from the front towards +X
  const st = Math.sin(theta);
  return out
    .copy(f.c)
    .addScaledVector(f.up, Math.cos(theta) * r)
    .addScaledVector(f.fwd, st * Math.cos(phi) * r)
    .addScaledVector(f.side, st * Math.sin(phi) * r);
}

function eyePieces(b: SkinBuilder, h: HeadCfg, p: Params, side: -1 | 1): void {
  const f = eyeFrame(h, side);
  const R = h.eyeR;
  // eyeball
  b.add(ellipsoid(f.c, R, R, R, 12, 8), 0xf3efe6, null, { rough: 0.22, shade: 0.25, mottle: 0 });
  // iris + pupil cap, rotated by the gaze
  const yaw = (p[FX.lookX] ?? 0) * 0.42 + side * 0.04;
  const pitch = (p[FX.lookY] ?? 0) * 0.32 - 0.02;
  const axis = f.fwd.clone().applyAxisAngle(f.up, -yaw);
  const sideAx = v3().crossVectors(f.up, axis).normalize();
  axis.applyAxisAngle(sideAx, -pitch).normalize();
  const upAx = v3().crossVectors(axis, sideAx).normalize();
  const capRing = (ang: number, rr: number): Ring => {
    const c = f.c.clone().addScaledVector(axis, Math.cos(ang) * R * rr);
    return { c, x: sideAx, y: upAx, rx: Math.sin(ang) * R * rr, ryP: Math.sin(ang) * R * rr, ryN: Math.sin(ang) * R * rr };
  };
  const wide = p[FX.wide] ?? 0;
  const ir = 0.56 - wide * 0.06;
  const pr = 0.24 - wide * 0.08;
  const rings = [capRing(0.03, 1.04), capRing(pr, 1.038), capRing(pr + 0.04, 1.035), capRing(ir - 0.06, 1.03), capRing(ir, 1.022), capRing(ir + 0.05, 1.0)];
  const iris = new THREE.Color(h.iris);
  const dark = iris.clone().multiplyScalar(0.45);
  const colours = [0x070708, 0x0a0a0c, iris.getHex(), iris.clone().multiplyScalar(0.8).getHex(), dark.getHex(), 0xf3efe6];
  const piece = loft(rings, 12, 0, -1);
  // assign colour per ring: piece points are ring-major (16 per ring) then the fan tip
  b.add(piece, (q, out) => {
    // nearest ring by angle from the axis
    const ang = Math.acos(Math.min(1, Math.max(-1, _a.subVectors(q, f.c).normalize().dot(axis))));
    const edges = [0.03, pr, pr + 0.04, ir - 0.06, ir, ir + 0.05];
    let k = 0;
    for (let i = 0; i < edges.length; i++) if (ang >= (edges[i] ?? 0) - 1e-4) k = i;
    out.set(colours[k] ?? 0);
  }, null, { rough: 0.12, shade: 0, mottle: 0 });
  // catchlight
  const cl = f.c.clone().addScaledVector(axis, R * 1.045).addScaledVector(upAx, R * 0.2).addScaledVector(sideAx, -side * R * 0.16);
  b.add(ellipsoid(cl, R * 0.11, R * 0.11, R * 0.05, 6, 4), 0xffffff, null, { rough: 0.1, shade: 0, mottle: 0 });
  // lids
  const nasal = side === -1 ? 1 : -1;
  const blink = p[FX.blink] ?? 0;
  const squint = p[FX.squint] ?? 0;
  const angry = p[FX.browAngry] ?? 0;
  const worried = p[FX.browWorried] ?? 0;
  const smile = p[FX.smile] ?? 0;
  const lookY = p[FX.lookY] ?? 0;
  const PHI = 1.75;
  const COLS = 13;
  const upperEdge = (q: number): number => {
    const inner = smoothstep(0, 1, nasal * q);
    const outer = smoothstep(0, 1, -nasal * q);
    return 1.06 + 0.24 * q * q + blink * (1.66 - 1.06 - 0.16 * q * q) + squint * 0.2 - wide * 0.28 + angry * 0.26 * inner - angry * 0.02 + worried * 0.18 * outer - lookY * 0.12;
  };
  const lowerEdge = (q: number): number => 2.1 - 0.16 * q * q - blink * (2.1 - 1.68 - 0.12 * q * q) - squint * 0.3 + wide * 0.1 - smile * 0.12 + lookY * 0.06;
  const lid = (upper: boolean): void => {
    const pts: V[] = [];
    const tris: number[] = [];
    const rr = upper ? 1.13 : 1.1;
    const fr = upper ? [0, 0.4, 0.7, 0.88, 1] : [0, 0.45, 0.8, 1];
    const rows = fr.length + 1;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < COLS; i++) {
        const q = (i / (COLS - 1)) * 2 - 1;
        const phi = q * PHI;
        const edge = upper ? upperEdge(q) : lowerEdge(q);
        const start = upper ? 0.18 : Math.PI - 0.18;
        const k = fr[Math.min(j, fr.length - 1)] ?? 1;
        const th = start + (edge - start) * k;
        // last row folds back onto the eyeball: the lid's thickness, lined with lashes
        const r = j === rows - 1 ? R * 0.99 : R * rr;
        pts.push(onEye(f, r, th, phi, v3()));
      }
    }
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < COLS - 1; i++) {
        const a = j * COLS + i;
        const bq = a + 1;
        const c = a + COLS + 1;
        const d = a + COLS;
        if (upper) tris.push(a, bq, c, a, c, d);
        else tris.push(a, c, bq, a, d, c);
      }
    }
    const lashRow = (rows - 2) * COLS;
    b.add({ pts, tris }, (q, out) => {
      const idx = pts.indexOf(q);
      out.set(idx >= lashRow ? h.lash : h.lid);
    }, null, { rough: 0.55, shade: 0.5, mottle: 0 });
  };
  lid(true);
  lid(false);
}

function browPiece(b: SkinBuilder, h: HeadCfg, p: Params, side: -1 | 1): void {
  const angry = p[FX.browAngry] ?? 0;
  const worried = p[FX.browWorried] ?? 0;
  const up = p[FX.browUp] ?? 0;
  const squint = p[FX.squint] ?? 0;
  const frown = p[FX.frown] ?? 0;
  const inner = -angry * 0.13 + worried * 0.13 + up * 0.1 - squint * 0.03 - frown * 0.04;
  const outer = angry * 0.04 - worried * 0.05 + up * 0.09 - squint * 0.02;
  const yaw0 = h.eyeYaw - 0.25 + angry * 0.025;
  const yaw1 = h.eyeYaw + 0.24;
  const path: V[] = [];
  const nrm = v3();
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const pitch = h.browPitch + 0.045 * Math.sin(Math.PI * Math.min(1, t * 1.2)) + inner * (1 - t) + outer * t - 0.03 * t;
    const q = surf(h, side * (yaw0 + (yaw1 - yaw0) * t), pitch, v3(), nrm);
    q.addScaledVector(nrm, 0.004);
    path.push(q);
  }
  const th = h.browThick;
  b.add(
    tube(path, [[0, th * 0.8, 0.004, 0.003], [0.25, th, 0.0055, 0.003], [0.7, th * 0.85, 0.005, 0.003], [1, th * 0.4, 0.003, 0.002]], 6, 7, { up: v3(0, 0, -1), capA: 0.5, capB: 0.8 }),
    h.browColor,
    null,
    { rough: 0.85, shade: 0.3, mottle: 0.05 },
  );
}

/** Mouth edge pitches for column u in -1..1 (upper, lower), and the corner yaw. */
function mouthShape(h: HeadCfg, p: Params, u: number): { up: number; lo: number; yaw: number } {
  const smile = p[FX.smile] ?? 0;
  const frown = p[FX.frown] ?? 0;
  const open = p[FX.open] ?? 0;
  const grit = p[FX.grit] ?? 0;
  const smirk = p[FX.smirk] ?? 0;
  const oh = p[FX.oh] ?? 0;
  const mid = 1 - u * u;
  const box = 1 - u ** 4;
  const width = 1 + grit * 0.14 + smile * 0.08 - oh * 0.45 - frown * 0.05;
  let base = h.mouthPitch + smile * 0.085 * u * u - frown * 0.07 * u * u + smirk * (0.11 * Math.max(0, u) ** 2 - 0.02 * Math.max(0, -u)) + smile * 0.01;
  base -= open * 0.01;
  const thin = 0.011 * Math.sqrt(Math.max(0, mid));
  const upper = base + thin + open * 0.022 * Math.sqrt(mid) + grit * 0.03 * box + oh * 0.035 * Math.sqrt(mid) + smile * 0.008 * mid;
  const lower = base - thin - open * 0.13 * Math.pow(mid, 0.7) - grit * 0.04 * box - oh * 0.075 * Math.sqrt(mid) - smile * 0.03 * mid;
  return { up: upper, lo: lower, yaw: u * h.mouthW * width };
}

function mouthPieces(b: SkinBuilder, h: HeadCfg, p: Params): void {
  const COLS = 17;
  const ROWS = 6;
  const pts: V[] = [];
  const cols: number[] = [];
  const tris: number[] = [];
  const nrm = v3();
  const rowCol = [0x5e2420, 0x2e0d0e, 0x220909, 0x3a1214, 0x9c4a48, 0x6e2e2a];
  for (let j = 0; j < ROWS; j++) {
    const v = j / (ROWS - 1);
    for (let i = 0; i < COLS; i++) {
      const u = (i / (COLS - 1)) * 2 - 1;
      const m = mouthShape(h, p, u);
      const q = surf(h, m.yaw, m.up + (m.lo - m.up) * v, v3(), nrm);
      q.addScaledVector(nrm, 0.0016);
      pts.push(q);
      cols.push(rowCol[j] ?? 0);
    }
  }
  for (let j = 0; j < ROWS - 1; j++) {
    for (let i = 0; i < COLS - 1; i++) {
      const a = j * COLS + i;
      tris.push(a, a + 1, a + COLS + 1, a, a + COLS + 1, a + COLS);
    }
  }
  b.add({ pts, tris }, (q, out) => out.set(cols[pts.indexOf(q)] ?? 0), null, { rough: 0.45, shade: 0, mottle: 0 });
  // upper teeth: a strip hanging from the upper lip, revealed by opening
  const open = p[FX.open] ?? 0;
  const grit = p[FX.grit] ?? 0;
  const tp: V[] = [];
  const tt: number[] = [];
  const TC = 13;
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < TC; i++) {
      const u = ((i / (TC - 1)) * 2 - 1) * 0.78;
      const m = mouthShape(h, p, u);
      const mid = 1 - u * u;
      const top = m.up - 0.004;
      const hgt = open * 0.04 * Math.sqrt(mid) + grit * 0.05 * (1 - u ** 4) + 0.0005;
      const q = surf(h, m.yaw, j === 0 ? top : top - hgt, v3(), nrm);
      q.addScaledVector(nrm, 0.0024);
      tp.push(q);
    }
  }
  for (let i = 0; i < TC - 1; i++) tt.push(i, i + 1, i + TC + 1, i, i + TC + 1, i + TC);
  b.add({ pts: tp, tris: tt }, 0xf4efe4, null, { rough: 0.3, shade: 0, mottle: 0 });
  // lower teeth, shown by gritting
  const lp: V[] = [];
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < TC; i++) {
      const u = ((i / (TC - 1)) * 2 - 1) * 0.7;
      const m = mouthShape(h, p, u);
      const bot = m.lo + 0.004;
      const hgt = grit * 0.03 * (1 - u ** 4) + 0.0005;
      const q = surf(h, m.yaw, j === 0 ? bot + hgt : bot, v3(), nrm);
      q.addScaledVector(nrm, 0.0023);
      lp.push(q);
    }
  }
  b.add({ pts: lp, tris: tt.slice() }, 0xe9e2d4, null, { rough: 0.3, shade: 0, mottle: 0 });
  // lips: a fuller lower lip and a thin upper one riding the mouth edges
  for (const lower of [true, false]) {
    const path: V[] = [];
    const LN = 8;
    for (let i = 0; i <= LN; i++) {
      const u = ((i / LN) * 2 - 1) * 0.86;
      const m = mouthShape(h, p, u);
      const q = surf(h, m.yaw, lower ? m.lo - 0.026 * (1 - u * u) - 0.004 : m.up + 0.012 * (1 - u * u) + 0.003, v3(), nrm);
      q.addScaledVector(nrm, lower ? 0.0005 : 0.0);
      path.push(q);
    }
    const r = lower ? 0.0045 : 0.003;
    b.add(tube(path, [[0, r * 0.3, r * 0.3], [0.5, r, r * 0.7], [1, r * 0.3, r * 0.3]], 4, 7, { up: v3(0, 0, -1), capA: 0, capB: 0 }), lower ? 0xb36a58 : 0x9c5a4a, null, { rough: 0.45, shade: 0.3, mottle: 0 });
  }
}

function moustachePiece(b: SkinBuilder, h: HeadCfg, p: Params, colour: number): void {
  const smile = p[FX.smile] ?? 0;
  const angry = p[FX.browAngry] ?? 0;
  for (const side of [-1, 1] as const) {
    const path: V[] = [];
    const nrm = v3();
    const N = 7;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const u = side * (0.03 + t * 1.25);
      const m = mouthShape(h, p, Math.max(-1, Math.min(1, u)));
      const curl = t > 0.75 ? (t - 0.75) * 0.5 : 0;
      const pitch = m.up + 0.075 - t * 0.04 + curl * (1 + smile) + smile * 0.02 * t - angry * 0.01 * t;
      const yaw = side * (0.01 + t * h.mouthW * 1.35);
      const q = surf(h, yaw, pitch, v3(), nrm);
      q.addScaledVector(nrm, 0.009 + 0.006 * Math.sin(Math.PI * Math.min(1, t * 1.6)));
      path.push(q);
    }
    b.add(
      tube(path, [[0, 0.013, 0.01], [0.3, 0.017, 0.012], [0.75, 0.01, 0.008], [1, 0.003, 0.003]], 10, 10, { up: v3(0, 0, -1), capA: 0.6, capB: 0.6 }),
      colour,
      null,
      { rough: 0.75, shade: 0.4, mottle: 0.08 },
    );
  }
}

function buildFace(h: HeadCfg, p: Params): SkinBuilder {
  const b = new SkinBuilder(null);
  eyePieces(b, h, p, -1);
  eyePieces(b, h, p, 1);
  browPiece(b, h, p, -1);
  browPiece(b, h, p, 1);
  mouthPieces(b, h, p);
  if (h.moustache !== null) moustachePiece(b, h, p, h.moustache);
  return b;
}

/**
 * Face geometry with one morph target per FX channel, in head-bone local space
 * (the bind-space head joint is subtracted).
 */
export function faceGeometry(h: HeadCfg): THREE.BufferGeometry {
  const params = new Float32Array(FACE_CHANNELS);
  const base = buildFace(h, params).build(false);
  const pos = base.getAttribute("position");
  const nrm = base.getAttribute("normal");
  const morphP: THREE.BufferAttribute[] = [];
  const morphN: THREE.BufferAttribute[] = [];
  for (let k = 0; k < FACE_CHANNELS; k++) {
    params.fill(0);
    params[k] = 1;
    const g = buildFace(h, params).build(false);
    const gp = g.getAttribute("position");
    const gn = g.getAttribute("normal");
    if (gp.count !== pos.count) throw new Error(`face morph ${k}: topology mismatch`);
    const dp = new Float32Array(pos.count * 3);
    const dn = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      dp[i * 3] = gp.getX(i) - pos.getX(i);
      dp[i * 3 + 1] = gp.getY(i) - pos.getY(i);
      dp[i * 3 + 2] = gp.getZ(i) - pos.getZ(i);
      dn[i * 3] = gn.getX(i) - nrm.getX(i);
      dn[i * 3 + 1] = gn.getY(i) - nrm.getY(i);
      dn[i * 3 + 2] = gn.getZ(i) - nrm.getZ(i);
    }
    morphP.push(new THREE.BufferAttribute(dp, 3));
    morphN.push(new THREE.BufferAttribute(dn, 3));
    g.dispose();
  }
  base.morphAttributes["position"] = morphP;
  base.morphAttributes["normal"] = morphN;
  base.morphTargetsRelative = true;
  base.translate(0, -P.headY, 0);
  base.computeBoundingSphere();
  if (base.boundingSphere) base.boundingSphere.radius += 0.05;
  return base;
}
