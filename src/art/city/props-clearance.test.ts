import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

// a minimal canvas stub: the art draws text and small textures through the 2D canvas API
const ctx2d = new Proxy({}, {
  get: (_t, k) => (k === "measureText" ? () => ({ width: 10 }) : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop: () => undefined }) : () => undefined),
  set: () => true,
});
(globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

describe("city art: props stay out of the runnable surface", () => {
  it("no bollard, bench, planter, lamp, tree, sign or other prop stands in a runnable lane (0.25–4.5 m), in the river or inside a building", async () => {
    const { createTrack, validateCity } = await import("../../city");
    const { buildContext, CHUNK } = await import("./context");
    const { Bag, TS } = await import("./bag");
    const { buildRoadChunk } = await import("./road");
    const { buildChunkDressing, allTrees, placementBlocked } = await import("./dressing");
    const { buildGuides } = await import("./guides");
    const { buildGround } = await import("./ground");
    const { buildLandmarks } = await import("./landmarks");
    const city = validateCity(JSON.parse(readFileSync("public/data/city.json", "utf8")));
    const track = createTrack(city);
    const ctx = buildContext(city, track);
    const ts = new TS(track);
    const ground = buildGround(ctx);
    const bad: string[] = [];
    const v = new THREE.Vector3();
    // a roundabout's island belongs to the ring (lanes never come within rInner + 0.3 m in the
    // world; an approach's lanes may overlap it only in track space)
    const { ringsOf } = await import("./roundabouts");
    const onIsland = (x: number, z: number): boolean => ringsOf(ctx).some((r) => Math.hypot(x - r.rb.cx, z - r.rb.cz) < r.rb.rInner - 0.3);
    const check = (o: THREE.Object3D, what: string): void => {
      o.updateMatrixWorld(true);
      o.traverse((m) => {
        if (!(m instanceof THREE.Mesh)) return;
        const pos = (m.geometry as THREE.BufferGeometry).getAttribute("position");
        for (let i = 0; i < pos.count; i += 3) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          if (onIsland(v.x, v.z)) continue;
          const pr = track.project(v.x, v.z);
          const lay = track.layoutAt(pr.s);
          if (!lay.offsets.some((o, k) => Math.abs(pr.lateral - o) < (lay.widths[k] ?? 0) / 2 - 0.05)) continue;
          const f = track.frameAt(pr.s);
          const dy = v.y - f.h;
          if (dy > 0.25 && dy < 4.5) {
            bad.push(`${what} s=${pr.s.toFixed(0)} lat=${pr.lateral.toFixed(1)} y=${dy.toFixed(1)}`);
            return;
          }
        }
      });
    };
    for (let i = 0; i < ctx.nChunks; i++) {
      const s0 = i * CHUNK;
      const s1 = Math.min(track.lapLength, s0 + CHUNK);
      const bag = new Bag();
      const road = buildRoadChunk(ctx, bag, ts, s0, s1);
      for (const pass of ["road", "furniture", "relief", "relief2"] as const) buildChunkDressing(ctx, bag, ts, i, s0, s1, road.edges, ground, pass);
      buildGuides(ctx, bag, ts, s0, s1);
      const g = new THREE.Group();
      bag.props.build(false, g);
      check(g, `chunk ${i}`);
    }
    check(buildLandmarks(ctx, ground), "landmarks");
    for (const t of allTrees(ctx, ground)) {
      const why = placementBlocked(ctx, ground, t.x, t.z);
      if (why) bad.push(`tree ${why} at ${t.x.toFixed(0)},${t.z.toFixed(0)}`);
      if (t.y < ctx.waterLevel + 1.0 || Math.abs(t.y - ground.heightAt(t.x, t.z)) > 1.8) bad.push(`tree in the water or floating at ${t.x.toFixed(0)},${t.z.toFixed(0)}`);
      const pr = track.project(t.x, t.z);
      const lay = track.layoutAt(pr.s);
      if (lay.offsets.some((o, k) => Math.abs(pr.lateral - o) < (lay.widths[k] ?? 0) / 2 - 0.05)) bad.push(`tree s=${pr.s.toFixed(0)} lat=${pr.lateral.toFixed(1)}`);
    }
    expect(bad.slice(0, 40)).toEqual([]);
  }, 300_000);

  it("no prop stands on any drawn carriageway (route both ways, rings, arms, side streets)", async () => {
    const { createTrack, validateCity } = await import("../../city");
    const { buildContext, CHUNK } = await import("./context");
    const { Bag, TS } = await import("./bag");
    const { buildRoadChunk } = await import("./road");
    const { buildChunkDressing } = await import("./dressing");
    const { buildGuides } = await import("./guides");
    const { buildGround } = await import("./ground");
    const { buildLandmarks } = await import("./landmarks");
    const { ringsOf } = await import("./roundabouts");
    const { widthOf } = await import("./network");
    const city = validateCity(JSON.parse(readFileSync("public/data/city.json", "utf8")));
    const track = createTrack(city);
    const ctx = buildContext(city, track);
    const ts = new TS(track);
    const ground = buildGround(ctx);
    // side-street carriageways near the route (not the ring ways: the rings are checked below)
    const segs: { ax: number; az: number; bx: number; bz: number; h: number }[] = [];
    for (const st of city.streets) {
      if (st.onRoute || st.tunnel || st.roundabout) continue;
      const w = widthOf(st);
      if (w.ped) continue;
      for (let i = 0; i + 3 < st.pts.length; i += 2) segs.push({ ax: st.pts[i]!, az: st.pts[i + 1]!, bx: st.pts[i + 2]!, bz: st.pts[i + 3]!, h: w.road / 2 - 0.3 });
    }
    const grid = new Map<string, typeof segs>();
    for (const g of segs) {
      for (let x = Math.floor(Math.min(g.ax, g.bx) / 20); x <= Math.floor(Math.max(g.ax, g.bx) / 20); x++)
        for (let z = Math.floor(Math.min(g.az, g.bz) / 20); z <= Math.floor(Math.max(g.az, g.bz) / 20); z++) {
          const k = `${x},${z}`;
          let a = grid.get(k);
          if (!a) grid.set(k, (a = []));
          a.push(g);
        }
    }
    const onStreet = (x: number, z: number): boolean => (grid.get(`${Math.floor(x / 20)},${Math.floor(z / 20)}`) ?? []).some((g) => {
      const dx = g.bx - g.ax, dz = g.bz - g.az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - g.ax) * dx + (z - g.az) * dz) / l2));
      return Math.hypot(x - g.ax - dx * t, z - g.az - dz * t) < g.h;
    });
    const bad: string[] = [];
    const seen = new Set<string>();
    const v = new THREE.Vector3();
    const check = (o: THREE.Object3D, what: string): void => {
      o.updateMatrixWorld(true);
      o.traverse((m) => {
        if (!(m instanceof THREE.Mesh)) return;
        const pos = (m.geometry as THREE.BufferGeometry).getAttribute("position");
        const col = (m.geometry as THREE.BufferGeometry).getAttribute("color");
        const w0 = new THREE.Vector3(), w1 = new THREE.Vector3(), w2 = new THREE.Vector3();
        for (let i = 0; i + 2 < pos.count; i += 3) {
          // ground surfaces (flat triangles) are not props
          w0.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          w1.fromBufferAttribute(pos, i + 1).applyMatrix4(m.matrixWorld);
          w2.fromBufferAttribute(pos, i + 2).applyMatrix4(m.matrixWorld);
          const nn = new THREE.Vector3().subVectors(w1, w0).cross(new THREE.Vector3().subVectors(w2, w0)).normalize();
          if (Math.abs(nn.y) > 0.9 && Math.max(w0.y, w1.y, w2.y) - Math.min(w0.y, w1.y, w2.y) < 0.2 && m.name !== "trees") {
            const pr0 = track.project(w0.x, w0.z);
            if (w0.y - track.frameAt(pr0.s).h < 0.8) continue;
          }
          // the deliberate red-and-white barriers close arms and merges: allowed
          if (col) {
            const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
            if ((r > 0.5 && g < 0.15 && b < 0.15) || (r > 0.95 && g > 0.95 && b > 0.95)) continue;
          }
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          if (ringsOf(ctx).some((r) => Math.hypot(v.x - r.rb.cx, v.z - r.rb.cz) < r.rb.rInner - 0.3)) continue; // the island
          const pr = track.project(v.x, v.z);
          const dy = v.y - track.frameAt(pr.s).h;
          // standing bodies only (overhead awnings, arms and plates are not in the way); kerbs and
          // pavements of the ring object are ground; the Alcazaba walls are the walls
          if (dy < (m.name.startsWith("roundabouts") ? 0.65 : 0.25) || dy > 2.0 || m.name.startsWith("murallas")) continue;
          let where = "";
          const lay = track.layoutAt(pr.s);
          if (Math.abs(pr.lateral) < 40 && lay.carriageways.some((c) => pr.lateral > c.from + 0.3 && pr.lateral < c.to - 0.3)) where = "route carriageway";
          for (const r of ringsOf(ctx)) {
            const d = Math.hypot(v.x - r.rb.cx, v.z - r.rb.cz);
            if (d > r.rb.rInner + 0.3 && d < r.rb.rOuter - 0.3) where = "ring carriageway";
          }
          // side streets as the network draws them: outside the route's own span (the opposite
          // carriageway is mapped as a separate way but drawn by the route)
          if (!where && onStreet(v.x, v.z)) {
            const sp = ctx.routeSpan(pr.s);
            if (!(Math.abs(pr.lateral) < 40 && pr.lateral > sp.lo - 0.5 && pr.lateral < sp.hi + 0.5)) where = "side street";
          }
          if (!where) continue;
          const key = `${what}:${Math.round(pr.s / 10)}:${where}`;
          if (seen.has(key)) continue;
          seen.add(key);
          bad.push(`${what} ${where} s=${pr.s.toFixed(0)} lat=${pr.lateral.toFixed(1)} y=${dy.toFixed(1)} col=${col ? [col.getX(i), col.getY(i), col.getZ(i)].map((q) => q.toFixed(2)).join(",") : "-"} ${m.name}`);
        }
      });
    };
    for (let i = 0; i < ctx.nChunks; i++) {
      const s0 = i * CHUNK;
      const s1 = Math.min(track.lapLength, s0 + CHUNK);
      const bag = new Bag();
      const road = buildRoadChunk(ctx, bag, ts, s0, s1);
      for (const pass of ["road", "furniture", "relief", "relief2"] as const) buildChunkDressing(ctx, bag, ts, i, s0, s1, road.edges, ground, pass);
      buildGuides(ctx, bag, ts, s0, s1);
      const g = new THREE.Group();
      bag.props.build(false, g);
      check(g, `chunk ${i}`);
    }
    check(buildLandmarks(ctx, ground), "landmarks");
    expect(bad.slice(0, 60)).toEqual([]);
  }, 600_000);
});
