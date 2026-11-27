/**
 * Trees in the flat style (docs/design.md): every tree of the dataset at its real position and
 * height, drawn as one of three low-poly shapes, green only: a round crown (plane trees, orange
 * trees, pines, scrub), a tall crown (poplars, cypresses) and a palm. Soft gentle sway.
 */
import * as THREE from "three";
import { PAL } from "../palette";
import { Acc } from "./acc";
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

const ICO = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
const OCT = new THREE.OctahedronGeometry(1, 0).toNonIndexed();
const TRUNK = new THREE.CylinderGeometry(0.6, 1, 1, 5, 1, true).toNonIndexed();

function emitGeo(acc: Acc, g: THREE.BufferGeometry, m: THREE.Matrix4, col: THREE.Color, swayBase: number, swayTop: number, ph: number): void {
  const p = g.getAttribute("position");
  const v = new THREE.Vector3();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < p.count; i++) pts.push(v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m).clone());
  let minY = Infinity;
  let maxY = -Infinity;
  for (const q of pts) {
    minY = Math.min(minY, q.y);
    maxY = Math.max(maxY, q.y);
  }
  for (let i = 0; i + 2 < pts.length; i += 3) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const c = pts[i + 2]!;
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const q of [a, b, c]) {
      const t = maxY > minY ? (q.y - minY) / (maxY - minY) : 0;
      acc.set("aSway", swayBase + (swayTop - swayBase) * t, ph);
      // a touch darker underneath
      const k = 0.88 + 0.12 * t;
      acc.vert(q.x, q.y, q.z, n.x, n.y, n.z, col.r * k, col.g * k, col.b * k, 0, 0);
    }
  }
}

const xf = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0): THREE.Matrix4 =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));

/** Emit one tree (the flat style has a single LOD; `detail` is ignored). */
export function emitTree(acc: Acc, t: TreeSpec, detail: boolean): void {
  void detail;
  const { x, y, z, h } = t;
  const ph = t.seed * 40;
  const rr = Math.max(1.0, Math.min(t.r, h * 0.55));
  const crown = new THREE.Color(PAL.trees[Math.floor(hash01(Math.floor(t.seed * 1e6), 1) * PAL.trees.length)] ?? PAL.trees[0]);
  const trunk = new THREE.Color(PAL.trunk);
  const spin = t.seed * 6.28;
  acc.set("aChunk", t.chunk);
  switch (t.sp) {
    case "palm":
    case "washingtonia": {
      const H = Math.max(5, h);
      const tw = t.sp === "palm" ? 0.32 : 0.22;
      emitGeo(acc, TRUNK, xf(x, y + H * 0.45, z, tw, H * 0.9, tw), trunk, 0, 0.1, ph);
      const top = y + H * 0.9;
      const n = 7;
      for (let k = 0; k < n; k++) {
        const a = spin + (k / n) * Math.PI * 2;
        // a flat, drooping leaf blade: a stretched, flattened octahedron
        const L = t.sp === "palm" ? 2.6 : 1.8;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x + Math.cos(a) * L * 0.55, top - 0.25, z + Math.sin(a) * L * 0.55),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, -0.35, "YXZ")),
          new THREE.Vector3(L * 0.6, 0.08, 0.32),
        );
        emitGeo(acc, OCT, m, crown, 0.6, 1, ph + k);
      }
      return;
    }
    case "poplar":
    case "cypress": {
      const w = t.sp === "cypress" ? Math.min(1.1, rr * 0.4) : Math.min(2.2, rr * 0.55);
      emitGeo(acc, TRUNK, xf(x, y + h * 0.12, z, 0.18, h * 0.25, 0.18), trunk, 0, 0, ph);
      emitGeo(acc, OCT, xf(x, y + h * 0.58, z, w, h * 0.44, w, spin), crown, 0.2, 1, ph);
      return;
    }
    case "reeds":
    case "shrub": {
      emitGeo(acc, ICO, xf(x, y + h * 0.4, z, rr * 0.9, h * 0.45, rr * 0.9, spin), crown.clone().multiplyScalar(0.92), 0.1, 0.5, ph);
      return;
    }
    case "pine": {
      emitGeo(acc, TRUNK, xf(x, y + h * 0.36, z, 0.25, h * 0.72, 0.25), trunk, 0, 0.1, ph);
      emitGeo(acc, ICO, xf(x, y + h * 0.84, z, rr * 1.05, h * 0.14, rr * 1.05, spin), crown.clone().multiplyScalar(0.9), 0.4, 1, ph);
      return;
    }
    case "orange": {
      const H = Math.min(h, 6);
      emitGeo(acc, TRUNK, xf(x, y + H * 0.18, z, 0.12, H * 0.36, 0.12), trunk, 0, 0, ph);
      emitGeo(acc, ICO, xf(x, y + H * 0.62, z, Math.min(rr, 2), H * 0.4, Math.min(rr, 2), spin), crown.clone().multiplyScalar(0.9), 0.2, 0.8, ph);
      return;
    }
    default: {
      // plane tree (and jacaranda, green too): trunk and a broad round crown
      const tH = h * 0.4;
      emitGeo(acc, TRUNK, xf(x, y + tH / 2, z, Math.min(0.35, 0.1 + h * 0.015), tH, Math.min(0.35, 0.1 + h * 0.015)), trunk, 0, 0.1, ph);
      emitGeo(acc, ICO, xf(x, y + tH + (h - tH) * 0.48, z, rr, (h - tH) * 0.55, rr, spin), crown, 0.3, 1, ph);
    }
  }
}
