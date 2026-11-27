/**
 * Puente Real lead-in (segment indices -1..-4): the sunny riverside street behind the start line,
 * seen in the intro and the menu. Low houses and shops on the right, the riverside promenade with
 * palms on the left. Segment -1 holds "Bar El Puente", where the simpa happened: its terrace has
 * one abandoned table (knocked-over chair, tipped glass, the unpaid bill) and customers staring.
 */
import { T, xf } from "../geom";
import { FAR, SOLID } from "../materials";
import {
  L, RW, bench, building, flat, lampModern, palm, pavement, person, road, shrub, terraceSet, type Seg,
} from "./common";
import { river } from "./puente-real";

const HOUSES = [0xf6f1e4, 0xf3dc95, 0xeec07a, 0xf0b9a6, 0xf7f4ee, 0xe2c9a3];
const SHOPS = ["panaderia", "fruteria", "estanco", "heladeria", "confiteria", "farmacia", "tapas", "libreria"];

/** The abandoned table: the runner's seat, left in a hurry. */
function abandonedTable(s: Seg, x: number, z: number): void {
  const b = s.b;
  const y = 0.15;
  b.cyl(x, y, z, 0.04, 0.74, 0x8a8f96, 6, SOLID);
  b.cyl(x, y, z, 0.25, 0.03, 0x6c757d, 8, SOLID);
  b.cyl(x, y + 0.74, z, 0.45, 0.03, 0x9aa0a6, 12, SOLID);
  // one glass still standing, one knocked over with beer spilled across the table and the floor
  b.cyl(x + 0.15, y + 0.77, z - 0.1, 0.04, 0.13, 0xf2b01e, 8, SOLID);
  b.cyl(x + 0.15, y + 0.9, z - 0.1, 0.042, 0.03, 0xfffbea, 8, SOLID);
  b.add(T.cyl(8), xf(x - 0.12, y + 0.81, z + 0.12, 0.04, 0.13, 0.04, Math.PI / 2, 0.6, 0), 0xf2d27a, SOLID);
  b.cyl(x - 0.25, y + 0.771, z + 0.25, 0.22, 0.004, 0xe8b830, 10, SOLID);
  b.cyl(x - 0.55, y + 0.002, z + 0.55, 0.35, 0.004, 0xd9a826, 10, SOLID);
  // plate of jamón, half eaten, and the unpaid bill held down by a saucer
  b.cyl(x + 0.05, y + 0.77, z + 0.18, 0.14, 0.015, 0xffffff, 12, SOLID);
  for (let k = 0; k < 2; k++) b.add(T.box, xf(x + 0.02 + k * 0.05, y + 0.79, z + 0.18, 0.05, 0.008, 0.12, 0, 0.5 + k, 0), 0xc44a4a, SOLID);
  b.add(T.box, xf(x + 0.22, y + 0.775, z + 0.22, 0.12, 0.004, 0.22, 0, 0.3, 0), 0xfffdf2, SOLID);
  b.cyl(x + 0.24, y + 0.78, z + 0.16, 0.06, 0.012, 0xf4f4f4, 8, SOLID);
  // the chair the runner jumped from: knocked over backwards onto the pavement
  b.push(xf(x + 0.95, y + 0.22, z - 0.1, 1, 1, 1, 0, 0.4, Math.PI / 2 + 0.15));
  b.boxB(0, 0, 0, 0.4, 0.05, 0.42, 0xb22222, SOLID);
  for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]] as const) b.boxB(dx, -0.43, dz, 0.035, 0.43, 0.035, 0x8a8f96, SOLID);
  b.box(0.22, 0.25, 0, 0.04, 0.45, 0.42, 0xb22222, SOLID);
  b.pop();
  // the other chair still in place, a napkin on the floor
  b.boxB(x - 0.75, y + 0.42, z, 0.4, 0.05, 0.4, 0xb22222, SOLID);
  b.boxB(x - 0.75, y, z, 0.36, 0.42, 0.36, 0x8a8f96, SOLID);
  b.box(x + 0.4, y + 0.003, z + 0.7, 0.25, 0.006, 0.25, 0xffffff, SOLID, 0.7);
  // parasol above, red like the bar
  b.cyl(x, y, z, 0.03, 2.4, 0xdddddd, 6, SOLID);
  b.add(T.cone(8), xf(x, y + 2.45, z, 1.4, 0.5, 1.4), 0xb22222, SOLID);
}

function riverside(s: Seg): void {
  const b = s.b;
  const r = s.r;
  // promenade, white balustrade, then the bank down to the Guadiana
  pavement(s, -1, RW + 0.25, 7.6, "paving", 0xe6e0d4);
  b.span(-7.6, -7.9, 0.15, 0.95, 0, -L, 0xf4f1ea, SOLID);
  b.span(-7.55, -7.95, 0.95, 1.05, 0, -L, 0xffffff, SOLID);
  for (let z = -2; z > -L; z -= 2.5) b.boxB(-7.75, 0.15, z, 0.35, 0.85, 0.35, 0xf4f1ea, SOLID);
  b.hexa([
    [-30, -4.2, 0], [-7.9, -4.2, 0], [-7.9, -4.2, -L], [-30, -4.2, -L],
    [-30, -4.2, 0], [-7.9, 0.1, 0], [-7.9, 0.1, -L], [-30, -4.2, -L],
  ], 0x9bbf5e, FAR);
  river(s, -4.5, 150, "left");
  for (const z of [-6, -19, -32]) palm(s, -6.6, z + r.range(-1, 1), r.range(8, 10));
  for (const z of [-12, -26]) bench(s, -1, 7.0, z, 0x7a5230, Math.PI);
  lampModern(s, -1, 4.9, -12, 8);
  lampModern(s, -1, 4.9, -32, 8);
  for (let k = 0; k < 3; k++) shrub(s, -r.range(10, 26), -r.range(2, 38), r.range(0.8, 1.4), -2, 0x6f9a48);
  for (let k = 0; k < 2; k++) person(s, -r.range(5, 7), -r.range(2, 38), r.chance(0.5) ? 0 : Math.PI);
  // a kayak or two out on the river
  if (r.chance(0.7)) {
    const kx = -r.range(40, 90);
    const kz = -r.range(5, 35);
    b.add(T.sphere(8, 4), xf(kx, -4.4, kz, 0.35, 0.2, 2.4), r.pick([0xff6b1a, 0xffd23f, 0xd62828]), SOLID);
    b.sphere(kx, -4.0, kz, 0.2, 0.3, 0.2, 0x264653, SOLID, 5, 3);
  }
}

export function buildLeadIn(s: Seg): void {
  const b = s.b;
  const r = s.r;
  const bar = s.index === -1;
  road(s, { tint: 0x686d75 });
  riverside(s);
  // right side: wide pavement with palms, low houses and shops
  pavement(s, 1, RW + 0.25, 10.5, "paving", 0xece6da);
  flat(s, 1, 10.5, 140, 0.1, 0xb9b08a);
  if (bar) {
    building(s, { side: 1, x: 10.5, z0: -1, z1: -7, depth: 12, floors: 2, color: 0xf3dc95, style: "viejo", roof: "tile", shops: ["panaderia"], awningColors: [0x2e7d32], balconies: 0.6 });
    building(s, { side: 1, x: 10.5, z0: -7.5, z1: -27, depth: 14, floors: 2, color: 0xf4efe6, style: "piso", roof: "tile", shops: ["bar-puente", "bar-puente", "bar-puente"], awningColors: [0xb22222], balconies: 0.8, trim: 0xb22222 });
    building(s, { side: 1, x: 10.5, z0: -27.5, z1: -39, depth: 12, floors: 3, color: 0xeec07a, style: "viejo", roof: "tile", shops: ["estanco"], awningColors: [0xe9c46a], balconies: 0.6 });
    // the terrace: busy tables, and the runner's abandoned one in the middle
    terraceSet(s, 6.6, -10, 0xb22222);
    terraceSet(s, 8.9, -14, 0xf4f1ea);
    abandonedTable(s, 6.8, -17.5);
    terraceSet(s, 8.9, -21.5, 0xb22222);
    terraceSet(s, 6.6, -25, 0xf4f1ea);
    // customers staring down the road after the runner; one points / waves
    person(s, 9.6, -17, Math.PI, false, true);
    person(s, 5.4, -20.5, Math.PI);
    person(s, 10.0, -12, Math.PI * 0.85);
    b.sign("bar-puente", 10.43, 4.6, -17, 0.9, -Math.PI / 2);
    // menu board on the pavement ("Menú del día")
    b.add(T.box, xf(5.0, 0.7, -29, 0.06, 1.1, 0.6, 0, 0, 0.12), 0x2b2b2b, SOLID);
  } else {
    let z = -0.5;
    while (z > -L + 5) {
      const len = Math.min(z + L - 0.5, r.range(8, 14));
      building(s, {
        side: 1, x: 10.5, z0: z, z1: z - len, depth: 12, floors: r.int(1, 3), color: r.pick(HOUSES), style: r.chance(0.5) ? "viejo" : "piso",
        roof: "tile", shops: [r.pick(SHOPS)], awningColors: [r.pick([0x2e7d32, 0xb22222, 0x1f5f8b, 0xe9c46a])], balconies: 0.6,
      });
      z -= len + 0.5;
    }
    for (let k = 0; k < 2; k++) person(s, r.range(5.5, 9.5), -r.range(2, 38), r.chance(0.5) ? 0 : Math.PI, false, r.chance(0.15));
    if (s.index === -3) terraceSet(s, 7.5, -20, 0x2e7d32);
  }
  for (const z of bar ? [-3, -36] : [-6, -19, -32]) palm(s, 6.4, z, r.range(8, 10));
  lampModern(s, 1, 4.9, -2, 8);
  lampModern(s, 1, 4.9, -22, 8);
  if (s.index === -4) b.sign("c-ribera", 10.43, 3.4, -20, 0.5, -Math.PI / 2);
}
