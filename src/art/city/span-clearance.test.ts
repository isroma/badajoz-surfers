import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

describe("city art: the route's own surfaces win", () => {
  it("no street, plaza or far-street geometry lies inside the route's drawn span (walls / pavements)", async () => {
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
    expect(bad.slice(0, 30)).toEqual([]);
  }, 300_000);
});
