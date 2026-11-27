/**
 * Geometry builder: accumulates transformed primitives with vertex colours into one bucket per
 * material, then emits one mesh per material. This is how segments, vehicles and props stay at a
 * handful of draw calls.
 */
import * as THREE from "three";
import { SOLID } from "./materials";
import { signAtlas, signRect } from "./text";

interface Tpl {
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array;
}

interface Bucket {
  mat: THREE.Material;
  pos: number[];
  nrm: number[];
  col: number[];
  uv: number[];
}

const tplCache = new WeakMap<THREE.BufferGeometry, Tpl>();

function toTpl(g: THREE.BufferGeometry): Tpl {
  let t = tplCache.get(g);
  if (t) return t;
  const ni = g.index ? g.toNonIndexed() : g;
  if (!ni.getAttribute("normal")) ni.computeVertexNormals();
  const p = ni.getAttribute("position");
  const n = ni.getAttribute("normal");
  const u = ni.getAttribute("uv");
  const count = p.count;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = p.getX(i);
    pos[i * 3 + 1] = p.getY(i);
    pos[i * 3 + 2] = p.getZ(i);
    nrm[i * 3] = n.getX(i);
    nrm[i * 3 + 1] = n.getY(i);
    nrm[i * 3 + 2] = n.getZ(i);
    if (u) {
      uv[i * 2] = u.getX(i);
      uv[i * 2 + 1] = u.getY(i);
    }
  }
  t = { pos, nrm, uv };
  tplCache.set(g, t);
  return t;
}

// Unit templates (cached, never disposed).
const cylCache = new Map<string, THREE.BufferGeometry>();
export const T = {
  box: new THREE.BoxGeometry(1, 1, 1),
  plane: new THREE.PlaneGeometry(1, 1),
  ico: new THREE.IcosahedronGeometry(1, 0),
  ico1: new THREE.IcosahedronGeometry(1, 1),
  /** Cylinder radius 1, height 1, centred. */
  cyl(n = 8, open = false): THREE.BufferGeometry {
    const k = `c${n}${open}`;
    let g = cylCache.get(k);
    if (!g) {
      g = new THREE.CylinderGeometry(1, 1, 1, n, 1, open);
      cylCache.set(k, g);
    }
    return g;
  },
  /** Cone radius 1, height 1, centred. */
  cone(n = 8): THREE.BufferGeometry {
    const k = `k${n}`;
    let g = cylCache.get(k);
    if (!g) {
      g = new THREE.CylinderGeometry(0, 1, 1, n, 1);
      cylCache.set(k, g);
    }
    return g;
  },
  /** Truncated cone: top radius r (bottom 1), height 1, centred. */
  frustum(r: number, n = 8): THREE.BufferGeometry {
    const k = `f${r.toFixed(3)}_${n}`;
    let g = cylCache.get(k);
    if (!g) {
      g = new THREE.CylinderGeometry(r, 1, 1, n, 1);
      cylCache.set(k, g);
    }
    return g;
  },
  sphere(w = 10, h = 7): THREE.BufferGeometry {
    const k = `s${w}_${h}`;
    let g = cylCache.get(k);
    if (!g) {
      g = new THREE.SphereGeometry(1, w, h);
      cylCache.set(k, g);
    }
    return g;
  },
  /** Hemisphere (top half) radius 1. */
  dome(w = 10, h = 4): THREE.BufferGeometry {
    const k = `d${w}_${h}`;
    let g = cylCache.get(k);
    if (!g) {
      g = new THREE.SphereGeometry(1, w, h, 0, Math.PI * 2, 0, Math.PI / 2);
      cylCache.set(k, g);
    }
    return g;
  },
  /** Capsule radius 1 with straight length `len` (multiples of radius), centred. */
  capsule(len: number, cap = 4, radial = 10): THREE.BufferGeometry {
    const k = `p${len.toFixed(3)}_${cap}_${radial}`;
    let g = cylCache.get(k);
    if (!g) {
      g = new THREE.CapsuleGeometry(1, len, cap, radial);
      cylCache.set(k, g);
    }
    return g;
  },
  torus(arc = Math.PI * 2, tube = 0.3, radial = 6, tubular = 16): THREE.BufferGeometry {
    const k = `t${arc.toFixed(3)}_${tube}_${radial}_${tubular}`;
    let g = cylCache.get(k);
    if (!g) {
      g = new THREE.TorusGeometry(1, tube, radial, tubular, arc);
      cylCache.set(k, g);
    }
    return g;
  },
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, "YXZ");
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Compose a transform: translate, rotate (Euler YXZ), scale. Returns a shared scratch matrix. */
export function xf(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _full = new THREE.Matrix4();

export type V3 = [number, number, number];

export class Builder {
  private buckets = new Map<THREE.Material, Bucket>();
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  /** Optional material substitution (e.g. floodlit versions of landmarks at night). */
  remap: Map<THREE.Material, THREE.Material> | null = null;
  /** Use the brighter, self-lit sign material (night). */
  litSigns = false;

  /** Run `fn` with materials substituted according to `map`. */
  with(map: Map<THREE.Material, THREE.Material> | null, fn: () => void): this {
    const prev = this.remap;
    this.remap = map;
    fn();
    this.remap = prev;
    return this;
  }

  private bucket(material: THREE.Material): Bucket {
    const mat = this.remap?.get(material) ?? material;
    let b = this.buckets.get(mat);
    if (!b) {
      b = { mat, pos: [], nrm: [], col: [], uv: [] };
      this.buckets.set(mat, b);
    }
    return b;
  }

  private get top(): THREE.Matrix4 {
    const m = this.stack[this.stack.length - 1];
    if (!m) throw new Error("empty stack");
    return m;
  }

  /** Push a local transform (relative to the current one). */
  push(m: THREE.Matrix4): this {
    this.stack.push(this.top.clone().multiply(m));
    return this;
  }
  /** Push translate + rotate about Y. */
  at(x: number, y: number, z: number, ry = 0, s = 1): this {
    return this.push(xf(x, y, z, s, s, s, 0, ry, 0));
  }
  pop(): this {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }

  /**
   * Optional junction clip: everything beside the road (|x| > ax) is kept out of z > z.
   * Short primitives touching that strip are dropped; long ones (strips, facades, ridges running
   * along the road) are cut back to z by clamping their vertices. The road itself is untouched.
   */
  clip: { z: number; ax: number } | null = null;

  private emit(b: Bucket, pos: number[], nrm: number[], uv: number[]): void {
    const n = pos.length / 3;
    const c = this.clip;
    if (c) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3] ?? 0;
        const z = pos[i * 3 + 2] ?? 0;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      if (maxZ > c.z + 1e-4 && (maxX > c.ax || minX < -c.ax)) {
        if (maxZ - minZ < 12) return;
        // clamp per triangle, re-deriving uv from the original triangle (affine along the strip)
        for (let t = 0; t < n; t += 3) {
          const P = [0, 1, 2].map((k) => new THREE.Vector3(pos[(t + k) * 3], pos[(t + k) * 3 + 1], pos[(t + k) * 3 + 2]));
          const U = [0, 1, 2].map((k) => new THREE.Vector2(uv[(t + k) * 2], uv[(t + k) * 2 + 1]));
          const clamped = P.map((p) => p.z > c.z);
          const all = clamped.every(Boolean);
          for (let k = 0; k < 3; k++) {
            const p = P[k];
            const u = U[k];
            if (!p || !u) continue;
            if (clamped[k]) {
              const q = new THREE.Vector3(p.x, p.y, c.z);
              if (!all) {
                const [a0, a1, a2] = P;
                const [u0, u1, u2] = U;
                if (a0 && a1 && a2 && u0 && u1 && u2) {
                  const bc = new THREE.Triangle(a0, a1, a2).getBarycoord(q, new THREE.Vector3());
                  if (bc) u.set(u0.x * bc.x + u1.x * bc.y + u2.x * bc.z, u0.y * bc.x + u1.y * bc.y + u2.y * bc.z);
                }
              }
              p.copy(q);
            }
          }
          for (let k = 0; k < 3; k++) {
            const p = P[k];
            const u = U[k];
            if (!p || !u) continue;
            b.pos.push(p.x, p.y, p.z);
            b.nrm.push(nrm[(t + k) * 3] ?? 0, nrm[(t + k) * 3 + 1] ?? 1, nrm[(t + k) * 3 + 2] ?? 0);
            b.col.push(_c.r, _c.g, _c.b);
            b.uv.push(u.x, u.y);
          }
        }
        return;
      }
    }
    for (let i = 0; i < n; i++) {
      b.pos.push(pos[i * 3] ?? 0, pos[i * 3 + 1] ?? 0, pos[i * 3 + 2] ?? 0);
      b.nrm.push(nrm[i * 3] ?? 0, nrm[i * 3 + 1] ?? 0, nrm[i * 3 + 2] ?? 0);
      b.col.push(_c.r, _c.g, _c.b);
      b.uv.push(uv[i * 2] ?? 0, uv[i * 2 + 1] ?? 0);
    }
  }

  /** Add a template geometry with transform `m` (local), flat colour. Optional uv remap. */
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.ColorRepresentation, mat: THREE.Material = SOLID, uvRect?: readonly [number, number, number, number]): this {
    const t = toTpl(geo);
    const b = this.bucket(mat);
    _full.multiplyMatrices(this.top, m);
    _nm.getNormalMatrix(_full);
    _c.set(color);
    const n = t.pos.length / 3;
    const flip = _full.determinant() < 0;
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    for (let k = 0; k < n; k++) {
      // Mirrored transforms reverse the winding; swap two vertices per triangle to keep faces outward.
      const i = flip && k % 3 === 1 ? k + 1 : flip && k % 3 === 2 ? k - 1 : k;
      _v.set(t.pos[i * 3] ?? 0, t.pos[i * 3 + 1] ?? 0, t.pos[i * 3 + 2] ?? 0).applyMatrix4(_full);
      _n.set(t.nrm[i * 3] ?? 0, t.nrm[i * 3 + 1] ?? 0, t.nrm[i * 3 + 2] ?? 1).applyMatrix3(_nm).normalize();
      pos.push(_v.x, _v.y, _v.z);
      nrm.push(_n.x, _n.y, _n.z);
      const u = t.uv[i * 2] ?? 0;
      const w = t.uv[i * 2 + 1] ?? 0;
      if (uvRect) uv.push(uvRect[0] + (uvRect[2] - uvRect[0]) * u, uvRect[1] + (uvRect[3] - uvRect[1]) * w);
      else uv.push(u, w);
    }
    this.emit(b, pos, nrm, uv);
    return this;
  }

  /** Box centred at (x,y,z). */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, mat: THREE.Material = SOLID, ry = 0): this {
    return this.add(T.box, xf(x, y, z, w, h, d, 0, ry, 0), color, mat);
  }
  /** Box with its bottom at y. */
  boxB(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, mat: THREE.Material = SOLID, ry = 0): this {
    return this.add(T.box, xf(x, y + h / 2, z, w, h, d, 0, ry, 0), color, mat);
  }
  /** Box spanning explicit ranges. */
  span(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: THREE.ColorRepresentation, mat: THREE.Material = SOLID): this {
    return this.add(T.box, xf((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), color, mat);
  }
  /** Vertical cylinder, bottom at y. */
  cyl(x: number, y: number, z: number, r: number, h: number, color: THREE.ColorRepresentation, n = 8, mat: THREE.Material = SOLID, rTop?: number): this {
    const g = rTop === undefined ? T.cyl(n) : T.frustum(rTop / r, n);
    return this.add(g, xf(x, y + h / 2, z, r, h, r), color, mat);
  }
  cone(x: number, y: number, z: number, r: number, h: number, color: THREE.ColorRepresentation, n = 8, mat: THREE.Material = SOLID): this {
    return this.add(T.cone(n), xf(x, y + h / 2, z, r, h, r), color, mat);
  }
  /** Low-poly blob (icosahedron) centred. */
  blob(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, mat: THREE.Material = SOLID, ry = 0): this {
    return this.add(T.ico, xf(x, y, z, sx, sy, sz, 0, ry, 0), color, mat);
  }
  sphere(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, mat: THREE.Material = SOLID, w = 8, h = 6): this {
    return this.add(T.sphere(w, h), xf(x, y, z, sx, sy, sz), color, mat);
  }
  /** Square beam between two points. */
  beam(a: V3, b: V3, thick: number, color: THREE.ColorRepresentation, mat: THREE.Material = SOLID, n = 0): this {
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = dir.length();
    if (len < 1e-6) return this;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2),
      q,
      new THREE.Vector3(thick, len, thick),
    );
    return this.add(n > 0 ? T.cyl(n) : T.box, m, color, mat);
  }
  /** Unit plane (facing +Z before transform). */
  quad(m: THREE.Matrix4, color: THREE.ColorRepresentation, mat: THREE.Material, uvRect?: readonly [number, number, number, number]): this {
    return this.add(T.plane, m, color, mat, uvRect);
  }
  /** Triangle (double-sided only if the material is). */
  tri(a: V3, b: V3, c: V3, color: THREE.ColorRepresentation, mat: THREE.Material = SOLID): this {
    const bk = this.bucket(mat);
    _c.set(color);
    const top = this.top;
    const pa = new THREE.Vector3(...a).applyMatrix4(top);
    let pb = new THREE.Vector3(...b).applyMatrix4(top);
    let pc = new THREE.Vector3(...c).applyMatrix4(top);
    if (top.determinant() < 0) {
      const tmp = pb;
      pb = pc;
      pc = tmp;
    }
    const nrm = new THREE.Vector3().subVectors(pc, pb).cross(new THREE.Vector3().subVectors(pa, pb)).normalize();
    this.emit(bk, [pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, pc.x, pc.y, pc.z], [nrm.x, nrm.y, nrm.z, nrm.x, nrm.y, nrm.z, nrm.x, nrm.y, nrm.z], [0, 0, 0, 0, 0, 0]);
    return this;
  }
  /**
   * Hexahedron from 8 corners: bottom ring then top ring, each ordered
   * (-x,+z), (+x,+z), (+x,-z), (-x,-z) when seen from above.
   */
  hexa(c: readonly V3[], color: THREE.ColorRepresentation, mat: THREE.Material = SOLID, skipBottom = true): this {
    const [b0, b1, b2, b3, t0, t1, t2, t3] = c;
    if (!b0 || !b1 || !b2 || !b3 || !t0 || !t1 || !t2 || !t3) return this;
    const face = (p: V3, q: V3, r: V3, s: V3): void => {
      this.tri(p, q, r, color, mat);
      this.tri(p, r, s, color, mat);
    };
    face(t0, t1, t2, t3); // top
    if (!skipBottom) face(b3, b2, b1, b0);
    face(b0, b1, t1, t0); // +z
    face(b1, b2, t2, t1); // +x
    face(b2, b3, t3, t2); // -z
    face(b3, b0, t0, t3); // -x
    return this;
  }

  /**
   * Sign from the atlas: a quad of height `h` centred at (x,y,z), facing +Z rotated by `ry`
   * (ry = PI/2 faces +X, -PI/2 faces -X). Width follows the sign's aspect unless given.
   */
  sign(name: string, x: number, y: number, z: number, h: number, ry = 0, w?: number, rx = 0): this {
    const r = signRect(name);
    return this.quad(xf(x, y, z, w ?? h * r.aspect, h, 1, rx, ry, 0), 0xffffff, this.litSigns ? signAtlas().lit : signAtlas().material, r.uv);
  }

  /** A limb capsule of radius r and total length len, hanging down from the origin. */
  limb(x: number, y: number, z: number, r: number, len: number, color: THREE.ColorRepresentation, mat: THREE.Material, sx = 1, sz = 1): this {
    const straight = Math.max(0.01, (len - 2 * r) / r);
    return this.add(T.capsule(Number(straight.toFixed(2)), 3, 8), xf(x, y - len / 2, z, r * sx, r, r * sz), color, mat);
  }

  get triangleCount(): number {
    let n = 0;
    for (const b of this.buckets.values()) n += b.pos.length / 9;
    return n;
  }

  /** Emit one mesh per material. Geometries are marked per-instance unless `shared`. */
  build(shared = false, target: THREE.Group = new THREE.Group()): THREE.Group {
    for (const b of this.buckets.values()) {
      if (b.pos.length === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nrm, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      if (!shared) g.userData["perInstance"] = true;
      const mesh = new THREE.Mesh(g, b.mat);
      mesh.castShadow = b.mat.userData["cast"] === true;
      mesh.receiveShadow = b.mat.userData["receive"] !== false;
      target.add(mesh);
    }
    this.buckets.clear();
    return target;
  }
}

/** Instantiate a cached group template (shares geometries/materials). */
export function instance(template: THREE.Group): THREE.Group {
  const g = new THREE.Group();
  for (const child of template.children) {
    if (child instanceof THREE.Mesh) {
      const m = new THREE.Mesh(child.geometry, child.material);
      m.castShadow = child.castShadow;
      m.receiveShadow = child.receiveShadow;
      m.position.copy(child.position);
      m.rotation.copy(child.rotation);
      m.scale.copy(child.scale);
      g.add(m);
    }
  }
  return g;
}
