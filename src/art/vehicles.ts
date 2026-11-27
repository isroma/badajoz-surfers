/**
 * Vehicles: cars (incl. taxis), scooters with riders, delivery vans, city buses and the ramp truck.
 * All are modelled with their FRONT towards -Z (parked: the runner comes up behind and sees the
 * rear). Moving vehicles are turned around by the obstacle factory so their lit front faces +Z.
 */
import type * as THREE from "three";
import { Builder, T, xf, type V3 } from "./geom";
import { GLASS, GLOW, PAINT, SOLID } from "./materials";
import { makeRng } from "./rng";

const TYRE = 0x1e1e22;
const TRIM = 0x2b2d31;
const CHROME = 0xc9ccd1;
const GLASS_TINT = 0x5d7287;
const HEAD_ON = 0xfff6d8;
const HEAD_OFF = 0x9aa0a8; // unlit lamp glass (kept in the GLOW bucket so parked/moving share geometry)
const TAIL = 0xe0141e;
const INDICATOR = 0xff9a1a;

/** When set (obstacle templates), wheels are collected here instead of merged into the body. */
export const wheelSink: { list: { x: number; z: number; r: number; w: number }[] | null } = { list: null };

/** One wheel at the origin of `b` (axis along X). */
export function wheelAt(b: Builder, x: number, y: number, z: number, r: number, w: number): void {
  b.add(T.cyl(10), xf(x, y, z, r, w, r, 0, 0, Math.PI / 2), TYRE, SOLID);
  b.add(T.cyl(8), xf(x + Math.sign(x) * 0.01, y, z, r * 0.55, w + 0.02, r * 0.55, 0, 0, Math.PI / 2), CHROME, SOLID);
  // hub spokes so the spin reads
  b.add(T.box, xf(x + Math.sign(x) * (w / 2 + 0.012), y, z, 0.01, r * 1.0, r * 0.14), 0x8a8d91, SOLID);
}

function wheel(b: Builder, x: number, z: number, r: number, w: number): void {
  if (wheelSink.list) {
    wheelSink.list.push({ x, z, r, w });
    return;
  }
  b.add(T.cyl(10), xf(x, r, z, r, w, r, 0, 0, Math.PI / 2), TYRE, SOLID);
  b.add(T.cyl(8), xf(x + Math.sign(x) * 0.01, r, z, r * 0.55, w + 0.02, r * 0.55, 0, 0, Math.PI / 2), CHROME, SOLID);
}

/** Symmetric hexahedron helper: bottom half-width/z-range and top half-width/z-range. */
function prism(b: Builder, y0: number, y1: number, hw0: number, z0a: number, z0b: number, hw1: number, z1a: number, z1b: number, color: THREE.ColorRepresentation, mat: THREE.Material): void {
  // z?a is the front (-Z) edge, z?b the rear (+Z) edge
  const c: V3[] = [
    [-hw0, y0, z0b], [hw0, y0, z0b], [hw0, y0, z0a], [-hw0, y0, z0a],
    [-hw1, y1, z1b], [hw1, y1, z1b], [hw1, y1, z1a], [-hw1, y1, z1a],
  ];
  b.hexa(c, color, mat);
}

const CAR_COLOURS = [0xc0392b, 0x2e86de, 0xf1c40f, 0x27ae60, 0xecf0f1, 0x34495e, 0x8e44ad, 0xe67e22, 0x95a5a6, 0x16a085, 0x1b1b1b, 0xd35400];

export type CarShape = "hatch" | "sedan" | "suv";

/** Seed bit that selects the "broken down / at the stop" variants (bonnet up, bus doors open). */
export const ROLE_VARIANT_BIT = 64;

export function buildCar(b: Builder, seedIn: number, lit: boolean): void {
  const broken = (seedIn & ROLE_VARIANT_BIT) !== 0;
  const seed = seedIn & ~ROLE_VARIANT_BIT;
  const r = makeRng(seed * 7919 + 17);
  const taxi = seed % 6 === 3;
  const shape: CarShape = taxi ? "sedan" : r.pick(["hatch", "sedan", "suv"] as const);
  const colour = taxi ? 0xf7f7f2 : r.pick(CAR_COLOURS);
  if (broken) brokenCarExtras(b, colour);
  const L = 4.3;
  const half = L / 2;
  const hw = 0.9;
  const beltY = shape === "suv" ? 0.98 : 0.86;
  const roofY = taxi ? 1.31 : 1.45;
  const baseY = 0.3;
  // cabin extents (front, rear) at the belt and at the roof
  const cab = shape === "hatch"
    ? { f0: -0.75, r0: 1.95, f1: -0.05, r1: 1.75 }
    : shape === "sedan"
      ? { f0: -0.8, r0: 1.25, f1: -0.1, r1: 0.75 }
      : { f0: -0.85, r0: 2.0, f1: -0.25, r1: 1.95 };
  const wr = shape === "suv" ? 0.36 : 0.32;
  // wheels and arches
  for (const z of [-1.35, 1.35]) {
    for (const x of [-0.8, 0.8]) wheel(b, x, z, wr, 0.24);
    b.box(0, wr + 0.04, z, 1.84, 0.2, 0.9, TRIM, SOLID);
  }
  // lower body: hood slopes down to the front, boot slightly at the rear
  const hoodFront = beltY - (shape === "suv" ? 0.08 : 0.16);
  prism(b, baseY, beltY, hw, -half + 0.05, half - 0.05, hw - 0.03, -half + 0.12, half - 0.08, colour, PAINT);
  prism(b, baseY + 0.25, hoodFront, hw - 0.005, -half, half - 0.06, hw - 0.04, -half + 0.05, half - 0.1, colour, PAINT);
  // greenhouse
  prism(b, beltY, roofY - 0.07, hw - 0.04, cab.f0, cab.r0, hw - 0.17, cab.f1, cab.r1, GLASS_TINT, GLASS);
  // roof slab and pillars
  prism(b, roofY - 0.08, roofY, hw - 0.16, cab.f1 - 0.02, cab.r1 + 0.02, hw - 0.2, cab.f1 + 0.05, cab.r1 - 0.03, colour, PAINT);
  const midZ = (cab.f1 + cab.r1) / 2 + 0.05;
  for (const sx of [-1, 1]) {
    b.beam([sx * (hw - 0.05), beltY, (cab.f0 + cab.f1) / 2 + 0.25], [sx * (hw - 0.15), roofY - 0.05, midZ - 0.1], 0.07, colour, PAINT);
    b.beam([sx * (hw - 0.04), beltY, cab.r0 - 0.08], [sx * (hw - 0.17), roofY - 0.05, cab.r1 - 0.02], 0.12, colour, PAINT);
    // mirrors
    b.box(sx * (hw + 0.05), beltY + 0.06, cab.f0 + 0.2, 0.1, 0.09, 0.14, colour, PAINT);
    // door lines and handles
    b.box(sx * (hw + 0.002), (baseY + beltY) / 2, 0.15, 0.01, beltY - baseY - 0.1, 0.02, TRIM, SOLID);
    b.box(sx * (hw + 0.01), beltY - 0.1, -0.15, 0.02, 0.03, 0.12, CHROME, SOLID);
    b.box(sx * (hw + 0.01), beltY - 0.1, 0.9, 0.02, 0.03, 0.12, CHROME, SOLID);
  }
  // bumpers
  b.box(0, baseY + 0.08, -half + 0.02, 1.82, 0.2, 0.12, TRIM, SOLID);
  b.box(0, baseY + 0.08, half - 0.02, 1.82, 0.2, 0.12, TRIM, SOLID);
  // front: grille, headlights, plate
  b.box(0, hoodFront - 0.17, -half - 0.005, 0.7, 0.14, 0.02, TRIM, SOLID);
  for (const sx of [-1, 1]) {
    b.box(sx * 0.62, hoodFront - 0.14, -half - 0.01, 0.34, 0.12, 0.04, lit ? HEAD_ON : HEAD_OFF, GLOW);
    b.box(sx * 0.82, hoodFront - 0.14, -half + 0.02, 0.06, 0.08, 0.04, INDICATOR, GLOW);
    // rear lights
    b.box(sx * 0.68, beltY - 0.17, half + 0.0, 0.34, 0.14, 0.04, TAIL, GLOW);
  }
  b.sign("plate", 0, baseY + 0.2, half + 0.045, 0.11);
  b.sign("plate", 0, baseY + 0.2, -half - 0.045, 0.11, Math.PI);
  // rear window gets a darker tint strip on hatch/suv tailgates
  if (shape !== "sedan") b.box(0, beltY + 0.02, half - 0.06, 1.2, 0.04, 0.04, TRIM, SOLID);
  if (taxi) {
    // TAXI roof sign with green light, and a diagonal coloured band on the front doors
    b.boxB(0, roofY, 0.35, 0.62, 0.13, 0.24, 0xffffff, SOLID);
    b.sign("taxi", 0, roofY + 0.065, 0.35 + 0.125, 0.11, 0, 0.52);
    b.sign("taxi", 0, roofY + 0.065, 0.35 - 0.125, 0.11, Math.PI, 0.52);
    b.box(0.22, roofY + 0.135, 0.35, 0.08, 0.03, 0.08, 0x3cff6a, GLOW);
    for (const sx of [-1, 1]) {
      b.add(T.box, xf(sx * (hw + 0.004), (baseY + beltY) / 2 + 0.03, -0.2, 0.012, 0.16, 1.2, 0.42, 0, 0), 0x1f8a3b, SOLID);
    }
  }
}

/** A broken-down car's extras: bonnet up (front, -Z) and the warning triangle on the road behind it. */
export function brokenCarExtras(b: Builder, colour: number): void {
  b.push(xf(0, 0.92, -0.95, 1, 1, 1, 0.45, 0, 0));
  b.box(0, 0.0, -0.55, 1.6, 0.04, 1.1, colour, PAINT);
  b.pop();
  // warning triangle (V-16 era aside) standing 0.4 m behind the rear bumper, inside the box
  b.push(xf(0, 0, 2.05, 1, 1, 1, 0, 0, 0));
  b.tri([-0.22, 0.03, 0], [0.22, 0.03, 0], [0, 0.42, 0], 0xd62828, SOLID);
  b.tri([0.22, 0.03, 0], [-0.22, 0.03, 0], [0, 0.42, 0], 0xd62828, SOLID);
  b.box(0, 0.015, 0, 0.3, 0.03, 0.12, 0x333333, SOLID);
  b.pop();
}

const MOTO_COLOURS = [0xd62828, 0x2a9d8f, 0xf4a261, 0x3a86ff, 0xe9c46a, 0xffffff, 0x6a4c93];

export function buildMoto(b: Builder, seed: number, lit: boolean): void {
  const r = makeRng(seed * 4241 + 3);
  const c = r.pick(MOTO_COLOURS);
  const delivery = seed % 2 === 0;
  // wheels
  for (const z of [-0.65, 0.65]) {
    b.add(T.cyl(10), xf(0, 0.24, z, 0.24, 0.13, 0.24, 0, 0, Math.PI / 2), TYRE, SOLID);
    b.add(T.cyl(8), xf(0, 0.24, z, 0.12, 0.15, 0.12, 0, 0, Math.PI / 2), CHROME, SOLID);
  }
  // body: rear cowl, footboard, front shield
  prism(b, 0.3, 0.78, 0.17, 0.05, 0.85, 0.2, 0.15, 0.75, c, PAINT);
  b.boxB(0, 0.28, -0.12, 0.3, 0.1, 0.62, TRIM, SOLID);
  prism(b, 0.3, 1.0, 0.2, -0.62, -0.45, 0.17, -0.55, -0.4, c, PAINT);
  b.box(0, 0.4, -0.66, 0.1, 0.3, 0.2, c, PAINT); // front mudguard
  // seat
  b.boxB(0, 0.78, 0.35, 0.3, 0.09, 0.6, 0x1b1b1b, SOLID);
  // steering column + handlebar + headlight
  b.beam([0, 0.95, -0.5], [0, 1.08, -0.47], 0.08, c, PAINT);
  b.beam([-0.36, 1.08, -0.45], [0.36, 1.08, -0.45], 0.04, TRIM, SOLID);
  b.box(0, 1.0, -0.56, 0.14, 0.1, 0.06, lit ? HEAD_ON : HEAD_OFF, GLOW);
  b.box(0, 0.7, 0.86, 0.14, 0.06, 0.04, TAIL, GLOW);
  b.sign("plate", 0, 0.52, 0.87, 0.08, 0, 0.22);
  // rider: legs, torso, arms, helmet
  const jacket = r.pick([0x2b2d42, 0x6b705c, 0x9d0208, 0x264653]);
  const trousers = 0x283044;
  for (const sx of [-1, 1]) {
    b.beam([sx * 0.13, 0.9, 0.3], [sx * 0.15, 0.82, -0.08], 0.14, trousers, SOLID);
    b.beam([sx * 0.15, 0.82, -0.08], [sx * 0.16, 0.42, -0.12], 0.12, trousers, SOLID);
    b.box(sx * 0.16, 0.4, -0.18, 0.1, 0.08, 0.22, 0x111111, SOLID);
  }
  b.add(T.capsule(0.8, 3, 8), xf(0, 1.0, 0.22, 0.2, 0.22, 0.15, -0.2, 0, 0), jacket, SOLID);
  for (const sx of [-1, 1]) {
    b.beam([sx * 0.2, 1.1, 0.15], [sx * 0.3, 1.04, -0.42], 0.09, jacket, SOLID);
    b.sphere(sx * 0.32, 1.06, -0.45, 0.05, 0.05, 0.05, 0x111111, SOLID, 6, 4);
  }
  const helmet = r.pick([0xffffff, 0xd62828, 0x111111, 0xf4d35e, 0x3a86ff]);
  b.sphere(0, 1.17, 0.12, 0.15, 0.13, 0.16, helmet, PAINT, 10, 7);
  b.box(0, 1.15, -0.03, 0.2, 0.08, 0.03, 0x222831, GLASS);
  if (delivery) {
    const box = r.pick([0x2ec4b6, 0xff7f11, 0xe71d36, 0x6a994e]);
    b.boxB(0, 0.88, 0.72, 0.5, 0.42, 0.46, box, SOLID);
    b.boxB(0, 1.29, 0.72, 0.52, 0.01, 0.48, 0xffffff, SOLID);
    b.box(0, 1.08, 0.955, 0.34, 0.12, 0.01, 0xffffff, SOLID);
  }
}

const LIVERIES = ["l-jamones", "l-frutas", "l-mensajeria", ""] as const;
const LIVERY_BODY: Record<string, number> = {
  "l-jamones": 0xf4ead5,
  "l-frutas": 0xffffff,
  "l-mensajeria": 0xffd23f,
  "": 0xf5f5f5,
};

export function buildVan(b: Builder, seed: number, lit: boolean): void {
  const livery = LIVERIES[seed % LIVERIES.length] ?? "";
  const body = LIVERY_BODY[livery] ?? 0xf5f5f5;
  const L = 5.4;
  const half = L / 2;
  const hw = 1.0;
  const top = 2.6;
  for (const z of [-1.7, 1.75]) {
    for (const x of [-0.85, 0.85]) wheel(b, x, z, 0.36, 0.26);
    b.box(0, 0.42, z, 2.0, 0.24, 0.95, TRIM, SOLID);
  }
  // cargo box + cab
  b.span(-hw, hw, 0.36, top, -1.15, half, body, PAINT);
  prism(b, 0.36, 1.25, hw, -half, -1.15, hw, -half + 0.05, -1.15, body, PAINT);
  prism(b, 1.25, top - 0.12, hw, -half + 0.05, -1.15, hw - 0.06, -1.95, -1.15, GLASS_TINT, GLASS);
  prism(b, top - 0.12, top - 0.02, hw - 0.05, -1.95, -1.15, hw - 0.08, -1.9, -1.15, body, PAINT);
  for (const sx of [-1, 1]) {
    b.beam([sx * (hw - 0.02), 1.25, -half + 0.1], [sx * (hw - 0.07), top - 0.1, -1.95], 0.1, body, PAINT);
    // cab door window
    b.box(sx * (hw + 0.005), 1.75, -1.55, 0.01, 0.6, 0.6, GLASS_TINT, GLASS);
    b.box(sx * (hw + 0.07), 1.55, -2.05, 0.1, 0.22, 0.1, TRIM, SOLID);
    // sliding door line
    b.box(sx * (hw + 0.004), 1.35, -0.95, 0.01, 1.7, 0.03, 0xbbbbbb, SOLID);
    // vertical tail light cluster
    b.box(sx * 0.9, 1.0, half + 0.02, 0.14, 0.5, 0.04, TAIL, GLOW);
    b.box(sx * 0.9, 0.7, half + 0.02, 0.14, 0.1, 0.04, INDICATOR, GLOW);
    b.box(sx * 0.68, 1.38, -half - 0.01, 0.34, 0.14, 0.04, lit ? HEAD_ON : HEAD_OFF, GLOW);
  }
  // rear doors split, bumpers, plates, grille
  b.box(0, 1.5, half + 0.01, 0.03, 2.1, 0.02, 0x999999, SOLID);
  b.box(0, 0.45, half + 0.05, 2.0, 0.22, 0.12, TRIM, SOLID);
  b.box(0, 0.45, -half - 0.03, 2.0, 0.24, 0.12, TRIM, SOLID);
  b.box(0, 1.0, -half - 0.01, 1.0, 0.2, 0.03, TRIM, SOLID);
  b.sign("plate", 0, 0.68, half + 0.03, 0.11);
  b.sign("plate", 0, 0.75, -half - 0.03, 0.11, Math.PI);
  b.box(0, top + 0.0, 0.8, 1.6, 0.02, 2.8, 0xdddddd, SOLID); // roof rib
  if (livery) {
    for (const sx of [-1, 1]) b.sign(livery, sx * (hw + 0.012), 1.55, 0.75, 1.0, sx * Math.PI / 2, 3.4);
    b.sign(livery, 0, 1.75, half + 0.025, 0.55, 0, 1.75);
    b.sign(livery, 0, 1.0, -half - 0.035, 0.3, Math.PI, 0.9);
  }
}

export function buildBus(b: Builder, seedIn: number, lit: boolean): void {
  const doorsOpen = (seedIn & ROLE_VARIANT_BIT) !== 0;
  const seed = seedIn & ~ROLE_VARIANT_BIT;
  const L = 11;
  const half = L / 2;
  const hw = 1.25;
  const top = 2.95;
  const red = 0xd62828;
  const white = 0xf7f7f4;
  const line = ["led-6", "led-1", "led-9", "led-18", "led-3"][seed % 5] ?? "led-6";
  for (const z of [-3.3, 3.0]) {
    for (const x of [-1.05, 1.05]) wheel(b, x, z, 0.48, 0.3);
    b.box(0, 0.55, z, 2.52, 0.24, 1.2, TRIM, SOLID);
  }
  // body: white upper, red lower skirt and roof band
  b.span(-hw, hw, 0.32, 1.15, -half, half, red, PAINT);
  // (the red roof band sits on the white body: no coplanar tops for the runner to stand on)
  b.span(-hw, hw, 1.15, top - 0.2, -half, half, white, PAINT);
  b.span(-hw, hw, top - 0.2, top, -half, half, red, PAINT);
  b.span(-hw - 0.002, hw + 0.002, top - 0.2, top - 0.1, -half + 0.3, half - 0.05, white, PAINT);
  // side window band (dark glass) with pillars
  for (const sx of [-1, 1]) {
    b.box(sx * (hw + 0.01), 1.95, 0.4, 0.02, 1.0, L - 2.4, 0x26323f, GLASS);
    for (let k = 0; k < 7; k++) b.box(sx * (hw + 0.02), 1.95, -4.4 + k * 1.55 + 0.6, 0.02, 1.0, 0.1, white, PAINT);
    b.sign("bus-urbano", sx * (hw + 0.025), 0.78, 0.6, 0.55, sx * Math.PI / 2, 3.3);
  }
  // doors on the right side (+X): dark glass panels
  for (const z of [-4.5, -0.5]) {
    if (doorsOpen) {
      // folded-open door leaves and the lit interior step
      b.box(hw + 0.02, 1.4, z, 0.02, 2.1, 1.1, 0x0b0f14, SOLID);
      for (const dz of [-0.62, 0.62]) b.box(hw + 0.08, 1.4, z + dz, 0.04, 2.0, 0.12, 0x1b2733, GLASS);
      b.box(hw - 0.2, 0.42, z, 0.45, 0.06, 1.0, 0xffe9b0, GLOW);
    } else b.box(hw + 0.03, 1.4, z, 0.02, 2.1, 1.1, 0x1b2733, GLASS);
  }
  // front: big windscreen, LED display, lights
  b.span(-hw + 0.08, hw - 0.08, 1.2, top - 0.42, -half - 0.02, -half, 0x26323f, GLASS);
  b.span(-hw + 0.1, hw - 0.1, top - 0.38, top - 0.06, -half - 0.02, -half, 0x111111, SOLID);
  b.sign(line, 0, top - 0.22, -half - 0.025, 0.26, Math.PI, 1.9);
  for (const sx of [-1, 1]) {
    b.box(sx * 0.95, 0.75, -half - 0.01, 0.4, 0.16, 0.04, lit ? HEAD_ON : HEAD_OFF, GLOW);
    b.box(sx * 1.0, 1.0, half + 0.01, 0.18, 0.5, 0.04, TAIL, GLOW);
    b.box(sx * 1.0, 0.68, half + 0.01, 0.18, 0.12, 0.04, INDICATOR, GLOW);
  }
  b.sign("plate", 0, 0.55, -half - 0.03, 0.11, Math.PI);
  // rear: small window, engine grille, display, plate
  b.box(0, 2.25, half + 0.01, 2.0, 0.7, 0.02, 0x26323f, GLASS);
  b.sign(line, 0, top - 0.2, half + 0.02, 0.22, 0, 1.6);
  for (let k = 0; k < 5; k++) b.box(0, 1.2 + k * 0.1, half + 0.015, 1.4, 0.04, 0.02, 0x555555, SOLID);
  b.sign("plate", 0, 0.62, half + 0.03, 0.11);
  b.box(0, 0.42, half + 0.05, 2.5, 0.18, 0.1, TRIM, SOLID);
  b.box(0, 0.42, -half - 0.05, 2.5, 0.18, 0.1, TRIM, SOLID);
  // roof: A/C units and hatch (low, below 3.1)
  b.span(-0.8, 0.8, top, 3.1, -2.6, -0.4, 0xd9dadc, SOLID);
  b.span(-0.6, 0.6, top, 3.08, 1.6, 2.8, 0xd9dadc, SOLID);
  for (let k = 0; k < 4; k++) b.span(-0.7, 0.7, 3.1, 3.105, -2.4 + k * 0.5, -2.25 + k * 0.5, 0x8a8d91, SOLID);
  b.span(-0.35, 0.35, top, 3.02, 3.6, 4.3, 0x3c4650, GLASS);
}

export function buildRampTruck(b: Builder, seed: number): void {
  const L = 7;
  const half = L / 2;
  const H = 3.1;
  const W = 2.4;
  const slope = Math.atan2(H, L);
  const cabColour = [0xe76f51, 0x2a9d8f, 0x3a86ff, 0xe63946][seed % 4] ?? 0xe76f51;
  const rampY = (z: number): number => (H * (half - z)) / L;
  // wheels: two rear axles and the cab axle
  for (const z of [1.0, -0.1, -2.7]) for (const x of [-0.95, 0.95]) wheel(b, x, z, 0.45, 0.34);
  // chassis
  b.span(-0.6, 0.6, 0.5, 0.85, -3.4, 1.0, TRIM, SOLID);
  // cab at the -Z end, under the top of the ramp
  b.span(-1.15, 1.15, 0.55, 2.05, -half + 0.05, -1.7, cabColour, PAINT);
  b.span(-1.1, 1.1, 1.3, 1.95, -half + 0.03, -half + 0.07, 0x2c3e50, GLASS);
  for (const sx of [-1, 1]) {
    b.box(sx * 1.16, 1.6, -2.65, 0.02, 0.6, 0.9, 0x2c3e50, GLASS);
    b.box(sx * 0.75, 0.85, -half - 0.0, 0.36, 0.16, 0.06, HEAD_OFF, SOLID);
    b.box(sx * 1.16, 1.6, -3.0, 0.06, 0.3, 0.08, TRIM, SOLID);
  }
  b.box(0, 0.62, -half + 0.02, 2.3, 0.2, 0.1, TRIM, SOLID);
  b.sign("plate", 0, 0.62, -half - 0.01, 0.11, Math.PI);
  // ramp deck: a thick slab from the ground (+Z end) up to H (-Z end)
  const t = 0.14;
  const hw = W / 2 - 0.08;
  const deck: V3[] = [
    [-hw, -t, half], [hw, -t, half], [hw, H - t, -half], [-hw, H - t, -half],
    [-hw, 0.0, half], [hw, 0.0, half], [hw, H, -half], [-hw, H, -half],
  ];
  b.hexa(deck, 0xffcf1a, SOLID, false);
  // chevron surface (arrows point uphill, towards -Z)
  const len = Math.hypot(H, L);
  b.push(xf(0, H / 2 + 0.012 * Math.cos(slope), 0.012 * Math.sin(slope), 1, 1, 1, -(Math.PI / 2 - slope), 0, 0));
  b.sign("chevrons", 0, 0, 0, len, 0, hw * 2 - 0.12);
  b.pop();
  // side rails along the ramp + support posts
  for (const sx of [-1, 1]) {
    b.beam([sx * (W / 2 - 0.04), 0.05, half - 0.2], [sx * (W / 2 - 0.04), H - 0.07, -half + 0.05], 0.1, 0xe63946, SOLID);
    for (const z of [-1.4, 0.0, 1.4]) {
      b.beam([sx * 0.95, 0.8, z], [sx * 0.95, rampY(z) - 0.1, z], 0.12, 0x6c757d, SOLID);
    }
    // amber beacons on the cab front
    b.box(sx * 0.95, 1.95, -half - 0.0, 0.14, 0.12, 0.06, INDICATOR, GLOW);
    // tail lights low at the ramp foot
    b.box(sx * 1.05, 0.16, half - 0.05, 0.2, 0.08, 0.04, TAIL, GLOW);
  }
  // steel lip at the foot of the ramp
  b.span(-hw, hw, 0.0, 0.03, half - 0.05, half, 0x9aa0a6, SOLID);
  // hydraulic rams
  for (const sx of [-0.5, 0.5]) b.beam([sx, 0.85, -0.6], [sx, rampY(-0.6) - 0.12, -1.1], 0.1, 0xb0b0b0, SOLID);
}
