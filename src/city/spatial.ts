/**
 * Small pure spatial helpers: a uniform-grid index, route-chunk bucketing, and polygon utilities
 * (area, winding, point-in-polygon, offset/inset, ear-clipping triangulation with holes).
 *
 * Rings are flat [x0, z0, x1, z1, ...], not closed (the last point connects to the first).
 * signedArea > 0 ⇔ counter-clockwise in the (x, z) maths plane ⇔ CLOCKWISE on a north-up map seen
 * from above (Z is south). Triangles returned by `triangulate` face +Y (up) for three.js.
 */
import type { CityData, FlatXZ } from "./data";
import type { Track } from "./track";

// ---------------------------------------------------------------------------
// Uniform grid index
// ---------------------------------------------------------------------------

export interface Bounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface GridIndex {
  readonly cellSize: number;
  readonly count: number;
  /** Indices of items whose bounds overlap the rectangle (each once). Appends to and returns `out`. */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out?: number[]): number[];
  /** Items whose bounds overlap the square of half-size r around (x, z). */
  queryRadius(x: number, z: number, r: number, out?: number[]): number[];
}

/**
 * Builds a uniform grid over `count` items. `boundsOf(i, out)` fills the item's bounding box
 * (points: min = max). Items are stored in every cell their bounds overlap.
 */
export function createGridIndex(count: number, boundsOf: (i: number, out: Bounds) => void, cellSize = 25): GridIndex {
  const b: Bounds = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  const cells = new Map<number, number[]>();
  const KEY = 1 << 16;
  const key = (cx: number, cz: number): number => (cx + 32768) * KEY + (cz + 32768);
  const cell = (v: number): number => Math.floor(v / cellSize);
  for (let i = 0; i < count; i++) {
    boundsOf(i, b);
    for (let cx = cell(b.minX); cx <= cell(b.maxX); cx++) {
      for (let cz = cell(b.minZ); cz <= cell(b.maxZ); cz++) {
        const k = key(cx, cz);
        const list = cells.get(k);
        if (list) list.push(i);
        else cells.set(k, [i]);
      }
    }
  }
  const stamp = new Uint32Array(count);
  let epoch = 0;
  const query = (minX: number, minZ: number, maxX: number, maxZ: number, out: number[] = []): number[] => {
    epoch++;
    if (epoch === 0xffffffff) {
      stamp.fill(0);
      epoch = 1;
    }
    for (let cx = cell(minX); cx <= cell(maxX); cx++) {
      for (let cz = cell(minZ); cz <= cell(maxZ); cz++) {
        const list = cells.get(key(cx, cz));
        if (!list) continue;
        for (const i of list) {
          if (stamp[i] === epoch) continue;
          stamp[i] = epoch;
          out.push(i);
        }
      }
    }
    return out;
  };
  return {
    cellSize,
    count,
    query,
    queryRadius: (x, z, r, out) => query(x - r, z - r, x + r, z + r, out),
  };
}

export function ringBounds(ring: FlatXZ, out: Bounds): Bounds {
  out.minX = Infinity;
  out.minZ = Infinity;
  out.maxX = -Infinity;
  out.maxZ = -Infinity;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const x = ring[i]!;
    const z = ring[i + 1]!;
    if (x < out.minX) out.minX = x;
    if (x > out.maxX) out.maxX = x;
    if (z < out.minZ) out.minZ = z;
    if (z > out.maxZ) out.maxZ = z;
  }
  return out;
}

const pointBounds = (x: number, z: number, out: Bounds): void => {
  out.minX = out.maxX = x;
  out.minZ = out.maxZ = z;
};

/** Grid over city.buildings by footprint bounds (indices into city.buildings). */
export const indexBuildings = (city: CityData, cellSize = 25): GridIndex =>
  createGridIndex(city.buildings.length, (i, o) => void ringBounds(city.buildings[i]!.ring, o), cellSize);
/** Grid over trees (indices i into the flat array: tree i is city.trees[5i .. 5i+4]). */
export const indexTrees = (city: CityData, cellSize = 25): GridIndex =>
  createGridIndex(city.trees.length / 5, (i, o) => pointBounds(city.trees[i * 5]!, city.trees[i * 5 + 1]!, o), cellSize);
export const indexPois = (city: CityData, cellSize = 25): GridIndex =>
  createGridIndex(city.pois.length, (i, o) => pointBounds(city.pois[i]!.x, city.pois[i]!.z, o), cellSize);
export const indexFurniture = (city: CityData, cellSize = 25): GridIndex =>
  createGridIndex(city.furniture.length, (i, o) => pointBounds(city.furniture[i]!.x, city.furniture[i]!.z, o), cellSize);

// ---------------------------------------------------------------------------
// Route chunks
// ---------------------------------------------------------------------------

export const CHUNK_LENGTH = 50;

export interface ChunkPlacement {
  /** Index of the item in its source list. */
  index: number;
  s: number;
  lateral: number;
  side: "left" | "right";
}

export interface Chunks {
  chunkLength: number;
  /** chunks[c] holds the items whose projected s is in [c·chunkLength, (c+1)·chunkLength). */
  chunks: ChunkPlacement[][];
  /** Chunk index of a (wrapped) s. */
  chunkAt(s: number): number;
}

/**
 * Buckets `count` items by the route chunk they are nearest to. `posOf(i, out)` gives the item's
 * position; `hintS(i)` (optional) a nearby s from the data (buildings/pois/furniture carry one),
 * which keeps the projection on the right part of the lap where it passes itself.
 */
export function bucketByChunk(
  track: Track,
  count: number,
  posOf: (i: number, out: { x: number; z: number }) => void,
  opts: { chunkLength?: number; hintS?: (i: number) => number | undefined; maxLateral?: number } = {},
): Chunks {
  const len = opts.chunkLength ?? CHUNK_LENGTH;
  const lap = track.lapLength;
  const nChunks = Math.ceil(lap / len);
  const chunks: ChunkPlacement[][] = Array.from({ length: nChunks }, () => []);
  const chunkAt = (s: number): number => {
    const w = s - lap * Math.floor(s / lap);
    return Math.min(nChunks - 1, Math.floor(w / len));
  };
  const p = { x: 0, z: 0 };
  for (let i = 0; i < count; i++) {
    posOf(i, p);
    const hint = opts.hintS?.(i);
    const pr = track.project(p.x, p.z, hint);
    if (opts.maxLateral !== undefined && Math.abs(pr.lateral) > opts.maxLateral) continue;
    const s = pr.s - lap * Math.floor(pr.s / lap);
    chunks[chunkAt(s)]!.push({ index: i, s, lateral: pr.lateral, side: pr.lateral >= 0 ? "right" : "left" });
  }
  return { chunkLength: len, chunks, chunkAt };
}

/** Centroid (area-weighted; vertex mean for degenerate rings). */
export function ringCentroid(ring: FlatXZ, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  const n = ring.length >> 1;
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = ring[2 * i]!;
    const zi = ring[2 * i + 1]!;
    const xj = ring[2 * j]!;
    const zj = ring[2 * j + 1]!;
    const c = xi * zj - xj * zi;
    a += c;
    cx += (xi + xj) * c;
    cz += (zi + zj) * c;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < n; i++) {
      sx += ring[2 * i]!;
      sz += ring[2 * i + 1]!;
    }
    out.x = sx / Math.max(1, n);
    out.z = sz / Math.max(1, n);
    return out;
  }
  out.x = cx / (3 * a);
  out.z = cz / (3 * a);
  return out;
}

// ---------------------------------------------------------------------------
// Polygons
// ---------------------------------------------------------------------------

/** Shoelace area: > 0 counter-clockwise in the (x, z) maths plane (see header). */
export function signedArea(ring: FlatXZ): number {
  const n = ring.length >> 1;
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) a += ring[2 * j]! * ring[2 * i + 1]! - ring[2 * i]! * ring[2 * j + 1]!;
  return a / 2;
}

export const ringArea = (ring: FlatXZ): number => Math.abs(signedArea(ring));

/** Reversed copy of a ring. */
export function reverseRing(ring: FlatXZ): FlatXZ {
  const n = ring.length >> 1;
  const out: number[] = new Array<number>(ring.length);
  for (let i = 0; i < n; i++) {
    out[2 * i] = ring[2 * (n - 1 - i)]!;
    out[2 * i + 1] = ring[2 * (n - 1 - i) + 1]!;
  }
  return out;
}

/** Returns the ring (same array if already right) with signedArea of the given sign. */
export function withWinding(ring: FlatXZ, sign: 1 | -1): FlatXZ {
  return signedArea(ring) * sign >= 0 ? ring : reverseRing(ring);
}

/** Even-odd point-in-polygon (ring plus optional holes). */
export function pointInPolygon(x: number, z: number, ring: FlatXZ, holes?: readonly FlatXZ[]): boolean {
  const inRing = (r: FlatXZ): boolean => {
    let inside = false;
    const n = r.length >> 1;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = r[2 * i]!;
      const zi = r[2 * i + 1]!;
      const xj = r[2 * j]!;
      const zj = r[2 * j + 1]!;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  if (!inRing(ring)) return false;
  if (holes) for (const h of holes) if (inRing(h)) return false;
  return true;
}

/**
 * Offsets a simple ring by d metres (d > 0 grows it, d < 0 insets it), whatever its winding, with
 * mitred corners limited to miterLimit·|d|. Not a full polygon offset: large insets of concave
 * rings can self-intersect.
 */
export function offsetRing(ring: FlatXZ, d: number, miterLimit = 2): FlatXZ {
  const n = ring.length >> 1;
  const s = signedArea(ring) >= 0 ? 1 : -1;
  const out: number[] = new Array<number>(ring.length);
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n;
    const q = (i + 1) % n;
    const x = ring[2 * i]!;
    const z = ring[2 * i + 1]!;
    // Outward edge normals: for a positive ring, edge (dx, dz) → (dz, -dx).
    let ax = x - ring[2 * p]!;
    let az = z - ring[2 * p + 1]!;
    let bx = ring[2 * q]! - x;
    let bz = ring[2 * q + 1]! - z;
    const la = Math.hypot(ax, az) || 1;
    const lb = Math.hypot(bx, bz) || 1;
    ax /= la;
    az /= la;
    bx /= lb;
    bz /= lb;
    const n1x = az * s;
    const n1z = -ax * s;
    const n2x = bz * s;
    const n2z = -bx * s;
    let mx = n1x + n2x;
    let mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-9) {
      mx = n1x;
      mz = n1z;
    } else {
      mx /= ml;
      mz /= ml;
      const cos = mx * n1x + mz * n1z;
      const k = Math.min(1 / Math.max(cos, 1e-6), miterLimit);
      mx *= k;
      mz *= k;
    }
    out[2 * i] = x + mx * d;
    out[2 * i + 1] = z + mz * d;
  }
  return out;
}

export interface Triangulation {
  /** Flat [x, z, ...]: the outer ring's vertices, then each hole's, in input order. */
  vertices: number[];
  /** Triangle vertex indices into `vertices` (pairs), each triangle facing +Y. */
  indices: number[];
}

const EPS = 1e-12;

/**
 * Ear-clipping triangulation of a simple polygon with optional holes (holes are bridged into the
 * outer ring first). Robust to duplicate and collinear points; on rings that are slightly
 * self-intersecting it falls back to clipping the least-bad convex vertex, so it always finishes.
 */
export function triangulate(ring: FlatXZ, holes?: readonly FlatXZ[]): Triangulation {
  const vertices: number[] = [...ring];
  const outerN = ring.length >> 1;
  // Working polygon: list of vertex indices, positive (CCW maths) orientation.
  let poly: number[] = [];
  for (let i = 0; i < outerN; i++) poly.push(i);
  const X = (k: number): number => vertices[2 * k]!;
  const Z = (k: number): number => vertices[2 * k + 1]!;
  const areaOf = (idx: number[]): number => {
    let a = 0;
    for (let i = 0, j = idx.length - 1; i < idx.length; j = i++) a += X(idx[j]!) * Z(idx[i]!) - X(idx[i]!) * Z(idx[j]!);
    return a / 2;
  };
  poly = clean(poly, X, Z);
  if (areaOf(poly) < 0) poly.reverse();

  if (holes && holes.length > 0) {
    const hs: number[][] = [];
    for (const h of holes) {
      const base = vertices.length >> 1;
      vertices.push(...h);
      let idx: number[] = [];
      for (let i = 0; i < h.length >> 1; i++) idx.push(base + i);
      idx = clean(idx, X, Z);
      if (idx.length < 3) continue;
      if (areaOf(idx) > 0) idx.reverse();
      hs.push(idx);
    }
    // Rightmost holes first.
    const maxX = (h: number[]): number => Math.max(...h.map(X));
    hs.sort((a, b) => maxX(b) - maxX(a));
    for (let hi = 0; hi < hs.length; hi++) poly = bridgeHole(poly, hs[hi]!, hs.slice(hi + 1), X, Z);
  }

  const indices: number[] = [];
  const cross = (a: number, b: number, c: number): number => (X(b) - X(a)) * (Z(c) - Z(a)) - (Z(b) - Z(a)) * (X(c) - X(a));
  const same = (a: number, b: number): boolean => X(a) === X(b) && Z(a) === Z(b);
  const inTri = (p: number, a: number, b: number, c: number): boolean => {
    if (same(p, a) || same(p, b) || same(p, c)) return false;
    return cross(a, b, p) >= -EPS && cross(b, c, p) >= -EPS && cross(c, a, p) >= -EPS;
  };
  const emit = (a: number, b: number, c: number): void => {
    // Working orientation is CCW in maths (x, z) → faces -Y; emit reversed to face +Y.
    indices.push(a, c, b);
  };

  const v = poly;
  let guard = 0;
  while (v.length > 3 && guard++ < 100000) {
    let clipped = false;
    let bestI = -1;
    let bestScore = Infinity;
    for (let i = 0; i < v.length; i++) {
      const a = v[(i - 1 + v.length) % v.length]!;
      const b = v[i]!;
      const c = v[(i + 1) % v.length]!;
      const cr = cross(a, b, c);
      if (cr <= EPS) {
        // Degenerate (collinear / zero-length) vertices can be dropped outright.
        if (Math.abs(cr) <= EPS) {
          v.splice(i, 1);
          clipped = true;
          break;
        }
        continue;
      }
      let ear = true;
      let inside = 0;
      for (const p of v) {
        if (p === a || p === b || p === c) continue;
        if (inTri(p, a, b, c)) {
          ear = false;
          inside++;
        }
      }
      if (ear) {
        emit(a, b, c);
        v.splice(i, 1);
        clipped = true;
        break;
      }
      if (inside < bestScore) {
        bestScore = inside;
        bestI = i;
      }
    }
    if (clipped) continue;
    // No ear (self-touching or self-intersecting input): clip the least-bad convex vertex,
    // or failing that drop the vertex with the smallest |cross|.
    if (bestI < 0) {
      let m = Infinity;
      for (let i = 0; i < v.length; i++) {
        const c = Math.abs(cross(v[(i - 1 + v.length) % v.length]!, v[i]!, v[(i + 1) % v.length]!));
        if (c < m) {
          m = c;
          bestI = i;
        }
      }
      v.splice(bestI, 1);
      continue;
    }
    emit(v[(bestI - 1 + v.length) % v.length]!, v[bestI]!, v[(bestI + 1) % v.length]!);
    v.splice(bestI, 1);
  }
  if (v.length === 3 && cross(v[0]!, v[1]!, v[2]!) > EPS) emit(v[0]!, v[1]!, v[2]!);
  return { vertices, indices };
}

/** Drops consecutive duplicates and exactly collinear points. */
function clean(idx: number[], X: (k: number) => number, Z: (k: number) => number): number[] {
  let out = idx.filter((k, i) => {
    const p = idx[(i - 1 + idx.length) % idx.length]!;
    return !(X(k) === X(p) && Z(k) === Z(p)) || idx.length === 1;
  });
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length]!;
      const b = out[i]!;
      const c = out[(i + 1) % out.length]!;
      const cr = (X(b) - X(a)) * (Z(c) - Z(a)) - (Z(b) - Z(a)) * (X(c) - X(a));
      if (Math.abs(cr) <= EPS) {
        out = out.slice(0, i).concat(out.slice(i + 1));
        changed = true;
        break;
      }
    }
  }
  return out;
}

function segmentsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Joins a (negatively wound) hole into the outer polygon through the nearest visible vertex. */
function bridgeHole(poly: number[], hole: number[], others: number[][], X: (k: number) => number, Z: (k: number) => number): number[] {
  let hm = 0;
  for (let i = 1; i < hole.length; i++) if (X(hole[i]!) > X(hole[hm]!)) hm = i;
  const m = hole[hm]!;
  const order = poly.map((_, i) => i).sort((a, b) => {
    const da = (X(poly[a]!) - X(m)) ** 2 + (Z(poly[a]!) - Z(m)) ** 2;
    const db = (X(poly[b]!) - X(m)) ** 2 + (Z(poly[b]!) - Z(m)) ** 2;
    return da - db;
  });
  const rings = [poly, hole, ...others];
  const visible = (p: number): boolean => {
    for (const r of rings) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i]!;
        const b = r[(i + 1) % r.length]!;
        if (segmentsCross(X(p), Z(p), X(m), Z(m), X(a), Z(a), X(b), Z(b))) return false;
      }
    }
    return true;
  };
  let pi = order[0]!;
  for (const i of order) {
    if (visible(poly[i]!)) {
      pi = i;
      break;
    }
  }
  const rotated = [...hole.slice(hm), ...hole.slice(0, hm)];
  return [...poly.slice(0, pi + 1), ...rotated, m, poly[pi]!, ...poly.slice(pi + 1)];
}

/** Sum of the triangles' areas. */
export function triangulatedArea(t: Triangulation): number {
  let a = 0;
  const v = t.vertices;
  for (let i = 0; i + 2 < t.indices.length; i += 3) {
    const p = t.indices[i]!;
    const q = t.indices[i + 1]!;
    const r = t.indices[i + 2]!;
    a += Math.abs((v[2 * q]! - v[2 * p]!) * (v[2 * r + 1]! - v[2 * p + 1]!) - (v[2 * q + 1]! - v[2 * p + 1]!) * (v[2 * r]! - v[2 * p]!)) / 2;
  }
  return a;
}
