/**
 * Zone 2, Valdepasillas (16 segments): Avenida Sinforiano Madroñero, a wide modern avenue with
 * 6-10 storey blocks, ground-floor shops and bars, plane trees and palms.
 *   0       street plaque "Avda. Sinforiano Madroñero"
 *   3, 11   bus shelters
 *   7..9    the plaza with the big round fountain on the left (fountain at segment 8)
 */
import { GLOW, SOLID, WATER } from "../materials";
import {
  L, RW, bench, bin, building, pigeons, busShelter, farBlock, flat, lampModern, palm, pavement, person, planeTree, road, type Seg, type Side,
} from "./common";

const PALETTE = [0xb5653a, 0xd9a15b, 0xeadfc8, 0xf2efe8, 0xe39a7a, 0xcf8a52, 0xe8d3a8];
const SHOPS = [
  "farmacia", "panaderia", "churreria", "bar-bellota", "estanco", "fruteria", "peluqueria", "cafeteria",
  "zapateria", "libreria", "heladeria", "optica", "tapas", "confiteria", "restaurante", "ultramarinos",
];
const AWNINGS = [0x2e7d32, 0xb22222, 0x1f5f8b, 0xe9a23b, 0x6a4c93];

function blocks(s: Seg, side: Side, x: number): void {
  const r = s.r;
  let z = -0.5;
  while (z > -L + 6) {
    const len = Math.min(z + L - 0.5, r.range(14, 20));
    const z1 = z - len;
    if (z - z1 < 6) break;
    const nShops = Math.max(1, Math.round((z - z1) / 6.5));
    const shops: string[] = [];
    for (let k = 0; k < nShops; k++) shops.push(r.pick(SHOPS));
    building(s, {
      side, x, z0: z, z1, depth: r.range(14, 18), floors: r.int(6, 10), color: r.pick(PALETTE), style: "piso",
      shops, awningColors: [r.pick(AWNINGS), r.pick(AWNINGS)], balconies: r.range(0.35, 0.8),
    });
    z = z1 - r.range(0.8, 2.5);
  }
}

function fountainPlaza(s: Seg): void {
  const b = s.b;
  const r = s.r;
  const fx = -26;
  const fz = -20;
  // plaza paving and a low stone rim
  flat(s, -1, 12, 48, 0.12, 0xe3d9c4);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    b.boxB(fx + Math.cos(a) * 7.4, 0.12, fz + Math.sin(a) * 7.4, 4.0, 0.55, 0.6, 0xd8cdb5, SOLID, -a + Math.PI / 2);
  }
  b.cyl(fx, 0.05, fz, 7.0, 0.35, 0x4f8f98, 20, WATER);
  // tiered column with jets
  b.cyl(fx, 0.1, fz, 1.2, 1.6, 0xd8cdb5, 10, SOLID);
  b.cyl(fx, 1.7, fz, 2.6, 0.3, 0xd8cdb5, 12, SOLID);
  b.cyl(fx, 2.0, fz, 0.5, 1.6, 0xd8cdb5, 8, SOLID);
  b.cyl(fx, 3.6, fz, 1.4, 0.25, 0xd8cdb5, 10, SOLID);
  b.cone(fx, 3.8, fz, 0.35, 2.6, 0xdff4ff, 6, WATER);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.beam([fx + Math.cos(a) * 6.6, 0.4, fz + Math.sin(a) * 6.6], [fx + Math.cos(a) * 4.6, 2.6, fz + Math.sin(a) * 4.6], 0.12, 0xdff4ff, WATER);
  }
  // benches, palms, people
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    bench(s, -1, -(fx + Math.cos(a) * 11), fz + Math.sin(a) * 11, 0x7a5230, -a);
    palm(s, fx + Math.cos(a + 0.5) * 14, fz + Math.sin(a + 0.5) * 14, r.range(8, 11), 0.12);
  }
  for (let k = 0; k < 5; k++) person(s, fx + r.range(-12, 12), fz + r.range(-14, 14), r.range(0, 6), false, r.chance(0.2));
  pigeons(s, fx + 9, fz + 3, 8, 0.12);
  // buildings set back behind the plaza
  farBlock(s, -55, -20, 16, 38, 30, r.pick(PALETTE));
}

export function buildValdepasillas(s: Seg): void {
  const b = s.b;
  const r = s.r;
  const i = s.index;
  road(s, { tint: 0x63686f });
  const plaza = i >= 7 && i <= 9;
  for (const side of [-1, 1] as Side[]) {
    const pw = 12;
    pavement(s, side, RW + 0.25, pw, "paving", 0xeee6d6);
    // tree line: plane trees, with palms in some stretches
    const palms = i % 4 === 2;
    for (let k = 0; k < 4; k++) {
      const z = -5 - k * 10 + (side > 0 ? 5 : 0);
      if (palms) palm(s, side * 6.6, z, r.range(8, 10));
      else planeTree(s, side * 6.6, z, r.range(0.9, 1.1));
    }
    lampModern(s, side, 4.9, side > 0 ? -10 : -30, 8.5);
    bin(s, side, 5.0, side > 0 ? -22 : -2);
    if (!(plaza && side < 0)) {
      blocks(s, side, pw);
      // second row, taller
      farBlock(s, side * r.range(40, 48), -10, 18, 18, r.range(28, 40), r.pick(PALETTE));
      farBlock(s, side * r.range(40, 48), -30, 18, 16, r.range(24, 36), r.pick(PALETTE));
    }
    flat(s, side, pw, 140, 0.1, 0xcfc4ae);
    // pedestrians
    for (let k = 0; k < 2; k++) person(s, side * r.range(8, 11), -r.range(2, 38), r.chance(0.5) ? 0 : Math.PI);
  }
  if (plaza && i === 8) fountainPlaza(s);
  if (plaza && i !== 8) {
    // plaza edges: palms and benches, a kiosk
    flat(s, -1, 12, 48, 0.12, 0xe3d9c4);
    for (let k = 0; k < 3; k++) palm(s, -r.range(16, 40), -r.range(4, 36), r.range(8, 11), 0.12);
    farBlock(s, -55, -20, 16, 38, r.range(24, 32), r.pick(PALETTE));
    if (i === 7) {
      b.boxB(-16, 0.12, -30, 3, 2.6, 3, 0x2e6b3a, SOLID);
      b.boxB(-16, 2.72, -30, 3.6, 0.3, 3.6, 0x23542d, SOLID);
      b.sign("kiosco", -14.45, 2.2, -30, 0.5, Math.PI / 2);
      b.sign("helados", -16, 2.2, -28.45, 0.45);
    }
  }
  if (i === 3 || i === 11) busShelter(s, 1, 5.0, -16);
  if (i === 0) {
    b.boxB(5.0, 0.15, -2, 0.08, 3.0, 0.08, 0x555555, SOLID);
    b.sign("c-sinforiano", 5.0, 2.9, -2, 0.5, -Math.PI / 2);
    b.sign("c-sinforiano", -12.2, 4.5, -1.2, 0.6, Math.PI / 2);
  }
  // traffic light pair at the plaza junction
  if (i === 7) {
    for (const sx of [-1, 1]) {
      b.boxB(sx * 4.8, 0.15, -2, 0.12, 3.2, 0.12, 0x2a2d30, SOLID);
      b.box(sx * 4.8, 3.0, -2.0, 0.3, 0.9, 0.25, 0x2a2d30, SOLID);
      b.box(sx * 4.8, 2.75, -1.86, 0.16, 0.16, 0.04, 0x33ff66, GLOW);
    }
  }
}
