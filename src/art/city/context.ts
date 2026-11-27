/**
 * Shared, precomputed city context: terrain sampler, building preparation (typology, heights,
 * party walls, clipping out of the runnable surface), landmark exclusions, chunking helpers.
 * Pure (no three.js), so the clearance check can run in tests.
 */
import type { CityBuilding, CityData, CityLandmark, ZoneId } from "../../city/data";
import { Grid, centroid, distToSeg, pointInFlat, ringPoints, signedArea, type P2 } from "./geo";
import { newFrame, type Track, type TrackFrame } from "./track";
import { hash01 } from "./shared";

export const CHUNK = 50;
/** Arches and passages: nothing solid below this over the runnable surface. */
export const CLEARANCE = 4.6;

export type Typology = "brick" | "render" | "casco" | "modern" | "shed" | "stone" | "plazaAlta" | "school" | "church" | "hospital" | "theatre" | "hotel" | "public" | "retail";

export interface PreparedBuilding {
  src: CityBuilding;
  index: number;
  /** Main ring, CW in x/z (signed area < 0), clipped out of the runnable surface. */
  ring: P2[];
  /** Extra clipped part (a footprint cut in two by the corridor), same heights. */
  extra: P2[][];
  /** Ring above CLEARANCE when it differs (passages / arches), else null. */
  upperRing: P2[] | null;
  /** Ground under the walls follows the street (near the route) rather than h0. */
  streetGround: boolean;
  /** Highest street level (floors are horizontal above it). */
  G: number;
  top: number;
  zone: ZoneId;
  typ: Typology;
  seed: number;
  chunk: number;
  near: boolean;
  /** Pitched (hip) roof. */
  pitched: boolean;
  /** Name to show on a sign (OSM name, a POI inside the footprint, or the nearby school's). */
  name: string | null;
}

export interface CityCtx {
  city: CityData;
  track: Track;
  lap: number;
  nChunks: number;
  terrainAt(x: number, z: number): number;
  /** Pavement level beside the route at a point (route height + kerb). */
  streetLevel(x: number, z: number, nearS: number): number;
  isParty(bi: number, ax: number, az: number, dx: number, dz: number): boolean;
  waterLevel: number;
  buildings: PreparedBuilding[];
  buildingGrid: Grid<PreparedBuilding>;
  excluded: Set<string>;
  landmark(id: string): CityLandmark | undefined;
  chunkOf(s: number): number;
  frame(s: number): TrackFrame;
  wrapS(s: number): number;
  /** Signed lateral distance to the facade line on a side (+1 right / -1 left), or null. */
  facadeAt(s: number, side: 1 | -1): number | null;
}

export function makeTerrainSampler(city: CityData): (x: number, z: number) => number {
  const t = city.terrain;
  const nx = t.nx;
  const nz = t.nz;
  const h = new Float32Array(nx * nz);
  const known = new Uint8Array(nx * nz);
  const queue: number[] = [];
  for (let i = 0; i < nx * nz; i++) {
    const v = t.h[i];
    if (v !== null && v !== undefined) {
      h[i] = v;
      known[i] = 1;
      queue.push(i);
    }
  }
  // breadth-first fill of the cells outside the corridor with the nearest known height
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    const ix = i % nx;
    const iz = (i / nx) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const jx = ix + dx;
      const jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
      const j = jz * nx + jx;
      if (known[j]) continue;
      known[j] = 1;
      h[j] = h[i]!;
      queue.push(j);
    }
  }
  return (x, z) => {
    const fx = Math.max(0, Math.min(nx - 1.001, (x - t.x0) / t.cell));
    const fz = Math.max(0, Math.min(nz - 1.001, (z - t.z0) / t.cell));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const ax = fx - ix;
    const az = fz - iz;
    const i = iz * nx + ix;
    const a = h[i]!;
    const b = h[i + 1]!;
    const c = h[i + nx]!;
    const d = h[i + nx + 1]!;
    return (a * (1 - ax) + b * ax) * (1 - az) + (c * (1 - ax) + d * ax) * az;
  };
}

const LANDMARK_MODELS = ["torre-siglo-xxi", "catedral", "ayuntamiento", "torre-espantaperros", "puerta-palmas", "puerta-capitel", "templete-san-francisco"];

/** Typology from the data's tags first (school, church, hospital…), then zone, height and footprint. */
function classify(b: CityBuilding, zone: ZoneId, s: number, area: number, plazaAlta: boolean, poiCat: string | null): Typology {
  const t = b.tags ?? {};
  const tag = t["building"] ?? "yes";
  const am = t["amenity"] ?? (poiCat?.startsWith("amenity:") ? poiCat.slice(8) : "");
  const name = (t["name"] ?? "").toLowerCase();
  if (plazaAlta) return "plazaAlta";
  if (t["historic"] || /^torre |^muralla|^baluarte/.test(name)) return "stone";
  if (["school", "college", "university", "kindergarten"].includes(tag) || ["school", "college", "university", "kindergarten"].includes(am) || /colegio|instituto|escuela|universidad|facultad/.test(name)) return "school";
  if (["church", "cathedral", "chapel", "monastery"].includes(tag) || am === "place_of_worship" || /iglesia|parroquia|ermita|capilla|convento/.test(name)) return "church";
  if (tag === "hospital" || am === "hospital" || am === "clinic" || /hospital|clínica|centro de salud/.test(name)) return "hospital";
  if (am === "theatre" || /teatro/.test(name)) return "theatre";
  if (t["tourism"] === "hotel" || /hotel/.test(name)) return "hotel";
  if (["public", "government", "civic"].includes(tag) || ["townhall", "police", "post_office", "courthouse", "library"].includes(am) || t["office"] === "government") return "public";
  if (["supermarket", "department_store", "mall"].includes(t["shop"] ?? "") || ["retail", "commercial", "supermarket"].includes(tag) || am === "fuel") return "retail";
  if (["industrial", "warehouse", "garage", "roof", "kiosk", "train_station"].includes(tag)) return "shed";
  const r = hash01(b.ring.length * 131 + Math.round(b.ring[0] ?? 0), Math.round((b.ring[1] ?? 0) * 10));
  if (b.height < 4.2 && area < 120) return zone === "casco-antiguo" || zone === "alcazaba-palmas" ? "casco" : "shed";
  if (zone === "casco-antiguo" || (zone === "alcazaba-palmas" && s < 5780)) return b.height <= 13.5 ? "casco" : "render";
  if (b.height < 5 && area > 400) return "shed";
  switch (zone) {
    case "san-francisco":
      return r < 0.62 ? "render" : r < 0.9 ? "brick" : "modern";
    case "valdepasillas":
      return r < 0.74 ? "brick" : r < 0.92 ? "render" : "modern";
    case "puente-real":
      return s < 512 ? (r < 0.55 ? "modern" : "brick") : r < 0.75 ? "brick" : "render";
    case "alcazaba-palmas":
      return r < 0.5 ? "render" : "brick";
    case "margen-derecha":
      return area > 1500 && b.height < 12 ? "shed" : r < 0.5 ? "modern" : r < 0.85 ? "brick" : "render";
    default:
      return "brick";
  }
}

export function buildContext(city: CityData, track: Track, lap = 1): CityCtx {
  const L = track.lapLength;
  const wrapS = (s: number): number => ((s % L) + L) % L;
  const nChunks = Math.ceil(L / CHUNK);
  const terrainAt = makeTerrainSampler(city);
  const fr = newFrame();
  const frame = (s: number): TrackFrame => track.frameAt(s, newFrame());

  const lm = new Map(city.landmarks.map((l) => [l.id, l]));
  // buildings replaced by hand-made landmark models
  const excluded = new Set<string>();
  for (const id of LANDMARK_MODELS) {
    const l = lm.get(id);
    if (!l || l.x === undefined || l.z === undefined) continue;
    for (const b of city.buildings) {
      const c = centroid(ringPoints(b.ring));
      const inFp = l.footprint?.some((f) => pointInFlat(c.x, c.z, f)) ?? false;
      if (inFp || Math.hypot(c.x - l.x, c.z - l.z) < (id === "torre-siglo-xxi" ? 22 : 6)) excluded.add(b.id);
    }
  }
  const plazaAltaFp = lm.get("plaza-alta")?.footprint?.[0];

  const buildings: PreparedBuilding[] = [];
  // party wall detection: index all edges
  const edgeGrid = new Grid<{ b: number; ax: number; az: number; bx: number; bz: number }>(20);
  const rings = city.buildings.map((b) => {
    let p = ringPoints(b.ring);
    if (signedArea(p) > 0) p = p.reverse();
    return p;
  });
  rings.forEach((p, bi) => {
    for (let i = 0; i < p.length; i++) {
      const a = p[i]!;
      const c = p[(i + 1) % p.length]!;
      edgeGrid.add({ b: bi, ax: a.x, az: a.z, bx: c.x, bz: c.z }, Math.min(a.x, c.x), Math.min(a.z, c.z), Math.max(a.x, c.x), Math.max(a.z, c.z));
    }
  });

  const streetLevel = (x: number, z: number, nearS: number): number => {
    const pr = track.project(x, z, nearS);
    track.frameAt(pr.s, fr);
    return fr.h + 0.14;
  };
  /** Edge a→d of building bi lies on another building's edge (a party wall / medianera). */
  const isParty = (bi: number, ax: number, az: number, dx: number, dz: number): boolean => {
    const len = Math.hypot(dx - ax, dz - az);
    if (len < 1.0) return true;
    for (const t of [0.25, 0.5, 0.75]) {
      const mx = ax + (dx - ax) * t;
      const mz = az + (dz - az) * t;
      for (const e of edgeGrid.query(mx - 1, mz - 1, mx + 1, mz + 1)) {
        if (e.b !== bi && distToSeg(mx, mz, e.ax, e.az, e.bx, e.bz) < 0.6) return true;
      }
    }
    return false;
  };

  city.buildings.forEach((b, bi) => {
    if (excluded.has(b.id)) return;
    let ring = rings[bi]!;
    if (ring.length < 3) return;
    const area = -signedArea(ring);
    if (area < 4) return;
    const zone = track.zoneAt(b.s).id;
    const c = centroid(ring);
    const plazaAlta = plazaAltaFp !== undefined && b.height < 16 && !pointInFlat(c.x, c.z, plazaAltaFp) && ringNear(ring, plazaAltaFp, 2.5);
    // a named POI inside the footprint names the building and helps its typology (schools…)
    const poi = city.pois.find((p) => Math.abs(p.s - b.s) < 120 && pointInFlat(p.x, p.z, b.ring)) ?? null;
    const nearSchool = city.pois.find((p) => p.category === "amenity:school" && Math.hypot(p.x - c.x, p.z - c.z) < 90) ?? null;
    const isSchoolBuilding = (b.tags?.["building"] ?? "") === "school";
    const typ = classify(b, zone, b.s, area, plazaAlta, poi?.category ?? null);
    // building names: OSM's, or an institution inside (shops keep to their own ground-floor signs)
    const institution = poi && /^amenity:(school|college|university|kindergarten|hospital|clinic|theatre|place_of_worship|townhall|police|post_office|library)$|^tourism:hotel$/.test(poi.category);
    const name = b.tags?.["name"] ?? (institution ? poi.name : null) ?? (isSchoolBuilding && nearSchool ? nearSchool.name : null);
    // clip out of the runnable surface
    const near = b.dist < 25;
    let upperRing: P2[] | null = null;
    let parts: P2[][] = [ring];
    if (b.dist < 14 || b.passesThrough) {
      const clipped = clipRing(ring, track, b.s);
      if (clipped.moved) {
        // a real arch keeps its upper floors over the street; data errors are just cut back
        if (b.passage) upperRing = ring;
        parts = clipped.rings;
      }
    }
    if (parts.length === 0 && !upperRing) return;
    ring = parts[0] ?? ring;
    // street level: floors are horizontal above the highest street level round the footprint
    const streetGround = b.dist < 22;
    const G = streetGround ? Math.max(...parts.flat().concat(ring).map((p) => streetLevel(p.x, p.z, b.s))) : b.h0;
    const top = Math.max(b.h0 + b.height, G + 2.6);
    const pitched = typ === "casco" && b.height < 14;
    buildings.push({
      src: b, index: bi, ring, extra: parts.slice(1), upperRing, streetGround, G, top, zone, typ, near, pitched, name,
      seed: hash01(bi, 77),
      chunk: b.dist < 60 ? Math.floor(wrapS(b.s) / CHUNK) : -1,
    });
  });
  const buildingGrid = new Grid<PreparedBuilding>(30);
  for (const pb of buildings) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of pb.ring) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    buildingGrid.add(pb, minX, minZ, maxX, maxZ);
  }

  const facadeCache = new Map<number, number | null>();
  const facadeAt = (s: number, side: 1 | -1): number | null => {
    const key = Math.round(wrapS(s)) * 2 + (side > 0 ? 1 : 0);
    const hit = facadeCache.get(key);
    if (hit !== undefined) return hit;
    const f = track.frameAt(s, newFrame());
    let best: number | null = null;
    const ox = f.x;
    const oz = f.z;
    const dx = f.nx * side;
    const dz = f.nz * side;
    const set = buildingGrid.query(Math.min(ox, ox + dx * 40), Math.min(oz, oz + dz * 40), Math.max(ox, ox + dx * 40), Math.max(oz, oz + dz * 40));
    for (const pb of set) {
      const r = pb.ring;
      for (let i = 0; i < r.length; i++) {
        const a = r[i]!;
        const c = r[(i + 1) % r.length]!;
        // ray (ox,oz)+t(dx,dz) vs segment a-c
        const ex = c.x - a.x;
        const ez = c.z - a.z;
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-6) continue;
        const t = ((a.x - ox) * ez - (a.z - oz) * ex) / den;
        const u = ((a.x - ox) * dz - (a.z - oz) * dx) / den;
        if (t > 0.5 && t < 40 && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
      }
    }
    const out = best === null ? null : best * side;
    facadeCache.set(key, out);
    return out;
  };

  return {
    city, track, lap, nChunks, terrainAt, streetLevel, isParty,
    waterLevel: city.terrain.waterLevel ?? -10,
    buildings, buildingGrid, excluded,
    landmark: (id) => lm.get(id),
    chunkOf: (s) => Math.floor(wrapS(s) / CHUNK),
    frame, wrapS, facadeAt,
  };
}

/**
 * Cut a footprint out of the runnable corridor: in track space (s, lateral) the corridor is the
 * band left..right (+ margin); the parts of the ring left and right of it are kept
 * (Sutherland-Hodgman against each boundary) and mapped back to the world.
 */
export function clipRing(ring: P2[], track: Track, nearS: number, margin = 0.35): { rings: P2[][]; moved: boolean } {
  const L = track.lapLength;
  const pts: { s: number; l: number }[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  let inside = false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / 1.0));
    for (let k = 0; k < n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n;
      const z = a.z + ((b.z - a.z) * k) / n;
      const pr = track.project(x, z, nearS);
      let s = pr.s;
      while (s - nearS > L / 2) s -= L;
      while (nearS - s > L / 2) s += L;
      pts.push({ s, l: pr.lateral });
    }
  }
  const sMin = Math.min(...pts.map((p) => p.s));
  const sMax = Math.max(...pts.map((p) => p.s));
  for (let s = sMin; s <= sMax + 0.5; s += 1) {
    const lay = track.layoutAt(s);
    lo = Math.min(lo, lay.left - margin);
    hi = Math.max(hi, lay.right + margin);
  }
  for (const p of pts) if (p.l > lo && p.l < hi) inside = true;
  // a footprint that straddles the corridor without a vertex inside it (an arch)
  if (!inside && pts.some((p) => p.l <= lo) && pts.some((p) => p.l >= hi)) inside = true;
  if (!inside) return { rings: [ring], moved: false };
  const clip = (poly: { s: number; l: number }[], keep: (l: number) => boolean, at: number): { s: number; l: number }[] => {
    const out: { s: number; l: number }[] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const pin = keep(p.l);
      const qin = keep(q.l);
      if (pin) out.push(p);
      if (pin !== qin) {
        const t = (at - p.l) / (q.l - p.l);
        out.push({ s: p.s + (q.s - p.s) * t, l: at });
      }
    }
    return out;
  };
  const f = newFrame();
  const rings: P2[][] = [];
  // follow the (curved) corridor edge: subdivide every run along the clip line
  const dense = (poly: { s: number; l: number }[], at: number): { s: number; l: number }[] => {
    const out: { s: number; l: number }[] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      out.push(p);
      if (Math.abs(p.l - at) < 1e-6 && Math.abs(q.l - at) < 1e-6) {
        const n = Math.floor(Math.abs(q.s - p.s) / 1.0);
        for (let k = 1; k < n; k++) out.push({ s: p.s + ((q.s - p.s) * k) / n, l: at });
      }
    }
    return out;
  };
  for (const part of [dense(clip(pts, (l) => l <= lo, lo), lo), dense(clip(pts, (l) => l >= hi, hi), hi)]) {
    if (part.length < 3) continue;
    const r: P2[] = [];
    for (const p of part) {
      track.frameAt(p.s, f);
      const q = { x: f.x + f.nx * p.l, z: f.z + f.nz * p.l };
      const prev = r[r.length - 1];
      if (!prev || Math.hypot(q.x - prev.x, q.z - prev.z) > 0.2) r.push(q);
    }
    // drop collinear points
    const simp = r.filter((b, i) => {
      const a = r[(i - 1 + r.length) % r.length]!;
      const c = r[(i + 1) % r.length]!;
      return Math.abs((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)) > 0.002;
    });
    const fin = simp.length >= 3 ? simp : r;
    if (fin.length >= 3 && Math.abs(signedArea(fin)) > 2) rings.push(signedArea(fin) > 0 ? fin.reverse() : fin);
  }
  return { rings, moved: true };
}

/**
 * Automated check: nothing solid (building parts below CLEARANCE) inside the runnable surface.
 * Returns the offending building ids with the worst intrusion (m).
 */
export function checkRunnableClear(ctx: CityCtx, tolerance = 0.05): { id: string; s: number; intrusion: number }[] {
  const bad: { id: string; s: number; intrusion: number }[] = [];
  for (const pb of ctx.buildings) {
    if (pb.src.dist > 20) continue;
    let worst = 0;
    let ws = 0;
    for (const r of [pb.ring, ...pb.extra]) for (let i = 0; i < r.length; i++) {
      const a = r[i]!;
      const b = r[(i + 1) % r.length]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.ceil(len / 0.25));
      for (let k = 0; k < n; k++) {
        const x = a.x + ((b.x - a.x) * k) / n;
        const z = a.z + ((b.z - a.z) * k) / n;
        const pr = ctx.track.project(x, z, pb.src.s);
        const lay = ctx.track.layoutAt(pr.s);
        const into = Math.min(pr.lateral - lay.left, lay.right - pr.lateral);
        if (into > tolerance && into > worst) {
          worst = into;
          ws = pr.s;
        }
      }
    }
    if (worst > 0) bad.push({ id: pb.src.id, s: ws, intrusion: worst });
  }
  return bad;
}

/** Some vertex of the ring lies within d of the flat polygon's boundary (the building fronts it). */
function ringNear(ring: P2[], flat: readonly number[], d: number): boolean {
  const n = flat.length / 2;
  for (const p of ring) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (distToSeg(p.x, p.z, flat[i * 2]!, flat[i * 2 + 1]!, flat[j * 2]!, flat[j * 2 + 1]!) < d) return true;
    }
  }
  return false;
}
