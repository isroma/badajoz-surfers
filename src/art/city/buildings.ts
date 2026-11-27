/**
 * Every building footprint extruded to its LiDAR height with the facade atlas: bays laid out per
 * real edge, ground floor / upper floors / parapet bands, blank party walls, baked ambient
 * occlusion at the street, flat roofs with parapets and lift overruns, clay hip roofs in the old
 * town. Permanent layer (built once), grouped per zone for frustum culling.
 */
import * as THREE from "three";
import { Acc } from "./acc";
import { facadeMaterial } from "./cmats";
import { CLEARANCE, type CityCtx, type PreparedBuilding, type Typology } from "./context";
import { centroid, obb, pointInRing, signedArea, type P2 } from "./geo";
import { hash01 } from "./shared";
import { FT, GROUND_SCALE } from "./textures";

const GROUND_FLOOR = 3.8;
const FLOOR_H = 3.0;

interface TypDef {
  bay: number;
  upper: readonly number[];
  ground: readonly number[];
  plain: number;
  tints: readonly number[];
  blinds: readonly number[];
  parapet: number;
}

const TYP: Record<Typology, TypDef> = {
  brick: {
    bay: 3.3,
    upper: [FT.brickBalcony, FT.brickMirador, FT.brickAwning, FT.brickTerrace, FT.brickOchre, FT.brickBalcony],
    ground: [FT.shopShutter, FT.portalShop, FT.shopShutter],
    plain: FT.brickPlain,
    tints: [0xffffff, 0xf4ece4, 0xfff6ee, 0xe9e2da, 0xfbf3e6],
    blinds: [0, 2, 0, 1],
    parapet: 1.0,
  },
  render: {
    bay: 3.2,
    upper: [FT.renderBalcony, FT.renderWindows, FT.renderMirador, FT.renderBalcony],
    ground: [FT.stoneShops, FT.shopShutter, FT.portalShop],
    plain: FT.renderPlain,
    tints: [0xfff8ec, 0xf8e8c6, 0xf6dfb4, 0xf3e6d8, 0xfdf6ea, 0xf1d3ac, 0xe9e4da],
    blinds: [0, 1, 0, 2],
    parapet: 1.0,
  },
  casco: {
    bay: 3.0,
    upper: [FT.cascoBalcony, FT.cascoWindows],
    ground: [FT.cascoHouse, FT.cascoGround, FT.cascoShop],
    plain: FT.cascoPlain,
    tints: [0xffffff, 0xfffdf8, 0xfbf8f0, 0xf6dc94, 0xffffff, 0xfaf3e3],
    blinds: [3, 2, 3, 1],
    parapet: 0.5,
  },
  modern: {
    bay: 3.4,
    upper: [FT.modernStrip, FT.renderMirador, FT.modernStrip, FT.glassCurtain],
    ground: [FT.glassShop, FT.portalShop],
    plain: FT.modernPlain,
    tints: [0xffffff, 0xf1f1ee, 0xe8e6e0, 0xf6f2ea],
    blinds: [1, 1, 0],
    parapet: 1.1,
  },
  shed: {
    bay: 4.0,
    upper: [FT.shed],
    ground: [FT.shedGround],
    plain: FT.shed,
    tints: [0xffffff, 0xece6da, 0xe0e2e2, 0xf2ebdc],
    blinds: [1],
    parapet: 0.6,
  },
  stone: {
    bay: 3.6,
    upper: [FT.stone],
    ground: [FT.stonePlain],
    plain: FT.stonePlain,
    tints: [0xffffff, 0xf4ede0],
    blinds: [2],
    parapet: 0.8,
  },
  plazaAlta: {
    bay: 3.2,
    upper: [FT.plazaAlta],
    ground: [FT.plazaAltaArcade],
    plain: FT.cascoPlain,
    tints: [0xffffff],
    blinds: [3],
    parapet: 0.4,
  },
};

export function typDef(t: Typology): TypDef {
  return TYP[t];
}

const _c = new THREE.Color();
const _ca = new THREE.Color();
const _cb = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

export interface BuildingStyle {
  def: TypDef;
  upper: number;
  ground: number;
  tint: THREE.Color;
  blind: number;
  floors: number;
  /** Bottom of the upper floors (absolute y). */
  Gf: number;
  topV: number;
  eave: number;
  flat: boolean;
}

/** Per-building style choices (deterministic): shared by the extrusion and the relief. */
export function styleOf(pb: PreparedBuilding): BuildingStyle {
  const def = TYP[pb.typ];
  const r = pb.seed;
  const upper = def.upper[Math.floor(r * def.upper.length) % def.upper.length]!;
  const ground = def.ground[Math.floor(hash01(pb.index, 5) * def.ground.length) % def.ground.length]!;
  const tint = new THREE.Color(def.tints[Math.floor(hash01(pb.index, 9) * def.tints.length) % def.tints.length]!);
  tint.multiplyScalar(0.94 + hash01(pb.index, 11) * 0.08);
  const blind = def.blinds[Math.floor(hash01(pb.index, 13) * def.blinds.length) % def.blinds.length]!;
  const tall = pb.top - pb.G;
  let Gf = pb.G + GROUND_FLOOR;
  let floors = Math.max(0, Math.round((pb.top - Gf) / FLOOR_H));
  if (tall < 5.2) {
    Gf = pb.top;
    floors = 0;
  }
  const flat = !pb.pitched;
  return { def, upper, ground, tint, blind, floors, Gf, topV: 1 + floors, eave: pb.top, flat };
}

/** f (facade v coordinate) at height y on a vertex whose street level is g. */
function fAt(y: number, g: number, st: BuildingStyle, top: number): number {
  if (y <= g) return (y - g) / 3;
  if (y <= st.Gf) return (y - g) / Math.max(0.5, st.Gf - g);
  if (st.floors === 0) return 1 + (y - st.Gf) / 3;
  if (y <= top) return 1 + (st.floors * (y - st.Gf)) / Math.max(0.5, top - st.Gf);
  return st.topV + (y - top) / 3;
}

export interface FacadeAccs {
  facade: Acc;
  flatRoof: Acc;
  tileRoof: Acc;
}

export function newFacadeAccs(): FacadeAccs {
  return {
    facade: new Acc({ aTile: 4, aSeed: 2 }),
    // roofs share the facade atlas (cells FT.roofFlat / FT.roofTile): one draw call per tile
    flatRoof: new Acc({ aTile: 4, aSeed: 2 }).set("aTile", FT.roofFlat, FT.roofFlat, FT.roofFlat, 1e4),
    tileRoof: new Acc({ aTile: 4, aSeed: 2 }).set("aTile", FT.roofTile, FT.roofTile, FT.roofTile, 1e4),
  };
}

/** Walls of one ring between per-vertex bottoms and a common top. */
function walls(
  acc: Acc, ctx: CityCtx, pb: PreparedBuilding, st: BuildingStyle, ring: P2[], groundOf: (p: P2) => number,
  yFrom: ((g: number) => number) | null, yTo: number, parapet: number, bayPhase: number, simple = false,
): void {
  const def = st.def;
  const pa = new THREE.Vector3();
  const pb3 = new THREE.Vector3();
  const pc = new THREE.Vector3();
  const pd = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const d = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(d.x - a.x, d.z - a.z);
    if (len < 0.05) continue;
    n.set(-(d.z - a.z) / len, 0, (d.x - a.x) / len);
    const party = ctx.isParty(pb.index, a.x, a.z, d.x, d.z);
    const bays = Math.max(1, Math.round(len / def.bay));
    const u0 = bayPhase;
    const u1 = bayPhase + bays;
    // party walls (medianeras): bare brick, grey render or the building's own plaster
    const pv = hash01(pb.index, i + 101);
    const partyTile = pb.typ === "casco" || pb.typ === "plazaAlta" ? def.plain : pv < 0.3 ? FT.brickPlain : pv < 0.55 ? FT.modernPlain : def.plain;
    const tile = party ? [partyTile, partyTile, partyTile, 1e4] : [st.upper, st.ground, def.plain, st.topV];
    acc.set("aTile", ...tile);
    const ga = groundOf(a);
    const gd = groundOf(d);
    const top = yTo + parapet;
    if (simple && !yFrom) {
      // far buildings: one band of upper floors from the ground, and the parapet
      acc.set("aTile", party ? def.plain : st.upper, party ? def.plain : st.upper, def.plain, 1e4);
      const fb = (y: number, g: number): number => 1 + (y - g) / FLOOR_H;
      const dk = st.tint.clone().multiplyScalar(0.7);
      pa.set(a.x, ga - 3, a.z);
      pb3.set(d.x, gd - 3, d.z);
      pc.set(d.x, yTo, d.z);
      pd.set(a.x, yTo, a.z);
      acc.quad(pa, pb3, pc, pd, [u0, fb(ga - 3, ga)], [u1, fb(gd - 3, gd)], [u1, fb(yTo, gd)], [u0, fb(yTo, ga)], dk, dk, st.tint, st.tint, n);
      if (parapet > 0) {
        acc.set("aTile", def.plain, def.plain, def.plain, 1e4);
        pa.set(a.x, yTo, a.z);
        pb3.set(d.x, yTo, d.z);
        pc.set(d.x, top, d.z);
        pd.set(a.x, top, a.z);
        acc.quad(pa, pb3, pc, pd, [u0, 2], [u1, 2], [u1, 2.3], [u0, 2.3], st.tint, st.tint, st.tint, st.tint, n);
      }
      continue;
    }
    // horizontal band boundaries (absolute y); per-vertex bottoms
    const ya0 = yFrom ? yFrom(ga) : ga - 3;
    const yd0 = yFrom ? yFrom(gd) : gd - 3;
    const cuts: [number, number][] = [[ya0, yd0]];
    const addCut = (y: number): void => {
      const last = cuts[cuts.length - 1]!;
      if (y > last[0] + 0.05 && y > last[1] + 0.05 && y < top - 0.05) cuts.push([y, y]);
    };
    if (!yFrom) {
      cuts.push([ga, gd]);
      addCut(Math.min(st.Gf, yTo));
    } else addCut(Math.min(st.Gf, yTo));
    addCut(yTo);
    cuts.push([top, top]);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const [yaB, ydB] = cuts[k]!;
      const [yaT, ydT] = cuts[k + 1]!;
      if (yaT <= yaB && ydT <= ydB) continue;
      pa.set(a.x, yaB, a.z);
      pb3.set(d.x, ydB, d.z);
      pc.set(d.x, ydT, d.z);
      pd.set(a.x, yaT, a.z);
      const fa0 = fAt(yaB, ga, st, yTo);
      const fd0 = fAt(ydB, gd, st, yTo);
      const fa1 = fAt(yaT, ga, st, yTo);
      const fd1 = fAt(ydT, gd, st, yTo);
      // baked ambient occlusion: dark at the street, full at the first-floor line
      const ao = (y: number, g: number): number => (y <= g ? 0.5 : y >= st.Gf ? 1 : 0.62 + 0.38 * Math.min(1, (y - g) / 2.6));
      const cA = _c.copy(st.tint).multiplyScalar(ao(yaB, ga)).clone();
      const cB = _ca.copy(st.tint).multiplyScalar(ao(ydB, gd)).clone();
      const cC = _cb.copy(st.tint).multiplyScalar(ao(ydT, gd)).clone();
      const cD = new THREE.Color().copy(st.tint).multiplyScalar(ao(yaT, ga));
      acc.quad(pa, pb3, pc, pd, [u0, fa0], [u1, fd0], [u1, fd1], [u0, fa1], cA, cB, cC, cD, n);
      if (k === cuts.length - 2 && parapet > 0) {
        // inside face of the parapet
        pa.set(a.x, yTo, a.z);
        pb3.set(d.x, yTo, d.z);
        acc.set("aTile", def.plain, def.plain, def.plain, 1e4);
        const ni = n.clone().negate();
        acc.quad(pb3, pa, pd, pc, [u1, 2], [u0, 2], [u0, 2.3], [u1, 2.3], st.tint, st.tint, st.tint, st.tint, ni);
        acc.set("aTile", ...tile);
      }
    }
  }
}

function roofFlat(acc: Acc, ring: P2[], y: number, color: THREE.Color, scale: number, down = false): void {
  const contour = ring.map((p) => new THREE.Vector2(p.x, p.z));
  let tris: number[][];
  try {
    tris = THREE.ShapeUtils.triangulateShape(contour, []);
  } catch {
    return;
  }
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const t of tris) {
    const p0 = ring[t[0]!]!;
    const p1 = ring[t[1]!]!;
    const p2 = ring[t[2]!]!;
    a.set(p0.x, y, p0.z);
    b.set(p1.x, y, p1.z);
    c.set(p2.x, y, p2.z);
    // upward (or downward) facing: cross_y = dz1*dx2 - dx1*dz2
    const cy = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    const flip = down ? cy > 0 : cy < 0;
    const [q1, q2] = flip ? [c, b] : [b, c];
    acc.tri(a, q1, q2, [a.x / scale, 1000 + a.z / scale], [q1.x / scale, 1000 + q1.z / scale], [q2.x / scale, 1000 + q2.z / scale], color, down ? DOWN : UP);
  }
}

/** Hip roof over the footprint's oriented box, eave at y. */
function hipRoof(acc: Acc, ring: P2[], y: number, seed: number): boolean {
  const o = obb(ring);
  const area = -signedArea(ring);
  if (ring.length > 10 || area / (4 * o.hl * o.hw) < 0.82 || o.hw < 1.5) return false;
  const ov = 0.3;
  const hl = o.hl + ov;
  const hw = o.hw + ov;
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
  const col = new THREE.Color().setHSL(0.04, 0.35, 0.62 + seed * 0.1);
  const S = 1.5;
  const uvOf = (p: THREE.Vector3, along: THREE.Vector2, across: THREE.Vector2): [number, number] => [(p.x * along.x + p.z * along.y) / S, 1000 + ((p.x * across.x + p.z * across.y) / S) * 1.1];
  const faces: [THREE.Vector3[], THREE.Vector2, THREE.Vector2][] = [
    [[e[0]!, e[1]!, r1, r0], new THREE.Vector2(ux, uz), new THREE.Vector2(vx, vz)],
    [[e[2]!, e[3]!, r0, r1], new THREE.Vector2(-ux, -uz), new THREE.Vector2(-vx, -vz)],
    [[e[1]!, e[2]!, r1], new THREE.Vector2(vx, vz), new THREE.Vector2(-ux, -uz)],
    [[e[3]!, e[0]!, r0], new THREE.Vector2(-vx, -vz), new THREE.Vector2(ux, uz)],
  ];
  for (const [pts, al, ac] of faces) {
    // make the face point up
    const nrm = new THREE.Vector3().subVectors(pts[1]!, pts[0]!).cross(new THREE.Vector3().subVectors(pts[2]!, pts[0]!));
    const list = nrm.y < 0 ? [...pts].reverse() : pts;
    if (list.length === 4) acc.quad(list[0]!, list[1]!, list[2]!, list[3]!, uvOf(list[0]!, al, ac), uvOf(list[1]!, al, ac), uvOf(list[2]!, al, ac), uvOf(list[3]!, al, ac), col);
    else acc.tri(list[0]!, list[1]!, list[2]!, uvOf(list[0]!, al, ac), uvOf(list[1]!, al, ac), uvOf(list[2]!, al, ac), col);
  }
  return true;
}

/** Extrude one prepared building into the accumulators. */
export function emitBuilding(accs: FacadeAccs, ctx: CityCtx, pb: PreparedBuilding): void {
  const st = styleOf(pb);
  const b = pb.src;
  const groundOf = (p: P2): number => (pb.streetGround ? ctx.streetLevel(p.x, p.z, b.s) : b.h0);
  accs.facade.set("aSeed", Math.floor(pb.seed * 97), st.blind);
  const phase = Math.floor(hash01(pb.index, 3) * 2);
  const parapet = st.flat ? st.def.parapet : 0;
  const roofY = pb.top;
  const rings = [pb.ring, ...pb.extra];
  const flatCol = new THREE.Color(0xd8d2c6).multiplyScalar(0.92 + pb.seed * 0.1);
  if (pb.upperRing) {
    // an arch over the street: piers below the clearance, the full building above
    const arch = Math.min(roofY - 1.5, pb.G + CLEARANCE);
    for (const r of rings) walls(accs.facade, ctx, pb, st, r, groundOf, null, arch, 0, phase);
    walls(accs.facade, ctx, pb, st, pb.upperRing, groundOf, () => arch, roofY, parapet, phase);
    roofFlat(accs.flatRoof, pb.upperRing, arch, new THREE.Color(0x8a8378), 3, true);
    if (st.flat) roofFlat(accs.flatRoof, pb.upperRing, roofY, flatCol, 3);
    else roofFlat(accs.tileRoof, pb.upperRing, roofY, new THREE.Color(0xffffff), 1.5);
    return;
  }
  for (const r of rings) {
    const pitched = pb.pitched && hipRoof(accs.tileRoof, r, roofY - 0.6, pb.seed);
    walls(accs.facade, ctx, pb, st, r, groundOf, null, pitched ? roofY - 0.6 : roofY, pitched ? 0 : parapet, phase, pb.src.dist > 45);
    if (pitched) continue;
    if (st.flat) roofFlat(accs.flatRoof, r, roofY, flatCol, 3);
    else roofFlat(accs.tileRoof, r, roofY, new THREE.Color(0xffffff), 1.5);
    // lift overrun / stair box on the roofs of apartment blocks
    const tall = roofY - pb.G;
    if (st.flat && tall > 11 && -signedArea(r) > 120 && pb.typ !== "shed") {
      const c = centroid(r);
      if (pointInRing(c.x, c.z, r)) {
        const w = 2.2 + pb.seed * 1.5;
        const box: P2[] = [
          { x: c.x - w, z: c.z - w * 0.7 }, { x: c.x - w, z: c.z + w * 0.7 }, { x: c.x + w, z: c.z + w * 0.7 }, { x: c.x + w, z: c.z - w * 0.7 },
        ];
        if (box.every((p) => pointInRing(p.x, p.z, r))) {
          const plain = st.def.plain;
          walls(accs.facade, ctx, pb, { ...st, upper: plain, ground: plain, floors: 0, Gf: roofY + 10, topV: 1 }, box, () => roofY, () => roofY, roofY + 2.6, 0, phase);
          roofFlat(accs.flatRoof, box, roofY + 2.6, flatCol, 3);
        }
      }
    }
  }
}

/** Build the whole permanent building layer, one mesh per zone and material. */
export function buildAllBuildings(ctx: CityCtx): THREE.Group {
  const g = new THREE.Group();
  g.name = "buildings";
  const byZone = new Map<string, FacadeAccs>();
  for (const pb of ctx.buildings) {
    // buildings by the route cast shadows on the street (small tiles: the shadow camera culls them);
    // the rest of the city is grouped in big tiles that cast none
    const near = pb.src.dist < 35;
    const T = near ? 300 : 520;
    const key = `${near ? "n" : "f"}${Math.floor((pb.ring[0]?.x ?? 0) / T)},${Math.floor((pb.ring[0]?.z ?? 0) / T)}`;
    let a = byZone.get(key);
    if (!a) byZone.set(key, (a = newFacadeAccs()));
    emitBuilding(a, ctx, pb);
  }
  for (const [zone, a] of byZone) {
    a.facade.append(a.flatRoof);
    a.facade.append(a.tileRoof);
    const f = a.facade.mesh(facadeMaterial(), `facade-${zone}`);
    for (const m of [f]) {
      if (!m) continue;
      if (zone.startsWith("f")) m.castShadow = false;
      g.add(m);
    }
  }
  return g;
}

export const ROOF_SCALE = GROUND_SCALE.roofFlat;
