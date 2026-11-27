/**
 * Zone 3, San Francisco (16 segments):
 *   0..9    Paseo de San Francisco: the park on the left (azulejo benches, fountains, big trees),
 *           elegant early-1900s buildings with cafés and terraces on the right
 *           2  café kiosk with terrace in the park
 *           4  the music kiosk (templete) — the park's icon
 *           7  round fountain
 *   10..15  Avenida de Europa: taller modern buildings and shops on both sides
 */
import * as THREE from "three";
import { T, xf } from "../geom";
import { CLOTH, FAR, SOLID, WATER } from "../materials";
import { surfaceMat } from "../text";
import {
  L, RW, building, farBlock, flat, lampClassic, lampModern, palm, pavement, person, planeTree, road, shrub, terraceSet, type Seg, type Side,
} from "./common";

const NOBLE = [0xf1e5c8, 0xf6f0e2, 0xf0d9a8, 0xe9d1b5, 0xf3e8d0];
const MODERN = [0xe9e6df, 0xd9d4ca, 0xc9b79a, 0xf2efe8, 0xb5653a];
const IRON_GREEN = 0x2f5d3a;

/** Templete de música: octagonal bandstand with iron columns and a zinc roof. */
function templete(s: Seg, x: number, z: number): void {
  const b = s.b;
  const stone = 0xeadfc6;
  b.cyl(x, 0, z, 6.2, 0.45, 0xd9cdb2, 8, SOLID);
  b.cyl(x, 0.45, z, 5.6, 1.3, stone, 8, SOLID);
  b.cyl(x, 1.75, z, 5.8, 0.18, 0xf7f3ea, 8, SOLID);
  // steps towards the road
  for (let k = 0; k < 4; k++) b.boxB(x + 5.6 + k * 0.4, 0.45 + 1.3 - (k + 1) * 0.33, z, 0.4, (k + 1) * 0.33 - 0.0, 2.4, stone, SOLID);
  const n = 8;
  const rc = 4.9;
  const colH = 4.6;
  const top = 1.93 + colH;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + Math.PI / 8;
    const cx = x + Math.cos(a) * rc;
    const cz = z + Math.sin(a) * rc;
    b.cyl(cx, 1.93, cz, 0.13, colH, IRON_GREEN, 6, SOLID);
    b.cyl(cx, 1.93, cz, 0.22, 0.3, IRON_GREEN, 6, SOLID);
    b.cyl(cx, top - 0.35, cz, 0.2, 0.35, 0xd9b44a, 6, SOLID);
    // ironwork frieze: a shallow V between neighbouring columns
    const a2 = ((k + 1) / n) * Math.PI * 2 + Math.PI / 8;
    const nx = x + Math.cos(a2) * rc;
    const nz = z + Math.sin(a2) * rc;
    const mx = x + Math.cos((a + a2) / 2) * rc;
    const mz = z + Math.sin((a + a2) / 2) * rc;
    b.beam([cx, top - 0.1, cz], [mx, top - 0.9, mz], 0.08, 0xf2f2ea, SOLID);
    b.beam([mx, top - 0.9, mz], [nx, top - 0.1, nz], 0.08, 0xf2f2ea, SOLID);
    b.beam([cx, top - 0.05, cz], [nx, top - 0.05, nz], 0.12, IRON_GREEN, SOLID);
    // low railing between columns
    b.beam([cx, 2.9, cz], [nx, 2.9, nz], 0.06, IRON_GREEN, SOLID);
  }
  // roof: eave ring, octagonal zinc cone with a curved look (two stages), lantern and finial
  b.cyl(x, top, z, 6.0, 0.4, 0xf2f2ea, 8, SOLID);
  b.add(T.frustum(0.55, 8), xf(x, top + 0.4 + 0.9, z, 6.1, 1.8, 6.1), 0x6f9a86, SOLID);
  b.add(T.frustum(0.35, 8), xf(x, top + 2.2 + 0.6, z, 3.35, 1.2, 3.35), 0x7fae96, SOLID);
  b.cyl(x, top + 3.4, z, 0.9, 1.1, 0xf2f2ea, 8, SOLID);
  b.cone(x, top + 4.5, z, 1.2, 1.3, 0x6f9a86, 8, SOLID);
  b.cyl(x, top + 5.8, z, 0.06, 1.2, 0xd9b44a, 4, SOLID);
  b.sphere(x, top + 7.05, z, 0.22, 0.22, 0.22, 0xd9b44a, SOLID, 6, 4);
  // musicians' chairs and a music stand silhouette
  for (let k = 0; k < 5; k++) b.boxB(x - 2 + k, 1.93, z - 1 + (k % 2), 0.4, 0.5, 0.4, 0x7a5230, SOLID);
}

/** Azulejo-tiled bench along the path, facing the road (+X when on the left). */
function azulejoBench(s: Seg, x: number, z: number, len = 4): void {
  const b = s.b;
  b.boxB(x, 0.12, z, 0.6, 0.45, len, 0xf2ece0, SOLID);
  b.boxB(x - 0.3, 0.12, z, 0.18, 1.15, len + 0.2, 0xf2ece0, SOLID);
  const m = surfaceMat("azulejo");
  // tiled backrest and seat front, facing +X
  b.quad(xf(x - 0.2, 0.95, z, len, 0.5, 1, 0, Math.PI / 2, 0), 0xffffff, m, [0, 0, len / 1.2, 0.5 / 1.2]);
  b.quad(xf(x + 0.31, 0.36, z, len, 0.36, 1, 0, Math.PI / 2, 0), 0xffffff, m, [0, 0, len / 1.2, 0.36 / 1.2]);
  b.boxB(x - 0.3, 1.27, z, 0.3, 0.08, len + 0.3, 0xe7d9bd, SOLID);
}

function smallFountain(s: Seg, x: number, z: number, r = 3.2): void {
  const b = s.b;
  b.cyl(x, 0.12, z, r, 0.6, 0xe2d6bd, 12, SOLID);
  b.cyl(x, 0.6, z, r - 0.25, 0.1, 0x5aa0aa, 12, WATER);
  b.cyl(x, 0.12, z, 0.45, 2.0, 0xe2d6bd, 8, SOLID);
  b.cyl(x, 2.1, z, 1.2, 0.2, 0xe2d6bd, 10, SOLID);
  b.cone(x, 2.3, z, 0.25, 1.4, 0xdff4ff, 6, WATER);
}

function park(s: Seg): void {
  const b = s.b;
  const r = s.r;
  const i = s.index;
  const side: Side = -1;
  pavement(s, side, RW + 0.25, 7, "paving", 0xece4d2);
  // albero (yellow sand) paths and lawns with low box hedges
  flat(s, side, 7, 13, 0.12, 0xe2c27e);
  flat(s, side, 13, 60, 0.1, 0x8fb35a);
  b.span(-13, -60, 0.1, 0.13, -17, -23, 0xe2c27e, FAR);
  b.span(-7.1, -7.4, 0.12, 0.7, 0, -L, 0x4f7f35, SOLID);
  // tiled benches and big shady trees along the main path
  for (const z of [-6, -26]) azulejoBench(s, -8.2, z, 4);
  const clearing = i === 4;
  for (const z of clearing ? [-2, -38] : [-2, -14, -32]) planeTree(s, -10.5, z, r.range(1.1, 1.35), 0.12);
  for (let k = 0; k < 3; k++) planeTree(s, -r.range(clearing ? 32 : 18, 50), -r.range(2, 38), r.range(1.2, 1.6), 0.1);
  if (i % 2 === 0 && !clearing) palm(s, -r.range(15, 25), -r.range(5, 35), r.range(10, 13), 0.1);
  if (clearing) {
    // flower beds around the bandstand
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      b.blob(-18 + Math.cos(a) * 9, 0.35, -20 + Math.sin(a) * 9, 1.2, 0.4, 1.2, k % 2 ? 0xd6336c : 0xf4a261, SOLID);
    }
    palm(s, -30, -8, 12, 0.1);
    palm(s, -30, -32, 12, 0.1);
  }
  for (let k = 0; k < 4; k++) shrub(s, -r.range(14, 45), -r.range(2, 38), r.range(0.8, 1.4), 0.1, 0x4f8a3a);
  lampClassic(s, side, 7.6, -16, 4.2, 0.12);
  lampClassic(s, side, 7.6, -36, 4.2, 0.12);
  for (let k = 0; k < 3; k++) person(s, -r.range(8.5, 12), -r.range(2, 38), r.chance(0.5) ? 0 : Math.PI);
  if (i === 2) {
    // café kiosk with its terrace in the park
    const kx = -18;
    const kz = -20;
    b.cyl(kx, 0.1, kz, 2.4, 3.0, 0xf2ece0, 8, SOLID);
    b.cyl(kx, 0.9, kz, 2.45, 1.4, 0x30404f, 8, SOLID);
    b.cone(kx, 3.1, kz, 3.2, 1.4, IRON_GREEN, 8, SOLID);
    b.sign("cafe-paseo", kx + 2.5, 2.7, kz, 0.5, Math.PI / 2, 2.0);
    for (const [dx, dz] of [[5, -4], [5, 3], [8, -1], [8, 5]] as const) terraceSet(s, kx + dx, kz + dz, 0xf4f1ea);
  }
  if (i === 4) templete(s, -18, -20);
  if (i === 7) smallFountain(s, -20, -20, 4);
  if (i === 5 || i === 8) {
    // newspaper kiosk on the pavement edge
    b.boxB(-11, 0.12, -30, 2.2, 2.4, 2.2, IRON_GREEN, SOLID);
    b.boxB(-11, 2.52, -30, 2.8, 0.25, 2.8, 0x23452c, SOLID);
    b.sign("kiosco", -9.88, 2.1, -30, 0.4, Math.PI / 2);
  }
  // far side of the park: city blocks through the trees
  farBlock(s, -72, -20, 18, 36, r.range(18, 26), r.pick(NOBLE));
}

function nobleSide(s: Seg): void {
  const r = s.r;
  const side: Side = 1;
  pavement(s, side, RW + 0.25, 10.5, "paving", 0xece4d2);
  const cafes = ["cafe-paseo", "confiteria", "heladeria", "cafeteria", "restaurante", "libreria", "optica", "meson"];
  let z = -0.5;
  while (z > -L + 8) {
    const len = Math.min(z + L - 0.5, r.range(12, 19));
    const z1 = z - len;
    building(s, {
      side, x: 10.5, z0: z, z1, depth: 16, floors: r.int(3, 4), floorH: 3.6, groundH: 4.4, color: r.pick(NOBLE), style: "noble",
      shops: [r.pick(cafes), r.pick(cafes)], awningColors: [0x7a1f2b, 0x1f4f3a, 0xd9c7a0], balconies: 0.95, trim: 0xfbf7ee, roof: r.chance(0.5) ? "tile" : "flat",
    });
    z = z1 - 0.4;
  }
  for (let k = 0; k < 3; k++) terraceSet(s, 7.5 + (k % 2) * 1.6, -5 - k * 12 - r.range(0, 3), r.pick([0xf4f1ea, 0x7a1f2b, 0x1f4f3a]));
  lampClassic(s, side, 5.0, -6, 4.2, 0.15);
  lampClassic(s, side, 5.0, -26, 4.2, 0.15);
  farBlock(s, 40, -20, 16, 36, r.range(18, 26), r.pick(NOBLE));
  flat(s, side, 10.5, 140, 0.1, 0xcfc4ae);
}

function europa(s: Seg): void {
  const b = s.b;
  const r = s.r;
  for (const side of [-1, 1] as Side[]) {
    pavement(s, side, RW + 0.25, 11, "paving", 0xe7e2d8);
    let z = -0.5;
    while (z > -L + 8) {
      const len = Math.min(z + L - 0.5, r.range(15, 21));
      const z1 = z - len;
      const office = r.chance(0.4);
      building(s, {
        side, x: 11, z0: z, z1, depth: 16, floors: r.int(8, 12), color: office ? 0xdfe3e6 : r.pick(MODERN), style: office ? "oficina" : "piso",
        shops: ["zapateria", "optica", r.pick(["bar-bellota", "cafeteria", "farmacia", "libreria"])], awningColors: [0x1f5f8b, 0x333333], balconies: office ? 0 : 0.5,
      });
      z = z1 - r.range(0.8, 2);
    }
    for (let k = 0; k < 4; k++) planeTree(s, side * 6.8, -4 - k * 10 - (side > 0 ? 5 : 0), r.range(0.9, 1.05));
    lampModern(s, side, 4.9, side > 0 ? -15 : -35, 9);
    farBlock(s, side * r.range(42, 50), -20, 18, 34, r.range(32, 46), r.pick(MODERN), r.chance(0.5) ? "oficina" : "piso");
    flat(s, side, 11, 140, 0.1, 0xcfc4ae);
    for (let k = 0; k < 2; k++) person(s, side * r.range(8, 10.5), -r.range(2, 38), r.chance(0.5) ? 0 : Math.PI);
  }
  if (s.index === 10) {
    b.boxB(5.0, 0.15, -3, 0.08, 3.0, 0.08, 0x555555, SOLID);
    b.sign("c-europa", 5.0, 2.9, -3, 0.5, -Math.PI / 2);
  }
}

export function buildSanFrancisco(s: Seg): void {
  const b = s.b;
  road(s, { tint: 0x666b72 });
  if (s.index < 10) {
    park(s);
    nobleSide(s);
    if (s.index === 0) {
      b.boxB(5.0, 0.15, -3, 0.08, 3.0, 0.08, 0x555555, SOLID);
      b.sign("c-sanfrancisco", 5.0, 2.9, -3, 0.5, -Math.PI / 2);
    }
    // festive paper lanterns strung high over the promenade
    if (s.index % 3 === 1) {
      for (let k = 0; k < 9; k++) {
        const x = -8 + k * 2;
        const y = 6.6 - Math.sin((k / 8) * Math.PI) * 0.8;
        b.add(T.sphere(6, 4), xf(x, y, -20, 0.25, 0.32, 0.25), new THREE.Color().setHSL(k / 9, 0.8, 0.6), CLOTH);
      }
      b.beam([-10.5, 7.0, -20], [0, 5.8, -20], 0.02, 0x444444, FAR);
      b.beam([0, 5.8, -20], [10.5, 7.0, -20], 0.02, 0x444444, FAR);
    }
  } else {
    europa(s);
  }
}
