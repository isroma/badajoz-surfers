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
});
