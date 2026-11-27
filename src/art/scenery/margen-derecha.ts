/**
 * Zone 6, Margen derecha (16 segments) at dusk: Avenida de Elvas on the right bank.
 *   0        street plaque "Avenida de Elvas"
 *   2, 7, 12 overhead sign gantries (signs above 5 m): Puente Real / Portugal-Elvas / Centro ciudad
 *   4        petrol station (right)
 *   5..7     Universidad de Extremadura campus (left)
 *   9..10    retail park: big-box stores and car parks (right)
 *   11..13   riverside park with stone pines (left), the Guadiana beyond
 *   15       the Puente Real pylon straight ahead and the Torre de Caja Badajoz to the right, placed
 *            where puente-real has them: the loop closes
 */
import { pylon, torreCaja } from "../landmarks/puente-real";
import { PYLON_SEG, TOWER_X, TOWER_Z } from "./puente-real";
import { FAR, GLASS, GLOW, SOLID, WATER } from "../materials";
import {
  L, RW, building, farBlock, flat, floodlit, groundQuad, lampModern, pavement, person, pine, planeTree, shrub, road, type Seg, type Side,
} from "./common";

const MODERN = [0xe9e6df, 0xd9d4ca, 0xc9b79a, 0xf2efe8, 0xb5a08a];
const LAMP_GLOW = 0xffc870;

function verge(s: Seg, side: Side): void {
  const b = s.b;
  const r = s.r;
  pavement(s, side, RW + 0.25, 6.2, "paving", 0xd8d2c6);
  flat(s, side, 6.2, 12, 0.12, 0x6f9a48);
  // service road
  groundQuad(s, side * 12, side * 18, 0, -L, 0.05, "asphalt", 0x5d6168, 5);
  flat(s, side, 18, 21, 0.15, 0xcfc8ba);
  for (let k = 0; k < 4; k++) shrub(s, side * r.range(7.5, 11), -r.range(2, 38), r.range(0.6, 1.0), 0.12, 0x5a8a3a);
  for (const z of [-8, -28]) planeTree(s, side * 9.5, z + (side > 0 ? 6 : 0), r.range(0.8, 0.95), 0.12);
  // cars parked along the service road, well away from the carriageway
  for (let k = 0; k < 6; k++) {
    if (!r.chance(0.55)) continue;
    const z = -3 - k * 6.2;
    const x = side * 13.1;
    b.boxB(x, 0.1, z, 1.75, 0.7, 4.1, r.pick([0xc0392b, 0x2e86de, 0xecf0f1, 0x34495e, 0x95a5a6, 0x1b1b1b, 0xf1c40f]), FAR);
    b.boxB(x, 0.8, z + 0.2, 1.55, 0.55, 2.2, 0x3a4a5a, FAR);
    b.box(x, 0.55, z + 2.06, 1.2, 0.12, 0.04, 0xe0141e, GLOW);
  }
  for (let k = 0; k < 2; k++) person(s, side * r.range(4.8, 6), -r.range(2, 38), r.chance(0.5) ? 0 : Math.PI, false, r.chance(0.2));
  // tall twin-arm lamps on the verge
  for (const z of side > 0 ? [-2, -22] : [-12, -32]) lampModern(s, side, 6.6, z, 10);
  for (const z of side > 0 ? [-2, -22] : [-12, -32]) {
    b.box(side * 5.2, 0.16, z, 1.4, 0.01, 2.2, 0x8a7a55, FAR); // warm light pool hint on the pavement
  }
}

function gantry(s: Seg, z: number, left: string, right: string): void {
  const b = s.b;
  const steel = 0x8d949c;
  for (const sx of [-1, 1]) {
    b.cyl(sx * 6.4, 0, z, 0.25, 7.8, steel, 8, SOLID);
    b.boxB(sx * 6.4, 0, z, 0.9, 0.4, 0.9, 0xb0b0b0, SOLID);
  }
  // truss beam
  b.span(-6.6, 6.6, 7.3, 7.5, z + 0.5, z + 0.3, steel, SOLID);
  b.span(-6.6, 6.6, 7.3, 7.5, z - 0.3, z - 0.5, steel, SOLID);
  b.span(-6.6, 6.6, 6.9, 7.0, z + 0.4, z - 0.4, steel, SOLID);
  for (let x = -6; x <= 6; x += 1.2) b.beam([x, 7.0, z], [x + 0.6, 7.4, z], 0.06, steel, SOLID);
  // signs hung on the front, bottom edge at 5.3 m
  for (const [x, name] of [[-2.15, left], [2.15, right]] as const) {
    b.span(x - 2.05, x + 2.05, 5.25, 7.05, z + 0.62, z + 0.52, 0x1a1a1a, SOLID);
    b.sign(name, x, 6.15, z + 0.64, 1.75, 0, 4.0);
    // little sign lights on top
    b.box(x, 7.15, z + 0.9, 1.6, 0.06, 0.12, s.night ? 0xfff2cc : 0xdddddd, s.night ? GLOW : SOLID);
  }
}

function petrolStation(s: Seg): void {
  const b = s.b;
  // canopy with a glowing underside
  for (const [x, z] of [[24, -12], [34, -12], [24, -26], [34, -26]] as const) b.cyl(x, 0.15, z, 0.3, 5.3, 0xdddddd, 8, SOLID);
  b.span(20, 38, 5.4, 6.4, -8, -30, 0xf4f4f4, SOLID);
  b.span(20, 38, 5.6, 6.2, -7.95, -7.9, 0xd62828, SOLID);
  b.span(19.95, 19.9, 5.6, 6.2, -8, -30, 0xd62828, SOLID);
  b.span(20.5, 37.5, 5.38, 5.4, -8.5, -29.5, 0xfff8e8, GLOW);
  for (const z of [-14, -24]) {
    b.boxB(29, 0.15, z, 1.2, 0.3, 4, 0xbbbbbb, SOLID);
    for (const dz of [-1, 1]) {
      b.boxB(29, 0.45, z + dz, 0.6, 1.8, 0.9, 0xf2f2f2, SOLID);
      b.box(28.69, 1.8, z + dz, 0.02, 0.4, 0.6, 0x2266aa, GLOW);
    }
  }
  b.span(42, 56, 0, 4.2, -10, -28, 0xeeeeee, SOLID);
  b.span(41.9, 42, 0.4, 3.0, -12, -26, 0x9fd0f0, s.night ? GLOW : GLASS);
  b.sign("gasolinera", 41.88, 3.6, -19, 0.7, -Math.PI / 2);
  // price totem next to the road
  b.boxB(15, 0.15, -6, 1.4, 6.5, 0.4, 0xd62828, SOLID);
  b.sign("precios", 15, 3.4, -5.78, 4.0, 0, 2.0);
  b.sign("gasolinera", 15, 6.0, -5.78, 0.5, 0, 1.3);
  groundQuad(s, 18, 60, 0, -L, 0.06, "asphalt", 0x6a6e74, 5);
}

function campus(s: Seg): void {
  const b = s.b;
  const r = s.r;
  flat(s, -1, 21, 120, 0.1, 0x7ea552);
  const i = s.index;
  building(s, { side: -1, x: 26, z0: -2, z1: -24, depth: 18, floors: r.int(3, 4), groundH: 4, color: i === 6 ? 0xf2efe8 : r.pick(MODERN), style: "oficina", endWindows: true });
  building(s, { side: -1, x: 30, z0: -27, z1: -39, depth: 14, floors: 2, groundH: 4, color: 0xc9b79a, style: "oficina" });
  if (i === 6) {
    b.sign("uex", -25.85, 5.6, -13, 1.1, Math.PI / 2, 8.8);
    // campus monolith by the road
    b.boxB(-13, 0.15, -6, 0.6, 2.4, 4.2, 0x0d6b3a, SOLID);
    b.sign("campus", -12.68, 1.6, -6, 0.75, Math.PI / 2, 3.8);
  }
  for (let k = 0; k < 3; k++) pine(s, -r.range(22, 40), -r.range(2, 38), r.range(0.8, 1.0));
}

function retail(s: Seg): void {
  const b = s.b;
  const r = s.r;
  groundQuad(s, 21, 52, 0, -L, 0.06, "asphalt", 0x6a6e74, 5);
  // parking bays and a few parked cars (simple far detail)
  for (let k = 0; k < 10; k++) {
    if (!r.chance(0.6)) continue;
    const z = -3 - k * 3.6;
    const x = r.chance(0.5) ? 30 : 40;
    const c = r.pick([0xc0392b, 0x2e86de, 0xecf0f1, 0x34495e, 0x95a5a6, 0x1b1b1b]);
    b.boxB(x, 0.1, z, 4.2, 0.75, 1.8, c, FAR);
    b.boxB(x + 0.3, 0.85, z, 2.2, 0.55, 1.6, 0x34495e, FAR);
  }
  const name = s.index === 9 ? "centro-comercial" : r.pick(["bricolaje", "muebles"]);
  b.span(54, 110, 0, 12, -1, -39, s.index === 9 ? 0xf4f1ea : 0xdfd8c8, SOLID);
  b.span(53.8, 54, 9.5, 11.5, -1, -39, s.index === 9 ? 0xe4572e : 0x2e7d32, SOLID);
  b.sign(name, 53.7, 7.2, -20, 3.2, -Math.PI / 2);
  b.span(53.85, 54, 0.4, 4, -12, -28, 0x9fd0f0, s.night ? GLOW : GLASS);
  // tall pylon sign by the road
  b.boxB(19.5, 0.15, -30, 0.8, 9, 0.8, 0xdddddd, SOLID);
  b.sign(name, 19.5, 9.6, -29.58, 1.4, 0);
}

function riversidePark(s: Seg): void {
  const b = s.b;
  const r = s.r;
  flat(s, -1, 21, 45, 0.1, 0x7ea552);
  b.hexa([
    [-70, -6, 0], [-45, -6, 0], [-45, -6, -L], [-70, -6, -L],
    [-70, -6, 0], [-45, 0.1, 0], [-45, 0.1, -L], [-70, -6, -L],
  ], 0x7ea552, FAR);
  b.span(-400, -70, -7, -6.2, 0, -L, 0x4a6f80, WATER);
  b.span(-460, -260, -7, -3, 0, -L, 0x5f7f4a, FAR);
  for (let k = 0; k < 5; k++) pine(s, -r.range(22, 60), -r.range(2, 38), r.range(1.0, 1.3), k > 2 ? -2 : 0.1);
  // a riverside walk with lamps
  groundQuad(s, -40, -36, 0, -L, 0.12, "flagstone", 0xcdbfa5, 2.5);
  for (const z of [-10, -30]) {
    b.cyl(-38, 0.12, z, 0.06, 4, 0x2a2d30, 6, SOLID);
    b.sphere(-38, 4.2, z, 0.3, 0.3, 0.3, LAMP_GLOW, GLOW, 6, 4);
  }
}

export function buildMargenDerecha(s: Seg): void {
  const b = s.b;
  const r = s.r;
  const i = s.index;
  road(s, { tint: 0x5f636a });
  verge(s, -1);
  verge(s, 1);
  // right side
  if (i === 4) petrolStation(s);
  else if (i === 9 || i === 10) retail(s);
  else {
    flat(s, 1, 21, 140, 0.1, 0xb9b08a);
    building(s, { side: 1, x: 22, z0: -2, z1: -18, depth: 16, floors: r.int(5, 8), color: r.pick(MODERN), style: "piso", shops: ["farmacia", "cafeteria"], balconies: 0.4 });
    building(s, { side: 1, x: 22, z0: -21, z1: -38, depth: 16, floors: r.int(4, 7), color: r.pick(MODERN), style: r.chance(0.5) ? "oficina" : "piso", shops: ["optica", "bar-bellota"], balconies: 0.3 });
    farBlock(s, r.range(55, 70), -20, 20, 30, r.range(24, 36), r.pick(MODERN), "piso");
  }
  // left side
  if (i >= 5 && i <= 7) campus(s);
  else if (i >= 11 && i <= 13) riversidePark(s);
  else {
    flat(s, -1, 21, 140, 0.1, 0xb9b08a);
    building(s, { side: -1, x: 22, z0: -3, z1: -20, depth: 16, floors: r.int(4, 8), color: r.pick(MODERN), style: "piso", shops: ["panaderia", "estanco"], balconies: 0.4 });
    building(s, { side: -1, x: 22, z0: -23, z1: -38, depth: 16, floors: r.int(4, 8), color: r.pick(MODERN), style: "piso", shops: ["heladeria", "zapateria"], balconies: 0.4 });
    farBlock(s, -r.range(55, 70), -20, 20, 30, r.range(24, 36), r.pick(MODERN), "piso");
  }
  if (i === 2) gantry(s, -20, "g-puente", "g-elvas");
  if (i === 7) gantry(s, -20, "g-centro", "g-badajoz");
  if (i === 12) gantry(s, -20, "g-elvas", "g-puente");
  if (i === 0) {
    b.boxB(5.0, 0.15, -3, 0.08, 3.0, 0.08, 0x555555, SOLID);
    b.sign("c-elvas", 5.0, 2.9, -3, 0.5, -Math.PI / 2);
  }
  // the loop closes: the white pylon straight ahead and the glass tower to the right, exactly
  // where puente-real draws them (slim stand-ins hidden inside the real ones once those load)
  if (i === s.count - 1) {
    const zr = -L; // puente-real segment 0 starts where this segment ends
    floodlit(s, "cool", () => pylon(b, zr - PYLON_SEG * L - 20, -13, FAR, true));
    torreCaja(b, TOWER_X, zr - L + TOWER_Z, 0.1, true, FAR, true);
  }
}
