/**
 * Everything that dresses the streets: trees (both LODs), street lamps per zone style with night
 * light pools, traffic lights, bus shelters with their real stop names, benches, bins, recycling
 * containers, bollards, street-name plaques at junctions, parked cars, and the building relief
 * (balconies, cornices, awnings, shop signs with the real business names).
 */
import * as THREE from "three";
import type { ZoneId } from "../../city/data";
import { Acc } from "./acc";
import { Bag, TS } from "./bag";
import { drawLabel, farMaterial, foliageMaterial, glassMaterial, glowMaterial, lightPoolMaterial, metalMaterial, propMaterial, setNightMaterials, signMaterial, signSlot } from "./cmats";
import type { CityCtx } from "./context";
import type { GroundLayer } from "./ground";
import type { EdgeSample } from "./road";
import { KERB } from "./road";
import { hash01 } from "./shared";
import { emitTree, type Species, type TreeSpec } from "./trees";
import { buildRelief } from "./relief";
import { buildCar } from "../vehicles";

const T_SPHERE = new THREE.SphereGeometry(1, 6, 4);

// ---------------------------------------------------------------------------------------------
// Night switches (shared materials, so chunks never need rebuilding when day turns to night)
// ---------------------------------------------------------------------------------------------

const LAMP_DAY = new THREE.Color(0.75, 0.74, 0.7);
const LAMP_NIGHT = new THREE.Color(2.2, 1.75, 1.15);

export function lampGlowMaterial(): THREE.MeshBasicMaterial {
  return glowMaterial();
}

export function setNightDressing(night: boolean): void {
  glowMaterial().color.copy(night ? LAMP_NIGHT : LAMP_DAY);
  setNightMaterials(night);
  const env = night ? 0.15 : 1;
  void env;
}

// ---------------------------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------------------------

let treeCache: TreeSpec[] | null = null;
let treeCacheCtx: CityCtx | null = null;

function speciesFor(ctx: CityCtx, ground: GroundLayer, x: number, z: number, h: number, palm: boolean, s: number, lateral: number, zone: ZoneId, seed: number): Species {
  if (palm) return h > 11 && seed < 0.5 ? "washingtonia" : "palm";
  const lay = ctx.track.layoutAt(s);
  const inMedian = lay.median.some((m) => lateral > m.from - 0.5 && lateral < m.to + 0.5);
  if (inMedian && (zone === "margen-derecha" || zone === "puente-real")) return seed < 0.4 ? "washingtonia" : seed < 0.75 ? "palm" : "plane";
  if (inMedian && zone === "valdepasillas") return seed < 0.35 ? "palm" : seed < 0.5 ? "jacaranda" : "plane";
  const yGround = ctx.terrainAt(x, z);
  const riverside = yGround < ctx.waterLevel + 6 || ground.river.at(x + 25, z) !== null || ground.river.at(x - 25, z) !== null || ground.river.at(x, z + 25) !== null || ground.river.at(x, z - 25) !== null;
  if (riverside) {
    if (Math.abs(lateral) < 18 && seed < 0.35) return seed < 0.15 ? "washingtonia" : "palm";
    return seed < 0.5 ? "poplar" : seed < 0.75 ? "pine" : "plane";
  }
  if (zone === "casco-antiguo") return h < 7.5 ? "orange" : seed < 0.2 ? "palm" : "plane";
  if (zone === "alcazaba-palmas") {
    if (s > 4870 && s < 5300 && seed < 0.4) return "cypress";
    return h < 6.5 ? "orange" : seed < 0.25 ? "palm" : seed < 0.4 ? "pine" : "plane";
  }
  if (zone === "san-francisco" && s > 4060 && s < 4260) return seed < 0.4 ? "palm" : "plane";
  if (h < 5.5) return "orange";
  if (zone === "valdepasillas" && seed < 0.12) return "jacaranda";
  return seed < 0.06 ? "palm" : "plane";
}

/** All trees, with species, ground height and owning chunk (computed once per city). */
export function allTrees(ctx: CityCtx, ground: GroundLayer): TreeSpec[] {
  if (treeCache && treeCacheCtx === ctx) return treeCache;
  const T = ctx.city.trees;
  const out: TreeSpec[] = [];
  const f = ctx.frame(0);
  for (let i = 0; i + 4 < T.length; i += 5) {
    let x = T[i]!;
    let z = T[i + 1]!;
    const h = T[i + 2]!;
    const r = T[i + 3]!;
    const palm = T[i + 4]! > 0;
    const pr = ctx.track.project(x, z);
    const lay = ctx.track.layoutAt(pr.s);
    let lat = pr.lateral;
    // keep trunks out of the runnable lanes: nudge to the nearest edge, or drop
    if (lat > lay.left - 0.6 && lat < lay.right + 0.6) {
      const med = lay.median.find((m) => lat > m.from && lat < m.to);
      const laneIn = lay.offsets.findIndex((o, k) => Math.abs(lat - o) < lay.widths[k]! / 2 + 0.4);
      if (laneIn >= 0 || !med) {
        const toL = lat - (lay.left - 0.6);
        const toR = lay.right + 0.6 - lat;
        if (Math.min(toL, toR) > 1.6) continue;
        lat = toL < toR ? lay.left - 0.7 : lay.right + 0.7;
        ctx.track.frameAt(pr.s, f);
        x = f.x + f.nx * lat;
        z = f.z + f.nz * lat;
      }
    }
    const seed = hash01(i, 101);
    const zone = ctx.track.zoneAt(pr.s).id;
    const sp = speciesFor(ctx, ground, x, z, h, palm, pr.s, lat, zone, seed);
    ctx.track.frameAt(pr.s, f);
    const onPavement = Math.abs(lat) < 25;
    const y = onPavement ? f.h + KERB : ground.heightAt(x, z);
    const near = Math.abs(lat) < 70;
    out.push({ x, z, y, h: Math.max(3, h), r: Math.max(1, r), sp, seed, chunk: near ? ctx.chunkOf(pr.s) : -1 });
  }
  // roundabout islands: palms and a ring of low shrubs where a local expects them
  const seen = new Set<string>();
  for (const st of ctx.track.stretches) {
    const rb = st.section.roundabout;
    if (!rb) continue;
    const key = `${Math.round(rb.cx)},${Math.round(rb.cz)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mid = (st.fromS + st.toS) / 2;
    const fr = ctx.frame(mid);
    const R = Math.hypot(fr.x - rb.cx, fr.z - rb.cz) + st.layout.left - 1.5;
    if (R < 4) continue;
    const n = R > 14 ? 5 : 3;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.4;
      const d = k === 0 && n === 5 ? 0 : R * 0.45;
      out.push({ x: rb.cx + Math.cos(a) * d, z: rb.cz + Math.sin(a) * d, y: fr.h + 0.3, h: 7 + hash01(k, 3) * 4, r: 3, sp: "palm", seed: hash01(k, Math.round(rb.cx)), chunk: ctx.chunkOf(mid) });
    }
  }
  treeCache = out;
  treeCacheCtx = ctx;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Permanent dressing (far trees)
// ---------------------------------------------------------------------------------------------

export function buildPermanentDressing(ctx: CityCtx, ground: GroundLayer): THREE.Group {
  const g = new THREE.Group();
  g.name = "dressing-far";
  const tiles = new Map<string, Acc>();
  // riverside vegetation: reeds on the sandy margins, tamarisk scrub and poplars on the banks and islands
  const extra: TreeSpec[] = [];
  for (const [k, p] of ground.riparian.entries()) {
    const r = hash01(k, 911);
    if (hash01(k, 77) < 0.35) continue;
    const jx = p.x + (hash01(k, 3) - 0.5) * 16;
    const jz = p.z + (hash01(k, 5) - 0.5) * 16;
    const y = ground.heightAt(jx, jz);
    if (y < ctx.waterLevel + 0.2) continue;
    if (p.sand) extra.push({ x: jx, z: jz, y, h: 1.6 + r * 1.2, r: 1.6, sp: "shrub", seed: r, chunk: -1 });
    else if (r < 0.55) extra.push({ x: jx, z: jz, y, h: 3 + r * 3, r: 2.2, sp: "shrub", seed: r, chunk: -1 });
    else if (r < 0.85) extra.push({ x: jx, z: jz, y, h: 12 + r * 10, r: 3, sp: "poplar", seed: r, chunk: -1 });
    else extra.push({ x: jx, z: jz, y, h: 2 + r * 2, r: 2, sp: "shrub", seed: r, chunk: -1 });
  }
  for (const t of [...allTrees(ctx, ground), ...extra]) {
    const key = `${Math.floor(t.x / 400)},${Math.floor(t.z / 400)}`;
    let acc = tiles.get(key);
    if (!acc) tiles.set(key, (acc = new Acc({ aSway: 2, aChunk: 1 })));
    emitTree(acc, t, false);
  }
  for (const acc of tiles.values()) {
    const m = acc.mesh(foliageMaterial(false), "trees");
    if (m) {
      m.castShadow = false;
      g.add(m);
    }
  }
  void farMaterial;
  return g;
}

// ---------------------------------------------------------------------------------------------
// Chunk dressing
// ---------------------------------------------------------------------------------------------

type LampStyle = "avenue" | "bridge" | "classic" | "wall" | "none";

function lampStyle(zone: ZoneId, e: EdgeSample): LampStyle {
  if (e.bridge) return zone === "alcazaba-palmas" ? "none" : "bridge";
  if (zone === "casco-antiguo" || (zone === "alcazaba-palmas" && e.s < 5700)) return e.pedestrian || e.outerR - e.layout.right < 1.5 ? "wall" : "classic";
  if (zone === "san-francisco" && e.pedestrian) return "classic";
  return "avenue";
}

const POLE = new THREE.Color(0x5d646b);
const IRON = new THREE.Color(0x1d2022);

/** Tall avenue lamp: grey pole with one or two arms. `ry` turns the arm towards the road. */
function lampAvenue(b: Bag, x: number, y: number, z: number, ry: number, double: boolean, h = 9): void {
  const p = b.props;
  const metal = metalMaterial();
  p.cyl(x, y, z, 0.12, h, POLE, 8, metal, 0.07);
  p.cyl(x, y, z, 0.2, 0.7, POLE, 8, metal);
  for (const side of double ? [1, -1] : [1]) {
    const ax = Math.sin(ry) * side;
    const az = Math.cos(ry) * side;
    const tip: [number, number, number] = [x + ax * 1.8, y + h + 0.35, z + az * 1.8];
    p.beam([x, y + h - 0.2, z], tip, 0.07, POLE, metal);
    p.box(tip[0], tip[1], tip[2], 0.32, 0.16, 0.75, POLE, metal, ry);
    p.box(tip[0], tip[1] - 0.1, tip[2], 0.24, 0.04, 0.6, 0xffffff, glowMaterial(), ry);
    pool(b, tip[0], y + 0.02, tip[2], 7);
  }
}

function lampClassic(b: Bag, x: number, y: number, z: number, h = 4.4): void {
  const p = b.props;
  const m = propMaterial(true);
  p.cyl(x, y, z, 0.2, 0.7, IRON, 8, m, 0.13);
  p.cyl(x, y + 0.7, z, 0.07, h - 1.3, IRON, 6, m, 0.05);
  p.cyl(x, y + h - 0.6, z, 0.14, 0.08, IRON, 6, m);
  p.cyl(x, y + h - 0.55, z, 0.17, 0.55, 0xffffff, 6, glowMaterial(), 0.24);
  p.cone(x, y + h - 0.02, z, 0.3, 0.28, IRON, 6, m);
  pool(b, x, y + 0.02, z, 4.5);
}

function lampWall(b: Bag, x: number, y: number, z: number, ry: number): void {
  // fernandino-style lantern on a bracket
  const p = b.props;
  const m = propMaterial(true);
  const ax = Math.sin(ry);
  const az = Math.cos(ry);
  p.beam([x, y + 5.4, z], [x + ax * 0.75, y + 5.55, z + az * 0.75], 0.05, IRON, m);
  const lx = x + ax * 0.75;
  const lz = z + az * 0.75;
  p.cyl(lx, y + 4.95, lz, 0.13, 0.5, 0xffffff, 6, glowMaterial(), 0.2);
  p.cone(lx, y + 5.45, lz, 0.25, 0.25, IRON, 6, m);
  p.cyl(lx, y + 4.85, lz, 0.08, 0.1, IRON, 6, m);
  pool(b, lx, y + 0.02 - 0.0, lz, 4);
}

function pool(b: Bag, x: number, y: number, z: number, r: number): void {
  const acc = b.acc(lightPoolMaterial());
  const c = new THREE.Color(1.0, 0.72, 0.4).multiplyScalar(0.55);
  const A = new THREE.Vector3(x - r, y, z - r);
  const B = new THREE.Vector3(x - r, y, z + r);
  const C = new THREE.Vector3(x + r, y, z + r);
  const D = new THREE.Vector3(x + r, y, z - r);
  acc.quad(A, B, C, D, [0, 0], [0, 1], [1, 1], [1, 0], c, c, c, c, new THREE.Vector3(0, 1, 0));
}

function trafficLight(b: Bag, x: number, y: number, z: number, ry: number): void {
  const p = b.props;
  const m = metalMaterial();
  p.cyl(x, y, z, 0.07, 3.2, 0x2b2f33, 6, m);
  p.box(x, y + 2.9, z, 0.36, 1.0, 0.3, 0x1c1f22, m, ry);
  const fx = Math.sin(ry) * 0.16;
  const fz = Math.cos(ry) * 0.16;
  const cols = [0xd8261c, 0xe8a51a, 0x2fb34a];
  cols.forEach((c, k) => {
    const lit = k === 2;
    p.box(x + fx, y + 3.22 - k * 0.32, z + fz, 0.2, 0.2, 0.04, lit ? new THREE.Color(c).multiplyScalar(2.2) : new THREE.Color(c).multiplyScalar(0.25), lit ? glowMaterial() : m, ry);
  });
}

function bench(b: Bag, x: number, y: number, z: number, ry: number): void {
  const p = b.props;
  const m = propMaterial(true);
  const wood = 0x7a5232;
  p.box(x, y + 0.43, z, 1.8, 0.06, 0.45, wood, m, ry);
  const bx = -Math.cos(ry) * 0;
  void bx;
  p.push(new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z));
  p.box(0, 0.75, -0.22, 1.8, 0.35, 0.05, wood, m);
  for (const sx of [-0.75, 0.75]) p.box(sx, 0.22, 0, 0.06, 0.44, 0.45, 0x2a2d30, m);
  p.pop();
}

function bin(b: Bag, x: number, y: number, z: number): void {
  const m = propMaterial(true);
  b.props.cyl(x, y, z, 0.22, 0.85, 0x3d5a3a, 8, m);
  b.props.cyl(x, y + 0.85, z, 0.24, 0.06, 0x2b2b2b, 8, m);
}

/** Recycling containers in a row at the kerb (yellow, blue, green igloo, grey). */
function containers(b: Bag, x: number, y: number, z: number, ry: number): void {
  const m = propMaterial(true);
  const cols = [0x6b6e70, 0xe3b81f, 0x2b62a8, 0x3c7a3a];
  b.props.push(new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z));
  cols.forEach((c, k) => {
    const lx = (k - 1.5) * 1.75;
    if (k === 3) b.props.add(new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.Matrix4().makeScale(0.8, 1.5, 0.8).setPosition(lx, 0, 0), c, m);
    else {
      b.props.box(lx, 0.7, 0, 1.6, 1.3, 1.1, c, m);
      b.props.box(lx, 1.38, -0.05, 1.62, 0.12, 1.2, new THREE.Color(c).multiplyScalar(0.8), m);
    }
  });
  b.props.pop();
}

function busShelter(b: Bag, x: number, y: number, z: number, ry: number, name: string): void {
  const p = b.props;
  const m = metalMaterial();
  p.push(new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z));
  // ry: shelter faces +Z local (towards the road)
  for (const sx of [-2, 2]) p.box(sx, 1.25, -0.6, 0.08, 2.5, 0.08, 0x9aa1a7, m);
  p.box(0, 2.55, -0.2, 4.4, 0.12, 1.7, 0x9aa1a7, m);
  p.box(0, 1.3, -0.95, 4.0, 2.2, 0.03, 0x9fc0cc, glassMaterial());
  p.box(-2, 1.3, -0.4, 0.03, 2.2, 1.0, 0x9fc0cc, glassMaterial());
  p.box(0, 0.48, -0.75, 3.0, 0.06, 0.35, 0x8c9399, m);
  // advert panel (lit at night)
  p.box(2.05, 1.3, -0.4, 0.1, 1.8, 1.2, 0xffffff, glowMaterial());
  // name board on the roof edge
  const uv = signSlot(`bus-${name}`, drawLabel(name, "#e5484d", "#ffffff", { upper: true }));
  p.quad(new THREE.Matrix4().makeScale(3.6, 0.6, 1).setPosition(0, 2.35, 0.66), 0xffffff, signMaterial(), uv);
  p.pop();
}

function bollard(b: Bag, x: number, y: number, z: number): void {
  b.props.cyl(x, y, z, 0.09, 0.9, 0x2a2c2e, 6, propMaterial(true));
  b.props.cyl(x, y + 0.75, z, 0.095, 0.05, 0xd9b24a, 6, propMaterial(true));
}

/** Street name plaque: white on blue enamel (blue on white ceramic in the old town). */
function plaqueUv(name: string, ceramic: boolean): [number, number, number, number] {
  return signSlot(`plaque-${ceramic}-${name}`, ceramic ? drawLabel(name, "#fcf8f1", "#1f4b9a", { serif: true, border: "#1f4b9a" }) : drawLabel(name, "#1d4f9e", "#ffffff", { serif: true, border: "#ffffff" }));
}

function plaque(b: Bag, x: number, y: number, z: number, ry: number, name: string, ceramic: boolean, pole: boolean): void {
  const p = b.props;
  if (pole) {
    p.cyl(x, y, z, 0.05, 3.0, 0x3b3f43, 6, metalMaterial());
  }
  const uv = plaqueUv(name, ceramic);
  const m = signMaterial();
  const w = 1.4;
  const hgt = w * (96 / 512);
  const fx = Math.sin(ry) * 0.06;
  const fz = Math.cos(ry) * 0.06;
  p.box(x, y + 2.75, z, w + 0.06, hgt + 0.06, 0.04, 0x30343a, metalMaterial(), ry);
  p.quad(new THREE.Matrix4().makeRotationY(ry).scale(new THREE.Vector3(w, hgt, 1)).setPosition(x + fx * 0.6, y + 2.75, z + fz * 0.6), 0xffffff, m, uv);
  p.quad(new THREE.Matrix4().makeRotationY(ry + Math.PI).scale(new THREE.Vector3(w, hgt, 1)).setPosition(x - fx * 0.6, y + 2.75, z - fz * 0.6), 0xffffff, m, uv);
}

/**
 * Chunk dressing in two passes, so no single frame builds too much: "road" (with the road
 * surface: the street lamps) and "detail" (once the chunk comes near: trees, furniture, plaques,
 * parked cars and the building relief).
 */
export type DressingPass = "road" | "trees" | "furniture" | "relief";

export function buildChunkDressing(ctx: CityCtx, bag: Bag, ts: TS, chunk: number, s0: number, s1: number, edges: EdgeSample[], ground: GroundLayer, pass: DressingPass): void {
  if (pass === "trees") return; // trees are one permanent, single-LOD layer in the flat style
  if (pass === "furniture") {
    chunkDetail(ctx, bag, ts, chunk, s0, s1, edges, ground);
    return;
  }
  if (pass === "relief") {
    buildRelief(ctx, bag, chunk, s0, s1);
    return;
  }

  // street lamps
  const zoneOf = (s: number): ZoneId => ctx.track.zoneAt(s).id;
  const SP = 26;
  for (let s = Math.ceil(s0 / SP) * SP; s < s1; s += SP) {
    const e = nearestEdge(edges, s);
    if (!e) continue;
    const zone = zoneOf(s);
    const style = lampStyle(zone, e);
    const f = ts.f(s);
    const lay = e.layout;
    const heading = Math.atan2(f.nx, f.nz); // ry that points local +Z along +n (right)
    if (style === "avenue" || style === "bridge") {
      // median lamps where the median is wide and not runnable, else both kerbs (staggered)
      const med = lay.median.find((m) => m.to - m.from > 1.2);
      const medianLane = med ? lay.kinds.some((k, i) => (k as string) === "median" && lay.offsets[i]! > med.from && lay.offsets[i]! < med.to) : false;
      if (med && !medianLane && !e.bridge) {
        const p = ts.p(s, (med.from + med.to) / 2, KERB);
        lampAvenue(bag, p.x, p.y, p.z, heading, true, 10);
      } else {
        const side = Math.round(s / SP) % 2 === 0 ? 1 : -1;
        const lat = side > 0 ? Math.max(lay.right + 0.5, e.kerbR + 0.4) : Math.min(lay.left - 0.5, e.kerbL - 0.4);
        if (side > 0 && lat > e.outerR - 0.2 && !e.bridge) continue;
        if (side < 0 && lat < e.outerL + 0.2 && !e.bridge) continue;
        const p = ts.p(s, lat, e.pedestrian ? 0 : KERB);
        lampAvenue(bag, p.x, p.y, p.z, side > 0 ? heading + Math.PI : heading, false, e.bridge ? 10 : 8.5);
      }
    } else if (style === "classic") {
      for (const side of [1, -1] as const) {
        const lat = side > 0 ? lay.right + 0.6 : lay.left - 0.6;
        if (side > 0 ? lat > e.outerR - 0.3 : lat < e.outerL + 0.3) continue;
        const p = ts.p(s + (side > 0 ? 0 : SP / 2), lat, e.pedestrian ? 0 : KERB);
        lampClassic(bag, p.x, p.y, p.z);
      }
    } else if (style === "wall") {
      const side = Math.round(s / SP) % 2 === 0 ? 1 : -1;
      const fac = ctx.facadeAt(s, side);
      if (fac !== null && Math.abs(fac) < 12) {
        const p = ts.p(s, fac - side * 0.05, 0);
        lampWall(bag, p.x, p.y, p.z, side > 0 ? heading + Math.PI : heading);
      }
    }
  }

}

function chunkDetail(ctx: CityCtx, bag: Bag, ts: TS, _chunk: number, s0: number, s1: number, edges: EdgeSample[], ground: GroundLayer): void {
  const zoneOf = (s: number): ZoneId => ctx.track.zoneAt(s).id;
  // fairground "farolillos": strings of paper lanterns across the old town's and the Paseo's streets
  for (let s = Math.ceil(s0 / 14) * 14 + 7; s < s1; s += 14) {
    const z = zoneOf(s);
    const e = nearestEdge(edges, s);
    if (!e) continue;
    const festive = z === "casco-antiguo" || (z === "alcazaba-palmas" && s < 5000) || (z === "san-francisco" && e.pedestrian);
    if (!festive) continue;
    const fl = ctx.facadeAt(s, -1);
    const fr = ctx.facadeAt(s, 1);
    const l0 = fl !== null && Math.abs(fl) < 14 ? fl : e.layout.left - 1.5;
    const l1 = fr !== null && Math.abs(fr) < 14 ? fr : e.layout.right + 1.5;
    const A = ts.p(s, l0, 5.8);
    const B = ts.p(s, l1, 5.8);
    const n = Math.max(4, Math.round((l1 - l0) / 0.9));
    const cols = [0xe5484d, 0xffffff, 0x8db87a, 0x3e7bd6, 0xfcf8f1];
    let prev: [number, number, number] = [A.x, A.y, A.z];
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const sag = Math.sin(Math.PI * t) * 0.7;
      const q: [number, number, number] = [A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t - sag, A.z + (B.z - A.z) * t];
      bag.props.beam(prev, q, 0.012, 0x222222, propMaterial(false));
      if (k < n) bag.props.add(T_SPHERE, new THREE.Matrix4().makeScale(0.16, 0.2, 0.16).setPosition(q[0], q[1] - 0.22, q[2]), cols[(k + Math.round(s)) % cols.length]!, glowMaterial());
      prev = q;
    }
  }
  // furniture from the data
  for (const fu of ctx.city.furniture) {
    if (fu.s < s0 || fu.s >= s1) continue;
    const e = nearestEdge(edges, fu.s);
    if (!e) continue;
    const f = ts.f(fu.s);
    const heading = Math.atan2(f.nx, f.nz);
    const lay = e.layout;
    // never inside the runnable surface: push to just outside it
    let lat = fu.lateral;
    if (lat > lay.left - 0.5 && lat < lay.right + 0.5) lat = lat - lay.left < lay.right - lat ? lay.left - 0.7 : lay.right + 0.7;
    if (Math.abs(lat) > 30) continue;
    const y = e.pedestrian ? 0 : KERB;
    const p = ts.p(fu.s, lat, y);
    const towards = lat > 0 ? heading + Math.PI : heading; // local +Z points at the road
    switch (fu.type) {
      case "traffic_signals":
        trafficLight(bag, p.x, p.y, p.z, Math.atan2(-f.tx, -f.tz));
        break;
      case "bus_stop":
        if (lat > e.outerR - 1.2 || lat < e.outerL + 1.2) {
          // not enough pavement for a shelter: a pole with the sign
          bag.props.cyl(p.x, p.y, p.z, 0.05, 2.9, 0x9aa1a7, 6, metalMaterial());
          bag.props.box(p.x, p.y + 2.7, p.z, 0.5, 0.5, 0.04, 0xc4161c, propMaterial(false), towards);
        } else {
          // shelters stand back from the runnable edge (their roof reaches 0.7 m forward)
          const back = lat > 0 ? Math.max(lat, lay.right + 1.5) : Math.min(lat, lay.left - 1.5);
          const q = ts.p(fu.s, back, y);
          busShelter(bag, q.x, q.y, q.z, towards, fu.name ?? "Parada");
        }
        break;
      case "bench":
        bench(bag, p.x, p.y, p.z, towards);
        break;
      case "waste_basket":
      case "waste_disposal":
        bin(bag, p.x, p.y, p.z);
        break;
      case "recycling":
        containers(bag, p.x, p.y, p.z, towards + Math.PI / 2);
        break;
      case "bollard":
        bollard(bag, p.x, p.y, p.z);
        break;
      case "fountain":
      case "drinking_water":
        bag.props.cyl(p.x, p.y, p.z, 0.18, 1.0, 0x7d7a72, 8, propMaterial(true));
        bag.props.box(p.x, p.y + 1.0, p.z, 0.35, 0.12, 0.35, 0x7d7a72, propMaterial(true));
        break;
      default:
        break;
    }
  }

  // bins and benches along the pavements every ~45 m (where there is room)
  for (let s = Math.ceil(s0 / 45) * 45 + 11; s < s1; s += 45) {
    const e = nearestEdge(edges, s);
    if (!e || e.bridge) continue;
    const lay = e.layout;
    const lat = lay.right + 0.6;
    if (lat > e.outerR - 0.4) continue;
    const p = ts.p(s, lat, e.pedestrian ? 0 : KERB);
    bin(bag, p.x, p.y, p.z);
  }

  // street name plaques where side streets leave
  for (const j of ctx.city.junctions) {
    if (j.s < s0 || j.s >= s1 || !j.name) continue;
    const e = nearestEdge(edges, j.s);
    if (!e) continue;
    const side = j.side === "left" ? -1 : 1;
    const zone = zoneOf(j.s);
    const ceramic = zone === "casco-antiguo" || zone === "alcazaba-palmas";
    const f = ts.f(j.s);
    const heading = Math.atan2(f.tx, f.tz);
    const sb = j.s - 5;
    const fac = ctx.facadeAt(sb, side);
    const lay = e.layout;
    const edge = side > 0 ? lay.right + 0.5 : lay.left - 0.5;
    const onWall = fac !== null && Math.abs(fac) < Math.abs(edge) + 4;
    const lat = onWall && fac !== null ? fac - side * 0.1 : side > 0 ? Math.min(e.outerR - 0.3, edge + 0.3) : Math.max(e.outerL + 0.3, edge - 0.3);
    const p = ts.p(sb, lat, e.pedestrian ? 0 : KERB);
    // faces back towards the runner so it can be read approaching
    // on a wall the plaque goes above the shop signs (which sit at ~3.25 m)
    plaque(bag, p.x, p.y + (onWall ? 1.5 : 0), p.z, heading + Math.PI, j.name, ceramic, !onWall);
  }

  // parked cars in the parking areas near the route
  for (const pa of ctx.city.parking) {
    const cx = pa.ring.reduce((acc, v, i) => (i % 2 === 0 ? acc + v : acc), 0) / (pa.ring.length / 2);
    const cz = pa.ring.reduce((acc, v, i) => (i % 2 === 1 ? acc + v : acc), 0) / (pa.ring.length / 2);
    const pr = ctx.track.project(cx, cz);
    if (pr.s < s0 || pr.s >= s1 || Math.abs(pr.lateral) > 90) continue;
    parkingLot(bag, ctx, ground, pa.ring, Math.round(cx * 10 + cz));
  }

}

function parkingLot(bag: Bag, ctx: CityCtx, ground: GroundLayer, ring: number[], seed: number): void {
  // rows of cars along the longest edge direction, inside the polygon
  let best = 0;
  let ux = 1;
  let uz = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = ring[j * 2]! - ring[i * 2]!;
    const dz = ring[j * 2 + 1]! - ring[i * 2 + 1]!;
    const l = Math.hypot(dx, dz);
    if (l > best) {
      best = l;
      ux = dx / l;
      uz = dz / l;
    }
  }
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = ring[i * 2]!;
    const z = ring[i * 2 + 1]!;
    const u = x * ux + z * uz;
    const v = -x * uz + z * ux;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  let count = 0;
  const ry = Math.atan2(-uz, ux);
  const inside = (x: number, z: number): boolean => {
    let ins = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = ring[i * 2]!, az = ring[i * 2 + 1]!, bx = ring[j * 2]!, bz = ring[j * 2 + 1]!;
      if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) ins = !ins;
    }
    return ins;
  };
  for (let v = minV + 3; v < maxV - 2; v += 6) {
    for (let u = minU + 1.5; u < maxU - 1.5; u += 2.6) {
      if (count > 14) return;
      const x = u * ux - v * uz;
      const z = u * uz + v * ux;
      if (!inside(x, z)) continue;
      const pr = ctx.track.project(x, z);
      const lay = ctx.track.layoutAt(pr.s);
      if (pr.lateral > lay.left - 3 && pr.lateral < lay.right + 3) continue;
      if (hash01(seed + count, Math.round(u)) < 0.25) continue;
      const y = ground.heightAt(x, z) + 0.05;
      bag.props.push(new THREE.Matrix4().makeRotationY(ry + Math.PI / 2).setPosition(x, y, z));
      buildCar(bag.props, seed * 31 + count, false);
      bag.props.pop();
      count++;
    }
  }
  void ctx;
}

function nearestEdge(edges: EdgeSample[], s: number): EdgeSample | undefined {
  let best: EdgeSample | undefined;
  let d = Infinity;
  for (const e of edges) {
    const k = Math.abs(e.s - s);
    if (k < d) {
      d = k;
      best = e;
    }
  }
  return best;
}
