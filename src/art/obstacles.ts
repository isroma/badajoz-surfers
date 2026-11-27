/**
 * Obstacles. Each (kind, variant, moving) combination is built once into a merged template
 * (one mesh per material, <= 6 draw calls) and instanced by sharing geometry and materials.
 * Origin on the ground at the centre of the OBSTACLE_DEFS footprint; the runner sees the +Z face.
 */
import * as THREE from "three";
import { OBSTACLE_DEFS, type ObstacleKind } from "../contracts";
import { Builder, T, instance, xf } from "./geom";
import { CLOTH, GLOW, NET, PAINT, SOLID } from "./materials";
import { buildPedestrian } from "./pedestrians";
import { ROLE_VARIANT_BIT, buildBus, buildCar, buildMoto, buildRampTruck, buildVan, wheelAt, wheelSink } from "./vehicles";

const RED = 0xd62828;
const WHITE = 0xf7f7f2;
const ORANGE = 0xff6b1a;
const AMBER = 0xffb000;

function stripes(b: Builder, x0: number, x1: number, y: number, h: number, z: number, d: number, n: number, mat: THREE.Material = SOLID): void {
  const w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) b.box(x0 + w * (i + 0.5), y, z, w, h, d, i % 2 ? WHITE : RED, mat);
}

function buildValla(b: Builder): void {
  // red/white roadworks barrier on two A-frame feet
  stripes(b, -1.05, 1.05, 0.66, 0.36, 0, 0.05, 7);
  b.box(0, 0.66, -0.03, 2.1, 0.36, 0.01, 0xdddddd, SOLID);
  for (const x of [-0.95, 0.95]) {
    b.beam([x, 0.02, 0.13], [x, 0.86, 0.0], 0.05, 0xe8e8e8, SOLID);
    b.beam([x, 0.02, -0.13], [x, 0.86, 0.0], 0.05, 0xe8e8e8, SOLID);
    b.box(x, 0.03, 0, 0.12, 0.06, 0.3, 0x333333, SOLID);
  }
  b.box(0.95, 0.875, 0, 0.12, 0.05, 0.08, AMBER, GLOW); // flashing lamp
  b.box(0.95, 0.86, 0.045, 0.06, 0.06, 0.01, AMBER, GLOW);
}

function buildConos(b: Builder): void {
  for (const x of [-0.78, 0, 0.78]) {
    b.box(x, 0.025, 0, 0.4, 0.05, 0.4, 0x2b2b2b, SOLID);
    b.add(T.frustum(0.08, 12), xf(x, 0.05 + 0.31, 0, 0.18, 0.62, 0.18), ORANGE, SOLID);
    b.add(T.frustum(0.82, 12), xf(x, 0.3, 0, 0.13, 0.08, 0.13), WHITE, SOLID);
    b.add(T.frustum(0.78, 12), xf(x, 0.46, 0, 0.09, 0.07, 0.09), WHITE, SOLID);
    b.cyl(x, 0.66, 0, 0.03, 0.04, ORANGE, 8, SOLID);
  }
  // striped bar joining the cones, slotted through their tops
  const n = 8;
  for (let i = 0; i < n; i++) {
    const x0 = -0.78 + (1.56 * i) / n;
    b.add(T.cyl(8), xf(x0 + 1.56 / n / 2, 0.58, 0, 0.035, 1.56 / n, 0.035, 0, 0, Math.PI / 2), i % 2 ? WHITE : RED, SOLID);
  }
}

function buildTerraza(b: Builder, seed: number): void {
  const chair = [0xc62828, 0x9aa0a6, 0x2e7d32, 0x1565c0][seed % 4] ?? 0xc62828;
  const top = 0x9aa0a6;
  // round aluminium table
  b.cyl(0, 0, 0, 0.26, 0.03, 0x6c757d, 10, SOLID);
  b.cyl(0, 0, 0, 0.035, 0.72, 0x8a8f96, 8, SOLID);
  b.cyl(0, 0.72, 0, 0.45, 0.035, top, 16, SOLID);
  b.cyl(0, 0.755, 0, 0.44, 0.004, 0xe9ecef, 16, SOLID);
  // two cañas of beer with foam
  for (const [x, z] of [[-0.18, 0.12], [0.2, -0.1]] as const) {
    b.cyl(x, 0.76, z, 0.04, 0.12, 0xf2b01e, 10, SOLID);
    b.cyl(x, 0.88, z, 0.042, 0.035, 0xfffbea, 10, SOLID);
  }
  // plate of jamón
  b.cyl(0.02, 0.76, 0.18, 0.15, 0.015, 0xffffff, 14, SOLID);
  for (let i = 0; i < 5; i++) {
    b.add(T.box, xf(-0.06 + i * 0.04, 0.78, 0.18 + (i % 2) * 0.03, 0.06, 0.008, 0.14, 0, 0.4 + i * 0.3, 0), i % 2 ? 0xb83a3a : 0xd46a6a, SOLID);
  }
  // bread basket
  b.cyl(0.18, 0.76, -0.24, 0.07, 0.05, 0xb5895a, 8, SOLID);
  b.blob(0.18, 0.83, -0.24, 0.05, 0.03, 0.04, 0xe0b06a, SOLID);
  // two chairs facing the table
  for (const sx of [-1, 1]) {
    const cx = sx * 0.78;
    b.boxB(cx, 0.43, 0, 0.42, 0.05, 0.44, chair, PAINT);
    for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]] as const) {
      b.boxB(cx + dx, 0, dz, 0.035, 0.43, 0.035, 0x8a8f96, SOLID);
    }
    // backrest on the outer side
    b.beam([cx + sx * 0.2, 0.45, -0.18], [cx + sx * 0.26, 0.92, -0.18], 0.035, 0x8a8f96, SOLID);
    b.beam([cx + sx * 0.2, 0.45, 0.18], [cx + sx * 0.26, 0.92, 0.18], 0.035, 0x8a8f96, SOLID);
    b.add(T.box, xf(cx + sx * 0.245, 0.78, 0, 0.04, 0.24, 0.44, 0, 0, -sx * 0.12), chair, PAINT);
  }
}

function buildVallaLarga(b: Builder): void {
  const W = 7.8;
  stripes(b, -W / 2 + 0.05, W / 2 - 0.05, 0.72, 0.26, 0, 0.05, 15);
  stripes(b, -W / 2 + 0.05, W / 2 - 0.05, 0.38, 0.2, 0, 0.05, 15);
  for (let i = 0; i < 5; i++) {
    const x = -W / 2 + 0.15 + (i * (W - 0.3)) / 4;
    b.boxB(x, 0, 0, 0.08, 0.86, 0.08, 0xe8e8e8, SOLID);
    b.box(x, 0.03, 0, 0.16, 0.06, 0.3, 0x333333, SOLID);
    if (i % 2 === 0) b.box(x, 0.88, 0, 0.1, 0.04, 0.1, AMBER, GLOW);
  }
  // "OBRAS" sign in the middle of the front face
  b.box(0, 0.6, 0.04, 1.3, 0.56, 0.03, 0x111111, SOLID);
  b.sign("obras", 0, 0.6, 0.057, 0.5);
  b.sign("peligro-obras", 2.0, 0.55, 0.035, 0.22, 0, 1.2);
  b.sign("peligro-obras", -2.0, 0.55, 0.035, 0.22, 0, 1.2);
}

function buildAndamio(b: Builder, seed: number): void {
  const W = 2.4;
  const L = 2.0;
  const yMin = 1.25;
  const yMax = 3.2;
  const pole = 0x9aa0a6;
  const hw = W / 2 - 0.04;
  const hl = L / 2 - 0.04;
  // thin legs at the lane edges (outside the collision box below yMin is fine)
  for (const x of [-hw, hw]) for (const z of [-hl, hl]) {
    b.boxB(x, 0, z, 0.06, yMax, 0.06, pole, SOLID);
    b.box(x, 0.02, z, 0.08, 0.04, 0.08, 0x555555, SOLID);
  }
  // working platform (planks) at yMin, toe boards and top rails
  b.span(-hw, hw, yMin, yMin + 0.08, -hl, hl, pole, SOLID);
  for (let i = 0; i < 5; i++) {
    const z = -hl + 0.2 + i * ((2 * hl - 0.4) / 4);
    b.span(-hw + 0.03, hw - 0.03, yMin + 0.08, yMin + 0.13, z - 0.17, z + 0.17, i % 2 ? 0xc89b5a : 0xb5854a, SOLID);
  }
  b.span(-hw, hw, yMin + 0.13, yMin + 0.3, hl - 0.03, hl, 0xffcc00, SOLID);
  b.span(-hw, hw, yMin + 0.13, yMin + 0.3, -hl, -hl + 0.03, 0xffcc00, SOLID);
  // upper deck and rails
  b.span(-hw, hw, yMax - 0.2, yMax - 0.12, -hl, hl, pole, SOLID);
  for (let i = 0; i < 4; i++) {
    const z = -hl + 0.25 + i * ((2 * hl - 0.5) / 3);
    b.span(-hw + 0.03, hw - 0.03, yMax - 0.12, yMax - 0.07, z - 0.2, z + 0.2, 0xc89b5a, SOLID);
  }
  for (const z of [-hl, hl]) {
    b.span(-hw, hw, yMax - 0.05, yMax, z - 0.03, z + 0.03, pole, SOLID);
    b.span(-hw, hw, (yMin + yMax) / 2, (yMin + yMax) / 2 + 0.05, z - 0.03, z + 0.03, pole, SOLID);
  }
  // diagonal braces on the sides, above the platform
  for (const x of [-hw, hw]) {
    b.beam([x, yMin + 0.1, -hl], [x, yMax - 0.15, hl], 0.04, pole, SOLID);
    b.beam([x, 0.3, -hl], [x, yMin, hl], 0.04, pole, SOLID);
  }
  // green safety netting across the front between the decks, with a warning banner
  b.quad(xf(0, (yMin + 0.3 + yMax - 0.2) / 2, hl + 0.05, W - 0.1, yMax - 0.5 - yMin - 0.05, 1), 0x2f9e44, NET);
  b.quad(xf(0, (yMin + 0.3 + yMax - 0.2) / 2, -hl - 0.05, W - 0.1, yMax - 0.5 - yMin - 0.05, 1, 0, Math.PI, 0), 0x2f9e44, NET);
  b.sign("peligro-obras", 0, yMin + 0.55, hl + 0.08, 0.3, 0, 1.6);
  // a couple of buckets and a plank on top
  b.cyl(-0.6, yMin + 0.13, 0.2, 0.15, 0.3, seed % 2 ? 0x1565c0 : 0x333333, 8, SOLID);
}

const BANNERS = ["b-feria", "b-carnaval", "b-almossassa", "b-noche"] as const;

function buildPancarta(b: Builder, seed: number): void {
  const name = BANNERS[((seed % 4) + 4) % 4] ?? "b-feria";
  const yMin = 1.25;
  const yMax = 2.25;
  const postX = 4.05;
  for (const sx of [-1, 1]) {
    b.cyl(sx * postX, 0, 0, 0.05, 2.65, 0x5c6168, 8, SOLID);
    b.cyl(sx * postX, 0, 0, 0.16, 0.12, 0x444444, 8, SOLID);
    b.sphere(sx * postX, 2.68, 0, 0.07, 0.07, 0.07, 0xe9c46a, SOLID, 6, 4);
    // ropes from the post tops to the banner corners
    b.beam([sx * postX, 2.6, 0], [sx * 3.8, yMax, 0], 0.02, 0xdddddd, SOLID);
    b.beam([sx * postX, yMin + 0.05, 0], [sx * 3.8, yMin + 0.05, 0], 0.02, 0xdddddd, SOLID);
  }
  // banner cloth: printed on both faces
  b.box(0, (yMin + yMax) / 2, 0, 7.6, yMax - yMin, 0.02, 0xffffff, CLOTH);
  b.sign(name, 0, (yMin + yMax) / 2, 0.016, yMax - yMin, 0, 7.6);
  b.sign(name, 0, (yMin + yMax) / 2, -0.016, yMax - yMin, Math.PI, 7.6);
  // little pennants on a string above
  const flags = [0xffd23f, 0xd62828, 0x2a9d8f, 0xffffff];
  for (let i = 0; i < 18; i++) {
    const x = -3.8 + (i + 0.5) * (7.6 / 18);
    const sag = 2.5 - 0.12 * Math.cos(((x + 3.8) / 7.6) * Math.PI * 2 - Math.PI) - 0.12;
    b.tri([x - 0.15, sag, 0], [x + 0.15, sag, 0], [x, sag - 0.2, 0], flags[i % 4] ?? 0xffffff, CLOTH);
  }
}

const CONT = [
  { colour: 0xf2c200, sign: "envases" },
  { colour: 0x1565c0, sign: "papel" },
  { colour: 0x2e7d32, sign: "vidrio" },
] as const;

function buildContenedor(b: Builder, seed: number): void {
  const c = CONT[seed % 3] ?? CONT[0];
  // tapered body with a flat lid at 1.5 m (stand-able)
  const hwB = 1.0;
  const hwT = 1.06;
  b.hexa([
    [-hwB, 0.18, 0.6], [hwB, 0.18, 0.6], [hwB, 0.18, -0.6], [-hwB, 0.18, -0.6],
    [-hwT, 1.4, 0.66], [hwT, 1.4, 0.66], [hwT, 1.4, -0.66], [-hwT, 1.4, -0.66],
  ], c.colour, PAINT);
  b.span(-1.1, 1.1, 1.4, 1.47, -0.7, 0.7, c.colour, PAINT);
  b.span(-1.08, 1.08, 1.44, 1.5, -0.68, 0.68, new THREE.Color(c.colour).multiplyScalar(0.8), PAINT);
  // reinforcing ribs, handles, wheels, pedal
  for (const x of [-0.7, 0, 0.7]) b.box(x, 0.8, 0.64, 0.06, 1.1, 0.04, new THREE.Color(c.colour).multiplyScalar(0.85), SOLID);
  for (const sx of [-1, 1]) {
    b.box(sx * 1.1, 1.15, 0, 0.06, 0.06, 0.6, 0x333333, SOLID);
    for (const z of [-0.45, 0.45]) {
      b.add(T.cyl(8), xf(sx * 0.82, 0.09, z, 0.09, 0.08, 0.09, 0, 0, Math.PI / 2), 0x1e1e1e, SOLID);
    }
  }
  b.box(0, 0.2, 0.66, 0.5, 0.06, 0.12, 0x333333, SOLID);
  b.sign(c.sign, 0, 1.05, 0.67, 0.28, 0, 1.1);
  // slot / opening on the front
  b.box(0, 1.28, 0.66, 0.7, 0.08, 0.02, 0x1a1a1a, SOLID);
  // recycling triangle
  b.tri([-0.12, 0.55, 0.665], [0.12, 0.55, 0.665], [0, 0.76, 0.665], 0xffffff, SOLID);
}

/** A row of three cast-iron bollards (the old town's "bolardos") with a chain. */
function buildBolardos(b: Builder): void {
  for (const x of [-0.65, 0, 0.65]) {
    b.cyl(x, 0, 0, 0.11, 0.7, 0x24272a, 8, SOLID, 0.09);
    b.sphere(x, 0.74, 0, 0.1, 0.08, 0.1, 0x24272a, SOLID, 8, 4);
    b.cyl(x, 0.55, 0, 0.115, 0.05, 0xc9a23a, 8, SOLID);
  }
  for (const x of [-0.33, 0.33]) b.add(T.torus(Math.PI, 0.04, 4, 8), xf(x, 0.62, 0, 0.32, 0.15, 0.32, 0, 0, Math.PI), 0x1a1a1a, SOLID);
}

/** Big concrete street planter with a shrub or a small orange tree. */
function buildMaceta(b: Builder, seed: number): void {
  const col = [0xb8afa0, 0x8f8a82, 0xb5653a][seed % 3] ?? 0xb8afa0;
  b.box(0, 0.32, 0, 1.25, 0.64, 1.25, col, SOLID);
  b.box(0, 0.66, 0, 1.3, 0.06, 1.3, new THREE.Color(col).multiplyScalar(0.85).getHex(), SOLID);
  b.box(0, 0.68, 0, 1.12, 0.02, 1.12, 0x5a4632, SOLID);
  b.blob(0, 0.86, 0, 0.55, 0.22, 0.55, 0x3e6b2f, SOLID);
  b.blob(0.15, 0.93, -0.1, 0.35, 0.12, 0.35, 0x4f7f38, SOLID);
}

/** A single bar table with one chair (aluminium, the brewery's colour on the backrest). */
function buildMesa(b: Builder, seed: number): void {
  const brand = [0xc8102e, 0x1f4f8a, 0x2e7d32, 0xf2b705][seed % 4] ?? 0xc8102e;
  b.cyl(-0.25, 0, 0, 0.04, 0.72, 0x9aa0a6, 6, SOLID);
  b.cyl(-0.25, 0, 0, 0.25, 0.03, 0x9aa0a6, 8, SOLID);
  b.cyl(-0.25, 0.72, 0, 0.36, 0.04, 0xd9dcde, 14, SOLID);
  b.box(-0.25, 0.78, 0.1, 0.07, 0.1, 0.07, 0xf3c623, SOLID);
  // chair
  const cx = 0.38;
  for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]] as const) b.box(cx + dx, 0.22, dz, 0.035, 0.44, 0.035, 0x9aa0a6, SOLID);
  b.box(cx, 0.45, 0, 0.42, 0.04, 0.42, 0x9aa0a6, SOLID);
  b.box(cx + 0.2, 0.7, 0, 0.04, 0.45, 0.42, brand, SOLID);
}

type Builders = (b: Builder, seed: number, lit: boolean) => void;

const BUILD: Record<ObstacleKind, Builders> = {
  valla: (b) => buildValla(b),
  conos: (b) => buildConos(b),
  terraza: (b, s) => buildTerraza(b, s),
  "valla-larga": (b) => buildVallaLarga(b),
  andamio: (b, s) => buildAndamio(b, s),
  pancarta: (b, s) => buildPancarta(b, s),
  contenedor: (b, s) => buildContenedor(b, s),
  coche: (b, s, lit) => buildCar(b, s, lit),
  moto: (b, s, lit) => buildMoto(b, s, lit),
  furgoneta: (b, s, lit) => buildVan(b, s, lit),
  bus: (b, s, lit) => buildBus(b, s, lit),
  "camion-rampa": (b, s) => buildRampTruck(b, s),
  bolardos: (b) => buildBolardos(b),
  maceta: (b, s) => buildMaceta(b, s),
  mesa: (b, s) => buildMesa(b, s),
  peaton: () => undefined,
};

/** Number of visual variants per kind (seeds are folded into this range so caches stay small). */
const VARIANTS: Record<ObstacleKind, number> = {
  valla: 1,
  conos: 1,
  terraza: 4,
  "valla-larga": 1,
  andamio: 2,
  pancarta: 4,
  contenedor: 3,
  coche: 12,
  moto: 6,
  furgoneta: 4,
  bus: 4,
  "camion-rampa": 4,
  bolardos: 1,
  maceta: 3,
  mesa: 4,
  peaton: 8,
};

const cache = new Map<string, THREE.Group>();

/**
 * Shrink a freshly built template (never grow) so mirrors, bumpers and plates stay inside the
 * collision box footprint and below its top. The pancarta's posts deliberately stand outside.
 */
function fitToBox(tpl: THREE.Group, kind: ObstacleKind): void {
  const d = OBSTACLE_DEFS[kind];
  const box = new THREE.Box3();
  for (const m of tpl.children) if (m instanceof THREE.Mesh) box.union(((m.geometry as THREE.BufferGeometry).boundingBox ?? new THREE.Box3()).clone().translate(m.position));
  const ext = (lo: number, hi: number): number => Math.max(Math.abs(lo), Math.abs(hi));
  const sx = Math.min(1, d.width / 2 / ext(box.min.x, box.max.x));
  const sz = Math.min(1, d.length / 2 / ext(box.min.z, box.max.z));
  const sy = Math.min(1, d.yMax / box.max.y);
  if (sx === 1 && sy === 1 && sz === 1) return;
  for (const m of tpl.children) {
    if (!(m instanceof THREE.Mesh)) continue;
    const g = m.geometry as THREE.BufferGeometry;
    g.scale(sx, sy, sz);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    m.position.multiply(new THREE.Vector3(sx, sy, sz));
  }
}

function template(kind: ObstacleKind, variant: number, moving: boolean): THREE.Group {
  const key = `${kind}:${variant}:${moving}`;
  let tpl = cache.get(key);
  if (tpl) return tpl;
  if (kind === "peaton") {
    tpl = buildPedestrian(variant, moving);
    cache.set(key, tpl);
    return tpl;
  }
  const b = new Builder();
  wheelSink.list = [];
  BUILD[kind](b, variant, moving);
  const wheels = wheelSink.list;
  wheelSink.list = null;
  tpl = b.build(true);
  // wheels as separate meshes, one per axle, origin on the axle: the engine spins "wheel*" about X
  const axles = new Map<number, { x: number; z: number; r: number; w: number }[]>();
  for (const w of wheels) {
    const k = Math.round(w.z * 100);
    const l = axles.get(k) ?? [];
    l.push(w);
    axles.set(k, l);
  }
  let wi = 0;
  for (const list of axles.values()) {
    const first = list[0];
    if (!first) continue;
    const wb = new Builder();
    for (const w of list) wheelAt(wb, w.x, 0, 0, w.r, w.w);
    const g = wb.build(true);
    for (const c of [...g.children]) {
      if (!(c instanceof THREE.Mesh)) continue;
      c.name = `wheel${wi++}`;
      c.position.set(0, first.r, first.z);
      tpl.add(c);
    }
  }
  if (kind !== "pancarta") fitToBox(tpl, kind);
  if (moving && OBSTACLE_DEFS[kind].vehicle) {
    // a moving vehicle differs from the parked one only in its lamps (GLOW bucket): share the rest
    const parked = template(kind, variant, false);
    for (const m of tpl.children) {
      if (!(m instanceof THREE.Mesh) || m.material === GLOW) continue;
      if (m.name.startsWith("wheel")) {
        const twinW = parked.children.find((p) => p instanceof THREE.Mesh && p.name === m.name && p.material === m.material);
        if (twinW instanceof THREE.Mesh) {
          (m.geometry as THREE.BufferGeometry).dispose();
          m.geometry = twinW.geometry;
        }
        continue;
      }
      const twin = parked.children.find((p) => p instanceof THREE.Mesh && !p.name.startsWith("wheel") && p.material === m.material);
      if (twin instanceof THREE.Mesh) {
        (m.geometry as THREE.BufferGeometry).dispose();
        m.geometry = twin.geometry;
      }
    }
  }
  cache.set(key, tpl);
  return tpl;
}

export function createObstacle(kind: ObstacleKind, seed: number, moving = false, spanWidth?: number): THREE.Object3D {
  const def = OBSTACLE_DEFS[kind];
  const isMoving = moving && (def.vehicle || kind === "peaton");
  // any 32-bit (or odd) seed folds into a small fixed set of variants: caches stay bounded
  const n = VARIANTS[kind];
  const safe = Number.isFinite(seed) ? Math.floor(Math.abs(seed)) : 0;
  // the role bit (vehicles.ts ROLE_VARIANT_BIT) survives the folding: bus doors open, car broken down
  const roleBit = (kind === "coche" || kind === "bus") && (safe & ROLE_VARIANT_BIT) !== 0 ? ROLE_VARIANT_BIT : 0;
  const variant = (safe % n) | roleBit;
  const tpl = template(kind, variant, isMoving);
  const inner = instance(tpl);
  // moving vehicles drive towards the runner: turn them so the front faces +Z
  if (isMoving && def.vehicle) inner.rotation.y = Math.PI;
  // street-wide obstacles stretch to the real street's runnable width
  if (spanWidth !== undefined && spanWidth > 0 && (kind === "valla-larga" || kind === "pancarta")) inner.scale.x = spanWidth / def.width;
  const root = new THREE.Group();
  root.name = `obstacle:${kind}`;
  root.add(inner);
  return root;
}
