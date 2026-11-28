import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

describe("city art: the route's own surfaces win", () => {
  it("no street, plaza or far-street geometry lies inside the route's drawn span, and inside each roundabout only the roundabout object", async () => {
    const { createTrack, validateCity } = await import("../../city");
    const { buildContext } = await import("./context");
    const { buildGround } = await import("./ground");
    const { buildNetwork } = await import("./network");
    const city = validateCity(JSON.parse(readFileSync("public/data/city.json", "utf8")));
    const track = createTrack(city);
    const ctx = buildContext(city, track);
    const net = buildNetwork(ctx, buildGround(ctx));
    // occupancy of non-route ground geometry in track space: 2 m bins along s, 0.5 m across
    const occ = new Map<number, string[]>();
    const add = (s: number, l: string): void => {
      const k = Math.floor(s / 2);
      let a = occ.get(k);
      if (!a) occ.set(k, (a = []));
      a.push(l);
    };
    const v = new THREE.Vector3();
    net.updateMatrixWorld(true);
    net.traverse((m) => {
      if (!(m instanceof THREE.Mesh)) return;
      const pos = (m.geometry as THREE.BufferGeometry).getAttribute("position");
      for (let i = 0; i + 2 < pos.count; i += 3) {
        // triangle centroid (pieces near the route are ≤ ~4 m)
        v.set(0, 0, 0);
        for (let k = 0; k < 3; k++) v.add(new THREE.Vector3().fromBufferAttribute(pos, i + k));
        v.multiplyScalar(1 / 3).applyMatrix4(m.matrixWorld);
        const pr = track.project(v.x, v.z);
        if (Math.abs(pr.lateral) >= 40) continue;
        const sp = ctx.routeSpan(pr.s);
        if (pr.lateral > sp.lo + 0.3 && pr.lateral < sp.hi - 0.3) add(pr.s, `${m.name} lat=${pr.lateral.toFixed(1)} at s=${pr.s.toFixed(1)} span ${sp.lo.toFixed(1)}..${sp.hi.toFixed(1)}`);
      }
    });
    const bad: string[] = [];
    // the lap every 2 m: any ground geometry from the streets / squares inside the span there?
    for (let s = 0; s < track.lapLength; s += 2) {
      const hits = occ.get(Math.floor(s / 2));
      if (hits?.length) {
        bad.push(hits[0]!);
      }
    }
    // inside each roundabout's footprint the roundabout object is the only ground
    const { inRingFootprint, ringsOf } = await import("./roundabouts");
    const { Bag, TS } = await import("./bag");
    const { buildRoadChunk } = await import("./road");
    const { CHUNK } = await import("./context");
    const ts = new TS(track);
    const chunks = new Set<number>();
    for (const r of ringsOf(ctx)) {
      const pr = track.project(r.rb.cx, r.rb.cz);
      for (let d = -r.rb.rOuter - 50; d <= r.rb.rOuter + 50; d += CHUNK / 2) chunks.add(Math.floor((((pr.s + d) % track.lapLength) + track.lapLength) % track.lapLength / CHUNK));
    }
    const groups: THREE.Object3D[] = [net];
    for (const c of chunks) {
      const bag = new Bag();
      buildRoadChunk(ctx, bag, ts, c * CHUNK, Math.min(track.lapLength, (c + 1) * CHUNK));
      groups.push(bag.build(new THREE.Group()));
    }
    for (const g of groups) {
      g.updateMatrixWorld(true);
      g.traverse((m) => {
        if (!(m instanceof THREE.Mesh)) return;
        // lane markings and runnable-lane tints (decals) may lie on top of the roundabout object
        if (g !== net && (m.material as THREE.Material).polygonOffset) return;
        const pos = (m.geometry as THREE.BufferGeometry).getAttribute("position");
        const idx = (m.geometry as THREE.BufferGeometry).index;
        const n = (idx ? idx.count : pos.count) / 3;
        for (let t = 0; t < n; t++) {
          v.set(0, 0, 0);
          for (let k = 0; k < 3; k++) v.add(new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(t * 3 + k) : t * 3 + k));
          v.multiplyScalar(1 / 3);
          const r = inRingFootprint(ctx, v.x, v.z, -2.8); // the carriageway and the island
          // ground only (props such as railings are checked by the props test)
          if (r && Math.abs(v.y - track.frameAt(track.project(v.x, v.z).s).h) < 0.3) {
            const col = (m.geometry as THREE.BufferGeometry).getAttribute("color");
            const ci = idx ? idx.getX(t * 3) : t * 3;
            bad.push(`${g === net ? "network" : "route"} ${m.name} ${(m.material as THREE.Material).type} col=${col ? [col.getX(ci), col.getY(ci), col.getZ(ci)].map((q) => q.toFixed(2)).join(",") : "-"} inside ${r.rb.id} at ${v.x.toFixed(1)},${v.z.toFixed(1)} d=${Math.hypot(v.x - r.rb.cx, v.z - r.rb.cz).toFixed(1)}/${r.rb.rOuter}`);
            break;
          }
        }
      });
    }
    expect(bad.slice(0, 30)).toEqual([]);
  }, 300_000);
});
