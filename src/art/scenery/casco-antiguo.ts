/**
 * Zone 4, Casco Antiguo (18 segments), narrow cobbled streets with whitewashed and pastel houses:
 *   0..2    old-town streets with bunting
 *   3..5    Plaza de España: the Cathedral of San Juan Bautista (tower at segment 4, left) and
 *           the white Ayuntamiento opposite (segment 4, right); orange trees and a statue
 *   6       narrow street
 *   7..11   calle San Juan: the tightest street, balconies full of geraniums, wall lamps
 *   12..13  climbing streets
 *   14..16  Plaza Alta: the arcaded red-and-white painted houses (both sides; the square opens
 *           on the left with the long arcade facing the road)
 *   17      narrow street out towards the Alcazaba
 */
import { ayuntamiento, catedral, plazaAltaRow } from "../landmarks/casco";
import { xf } from "../geom";
import { FAR, SOLID, WATER } from "../materials";
import {
  L, RW, bench, building, bunting, farolillos, firework, floodlit, pigeons, storkNest, terraceSet, darken, flat, groundQuad, lampClassic, lampWall, orangeTree, pavement, person, planeTree, road, type Seg, type Side,
} from "./common";

const HOUSES = [0xf7f4ee, 0xf7f4ee, 0xf6f1e4, 0xf3dc95, 0xeec07a, 0xf0b9a6, 0xc9dde6, 0xf7f4ee];
const ZOCALO = [0xd6a24a, 0x8a8f96, 0x2f5f8a, 0xb5653a];
const BARS = ["meson", "tapas", "confiteria", "ultramarinos", "estanco", "bar-bellota", "restaurante", ""];

/** A row of old-town houses with facades at |x| = fx. */
function houses(s: Seg, side: Side, fx: number, z0: number, z1: number): void {
  const r = s.r;
  const b = s.b;
  let z = z0;
  while (z > z1 + 4) {
    const len = Math.min(z - z1, r.range(6.5, 11));
    const color = r.pick(HOUSES);
    const zEnd = z - len;
    const shop = r.pick(BARS);
    building(s, {
      side, x: fx, z0: z, z1: zEnd, depth: r.range(9, 12), floors: r.int(1, 3), floorH: 3.0, groundH: 3.3,
      color, style: "viejo", roof: "tile", shops: shop ? [shop] : [], awningColors: r.chance(0.4) ? [r.pick([0x2e7d32, 0xb22222, 0xe9c46a])] : [],
      balconies: 0.75, trim: 0xf7f4ee, endWindows: false,
    });
    // painted plinth ("zócalo") and flowerpots on the balconies
    const zc = r.pick(ZOCALO);
    b.span(side * (fx - 0.06), side * fx, 0.15, 1.0, z, zEnd, zc, SOLID);
    for (let k = 0; k < 3; k++) {
      // geraniums on a window sill
      const pz = z - r.range(1, len - 1);
      const py = 3.3 + 3.0 * r.int(0, 1) + 0.75;
      b.box(side * (fx - 0.12), py - 0.05, pz, 0.24, 0.06, 0.9, 0xf2ede2, SOLID);
      b.box(side * (fx - 0.14), py + 0.08, pz, 0.2, 0.18, 0.7, 0xc65a3a, SOLID);
      b.blob(side * (fx - 0.14), py + 0.28, pz, 0.18, 0.14, 0.4, r.pick([0xd62828, 0xe63980, 0xf2f2f2]), SOLID);
    }
    // whitewash between houses: a slightly protruding pilaster
    b.span(side * (fx - 0.12), side * fx, 0, 3.3 + 3.0 * 2, zEnd + 0.15, zEnd - 0.15, darken(color, 0.95), SOLID);
    z = zEnd;
  }
}

function streetLife(s: Seg, side: Side, fx: number): void {
  const r = s.r;
  for (let k = 0; k < 2; k++) {
    if (r.chance(0.6)) person(s, side * r.range(4.6, fx - 0.3), -r.range(2, 38), r.chance(0.5) ? 0 : Math.PI);
  }
}

function narrowStreet(s: Seg, fx = 5.6, tight = false): void {
  const b = s.b;
  for (const side of [-1, 1] as Side[]) {
    pavement(s, side, RW + 0.25, fx, "flagstone", 0xe8dfcc, 0.15);
    houses(s, side, fx, 0, -L);
    lampWall(s, side, fx, side > 0 ? -12 : -32, 4.9);
    streetLife(s, side, fx);
    // roofs and walls beyond (filler so gaps never show sky)
    b.span(side * (fx + 10), side * (fx + 40), 0, tight ? 12 : 9, 0, -L, side > 0 ? 0xeee8dc : 0xf2ead8, FAR);
    b.span(side * (fx + 10), side * (fx + 40), tight ? 12 : 9, (tight ? 12 : 9) + 0.3, 0, -L, 0xb5532f, FAR);
  }
  bunting(s, -10, fx, 4.7);
  farolillos(s, -20, fx, 5.0);
  if (s.index % 2 === 0) bunting(s, -30, fx, 4.9, [0xffffff, 0xd62828, 0xffd23f]);
}

function plazaEspana(s: Seg): void {
  const b = s.b;
  const r = s.r;
  const i = s.index;
  // paved square on both sides
  groundQuad(s, -60, -RW - 0.25, 0, -L, 0.15, "flagstone", 0xe9e0cd, 2.5);
  groundQuad(s, RW + 0.25, 13, 0, -L, 0.15, "flagstone", 0xe9e0cd, 2.5);
  b.span(-60, -RW - 0.25, -0.4, 0.14, 0, -L, 0x9a968e, FAR);
  b.span(RW + 0.25, 13, -0.4, 0.14, 0, -L, 0x9a968e, FAR);
  if (i === 3) {
    houses(s, 1, 13, 0, -L);
    // houses closing the square on the left
    houses(s, -1, 24, -2, -38);
    for (const z of [-6, -14, -31, -38]) orangeTree(s, -r.range(7, 10), z);
  }
  if (i === 4) {
    floodlit(s, "warm", () => catedral(b, -22, -12));
    firework(s, -60, 75, -70, 12, 0xffd23f);
    ayuntamiento(b, 13, -20, s.night);
    // statue of Luis de Morales on a plinth
    b.boxB(-9, 0.15, -30, 2.2, 2.2, 2.2, 0xd8cdb5, SOLID);
    b.boxB(-9, 2.35, -30, 1.4, 0.4, 1.4, 0xc9bda3, SOLID);
    b.boxB(-9, 2.75, -30, 0.7, 1.6, 0.6, 0x4f5a4f, SOLID);
    b.sphere(-9, 4.6, -30, 0.3, 0.32, 0.3, 0x4f5a4f, SOLID, 6, 4);
    b.sign("c-espana", -12.0, 3.0, -2, 0.45, Math.PI / 2);
    for (const z of [-4, -36]) orangeTree(s, -8, z);
  }
  if (i === 5) {
    houses(s, 1, 13, 0, -L);
    b.span(-60, -26, 0, 18, 0, -36, 0xcdb38a, SOLID);
    b.span(-60, -26, 18, 18.4, 0, -36, 0xe0cba4, SOLID);
    houses(s, -1, 26, -36, -L);
    for (let k = 0; k < 3; k++) orangeTree(s, -r.range(8, 20), -4 - k * 11);
  }
  for (const sx of [-1, 1] as Side[]) {
    lampClassic(s, sx, 5.0, sx > 0 ? -8 : -28, 4.2, 0.15);
    lampClassic(s, sx, 5.0, sx > 0 ? -28 : -8, 4.2, 0.15);
  }
  // granite banding in the paving
  for (let x = -6; x > -27; x -= 5) b.quad(xf(x, 0.157, -L / 2, 0.35, L, 1, -Math.PI / 2, 0, 0), 0xa49a88, FAR);
  for (let z = -5; z > -L; z -= 10) b.quad(xf(-15.5, 0.157, z, 21, 0.35, 1, -Math.PI / 2, 0, 0), 0xa49a88, FAR);
  // benches, pigeons and people
  for (const z of [-12, -26]) {
    bench(s, -1, 6.4, z, 0x6b4a2a, Math.PI);
    if (r.chance(0.7)) person(s, -6.5, z + 0.3, -Math.PI / 2, true);
  }
  pigeons(s, -12, -16 - r.range(0, 8), 7);
  for (let k = 0; k < 6; k++) person(s, (r.chance(0.6) ? -1 : 1) * r.range(5, 11), -r.range(2, 38), r.range(0, 6), false, r.chance(0.15));
  if (i === 3) {
    // small fountain in the square
    b.cyl(-15, 0.15, -22, 2.6, 0.55, 0xd8cdb5, 10, SOLID);
    b.cyl(-15, 0.6, -22, 2.35, 0.08, 0x5aa0aa, 10, WATER);
    b.cyl(-15, 0.15, -22, 0.35, 1.6, 0xd8cdb5, 8, SOLID);
    b.cyl(-15, 1.75, -22, 0.8, 0.15, 0xd8cdb5, 8, SOLID);
    b.cone(-15, 1.9, -22, 0.2, 1.0, 0xdff4ff, 6, WATER);
    terraceSet(s, 9, -10, 0x7a1f2b);
    terraceSet(s, 9, -28, 0xf4f1ea);
  }
  if (i === 4) {
    // white storks nesting on the cathedral tower and the town hall gable
    storkNest(b, -22 + 6, 34 + 3.6, -12 + 6, 0.6, true);
    storkNest(b, 14, 18.5, -20, 2.0);
  }
}

function plazaAlta(s: Seg): void {
  const b = s.b;
  const r = s.r;
  const i = s.index;
  // right side: arcaded houses along the road
  pavement(s, 1, RW + 0.25, 6.4, "flagstone", 0xe8dfcc, 0.15);
  plazaAltaRow(b, 1, 6.4, -1, -39, 10, 2);
  b.span(16.4, 50, 0, 10, 0, -L, 0xf2ead8, FAR);
  // left side: the square opens up, the long painted arcade faces the road across it
  groundQuad(s, -34, -RW - 0.25, 0, -L, 0.15, "flagstone", 0xe9dcc4, 2.5);
  b.span(-34, -RW - 0.25, -0.4, 0.14, 0, -L, 0x9a968e, FAR);
  plazaAltaRow(b, -1, -34, -1, -39, 10, 2);
  if (i === 14) {
    // corner house closing the square at the start, painted too
    plazaAltaRow(b, -1, -6.4, 0, -6, 27, 2);
    b.sign("c-alta", -6.38, 3.0, -3, 0.45, Math.PI / 2);
  }
  if (i === 16) plazaAltaRow(b, -1, -6.4, -33, -L, 27, 3);
  // square furniture: classic lamps, benches, a few orange trees and people
  for (const z of [-10, -30]) lampClassic(s, -1, 12, z, 4.2, 0.15);
  for (const z of [-5, -20, -35]) orangeTree(s, -24, z);
  for (let k = 0; k < 6; k++) person(s, -r.range(8, 30), -r.range(4, 36), r.range(0, 6), false, r.chance(0.15));
  pigeons(s, -18, -r.range(8, 30), 8);
  if (i === 15) storkNest(b, -39, 11.2, -20, 0.8, true);
  b.boxB(-17, 0.15, -20, 0.5, 0.45, 3, 0xd8cdb5, SOLID);
  lampWall(s, 1, 6.4, -20, 4.9);
  // festive bunting across the square entrance
  bunting(s, -2, 6.4, 5.0, [0xd62828, 0xffffff, 0xd62828, 0xffd23f]);
  farolillos(s, -14, 6.4, 5.2);
  farolillos(s, -28, 6.4, 5.2);
}

export function buildCascoAntiguo(s: Seg): void {
  const b = s.b;
  const i = s.index;
  road(s, { surface: "cobbles", tint: 0xb9b0a3, lineColor: 0xe9e4d8, edgeLines: false, kerbColor: 0xb7ad9c });
  if (i >= 3 && i <= 5) {
    plazaEspana(s);
  } else if (i >= 14 && i <= 16) {
    plazaAlta(s);
  } else {
    narrowStreet(s, i >= 7 && i <= 11 ? 5.4 : 5.8, i >= 7 && i <= 11);
    if (i === 7) b.sign("c-sanjuan", 5.37, 3.0, -2, 0.42, -Math.PI / 2);
    if (i === 2 || i === 12) planeTree(s, -9, -20, 0.8);
  }
  // distant roofscape on both sides: terracotta roofs and white walls
  for (const sx of [-1, 1]) flat(s, sx as Side, 50, 160, 0.1, 0xe3d6bd);
}
