/**
 * The surrounding street network (every OSM street within 150 m that is not the route itself):
 * asphalt carriageways with pavements, pedestrian streets paved, footways as narrow paths, so the
 * blocks read right from the street and from the stork's height. Permanent layer.
 */
import * as THREE from "three";
import type { CityStreet } from "../../city/data";
import { Acc } from "./acc";
import { groundMaterial, paintMaterial } from "./cmats";
import type { CityCtx } from "./context";
import type { GroundLayer } from "./ground";
import { newFrame } from "./track";
import { GROUND_SCALE } from "./textures";

const UP = new THREE.Vector3(0, 1, 0);

function widthOf(st: CityStreet): { road: number; walk: number; ped: boolean } {
  const ped = ["pedestrian", "footway", "living_street", "steps", "cycleway", "path"].includes(st.highway);
  if (st.highway === "footway" || st.highway === "cycleway" || st.highway === "steps" || st.highway === "path") return { road: 2.6, walk: 0, ped: true };
  if (ped) return { road: st.width ?? 6, walk: 0, ped: true };
  const lanes = st.lanes ?? (st.oneway ? 1 : 2);
  const lw = st.highway === "trunk" || st.highway === "primary" ? 3.4 : st.highway === "service" ? 2.8 : 3.1;
  const road = st.width ?? Math.max(st.highway === "service" ? 3.5 : 5.5, lanes * lw + (st.oneway ? 1.5 : 0.6));
  return { road, walk: st.highway === "service" || st.highway === "trunk_link" ? 0 : 2.2, ped: false };
}

/** Simplify a polyline (radial distance, then keep points that bend). */
function simplify(pts: { x: number; z: number }[], tol = 1.5): { x: number; z: number }[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const cross = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / Math.max(1e-6, Math.hypot(c.x - a.x, c.z - a.z));
    if (d > 12 || cross > tol * 0.15) out.push(b);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

export function buildNetwork(ctx: CityCtx, ground: GroundLayer): THREE.Group {
  const g = new THREE.Group();
  g.name = "network";
  const asphalt = new Acc();
  const walk = new Acc();
  const slabs = new Acc();
  const paint = new Acc();
  const tr = ctx.track;
  const f = newFrame();
  const white = new THREE.Color(0xeeeeea);
  for (const st of ctx.city.streets) {
    if (st.onRoute || st.tunnel) continue;
    const raw: { x: number; z: number }[] = [];
    for (let i = 0; i + 1 < st.pts.length; i += 2) raw.push({ x: st.pts[i]!, z: st.pts[i + 1]! });
    const pts = simplify(raw);
    if (pts.length < 2) continue;
    const w = widthOf(st);
    // heights: the route's surface near the route (junction mouths), terrain elsewhere
    const info = pts.map((p) => {
      const pr = tr.project(p.x, p.z);
      tr.frameAt(pr.s, f);
      const lay = tr.layoutAt(pr.s);
      const inCorridor = pr.lateral > lay.left - 1.0 - w.road / 4 && pr.lateral < lay.right + 1.0 + w.road / 4;
      const d = Math.max(0, pr.lateral < 0 ? lay.left - pr.lateral : pr.lateral - lay.right);
      const ter = ground.heightAt(p.x, p.z) + 0.06;
      const k = Math.min(1, d / 25);
      let y = (f.h + (w.ped ? 0.0 : -0.01)) * (1 - k) + ter * k;
      if (st.bridge) y = Math.max(y, f.h);
      return { y, skip: inCorridor && Math.abs(pr.lateral) < 40 };
    });
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const ia = info[i]!;
      const ib = info[i + 1]!;
      if (ia.skip && ib.skip) continue;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.1) continue;
      // per-vertex miter normals
      const nrm = (k: number): [number, number] => {
        const p = pts[Math.max(0, k - 1)]!;
        const q = pts[Math.min(pts.length - 1, k + 1)]!;
        const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
        return [-(q.z - p.z) / l, (q.x - p.x) / l];
      };
      const [nax, naz] = nrm(i);
      const [nbx, nbz] = nrm(i + 1);
      const band = (acc: Acc, half: number, y: number, scale: number, col: THREE.Color): void => {
        const pA0 = new THREE.Vector3(a.x - nax * half, ia.y + y, a.z - naz * half);
        const pA1 = new THREE.Vector3(a.x + nax * half, ia.y + y, a.z + naz * half);
        const pB1 = new THREE.Vector3(b.x + nbx * half, ib.y + y, b.z + nbz * half);
        const pB0 = new THREE.Vector3(b.x - nbx * half, ib.y + y, b.z - nbz * half);
        const uv = (p: THREE.Vector3): [number, number] => [p.x / scale, p.z / scale];
        // orientation: make it face up
        const cy = (pA1.z - pA0.z) * (pB0.x - pA0.x) - (pA1.x - pA0.x) * (pB0.z - pA0.z);
        if (cy < 0) acc.quad(pA0, pB0, pB1, pA1, uv(pA0), uv(pB0), uv(pB1), uv(pA1), col, col, col, col, UP);
        else acc.quad(pA0, pA1, pB1, pB0, uv(pA0), uv(pA1), uv(pB1), uv(pB0), col, col, col, col, UP);
      };
      const c1 = new THREE.Color(1, 1, 1);
      if (w.ped) band(slabs, w.road / 2, 0.02, GROUND_SCALE.slabs, c1);
      else {
        if (w.walk > 0) band(walk, w.road / 2 + w.walk, 0.03, GROUND_SCALE.hydraulic, new THREE.Color(0.92, 0.91, 0.89));
        band(asphalt, w.road / 2, 0.05, GROUND_SCALE.asphalt, c1);
        // dashed centre line on two-way streets
        if (!st.oneway && !st.roundabout && w.road > 5.5) {
          for (let d = 0; d < len; d += 9) {
            const t0 = d / len;
            const t1 = Math.min(1, (d + 3.5) / len);
            const px = (t: number): THREE.Vector3 => new THREE.Vector3(a.x + (b.x - a.x) * t, ia.y + (ib.y - ia.y) * t + 0.06, a.z + (b.z - a.z) * t);
            const p0 = px(t0);
            const p1 = px(t1);
            const nx = -(b.z - a.z) / len;
            const nz = (b.x - a.x) / len;
            const q = [p0.clone().add(new THREE.Vector3(-nx * 0.06, 0, -nz * 0.06)), p0.clone().add(new THREE.Vector3(nx * 0.06, 0, nz * 0.06)), p1.clone().add(new THREE.Vector3(nx * 0.06, 0, nz * 0.06)), p1.clone().add(new THREE.Vector3(-nx * 0.06, 0, -nz * 0.06))];
            const cy = (q[1]!.z - q[0]!.z) * (q[3]!.x - q[0]!.x) - (q[1]!.x - q[0]!.x) * (q[3]!.z - q[0]!.z);
            if (cy < 0) paint.quad(q[0]!, q[3]!, q[2]!, q[1]!, [0, 0], [0, 1], [1, 1], [1, 0], white, white, white, white, UP);
            else paint.quad(q[0]!, q[1]!, q[2]!, q[3]!, [0, 0], [1, 0], [1, 1], [0, 1], white, white, white, white, UP);
          }
        }
      }
    }
  }
  for (const [acc, mat, name] of [
    [walk, groundMaterial("hydraulic", 1), "net-walk"],
    [slabs, groundMaterial("slabs", 1), "net-slabs"],
    [asphalt, groundMaterial("asphalt", 2), "net-asphalt"],
    [paint, paintMaterial(), "net-paint"],
  ] as const) {
    const m = acc.mesh(mat, name);
    if (m) g.add(m);
  }
  // plazas from the squares polygons
  const sq = new Acc();
  for (const a of ctx.city.squares) {
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i + 1 < a.ring.length; i += 2) contour.push(new THREE.Vector2(a.ring[i]!, a.ring[i + 1]!));
    let tris: number[][];
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, []);
    } catch {
      continue;
    }
    const yOf = (p: THREE.Vector2): number => {
      const pr = tr.project(p.x, p.y);
      tr.frameAt(pr.s, f);
      return Math.abs(pr.lateral) < 12 ? f.h + 0.01 : Math.max(f.h + 0.01, ground.heightAt(p.x, p.y) + 0.25);
    };
    const ys = contour.map(yOf);
    const c1 = new THREE.Color(1, 1, 1);
    for (const t of tris) {
      const P = (k: number): THREE.Vector3 => new THREE.Vector3(contour[k]!.x, ys[k]!, contour[k]!.y);
      const p0 = P(t[0]!);
      let p1 = P(t[1]!);
      let p2 = P(t[2]!);
      const cy = (p1.z - p0.z) * (p2.x - p0.x) - (p1.x - p0.x) * (p2.z - p0.z);
      if (cy < 0) [p1, p2] = [p2, p1];
      const s = GROUND_SCALE.slabs;
      sq.tri(p0, p1, p2, [p0.x / s, p0.z / s], [p1.x / s, p1.z / s], [p2.x / s, p2.z / s], c1, UP);
    }
  }
  const sm = sq.mesh(groundMaterial("slabs", 1), "plazas");
  if (sm) g.add(sm);
  return g;
}
