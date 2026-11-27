/**
 * Alcazaba landmarks: rammed-earth (tapial) walls with square towers and merlons, the octagonal
 * Torre de Espantaperros with its little brick lantern, and the Puerta de Palmas gate.
 */
import * as THREE from "three";
import { T, xf, type Builder } from "../geom";
import { FAR, SOLID } from "../materials";
import { surfaceMat } from "../text";
import { merlons } from "./casco";

export const TAPIAL = 0xd6a46a;
const TAPIAL_DARK = 0xb98652;
const GRANITE = 0xd9ccb2;
const GRANITE_DARK = 0xbdae90;

/** Wall face texture quad (tapial courses). */
function tapialFace(b: Builder, cx: number, cy: number, cz: number, w: number, h: number, ry: number, tint = 0xffffff): void {
  b.quad(xf(cx, cy, cz, w, h, 1, 0, ry, 0), tint, surfaceMat("tapial"), [0, 0, w / 6, h / 6]);
}

/**
 * A run of wall along z at x = wx (facing -X towards the road when side = 1), from z0 to z1,
 * standing on ground at y = base, `h` high, with merlons and an optional square tower.
 */
export function alcazabaWall(b: Builder, side: 1 | -1, wx: number, z0: number, z1: number, base: number, h: number, tower?: number, mat: THREE.Material = SOLID): void {
  const thick = 2.4;
  const x0 = side * wx;
  const x1 = side * (wx + thick);
  b.span(x0, x1, base - 2, base + h, z0, z1, TAPIAL, mat);
  tapialFace(b, x0 - side * 0.03, base + h / 2, (z0 + z1) / 2, z0 - z1, h, side > 0 ? -Math.PI / 2 : Math.PI / 2);
  merlons(b, x0 + side * 0.4, z0, x0 + side * 0.4, z1, base + h, 0.9, TAPIAL_DARK, 0.8);
  if (tower !== undefined) {
    const tw = 7;
    const tx0 = side * (wx - 4);
    const th = h + 4;
    b.span(tx0, x1, base - 2, base + th, tower + tw / 2, tower - tw / 2, TAPIAL, mat);
    tapialFace(b, tx0 - side * 0.03, base + th / 2, tower, tw, th, side > 0 ? -Math.PI / 2 : Math.PI / 2);
    tapialFace(b, (tx0 + x1) / 2, base + th / 2, tower + tw / 2 + 0.03, Math.abs(x1 - tx0), th, 0);
    merlons(b, tx0 + side * 0.4, tower + tw / 2, tx0 + side * 0.4, tower - tw / 2, base + th, 0.9, TAPIAL_DARK, 0.8);
    merlons(b, tx0, tower + tw / 2 - 0.4, x1, tower + tw / 2 - 0.4, base + th, 0.9, TAPIAL_DARK, 0.8);
    // arrow slit
    b.span(tx0 - side * 0.05, tx0, base + th - 5, base + th - 3, tower + 0.25, tower - 0.25, 0x3a2a1c, mat);
  }
}

/** Torre de Espantaperros: octagonal albarrana tower (~30 m) with a small square brick lantern. */
export function espantaperros(b: Builder, x: number, z: number, base: number): void {
  const R = 5.2;
  const H = 25;
  // octagonal shaft (slight batter at the base)
  b.add(T.frustum(0.85, 8), xf(x, base - 3, z, R + 1.0, 10, R + 1.0, 0, Math.PI / 8, 0), TAPIAL_DARK, SOLID);
  b.add(T.cyl(8), xf(x, base + 4 + (H - 4) / 2, z, R, H - 4, R, 0, Math.PI / 8, 0), 0xcf8f5a, SOLID);
  // octagonal faces with the rammed-earth courses
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const fx = x + Math.sin(a) * R * Math.cos(Math.PI / 8) * 1.005;
    const fz = z + Math.cos(a) * R * Math.cos(Math.PI / 8) * 1.005;
    tapialFace(b, fx, base + 4 + (H - 4) / 2, fz, 2 * R * Math.sin(Math.PI / 8), H - 4, a, 0xf0c8a0);
    // pointed-arch windows
    if (k % 2 === 0) {
      b.add(T.box, xf(x + Math.sin(a) * (R * 0.93 + 0.02), base + H - 6, z + Math.cos(a) * (R * 0.93 + 0.02), 0.9, 2.2, 0.1, 0, a, 0), 0x3a2a1c, SOLID);
    }
  }
  // corbelled parapet with merlons
  b.add(T.cyl(8), xf(x, base + H + 0.4, z, R + 0.5, 0.8, R + 0.5, 0, Math.PI / 8, 0), TAPIAL_DARK, SOLID);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    b.box(x + Math.sin(a) * (R + 0.2), base + H + 1.4, z + Math.cos(a) * (R + 0.2), 0.9, 1.3, 0.6, 0xc98a58, SOLID, a);
  }
  // the little square brick lantern (Mudejar "templete") on top
  const ly = base + H + 0.8;
  b.span(x - 1.8, x + 1.8, ly, ly + 4.2, z + 1.8, z - 1.8, 0xb8653e, SOLID);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    b.add(T.box, xf(x + Math.sin(a) * 1.82, ly + 2.4, z + Math.cos(a) * 1.82, 1.4, 2.4, 0.08, 0, a, 0), 0x3a2418, SOLID);
  }
  b.span(x - 2.1, x + 2.1, ly + 4.2, ly + 4.6, z + 2.1, z - 2.1, 0xd08a5e, SOLID);
  b.add(T.cone(4), xf(x, ly + 4.6 + 1.2, z, 2.7, 2.4, 2.7, 0, Math.PI / 4, 0), 0xb5532f, SOLID);
  b.cyl(x, ly + 7, z, 0.06, 1.4, 0x333333, 4, SOLID);
  b.sphere(x, ly + 8.5, z, 0.18, 0.18, 0.18, 0xd9b44a, SOLID, 5, 3);
}

/**
 * Puerta de Palmas straddling the road at z: two round crenellated drum towers flanking a
 * renaissance arch. Clear opening: |x| < 4.7 up to 5.6 m, semicircular above (apex ~10.3 m).
 */
export function puertaPalmas(b: Builder, z: number): void {
  const half = 4.7;
  const spring = 5.6;
  const depth = 7;
  const top = 15;
  const zf = z + depth / 2;
  const zb = z - depth / 2;
  // jambs / pier walls on both sides of the opening (outside the road)
  for (const sx of [-1, 1]) {
    b.span(sx * half, sx * 10, 0, top, zf, zb, GRANITE, SOLID);
    // drum tower
    const tx = sx * 9.3;
    b.add(T.cyl(14), xf(tx, top / 2 + 0.5, z, 4.0, top + 1, 4.0), GRANITE, SOLID);
    b.add(T.frustum(0.85, 14), xf(tx, 0.8, z, 4.6, 1.6, 4.6), GRANITE_DARK, SOLID);
    b.add(T.cyl(14), xf(tx, top + 1.1, z, 4.5, 1.2, 4.5), GRANITE_DARK, SOLID);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      b.box(tx + Math.sin(a) * 4.15, top + 2.3, z + Math.cos(a) * 4.15, 1.0, 1.3, 0.7, GRANITE, SOLID, a);
    }
    // arrow slits and string course
    for (const y of [5, 9.5]) b.add(T.box, xf(tx - sx * 1.2, y, z + 3.8, 0.35, 1.6, 0.15), 0x3a2a1c, SOLID);
    b.add(T.cyl(14), xf(tx, 7.5, z, 4.08, 0.3, 4.08), GRANITE_DARK, SOLID);
  }
  // the arch: voussoirs around a semicircle + spandrels up to the parapet
  const n = 14;
  const rIn = half;
  const rOut = half + 1.2;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI;
    const a1 = ((k + 1) / n) * Math.PI;
    const am = (a0 + a1) / 2;
    const xm = Math.cos(am) * (rIn + rOut) / 2;
    const ym = spring + Math.sin(am) * (rIn + rOut) / 2;
    const segLen = 2 * rOut * Math.sin((a1 - a0) / 2) + 0.05;
    b.add(T.box, xf(xm, ym, z, segLen, rOut - rIn, depth + 0.3, 0, 0, am - Math.PI / 2), k % 2 ? GRANITE_DARK : 0xe6dbc4, SOLID);
    // spandrel slice above this voussoir
    const xa = Math.cos(a1) * rOut;
    const xb = Math.cos(a0) * rOut;
    const yLow = spring + Math.min(Math.sin(a0), Math.sin(a1)) * rOut;
    b.span(Math.min(xa, xb), Math.max(xa, xb), yLow, top, zf, zb, GRANITE, SOLID);
  }
  // impost blocks at the springing line
  for (const sx of [-1, 1]) b.span(sx * (half - 0.3), sx * (half + 0.6), spring - 0.4, spring, zf + 0.2, zb - 0.2, GRANITE_DARK, SOLID);
  // pilasters, entablature and the coat of arms on the face the runner sees
  for (const sx of [-1, 1]) b.span(sx * (half + 1.4), sx * (half + 2.2), 0, 12.2, zf + 0.35, zf, 0xe6dbc4, SOLID);
  b.span(-half - 2.4, half + 2.4, 12.2, 13.0, zf + 0.45, zf, 0xe6dbc4, SOLID);
  b.sign("escudo", 0, 13.9 - 0.2, zf + 0.06, 2.0);
  b.sign("escudo", 0, 13.9 - 0.2, zb - 0.06, 2.0, Math.PI);
  // crenellated parapet over the gate
  merlons(b, -half - 1.5, zf - 0.4, half + 1.5, zf - 0.4, top, 0.9, GRANITE_DARK, 0.7);
  merlons(b, -half - 1.5, zb + 0.4, half + 1.5, zb + 0.4, top, 0.9, GRANITE_DARK, 0.7);
  // walls continuing away from the towers
  for (const sx of [-1, 1]) {
    b.span(sx * 13, sx * 40, 0, 8, z + 1.5, z - 1.5, TAPIAL, FAR);
    tapialFace(b, sx * 26.5, 4, z + 1.53, 27, 8, 0);
    merlons(b, sx * 13, z + 1.1, sx * 40, z + 1.1, 8, 0.9, TAPIAL_DARK, 0.8);
  }
}

/** A big distant tawny hill crowned by walls (the Alcazaba seen from the river). */
export function alcazabaHill(b: Builder, x: number, z: number, w: number): void {
  b.add(T.ico, xf(x, -4, z, w * 0.5, 34, w * 0.35), 0xa78f5a, FAR);
  b.add(T.ico, xf(x + w * 0.15, 4, z - 10, w * 0.35, 30, w * 0.25), 0x9a8752, FAR);
  const wallY = 24;
  b.span(x - w * 0.3, x + w * 0.3, wallY - 6, wallY + 6, z + 2, z - 2, TAPIAL, FAR);
  for (let k = 0; k < 6; k++) {
    const tx = x - w * 0.3 + (k / 5) * w * 0.6;
    b.span(tx - 2.5, tx + 2.5, wallY - 6, wallY + 9, z + 3, z - 3, new THREE.Color(TAPIAL).multiplyScalar(0.95).getHex(), FAR);
  }
  // Espantaperros silhouette
  b.add(T.cyl(8), xf(x + w * 0.1, wallY + 8, z + 6, 3.5, 22, 3.5), 0xcf8f5a, FAR);
  b.span(x + w * 0.1 - 1.3, x + w * 0.1 + 1.3, wallY + 19, wallY + 22, z + 7.3, z + 4.7, 0xb8653e, FAR);
  b.add(T.cone(4), xf(x + w * 0.1, wallY + 23, z + 6, 1.9, 2, 1.9, 0, Math.PI / 4, 0), 0xb5532f, FAR);
  // cypresses on the slopes
  for (let k = 0; k < 8; k++) {
    const cx = x - w * 0.35 + (k / 7) * w * 0.7;
    b.add(T.ico, xf(cx, 12 + (k % 3) * 2, z + 8 + (k % 2) * 4, 1.4, 6, 1.4), 0x2f5a2a, FAR);
  }
}
