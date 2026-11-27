/**
 * Zone 5, Alcazaba y Puerta de Palmas (18 segments), at sunset:
 *   0..5    beside the Alcazaba (right): rammed-earth walls with square towers on the hill,
 *           Torre de Espantaperros at segment 3; gardens, cypresses and pines on the left
 *   6..8    down towards the river: gardens, palms, the walls stepping down
 *   9       Puerta de Palmas straddling the road (the runner passes through the arch)
 *   10..11  riverside gardens
 *   12..17  Puente de Palmas: the old granite bridge over the Guadiana, low parapets, old lamps,
 *           piers with cutwaters, the Alcazaba hill seen back across the river
 */
import { alcazabaHill, alcazabaWall, espantaperros, puertaPalmas } from "../landmarks/alcazaba";
import { FAR, SOLID } from "../materials";
import {
  L, RW, building, cypress, firework, flat, floodlit, pigeons, storkNest, groundQuad, lampClassic, palm, pavement, person, pine, road, shrub, type Seg, type Side,
} from "./common";
import { river } from "./puente-real";

const HILL = 0xa99456;
const GATE_SEG = 9;

/** Hill rising from the road edge to `top` at x = xTop on one side. */
function hill(s: Seg, side: Side, x0: number, xTop: number, top: number, z0 = 0, z1 = -L, color = HILL): void {
  const b = s.b;
  const a = side * x0;
  const c = side * xTop;
  const [xa, ya, xb, yb] = a < c ? [a, 0.1, c, top] : [c, top, a, 0.1];
  b.hexa([
    [xa, -0.5, z0], [xb, -0.5, z0], [xb, -0.5, z1], [xa, -0.5, z1],
    [xa, ya, z0], [xb, yb, z0], [xb, yb, z1], [xa, ya, z1],
  ], color, FAR);
  b.span(side * xTop, side * 160, -0.5, top, z0, z1, color, FAR);
}

function gardensLeft(s: Seg, houses: boolean): void {
  const r = s.r;
  pavement(s, -1, RW + 0.25, 7, "flagstone", 0xe2d3bb);
  flat(s, -1, 7, 60, 0.1, 0x8fae55);
  for (let k = 0; k < 3; k++) cypress(s, -r.range(9, 14), -4 - k * 13, r.range(8, 11), 0.1);
  for (let k = 0; k < 2; k++) pine(s, -r.range(18, 32), -r.range(4, 36), r.range(0.9, 1.2));
  for (let k = 0; k < 3; k++) shrub(s, -r.range(8, 20), -r.range(2, 38), r.range(0.7, 1.3), 0.1, 0x4f7f35);
  lampClassic(s, -1, 5.0, -10, 4.2, 0.15);
  lampClassic(s, -1, 5.0, -30, 4.2, 0.15);
  if (houses) {
    building(s, { side: -1, x: 34, z0: -2, z1: -18, depth: 10, floors: 2, color: 0xf6f1e4, style: "viejo", roof: "tile", balconies: 0.5, far: true });
    building(s, { side: -1, x: 34, z0: -20, z1: -38, depth: 10, floors: 2, color: 0xf3dc95, style: "viejo", roof: "tile", balconies: 0.5, far: true });
  }
}

function alcazabaSide(s: Seg): void {
  const b = s.b;
  const i = s.index;
  pavement(s, 1, RW + 0.25, 6.5, "flagstone", 0xe2d3bb);
  // low retaining wall, then the slope up to the walls
  b.span(6.5, 7.1, 0, 1.6, 0, -L, 0xc9a774, SOLID);
  hill(s, 1, 7.1, 18, 8);
  const towerZ = i % 2 === 0 ? -12 : -30;
  floodlit(s, "warm", () => {
    alcazabaWall(b, 1, 18, 0, -L, 8, 10, i === 3 ? undefined : towerZ);
    if (i === 3) espantaperros(b, 14.5, -20, 6.5);
  });
  if (i === 3) firework(s, 40, 70, -120, 12, 0xffd23f);
  else if (i % 2 === 1) storkNest(b, 17.2, 22.05, towerZ, 0.4, i === 1);
  // the inner keep area beyond the wall: higher ground, a couple of palace roofs
  b.span(20.4, 160, -0.5, 14, 0, -L, 0xb39c60, FAR);
  if (i % 2 === 1) b.span(30, 44, 14, 21, -8, -26, 0xe9dcc4, FAR);
  for (let k = 0; k < 3; k++) cypress(s, 10 + k * 2.6, -4 - k * 13 - s.r.range(0, 4), s.r.range(7, 10), 4.5 + k * 1.2);
  for (let k = 0; k < 2; k++) shrub(s, s.r.range(8, 16), -s.r.range(2, 38), 1.2, 3, 0x6f8f3f);
  lampClassic(s, 1, 5.0, -20, 4.2, 0.15);
}

function descent(s: Seg): void {
  const b = s.b;
  const r = s.r;
  const i = s.index;
  for (const side of [-1, 1] as Side[]) {
    pavement(s, side, RW + 0.25, 7, "flagstone", 0xe2d3bb);
    flat(s, side, 7, 60, 0.1, 0x93b05a);
    for (let k = 0; k < 2; k++) palm(s, side * r.range(8.5, 12), -5 - k * 20 - r.range(0, 8), r.range(9, 12), 0.1);
    for (let k = 0; k < 3; k++) shrub(s, side * r.range(9, 30), -r.range(2, 38), r.range(0.8, 1.4), 0.1, 0x4f7f35);
    lampClassic(s, side, 5.0, side > 0 ? -12 : -32, 4.2, 0.15);
  }
  if (i <= 8) {
    // the walls step down the hill towards the gate
    const base = Math.max(0, 6 - (i - 6) * 3);
    hill(s, 1, 9, 22, base + 0.1);
    floodlit(s, "warm", () => alcazabaWall(b, 1, 22, 0, -L, base, 9, -20));
  } else {
    // past the gate: the riverside park opens up
    flat(s, 1, 60, 160, 0.1, 0x93b05a);
    for (let k = 0; k < 4; k++) pine(s, r.range(14, 40), -r.range(2, 38), r.range(0.9, 1.2));
  }
  if (i >= 10) for (let k = 0; k < 3; k++) pine(s, -r.range(14, 40), -r.range(2, 38), r.range(0.9, 1.2));
  else gardensLeft(s, true);
  for (let k = 0; k < 2; k++) person(s, (r.chance(0.5) ? -1 : 1) * r.range(5, 6.5), -r.range(2, 38), r.chance(0.5) ? 0 : Math.PI);
}

function gateSegment(s: Seg): void {
  const b = s.b;
  for (const side of [-1, 1] as Side[]) {
    pavement(s, side, RW + 0.25, 4.7, "flagstone", 0xe2d3bb);
    groundQuad(s, side * 4.7, side * 40, 0, -L, 0.12, "flagstone", 0xd9c8aa, 2.5);
    for (const z of [-4, -36]) palm(s, side * 15, z, 11, 0.12);
    lampClassic(s, side, 12, -10, 4.2, 0.12);
    lampClassic(s, side, 12, -30, 4.2, 0.12);
    flat(s, side, 40, 160, 0.1, 0x93b05a);
  }
  floodlit(s, "warm", () => puertaPalmas(b, -20));
  firework(s, -20, 55, -160, 13, 0xff3b3b);
  firework(s, 30, 65, -190, 10, 0x7dff6a);
  storkNest(b, -9.3, 16.75, -20, 1.2, true);
  pigeons(s, -8, -8, 6, 0.12);
  b.sign("c-palmas", -13.0, 3.0, -16.4, 0.45, 0);
}

const PARAPET = 0xc9b48e;
const BRIDGE_STONE = 0xbfa982;
const WATER_Y = -8;

function bridge(s: Seg): void {
  const b = s.b;
  const r = s.r;
  for (const side of [-1, 1] as Side[]) {
    pavement(s, side, RW + 0.25, 5.6, "flagstone", 0xd8c9ad, 0.18);
    // low granite parapet with coping
    b.span(side * 5.6, side * 6.3, -0.2, 1.0, 0, -L, PARAPET, SOLID);
    b.span(side * 5.5, side * 6.4, 1.0, 1.15, 0, -L, 0xdccaa5, SOLID);
    // the bridge side wall down to the water, with arches between piers every 20 m
    for (const pz of [-10, -30]) {
      // pier + pointed cutwater pointing upstream/downstream (outwards)
      b.span(side * 5.8, side * 7.4, WATER_Y - 1, -0.6, pz + 2.2, pz - 2.2, BRIDGE_STONE, FAR);
      b.hexa(side > 0
        ? [[7.4, WATER_Y - 1, pz + 2.2], [9.6, WATER_Y - 1, pz], [9.6, WATER_Y - 1, pz], [7.4, WATER_Y - 1, pz - 2.2],
          [7.4, -2.5, pz + 2.2], [8.8, -2.5, pz], [8.8, -2.5, pz], [7.4, -2.5, pz - 2.2]]
        : [[-9.6, WATER_Y - 1, pz], [-7.4, WATER_Y - 1, pz + 2.2], [-7.4, WATER_Y - 1, pz - 2.2], [-9.6, WATER_Y - 1, pz],
          [-8.8, -2.5, pz], [-7.4, -2.5, pz + 2.2], [-7.4, -2.5, pz - 2.2], [-8.8, -2.5, pz]], BRIDGE_STONE, FAR);
      // the cutwater rises to the deck as a triangular refuge bay beside the parapet
      const ax = side * 6.2;
      const tx = side * 8.6;
      b.hexa(side > 0
        ? [[6.2, -2.5, pz + 2.4], [8.6, -2.5, pz], [8.6, -2.5, pz], [6.2, -2.5, pz - 2.4], [6.2, 1.15, pz + 2.4], [8.6, 1.15, pz], [8.6, 1.15, pz], [6.2, 1.15, pz - 2.4]]
        : [[-8.6, -2.5, pz], [-6.2, -2.5, pz + 2.4], [-6.2, -2.5, pz - 2.4], [-8.6, -2.5, pz], [-8.6, 1.15, pz], [-6.2, 1.15, pz + 2.4], [-6.2, 1.15, pz - 2.4], [-8.6, 1.15, pz]], 0xd6c39c, SOLID);
      b.beam([ax, 1.2, pz + 2.4], [tx, 1.2, pz], 0.25, 0xe2d2ad, SOLID);
      b.beam([tx, 1.2, pz], [ax, 1.2, pz - 2.4], 0.25, 0xe2d2ad, SOLID);
      // tall old lamp on the pier top
      lampClassic(s, side, 7.0, pz, 5.4, 1.15);
    }
    // spandrel wall: solid at the top, open arches (dark) below between piers
    b.span(side * 5.7, side * 6.2, -3.2, -0.2, 0, -L, BRIDGE_STONE, FAR);
    for (const az of [0, -20, -40]) {
      const n = 8;
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI;
        const a1 = ((k + 1) / n) * Math.PI;
        const z0 = az - 7.8 + (1 - Math.cos(a0)) * 7.8;
        const z1 = az - 7.8 + (1 - Math.cos(a1)) * 7.8;
        const zLo = Math.max(-L, Math.min(z0, z1) + 0);
        const zHi = Math.min(0, Math.max(z0, z1));
        if (zHi - zLo <= 0.01) continue;
        const yArch = WATER_Y + 1 + Math.min(Math.sin(a0), Math.sin(a1)) * 5.5;
        b.span(side * 5.75, side * 6.15, yArch, -3.2, zHi + 2.2 * 0, zLo, BRIDGE_STONE, FAR);
      }
    }
  }
  // deck underside
  b.span(-6.2, 6.2, -3.4, -0.6, 0, -L, 0xa8957a, FAR);
  river(s, WATER_Y, 120, "none");
  // the neighbouring bridge downstream: a long row of arches seen side-on across the water
  {
    const bx = -150;
    const top = 3;
    b.span(bx - 4, bx + 4, top - 1.6, top, 0, -L, 0xcbb894, FAR);
    b.span(bx + 4, bx + 4.3, top, top + 1.0, 0, -L, 0xd6c49e, FAR);
    for (const pz of [-10, -30]) {
      b.span(bx - 3.5, bx + 3.5, WATER_Y - 1, top - 1.6, pz + 1.6, pz - 1.6, 0xbfa982, FAR);
      for (let k = 0; k < 10; k++) {
        // spandrel slices above each half-arch (semicircle radius 8.4 between piers)
        const a0 = (k / 10) * Math.PI;
        const a1 = ((k + 1) / 10) * Math.PI;
        const z0 = pz - 1.6 - 8.4 + Math.cos(a0) * -8.4 + 16.8 - 8.4;
        const z1 = pz - 1.6 - 8.4 + Math.cos(a1) * -8.4 + 16.8 - 8.4;
        const yLo = WATER_Y + 2 + Math.min(Math.sin(a0), Math.sin(a1)) * 7.5;
        b.span(bx + 3, bx + 3.5, yLo, top - 1.6, Math.max(z0, z1), Math.min(z0, z1), 0xc9b48e, FAR);
      }
    }
    for (const z of [-5, -25]) b.cyl(bx + 3.6, top + 1, z, 0.08, 3.2, 0x2a2d30, 5, FAR);
  }
  // riverside parks and the Alcazaba hill back across the river
  for (let k = 0; k < 3; k++) pine(s, -r.range(125, 160), -r.range(2, 38), 1.3, WATER_Y + 2.5, FAR);
  floodlit(s, "warm", () => {
    if (s.index === 13 || s.index === 16) alcazabaHill(b, 175, -10, 120);
    if (s.index === 14) alcazabaHill(b, -190, -20, 90);
  });
  for (let k = 0; k < 2; k++) person(s, (r.chance(0.5) ? -1 : 1) * r.range(4.7, 5.3), -r.range(2, 38), r.chance(0.5) ? 0 : Math.PI);
}

export function buildAlcazabaPalmas(s: Seg): void {
  const i = s.index;
  if (i >= 12) {
    road(s, { surface: "flagstone", tint: 0xb0a48e, lineColor: 0xeee6d4, edgeLines: false, kerbColor: 0xd2c3a2 });
    bridge(s);
    return;
  }
  road(s, { tint: 0x686a70 });
  if (i <= 5) {
    alcazabaSide(s);
    gardensLeft(s, i % 2 === 0);
  } else if (i === GATE_SEG) {
    gateSegment(s);
  } else {
    descent(s);
  }
}
