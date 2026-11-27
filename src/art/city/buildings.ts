/**
 * Buildings in the flat style (docs/design.md): every real footprint extruded to its LiDAR
 * height, a flat wall colour from the building palette (varied per building), a regular grid of
 * flat windows (the tiny shared window texture: u = bays / 4, v = floors / 4), a ground-floor
 * band, a darker band at the base (baked), one accent per typology, a simple roof (flat with a
 * parapet, or terracotta hips in the old town). Typology comes from the data's tags first.
 * Permanent layer, grouped in spatial tiles: two draw calls per tile (flat + windows).
 */
import * as THREE from "three";
import { PAL } from "../palette";
import { Acc } from "./acc";
import { flatMaterial, windowsMaterial } from "./cmats";
import { CLEARANCE, type CityCtx, type PreparedBuilding, type Typology } from "./context";
import { centroid, obb, pointInRing, signedArea, type P2 } from "./geo";
import { hash01 } from "./shared";

const GROUND_FLOOR = 3.8;
const FLOOR_H = 3.0;
const BAY = 3.2;
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

export interface BuildingStyle {
  wall: THREE.Color;
  /** Ground-floor band colour (shops, plinth). */
  ground: THREE.Color;
  accent: THREE.Color;
  accentKind: "brick" | "albero" | "balconies" | "awnings" | "glass" | "none";
  roof: THREE.Color;
  floors: number;
  Gf: number;
  flat: boolean;
  parapet: number;
  windows: boolean;
}

const c = (hex: number): THREE.Color => new THREE.Color(hex);

/** Per-building style (deterministic): shared by the extrusion and the near-route relief. */
export function styleOf(pb: PreparedBuilding): BuildingStyle {
  const r = pb.seed;
  const wall = c(PAL.buildings[Math.floor(hash01(pb.index, 9) * PAL.buildings.length)] ?? PAL.buildings[0]);
  const t: Typology = pb.typ;
  let accentKind: BuildingStyle["accentKind"] = "none";
  let accent = c(PAL.brick);
  let ground = wall.clone().multiplyScalar(0.93);
  let roof = c(PAL.flatRoof);
  let windows = true;
  switch (t) {
    case "brick":
      accentKind = "brick";
      wall.lerp(c(PAL.brick), 0.55);
      ground = c(PAL.buildings[2]);
      break;
    case "render":
      accentKind = r < 0.5 ? "balconies" : "awnings";
      break;
    case "casco":
      wall.setHex(0xfbf8f1);
      accentKind = "albero";
      accent = c(PAL.albero);
      ground = c(PAL.albero);
      roof = c(PAL.terracotta);
      break;
    case "plazaAlta":
      // the red and white painted houses over the arcades
      wall.setHex(0xfbf8f1);
      accentKind = "brick";
      accent = c(PAL.danger);
      ground = c(0xfbf8f1);
      roof = c(PAL.terracotta);
      break;
    case "modern":
      accentKind = "glass";
      accent = c(PAL.glass);
      break;
    case "shed":
    case "retail":
      wall.setHex(PAL.buildings[3]);
      ground = c(PAL.kerb);
      accentKind = "none";
      windows = t === "retail";
      break;
    case "school":
      wall.setHex(0xf2e6d6);
      accentKind = "brick";
      accent = c(PAL.brick);
      ground = c(PAL.brick);
      break;
    case "church":
    case "stone":
      wall.setHex(PAL.stone);
      ground = c(PAL.stone).multiplyScalar(0.94);
      windows = false;
      roof = c(PAL.terracotta);
      break;
    case "hospital":
      wall.setHex(0xfcf8f1);
      accentKind = "glass";
      accent = c(PAL.glass);
      break;
    case "theatre":
    case "public":
      wall.setHex(0xf7efe3);
      ground = c(PAL.stone);
      accentKind = "none";
      break;
    case "hotel":
      accentKind = "glass";
      accent = c(PAL.glass);
      break;
  }
  const tall = pb.top - pb.G;
  let Gf = pb.G + GROUND_FLOOR;
  let floors = Math.max(0, Math.round((pb.top - Gf) / FLOOR_H));
  if (tall < 5.2) {
    Gf = pb.top;
    floors = 0;
  }
  const flat = !pb.pitched;
  return { wall, ground, accent, accentKind, roof, floors, Gf, flat, parapet: flat ? (t === "casco" ? 0.5 : 0.9) : 0, windows };
}

export interface FacadeAccs {
  flat: Acc;
  win: Acc;
}

export function newFacadeAccs(): FacadeAccs {
  return { flat: new Acc(), win: new Acc() };
}

/** Walls of one ring: ground band (+ baked dark base), window band, parapet. */
function walls(accs: FacadeAccs, ctx: CityCtx, pb: PreparedBuilding, st: BuildingStyle, ring: P2[], groundOf: (p: P2) => number, yFrom: number | null, yTo: number, parapet: number): void {
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const C = new THREE.Vector3();
  const D = new THREE.Vector3();
  const n = new THREE.Vector3();
  const dark = st.ground.clone().multiplyScalar(0.88); // a soft, low-contrast base band
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const d = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(d.x - a.x, d.z - a.z);
    if (len < 0.05) continue;
    n.set(-(d.z - a.z) / len, 0, (d.x - a.x) / len);
    const party = ctx.isParty(pb.index, a.x, a.z, d.x, d.z);
    const ga = yFrom ?? groundOf(a);
    const gd = yFrom ?? groundOf(d);
    const q = (acc: Acc, y0a: number, y0d: number, y1a: number, y1d: number, c0: THREE.Color, c1: THREE.Color, uv?: [number, number, number, number]): void => {
      if (y1a <= y0a && y1d <= y0d) return;
      A.set(a.x, y0a, a.z);
      B.set(d.x, y0d, d.z);
      C.set(d.x, y1d, d.z);
      D.set(a.x, y1a, a.z);
      const [u0, v0, u1, v1] = uv ?? [0, 0, 0, 0];
      acc.quad(A, B, C, D, [u0, v0], [u1, v0], [u1, v1], [u0, v1], c0, c0, c1, c1, n);
    };
    const gTop = Math.min(st.Gf, yTo);
    const simple = pb.src.dist > 12;
    // far from the route (only seen across the skyline): one quad for the base and no parapet
    const far = pb.src.dist > 60;
    // below the street (hides slopes) and the ground floor with its darker base band
    if (yFrom === null && far) q(accs.flat, ga - 3, gd - 3, gTop, gTop, dark, st.ground);
    else if (yFrom === null && simple) {
      q(accs.flat, ga - 3, gd - 3, ga + 0.6, gd + 0.6, dark, dark);
      q(accs.flat, ga + 0.6, gd + 0.6, gTop, gTop, st.ground, st.ground);
    }
    else if (yFrom === null) {
      q(accs.flat, ga - 3, gd - 3, ga, gd, dark, dark);
      q(accs.flat, ga, gd, Math.min(gTop, ga + 0.6), Math.min(gTop, gd + 0.6), dark, dark);
      q(accs.flat, Math.min(gTop, ga + 0.6), Math.min(gTop, gd + 0.6), gTop, gTop, st.ground, st.ground);
    } else q(accs.flat, ga, gd, gTop, gTop, st.ground, st.ground);
    // upper floors: windows (not on party walls or windowless typologies)
    if (st.floors > 0 && yTo > gTop) {
      const bays = Math.max(1, Math.round(len / BAY));
      if (party || !st.windows) q(accs.flat, gTop, gTop, yTo, yTo, st.wall, st.wall);
      else {
        const accentBand = st.accentKind === "brick" ? Math.min(yTo, gTop + FLOOR_H * Math.min(2, st.floors)) : gTop;
        if (accentBand > gTop) q(accs.win, gTop, gTop, accentBand, accentBand, st.accent, st.accent, [0, 0, bays / 4, (accentBand - gTop) / FLOOR_H / 4]);
        q(accs.win, accentBand, accentBand, yTo, yTo, st.wall, st.wall, [0, ((accentBand - gTop) / FLOOR_H) / 4, bays / 4, st.floors / 4]);
      }
    }
    if (parapet > 0 && far) {
      // the roof edge alone reads from that far
    } else if (parapet > 0 && simple) {
      const pc = st.accentKind === "albero" ? st.accent : st.wall.clone().multiplyScalar(0.97);
      q(accs.flat, yTo, yTo, yTo + parapet, yTo + parapet, pc, pc);
    } else if (parapet > 0) {
      const pc = st.accentKind === "albero" ? st.accent : st.wall.clone().multiplyScalar(0.97);
      q(accs.flat, yTo, yTo, yTo + parapet, yTo + parapet, pc, pc);
      // inside face
      A.set(d.x, yTo, d.z);
      B.set(a.x, yTo, a.z);
      C.set(a.x, yTo + parapet, a.z);
      D.set(d.x, yTo + parapet, d.z);
      accs.flat.quad(A, B, C, D, [0, 0], [0, 0], [0, 0], [0, 0], pc, pc, pc, pc, n.clone().negate());
    }
  }
}

function roofFlat(acc: Acc, ring: P2[], y: number, color: THREE.Color, down = false): void {
  const contour = ring.map((p) => new THREE.Vector2(p.x, p.z));
  let tris: number[][];
  try {
    tris = THREE.ShapeUtils.triangulateShape(contour, []);
  } catch {
    return;
  }
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const cc = new THREE.Vector3();
  for (const t of tris) {
    const p0 = ring[t[0]!]!;
    const p1 = ring[t[1]!]!;
    const p2 = ring[t[2]!]!;
    a.set(p0.x, y, p0.z);
    b.set(p1.x, y, p1.z);
    cc.set(p2.x, y, p2.z);
    const cy = (b.z - a.z) * (cc.x - a.x) - (b.x - a.x) * (cc.z - a.z);
    const flip = down ? cy > 0 : cy < 0;
    const [q1, q2] = flip ? [cc, b] : [b, cc];
    acc.tri(a, q1, q2, [0, 0], [0, 0], [0, 0], color, down ? DOWN : UP);
  }
}

/** Hip roof over the footprint's oriented box, eave at y. */
function hipRoof(acc: Acc, ring: P2[], y: number, col: THREE.Color): boolean {
  const o = obb(ring);
  const area = -signedArea(ring);
  if (ring.length > 10 || area / (4 * o.hl * o.hw) < 0.82 || o.hw < 1.5) return false;
  const hl = o.hl + 0.3;
  const hw = o.hw + 0.3;
  const rise = Math.min(2.4, o.hw * 0.5);
  const ux = o.ux;
  const uz = o.uz;
  const vx = -uz;
  const vz = ux;
  const P = (u: number, v: number, h: number): THREE.Vector3 => new THREE.Vector3(o.cx + ux * u + vx * v, y + h, o.cz + uz * u + vz * v);
  const r = Math.max(0, hl - hw);
  const e = [P(-hl, -hw, 0), P(hl, -hw, 0), P(hl, hw, 0), P(-hl, hw, 0)];
  const r0 = P(-r, 0, rise);
  const r1 = P(r, 0, rise);
  const faces: THREE.Vector3[][] = [[e[0]!, e[1]!, r1, r0], [e[2]!, e[3]!, r0, r1], [e[1]!, e[2]!, r1], [e[3]!, e[0]!, r0]];
  faces.forEach((pts, k) => {
    const nrm = new THREE.Vector3().subVectors(pts[1]!, pts[0]!).cross(new THREE.Vector3().subVectors(pts[2]!, pts[0]!));
    const list = nrm.y < 0 ? [...pts].reverse() : pts;
    const cc = col.clone().multiplyScalar(k % 2 ? 0.92 : 1);
    if (list.length === 4) acc.quad(list[0]!, list[1]!, list[2]!, list[3]!, [0, 0], [0, 0], [0, 0], [0, 0], cc);
    else acc.tri(list[0]!, list[1]!, list[2]!, [0, 0], [0, 0], [0, 0], cc);
  });
  return true;
}

/** Church towers / bell gables and the like: simple flat volumes. */
function extras(acc: Acc, pb: PreparedBuilding, st: BuildingStyle, ring: P2[]): void {
  if (pb.typ !== "church" || pb.src.id === "r9755446") return;
  const o = obb(ring);
  const tall = pb.top - pb.G;
  // tower at the end of the long axis (or a bell gable on small chapels)
  const ex = o.cx + o.ux * (o.hl - 2.5);
  const ez = o.cz + o.uz * (o.hl - 2.5);
  const w = Math.min(5, o.hw * 1.2);
  const h = Math.max(tall + 7, (pb.src.peak ?? 0) || 0);
  const box = (x: number, z: number, hw: number, y0: number, y1: number, col: THREE.Color): void => {
    const cs: P2[] = [
      { x: x - o.ux * hw - o.uz * hw, z: z - o.uz * hw + o.ux * hw },
      { x: x + o.ux * hw - o.uz * hw, z: z + o.uz * hw + o.ux * hw },
      { x: x + o.ux * hw + o.uz * hw, z: z + o.uz * hw - o.ux * hw },
      { x: x - o.ux * hw + o.uz * hw, z: z - o.uz * hw - o.ux * hw },
    ];
    const r = signedArea(cs) > 0 ? cs.reverse() : cs;
    for (let i = 0; i < 4; i++) {
      const a = r[i]!;
      const b = r[(i + 1) % 4]!;
      acc.quad(new THREE.Vector3(a.x, y0, a.z), new THREE.Vector3(b.x, y0, b.z), new THREE.Vector3(b.x, y1, b.z), new THREE.Vector3(a.x, y1, a.z), [0, 0], [0, 0], [0, 0], [0, 0], col);
    }
    roofFlat(acc, r, y1, col.clone().multiplyScalar(0.95));
  };
  if (o.hl > 9 && tall > 6) {
    box(ex, ez, w / 2, pb.G, pb.G + h, st.wall);
    // belfry: dark openings band and a little pyramid cap
    box(ex, ez, w / 2 + 0.05, pb.G + h - 3.2, pb.G + h - 1.2, c(0x6b5d4e));
    box(ex, ez, w / 2 + 0.2, pb.G + h, pb.G + h + 0.4, st.wall.clone().multiplyScalar(0.95));
  } else {
    // espadaña: a flat bell gable on the front
    const gx = o.cx + o.ux * o.hl;
    const gz = o.cz + o.uz * o.hl;
    box(gx, gz, 1.2, pb.top - 0.5, pb.top + 3, st.wall);
  }
}

/** Extrude one prepared building into the accumulators. */
export function emitBuilding(accs: FacadeAccs, ctx: CityCtx, pb: PreparedBuilding): void {
  const st = styleOf(pb);
  const b = pb.src;
  const groundOf = (p: P2): number => (pb.streetGround ? ctx.streetLevel(p.x, p.z, b.s) : b.h0);
  const roofY = pb.top;
  const rings = [pb.ring, ...pb.extra];
  if (pb.upperRing) {
    // an arch over the street: piers below the clearance, the building above it
    const arch = Math.min(roofY - 1.5, pb.G + CLEARANCE);
    for (const r of rings) walls(accs, ctx, pb, { ...st, floors: 0, Gf: arch }, r, groundOf, null, arch, 0);
    walls(accs, ctx, pb, { ...st, Gf: arch }, pb.upperRing, groundOf, arch, roofY, st.parapet);
    roofFlat(accs.flat, pb.upperRing, arch, st.wall.clone().multiplyScalar(0.7), true);
    if (st.flat) roofFlat(accs.flat, pb.upperRing, roofY, st.roof);
    else roofFlat(accs.flat, pb.upperRing, roofY, st.roof);
    return;
  }
  for (const r of rings) {
    const pitched = pb.pitched && hipRoof(accs.flat, r, roofY - 0.6, st.roof);
    walls(accs, ctx, pb, st, r, groundOf, null, pitched ? roofY - 0.6 : roofY, pitched ? 0 : st.parapet);
    if (!pitched) roofFlat(accs.flat, r, roofY, st.roof);
    extras(accs.flat, pb, st, r);
    // lift overrun on apartment blocks
    const tall = roofY - pb.G;
    if (st.flat && tall > 11 && -signedArea(r) > 120 && pb.typ !== "shed") {
      const cc = centroid(r);
      const w = 2.2 + pb.seed * 1.5;
      const box: P2[] = [
        { x: cc.x - w, z: cc.z - w * 0.7 }, { x: cc.x - w, z: cc.z + w * 0.7 }, { x: cc.x + w, z: cc.z + w * 0.7 }, { x: cc.x + w, z: cc.z - w * 0.7 },
      ];
      if (box.every((p) => pointInRing(p.x, p.z, r))) {
        walls(accs, ctx, pb, { ...st, floors: 0, Gf: roofY + 3, ground: st.wall, windows: false }, box, () => roofY, roofY, roofY + 2.6, 0);
        roofFlat(accs.flat, box, roofY + 2.6, st.roof);
      }
    }
  }
}

/** Build the whole permanent building layer: big tiles, two draw calls each. */
export function buildAllBuildings(ctx: CityCtx): THREE.Group {
  const g = new THREE.Group();
  g.name = "buildings";
  const tiles = new Map<string, FacadeAccs>();
  for (const pb of ctx.buildings) {
    const T = 360;
    const key = `${Math.floor((pb.ring[0]?.x ?? 0) / T)},${Math.floor((pb.ring[0]?.z ?? 0) / T)}`;
    let a = tiles.get(key);
    if (!a) tiles.set(key, (a = newFacadeAccs()));
    emitBuilding(a, ctx, pb);
  }
  for (const [key, a] of tiles) {
    const f = a.flat.mesh(flatMaterial(), `walls-${key}`);
    const w = a.win.mesh(windowsMaterial(), `windows-${key}`);
    for (const m of [f, w]) if (m) g.add(m);
  }
  return g;
}

export function typDefColour(t: Typology): number {
  return t === "casco" ? PAL.albero : PAL.brick;
}
