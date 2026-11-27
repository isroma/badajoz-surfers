/**
 * Shared scenery kit: road, kerbs, pavements, street furniture, trees and buildings.
 * Every function writes into the segment's Builder so a whole segment merges into one mesh per
 * material. Segment space: x across (road centred), z from 0 to -40, y up (road surface at 0).
 */
import * as THREE from "three";
import { ROAD_HALF_WIDTH, SEGMENT_LENGTH } from "../../contracts";
import { Builder, T, xf, type V3 } from "../geom";
import { CLOTH, COOLLIT, FAR, GLASS, GLOW, SKYGLOW, SOLID, WARMLIT } from "../materials";
import type { Rng } from "../rng";
import { facadeMat, lightPoolMat, surfaceMat, surfaceMatLit, type FacadeStyle, type SurfaceName } from "../text";

export const L = SEGMENT_LENGTH;
export const RW = ROAD_HALF_WIDTH;
export type Side = -1 | 1;

export interface Seg {
  b: Builder;
  r: Rng;
  index: number;
  count: number;
  lap: number;
  /** Dusk zone: windows and lamps glow. */
  night: boolean;
}

/** Textured horizontal quad covering [x0,x1] x [z1,z0] at height y; texture tile = `tile` metres. */
export function groundQuad(s: Seg, x0: number, x1: number, z0: number, z1: number, y: number, surface: SurfaceName, tint: THREE.ColorRepresentation, tile = 4): void {
  const w = Math.abs(x1 - x0);
  const d = Math.abs(z0 - z1);
  s.b.quad(
    xf((x0 + x1) / 2, y, (z0 + z1) / 2, w, d, 1, -Math.PI / 2, 0, 0),
    tint,
    surfaceMat(surface),
    // keep texture continuous across segments: v offset from the segment-local z
    [x0 / tile, -z0 / tile, x1 / tile, -z1 / tile],
  );
}

/** Vertical textured quad on a facade. ry: PI/2 faces +X, -PI/2 faces -X, 0 faces +Z. */
export function wallQuad(b: Builder, cx: number, cy: number, cz: number, w: number, h: number, ry: number, mat: THREE.Material, tint: THREE.ColorRepresentation, uRep: number, vRep: number): void {
  b.quad(xf(cx, cy, cz, w, h, 1, 0, ry, 0), tint, mat, [0, 0, uRep, vRep]);
}

export interface RoadOpts {
  surface?: SurfaceName;
  tint?: number;
  lineColor?: number;
  edgeLines?: boolean;
  /** Draw the kerbs (default true). */
  kerbs?: boolean;
  kerbColor?: number;
}

/** Road surface, dashed lane lines at x = +-1.3, optional edge lines, kerbs at |x| = 4.2. */
export function road(s: Seg, o: RoadOpts = {}): void {
  const b = s.b;
  const surface = o.surface ?? "asphalt";
  groundQuad(s, -RW, RW, 0, -L, 0, surface, o.tint ?? 0x6b7078, surface === "asphalt" ? 5 : 2.5);
  // body under the road (seen from bridges' sides)
  b.span(-RW, RW, -0.6, -0.02, 0, -L, 0x55585e, FAR);
  const line = o.lineColor ?? 0xf4f4ef;
  for (const x of [-1.3, 1.3]) {
    for (let k = 0; k < 8; k++) {
      const z = -k * 5 - 1.25;
      b.quad(xf(x, 0.015, z, 0.14, 2.5, 1, -Math.PI / 2, 0, 0), line, FAR);
    }
  }
  if (o.edgeLines !== false) {
    for (const x of [-RW + 0.3, RW - 0.3]) b.quad(xf(x, 0.015, -L / 2, 0.12, L, 1, -Math.PI / 2, 0, 0), line, FAR);
  }
  if (o.kerbs !== false) {
    for (const sx of [-1, 1]) b.span(sx * RW, sx * (RW + 0.25), -0.1, 0.16, 0, -L, o.kerbColor ?? 0xc9c6bf, FAR);
  }
}

/** Pavement from x0 to x1 (absolute values) on one side. */
export function pavement(s: Seg, side: Side, x0: number, x1: number, surface: SurfaceName = "paving", tint = 0xffffff, h = 0.15, z0 = 0, z1 = -L): void {
  groundQuad(s, side * x0, side * x1, z0, z1, h, surface, tint, 2);
  s.b.span(side * x0, side * x1, -0.4, h - 0.01, z0, z1, 0x9a968e, FAR);
}

/** Flat coloured ground (grass, earth, plaza) from x0 to x1 on one side. */
export function flat(s: Seg, side: Side, x0: number, x1: number, y: number, color: number, z0 = 0, z1 = -L): void {
  s.b.span(side * x0, side * x1, y - 0.3, y, z0, z1, color, FAR);
}

/** Soft warm pool of lamplight on the ground (night only): a flat additive decal. */
export function lightPool(s: Seg, x: number, z: number, r: number, y = 0.17, color = 0xffb35c): void {
  if (!s.night) return;
  s.b.quad(xf(x, y, z, r * 2, r * 2, 1, -Math.PI / 2, 0, 0), color, lightPoolMat());
}

// ---------------------------------------------------------------------------
// Street furniture
// ---------------------------------------------------------------------------

export function lampModern(s: Seg, side: Side, x: number, z: number, h = 8): void {
  const b = s.b;
  const px = side * x;
  b.cyl(px, 0, z, 0.09, h, 0x7d848c, 6, SOLID, 0.06);
  b.cyl(px, 0, z, 0.16, 0.5, 0x5c636b, 6, SOLID);
  // arm reaching over the pavement/road edge (above 4 m)
  const tip = px - side * 1.6;
  b.beam([px, h - 0.1, z], [tip, h + 0.15, z], 0.07, 0x7d848c, SOLID);
  b.box(tip, h + 0.05, z, 0.7, 0.14, 0.3, 0x5c636b, SOLID);
  b.box(tip, h - 0.04, z, 0.55, 0.05, 0.22, s.night ? 0xfff0c0 : 0xf2f2ea, s.night ? GLOW : SOLID);
  lightPool(s, px - side * 0.9, z, 3.2, 0.17);
}

/** Classic black cast-iron lamp (old town, promenades, Puente de Palmas). */
export function lampClassic(s: Seg, side: Side, x: number, z: number, h = 4.2, base = 0): void {
  const b = s.b;
  const px = side * x;
  b.cyl(px, base, z, 0.18, 0.6, 0x1f2326, 8, SOLID, 0.12);
  b.cyl(px, base + 0.6, z, 0.07, h - 1.2, 0x1f2326, 6, SOLID, 0.05);
  b.cyl(px, base + h - 0.6, z, 0.12, 0.08, 0x1f2326, 6, SOLID);
  b.add(T.frustum(1.6, 6), xf(px, base + h - 0.3, z, 0.14, 0.5, 0.14), s.night ? 0xffe2a0 : 0xfff8e6, s.night ? GLOW : SOLID);
  b.cone(px, base + h - 0.05, z, 0.28, 0.25, 0x1f2326, 6, SOLID);
  b.sphere(px, base + h + 0.24, z, 0.05, 0.06, 0.05, 0x1f2326, SOLID, 5, 3);
  lightPool(s, px, z, 2.4, base + 0.03);
}

/** Lamp bracket on a wall at x (wall face), arm points towards the road. */
export function lampWall(s: Seg, side: Side, x: number, z: number, y = 4.8): void {
  const b = s.b;
  const px = side * x;
  b.beam([px, y, z], [px - side * 0.8, y + 0.15, z], 0.05, 0x1f2326, SOLID);
  b.add(T.frustum(1.6, 6), xf(px - side * 0.8, y - 0.2, z, 0.12, 0.4, 0.12), s.night ? 0xffe2a0 : 0xfff8e6, s.night ? GLOW : SOLID);
  b.cone(px - side * 0.8, y + 0.02, z, 0.22, 0.2, 0x1f2326, 6, SOLID);
  lightPool(s, px - side * 0.6, z, 2.0, 0.17);
}

export function bench(s: Seg, side: Side, x: number, z: number, color = 0x7a5230, rotY = 0): void {
  const b = s.b;
  b.at(side * x, 0.15, z, rotY);
  b.box(0, 0.45, 0, 0.45, 0.06, 1.8, color, SOLID);
  b.box(side * 0.22, 0.75, 0, 0.06, 0.4, 1.8, color, SOLID);
  for (const dz of [-0.75, 0.75]) b.boxB(0, 0, dz, 0.4, 0.45, 0.08, 0x2a2d30, SOLID);
  b.pop();
}

export function bollards(s: Seg, side: Side, x: number, z0: number, z1: number, step = 2, color = 0x2a2d30): void {
  for (let z = z0; z > z1; z -= step) s.b.cyl(side * x, 0.15, z, 0.08, 0.85, color, 6, SOLID, 0.07);
}

export function busShelter(s: Seg, side: Side, x: number, z: number): void {
  const b = s.b;
  const px = side * x;
  b.span(px - 0.05 * side, px + side * 1.4, 2.4, 2.5, z + 2, z - 2, 0xe8eaed, SOLID);
  for (const dz of [-1.9, 1.9]) b.boxB(px + side * 1.3, 0.15, z + dz, 0.08, 2.3, 0.08, 0x9aa0a6, SOLID);
  b.box(px + side * 1.35, 1.35, z, 0.04, 1.9, 3.7, 0x9fc4d8, GLASS);
  b.box(px + side * 0.7, 0.6, z, 0.4, 0.06, 2.5, 0x9aa0a6, SOLID);
  b.boxB(px - side * 0.05, 0.15, z + 2.3, 0.08, 3.0, 0.08, 0x9aa0a6, SOLID);
  b.sign("parada", px - side * 0.05, 2.9, z + 2.3 + 0.05, 0.45);
}

export function bin(s: Seg, side: Side, x: number, z: number): void {
  s.b.cyl(side * x, 0.15, z, 0.22, 0.85, 0x2e6b3a, 8, SOLID);
  s.b.cyl(side * x, 1.0, z, 0.24, 0.06, 0x23542d, 8, SOLID);
}

export function planter(s: Seg, side: Side, x: number, z: number, color = 0xb5653a): void {
  s.b.boxB(side * x, 0.15, z, 0.8, 0.5, 0.8, color, SOLID);
  s.b.blob(side * x, 0.9, z, 0.5, 0.4, 0.5, 0x4f8a3a, SOLID);
}

/** Simple standing figure (pedestrian) for life on pavements / terraces. */
export function person(s: Seg, x: number, z: number, ry: number, seated = false, waving = false): void {
  const b = s.b;
  const r = s.r;
  const top = r.pick([0xd62828, 0x2a9d8f, 0xf4a261, 0x264653, 0xe9c46a, 0xffffff, 0x6a4c93, 0x3a86ff]);
  const legs = r.pick([0x283044, 0x4a4e69, 0x6b705c, 0x22223b, 0xc9ada7]);
  const skin = r.pick([0xe0a77c, 0xc68642, 0xf1c27d, 0x8d5524]);
  b.at(x, 0.15, z, ry);
  if (seated) {
    b.box(0, 0.5, 0.05, 0.36, 0.14, 0.4, legs, SOLID);
    b.boxB(0, 0, -0.12, 0.3, 0.45, 0.14, legs, SOLID);
    b.add(T.capsule(0.8, 2, 6), xf(0, 0.88, 0.15, 0.19, 0.24, 0.14), top, SOLID);
    b.sphere(0, 1.28, 0.15, 0.14, 0.15, 0.14, skin, SOLID, 6, 5);
  } else {
    b.boxB(-0.09, 0, 0, 0.13, 0.85, 0.15, legs, SOLID);
    b.boxB(0.09, 0, 0, 0.13, 0.85, 0.15, legs, SOLID);
    b.add(T.capsule(0.9, 2, 6), xf(0, 1.15, 0, 0.21, 0.26, 0.15), top, SOLID);
    b.boxB(-0.27, 0.75, 0, 0.09, 0.6, 0.1, top, SOLID);
    if (waving) {
      b.add(T.box, xf(0.36, 1.62, 0, 0.09, 0.62, 0.1, 0, 0, -0.35), top, SOLID);
      b.sphere(0.47, 1.95, 0, 0.06, 0.07, 0.05, skin, SOLID, 5, 3);
    } else b.boxB(0.27, 0.75, 0, 0.09, 0.6, 0.1, top, SOLID);
    b.sphere(0, 1.62, 0, 0.14, 0.16, 0.14, skin, SOLID, 6, 5);
    b.add(T.dome(6, 3), xf(0, 1.66, 0.01, 0.15, 0.12, 0.15), r.pick([0x2b2420, 0x6b4423, 0xd8c3a5, 0x111111]), SOLID);
  }
  b.pop();
}

/** Bar terrace set on a pavement: table, chairs, parasol (scenery only, not an obstacle). */
export function terraceSet(s: Seg, x: number, z: number, parasolColor: number, people = true): void {
  const b = s.b;
  const y = 0.15;
  b.cyl(x, y, z, 0.04, 0.74, 0x8a8f96, 6, SOLID);
  b.cyl(x, y + 0.74, z, 0.4, 0.03, 0x9aa0a6, 10, SOLID);
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const cx = x + Math.cos(a) * 0.7;
    const cz = z + Math.sin(a) * 0.7;
    b.boxB(cx, y + 0.42, cz, 0.4, 0.05, 0.4, 0xb0b5ba, SOLID);
    b.boxB(cx, y, cz, 0.36, 0.42, 0.36, 0x8a8f96, SOLID);
    if (people && s.r.chance(0.4)) person(s, cx, cz, -a + Math.PI / 2, true);
  }
  // beer glasses
  b.cyl(x + 0.1, y + 0.77, z, 0.035, 0.13, 0xf2b01e, 6, SOLID);
  b.cyl(x - 0.12, y + 0.77, z + 0.08, 0.035, 0.13, 0xf2b01e, 6, SOLID);
  // parasol
  b.cyl(x, y, z, 0.03, 2.4, 0xdddddd, 6, SOLID);
  b.add(T.cone(8), xf(x, y + 2.45, z, 1.4, 0.5, 1.4), parasolColor, CLOTH);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    b.box(x + Math.cos(a) * 1.3, y + 2.15, z + Math.sin(a) * 1.3, 0.25, 0.12, 0.25, parasolColor, SOLID, -a);
  }
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

export function planeTree(s: Seg, x: number, z: number, sc = 1, y = 0.15): void {
  const b = s.b;
  const r = s.r;
  b.cyl(x, y, z, 0.22 * sc, 3.6 * sc, 0xb9a98f, 6, SOLID, 0.17 * sc);
  b.cyl(x, y + 3.3 * sc, z, 0.15 * sc, 1.6 * sc, 0xa89880, 5, SOLID);
  const greens = [0x5f9e3a, 0x6fae44, 0x4f8a33, 0x7cb850];
  for (let k = 0; k < 4; k++) {
    const a = r.range(0, Math.PI * 2);
    const d = r.range(0.4, 1.3) * sc;
    const cx = x + Math.cos(a) * d;
    let cy = y + (5.2 + r.range(-0.4, 0.9)) * sc;
    const sx = (1.8 + r.range(0, 0.6)) * sc;
    const sy = 1.4 * sc;
    // keep the canopy above the 4 m clearance wherever it overhangs the road
    if (Math.abs(cx) - sx < RW + 0.3 && cy - sy < 4.3) cy = 4.3 + sy;
    b.blob(cx, cy, z + Math.sin(a) * d, sx, sy, (1.8 + r.range(0, 0.6)) * sc, r.pick(greens), SOLID, r.range(0, 3));
  }
  b.add(T.box, xf(x, y + 0.01, z, 1.2, 0.02, 1.2), 0x5a4632, FAR); // tree pit
}

export function orangeTree(s: Seg, x: number, z: number, y = 0.15): void {
  const b = s.b;
  b.cyl(x, y, z, 0.1, 1.6, 0x7a6450, 5, SOLID);
  b.add(T.ico1, xf(x, y + 2.5, z, 1.15, 1.05, 1.15, 0, s.r.range(0, 3), 0), 0x3f7f2f, SOLID);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + s.r.range(0, 0.5);
    b.box(x + Math.cos(a) * 1.0, y + 2.3 + s.r.range(-0.4, 0.5), z + Math.sin(a) * 1.0, 0.13, 0.13, 0.13, 0xff8c1a, SOLID);
  }
}

export function palm(s: Seg, x: number, z: number, h = 9, y = 0.15): void {
  const b = s.b;
  const r = s.r;
  const lean = r.range(-0.08, 0.08);
  const segs = 6;
  for (let k = 0; k < segs; k++) {
    const y0 = y + (k * h) / segs;
    b.cyl(x + lean * y0, y0, z, 0.3 - k * 0.02, h / segs + 0.05, k % 2 ? 0x9b7b52 : 0x8a6a45, 7, SOLID);
  }
  const tx = x + lean * (y + h);
  const ty = y + h;
  b.sphere(tx, ty, z, 0.45, 0.4, 0.45, 0x6b5a33, SOLID, 6, 4);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + r.range(0, 0.3);
    const len = 3.6;
    const ex = tx + Math.cos(a) * len;
    const ez = z + Math.sin(a) * len;
    const mid: V3 = [tx + Math.cos(a) * len * 0.5, ty + 0.9, z + Math.sin(a) * len * 0.5];
    const px = -Math.sin(a) * 0.55;
    const pz = Math.cos(a) * 0.55;
    const col = k % 2 ? 0x4e8f3a : 0x5fa046;
    b.tri([tx, ty, z], [mid[0] + px, mid[1], mid[2] + pz], [mid[0] - px, mid[1], mid[2] - pz], col, CLOTH);
    b.tri([mid[0] + px, mid[1], mid[2] + pz], [ex, ty - 1.3, ez], [mid[0] - px, mid[1], mid[2] - pz], col, CLOTH);
  }
}

export function cypress(s: Seg, x: number, z: number, h = 9, y = 0): void {
  s.b.cyl(x, y, z, 0.15, 0.6, 0x5a4632, 5, SOLID);
  s.b.add(T.ico, xf(x, y + h * 0.5 + 0.3, z, h * 0.12, h * 0.5, h * 0.12), 0x2f5a2a, SOLID);
  s.b.add(T.ico, xf(x, y + h * 0.42, z, h * 0.14, h * 0.32, h * 0.14, 0, 0.6, 0), 0x335f2d, SOLID);
}

/** Stone (umbrella) pine. */
export function pine(s: Seg, x: number, z: number, sc = 1, y = 0, mat: THREE.Material = SOLID): void {
  const b = s.b;
  b.beam([x, y, z], [x + 0.6 * sc, y + 6.5 * sc, z + 0.3 * sc], 0.35 * sc, 0x8a6a4a, mat, 6);
  b.add(T.ico, xf(x + 0.6 * sc, y + 7.3 * sc, z + 0.3 * sc, 3.6 * sc, 1.2 * sc, 3.2 * sc, 0, s.r.range(0, 3), 0), 0x3f6b2f, mat);
  b.add(T.ico, xf(x + 1.6 * sc, y + 6.8 * sc, z - 0.6 * sc, 2.2 * sc, 0.9 * sc, 2.0 * sc), 0x4a7a36, mat);
}

export function shrub(s: Seg, x: number, z: number, sc = 1, y = 0, color = 0x5a8f3a): void {
  s.b.blob(x, y + 0.4 * sc, z, 0.9 * sc, 0.6 * sc, 0.9 * sc, color, FAR, s.r.range(0, 3));
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export interface BuildingOpts {
  side: Side;
  /** Distance of the facade from the road centre. */
  x: number;
  /** Start (nearer, larger z) and end z of the frontage. */
  z0: number;
  z1: number;
  depth: number;
  floors: number;
  floorH?: number;
  groundH?: number;
  color: number;
  style: FacadeStyle;
  roof?: "flat" | "tile";
  /** Shop signs for the ground floor (atlas names); empty = plain ground floor. */
  shops?: string[];
  awningColors?: number[];
  balconies?: number;
  /** Window glass shown on the +Z end wall too. */
  endWindows?: boolean;
  /** Use non-shadow-casting material (far buildings). */
  far?: boolean;
  trim?: number;
}

export const darken = (c: number, k: number): number => new THREE.Color(c).multiplyScalar(k).getHex();

/** A sloped slab between edge (xa, ya) and edge (xb, yb), spanning z0..z1 (z0 > z1). */
export function slab(b: Builder, xa: number, ya: number, xb: number, yb: number, z0: number, z1: number, thick: number, color: THREE.ColorRepresentation, mat: THREE.Material = SOLID): void {
  const [x0, y0, x1, y1] = xa < xb ? [xa, ya, xb, yb] : [xb, yb, xa, ya];
  b.hexa([
    [x0, y0, z0], [x1, y1, z0], [x1, y1, z1], [x0, y0, z1],
    [x0, y0 + thick, z0], [x1, y1 + thick, z0], [x1, y1 + thick, z1], [x0, y0 + thick, z1],
  ], color, mat, false);
}

export function building(s: Seg, o: BuildingOpts): void {
  const b = s.b;
  const fh = o.floorH ?? 3.1;
  const gh = o.groundH ?? 3.6;
  const H = gh + o.floors * fh;
  const sd = o.side;
  const xf0 = sd * o.x;
  const xb = sd * (o.x + o.depth);
  const width = o.z0 - o.z1;
  const zc = (o.z0 + o.z1) / 2;
  const mat = o.far ? FAR : SOLID;
  const trim = o.trim ?? 0xf4efe6;
  // main mass
  b.span(xf0, xb, 0, H, o.z0, o.z1, o.color, mat);
  const ry = sd > 0 ? -Math.PI / 2 : Math.PI / 2;
  const fm = facadeMat(o.style, s.night);
  const faceX = xf0 - sd * 0.03;
  // upper floors: window texture (4 bays x 4 floors per tile, bay 3.2 m)
  wallQuad(b, faceX, gh + (o.floors * fh) / 2, zc, width, o.floors * fh, ry, fm, o.color, width / 12.8, o.floors / 4);
  if (o.endWindows !== false) {
    const d = o.depth;
    wallQuad(b, (xf0 + xb) / 2, gh + (o.floors * fh) / 2, o.z0 + 0.03, d, o.floors * fh, 0, fm, o.color, d / 12.8, o.floors / 4);
  }
  // cornice + roof
  b.span(xf0 - sd * 0.25, xb, H, H + 0.25, o.z0 + 0.15, o.z1 - 0.15, trim, mat);
  if (o.roof === "tile") {
    const ridge = Math.min(2.2, o.depth * 0.3);
    const x0 = xf0 - sd * 0.4;
    const xm = (xf0 + xb) / 2;
    b.hexa([
      [Math.min(x0, xb), H + 0.25, o.z0 + 0.3], [Math.max(x0, xb), H + 0.25, o.z0 + 0.3], [Math.max(x0, xb), H + 0.25, o.z1 - 0.3], [Math.min(x0, xb), H + 0.25, o.z1 - 0.3],
      [xm - 0.05, H + 0.25 + ridge, o.z0 + 0.3], [xm + 0.05, H + 0.25 + ridge, o.z0 + 0.3], [xm + 0.05, H + 0.25 + ridge, o.z1 - 0.3], [xm - 0.05, H + 0.25 + ridge, o.z1 - 0.3],
    ], 0xb5532f, mat);
  } else {
    // parapet + rooftop clutter (water tanks, AC, antennas)
    b.span(xf0, xf0 + sd * 0.2, H + 0.25, H + 1.0, o.z0, o.z1, o.color, mat);
    const n = Math.max(1, Math.floor(width / 9));
    for (let k = 0; k < n; k++) {
      const z = o.z0 - (k + 0.5) * (width / n);
      b.boxB(xf0 + sd * (2 + s.r.range(0, o.depth - 4)), H + 0.25, z, 1.6, 1.2, 1.4, 0xd8d8d2, mat);
      if (s.r.chance(0.6)) b.boxB(xf0 + sd * 1.5, H + 0.25, z + 1.5, 0.05, 2.2, 0.05, 0x777777, mat);
    }
  }
  // ground floor: plinth band + shops
  b.span(xf0 - sd * 0.05, xf0 + sd * 0.1, 0, 0.6, o.z0, o.z1, darken(o.color, 0.7), mat);
  b.span(xf0 - sd * 0.12, xf0, gh - 0.3, gh, o.z0, o.z1, trim, mat);
  const shops = o.shops ?? [];
  if (shops.length > 0) {
    const sw = width / shops.length;
    shops.forEach((name, i) => {
      const za = o.z0 - i * sw;
      const zm = za - sw / 2;
      // glazed shop front with a door
      const old = o.style === "viejo" || o.style === "noble";
      const glazeTop = gh - 0.6;
      b.span(xf0 - sd * 0.06, xf0 + sd * 0.02, 0.5, glazeTop, za - 0.4, za - sw + 0.4, old ? 0x7a6a58 : 0x5f6a72, GLASS);
      // half-lowered roller shutter (persiana metálica) or a wooden shop front
      const shutter = old ? 0x4f6b4a : 0xb7babd;
      const sh = (glazeTop - 0.5) * (old ? 0.22 : 0.38);
      b.span(xf0 - sd * 0.09, xf0, glazeTop - sh, glazeTop, za - 0.35, za - sw + 0.35, shutter, mat);
      for (let q = 1; q < 4; q++) b.span(xf0 - sd * 0.1, xf0 - sd * 0.08, glazeTop - (sh * q) / 4 - 0.02, glazeTop - (sh * q) / 4, za - 0.35, za - sw + 0.35, darken(shutter, 0.8), mat);
      // window mullions and a stall-riser
      for (const t of [0.25, 0.75]) b.span(xf0 - sd * 0.1, xf0, 0.5, glazeTop, za - sw * t + 0.05, za - sw * t - 0.05, old ? 0x3e2a1c : 0x8a8f96, mat);
      b.span(xf0 - sd * 0.1, xf0, 0.15, 0.55, za - 0.4, za - sw + 0.4, old ? 0x3e2a1c : 0x8a8f96, mat);
      b.span(xf0 - sd * 0.08, xf0, 0.15, 2.4, zm - 0.5, zm + 0.5, 0x5a3a24, mat);
      if (s.night) b.span(xf0 - sd * 0.065, xf0 - sd * 0.05, 0.6, gh - 0.8, za - 0.6, zm + 0.7, 0xffd48a, GLOW);
      if (name) b.sign(name, xf0 - sd * 0.14, gh - 0.75, zm, 0.6, ry);
      const ac = o.awningColors;
      if (ac && ac.length > 0) {
        const col = ac[(i + s.index) % ac.length] ?? 0x2e7d32;
        const out = Math.min(1.4, o.x - RW - 0.5);
        if (out > 0.4) slab(b, xf0, gh - 0.75, xf0 - sd * out, gh - 1.2, za - 0.5, za - sw + 0.5, 0.06, col, CLOTH);
      }
    });
  } else {
    // residential ground floor: portal + small windows
    b.span(xf0 - sd * 0.06, xf0, 0.15, 2.6, zc + 0.8, zc - 0.8, 0x4a3426, mat);
  }
  // balconies (slab + railing) on some bays
  const bal = o.balconies ?? 0;
  if (bal > 0) {
    const bays = Math.floor(width / 3.2);
    const off = (width - bays * 3.2) / 2;
    for (let f = 0; f < o.floors; f++) {
      for (let k = 0; k < bays; k++) {
        if (!s.r.chance(bal)) continue;
        const z = o.z0 - off - (k + 0.5) * 3.2;
        const y = gh + f * fh + 0.05;
        const out = 0.7;
        b.span(xf0, xf0 - sd * out, y, y + 0.12, z + 1.1, z - 1.1, trim, mat);
        if (s.r.chance(0.5)) {
          // solid parapet in the wall colour
          b.span(xf0 - sd * (out - 0.06), xf0 - sd * out, y + 0.12, y + 0.95, z + 1.1, z - 1.1, darken(o.color, 0.92), mat);
          b.span(xf0 - sd * (out - 0.08), xf0 - sd * (out + 0.02), y + 0.95, y + 1.02, z + 1.12, z - 1.12, trim, mat);
        } else {
          // wrought iron railing: top rail, bottom rail and a few bars
          b.span(xf0 - sd * (out - 0.05), xf0 - sd * out, y + 0.95, y + 1.02, z + 1.1, z - 1.1, 0x2a2d30, mat);
          b.span(xf0 - sd * (out - 0.05), xf0 - sd * out, y + 0.2, y + 0.25, z + 1.1, z - 1.1, 0x2a2d30, mat);
          for (let q = 0; q < 3; q++) b.span(xf0 - sd * (out - 0.04), xf0 - sd * out, y + 0.12, y + 0.97, z + 0.75 - q * 0.75, z + 0.7 - q * 0.75, 0x2a2d30, mat);
        }
        if (s.r.chance(0.3)) b.box(xf0 - sd * 0.45, y + 0.35, z + 0.7, 0.35, 0.3, 0.3, 0x5a8f3a, mat);
      }
    }
  }
  // AC units hung on the facade, a very local touch
  const acs = Math.floor(width / 7);
  for (let k = 0; k < acs; k++) {
    if (!s.r.chance(0.5)) continue;
    const f = s.r.int(0, o.floors - 1);
    b.box(xf0 - sd * 0.2, gh + f * fh + 0.6, o.z0 - s.r.range(1, width - 1), 0.4, 0.5, 0.75, 0xe9e9e4, mat);
  }
}

/** Simple distant building mass with a window facade (no details), for skylines. */
export function farBlock(s: Seg, x: number, z: number, w: number, d: number, h: number, color: number, style: FacadeStyle = "piso"): void {
  const b = s.b;
  b.span(x - w / 2, x + w / 2, -0.5, h, z + d / 2, z - d / 2, color, FAR);
  const fm = facadeMat(style, s.night);
  // facades facing the road (+-X) and +Z
  const ry = x > 0 ? -Math.PI / 2 : Math.PI / 2;
  const fx = x > 0 ? x - w / 2 - 0.05 : x + w / 2 + 0.05;
  wallQuad(b, fx, h / 2 + 0.5, z, d, h - 1, ry, fm, color, d / 12.8, (h - 1) / 12.4);
  wallQuad(b, x, h / 2 + 0.5, z + d / 2 + 0.05, w, h - 1, 0, fm, color, w / 12.8, (h - 1) / 12.4);
  b.span(x - w / 2 - 0.2, x + w / 2 + 0.2, h, h + 0.4, z + d / 2 + 0.2, z - d / 2 - 0.2, 0xe8e2d6, FAR);
}

/** Overhead bunting (strings of little flags) across the street, always above `minY`. */
export function bunting(s: Seg, z: number, half: number, minY = 4.6, colors = [0xd62828, 0xffd23f, 0x2a9d8f, 0xffffff, 0x3a86ff]): void {
  const b = s.b;
  const n = Math.round(half * 2 / 0.55);
  const topY = minY + 1.0;
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const x0 = -half + t0 * half * 2;
    const x1 = -half + t1 * half * 2;
    const y0 = topY - Math.sin(t0 * Math.PI) * 0.7;
    const y1 = topY - Math.sin(t1 * Math.PI) * 0.7;
    b.tri([x0, y0, z], [x1, y1, z], [(x0 + x1) / 2, (y0 + y1) / 2 - 0.4, z], colors[i % colors.length] ?? 0xffffff, CLOTH);
  }
  b.beam([-half, topY, z], [0, topY - 0.7, z], 0.02, 0x444444, FAR);
  b.beam([0, topY - 0.7, z], [half, topY, z], 0.02, 0x444444, FAR);
}

// ---------------------------------------------------------------------------
// Zone handover: every zone starts with the same intersection
// ---------------------------------------------------------------------------

/** Length of the junction strip at the start of each zone's first segment. */
export const JUNCTION = 10;

/**
 * A crossroads at z 0..-JUNCTION: corner pavements, a cross street glimpsed on both sides,
 * a zebra crossing on the main road, pedestrian traffic lights and the zone's street sign.
 * The zone's own scenery is clipped away from this strip (see Builder.clip).
 */
export function junction(s: Seg, plaque: string, surface: SurfaceName = "paving", paveTint = 0xe6e0d4): void {
  const b = s.b;
  const r = s.r;
  const zA = -1.6;
  const zB = -8.4;
  for (const side of [-1, 1] as Side[]) {
    // corner pavement along the main road
    pavement(s, side, RW + 0.25, 7, surface, paveTint, 0.15, 0, -JUNCTION);
    // cross street: asphalt, pavements either side, centre dashes
    groundQuad(s, side * 7, side * 95, zA, zB, 0.03, "asphalt", 0x6b7078, 5);
    s.b.span(side * 7, side * 95, -0.4, 0.02, zA, zB, 0x55585e, FAR);
    for (const [z0, z1] of [[0, zA], [zB, -JUNCTION]] as const) {
      groundQuad(s, side * 7, side * 95, z0, z1, 0.15, surface, paveTint, 2);
      s.b.span(side * 7, side * 95, -0.4, 0.14, z0, z1, 0x9a968e, FAR);
    }
    for (let x = 9; x < 90; x += 5) b.quad(xf(side * x, 0.045, (zA + zB) / 2, 2.5, 0.14, 1, -Math.PI / 2, 0, 0), 0xf4f4ef, FAR);
    // zebra across the cross street mouth
    for (let k = 0; k < 6; k++) b.quad(xf(side * 8.2, 0.05, zA - 0.5 - k * 1.1, 1.8, 0.55, 1, -Math.PI / 2, 0, 0), 0xf4f4ef, FAR);
    flat(s, side, 95, 170, 0.1, 0xcfc4ae, 0, -JUNCTION);
    // the cross street ends at a facade far away; a few trees line it
    b.span(side * 100, side * 118, 0, r.range(12, 22), 2, -12, r.pick([0xece3d2, 0xe2c9a3, 0xf2efe8]), FAR);
    for (const x of [16, 34, 52]) {
      for (const z of [-0.8, -9.2]) {
        b.cyl(side * (x + r.range(-2, 2)), 0.15, z, 0.14, 2.6, 0x7a6450, 5, FAR);
        b.blob(side * x, 3.6, z, 1.6, 1.3, 1.6, r.pick([0x5f9e3a, 0x4f8a33, 0x6fae44]), FAR, r.range(0, 3));
      }
    }
    // pedestrian lights at the corners, facing the oncoming runner and back
    for (const [z, ry] of [[-9.4, 0], [-0.6, Math.PI]] as const) {
      const x = side * 4.75;
      b.cyl(x, 0.15, z, 0.07, 3.1, 0x2a2d30, 6, SOLID);
      b.add(T.box, xf(x, 2.75, z, 0.32, 0.75, 0.22, 0, ry, 0), 0x2a2d30, SOLID);
      const face = ry === 0 ? 0.12 : -0.12;
      b.box(x, 2.95, z + face, 0.18, 0.18, 0.02, 0x3a1010, SOLID);
      b.box(x, 2.6, z + face, 0.18, 0.18, 0.02, 0x33ff77, GLOW);
    }
    // a pedestrian waiting at the kerb
    if (r.chance(0.7)) person(s, side * r.range(5.2, 6.5), -r.range(1, 9), side > 0 ? -Math.PI / 2 : Math.PI / 2, false, r.chance(0.3));
  }
  // zebra crossing on the main road
  for (let k = 0; k < 8; k++) b.quad(xf(-3.6 + k * 1.03, 0.017, -5, 0.55, 3.4, 1, -Math.PI / 2, 0, 0), 0xf4f4ef, FAR);
  b.quad(xf(0, 0.017, -2.9, RW * 2 - 0.4, 0.3, 1, -Math.PI / 2, 0, 0), 0xf4f4ef, FAR); // stop line before the zebra
  // street name sign for the zone, readable when approaching (kept outside the road)
  b.cyl(4.85, 0.15, -9.8, 0.06, 3.3, 0x555555, 6, SOLID);
  const w = 0.5 * 5;
  b.sign(plaque, 4.85 + w / 2 - 0.1, 3.05, -9.75, 0.5, 0, w);
  b.sign(plaque, 4.85 + w / 2 - 0.1, 3.05, -9.85, 0.5, Math.PI, w);
}

/** White stork on its big twig nest (an Extremadura signature on towers and chimneys). */
export function storkNest(b: Builder, x: number, y: number, z: number, ry = 0, two = false): void {
  b.cyl(x, y, z, 0.95, 0.45, 0x6b5136, 7, SOLID, 1.1);
  b.cyl(x, y + 0.4, z, 0.75, 0.08, 0x8a6a45, 7, SOLID);
  const bird = (dx: number, dz: number, a: number, standing: boolean): void => {
    b.at(x + dx, y + 0.45, z + dz, ry + a);
    if (standing) {
      b.beam([-0.06, 0, 0], [-0.06, 0.45, 0], 0.03, 0xd8432c, SOLID);
      b.beam([0.06, 0, 0], [0.06, 0.45, 0], 0.03, 0xd8432c, SOLID);
    }
    const h = standing ? 0.45 : 0.05;
    b.sphere(0, h + 0.22, 0, 0.2, 0.2, 0.36, 0xf6f6f2, SOLID, 7, 5);
    b.add(T.box, xf(0, h + 0.24, 0.12, 0.42, 0.12, 0.34), 0x1a1a1a, SOLID); // black flight feathers
    b.beam([0, h + 0.3, -0.25], [0, h + 0.68, -0.34], 0.07, 0xf6f6f2, SOLID);
    b.sphere(0, h + 0.7, -0.36, 0.08, 0.08, 0.1, 0xf6f6f2, SOLID, 5, 4);
    b.beam([0, h + 0.68, -0.42], [0, h + 0.62, -0.68], 0.035, 0xe8532c, SOLID);
    b.pop();
  };
  bird(0.1, 0.05, 0.3, true);
  if (two) bird(-0.3, -0.2, 2.2, false);
}

/** A small flock of pigeons pecking on a plaza. */
export function pigeons(s: Seg, x: number, z: number, n = 6, y = 0.15): void {
  for (let k = 0; k < n; k++) {
    const px = x + s.r.range(-1.6, 1.6);
    const pz = z + s.r.range(-1.6, 1.6);
    const a = s.r.range(0, Math.PI * 2);
    s.b.at(px, y, pz, a);
    s.b.sphere(0, 0.1, 0, 0.08, 0.08, 0.13, s.r.pick([0x8a8f99, 0x9aa0a8, 0x6f747d]), SOLID, 5, 4);
    s.b.sphere(0, 0.2, -0.1, 0.05, 0.05, 0.05, 0x5c626b, SOLID, 4, 3);
    s.b.pop();
  }
}

/** Fairground lantern strings (farolillos) across the street at night, above `y` (>= 4.7). */
export function farolillos(s: Seg, z: number, half: number, y = 5.0): void {
  if (!s.night) return;
  const b = s.b;
  const cols = [0xff3b3b, 0xffffff, 0x3bd16f, 0xffd23f];
  const n = Math.round((half * 2) / 0.7);
  const sag = 0.6;
  const top = y + sag + 0.3;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = -half + t * half * 2;
    const yy = top - Math.sin(t * Math.PI) * sag;
    b.sphere(x, yy - 0.22, z, 0.17, 0.2, 0.17, cols[i % cols.length] ?? 0xffffff, GLOW, 6, 4);
  }
  b.beam([-half, top, z], [0, top - sag, z], 0.02, 0x333333, FAR);
  b.beam([0, top - sag, z], [half, top, z], 0.02, 0x333333, FAR);
}

/** A firework burst frozen in the night sky (unfogged so it reads through the haze). */
export function firework(s: Seg, x: number, y: number, z: number, r: number, color: number): void {
  if (!s.night) return;
  const b = s.b;
  const n = 26;
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n;
    const phi = Math.acos(1 - 2 * u);
    const th = k * 2.399963;
    const dx = Math.sin(phi) * Math.cos(th);
    const dy = Math.cos(phi);
    const dz = Math.sin(phi) * Math.sin(th) * 0.3;
    b.beam([x + dx * r * 0.35, y + dy * r * 0.35, z + dz * r * 0.35], [x + dx * r, y + dy * r - 0.15 * r * (1 - dy), z + dz * r], r * 0.035, color, SKYGLOW);
    b.sphere(x + dx * r, y + dy * r - 0.15 * r * (1 - dy), z + dz * r, r * 0.06, r * 0.06, r * 0.06, 0xffffff, SKYGLOW, 4, 3);
  }
}

let warmMap: Map<THREE.Material, THREE.Material> | null = null;
let coolMap: Map<THREE.Material, THREE.Material> | null = null;

/** At night, build `fn` floodlit: warm for stone and rammed earth, cool for white concrete. */
export function floodlit(s: Seg, tone: "warm" | "cool", fn: () => void): void {
  if (!s.night) {
    fn();
    return;
  }
  if (!warmMap) warmMap = new Map<THREE.Material, THREE.Material>([[SOLID, WARMLIT], [FAR, WARMLIT], [surfaceMat("tapial"), surfaceMatLit("tapial")]]);
  if (!coolMap) coolMap = new Map<THREE.Material, THREE.Material>([[SOLID, COOLLIT], [FAR, COOLLIT]]);
  s.b.with(tone === "warm" ? warmMap : coolMap, fn);
}
