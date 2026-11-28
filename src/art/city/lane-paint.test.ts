import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

// a minimal canvas stub: the art draws text and small textures through the 2D canvas API
const ctx2d = new Proxy({}, {
  get: (_t, k) => (k === "measureText" ? () => ({ width: 10 }) : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop: () => undefined }) : () => undefined),
  set: () => true,
});
(globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

describe("city art: nothing painted runs inside a runnable lane", () => {
  it("on the whole lap and round every roundabout only arrows, give-way / stop lines, zebras and closing lines lie inside a lane", async () => {
    const { createTrack, validateCity } = await import("../../city");
    const { buildContext, CHUNK } = await import("./context");
    const { Bag, TS } = await import("./bag");
    const { buildRoadChunk } = await import("./road");
    const { buildGuides } = await import("./guides");
    const { buildRoundabout, ringsOf } = await import("./roundabouts");
    const { laneOffsetAt, merges } = await import("../../game/lanes");
    const { laneMerges, mergeEdgeAt } = await import("./merges");
    const city = validateCity(JSON.parse(readFileSync("public/data/city.json", "utf8")));
    const track = createTrack(city);
    const ctx = buildContext(city, track);
    const ts = new TS(track);
    const L = track.lapLength;
    const never = new Set<string>();
    for (const m of merges(track)) if (m.s1 - m.s0 < 0.5) never.add(`${m.fromStretch}:${m.lane}`);
    const inSpan = (x: number, z: number): boolean => {
      const pr = track.project(x, z);
      if (Math.abs(pr.lateral) > 40) return false;
      const sp = ctx.routeSpan(pr.s);
      return pr.lateral > sp.lo - 0.3 && pr.lateral < sp.hi + 0.3;
    };
    /** The runnable lane band (centre, half width − 0.25) containing (s, l), or null. */
    const laneAt = (s: number, l: number): { c: number; h: number } | null => {
      const lay = track.layoutAt(s);
      const si = track.stretches.findIndex((st) => s >= st.fromS && s < st.toS);
      for (let k = 0; k < lay.offsets.length; k++) {
        if (never.has(`${si}:${k}`)) continue;
        const c = laneOffsetAt(track, k, s);
        const h = (lay.widths[k] ?? 0) / 2 - 0.25;
        if (h > 0 && Math.abs(l - c) < h) return { c, h };
      }
      return null;
    };
    const bad: string[] = [];
    const seen = new Set<string>();
    const check = (g: THREE.Object3D, what: string, s0: number, s1: number, hint: number): void => {
      g.updateMatrixWorld(true);
      g.traverse((m) => {
        if (!(m instanceof THREE.Mesh)) return;
        const mat = m.material as THREE.Material;
        if (!mat.polygonOffset || mat.polygonOffsetFactor !== -4) return; // painted markings only
        const geo = m.geometry as THREE.BufferGeometry;
        const pos = geo.getAttribute("position");
        const col = geo.getAttribute("color");
        const idx = geo.index;
        const n = (idx ? idx.count : pos.count) / 3;
        const v = new THREE.Vector3();
        for (let t = 0; t < n; t++) {
          const ii = [0, 1, 2].map((k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k));
          // white or danger-red markings only (tints are not markings)
          const r = col ? col.getX(ii[0]!) : 1, gg = col ? col.getY(ii[0]!) : 1, b = col ? col.getZ(ii[0]!) : 1;
          const white = r > 0.8 && gg > 0.8 && b > 0.8;
          const red = r > 0.5 && gg < 0.15 && b < 0.15;
          if (!white && !red) continue;
          const P = ii.map((i) => {
            v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
            const pr = track.project(v.x, v.z, hint);
            return { s: pr.s, l: pr.lateral };
          });
          const cs = (P[0]!.s + P[1]!.s + P[2]!.s) / 3;
          const cl = (P[0]!.l + P[1]!.l + P[2]!.l) / 3;
          if (cs < s0 || cs > s1) continue;
          const lane = laneAt(cs, cl);
          if (!lane || Math.abs(cl - lane.c) > lane.h - 0.1) continue; // (10 cm numeric tolerance at the band edge)
          // its extent in track space
          const ds = Math.max(P[0]!.s, P[1]!.s, P[2]!.s) - Math.min(P[0]!.s, P[1]!.s, P[2]!.s);
          const dl = Math.max(P[0]!.l, P[1]!.l, P[2]!.l) - Math.min(P[0]!.l, P[1]!.l, P[2]!.l);
          if (ds < 1.0 && dl < 1.0) continue; // give-way dashes, arrow heads, small pieces
          if (dl >= ds) continue; // across the lane: stop / give-way lines
          if (dl >= 0.4 && dl <= 0.6 && ds <= 4.2) continue; // zebra bars (the crossing runs across)
          if (ds <= 5.2 && Math.abs(cl - lane.c) <= 1.2) continue; // lane-direction and merge arrows
          // the kerb line of a carriageway (a lane that ends merges across it: a lane change)
          const lay = track.layoutAt(cs);
          if (lay.carriageways.some((c) => Math.abs(cl - c.from) < 0.3 || Math.abs(cl - c.to) < 0.3)) continue;
          // the closing line of a lane that is ending or opening (the merge funnel's edge)
          if (laneMerges(track).some((mg) => cs > mg.s0 - 1 && cs < mg.s1 + 1 && Math.abs(cl - (mergeEdgeAt(mg, cs) - mg.side * 0.125)) < 0.35)) continue;
          const best = { d: Math.hypot(ds, dl) };
          const ang = (Math.atan2(dl, ds) * 180) / Math.PI;
          const key = `${what}:${Math.round(cs / 5)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          bad.push(`${what} s=${cs.toFixed(1)} lat=${cl.toFixed(1)} lane ${lane.c.toFixed(1)} len ${best.d.toFixed(1)} angle ${ang.toFixed(0)}°`);
        }
      });
    };
    for (const ring of ringsOf(ctx)) {
      const rb = ring.rb;
      const len = (((rb.passToS - rb.passFromS) % L) + L) % L;
      const a = rb.passFromS - 60;
      const b = rb.passFromS + len + 60;
      const hint = rb.passFromS + len / 2;
      const bag = new Bag();
      buildRoundabout(ctx, bag, ring, inSpan);
      check(bag.build(new THREE.Group()), "ring", a, b, hint);
    }
    // and the whole lap's own markings (catches stray lines on pedestrian paving too)
    for (let ci = 0; ci < Math.ceil(L / CHUNK); ci++) {
      const s0 = ci * CHUNK;
      const s1 = Math.min(L, (ci + 1) * CHUNK);
      const rbag = new Bag();
      buildRoadChunk(ctx, rbag, ts, s0, s1);
      buildGuides(ctx, rbag, ts, s0, s1);
      check(rbag.build(new THREE.Group()), "route", s0 - 30, s1 + 30, (s0 + s1) / 2);
    }
    expect(bad.slice(0, 40)).toEqual([]);
  }, 600_000);
});
