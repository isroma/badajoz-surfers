/**
 * Trees: every tree of the dataset at its real position and LiDAR height, species from context
 * (plane trees and jacarandas on avenues, orange trees in the old town, Canary and Washingtonia
 * palms on promenades, medians and roundabouts, poplars and stone pines by the river, cypresses
 * under the Alcazaba). Branching trunks and limbs, foliage as alpha-tested leaf-cluster cards
 * from the foliage atlas with normals bent outward (soft crowns), darker inside (AO) and wind
 * sway. Two LODs: near (≤ ~1.2k tris), merged per route chunk; far (a few big cards), permanent
 * and masked where the chunk's near version is built.
 */
import * as THREE from "three";
import { Acc } from "./acc";
import { cellUv, type FolCell } from "./foliage-tex";
import { hash01 } from "./shared";

export type Species = "shrub" | "reeds" | "plane" | "orange" | "palm" | "washingtonia" | "pine" | "poplar" | "jacaranda" | "cypress";

export interface TreeSpec {
  x: number;
  z: number;
  y: number;
  h: number;
  r: number;
  sp: Species;
  seed: number;
  chunk: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _col = new THREE.Color();

type Rnd = () => number;

function rnd(seed: number): Rnd {
  let i = 0;
  const base = Math.floor(seed * 1e6);
  return () => hash01(base, i++);
}

/** A leaf-cluster card centred at p, normal bent away from the crown centre `cc`. */
function card(acc: Acc, p: THREE.Vector3, size: number, nrm: THREE.Vector3, cell: FolCell, col: THREE.Color, cc: THREE.Vector3, sway: number, ph: number, spin: number): void {
  const t1 = new THREE.Vector3().crossVectors(nrm, Math.abs(nrm.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP).normalize();
  const t2 = new THREE.Vector3().crossVectors(nrm, t1).normalize();
  t1.multiplyScalar(Math.cos(spin)).addScaledVector(t2, Math.sin(spin));
  t2.crossVectors(nrm, t1).normalize();
  const [u0, v0, u1, v1] = cellUv(cell);
  const corners: [number, number, number, number][] = [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]];
  const pts = corners.map(([a, b]) => p.clone().addScaledVector(t1, a * size).addScaledVector(t2, b * size));
  const ns = pts.map((q) => q.clone().sub(cc).normalize().multiplyScalar(0.75).addScaledVector(UP, 0.35).normalize());
  acc.set("aSway", sway, ph);
  for (const k of [0, 1, 2, 0, 2, 3]) {
    const q = pts[k]!;
    const n = ns[k]!;
    const c = corners[k]!;
    acc.vert(q.x, q.y, q.z, n.x, n.y, n.z, col.r, col.g, col.b, c[2], c[3]);
  }
}

/** Tapered branch (open cylinder) from p0 to p1 with bark uv. */
function limb(acc: Acc, p0: THREE.Vector3, p1: THREE.Vector3, r0: number, r1: number, sides: number, cell: FolCell, col: THREE.Color, s0: number, s1: number, ph: number, vRep = 1): void {
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const len = dir.length();
  if (len < 1e-3) return;
  dir.divideScalar(len);
  const t1 = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP).normalize();
  const t2 = new THREE.Vector3().crossVectors(dir, t1).normalize();
  const [u0, v0, u1, v1] = cellUv(cell);
  const dark = col.clone().multiplyScalar(0.72);
  for (let k = 0; k < sides; k++) {
    const a0 = (k / sides) * Math.PI * 2;
    const a1 = ((k + 1) / sides) * Math.PI * 2;
    const o0 = t1.clone().multiplyScalar(Math.cos(a0)).addScaledVector(t2, Math.sin(a0));
    const o1 = t1.clone().multiplyScalar(Math.cos(a1)).addScaledVector(t2, Math.sin(a1));
    const A = p0.clone().addScaledVector(o0, r0);
    const B = p0.clone().addScaledVector(o1, r0);
    const C = p1.clone().addScaledVector(o1, r1);
    const D = p1.clone().addScaledVector(o0, r1);
    const ua = u0 + (u1 - u0) * (k / sides);
    const ub = u0 + (u1 - u0) * ((k + 1) / sides);
    const vt = v0 + (v1 - v0) * Math.min(1, vRep);
    const verts: [THREE.Vector3, THREE.Vector3, number, number, THREE.Color, number][] = [
      [A, o0, ua, v0, dark, s0], [B, o1, ub, v0, dark, s0], [C, o1, ub, vt, col, s1], [D, o0, ua, vt, col, s1],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const [q, n, u, v, c, s] = verts[i]!;
      acc.set("aSway", s, ph);
      acc.vert(q.x, q.y, q.z, n.x, n.y, n.z, c.r, c.g, c.b, u, v);
    }
  }
}

/** Fill an ellipsoidal crown with cards. `flat` biases normals upward (umbrella pines). */
function crown(acc: Acc, R: Rnd, cc: THREE.Vector3, rx: number, ry: number, n: number, size: number, cells: FolCell[], tint: THREE.Color, base: number, top: number, ph: number, flat = 0): void {
  for (let i = 0; i < n; i++) {
    // points biased to the shell
    let dx = 0, dy = 0, dz = 0;
    do {
      dx = R() * 2 - 1;
      dy = R() * 2 - 1;
      dz = R() * 2 - 1;
    } while (dx * dx + dy * dy + dz * dz > 1);
    const l = Math.hypot(dx, dy, dz) || 1;
    const shell = 0.55 + 0.45 * Math.pow(R(), 0.5);
    const p = new THREE.Vector3(cc.x + (dx / l) * rx * shell, cc.y + (dy / l) * ry * shell, cc.z + (dz / l) * rx * shell);
    const out = new THREE.Vector3((dx / l) * (1 - flat), (dy / l) * (1 - flat) + flat, (dz / l) * (1 - flat)).normalize();
    const nrm = out.add(new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(1.2)).normalize();
    // ambient occlusion: inside and underneath darker
    const hgt = (p.y - (cc.y - ry)) / (2 * ry);
    const ao = (0.55 + 0.25 * shell + 0.2 * hgt) * (0.9 + R() * 0.2);
    _col.copy(tint).multiplyScalar(ao);
    const cell = cells[Math.floor(R() * cells.length)] ?? cells[0]!;
    const sway = Math.min(1, Math.max(0, (p.y - base) / Math.max(0.5, top - base)));
    card(acc, p, size * (0.8 + R() * 0.4), nrm, cell, _col, cc, sway, ph, R() * 6.28);
  }
}

/** Emit one tree. `detail` = near LOD. */
export function emitTree(acc: Acc, t: TreeSpec, detail: boolean): void {
  const R = rnd(t.seed);
  const ph = t.seed * 40;
  const { x, y, z, h } = t;
  const rr = Math.max(1.2, Math.min(t.r, h * 0.6));
  acc.set("aChunk", t.chunk);
  const barkPale = new THREE.Color(0xe0d8c8);
  const barkBrown = new THREE.Color(0xb8a48c);
  const top = y + h;
  switch (t.sp) {
    case "palm": {
      // Canary Island date palm: thick ringed trunk, dense crown of long arching fronds, dead skirt
      const H = Math.max(5, h);
      const lean = (R() - 0.5) * 0.06 * H;
      const tTop = new THREE.Vector3(x + lean, y + H * 0.86, z);
      limb(acc, new THREE.Vector3(x, y, z), tTop, 0.5, 0.42, detail ? 9 : 5, "palmTrunk", new THREE.Color(0xd8c8a8), 0, 0.15, ph, H / 3);
      const fronds = detail ? 26 : 8;
      for (let k = 0; k < fronds; k++) {
        const az = (k / fronds) * Math.PI * 2 + R() * 0.4;
        const elev = (R() - 0.25) * 0.9; // some up, some drooping
        const len = (detail ? 4.2 : 4.6) + R() * 1.4;
        frond(acc, tTop, az, elev, len, detail ? 5 : 3, k < fronds * 0.15 ? new THREE.Color(0xb8a070) : new THREE.Color(0xe6f0d6).multiplyScalar(0.9 + R() * 0.2), ph + k * 0.2, "frond", 0.55);
      }
      return;
    }
    case "washingtonia": {
      const H = Math.max(8, h);
      const tTop = new THREE.Vector3(x + (R() - 0.5) * 0.5, y + H * 0.9, z);
      limb(acc, new THREE.Vector3(x, y, z), tTop, 0.32, 0.24, detail ? 7 : 4, "palmTrunk", new THREE.Color(0xc8b8a0), 0, 0.1, ph, H / 2);
      // brown skirt of dead leaves
      limb(acc, tTop.clone().add(new THREE.Vector3(0, -1.6, 0)), tTop, 0.62, 0.5, detail ? 8 : 4, "bark", new THREE.Color(0xb89a74), 0.1, 0.15, ph);
      const fans = detail ? 16 : 6;
      for (let k = 0; k < fans; k++) {
        const az = (k / fans) * Math.PI * 2 + R();
        const elev = 0.2 + R() * 0.7;
        const d = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
        const c = tTop.clone().addScaledVector(d, 1.1);
        card(acc, c, 0.9, d.clone().cross(UP).normalize().cross(d).normalize(), "fan", new THREE.Color(0xe0ecd0), tTop, 0.7, ph + k, az);
      }
      return;
    }
    case "shrub": {
      // tamarisk / riverside scrub: low, wide, feathery grey-green
      crown(acc, R, new THREE.Vector3(x, y + h * 0.5, z), Math.max(1.2, rr), h * 0.5, detail ? 40 : 12, detail ? 0.7 : 1.2, ["pine", "poplar"], new THREE.Color(0xc8d0b8), y, top, ph);
      return;
    }
    case "reeds": {
      // a clump of reeds: crossed tuft cards
      for (let k = 0; k < (detail ? 5 : 2); k++) {
        const a = (k / 5) * Math.PI + R();
        const n = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        card(acc, new THREE.Vector3(x + (R() - 0.5) * 2, y + h * 0.5, z + (R() - 0.5) * 2), h * 0.55, n, "tuft", new THREE.Color(0xd8d0a0), new THREE.Vector3(x, y - 2, z), 0.8, ph + k, 0);
      }
      return;
    }
    case "cypress": {
      limb(acc, new THREE.Vector3(x, y, z), new THREE.Vector3(x, y + 1.2, z), 0.16, 0.12, 4, "bark", barkBrown, 0, 0, ph);
      const w = Math.min(1.4, rr * 0.45);
      crown(acc, R, new THREE.Vector3(x, y + h * 0.53, z), w, h * 0.47, detail ? 70 : 16, detail ? 0.75 : 1.1, ["cypress"], new THREE.Color(0xc0d0b8), y, top, ph);
      return;
    }
    case "poplar": {
      limb(acc, new THREE.Vector3(x, y, z), new THREE.Vector3(x, y + h * 0.45, z), 0.26, 0.16, detail ? 6 : 4, "barkPlane", barkPale, 0, 0.2, ph);
      const w = Math.min(2.6, rr * 0.6);
      crown(acc, R, new THREE.Vector3(x, y + h * 0.6, z), w, h * 0.4, detail ? 120 : 20, detail ? 0.9 : 1.7, ["poplar"], new THREE.Color(0xe8f0d0), y, top, ph);
      return;
    }
    case "pine": {
      // stone pine: tall leaning trunk, limbs, flat umbrella crown
      const lean = new THREE.Vector3((R() - 0.5) * 2, 0, (R() - 0.5) * 2);
      const tTop = new THREE.Vector3(x, y + h * 0.72, z).add(lean);
      limb(acc, new THREE.Vector3(x, y, z), tTop, 0.32, 0.2, detail ? 7 : 4, "bark", new THREE.Color(0xd8b8a0), 0, 0.2, ph, 2);
      const cc = new THREE.Vector3(tTop.x, y + h * 0.84, tTop.z);
      if (detail) for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + R();
        limb(acc, tTop, cc.clone().add(new THREE.Vector3(Math.cos(a) * rr * 0.6, 0, Math.sin(a) * rr * 0.6)), 0.14, 0.06, 5, "bark", barkBrown, 0.2, 0.6, ph);
      }
      crown(acc, R, cc, rr * 1.05, h * 0.13, detail ? 140 : 16, detail ? 1.0 : 1.9, ["pine"], new THREE.Color(0xd6e0c8), y, top, ph, 0.55);
      return;
    }
    case "orange": {
      const H = Math.min(h, 6);
      const w = Math.min(rr, 2.0);
      limb(acc, new THREE.Vector3(x, y, z), new THREE.Vector3(x, y + H * 0.35, z), 0.11, 0.08, detail ? 6 : 3, "bark", barkBrown, 0, 0.1, ph);
      crown(acc, R, new THREE.Vector3(x, y + H * 0.6, z), w, H * 0.4, detail ? 110 : 18, detail ? 0.55 : 0.95, ["orange"], new THREE.Color(0xe0ead8), y, y + H, ph);
      return;
    }
    default: {
      // plane tree / jacaranda: mottled trunk forking into limbs, broad crown
      const jac = t.sp === "jacaranda";
      const bloom = jac && t.seed < 0.5;
      const tr = Math.min(0.42, 0.12 + h * 0.018);
      const tH = h * 0.38;
      const fork = new THREE.Vector3(x + (R() - 0.5) * 0.3, y + tH, z + (R() - 0.5) * 0.3);
      limb(acc, new THREE.Vector3(x, y, z), fork, tr, tr * 0.8, detail ? 7 : 4, jac ? "bark" : "barkPlane", jac ? barkBrown : barkPale, 0, 0.1, ph, h / 6);
      const crownY = y + tH + (h - tH) * 0.5;
      const ch = (h - tH) * 0.55;
      const cc = new THREE.Vector3(x, crownY, z);
      if (detail) {
        const n = 3 + Math.floor(R() * 2);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + R();
          const tip = new THREE.Vector3(x + Math.cos(a) * rr * 0.6, crownY + (R() - 0.2) * ch * 0.5, z + Math.sin(a) * rr * 0.6);
          limb(acc, fork, tip, tr * 0.6, tr * 0.25, 5, jac ? "bark" : "barkPlane", jac ? barkBrown : barkPale, 0.15, 0.6, ph);
          // a few twigs
          for (let j = 0; j < 2; j++) {
            const tw = tip.clone().add(new THREE.Vector3((R() - 0.5) * rr * 0.6, R() * ch * 0.4, (R() - 0.5) * rr * 0.6));
            limb(acc, tip, tw, tr * 0.22, tr * 0.08, 3, "bark", barkBrown, 0.6, 0.9, ph);
          }
        }
      } else {
        limb(acc, fork, cc, tr * 0.6, tr * 0.3, 3, "barkPlane", barkPale, 0.1, 0.5, ph);
      }
      const cells: FolCell[] = jac ? (bloom ? ["jacarandaBloom", "jacarandaBloom", "jacaranda"] : ["jacaranda"]) : ["plane", "plane2"];
      const tint = jac ? new THREE.Color(0xe8e8f0) : new THREE.Color(0xe4ecd4).multiplyScalar(0.92 + R() * 0.12);
      crown(acc, R, cc, rr, ch, detail ? (rr > 4 ? 170 : 120) : 18, detail ? Math.max(0.8, rr * 0.28) : rr * 0.55, cells, tint, y, top, ph);
    }
  }
}

/** An arching palm frond as a strip of quads textured with the frond cell. */
function frond(acc: Acc, base: THREE.Vector3, az: number, elev: number, len: number, segs: number, col: THREE.Color, ph: number, cell: FolCell, width: number): void {
  const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const [u0, v0, u1, v1] = cellUv(cell);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const ang = elev - t * t * 1.6; // arch over and droop
    const p = base.clone().addScaledVector(dir, Math.cos(elev) * len * t * 0.9).add(new THREE.Vector3(0, Math.sin(ang) * len * t * 0.55, 0));
    pts.push(p);
  }
  for (let i = 0; i < segs; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const wa = width * Math.sin(Math.PI * Math.min(1, (i / segs) * 1.1 + 0.08));
    const wb = width * Math.sin(Math.PI * Math.min(1, ((i + 1) / segs) * 1.1 + 0.08));
    // a slight V: the two halves tilt up
    const ua = u0 + (u1 - u0) * (i / segs);
    const ub = u0 + (u1 - u0) * ((i + 1) / segs);
    const vm = (v0 + v1) / 2;
    for (const sgn of [-1, 1]) {
      _a.copy(a);
      _b.copy(b);
      _c.copy(b).addScaledVector(side, sgn * wb).add(new THREE.Vector3(0, wb * 0.25, 0));
      _d.copy(a).addScaledVector(side, sgn * wa).add(new THREE.Vector3(0, wa * 0.25, 0));
      const n = new THREE.Vector3().subVectors(_b, _a).cross(new THREE.Vector3().subVectors(_d, _a)).normalize();
      if (n.y < 0) n.negate();
      n.lerp(UP, 0.4).normalize();
      const vEdge = sgn > 0 ? v1 : v0;
      const sa = 0.5 + 0.5 * (i / segs);
      const sb = 0.5 + 0.5 * ((i + 1) / segs);
      const quad: [THREE.Vector3, number, number, number][] = [[_a, ua, vm, sa], [_b, ub, vm, sb], [_c, ub, vEdge, sb], [_d, ua, vEdge, sa]];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const [q, u, v, s] = quad[k]!;
        acc.set("aSway", s, ph);
        acc.vert(q.x, q.y, q.z, n.x, n.y, n.z, col.r, col.g, col.b, u, v);
      }
    }
  }
}
