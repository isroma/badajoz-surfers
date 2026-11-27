/**
 * Real 3D relief on the facades near the route (≤ 25 m), aligned with the atlas bays: balcony
 * slabs with iron railings, glazed miradores, cornices, shop awnings, and the real businesses
 * (POIs) as fascia signs, pharmacy crosses, bank fascias and bar terraces.
 */
import * as THREE from "three";
import type { CityPoi } from "../../city/data";
import type { Bag } from "./bag";
import { styleOf, typDef } from "./buildings";
import { canvasMaterial, glassMaterial, glowMaterial, propMaterial } from "./cmats";
import { CLEARANCE, type CityCtx } from "./context";
import { hash01 } from "./shared";
import { FT } from "./textures";
import { newFrame } from "./track";

const BALCONY_TILES = new Set<number>([FT.brickBalcony, FT.renderBalcony, FT.cascoBalcony, FT.plazaAlta]);
const MIRADOR_TILES = new Set<number>([FT.brickMirador, FT.renderMirador]);
const SHOP_TILES = new Set<number>([FT.shopShutter, FT.stoneShops, FT.portalShop, FT.glassShop, FT.cascoShop]);

let railMat: THREE.Material | null = null;
function railingMaterial(): THREE.Material {
  if (railMat) return railMat;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, 128, 64);
    ctx.fillStyle = "#1b1b1b";
    ctx.fillRect(0, 0, 128, 6);
    ctx.fillRect(0, 56, 128, 5);
    for (let x = 4; x < 128; x += 12) ctx.fillRect(x, 0, 3, 64);
    ctx.strokeStyle = "#1b1b1b";
    ctx.lineWidth = 2;
    for (let x = 10; x < 128; x += 24) {
      ctx.beginPath();
      ctx.arc(x, 32, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true });
  m.userData["cast"] = true;
  railMat = m;
  return m;
}

function awningMaterial(): THREE.Material {
  return canvasMaterial("awning", (ctx, w, h) => {
    for (let x = 0; x < w; x += 32) {
      ctx.fillStyle = (x / 32) % 2 ? "#ffffff" : "#bdbdbd";
      ctx.fillRect(x, 0, 32, h);
    }
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(0, h - 20, w, 20);
  }, 256, 128);
}

const AWNING_COLS = [0x2f6b3a, 0x2f6b3a, 0xa8322a, 0x1f4f8a, 0xc58b22, 0x6b6b6b];

function poiStyle(cat: string): { bg: string; fg: string; kind: "pharmacy" | "bank" | "bar" | "shop" } {
  if (cat === "amenity:pharmacy") return { bg: "#1d8a3c", fg: "#ffffff", kind: "pharmacy" };
  if (cat === "amenity:bank") return { bg: "#103e7a", fg: "#ffffff", kind: "bank" };
  if (["amenity:bar", "amenity:cafe", "amenity:restaurant", "amenity:pub", "amenity:fast_food"].includes(cat)) return { bg: "#3a1f14", fg: "#f4d27a", kind: "bar" };
  return { bg: "#f3efe6", fg: "#2b2b2b", kind: "shop" };
}

function signMaterial(p: CityPoi): THREE.Material {
  const st = poiStyle(p.category);
  return canvasMaterial(`poi-${p.name}-${p.category}`, (ctx, w, h) => {
    ctx.fillStyle = st.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = st.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const face = st.kind === "bar" ? "Georgia, serif" : "'Helvetica Neue', Arial, sans-serif";
    let size = 58;
    ctx.font = `bold ${size}px ${face}`;
    const txt = st.kind === "bank" || st.kind === "pharmacy" ? p.name.toUpperCase() : p.name;
    while (ctx.measureText(txt).width > w - 40 && size > 24) {
      size -= 2;
      ctx.font = `bold ${size}px ${face}`;
    }
    ctx.fillText(txt, w / 2, h / 2 + 3);
    ctx.strokeStyle = st.fg;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, w - 12, h - 12);
  }, 768, 120, st.kind === "pharmacy");
}

function crossMaterial(): THREE.Material {
  return canvasMaterial("pharmacy-cross", (ctx, w, h) => {
    ctx.fillStyle = "#0b0b0b";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#29d35a";
    const a = w * 0.3;
    ctx.fillRect(a, 8, w - 2 * a, h - 16);
    ctx.fillRect(8, a, w - 16, h - 2 * a);
  }, 128, 128, true);
}

export function buildRelief(ctx: CityCtx, bag: Bag, chunk: number, s0: number, s1: number): void {
  /** A point reaching out over the runnable surface (only allowed above the clearance). */
  const overRunnable = (x: number, z: number, nearS: number): boolean => {
    const pr = ctx.track.project(x, z, nearS);
    const lay = ctx.track.layoutAt(pr.s);
    return pr.lateral > lay.left - 0.2 && pr.lateral < lay.right + 0.2;
  };
  const p = bag.props;
  const m = propMaterial(true);
  const glass = glassMaterial();
  const rail = railingMaterial();
  for (const pb of ctx.buildings) {
    if (pb.chunk !== chunk || pb.src.dist > 20 || pb.upperRing) continue;
    const st = styleOf(pb);
    const def = typDef(pb.typ);
    const ring = pb.ring;
    const phase = Math.floor(hash01(pb.index, 3) * 2);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const d = ring[(i + 1) % ring.length]!;
      const len = Math.hypot(d.x - a.x, d.z - a.z);
      if (len < 2.5 || ctx.isParty(pb.index, a.x, a.z, d.x, d.z)) continue;
      const ux = (d.x - a.x) / len;
      const uz = (d.z - a.z) / len;
      const nx = -uz;
      const nz = ux;
      // facing the route?
      const mx = (a.x + d.x) / 2;
      const mz = (a.z + d.z) / 2;
      const pr = ctx.track.project(mx + nx * 3, mz + nz * 3, pb.src.s);
      const fr = ctx.frame(pr.s);
      const toRoad = (fr.x - mx) * nx + (fr.z - mz) * nz;
      if (toRoad < 2) continue;
      const g = pb.streetGround ? ctx.streetLevel(mx, mz, pb.src.s) : pb.src.h0;
      const bays = Math.max(1, Math.round(len / def.bay));
      const bw = len / bays;
      const ry = Math.atan2(nx, nz); // local +Z = outward normal
      const local = (k: number, off = 0): [number, number] => {
        const t = (k + 0.5) * bw;
        return [a.x + ux * t + nx * off, a.z + uz * t + nz * off];
      };
      // tile column index per bay: atlas tiles are 2 bays wide
      const upperIsBalcony = BALCONY_TILES.has(st.upper);
      const upperMirador = MIRADOR_TILES.has(st.upper);
      for (let k = 0; k < bays; k++) {
        const col = (k + phase) % 2;
        // upper floors
        for (let fl = 0; fl < Math.min(st.floors, 7); fl++) {
          const y = st.Gf + fl * ((pb.top - st.Gf) / Math.max(1, st.floors));
          if (y - g < CLEARANCE) {
            const [ox, oz] = local(k, 1.0);
            if (overRunnable(ox, oz, pb.src.s)) continue;
          }
          if (upperIsBalcony && !(st.upper === FT.cascoBalcony && col === 1 && false)) {
            const bwid = st.upper === FT.renderBalcony ? 1.9 : st.upper === FT.cascoBalcony ? 1.6 : bw - 0.6;
            const offx = st.upper === FT.cascoBalcony ? -0.2 : 0;
            const [cx, cz] = local(k, 0);
            const ox = cx + ux * offx;
            const oz = cz + uz * offx;
            const depth = st.upper === FT.brickBalcony ? 0.9 : 0.55;
            p.push(new THREE.Matrix4().makeRotationY(ry).setPosition(ox, y, oz));
            p.box(0, 0.06 + 0.0, depth / 2, bwid, 0.14, depth, pb.typ === "brick" ? 0xd4cdbf : 0xe9e3d6, m);
            p.box(0, 1.02, depth - 0.02, bwid, 0.05, 0.05, 0x1d1d1d, m);
            p.quad(new THREE.Matrix4().makeScale(bwid, 0.9, 1).setPosition(0, 0.58, depth - 0.02), 0xffffff, rail);
            for (const sx of [-1, 1]) p.quad(new THREE.Matrix4().makeRotationY(Math.PI / 2).scale(new THREE.Vector3(depth, 0.9, 1)).setPosition((sx * bwid) / 2, 0.58, depth / 2), 0xffffff, rail);
            p.pop();
          } else if (upperMirador) {
            const [cx, cz] = local(k, 0);
            p.push(new THREE.Matrix4().makeRotationY(ry).setPosition(cx, y, cz));
            p.box(0, 0.5, 0.35, bw - 0.5, 1.0, 0.7, 0xece9e2, m);
            p.box(0, 1.85, 0.35, bw - 0.5, 1.7, 0.66, 0x9fb6c4, glass);
            p.box(0, 2.75, 0.36, bw - 0.45, 0.12, 0.74, 0xece9e2, m);
            p.pop();
          }
        }
        // ground floor: awnings on some shop bays
        if (SHOP_TILES.has(st.ground) && st.floors > 0 && hash01(pb.index * 31 + k, 17) < 0.3 && !overRunnable(...local(k, 1.45), pb.src.s)) {
          const [cx, cz] = local(k, 0);
          const c = AWNING_COLS[Math.floor(hash01(pb.index, k) * AWNING_COLS.length)]!;
          p.push(new THREE.Matrix4().makeRotationY(ry).setPosition(cx, g, cz));
          const w = bw - 0.5;
          const A = new THREE.Vector3(-w / 2, 3.05, 0.02);
          const B = new THREE.Vector3(w / 2, 3.05, 0.02);
          const C = new THREE.Vector3(w / 2, 2.45, 1.35);
          const D = new THREE.Vector3(-w / 2, 2.45, 1.35);
          p.tri([A.x, A.y, A.z], [D.x, D.y, D.z], [C.x, C.y, C.z], c, awningMaterial());
          p.tri([A.x, A.y, A.z], [C.x, C.y, C.z], [B.x, B.y, B.z], c, awningMaterial());
          p.box(0, 2.3, 1.35, w, 0.3, 0.03, c, m);
          p.pop();
        }
      }
      // cornice along the top on rendered and old-town buildings
      const lowOver = pb.top - g < CLEARANCE + 0.5 && overRunnable(mx + nx * 0.45, mz + nz * 0.45, pb.src.s);
      if (!lowOver && (pb.typ === "render" || pb.typ === "casco" || pb.typ === "plazaAlta" || pb.typ === "stone")) {
        const y = pb.pitched ? pb.top - 0.6 : pb.top;
        p.push(new THREE.Matrix4().makeRotationY(ry).setPosition(mx, y - 0.25, mz));
        p.box(0, 0, 0.18, len + 0.3, 0.3, 0.36, pb.typ === "casco" ? 0xf4f1ea : 0xe6dccb, m);
        p.box(0, -0.25, 0.08, len + 0.1, 0.2, 0.16, pb.typ === "casco" ? 0xeeeae0 : 0xd9cfbd, m);
        p.pop();
      }
      // first-floor string course on rendered blocks
      if (pb.typ === "render" && st.floors > 0) {
        p.push(new THREE.Matrix4().makeRotationY(ry).setPosition(mx, st.Gf, mz));
        p.box(0, 0, 0.12, len, 0.22, 0.24, 0xe0d4bd, m);
        p.pop();
      }
    }
  }

  // the real businesses
  const f = newFrame();
  for (const poi of ctx.city.pois) {
    if (poi.s < s0 || poi.s >= s1 || poi.dist > 35) continue;
    // nearest facade edge facing the route
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
    const st = poiStyle(poi.category);
    // bar and café terraces on the pavement, only where it is wider than the runnable lanes
    if (st.kind === "bar") {
      const pr = ctx.track.project(best.x, best.z, poi.s);
      const lay = ctx.track.layoutAt(pr.s);
      const side = pr.lateral > 0 ? 1 : -1;
      const runEdge = side > 0 ? lay.right + 0.5 : lay.left - 0.5;
      const room = Math.abs(pr.lateral - runEdge);
      if (room > 2.4) {
        const fr = ctx.track.frameAt(pr.s);
        for (let k = -1; k <= 1; k++) {
          const lat = pr.lateral - side * Math.min(room - 1.0, 1.6);
          const sx = fr.x + fr.nx * lat + fr.tx * k * 2.6;
          const sz = fr.z + fr.nz * lat + fr.tz * k * 2.6;
          const y = best.g;
          p.cyl(sx, y, sz, 0.04, 0.72, 0x9aa0a6, 6, m);
          p.cyl(sx, y + 0.72, sz, 0.38, 0.04, 0xd9dcde, 12, m);
          for (const d of [-0.6, 0.6]) p.box(sx + fr.tx * d, y + 0.45, sz + fr.tz * d, 0.42, 0.04, 0.42, 0x9aa0a6, m);
          p.cyl(sx, y + 0.76, sz, 0.03, 1.6, 0xdddddd, 6, m);
          p.cone(sx, y + 2.2, sz, 1.3, 0.45, [0xc8102e, 0xefeadf, 0x1f4f8a][Math.abs(poi.name.length + k) % 3] ?? 0xefeadf, 8, m);
        }
      }
    }
    const mat = signMaterial(poi);
    const w = Math.min(4.2, 1.2 + poi.name.length * 0.22);
    p.push(new THREE.Matrix4().makeRotationY(best.ry).setPosition(best.x, best.g, best.z));
    p.box(0, 3.25, 0.06, w + 0.12, 0.72, 0.1, 0x222222, m);
    p.quad(new THREE.Matrix4().makeScale(w, 0.62, 1).setPosition(0, 3.25, 0.115), 0xffffff, mat);
    const flagOut = { x: best.x + Math.sin(best.ry) * 1.6, z: best.z + Math.cos(best.ry) * 1.6 };
    if ((st.kind === "pharmacy" || st.kind === "bar") && !overRunnable(flagOut.x, flagOut.z, poi.s)) {
      // projecting flag sign, readable from up and down the street
      p.box(0, 3.9, 0.45, 0.05, 0.05, 0.9, 0x222222, m);
      const cm = st.kind === "pharmacy" ? crossMaterial() : mat;
      const sw = st.kind === "pharmacy" ? 0.8 : 1.4;
      const sh = st.kind === "pharmacy" ? 0.8 : 0.45;
      p.quad(new THREE.Matrix4().makeRotationY(Math.PI / 2).scale(new THREE.Vector3(sw, sh, 1)).setPosition(0.03, 3.4, 0.55 + sw / 2), 0xffffff, cm);
      p.quad(new THREE.Matrix4().makeRotationY(-Math.PI / 2).scale(new THREE.Vector3(sw, sh, 1)).setPosition(-0.03, 3.4, 0.55 + sw / 2), 0xffffff, cm);
      if (st.kind === "pharmacy") p.box(0, 3.4, 0.55 + sw / 2, 0.04, sh + 0.06, sw + 0.06, 0xffffff, glowMaterial());
    }
    p.pop();
  }
}

/** Pharmacy crosses blink green at night (called every frame by the city). */
export function animateSigns(t: number, night: boolean): void {
  const m = crossMaterial();
  if (m instanceof THREE.MeshBasicMaterial) m.color.setScalar(night ? (Math.sin(t * 4) > -0.2 ? 1.8 : 0.5) : 1);
}
