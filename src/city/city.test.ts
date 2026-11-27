import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateCity, CityDataError, type CityData } from "./data";
import { createTrack, createFrame, smoothPassesFor } from "./track";
import { sectionLayout, type LaneLayout } from "./lanes";
import { formatLayoutTable } from "./print-layouts";
import {
  bucketByChunk,
  createGridIndex,
  indexBuildings,
  indexTrees,
  offsetRing,
  pointInPolygon,
  ringArea,
  ringCentroid,
  signedArea,
  triangulate,
  triangulatedArea,
  withWinding,
} from "./spatial";

const city: CityData = validateCity(JSON.parse(readFileSync("public/data/city.json", "utf8")));
const track = createTrack(city);
const lap = track.lapLength;

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
if (env?.["PRINT_LAYOUTS"]) console.log(`\n${formatLayoutTable(track)}\n`);

describe("data", () => {
  it("validates", () => {
    expect(city.meta.lapLength).toBeGreaterThan(8000);
    expect(() => validateCity({})).toThrow(CityDataError);
    expect(() => validateCity({ ...city, sections: [] })).toThrow(/sections/);
  });
});

describe("frames", () => {
  it("is continuous around the lap, including the seam", () => {
    const f = createFrame();
    const g = createFrame();
    const step = 0.25;
    let maxJump = 0;
    let maxTurn = 0;
    for (let s = -5; s < lap + 5; s += step) {
      track.frameAt(s, f);
      track.frameAt(s + step, g);
      maxJump = Math.max(maxJump, Math.hypot(g.x - f.x, g.z - f.z, g.h - f.h) / step);
      maxTurn = Math.max(maxTurn, Math.abs(g.heading - f.heading) / step);
      // Tangent agrees with the heading.
      expect(Math.abs(Math.sin(f.heading) - f.tx) + Math.abs(Math.cos(f.heading) - f.tz)).toBeLessThan(1e-9);
    }
    expect(maxJump).toBeLessThan(1.1); // |dP/ds| ≈ 1 (route.s is chord length of 0.1 m-quantised points)
    expect(maxTurn).toBeLessThan(1 / 9); // tightest radius in the data ≈ 9.6 m (s 4251.5)
  });

  it("wraps s and unwraps heading across laps", () => {
    const a = track.frameAt(100);
    const b = track.frameAt(100 + lap);
    const c = track.frameAt(100 - lap);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1e-6);
    expect(Math.hypot(a.x - c.x, a.z - c.z)).toBeLessThan(1e-6);
    const turn = b.heading - a.heading;
    expect(Math.abs(Math.abs(turn) - 2 * Math.PI)).toBeLessThan(1e-6);
    expect(track.frameAt(lap - 1e-9).heading).toBeCloseTo(track.frameAt(lap).heading, 4);
  });

  it("has the normal on the runner's right (Puente Real start)", () => {
    const f = track.frameAt(50);
    // Heading south-east: +x (east) and +z (south).
    expect(f.tx).toBeGreaterThan(0.3);
    expect(f.tz).toBeGreaterThan(0.3);
    // Right of a south-east heading is south-west: -x, +z.
    expect(f.nx).toBeLessThan(0);
    expect(f.nz).toBeGreaterThan(0);
    // The other carriageway (offset -8.1, left) is towards the north-east.
    const p = { x: 0, y: 0, z: 0 };
    track.toWorld(50, -8.1, 0, p);
    expect(p.x - f.x).toBeGreaterThan(0);
    expect(p.z - f.z).toBeLessThan(0);
    // On the bridge deck (s 512–966), -8.1 m lands on the other deck's line and +8.1 m does not.
    const decks = city.landmarks.find((l) => l.id === "puente-real")?.decks ?? [];
    expect(decks.length).toBe(2);
    const distToDecks = (x: number, z: number): number[] =>
      decks.map((d) => {
        const [ax, az, bx, bz] = d.line as [number, number, number, number];
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
        return Math.hypot(ax + (bx - ax) * t - x, az + (bz - az) * t - z);
      });
    track.toWorld(700, -8.1, 0, p);
    const left = distToDecks(p.x, p.z);
    track.toWorld(700, 0, 0, p);
    const ours = distToDecks(p.x, p.z);
    const ourDeck = ours[0]! < ours[1]! ? 0 : 1;
    expect(ours[ourDeck]!).toBeLessThan(1);
    expect(left[1 - ourDeck]!).toBeLessThan(1);
  });

  it("curvature sign: + when turning right", () => {
    // Roundabouts are driven anticlockwise on the map = turning left = negative curvature.
    const ring = city.sections.find((s) => s.roundabout && s.toS - s.fromS > 60)!;
    const f = track.frameAt((ring.fromS + ring.toS) / 2);
    expect(f.curvature).toBeLessThan(-1 / 60);
  });

  it("toWorld / project round trip", () => {
    const p = { x: 0, y: 0, z: 0 };
    let maxErrStraight = 0;
    let maxErrAll = 0;
    for (let s = 1; s < lap; s += 7.3) {
      const f = track.frameAt(s);
      let kNear = 0;
      for (let d = -25; d <= 25; d += 2.5) kNear = Math.max(kNear, Math.abs(track.frameAt(s + d).curvature));
      const straight = kNear <= 1 / 300;
      for (const lat of [-12, -6, -2, 0, 3, 8, 12]) {
        // Skip points beyond the local centre of curvature (nearest point is then ambiguous).
        if (!straight && Math.abs(lat) * kNear > 0.5) continue;
        track.toWorld(s, lat, 1.5, p);
        expect(p.y).toBeCloseTo(f.h + 1.5, 9);
        const r = track.project(p.x, p.z, s + 3);
        const err = Math.hypot(r.s - s, r.lateral - lat);
        if (straight) maxErrStraight = Math.max(maxErrStraight, err);
        // On curves the foot point can be ambiguous (several perpendiculars); what must hold is
        // that project() returns a point that maps back to p and is no farther than the input.
        const q = { x: 0, y: 0, z: 0 };
        track.toWorld(r.s, r.lateral, 0, q);
        maxErrAll = Math.max(maxErrAll, Math.hypot(q.x - p.x, q.z - p.z));
        expect(Math.abs(r.lateral)).toBeLessThanOrEqual(Math.abs(lat) + 0.01);
      }
    }
    expect(maxErrStraight).toBeLessThan(0.05);
    expect(maxErrAll).toBeLessThan(0.05);
    const g = track.project(track.frameAt(4321).x, track.frameAt(4321).z);
    expect(g.s).toBeCloseTo(4321, 1);
  });

  it("frameAt is fast and allocation-free with out", () => {
    const f = createFrame();
    const N = 200_000;
    const t0 = performance.now();
    let acc = 0;
    for (let i = 0; i < N; i++) acc += track.frameAt((i * 0.41) % lap, f).x;
    const us = ((performance.now() - t0) * 1000) / N;
    expect(acc).not.toBeNaN();
    if (env?.["PRINT_LAYOUTS"]) console.log(`frameAt: ${(us * 1000).toFixed(0)} ns/call`);
    expect(us).toBeLessThan(2);
  });
});

describe("zones and sections", () => {
  it("zones cover the lap in order", () => {
    expect(track.zones.map((z) => z.id)).toEqual(["puente-real", "valdepasillas", "san-francisco", "casco-antiguo", "alcazaba-palmas", "margen-derecha"]);
    expect(track.zones[0]!.fromS).toBe(0);
    for (let i = 1; i < track.zones.length; i++) expect(track.zones[i]!.fromS).toBeCloseTo(track.zones[i - 1]!.toS, 6);
    expect(track.zones[track.zones.length - 1]!.toS).toBeCloseTo(lap, 6);
    expect(track.zoneAt(-1).id).toBe("margen-derecha");
    expect(track.zoneAt(lap + 1).index).toBe(0);
    expect(track.streetNameAt(600)).toBe("Puente Real");
    expect(track.sectionAt(6000).bridge).toBe("Puente de Palmas");
  });
});

const checkLayout = (l: LaneLayout, where: string): void => {
  const n = l.offsets.length;
  expect(n, where).toBeGreaterThanOrEqual(2);
  expect(n, where).toBeLessThanOrEqual(5);
  expect(l.widths.length).toBe(n);
  expect(l.flow.length).toBe(n);
  expect(l.kinds.length).toBe(n);
  for (let i = 0; i < n; i++) {
    const kind = l.kinds[i];
    if (kind === "road") expect(l.flow[i], where).not.toBe(0);
    else expect(l.flow[i], where).toBe(0);
    if (i > 0) {
      const gap = l.offsets[i]! - l.offsets[i - 1]!;
      expect(gap, where).toBeGreaterThan(0);
      expect(gap, where).toBeGreaterThanOrEqual((l.widths[i]! + l.widths[i - 1]!) / 2 - 0.02);
    }
  }
  expect(l.gaps.length).toBe(n - 1);
  for (let i = 1; i < n; i++) expect(l.gaps[i - 1]!).toBeCloseTo(l.offsets[i]! - l.offsets[i - 1]!, 1);
  // Runnable lanes never sit on a median strip unless they are median lanes.
  for (let i = 0; i < n; i++) {
    const onMedian = l.median.some((m) => l.offsets[i]! > m.from && l.offsets[i]! < m.to);
    expect(onMedian, where).toBe(l.kinds[i] === "median");
  }
  if (n === 2) expect(l.kinds.every((k) => k === "pedestrian"), where).toBe(true);
  expect(l.left).toBeCloseTo(l.offsets[0]! - l.widths[0]! / 2, 1);
  expect(l.right).toBeCloseTo(l.offsets[n - 1]! + l.widths[n - 1]! / 2, 1);
  // Road lanes lie on a carriageway of their direction.
  for (let i = 0; i < n; i++) {
    if (l.kinds[i] !== "road") continue;
    const o = l.offsets[i]!;
    const cw = l.carriageways.find((c) => o > c.from && o < c.to);
    expect(cw, where).toBeDefined();
    if (cw!.flow !== 0) expect(cw!.flow, where).toBe(l.flow[i]);
  }
};

describe("lane layouts", () => {
  it("stretches are consecutive, cover the lap and are valid", () => {
    const st = track.stretches;
    expect(st[0]!.fromS).toBe(0);
    expect(st[st.length - 1]!.toS).toBeCloseTo(lap, 6);
    for (let i = 0; i < st.length; i++) {
      if (i > 0) expect(st[i]!.fromS).toBeCloseTo(st[i - 1]!.toS, 6);
      checkLayout(st[i]!.layout, `stretch ${st[i]!.fromS}`);
      expect(track.layoutAt((st[i]!.fromS + st[i]!.toS) / 2)).toBe(st[i]!.layout);
    }
    // Every raw section layout is valid too.
    for (const sec of city.sections) checkLayout(sectionLayout(sec), `section ${sec.fromS}`);
  });

  it("stabilises: no short stretches except protected rings, neighbours differ", () => {
    const st = track.stretches;
    for (let i = 0; i < st.length; i++) {
      const a = st[i]!;
      const len = a.toS - a.fromS;
      const seam = a.fromS === 0 || a.toS === lap;
      if (len < 60 && !seam) expect(a.section.roundabout, `short stretch at ${a.fromS}`).not.toBeNull();
      if (i > 0) expect(st[i - 1]!.layout.id, `same layout at ${a.fromS}`).not.toBe(a.layout.id);
    }
    // Same id ⇒ same object.
    const byId = new Map<string, LaneLayout>();
    for (const s of st) {
      const prev = byId.get(s.layout.id);
      if (prev) expect(prev).toBe(s.layout);
      byId.set(s.layout.id, s.layout);
    }
  });

  it("Puente Real is 4 lanes: 2 oncoming on the left, 2 with us", () => {
    for (const s of [20, 400, 700, 950]) {
      const l = track.layoutAt(s);
      expect(l.flow).toEqual([-1, -1, 1, 1]);
      expect(l.kinds).toEqual(["road", "road", "road", "road"]);
      expect(l.offsets[2]!).toBeCloseTo(-1.6, 1);
      expect(l.offsets[3]!).toBeCloseTo(1.6, 1);
      expect((l.offsets[0]! + l.offsets[1]!) / 2).toBeCloseTo(-8.15, 0);
      expect(l.median.length).toBe(1);
      expect(Math.max(...l.gaps), `s ${s}`).toBeLessThanOrEqual(5.5);
    }
  });

  it("wide medians are runnable; no lane change leaps more than ~7 m", () => {
    // Avenida Sinforiano Madroñero: 2+2 with a boulevard → one wide median lane (5 lanes).
    const sin = track.layoutAt(1500);
    expect(sin.kinds).toEqual(["road", "road", "median", "road", "road"]);
    expect(sin.flow).toEqual([-1, -1, 0, 1, 1]);
    expect(sin.widths[2]).toBe(3);
    expect(sin.median.length).toBe(1);
    for (const st of track.stretches) {
      expect(Math.max(...st.layout.gaps), `stretch ${st.fromS}`).toBeLessThanOrEqual(6.7);
      // Across a non-runnable median the lane change is ≤ 5.5 m.
      const l = st.layout;
      for (let i = 1; i < l.offsets.length; i++) {
        const crosses = l.median.some((m) => l.offsets[i - 1]! < m.from && l.offsets[i]! > m.to);
        if (crosses) expect(l.gaps[i - 1]!, `stretch ${st.fromS}`).toBeLessThanOrEqual(5.5);
      }
    }
    // One lane each way with a ≥ 7 m gap → two median lanes.
    const base = city.sections.find((x) => x.name === "Avenida Adolfo Díaz Ambrona" && x.dual)!;
    const two = sectionLayout({ ...base, medianWidth: null, lanes: 1, width: 3.5, opposite: { ...base.opposite!, lanes: 1, offset: -12 } });
    expect(two.kinds).toEqual(["road", "median", "median", "road", "sidewalk"]);
    const narrow = sectionLayout({ ...base, medianWidth: null, lanes: 1, width: 3.5, opposite: { ...base.opposite!, lanes: 1, offset: -5.5 } });
    expect(narrow.kinds).toEqual(["road", "road", "sidewalk"]);
    // medianWidth from the data wins over the offset: the kerb-to-kerb gap is exactly it.
    const byWidth = sectionLayout({ ...base, medianWidth: 2.0, lanes: 1, width: 3.5, opposite: { ...base.opposite!, lanes: 1, offset: -30 } });
    expect(byWidth.median[0]!.to - byWidth.median[0]!.from).toBeCloseTo(2.0, 2);
    // Avenida de Elvas: 3.3 m gap (medianWidth) but 6.8 m across → one narrow median lane.
    const elvas = track.layoutAt(7700);
    expect(elvas.kinds).toEqual(["road", "road", "median", "road", "road"]);
    expect(elvas.widths[2]!).toBeCloseTo(2.7, 1); // medianWidth 3.3 − 2 × 0.3
  });

  it("smoothing adapts to the route noise", () => {
    expect(track.smoothing.passes).toBe(smoothPassesFor(track.smoothing.chordNoise));
    if (env?.["PRINT_LAYOUTS"]) console.log(`smoothing: noise ${track.smoothing.chordNoise.toFixed(4)}, ${track.smoothing.passes} passes`);
    expect(smoothPassesFor(0.0015)).toBe(0);
    expect(smoothPassesFor(0.003)).toBe(1);
    expect(smoothPassesFor(0.05)).toBe(10);
  });

  it("the pedestrian stretches have no traffic", () => {
    // Paseo de San Francisco, the old town, Puente de Palmas.
    for (const s of [4120, 4600, 4800, 5900, 6200]) {
      const l = track.layoutAt(s);
      expect(l.flow.every((f) => f === 0), `s ${s}`).toBe(true);
      expect(l.kinds.every((k) => k === "pedestrian"), `s ${s}`).toBe(true);
      expect(l.carriageways.length).toBe(0);
    }
    const palmas = track.layoutAt(6000);
    expect(palmas.offsets.length).toBe(3);
    expect(palmas.right - palmas.left).toBeLessThanOrEqual(7.1);
  });

  it("two-way and one-way rules", () => {
    const base = city.sections.find((s) => s.name === "Avenida de Europa")!;
    const two = sectionLayout(base);
    expect(two.flow).toEqual([0, -1, 1, 0]);
    expect(two.kinds).toEqual(["sidewalk", "road", "road", "sidewalk"]);
    const one = sectionLayout({ ...base, oneway: true, lanes: 1, width: 3 });
    expect(one.flow).toEqual([0, 1, 0]);
    const four = sectionLayout({ ...base, lanes: 4, width: 13 });
    expect(four.flow).toEqual([-1, -1, 1, 1]);
    const three = sectionLayout({ ...base, lanes: 3, width: 9.75 });
    expect(three.flow).toEqual([-1, 1, 1]);
    const narrowPed = sectionLayout({ ...base, pedestrian: true, lanes: 0, clearance: 3.8, facadeWidth: 4.4, width: 3 });
    expect(narrowPed.offsets.length).toBe(2);
    expect(narrowPed.widths[0]!).toBeGreaterThanOrEqual(1.5);
  });
});

describe("spatial", () => {
  it("triangulates every building within 1% of its area, facing up", () => {
    let worst = 0;
    for (const b of city.buildings) {
      const t = triangulate(b.ring);
      const a = ringArea(b.ring);
      const err = Math.abs(triangulatedArea(t) - a) / Math.max(a, 1e-9);
      worst = Math.max(worst, err);
      const v = t.vertices;
      for (let i = 0; i < t.indices.length; i += 3) {
        const p = t.indices[i]!;
        const q = t.indices[i + 1]!;
        const r = t.indices[i + 2]!;
        // y of (q - p) × (r - p) must be ≥ 0 (faces +Y).
        const y = (v[2 * q + 1]! - v[2 * p + 1]!) * (v[2 * r]! - v[2 * p]!) - (v[2 * q]! - v[2 * p]!) * (v[2 * r + 1]! - v[2 * p + 1]!);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
      }
    }
    expect(city.buildings.length).toBeGreaterThan(1500);
    expect(worst).toBeLessThan(0.01);
  });

  it("triangulates water/green/squares/parking with holes", () => {
    let worst = 0;
    for (const area of [...city.water, ...city.green, ...city.squares, ...city.parking]) {
      const t = triangulate(area.ring, area.holes);
      const a = ringArea(area.ring) - (area.holes ?? []).reduce((acc, h) => acc + ringArea(h), 0);
      worst = Math.max(worst, Math.abs(triangulatedArea(t) - a) / Math.max(a, 1e-9));
    }
    expect(worst).toBeLessThan(0.01);
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    const hole = [3, 3, 7, 3, 7, 7, 3, 7];
    expect(triangulatedArea(triangulate(sq, [hole]))).toBeCloseTo(84, 6);
  });

  it("polygon helpers", () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(signedArea(sq)).toBe(100);
    expect(signedArea(withWinding(sq, -1))).toBe(-100);
    expect(pointInPolygon(5, 5, sq)).toBe(true);
    expect(pointInPolygon(5, 5, sq, [[4, 4, 6, 4, 6, 6, 4, 6]])).toBe(false);
    expect(pointInPolygon(11, 5, sq)).toBe(false);
    expect(ringArea(offsetRing(sq, 1))).toBeCloseTo(144, 6);
    expect(ringArea(offsetRing(withWinding(sq, -1), -1))).toBeCloseTo(64, 6);
    expect(ringCentroid(sq)).toEqual({ x: 5, z: 5 });
  });

  it("grid index and chunk bucketing", () => {
    const grid = indexBuildings(city);
    const b = city.buildings[100]!;
    const c = ringCentroid(b.ring);
    expect(grid.queryRadius(c.x, c.z, 1)).toContain(100);
    const trees = indexTrees(city);
    const near = trees.queryRadius(city.trees[0]!, city.trees[1]!, 0.5);
    expect(near).toContain(0);
    const pts = [0, 0, 100, 0, 0, 100];
    const g = createGridIndex(3, (i, o) => {
      o.minX = o.maxX = pts[2 * i]!;
      o.minZ = o.maxZ = pts[2 * i + 1]!;
    }, 10);
    expect(g.query(-1, -1, 101, 1).sort()).toEqual([0, 1]);

    const chunks = bucketByChunk(track, city.pois.length, (i, o) => {
      o.x = city.pois[i]!.x;
      o.z = city.pois[i]!.z;
    }, { hintS: (i) => city.pois[i]!.s });
    let total = 0;
    let agree = 0;
    chunks.chunks.forEach((list, ci) => {
      for (const p of list) {
        total++;
        expect(chunks.chunkAt(p.s)).toBe(ci);
        if (p.side === city.pois[p.index]!.side) agree++;
      }
    });
    expect(total).toBe(city.pois.length);
    expect(agree / total).toBeGreaterThan(0.9);
  });
});
