/** Small 2D geometry helpers on flat [x, z, ...] rings (pure). */

export interface P2 {
  x: number;
  z: number;
}

export function ringPoints(flat: readonly number[]): P2[] {
  const out: P2[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i] ?? 0, z: flat[i + 1] ?? 0 });
  // drop a closing duplicate
  const a = out[0];
  const b = out[out.length - 1];
  if (a && b && out.length > 2 && Math.hypot(a.x - b.x, a.z - b.z) < 1e-3) out.pop();
  return out;
}

export function signedArea(p: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const u = p[i]!;
    const v = p[(i + 1) % p.length]!;
    a += u.x * v.z - v.x * u.z;
  }
  return a / 2;
}

export function centroid(p: readonly P2[]): P2 {
  let x = 0;
  let z = 0;
  for (const q of p) {
    x += q.x;
    z += q.z;
  }
  return { x: x / Math.max(1, p.length), z: z / Math.max(1, p.length) };
}

export function pointInRing(x: number, z: number, p: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i]!;
    const b = p[j]!;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function pointInFlat(x: number, z: number, flat: readonly number[]): boolean {
  let inside = false;
  const n = flat.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = flat[i * 2]!;
    const az = flat[i * 2 + 1]!;
    const bx = flat[j * 2]!;
    const bz = flat[j * 2 + 1]!;
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

export function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

/** Minimum-area oriented rectangle over the ring's edge directions. */
export function obb(p: readonly P2[]): { cx: number; cz: number; ux: number; uz: number; hl: number; hw: number; area: number } {
  let best = { cx: 0, cz: 0, ux: 1, uz: 0, hl: 0, hw: 0, area: Infinity };
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l < 0.5) continue;
    const ux = (b.x - a.x) / l;
    const uz = (b.z - a.z) / l;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const q of p) {
      const u = q.x * ux + q.z * uz;
      const v = -q.x * uz + q.z * ux;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) {
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      let hl = (maxU - minU) / 2;
      let hw = (maxV - minV) / 2;
      let fux = ux;
      let fuz = uz;
      if (hw > hl) {
        // make u the long axis
        [hl, hw] = [hw, hl];
        fux = -uz;
        fuz = ux;
      }
      best = { cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, ux: fux, uz: fuz, hl, hw, area };
    }
  }
  return best;
}

/** Spatial hash of items by axis-aligned bounds. */
export class Grid<T> {
  private readonly cells = new Map<number, T[]>();
  constructor(readonly cell: number) {}
  private key(ix: number, iz: number): number {
    return (ix + 4096) * 8192 + (iz + 4096);
  }
  add(item: T, minX: number, minZ: number, maxX: number, maxZ: number): void {
    for (let ix = Math.floor(minX / this.cell); ix <= Math.floor(maxX / this.cell); ix++) {
      for (let iz = Math.floor(minZ / this.cell); iz <= Math.floor(maxZ / this.cell); iz++) {
        const k = this.key(ix, iz);
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(item);
      }
    }
  }
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Set<T> = new Set()): Set<T> {
    for (let ix = Math.floor(minX / this.cell); ix <= Math.floor(maxX / this.cell); ix++) {
      for (let iz = Math.floor(minZ / this.cell); iz <= Math.floor(maxZ / this.cell); iz++) {
        const l = this.cells.get(this.key(ix, iz));
        if (l) for (const it of l) out.add(it);
      }
    }
    return out;
  }
}
