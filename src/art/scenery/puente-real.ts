/**
 * Zone 1, Puente Real (12 segments):
 *  -4..-1  lead-in street behind the start (see lead-in.ts); "Bar El Puente" at -1
 *   0      crossroads, then the bridge approach with cafés and the riverside park
 *   1      riverside embankment, the deck begins; Torre de Caja Badajoz on the right
 *   2..10  the cable-stayed deck over the Guadiana; the white inverted-Y pylon at segment 6,
 *          stay cables on segments 3..9
 *   11     land again (right bank)
 */
import { pylon, stayCables, torreCaja } from "../landmarks/puente-real";
import { T, xf } from "../geom";
import { FAR, SOLID, WATER } from "../materials";
import { buildLeadIn } from "./lead-in";
import {
  L, RW, building, farBlock, flat, lampModern, palm, pavement, person, pine, planeTree, road, shrub, terraceSet, type Seg, type Side,
} from "./common";

const WATER_Y = -13;
const DECK_X = 9.3;
export const PYLON_SEG = 6;
/** Torre de Caja Badajoz, segment 1 local position. */
export const TOWER_X = 50;
export const TOWER_Z = -28;

/** River water + distant banks, islands, reeds and a skyline. */
export function river(s: Seg, waterY: number, bankX: number, skyline: "left" | "both" | "none" = "both"): void {
  const b = s.b;
  const r = s.r;
  b.span(-420, 420, waterY - 1, waterY, 0, -L, 0x4f8f98, WATER);
  // gentle highlights on the water
  for (let k = 0; k < 10; k++) {
    const x = r.range(-300, 300);
    if (Math.abs(x) < 15) continue;
    b.box(x, waterY + 0.02, -r.range(2, 38), r.range(6, 20), 0.02, 0.5, 0x9ccfd6, WATER);
  }
  for (const sx of [-1, 1] as const) {
    // far riverbank, reeds and trees
    b.span(sx * bankX, sx * 460, waterY - 1, waterY + 2.5, 0, -L, 0x8fae5a, FAR);
    b.span(sx * (bankX - 6), sx * bankX, waterY - 0.6, waterY + 1.2, 0, -L, 0xb7a77a, FAR);
    for (let k = 0; k < 5; k++) {
      const x = sx * (bankX + r.range(2, 40));
      const z = -r.range(1, 39);
      b.blob(x, waterY + 2.5 + 4, z, r.range(4, 7), r.range(3, 5), r.range(4, 7), r.pick([0x4f7f35, 0x5f8f3f, 0x3f6f2f]), FAR, r.range(0, 3));
    }
    for (let k = 0; k < 6; k++) {
      b.cone(sx * (bankX - r.range(0, 5)), waterY, -r.range(0, 40), r.range(0.8, 1.6), r.range(1.5, 3), 0x9aa356, 5, FAR);
    }
  }
  // kayaks and a rowing boat out on the Guadiana
  for (let k = 0; k < 2; k++) {
    if (!r.chance(0.55)) continue;
    const x = (r.chance(0.5) ? -1 : 1) * r.range(30, 120);
    const z = -r.range(4, 36);
    const a = r.range(-0.4, 0.4);
    b.at(x, waterY, z, a);
    if (k === 0) {
      b.add(T.sphere(8, 4), xf(0, 0.05, 0, 0.35, 0.22, 2.4), r.pick([0xff6b1a, 0xffd23f, 0xd62828, 0x2a9d8f]), FAR);
      b.sphere(0, 0.45, 0, 0.2, 0.32, 0.2, r.pick([0x264653, 0xe63946, 0x1d3557]), FAR, 5, 3);
      b.beam([-1.1, 0.5, 0.2], [1.1, 0.7, -0.2], 0.05, 0x333333, FAR);
    } else {
      b.add(T.sphere(8, 4), xf(0, 0.1, 0, 0.9, 0.4, 2.6), 0xf4f1ea, FAR);
      b.box(0, 0.32, 0, 1.6, 0.06, 4.2, 0x2a6f97, FAR);
      for (const dz of [-0.6, 0.7]) b.sphere(0, 0.75, dz, 0.22, 0.35, 0.22, r.pick([0xd62828, 0xffd23f, 0x264653]), FAR, 5, 3);
    }
    b.pop();
  }
  // the occasional green island in the river
  if (r.chance(0.5)) {
    const x = (r.chance(0.5) ? -1 : 1) * r.range(40, 110);
    const z = -r.range(8, 32);
    b.blob(x, waterY, z, r.range(10, 20), 1.6, r.range(5, 9), 0x93a85a, FAR);
    for (let k = 0; k < 3; k++) b.blob(x + r.range(-8, 8), waterY + 4, z + r.range(-3, 3), 3, 3.5, 3, 0x4f7f35, FAR, r.range(0, 3));
  }
  // skyline behind the banks
  if (skyline !== "none") {
    for (const sx of skyline === "both" ? ([-1, 1] as const) : ([-1] as const)) {
      for (let k = 0; k < 2; k++) {
        const x = sx * (bankX + r.range(55, 120));
        const h = r.range(12, 34);
        farBlock(s, x, -r.range(5, 35), r.range(14, 26), r.range(12, 20), h, r.pick([0xece3d2, 0xd9b48a, 0xf2efe8, 0xe2c9a3, 0xc98f6a]));
      }
    }
  }
}

function deck(s: Seg, pylonHere: boolean): void {
  const b = s.b;
  road(s, { tint: 0x686d75 });
  for (const sx of [-1, 1] as Side[]) {
    // pavement with a red cycle lane, white fascia, railing, deck slab
    pavement(s, sx, RW + 0.25, DECK_X - 0.4, "paving", 0xd9d3c8, 0.15);
    b.span(sx * (RW + 0.7), sx * (RW + 1.7), 0.155, 0.16, 0, -L, 0xa65a46, FAR);
    b.span(sx * (DECK_X - 0.4), sx * (DECK_X + 0.4), -2.2, 0.35, 0, -L, 0xf3f2ee, SOLID);
    b.span(sx * RW, sx * (DECK_X + 0.2), -2.4, -0.6, 0, -L, 0xd9d7cf, FAR);
    // railing: posts + two rails
    for (let z = -1; z > -L; z -= 2) b.boxB(sx * (DECK_X - 0.15), 0.35, z, 0.08, 0.95, 0.08, 0xffffff, SOLID);
    b.span(sx * (DECK_X - 0.2), sx * (DECK_X - 0.1), 1.25, 1.33, 0, -L, 0xffffff, SOLID);
    b.span(sx * (DECK_X - 0.18), sx * (DECK_X - 0.12), 0.8, 0.85, 0, -L, 0xffffff, SOLID);
    // tall white lamps every 20 m (staggered)
    for (const z of sx < 0 ? [-6, -26] : [-16, -36]) {
      if (pylonHere && Math.abs(z + 20) < 6) continue;
      lampModern(s, sx, DECK_X - 0.6, z, 9);
    }
    // people strolling or stopping to wave at the runner
    if (s.r.chance(0.6)) person(s, sx * s.r.range(5.2, 8.2), -s.r.range(3, 37), s.r.chance(0.5) ? 0 : Math.PI, false, s.r.chance(0.3));
    // pier under the deck
    b.span(sx * 3, sx * 6, WATER_Y - 1, -2.4, -18, -22, 0xd2d0c8, FAR);
  }
  b.span(-6, 6, -3.4, -2.4, -17, -23, 0xd2d0c8, FAR);
}

function landSide(s: Seg, side: Side, bar: boolean): void {
  const b = s.b;
  const r = s.r;
  if (bar) {
    // wide pavement with the bar terrace, the bar itself and its neighbours
    pavement(s, side, RW + 0.25, 12, "paving", 0xece6da);
    building(s, { side, x: 12, z0: -2, z1: -18, depth: 14, floors: 3, color: 0xf4efe6, style: "piso", shops: ["cafeteria", "heladeria"], awningColors: [0x1f5f8b], balconies: 0.6 });
    building(s, { side, x: 12, z0: -19, z1: -38, depth: 14, floors: 4, color: 0xe2c9a3, style: "piso", shops: ["estanco", "panaderia", "farmacia"], awningColors: [0x2e7d32, 0xe9c46a], balconies: 0.5 });
    const cols = [0x1f5f8b, 0xf4f1ea, 0x1f5f8b];
    for (let k = 0; k < 3; k++) terraceSet(s, side * (6.8 + (k % 2) * 2.4), -4 - k * 4.2, cols[k] ?? 0xb22222);
    person(s, side * 10.8, -5, side > 0 ? Math.PI / 2 : -Math.PI / 2, false, true);
    person(s, side * 9.5, -20, r.range(0, 6));
    for (const z of [-22, -30, -37]) planeTree(s, side * 6, z, 0.9);
    lampModern(s, side, 4.9, -20, 8);
    flat(s, side, 26, 120, 0.1, 0xb9b08a);
    farBlock(s, side * 40, -20, 18, 30, 22, 0xf2efe8);
  } else {
    // riverside park: grass bank sloping down, pines and palms
    pavement(s, side, RW + 0.25, 7.5, "paving", 0xe6e0d4);
    flat(s, side, 7.5, 40, 0.1, 0x9bbf5e);
    b.span(side * 40, side * 140, -4, -0.2, 0, -L, 0x8fb257, FAR);
    for (let k = 0; k < 4; k++) pine(s, side * r.range(12, 34), -r.range(3, 37), r.range(0.8, 1.1));
    palm(s, side * 9.5, -12, 8);
    palm(s, side * 9.5, -30, 9);
    for (let k = 0; k < 4; k++) shrub(s, side * r.range(9, 30), -r.range(2, 38), r.range(0.8, 1.5));
    lampModern(s, side, 4.9, -8, 8);
    lampModern(s, side, 4.9, -28, 8);
  }
}

export function buildPuenteReal(s: Seg): void {
  const b = s.b;
  const i = s.index;
  const last = s.count - 1;
  if (i < 0) {
    buildLeadIn(s);
    return;
  }
  if (i === 0) {
    road(s, { tint: 0x686d75 });
    landSide(s, 1, true);
    landSide(s, -1, false);
    return;
  }
  if (i === 1) {
    // embankment: the deck starts mid-segment, the riverbank drops away on both sides
    road(s, { tint: 0x686d75 });
    for (const sx of [-1, 1] as Side[]) {
      pavement(s, sx, RW + 0.25, DECK_X - 0.4, "paving", 0xd9d3c8, 0.15);
      b.span(sx * (DECK_X - 0.4), sx * (DECK_X + 0.4), -2.2, 0.35, 0, -L, 0xf3f2ee, SOLID);
      for (let z = -1; z > -L; z -= 2) b.boxB(sx * (DECK_X - 0.15), 0.35, z, 0.08, 0.95, 0.08, 0xffffff, SOLID);
      b.span(sx * (DECK_X - 0.2), sx * (DECK_X - 0.1), 1.25, 1.33, 0, -L, 0xffffff, SOLID);
      // grassy bank sloping down to the river
      const xa = sx < 0 ? -70 : DECK_X + 0.4;
      const xb = sx < 0 ? -(DECK_X + 0.4) : 70;
      b.hexa([
        [xa, WATER_Y, 0], [xb, WATER_Y, 0], [xb, WATER_Y, -16], [xa, WATER_Y, -16],
        [xa, 0, 0], [xb, 0, 0], [xb, WATER_Y, -16], [xa, WATER_Y, -16],
      ], 0x9bbf5e, FAR);
      lampModern(s, sx, DECK_X - 0.6, sx < 0 ? -10 : -30, 9);
      pine(s, sx * 18, -4, 1.0);
      palm(s, sx * 13, -3, 8);
    }
    b.span(-DECK_X, DECK_X, -2.4, -0.6, 0, -L, 0xd9d7cf, FAR);
    river(s, WATER_Y, 160, "none");
    // the Torre de Caja Badajoz on its riverside plot, to the right of the bridge approach
    b.span(28, 75, WATER_Y - 1, 0, -12, -L, 0xb9b8a8, FAR);
    b.span(28, 75, 0, 0.1, -12, -L, 0xd8d2c2, FAR);
    torreCaja(b, TOWER_X, TOWER_Z, 0.1, s.night, SOLID);
    return;
  }
  if (i === last) {
    // right bank: back on land, with gardens and modern blocks
    road(s, { tint: 0x686d75 });
    for (const sx of [-1, 1] as Side[]) {
      pavement(s, sx, RW + 0.25, 8, "paving", 0xe6e0d4);
      flat(s, sx, 8, 60, 0.1, 0x9bbf5e);
      for (const z of [-6, -20, -34]) planeTree(s, sx * 6.2, z, 0.95);
      lampModern(s, sx, 4.9, sx < 0 ? -13 : -27, 8);
      farBlock(s, sx * 30, -14, 16, 22, 26, sx < 0 ? 0xf2efe8 : 0xd9b48a);
      farBlock(s, sx * 34, -34, 18, 14, 18, 0xe2c9a3);
    }
    return;
  }
  // the bridge deck proper
  const pylonHere = i === PYLON_SEG;
  deck(s, pylonHere);
  river(s, WATER_Y, 160, i < PYLON_SEG ? "left" : "both");
  if (pylonHere) {
    // widen the deck around the pylon legs
    for (const sx of [-1, 1]) b.span(sx * (DECK_X + 0.4), sx * 15, -2.4, 0.35, -15, -25, 0xf3f2ee, SOLID);
    pylon(b, -20, WATER_Y);
  }
  if (i >= 3 && i <= 9) {
    const pylonZ = -(PYLON_SEG - i) * L - 20;
    stayCables(b, 0, -L, pylonZ, DECK_X + 0.1);
  }
  // a few distant towers of the left-bank city ahead/aside
  if (i % 3 === 0) farBlock(s, -s.r.range(190, 230), -20, 22, 22, s.r.range(28, 42), 0xece3d2);
}
