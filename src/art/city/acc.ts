/**
 * Geometry accumulator for the city: flat (non-indexed) triangles with position, normal, colour,
 * uv and any number of extra float attributes held as "current state" while emitting vertices.
 */
import * as THREE from "three";

export class Acc {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly uv: number[] = [];
  private readonly extras = new Map<string, { size: number; data: number[]; cur: number[] }>();

  constructor(extras: Record<string, number> = {}) {
    for (const [k, size] of Object.entries(extras)) this.extras.set(k, { size, data: [], cur: new Array<number>(size).fill(0) });
  }

  /** Set the current value of an extra attribute for the following vertices. */
  set(name: string, ...v: number[]): this {
    const e = this.extras.get(name);
    if (e) for (let i = 0; i < e.size; i++) e.cur[i] = v[i] ?? 0;
    return this;
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, g: number, b: number, u: number, v: number): void {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.col.push(r, g, b);
    this.uv.push(u, v);
    for (const e of this.extras.values()) for (const c of e.cur) e.data.push(c);
  }

  /**
   * Quad a-b-c-d (counter-clockwise seen from the front) with per-corner uv and colour (rgb
   * multipliers). Normal from the geometry unless given.
   */
  quad(
    a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, d: THREE.Vector3Like,
    uva: [number, number], uvb: [number, number], uvc: [number, number], uvd: [number, number],
    ca: THREE.Color, cb: THREE.Color = ca, cc: THREE.Color = cb, cd: THREE.Color = ca,
    n?: THREE.Vector3Like,
  ): void {
    let nx: number, ny: number, nz: number;
    if (n) {
      nx = n.x; ny = n.y; nz = n.z;
    } else {
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
      const vx = d.x - a.x, vy = d.y - a.y, vz = d.z - a.z;
      nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
    }
    const V = (p: THREE.Vector3Like, t: [number, number], c0: THREE.Color): void => this.vert(p.x, p.y, p.z, nx, ny, nz, c0.r, c0.g, c0.b, t[0], t[1]);
    V(a, uva, ca); V(b, uvb, cb); V(c, uvc, cc);
    V(a, uva, ca); V(c, uvc, cc); V(d, uvd, cd);
  }

  tri(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, uva: [number, number], uvb: [number, number], uvc: [number, number], col: THREE.Color, n?: THREE.Vector3Like): void {
    let nx: number, ny: number, nz: number;
    if (n) {
      nx = n.x; ny = n.y; nz = n.z;
    } else {
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
      const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
    }
    this.vert(a.x, a.y, a.z, nx, ny, nz, col.r, col.g, col.b, uva[0], uva[1]);
    this.vert(b.x, b.y, b.z, nx, ny, nz, col.r, col.g, col.b, uvb[0], uvb[1]);
    this.vert(c.x, c.y, c.z, nx, ny, nz, col.r, col.g, col.b, uvc[0], uvc[1]);
  }

  /** Append raw triangles from another accumulator with the same extras. */
  append(o: Acc): void {
    this.pos.push(...o.pos);
    this.nrm.push(...o.nrm);
    this.col.push(...o.col);
    this.uv.push(...o.uv);
    for (const [k, e] of this.extras) {
      const oe = o.extras.get(k);
      if (oe) e.data.push(...oe.data);
    }
  }

  geometry(): THREE.BufferGeometry | null {
    if (this.pos.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    for (const [k, e] of this.extras) g.setAttribute(k, new THREE.Float32BufferAttribute(e.data, e.size));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    g.userData["perInstance"] = true;
    return g;
  }

  mesh(mat: THREE.Material, name = ""): THREE.Mesh | null {
    const g = this.geometry();
    if (!g) return null;
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.castShadow = mat.userData["cast"] === true;
    m.receiveShadow = mat.userData["receive"] !== false;
    m.matrixAutoUpdate = false;
    return m;
  }

  clear(): void {
    this.pos.length = 0;
    this.nrm.length = 0;
    this.col.length = 0;
    this.uv.length = 0;
    for (const e of this.extras.values()) e.data.length = 0;
  }
}

/** Scratch vectors. */
export const v3 = (x = 0, y = 0, z = 0): THREE.Vector3 => new THREE.Vector3(x, y, z);
