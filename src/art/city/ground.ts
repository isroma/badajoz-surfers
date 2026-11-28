/**
 * Terrain (the DTM grid, lowered under the route corridor and the river), the Guadiana and the
 * other water bodies, parks/plazas as ground colour, and a far ground disc to the horizon.
 * Permanent layer.
 */
import * as THREE from "three";
import type { CityArea } from "../../city/data";
import { Acc } from "./acc";
import { PAL } from "../palette";
import { groundMaterial, terrainMaterial, waterMaterial } from "./cmats";
import { widthOf } from "./network";
import { ringsOf } from "./roundabouts";
import type { CityCtx } from "./context";
import { Grid, pointInFlat } from "./geo";
import { newFrame } from "./track";
import { GROUND_SCALE } from "./textures";

const STEP = 20;

function areaOf(ring: readonly number[]): number {
  let a = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i * 2]! * ring[j * 2 + 1]! - ring[j * 2]! * ring[i * 2 + 1]!;
  }
  return Math.abs(a / 2);
}

function bounds(ring: readonly number[]): [number, number, number, number] {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    minX = Math.min(minX, ring[i]!); maxX = Math.max(maxX, ring[i]!);
    minZ = Math.min(minZ, ring[i + 1]!); maxZ = Math.max(maxZ, ring[i + 1]!);
  }
  return [minX, minZ, maxX, maxZ];
}

/** Areas indexed for point-in-polygon tests. */
export class AreaIndex {
  private readonly grid = new Grid<CityArea>(60);
  constructor(areas: readonly CityArea[]) {
    for (const a of areas) {
      const [x0, z0, x1, z1] = bounds(a.ring);
      this.grid.add(a, x0, z0, x1, z1);
    }
  }
  at(x: number, z: number): CityArea | null {
    for (const a of this.grid.query(x, z, x, z)) {
      if (pointInFlat(x, z, a.ring) && !(a.holes?.some((h) => pointInFlat(x, z, h)) ?? false)) return a;
    }
    return null;
  }
}

export function isRiver(a: CityArea): boolean {
  return a.kind === "river" || a.kind === "canal" || areaOf(a.ring) > 6000;
}

export interface GroundLayer {
  group: THREE.Group;
  /** Terrain height after the corridor/river shaping (what the player sees). */
  heightAt(x: number, z: number): number;
  river: AreaIndex;
  green: AreaIndex;
  /** Points on the river banks and islands for riverside vegetation (reeds, tamarisks, poplars). */
  riparian: { x: number; z: number; y: number; sand: boolean }[];
}

export function buildGround(ctx: CityCtx): GroundLayer {
  const city = ctx.city;
  const t = city.terrain;
  const group = new THREE.Group();
  group.name = "ground";
  const rivers = city.water.filter(isRiver);
  const river = new AreaIndex(rivers);
  const green = new AreaIndex(city.green);
  const squares = new AreaIndex(city.squares);
  const wl = ctx.waterLevel;

  const x0 = t.x0 - 400;
  const z0 = t.z0 - 400;
  const nx = Math.ceil((t.nx * t.cell + 800) / STEP) + 1;
  const nz = Math.ceil((t.nz * t.cell + 800) / STEP) + 1;
  const H = new Float32Array(nx * nz);
  const kind = new Uint8Array(nx * nz); // 0 urban, 1 lawn, 2 water, 3 square, 4 field, 5 scrub, 6 wood, 7 bank, 8 sand
  const locked = new Uint8Array(nx * nz); // under the route: never smoothed
  const riparian: { x: number; z: number; y: number; sand: boolean }[] = [];
  const ripIdx: number[] = [];
  const f = newFrame();
  const tr = ctx.track;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = x0 + ix * STEP;
      const z = z0 + iz * STEP;
      let h = ctx.terrainAt(x, z);
      const i = iz * nx + ix;
      const inside = x > t.x0 && z > t.z0 && x < t.x0 + t.nx * t.cell && z < t.z0 + t.nz * t.cell;
      if (river.at(x, z)) {
        kind[i] = 2;
        h = Math.min(h, wl - 2.5);
      } else if (squares.at(x, z)) kind[i] = 3;
      else {
        const ga = green.at(x, z);
        if (ga) kind[i] = ga.kind === "forest" || ga.kind === "wood" ? 6 : ga.kind === "scrub" || ga.kind === "recreation_ground" ? 5 : 1;
        else if (h < wl + 1.6) kind[i] = 8;
        else if (h < wl + 5) kind[i] = 7;
        else if (inside && ctx.buildingGrid.query(x - 25, z - 25, x + 25, z + 25).size === 0) kind[i] = 5; // empty plots: dry grass
        else kind[i] = inside ? 0 : 4;
      }
      // keep the terrain under the route's surface (the road is drawn at the route height)
      const pr = tr.project(x, z);
      tr.frameAt(pr.s, f);
      const lay = tr.layoutAt(pr.s);
      const edge = Math.max(-lay.left, lay.right) + 8;
      const d = Math.abs(pr.lateral);
      if (d < edge + STEP) {
        const k = Math.max(0, Math.min(1, (d - edge) / STEP));
        const cap = f.h - 0.35 + k * 30;
        if (h > cap) h = cap;
        locked[i] = 1;
      }
      // the DTM keeps the Puente Real deck: put the river islands back under it
      if (d < edge + 30 && ctx.city.meta.bridges.some((b) => b.length > 100 && pr.s > b.fromS + 15 && pr.s < b.toS - 15)) {
        h = Math.min(h, wl + 1.2);
        if (kind[i] === 0) kind[i] = 7;
      }
      H[i] = h;
      if ((kind[i] === 7 || kind[i] === 8 || kind[i] === 6) && d > edge + 6 && inside) {
        riparian.push({ x, z, y: 0, sand: kind[i] === 8 });
        ripIdx.push(i);
      }
    }
  }
  // soften the shoreline: the 20 m river mask otherwise draws the banks and islands as staircases
  for (let pass = 0; pass < 3; pass++) {
    const src = H.slice();
    for (let iz = 1; iz < nz - 1; iz++) {
      for (let ix = 1; ix < nx - 1; ix++) {
        const i = iz * nx + ix;
        if (locked[i]) continue;
        let wet = 0;
        let sum = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const j = i + dz * nx + dx;
          if (kind[j] === 2) wet++;
          sum += src[j]!;
        }
        if (wet > 0 && wet < 9) H[i] = sum / 9;
      }
    }
  }
  // terrain never above a drawn surface: push the grid down under every street footprint (with its
  // pavements) and under the roundabout rings and islands, so no terrain cell pokes through them
  {
    const under = new Uint8Array(nx * nz);
    const mark = (minX: number, minZ: number, maxX: number, maxZ: number, inside: (x: number, z: number) => boolean): void => {
      const ix0 = Math.max(0, Math.floor((minX - x0) / STEP));
      const iz0 = Math.max(0, Math.floor((minZ - z0) / STEP));
      const ix1 = Math.min(nx - 1, Math.ceil((maxX - x0) / STEP));
      const iz1 = Math.min(nz - 1, Math.ceil((maxZ - z0) / STEP));
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) if (inside(x0 + ix * STEP, z0 + iz * STEP)) under[iz * nx + ix] = 1;
    };
    for (const st of ctx.city.streets) {
      if (st.tunnel || st.bridge) continue;
      const w = widthOf(st);
      const half = w.road / 2 + w.walk + STEP * 0.5;
      for (let i = 0; i + 3 < st.pts.length; i += 2) {
        const ax = st.pts[i]!, az = st.pts[i + 1]!, bx = st.pts[i + 2]!, bz = st.pts[i + 3]!;
        const dx = bx - ax, dz = bz - az;
        const l2 = dx * dx + dz * dz || 1;
        mark(Math.min(ax, bx) - half, Math.min(az, bz) - half, Math.max(ax, bx) + half, Math.max(az, bz) + half, (x, z) => {
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          return Math.hypot(x - ax - dx * t, z - az - dz * t) <= half;
        });
      }
    }
    for (let i = 0; i < nx * nz; i++) if (under[i] && kind[i] !== 2) H[i] = H[i]! - 0.3;
    for (const ring of ringsOf(ctx)) {
      const r = { cx: ring.rb.cx, cz: ring.rb.cz, y: Math.min(ring.y, ...ring.samples.map((q) => q[1])) };
      const R = ring.rb.rOuter + 3 + STEP * 0.5;
      const ix0 = Math.max(0, Math.floor((r.cx - R - x0) / STEP));
      const iz0 = Math.max(0, Math.floor((r.cz - R - z0) / STEP));
      for (let iz = iz0; iz <= Math.min(nz - 1, iz0 + Math.ceil((2 * R) / STEP) + 1); iz++) {
        for (let ix = ix0; ix <= Math.min(nx - 1, ix0 + Math.ceil((2 * R) / STEP) + 1); ix++) {
          if (Math.hypot(x0 + ix * STEP - r.cx, z0 + iz * STEP - r.cz) <= R) H[iz * nx + ix] = Math.min(H[iz * nx + ix]!, r.y - 0.4);
        }
      }
    }
  }
  riparian.forEach((r, k) => {
    r.y = H[ripIdx[k]!]!;
  });
  // the softened shore may now be under water: no riverside tree stands in the river
  for (let k = riparian.length - 1; k >= 0; k--) if (riparian[k]!.y < wl + 0.4) riparian.splice(k, 1);
  const heightAt = (x: number, z: number): number => {
    const fx = Math.max(0, Math.min(nx - 1.001, (x - x0) / STEP));
    const fz = Math.max(0, Math.min(nz - 1.001, (z - z0) / STEP));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const ax = fx - ix;
    const az = fz - iz;
    const i = iz * nx + ix;
    // match the triangle split used by the mesh (diagonal from (ix,iz) to (ix+1,iz+1))
    const a = H[i]!;
    const b = H[i + 1]!;
    const c = H[i + nx]!;
    const d = H[i + nx + 1]!;
    return ax > az ? a + (b - a) * ax + (d - b) * az : a + (d - c) * ax + (c - a) * az;
  };

  // terrain mesh (indexed, smooth normals)
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const c = new THREE.Color();
  // summer Extremadura: mown park lawns, dusty urban plots, ochre dry grass and stubble, dark riverside woods, sandy islands
  const palette: Record<number, number> = { 0: PAL.land, 1: PAL.grass, 2: 0x8dbfe3, 3: PAL.pavement, 4: PAL.land, 5: 0xe3e6c0, 6: 0xbcd9a0, 7: 0xd6e6bc, 8: 0xf2ead8 };
  const grassW: Record<number, number> = { 0: 0.15, 1: 1, 2: 0, 3: 0, 4: 0.75, 5: 0.9, 6: 1, 7: 1, 8: 0.1 };
  const mix = new Float32Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      const x = x0 + ix * STEP;
      const z = z0 + iz * STEP;
      pos[i * 3] = x;
      pos[i * 3 + 1] = H[i]!;
      pos[i * 3 + 2] = z;
      // average the class with the neighbours for soft borders
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const jx = ix + dx;
        const jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        c.setHex(palette[kind[jz * nx + jx]!] ?? 0xc9c1b0);
        r += c.r; g += c.g; b += c.b; n++;
      }
      mix[i] = grassW[kind[i]!] ?? 0.3;
      col[i * 3] = r / n;
      col[i * 3 + 1] = g / n;
      col[i * 3 + 2] = b / n;
      uv[i * 2] = x / GROUND_SCALE.earth;
      uv[i * 2 + 1] = z / GROUND_SCALE.earth;
    }
  }
  // terrain in blocks of 14 x 14 cells (frustum and distance culling)
  const BLK = 26;
  const posA = new THREE.BufferAttribute(pos, 3);
  const colA = new THREE.BufferAttribute(col, 3);
  const uvA = new THREE.BufferAttribute(uv, 2);
  const mixA = new THREE.BufferAttribute(mix, 1);
  const nrm = (() => {
    const all: number[] = [];
    for (let iz = 0; iz + 1 < nz; iz++) for (let ix = 0; ix + 1 < nx; ix++) {
      const a = iz * nx + ix;
      all.push(a, a + nx, a + nx + 1, a, a + nx + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", posA);
    g.setIndex(all);
    g.computeVertexNormals();
    return g.getAttribute("normal");
  })();
  for (let bz = 0; bz < nz - 1; bz += BLK) {
    for (let bx = 0; bx < nx - 1; bx += BLK) {
      const idx: number[] = [];
      for (let iz = bz; iz < Math.min(nz - 1, bz + BLK); iz++) {
        for (let ix = bx; ix < Math.min(nx - 1, bx + BLK); ix++) {
          const a = iz * nx + ix;
          idx.push(a, a + nx, a + nx + 1, a, a + nx + 1, a + 1);
        }
      }
      const tg = new THREE.BufferGeometry();
      tg.setAttribute("position", posA);
      tg.setAttribute("normal", nrm);
      tg.setAttribute("color", colA);
      tg.setAttribute("uv", uvA);
      tg.setAttribute("aMix", mixA);
      tg.setIndex(idx);
      // bounding sphere of the block only
      const box = new THREE.Box3();
      const v = new THREE.Vector3();
      for (const k of [bz * nx + bx, Math.min(nz - 1, bz + BLK) * nx + Math.min(nx - 1, bx + BLK)]) box.expandByPoint(v.set(pos[k * 3]!, -40, pos[k * 3 + 2]!));
      box.expandByPoint(v.set(box.min.x, 80, box.min.z));
      tg.boundingBox = box;
      tg.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      tg.userData["perInstance"] = true;
      const terrain = new THREE.Mesh(tg, terrainMaterial());
      terrain.receiveShadow = true;
      terrain.name = "terrain";
      terrain.matrixAutoUpdate = false;
      group.add(terrain);
    }
  }

  // far ground disc to the horizon (dry fields, olive-brown)
  const far = new THREE.Mesh(new THREE.RingGeometry(1, 1, 64, 1), groundMaterial("earth"));
  {
    const ring = new THREE.RingGeometry(1800, 6000, 48, 1);
    ring.rotateX(-Math.PI / 2);
    ring.translate(1300, wl - 3, 500);
    const n = ring.getAttribute("position").count;
    const cols = new Float32Array(n * 3);
    c.setHex(PAL.land);
    for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
    ring.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    ring.userData["perInstance"] = true;
    far.geometry.dispose();
    far.geometry = ring;
    far.name = "far-ground";
    far.matrixAutoUpdate = false;
    group.add(far);
    // fill between the terrain grid and the disc
    const fill = new THREE.PlaneGeometry(4000, 4000, 1, 1);
    fill.rotateX(-Math.PI / 2);
    fill.translate(1300, wl - 3.5, 500);
    const fc = new Float32Array(4 * 3);
    for (let i = 0; i < 4; i++) fc.set([c.r, c.g, c.b], i * 3);
    fill.setAttribute("color", new THREE.BufferAttribute(fc, 3));
    fill.userData["perInstance"] = true;
    const fm = new THREE.Mesh(fill, groundMaterial("earth"));
    fm.name = "far-fill";
    fm.matrixAutoUpdate = false;
    group.add(fm);
  }

  // water
  const wacc = new Acc();
  const deep = new THREE.Color(PAL.water);
  const pond = new THREE.Color(PAL.water);
  // the river: a grid of cells at the water level, coloured by distance to the bank (shallow,
  // sandy-green margins → dark mid-river); the shoreline itself is where the banks rise out
  riverGrid(wacc, rivers, wl, river);
  for (const a of city.water) {
    const big = isRiver(a);
    if (big) continue;
    // small water (fountains, ponds) never lies on the route's surface
    {
      let cx = 0;
      let cz = 0;
      const n = a.ring.length / 2;
      for (let i = 0; i < n; i++) {
        cx += a.ring[i * 2]! / n;
        cz += a.ring[i * 2 + 1]! / n;
      }
      const pr = ctx.track.project(cx, cz);
      const lay = ctx.track.layoutAt(pr.s);
      let lo = lay.left;
      let hi = lay.right;
      for (const w of lay.sidewalks) {
        lo = Math.min(lo, w.from);
        hi = Math.max(hi, w.to);
      }
      if (pr.lateral > lo - 3 && pr.lateral < hi + 3) continue;
    }
    const ring = a.ring;
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i + 1 < ring.length; i += 2) contour.push(new THREE.Vector2(ring[i]!, ring[i + 1]!));
    const holes = (a.holes ?? []).map((h) => {
      const out: THREE.Vector2[] = [];
      for (let i = 0; i + 1 < h.length; i += 2) out.push(new THREE.Vector2(h[i]!, h[i + 1]!));
      return out;
    });
    let y = wl;
    if (!big) {
      let m = Infinity;
      for (const p of contour) m = Math.min(m, ctx.terrainAt(p.x, p.y));
      y = m + 0.15;
    }
    let tris: number[][];
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, holes);
    } catch {
      continue;
    }
    const all = contour.concat(...holes);
    const P = (k: number): THREE.Vector3 => {
      const p = all[k]!;
      return new THREE.Vector3(p.x, y, p.y);
    };
    for (const tri of tris) {
      const a0 = P(tri[0]!);
      let a1 = P(tri[1]!);
      let a2 = P(tri[2]!);
      const cy = (a1.z - a0.z) * (a2.x - a0.x) - (a1.x - a0.x) * (a2.z - a0.z);
      if (cy < 0) [a1, a2] = [a2, a1];
      wacc.tri(a0, a1, a2, [0, 0], [0, 0], [0, 0], big ? deep : pond, new THREE.Vector3(0, 1, 0));
    }
  }
  const wm = wacc.mesh(waterMaterial(), "water");
  if (wm) group.add(wm);
  return { group, heightAt, river, green, riparian };
}

function riverGrid(acc: Acc, rivers: readonly CityArea[], wl: number, idx: AreaIndex): void {
  const G = 24;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const edges = new Grid<[number, number, number, number]>(40);
  for (const a of rivers) {
    for (const ring of [a.ring, ...(a.holes ?? [])]) {
      const n = ring.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = ring[i * 2]!, az = ring[i * 2 + 1]!, bx = ring[j * 2]!, bz = ring[j * 2 + 1]!;
        edges.add([ax, az, bx, bz], Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
        minX = Math.min(minX, ax); maxX = Math.max(maxX, ax);
        minZ = Math.min(minZ, az); maxZ = Math.max(maxZ, az);
      }
    }
  }
  if (!isFinite(minX)) return;
  const nx = Math.ceil((maxX - minX) / G) + 2;
  const nz = Math.ceil((maxZ - minZ) / G) + 2;
  const shoreDist = (x: number, z: number): number => {
    let best = 60;
    for (const e of edges.query(x - 60, z - 60, x + 60, z + 60)) {
      const ex = e[2] - e[0], ez = e[3] - e[1];
      const l2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - e[0]) * ex + (z - e[1]) * ez) / l2));
      best = Math.min(best, Math.hypot(x - e[0] - ex * t, z - e[1] - ez * t));
    }
    return best;
  };
  const inside = new Uint8Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const x = minX - G + ix * G + G / 2;
    const z = minZ - G + iz * G + G / 2;
    inside[iz * nx + ix] = idx.at(x, z) ? 1 : 0;
  }
  const keep = (ix: number, iz: number): boolean => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const jx = ix + dx, jz = iz + dz;
      if (jx >= 0 && jz >= 0 && jx < nx && jz < nz && inside[jz * nx + jx]) return true;
    }
    return false;
  };
  const deep = new THREE.Color(PAL.water).multiplyScalar(0.9);
  const mid = new THREE.Color(PAL.water);
  const shallow = new THREE.Color(PAL.water).lerp(new THREE.Color(0xffffff), 0.18);
  const colAt = new Map<number, THREE.Color>();
  const vcol = (ix: number, iz: number): THREE.Color => {
    const k = iz * (nx + 1) + ix;
    let c = colAt.get(k);
    if (!c) {
      const x = minX - G + ix * G;
      const z = minZ - G + iz * G;
      const d = idx.at(x, z) ? shoreDist(x, z) : 0;
      const t = Math.min(1, d / 45);
      c = t < 0.35 ? shallow.clone().lerp(mid, t / 0.35) : mid.clone().lerp(deep, (t - 0.35) / 0.65);
      colAt.set(k, c);
    }
    return c;
  };
  const up = new THREE.Vector3(0, 1, 0);
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    if (!keep(ix, iz)) continue;
    const x0 = minX - G + ix * G;
    const z0 = minZ - G + iz * G;
    const A = new THREE.Vector3(x0, wl, z0);
    const B = new THREE.Vector3(x0, wl, z0 + G);
    const C = new THREE.Vector3(x0 + G, wl, z0 + G);
    const D = new THREE.Vector3(x0 + G, wl, z0);
    acc.quad(A, B, C, D, [0, 0], [0, 1], [1, 1], [1, 0], vcol(ix, iz), vcol(ix, iz + 1), vcol(ix + 1, iz + 1), vcol(ix + 1, iz), up);
  }
}
