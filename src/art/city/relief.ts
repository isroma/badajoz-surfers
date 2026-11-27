/**
 * Near-route facade accents in the flat style: one per building typology (balcony slabs with a
 * railing band, ground-floor awnings), the real business names as flat signs on the facades
 * (pharmacy crosses, bank and bar fascias), bar terraces where the pavement is wider than the
 * runnable lanes, and a name sign on every named building (schools, churches, the theatre…).
 * Nothing reaches over the runnable surface below the clearance.
 */
import * as THREE from "three";
import type { CityPoi } from "../../city/data";
import { PAL } from "../palette";
import { T, xf } from "../geom";
import type { Bag } from "./bag";
import { styleOf } from "./buildings";
import { drawLabel, flatMaterial, glowMaterial, signMaterial, signSlot } from "./cmats";
import { CLEARANCE, plausibleName, type CityCtx, type PreparedBuilding } from "./context";
import { hash01 } from "./shared";
import { newFrame } from "./track";

const AWNINGS = [0x3e7bd6, 0xe5484d, 0x8db87a, 0xd9a066];

function poiLook(cat: string): { bg: string; fg: string; kind: "pharmacy" | "bank" | "bar" | "shop" } {
  if (cat === "amenity:pharmacy") return { bg: "#2f9e5b", fg: "#ffffff", kind: "pharmacy" };
  if (cat === "amenity:bank") return { bg: "#3e7bd6", fg: "#ffffff", kind: "bank" };
  if (["amenity:bar", "amenity:cafe", "amenity:restaurant", "amenity:pub", "amenity:fast_food"].includes(cat)) return { bg: "#1f2328", fg: "#ffd98a", kind: "bar" };
  return { bg: "#fcf8f1", fg: "#1f2328", kind: "shop" };
}

/** A text quad (from the text atlas) in a pushed frame: centred at (x, y, z), facing +Z. */
export function textQuad(bag: Bag, key: string, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, x: number, y: number, z: number, w: number, lit = false): void {
  const uv = signSlot(key, draw);
  bag.props.quad(new THREE.Matrix4().makeScale(w, w * (96 / 512), 1).setPosition(x, y, z), 0xffffff, signMaterial(lit), uv);
}

export function buildRelief(ctx: CityCtx, bag: Bag, chunk: number, s0: number, s1: number, part: 0 | 1 | null = null): void {
  const overRunnable = (x: number, z: number, nearS: number): boolean => {
    const pr = ctx.track.project(x, z, nearS);
    const lay = ctx.wideLayout(pr.s);
    return pr.lateral > lay.left - 0.2 && pr.lateral < lay.right + 0.2;
  };
  const p = bag.props;
  const m = flatMaterial();
  const facing = (pb: PreparedBuilding, a: { x: number; z: number }, d: { x: number; z: number }): number => {
    const len = Math.hypot(d.x - a.x, d.z - a.z);
    const nx = -(d.z - a.z) / len;
    const nz = (d.x - a.x) / len;
    const mx = (a.x + d.x) / 2;
    const mz = (a.z + d.z) / 2;
    const pr = ctx.track.project(mx + nx * 3, mz + nz * 3, pb.src.s);
    const fr = ctx.track.frameAt(pr.s);
    return (fr.x - mx) * nx + (fr.z - mz) * nz;
  };
  for (const pb of ctx.buildings) {
    if (pb.chunk !== chunk || pb.src.dist > 30 || pb.upperRing) continue;
    if (part !== null && pb.index % 2 !== part) continue;
    const st = styleOf(pb);
    const ring = pb.ring;
    // the edge that best faces the route (for the name sign)
    let bestEdge = -1;
    let bestScore = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const d = ring[(i + 1) % ring.length]!;
      const len = Math.hypot(d.x - a.x, d.z - a.z);
      if (len < 2.5 || ctx.isParty(pb.index, a.x, a.z, d.x, d.z)) continue;
      const toRoad = facing(pb, a, d);
      if (toRoad < 2) continue;
      if (len / (1 + toRoad * 0.1) > bestScore) {
        bestScore = len / (1 + toRoad * 0.1);
        bestEdge = i;
      }
      const ux = (d.x - a.x) / len;
      const uz = (d.z - a.z) / len;
      const nx = -uz;
      const nz = ux;
      const mx = (a.x + d.x) / 2;
      const mz = (a.z + d.z) / 2;
      const g = pb.streetGround ? ctx.streetLevel(mx, mz, pb.src.s) : pb.src.h0;
      const ry = Math.atan2(nx, nz);
      // Plaza Alta: the arcade's dark arch openings under the red and white houses
      if (pb.typ === "plazaAlta") {
        const bays = Math.max(1, Math.round(len / 3.2));
        const bw = len / bays;
        const acc = bag.acc(m);
        const dark = new THREE.Color(0x4a3a30);
        const r = bw / 2 - 0.35;
        for (let k = 0; k < bays; k++) {
          const cx = a.x + ux * (k + 0.5) * bw + nx * 0.04;
          const cz = a.z + uz * (k + 0.5) * bw + nz * 0.04;
          const V = (du: number, y: number): THREE.Vector3 => new THREE.Vector3(cx + ux * du, g + y, cz + uz * du);
          const nn = new THREE.Vector3(nx, 0, nz);
          acc.quad(V(-r, 0), V(r, 0), V(r, 2.2), V(-r, 2.2), [0, 0], [0, 0], [0, 0], [0, 0], dark, dark, dark, dark, nn);
          for (let j = 0; j < 6; j++) {
            const a0 = (j / 6) * Math.PI;
            const a1 = ((j + 1) / 6) * Math.PI;
            acc.tri(V(0, 2.2), V(Math.cos(a0) * r, 2.2 + Math.sin(a0) * r * 0.9), V(Math.cos(a1) * r, 2.2 + Math.sin(a1) * r * 0.9), [0, 0], [0, 0], [0, 0], dark, nn);
          }
        }
      }
      // balconies: one slab and a dark railing band per floor along the facade
      if (st.accentKind === "balconies" && st.floors > 0) {
        for (let fl = 0; fl < Math.min(st.floors, 8); fl++) {
          const y = st.Gf + fl * ((pb.top - st.Gf) / Math.max(1, st.floors));
          if (y - g < CLEARANCE + 0.5 && [-0.5, -0.25, 0, 0.25, 0.5].some((t) => overRunnable(mx + ux * len * t + nx * 1.6, mz + uz * len * t + nz * 1.6, pb.src.s))) continue;
          p.push(new THREE.Matrix4().makeRotationY(ry).setPosition(mx, y, mz));
          p.box(0, 0.06, 0.45, len - 1.2, 0.14, 0.9, 0xfcf8f1, m);
          p.box(0, 0.6, 0.88, len - 1.2, 0.9, 0.04, PAL.darkGrey, m);
          p.pop();
        }
      }
      // awnings over the ground floor (shops)
      if ((st.accentKind === "awnings" || pb.typ === "brick") && st.floors > 0 && !overRunnable(mx + nx * 1.5, mz + nz * 1.5, pb.src.s)) {
        const bays = Math.max(1, Math.round(len / 3.2));
        const bw = len / bays;
        const col = AWNINGS[Math.floor(hash01(pb.index, 3) * AWNINGS.length)]!;
        for (let k = 0; k < bays; k++) {
          if (hash01(pb.index * 31 + k, 17) > 0.45) continue;
          const t = (k + 0.5) * bw - len / 2;
          p.push(new THREE.Matrix4().makeRotationY(ry).setPosition(mx + ux * t, g, mz + uz * t));
          p.add(T.box, xf(0, 2.85, 0.6, bw - 0.4, 0.06, 1.3, 0.35, 0, 0), col, m);
          p.pop();
        }
      }
    }
    // the theatre's portico goes on the long façade closest to the route (on the Paseo San Francisco
    // garden): the side façades are hidden behind other blocks from every point of the run
    if (pb.typ === "theatre") {
      let best = Infinity;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const d = ring[(i + 1) % ring.length]!;
        if (Math.hypot(d.x - a.x, d.z - a.z) < 16) continue;
        const toRoad = facing(pb, a, d);
        if (toRoad > 2 && toRoad < best) {
          best = toRoad;
          bestEdge = i;
        }
      }
    }
    // the building's name on a flat sign (schools, churches, the theatre, hotels, offices…)
    if (pb.name && bestEdge >= 0) {
      const a = ring[bestEdge]!;
      const d = ring[(bestEdge + 1) % ring.length]!;
      const len = Math.hypot(d.x - a.x, d.z - a.z);
      const nx = -(d.z - a.z) / len;
      const nz = (d.x - a.x) / len;
      const mx = (a.x + d.x) / 2 + nx * 0.08;
      const mz = (a.z + d.z) / 2 + nz * 0.08;
      const g = pb.streetGround ? ctx.streetLevel(mx, mz, pb.src.s) : pb.src.h0;
      // high on the facade, clear of the shop signs at ~3.25 m
      const y0 = Math.max(Math.min(pb.top - 0.8, g + 4.6), Math.min(pb.top - 0.8, g + (st.floors > 0 ? st.Gf - g - 0.2 : 3.2)));
      // a school's name goes high under the roof line, above the street trees
      const y = pb.typ === "school" ? Math.max(y0, pb.top - 1.8) : y0;
      const w = Math.min(len - 0.6, Math.max(3, pb.name.length * (pb.typ === "school" ? 0.45 : 0.32)));
      const look = nameLook(pb, pb.name);
      p.push(new THREE.Matrix4().makeRotationY(Math.atan2(nx, nz)).setPosition(mx, 0, mz));
      if (pb.typ !== "theatre") textQuad(bag, `bname-${pb.typ}-${pb.name}`, look, 0, y, 0.02, w); // the theatre names itself on the frieze
      if (pb.typ === "school" && !overRunnable(mx + nx * 3, mz + nz * 3, pb.src.s)) {
        // the school yard wall with railings in front
        p.box(0, g + 0.5, 3, len, 1.0, 0.3, PAL.buildings[2], m);
        p.box(0, g + 1.5, 3, len, 1.0, 0.05, PAL.darkGrey, m);
      }
      if (pb.typ === "hospital") p.box(len / 2 - 1.2, y + 1.6, 0.08, 1.2, 0.35, 0.05, 0x2f9e5b, m);
      if (pb.typ === "theatre") {
        // classical portico (as deep as the pavement allows): columns, frieze with the name, pediment
        let dp = 2.8;
        while (dp > 0.6 && overRunnable(mx + nx * (dp + 0.3), mz + nz * (dp + 0.3), pb.src.s)) dp -= 0.4;
        const pw = Math.min(len - 1, 14);
        const H = Math.min(9, Math.max(6, pb.top - g - 2));
        // slide the portico along the façade to the part not hidden by the templete in front
        const tem = ctx.landmark("templete-san-francisco");
        let shift = 0;
        if (tem?.x !== undefined && tem.z !== undefined) {
          const ux = (d.x - a.x) / len;
          const uz = (d.z - a.z) / len;
          const tAlong = (tem.x - (a.x + d.x) / 2) * ux + (tem.z - (a.z + d.z) / 2) * uz;
          const room = Math.max(0, len / 2 - pw / 2 - 0.5);
          shift = tAlong > 0 ? -room : room;
        }
        p.push(xf(shift, 0, 0));
        const cr = Math.min(0.38, dp / 3);
        p.box(0, g + 0.15, dp / 2, pw + 0.6, 0.3, dp, PAL.stone, m);
        const n = 6;
        for (let k = 0; k < n; k++) p.cyl(-pw / 2 + 0.6 + (k * (pw - 1.2)) / (n - 1), g + 0.3, dp - cr - 0.1, cr, H - 0.3, 0xfcf8f1, 8, m);
        p.box(0, g + H + 0.6, dp / 2, pw + 0.6, 1.2, dp + 0.1, 0xfcf8f1, m);
        p.hexa([[-pw / 2 - 0.3, g + H + 1.2, dp + 0.05], [pw / 2 + 0.3, g + H + 1.2, dp + 0.05], [pw / 2 + 0.3, g + H + 1.2, 0], [-pw / 2 - 0.3, g + H + 1.2, 0], [-0.2, g + H + 3.6, dp + 0.05], [0.2, g + H + 3.6, dp + 0.05], [0.2, g + H + 3.6, 0], [-0.2, g + H + 3.6, 0]], PAL.stone, m);
        textQuad(bag, `frieze-${pb.name}`, drawLabel(pb.name.toUpperCase(), "#fcf8f1", "#1f2328", { serif: true }), 0, g + H + 0.6, dp + 0.07, Math.min(pw, 12));
        p.pop();
      }
      p.pop();
    }
  }

  if (part === 0) return; // the businesses go with the second half
  // the real businesses on the nearest facade facing the route
  const f = newFrame();
  for (const poi of ctx.city.pois) {
    if (poi.s < s0 || poi.s >= s1 || poi.dist > 35 || !plausibleName(poi.name)) continue;
    let best: { x: number; z: number; ry: number; g: number; d: number } | null = null;
    for (const pb of ctx.buildingGrid.query(poi.x - 25, poi.z - 25, poi.x + 25, poi.z + 25)) {
      const r = pb.ring;
      for (let i = 0; i < r.length; i++) {
        const a = r[i]!;
        const d = r[(i + 1) % r.length]!;
        const len = Math.hypot(d.x - a.x, d.z - a.z);
        if (len < 3) continue;
        const ux = (d.x - a.x) / len;
        const uz = (d.z - a.z) / len;
        const t = Math.max(1.6, Math.min(len - 1.6, (poi.x - a.x) * ux + (poi.z - a.z) * uz));
        const px = a.x + ux * t;
        const pz = a.z + uz * t;
        const dist = Math.hypot(poi.x - px, poi.z - pz);
        const nx = -uz;
        const nz = ux;
        const pr = ctx.track.project(px, pz, poi.s);
        ctx.track.frameAt(pr.s, f);
        const toRoad = (f.x - px) * nx + (f.z - pz) * nz;
        if (toRoad < 2 || Math.abs(pr.lateral) > 30) continue;
        if (!best || dist < best.d) best = { x: px + nx * 0.06, z: pz + nz * 0.06, ry: Math.atan2(nx, nz), g: pb.streetGround ? ctx.streetLevel(px, pz, pb.src.s) : pb.src.h0, d: dist };
      }
    }
    if (!best) continue;
    poiSign(ctx, bag, poi, best, overRunnable);
  }
}

function poiSign(ctx: CityCtx, bag: Bag, poi: CityPoi, at: { x: number; z: number; ry: number; g: number }, overRunnable: (x: number, z: number, s: number) => boolean): void {
  const p = bag.props;
  const m = flatMaterial();
  const look = poiLook(poi.category);
  const w = Math.min(4.2, 1.4 + poi.name.length * 0.22);
  p.push(new THREE.Matrix4().makeRotationY(at.ry).setPosition(at.x, at.g, at.z));
  textQuad(bag, `poi-${poi.category}-${poi.name}`, poiDraw(poi), 0, 3.25, 0.05, w, look.kind === "bar" || look.kind === "pharmacy");
  if (look.kind === "pharmacy" && !overRunnable(at.x + Math.sin(at.ry) * 1.2, at.z + Math.cos(at.ry) * 1.2, poi.s)) {
    // the green cross on a bracket
    p.box(0, 3.9, 0.5, 0.06, 0.06, 1.0, PAL.darkGrey, m);
    p.box(0, 3.45, 1.0, 0.1, 0.8, 0.26, 0x2fd35a, glowMaterial());
    p.box(0, 3.45, 1.0, 0.1, 0.26, 0.8, 0x2fd35a, glowMaterial());
  }
  p.pop();
  // bar and café terraces, only where the pavement is wider than the runnable lanes
  if (look.kind === "bar") {
    const pr = ctx.track.project(at.x, at.z, poi.s);
    const lay = ctx.wideLayout(pr.s);
    const side = pr.lateral > 0 ? 1 : -1;
    const runEdge = side > 0 ? lay.right + 0.5 : lay.left - 0.5;
    const room = Math.abs(pr.lateral - runEdge);
    if (room > 2.4) {
      const fr = ctx.track.frameAt(pr.s);
      for (let k = -1; k <= 1; k++) {
        const lat = pr.lateral - side * Math.min(room - 1.0, 1.6);
        const sx = fr.x + fr.nx * lat + fr.tx * k * 2.6;
        const sz = fr.z + fr.nz * lat + fr.tz * k * 2.6;
        const y = at.g;
        p.cyl(sx, y, sz, 0.04, 0.72, PAL.darkGrey, 5, m);
        p.cyl(sx, y + 0.72, sz, 0.38, 0.04, 0xfcf8f1, 8, m);
        p.cyl(sx, y + 0.76, sz, 0.03, 1.6, 0xfcf8f1, 4, m);
        p.cone(sx, y + 2.2, sz, 1.3, 0.45, k === 0 ? PAL.red : 0xfcf8f1, 6, m);
      }
    }
  }
}

/** Pharmacy crosses blink at night (called every frame by the city). */
export function animateSigns(t: number, night: boolean): void {
  void t;
  void night;
}

function nameLook(pb: PreparedBuilding, name: string): (ctx: CanvasRenderingContext2D, w: number, h: number) => void {
  return pb.typ === "school" ? drawLabel(name, "#3e7bd6", "#ffffff") : pb.typ === "church" ? drawLabel(name, "#d8c9a8", "#1f2328", { serif: true }) : pb.typ === "hospital" ? drawLabel(name, "#ffffff", "#2f9e5b", { border: "#2f9e5b" }) : drawLabel(name, "#fcf8f1", "#1f2328", { serif: pb.typ === "theatre" || pb.typ === "public" });
}

function poiDraw(poi: CityPoi): (ctx: CanvasRenderingContext2D, w: number, h: number) => void {
  const look = poiLook(poi.category);
  return drawLabel(look.kind === "bank" || look.kind === "pharmacy" ? poi.name.toUpperCase() : poi.name, look.bg, look.fg, { serif: look.kind === "bar" });
}

/** Draw every facade text of the lap into the text atlas, straight from the data (prewarm). */
export function prewarmReliefText(ctx: CityCtx): void {
  for (const pb of ctx.buildings) {
    if (!pb.name || pb.src.dist > 30) continue;
    signSlot(`bname-${pb.typ}-${pb.name}`, nameLook(pb, pb.name));
    if (pb.typ === "theatre") signSlot(`frieze-${pb.name}`, drawLabel(pb.name.toUpperCase(), "#fcf8f1", "#1f2328", { serif: true }));
  }
  for (const poi of ctx.city.pois) if (poi.dist <= 35 && plausibleName(poi.name)) signSlot(`poi-${poi.category}-${poi.name}`, poiDraw(poi));
}
