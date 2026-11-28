import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

// a minimal canvas stub: the art draws text and small textures through the 2D canvas API
const ctx2d = new Proxy({}, {
  get: (_t, k) => (k === "measureText" ? () => ({ width: 10 }) : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop: () => undefined }) : () => undefined),
  set: () => true,
});
(globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

interface Tri { ax: number; az: number; bx: number; bz: number; cx: number; cz: number; y: [number, number, number]; src: string; asphalt: boolean; col: string }

describe("city art: roundabout ground coverage", () => {
  it("every ring footprint, its mouths and arms are covered by exactly one flush ground surface", async () => {
    const { createTrack, validateCity } = await import("../../city");
    const { buildContext, CHUNK } = await import("./context");
    const { Bag, TS } = await import("./bag");
    const { buildRoadChunk } = await import("./road");
    const { buildRoundabout, footR, ringsOf, ringHeight } = await import("./roundabouts");
    const { SURFACE_COLOUR } = await import("./cmats");
    const city = validateCity(JSON.parse(readFileSync("public/data/city.json", "utf8")));
    const track = createTrack(city);
    const ctx = buildContext(city, track);
    const ts = new TS(track);
    const asph = new THREE.Color(SURFACE_COLOUR.asphalt);
    const inSpan = (x: number, z: number): boolean => {
      const pr = track.project(x, z);
      if (Math.abs(pr.lateral) > 40) return false;
      const sp = ctx.routeSpan(pr.s);
      return pr.lateral > sp.lo - 0.3 && pr.lateral < sp.hi + 0.3;
    };
    const bad: string[] = [];
    for (const ring of ringsOf(ctx)) {
      const rb = ring.rb;
      const hRing = ringHeight(ring);
      const R = rb.rOuter + 22;
      // ground triangles near this ring: the route's chunks round it and the ring object
      const tris: Tri[] = [];
      const collect = (g: THREE.Object3D, src: string): void => {
        g.updateMatrixWorld(true);
        g.traverse((m) => {
          if (!(m instanceof THREE.Mesh)) return;
          if ((m.material as THREE.Material).polygonOffset) return; // decals: markings and tints
          const geo = m.geometry as THREE.BufferGeometry;
          const pos = geo.getAttribute("position");
          const col = geo.getAttribute("color");
          const idx = geo.index;
          const n = (idx ? idx.count : pos.count) / 3;
          const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;
          for (let t = 0; t < n; t++) {
            const ii = [0, 1, 2].map((k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k));
            ii.forEach((i, k) => v[k as 0 | 1 | 2].fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
            const cx = (v[0].x + v[1].x + v[2].x) / 3;
            const cz = (v[0].z + v[1].z + v[2].z) / 3;
            if (Math.hypot(cx - rb.cx, cz - rb.cz) > R + 4) continue;
            // horizontal ground only (no kerb faces, no props), at ground level
            const nrm = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0])).normalize();
            if (nrm.y < 0.95) continue; // up-facing only (box bottoms are not ground)
            const cy = (v[0].y + v[1].y + v[2].y) / 3;
            const pr = track.project(cx, cz);
            const ref = Math.min(Math.abs(cy - track.frameAt(pr.s).h), Math.abs(cy - hRing(Math.atan2(cz - rb.cz, cx - rb.cx))));
            if (ref > 0.35) continue;
            const c = col ? new THREE.Color(col.getX(ii[0]!), col.getY(ii[0]!), col.getZ(ii[0]!)) : new THREE.Color(1, 1, 1);
            const asphalt = Math.abs(c.r - asph.r) + Math.abs(c.g - asph.g) + Math.abs(c.b - asph.b) < 0.05;
            tris.push({ ax: v[0].x, az: v[0].z, bx: v[1].x, bz: v[1].z, cx: v[2].x, cz: v[2].z, y: [v[0].y, v[1].y, v[2].y], src, asphalt, col: c.getHexString() });
          }
        });
      };
      const bag = new Bag();
      buildRoundabout(ctx, bag, ring, inSpan);
      collect(bag.build(new THREE.Group()), "ring");
      const chunks = new Set<number>();
      const L = track.lapLength;
      const passLen = (((rb.passToS - rb.passFromS) % L) + L) % L;
      for (let d = -40; d <= passLen + 40; d += CHUNK / 2) chunks.add(Math.floor((((rb.passFromS + d) % L) + L) % L / CHUNK));
      for (const c of chunks) {
        const b = new Bag();
        buildRoadChunk(ctx, b, ts, c * CHUNK, Math.min(track.lapLength, (c + 1) * CHUNK));
        collect(b.build(new THREE.Group()), "route");
      }
      // bucket by 2 m cells
      const grid = new Map<string, Tri[]>();
      for (const t of tris) {
        const x0 = Math.floor(Math.min(t.ax, t.bx, t.cx) / 2), x1 = Math.floor(Math.max(t.ax, t.bx, t.cx) / 2);
        const z0 = Math.floor(Math.min(t.az, t.bz, t.cz) / 2), z1 = Math.floor(Math.max(t.az, t.bz, t.cz) / 2);
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
          const k = `${x},${z}`;
          let a = grid.get(k);
          if (!a) grid.set(k, (a = []));
          a.push(t);
        }
      }
      const cover = (x: number, z: number): { y: number; t: Tri }[] => {
        const out: { y: number; t: Tri }[] = [];
        for (const t of grid.get(`${Math.floor(x / 2)},${Math.floor(z / 2)}`) ?? []) {
          const d = (t.bz - t.cz) * (t.ax - t.cx) + (t.cx - t.bx) * (t.az - t.cz);
          if (Math.abs(d) < 1e-9) continue;
          const l1 = ((t.bz - t.cz) * (x - t.cx) + (t.cx - t.bx) * (z - t.cz)) / d;
          const l2 = ((t.cz - t.az) * (x - t.cx) + (t.ax - t.cx) * (z - t.cz)) / d;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
          out.push({ y: l1 * t.y[0] + l2 * t.y[1] + l3 * t.y[2], t });
        }
        return out;
      };
      // the region that must be covered: the footprint, and the route's span within 20 m of the ring
      const must = (x: number, z: number): boolean => {
        const r = Math.hypot(x - rb.cx, z - rb.cz);
        if (r < rb.rInner + 0.3) return false; // the island (lawn, its own object)
        if (r < footR(rb) - 0.3) return true;
        if (r > rb.rOuter + 20) return false;
        // the route's own drawn surfaces: carriageways, lanes and pavements of its layout
        const pr = track.project(x, z);
        const lay = track.layoutAt(pr.s);
        let lo = lay.left, hi = lay.right;
        for (const c of lay.carriageways) { lo = Math.min(lo, c.from); hi = Math.max(hi, c.to); }
        for (const w of lay.sidewalks) { lo = Math.min(lo, w.from); hi = Math.max(hi, w.to); }
        return pr.lateral > lo + 0.3 && pr.lateral < hi - 0.3;
      };
      let bare = 0, fight = 0, step = 0;
      let fb = "", ff = "", fs = "";
      const top = new Map<string, { y: number; t: Tri } | null>();
      const S = 0.5;
      for (let x = rb.cx - R; x <= rb.cx + R; x += S) {
        for (let z = rb.cz - R; z <= rb.cz + R; z += S) {
          const c = cover(x, z);
          const key = `${Math.round(x / S)},${Math.round(z / S)}`;
          c.sort((a, b) => b.y - a.y);
          top.set(key, c[0] ?? null);
          if (!c.length) {
            // the footprint circle itself (polygonised on both sides to a few cm) is not sampled
            if (must(x, z) && Math.abs(Math.hypot(x - rb.cx, z - rb.cz) - footR(rb)) > 0.2) {
              bare++;
              fb ||= `bare at ${x.toFixed(1)},${z.toFixed(1)} r=${Math.hypot(x - rb.cx, z - rb.cz).toFixed(1)}`;
            }
            continue;
          }
          // two surfaces within 3 cm of each other: z-fighting / seams (same-colour pieces of one source excepted)
          for (let i = 0; i + 1 < c.length; i++) {
            const a = c[i]!, b = c[i + 1]!;
            // two different-coloured surfaces this close show as a seam / z-fight (identical road
            // pieces lying on each other are invisible: same colour, same normal)
            if (a.y - b.y < 0.03 && a.t.asphalt !== b.t.asphalt && Math.abs(Math.hypot(x - rb.cx, z - rb.cz) - footR(rb)) > 0.2) {
              fight++;
              ff ||= `z-fight ${a.t.src}${a.t.asphalt ? "A" : ""}/${b.t.src}${b.t.asphalt ? "A" : ""} at ${x.toFixed(1)},${z.toFixed(1)} r=${Math.hypot(x - rb.cx, z - rb.cz).toFixed(1)} Δ${(a.y - b.y).toFixed(3)} ${a.t.col}/${b.t.col}`;
              break;
            }
          }
        }
      }
      // steps between the route's road and the ring object's road across the handover
      for (const [key, a] of top) {
        if (!a || !a.t.asphalt) continue;
        const [i, j] = key.split(",").map(Number) as [number, number];
        for (const nb of [`${i + 1},${j}`, `${i},${j + 1}`]) {
          const b = top.get(nb);
          if (!b || !b.t.asphalt || b.t.src === a.t.src) continue;
          const rr = Math.hypot(i * S - rb.cx, j * S - rb.cz);
          if (Math.abs(a.y - b.y) > 0.03 && Math.abs(rr - footR(rb)) > 0.8) {
            step++;
            fs ||= `step ${a.t.src}/${b.t.src} at ${(i * S).toFixed(1)},${(j * S).toFixed(1)} Δ${(a.y - b.y).toFixed(3)}`;
          }
        }
      }
      if (bare + fight + step > 0) bad.push(`${rb.id}: bare ${bare}, z-fight ${fight}, steps ${step} (${[fb, ff, fs].filter(Boolean).join("; ")})`);
    }
    expect(bad).toEqual([]);
  }, 600_000);
});
