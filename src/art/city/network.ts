/**
 * The street network round the route (every OSM street within 150 m that is not the route).
 *
 * Near field (≤ NEAR m from the route): REAL streets like the route's own — road-coloured
 * carriageway, raised pavements with kerb faces out to the building line, a dashed centre line on
 * two-way streets, zebras at the mapped crossings; pedestrian streets paved, footways and garden
 * paths in pavement colour with kerb-coloured edges. Pavements stop where they would cross another
 * street (junctions stay open) and nothing is drawn on the route's own surface.
 * Far field: the simplified white "map" streets on a pale casing.
 * Z-order by polygon offset: plaza / pedestrian paving < road < markings. Permanent layer.
 */
import * as THREE from "three";
import type { CityStreet } from "../../city/data";
import { Acc } from "./acc";
import { decalMaterial, flatMaterial, paintMaterial } from "./cmats";
import { PAL } from "../palette";
import type { CityCtx } from "./context";
import { Grid } from "./geo";
import type { GroundLayer } from "./ground";
import { newFrame } from "./track";

const UP = new THREE.Vector3(0, 1, 0);
export const NEAR = 50;
const KERB_H = 0.12;

interface W {
  road: number;
  walk: number;
  ped: boolean;
  path: boolean;
}

function widthOf(st: CityStreet): W {
  if (["footway", "cycleway", "steps", "path"].includes(st.highway)) return { road: st.highway === "cycleway" ? 2.4 : 2.6, walk: 0, ped: true, path: true };
  if (["pedestrian", "living_street"].includes(st.highway)) return { road: st.width ?? 6, walk: 0, ped: true, path: false };
  const lanes = st.lanes ?? (st.oneway ? 1 : 2);
  const lw = st.highway === "trunk" || st.highway === "primary" ? 3.4 : st.highway === "service" ? 2.8 : 3.1;
  const road = st.width ?? Math.max(st.highway === "service" ? 3.5 : 5.5, lanes * lw + (st.oneway ? 1.5 : 0.6));
  return { road, walk: st.highway === "service" || st.highway === "trunk_link" ? 0.8 : 2.4, ped: false, path: false };
}

/** Densify a polyline to pieces of at most `step` m. */
function densify(pts: { x: number; z: number }[], step: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  const last = pts[pts.length - 1];
  if (last) out.push(last);
  return out;
}

interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  half: number;
  id: number;
}

export function buildNetwork(ctx: CityCtx, ground: GroundLayer): THREE.Group {
  const g = new THREE.Group();
  g.name = "network";
  // accumulators per 500 m tile (frustum / distance culling)
  const tiles = new Map<string, { farRoad: Acc; farCasing: Acc; paving: Acc; road: Acc; raised: Acc; paint: Acc }>();
  const tileFor = (x: number, z: number): { farRoad: Acc; farCasing: Acc; paving: Acc; road: Acc; raised: Acc; paint: Acc } => {
    const k = `${Math.floor(x / 500)},${Math.floor(z / 500)}`;
    let t = tiles.get(k);
    if (!t) tiles.set(k, (t = { farRoad: new Acc(), farCasing: new Acc(), paving: new Acc(), road: new Acc(), raised: new Acc(), paint: new Acc() }));
    return t;
  };
  let farRoad = new Acc();
  let farCasing = new Acc();
  let paving = new Acc();
  let road = new Acc();
  let raised = new Acc();
  let paint = new Acc();
  const useTile = (x: number, z: number): void => {
    const t = tileFor(x, z);
    ({ farRoad, farCasing, paving, road, raised, paint } = t);
  };
  const tr = ctx.track;
  const f = newFrame();

  const streets = ctx.city.streets.filter((st) => !st.onRoute && !st.tunnel);
  // index the near vehicle streets' centrelines (pavements must not cross another street)
  const segGrid = new Grid<Seg>(30);
  streets.forEach((st, id) => {
    const w = widthOf(st);
    if (w.ped) return;
    for (let i = 0; i + 3 < st.pts.length; i += 2) {
      const ax = st.pts[i]!, az = st.pts[i + 1]!, bx = st.pts[i + 2]!, bz = st.pts[i + 3]!;
      segGrid.add({ ax, az, bx, bz, half: w.road / 2, id }, Math.min(ax, bx) - 8, Math.min(az, bz) - 8, Math.max(ax, bx) + 8, Math.max(az, bz) + 8);
    }
  });
  const inOtherStreet = (x: number, z: number, id: number, margin: number): boolean => {
    for (const sg of segGrid.query(x, z, x, z)) {
      if (sg.id === id) continue;
      const dx = sg.bx - sg.ax, dz = sg.bz - sg.az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - sg.ax) * dx + (z - sg.az) * dz) / l2));
      if (Math.hypot(x - sg.ax - dx * t, z - sg.az - dz * t) < sg.half + margin) return true;
    }
    return false;
  };
  /** On the route's own paved surface (its lanes, sidewalks and a margin for its outer pavement)? */
  const onRoute = (x: number, z: number, margin: number): boolean => {
    const pr = tr.project(x, z);
    const lay = tr.layoutAt(pr.s);
    let lo = lay.left;
    let hi = lay.right;
    for (const c of lay.carriageways) {
      lo = Math.min(lo, c.from);
      hi = Math.max(hi, c.to);
    }
    for (const w of lay.sidewalks) {
      lo = Math.min(lo, w.from);
      hi = Math.max(hi, w.to);
    }
    return pr.lateral > lo - margin && pr.lateral < hi + margin && Math.abs(pr.lateral) < 40;
  };

  const band = (acc: Acc, a: THREE.Vector3, b: THREE.Vector3, na: THREE.Vector2, nb: THREE.Vector2, l0: number, l1: number, dy: number, col: THREE.Color): void => {
    const A0 = new THREE.Vector3(a.x + na.x * l0, a.y + dy, a.z + na.y * l0);
    const A1 = new THREE.Vector3(a.x + na.x * l1, a.y + dy, a.z + na.y * l1);
    const B1 = new THREE.Vector3(b.x + nb.x * l1, b.y + dy, b.z + nb.y * l1);
    const B0 = new THREE.Vector3(b.x + nb.x * l0, b.y + dy, b.z + nb.y * l0);
    const cy = (A1.z - A0.z) * (B0.x - A0.x) - (A1.x - A0.x) * (B0.z - A0.z);
    if (cy < 0) acc.quad(A0, B0, B1, A1, [0, 0], [0, 0], [0, 0], [0, 0], col, col, col, col, UP);
    else acc.quad(A0, A1, B1, B0, [0, 0], [0, 0], [0, 0], [0, 0], col, col, col, col, UP);
  };
  /** Vertical kerb face along lateral l (between the road at dy0 and the pavement at dy1), both windings. */
  const kerbFace = (a: THREE.Vector3, b: THREE.Vector3, na: THREE.Vector2, nb: THREE.Vector2, l: number, col: THREE.Color): void => {
    const A0 = new THREE.Vector3(a.x + na.x * l, a.y, a.z + na.y * l);
    const B0 = new THREE.Vector3(b.x + nb.x * l, b.y, b.z + nb.y * l);
    const B1 = B0.clone().setY(b.y + KERB_H);
    const A1 = A0.clone().setY(a.y + KERB_H);
    // face the road centre (one winding)
    const n = new THREE.Vector3().subVectors(B0, A0).cross(new THREE.Vector3(0, 1, 0));
    const towards = new THREE.Vector3(a.x - A0.x, 0, a.z - A0.z);
    if (n.dot(towards) > 0) raised.quad(A0, B0, B1, A1, [0, 0], [0, 0], [0, 0], [0, 0], col);
    else raised.quad(B0, A0, A1, B1, [0, 0], [0, 0], [0, 0], [0, 0], col);
  };

  const cRoad = new THREE.Color(PAL.road);
  const cPave = new THREE.Color(PAL.pavement);
  const cKerb = new THREE.Color(PAL.kerb);
  const cWhite = new THREE.Color(PAL.marking);
  const cStreet = new THREE.Color(PAL.street);
  const cCasing = new THREE.Color(PAL.streetCasing);

  streets.forEach((st, id) => {
    const raw: { x: number; z: number }[] = [];
    for (let i = 0; i + 1 < st.pts.length; i += 2) raw.push({ x: st.pts[i]!, z: st.pts[i + 1]! });
    if (raw.length < 2) return;
    useTile(raw[0]!.x, raw[0]!.z);
    const w = widthOf(st);
    const pts = densify(raw, 8);
    const info = pts.map((p) => {
      const pr = tr.project(p.x, p.z);
      tr.frameAt(pr.s, f);
      const lay = tr.layoutAt(pr.s);
      const d = Math.max(0, pr.lateral < 0 ? lay.left - pr.lateral : pr.lateral - lay.right);
      const ter = ground.heightAt(p.x, p.z) + 0.06;
      const k = Math.min(1, d / 25);
      let y = (f.h - 0.005) * (1 - k) + ter * k;
      if (st.bridge) y = Math.max(y, f.h);
      return { y, near: Math.abs(pr.lateral) < NEAR };
    });
    let along = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i]!;
      const q = pts[i + 1]!;
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      if (len < 0.05) continue;
      const nrm = (k: number): THREE.Vector2 => {
        const u = pts[Math.max(0, k - 1)]!;
        const v = pts[Math.min(pts.length - 1, k + 1)]!;
        const l = Math.hypot(v.x - u.x, v.z - u.z) || 1;
        return new THREE.Vector2(-(v.z - u.z) / l, (v.x - u.x) / l);
      };
      const na = nrm(i);
      const nb = nrm(i + 1);
      const A = new THREE.Vector3(p.x, info[i]!.y, p.z);
      const B = new THREE.Vector3(q.x, info[i + 1]!.y, q.z);
      const mx = (p.x + q.x) / 2;
      const mz = (p.z + q.z) / 2;
      const near = info[i]!.near || info[i + 1]!.near;
      if (onRoute(mx, mz, 0.5)) {
        along += len;
        continue;
      }
      const h = w.road / 2;
      if (!near) {
        // far field: white map street on a pale casing
        if (w.ped) band(paving, A, B, na, nb, -h, h, 0.02, cPave);
        else {
          band(farCasing, A, B, na, nb, -h - Math.max(0.6, w.walk), h + Math.max(0.6, w.walk), 0.03, cCasing);
          band(farRoad, A, B, na, nb, -h, h, 0.05, cStreet);
        }
        along += len;
        continue;
      }
      if (w.ped) {
        // pedestrian street / footway / garden path: paved with kerb-coloured edges
        band(paving, A, B, na, nb, -h, h, 0.03, cPave);
        band(paint, A, B, na, nb, -h, -h + 0.18, 0.035, cKerb);
        band(paint, A, B, na, nb, h - 0.18, h, 0.035, cKerb);
        along += len;
        continue;
      }
      // a real street: carriageway, centre line, kerbs and raised pavements out to the building line
      band(road, A, B, na, nb, -h, h, 0.04, cRoad);
      const twoWay = !st.oneway && !st.roundabout && w.road > 5.5;
      if (twoWay && along % 9 < 4) band(paint, A, B, na, nb, -0.06, 0.06, 0.045, cWhite);
      for (const side of [1, -1] as const) {
        const ex = mx + (na.x + nb.x) * 0.5 * side * (h + w.walk / 2);
        const ez = mz + (na.y + nb.y) * 0.5 * side * (h + w.walk / 2);
        // junctions stay open: no pavement across another street, nor on the route's surface
        if (inOtherStreet(ex, ez, id, 0.3) || onRoute(ex, ez, 0.3)) continue;
        const l0 = side > 0 ? h : -h - w.walk;
        const l1 = side > 0 ? h + w.walk : -h;
        band(raised, A, B, na, nb, l0, l1, KERB_H + 0.04, cPave);
        kerbFace(A.clone().setY(A.y + 0.04), B.clone().setY(B.y + 0.04), na, nb, side * h, cKerb);
      }
      along += len;
    }
  });

  // zebra crossings mapped on the near side streets
  for (const fu of ctx.city.furniture) {
    if (fu.type !== "crossing" || Math.abs(fu.lateral) > NEAR || onRoute(fu.x, fu.z, 1)) continue;
    useTile(fu.x, fu.z);
    let best: { st: CityStreet; ax: number; az: number; bx: number; bz: number; d: number } | null = null;
    for (const sg of segGrid.query(fu.x, fu.z, fu.x, fu.z)) {
      const dx = sg.bx - sg.ax, dz = sg.bz - sg.az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((fu.x - sg.ax) * dx + (fu.z - sg.az) * dz) / l2));
      const d = Math.hypot(fu.x - sg.ax - dx * t, fu.z - sg.az - dz * t);
      if (d < 2 && (!best || d < best.d)) best = { st: streets[sg.id]!, ax: sg.ax, az: sg.az, bx: sg.bx, bz: sg.bz, d };
    }
    if (!best) continue;
    const ux = best.bx - best.ax, uz = best.bz - best.az;
    const ul = Math.hypot(ux, uz) || 1;
    const tx = ux / ul, tz = uz / ul;
    const half = widthOf(best.st).road / 2;
    const y = ground.heightAt(fu.x, fu.z);
    const pr = tr.project(fu.x, fu.z);
    tr.frameAt(pr.s, f);
    const yy = Math.abs(pr.lateral) < 25 ? f.h : y;
    for (let l = -half + 0.4; l < half - 0.3; l += 1.0) {
      const cx = fu.x - tz * l, cz = fu.z + tx * l;
      const A = new THREE.Vector3(cx - tx * 2, yy + 0.05, cz - tz * 2);
      const B = new THREE.Vector3(cx + tx * 2, yy + 0.05, cz + tz * 2);
      const n = new THREE.Vector2(-tz, tx);
      band(paint, A, B, n, n, 0, 0.5, 0, cWhite);
    }
  }

  for (const t of tiles.values()) {
    // casing and far streets go in one decal mesh (casing first, then streets over it at +offset)
    t.farCasing.append(t.paving);
    t.road.append(t.farRoad);
    for (const [acc, mat, name] of [
      [t.farCasing, decalMaterial(1), "net-casing"],
      [t.road, decalMaterial(2), "net-road"],
      [t.raised, flatMaterial(), "net-pavements"],
      [t.paint, paintMaterial(), "net-paint"],
    ] as const) {
      const m = acc.mesh(mat, name);
      if (m) g.add(m);
    }
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
    for (const t of tris) {
      const P = (k: number): THREE.Vector3 => new THREE.Vector3(contour[k]!.x, ys[k]!, contour[k]!.y);
      const p0 = P(t[0]!);
      let p1 = P(t[1]!);
      let p2 = P(t[2]!);
      const cy = (p1.z - p0.z) * (p2.x - p0.x) - (p1.x - p0.x) * (p2.z - p0.z);
      if (cy < 0) [p1, p2] = [p2, p1];
      sq.tri(p0, p1, p2, [0, 0], [0, 0], [0, 0], cPave, UP);
    }
  }
  const sm = sq.mesh(decalMaterial(1), "plazas");
  if (sm) g.add(sm);
  return g;
}
