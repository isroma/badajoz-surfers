import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateCity, CityDataError, type CityData } from "./data";
import { createTrack, createFrame, smoothPassesFor, wallClearance } from "./track";
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
const marks = track.marks;
/** Middle of the longest section with this name (positions move when the data is re-anchored). */
const sOf = (name: string, pick: (x: (typeof city.sections)[number]) => boolean = () => true): number => {
  const secs = city.sections.filter((x) => x.name === name && pick(x)).sort((a, b) => b.toS - b.fromS - (a.toS - a.fromS));
  const x = secs[0];
  if (!x) throw new Error(`no section ${name}`);
  return (x.fromS + x.toS) / 2;
};
const ringEdge = (t: { fromIndex: number; toIndex: number }): boolean =>
  track.roundabouts.some((rb) => rb.stretchIndices.includes(t.fromIndex) || rb.stretchIndices.includes(t.toIndex));

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
    const deck = marks.pylon - 100;
    track.toWorld(deck, -8.1, 0, p);
    const left = distToDecks(p.x, p.z);
    track.toWorld(deck, 0, 0, p);
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
  it("marks are in lap order; the start is not the frame origin", () => {
    const order = ["start", "bridgeDeckStart", "pylon", "bridgeDeckEnd", "firstRoundaboutEntry", "firstRoundaboutExit", "sinforianoStart", "sinforianoEnd", "sanFranciscoStart", "plazaMinayo", "plazaEspana", "plazaAlta", "arcoDelPeso", "puertaPalmas", "puentePalmasStart", "puentePalmasEnd", "elvasRoundabout"] as const;
    const at = (k: (typeof order)[number]): number => {
      const v = marks[k];
      return Array.isArray(v) ? v[0] : v;
    };
    for (let i = 1; i < order.length; i++) expect(at(order[i]!), order[i]).toBeGreaterThan(at(order[i - 1]!));
    expect(marks.start).toBe(0);
    const f0 = track.frameAt(0);
    expect(Math.hypot(f0.x - track.start.x, f0.z - track.start.z)).toBeLessThan(0.2);
    expect(Math.hypot(track.start.x, track.start.z)).toBeGreaterThan(100);
    // meta.start.bearing is the compass bearing of travel (clockwise from north = −z).
    const bearing = ((Math.atan2(f0.tx, -f0.tz) * 180) / Math.PI + 360) % 360;
    expect(Math.abs(((bearing - track.start.bearing + 540) % 360) - 180)).toBeLessThan(5);
    expect(track.layoutAt(marks.firstRoundaboutEntry + 1)).toBe(track.stretches[track.roundabouts.find((r) => r.entryS === marks.firstRoundaboutEntry)!.stretchIndices[0]!]!.layout);
  });

  it("zones cover the lap in order", () => {
    expect(track.zones.map((z) => z.id)).toEqual(["puente-real", "valdepasillas", "san-francisco", "casco-antiguo", "alcazaba-palmas", "margen-derecha"]);
    expect(track.zones[0]!.fromS).toBe(0);
    for (let i = 1; i < track.zones.length; i++) expect(track.zones[i]!.fromS).toBeCloseTo(track.zones[i - 1]!.toS, 6);
    expect(track.zones[track.zones.length - 1]!.toS).toBeCloseTo(lap, 6);
    expect(track.zoneAt(-1).id).toBe("margen-derecha");
    expect(track.zoneAt(lap + 1).index).toBe(0);
    expect(track.streetNameAt(marks.pylon)).toBe("Puente Real");
    expect(track.sectionAt((marks.puentePalmasStart + marks.puentePalmasEnd) / 2).bridge).toBe("Puente de Palmas");
  });
});

const KNOWN_IDS = new Set(["own-1", "own-2", "own-3", "opp-1", "opp-2", "median", "walk-L", "walk-R", "ped-1", "ped-2", "ped-3", "ring-2", "ring-3"]);

const checkLayout = (l: LaneLayout, where: string): void => {
  const n = l.offsets.length;
  expect(n, where).toBeGreaterThanOrEqual(2);
  expect(n, where).toBeLessThanOrEqual(4);
  expect(l.ids.includes("median"), `${where}: medians are never runnable`).toBe(false);
  // Pavement lanes only to reach 3 lanes.
  const road = l.kinds.filter((k) => k === "road").length;
  if (road >= 3) expect(l.kinds.includes("sidewalk"), where).toBe(false);
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
  // Two lanes only on narrow pedestrian streets or on single-lane rings / one-lane carriageways.
  if (n === 2) expect(l.kinds.every((k) => k === "pedestrian") || ["own-1,walk-R", "walk-L,own-1"].includes(l.ids.join()), where).toBe(true);
  expect(new Set(l.ids).size, where).toBe(n);
  for (const id of l.ids) expect(KNOWN_IDS.has(id), `${where} ${id}`).toBe(true);
  // Kinds and flows follow from the ids.
  l.ids.forEach((id, i) => {
    const kind = id.startsWith("own-") || id.startsWith("opp-") || id.startsWith("ring-") ? "road" : id === "median" ? "median" : id.startsWith("walk-") ? "sidewalk" : "pedestrian";
    expect(l.kinds[i], where).toBe(kind);
    expect(l.flow[i], where).toBe(id.startsWith("own-") || id.startsWith("ring-") ? 1 : id.startsWith("opp-") ? -1 : 0);
  });
  // own-1 is the kerb lane, always on the centreline.
  const own1 = l.ids.indexOf("own-1");
  if (own1 >= 0) expect(l.offsets[own1]!, where).toBe(0);
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

  it("stabilises: only rings (or stretches boxed in by rings) are short, neighbours differ", () => {
    const st = track.stretches;
    const isRingStretch = (x: (typeof st)[number]): boolean => x.layout.ids.every((id) => id.startsWith("own-") || id === "walk-R");
    for (let i = 0; i < st.length; i++) {
      const a = st[i]!;
      const len = a.toS - a.fromS;
      const seam = a.fromS === 0 || a.toS === lap;
      if (len < 120 && !seam) expect(isRingStretch(a) || a.section.roundabout !== null, `short stretch at ${a.fromS}`).toBe(true);
      if (i > 0) expect(st[i - 1]!.layout.id, `same layout at ${a.fromS}`).not.toBe(a.layout.id);
    }
    const byId = new Map<string, LaneLayout>();
    for (const x of st) {
      const prev = byId.get(x.layout.id);
      if (prev) expect(prev).toBe(x.layout);
      byId.set(x.layout.id, x.layout);
    }
  });

  it("Puente Real: 2 oncoming, 2 with us (4 road lanes, no walkway lane); lane changes ≤ 5.5 m", () => {
    for (const s of [10, marks.bridgeDeckStart + 50, marks.pylon, marks.bridgeDeckEnd + 20]) {
      const l = track.layoutAt(s);
      expect(l.ids).toEqual(["opp-2", "opp-1", "own-2", "own-1"]);
      expect(l.flow).toEqual([-1, -1, 1, 1]);
      expect(l.median.length).toBe(1);
      expect(Math.max(...l.gaps), `s ${s}`).toBeLessThanOrEqual(5.5);
    }
  });

  it("wide medians: never runnable; avenues are own lanes plus the pavement", () => {
    const sin = city.sections.filter((x) => x.name === "Avenida Sinforiano Madroñero" && x.dual).map((x) => (x.fromS + x.toS) / 2);
    const adolfo22 = sOf("Avenida Adolfo Díaz Ambrona", (x) => x.dual && x.lanes === 2);
    for (const s of [...sin, sOf("Avenida María Auxiliadora"), sOf("Avenida de Elvas"), adolfo22]) {
      const l = track.layoutAt(s);
      expect(l.ids, `s ${s}`).toEqual(["own-2", "own-1", "walk-R"]);
      expect(l.median.length, `s ${s}`).toBe(1); // still drawn
      expect(l.carriageways.some((c) => c.flow === -1), `s ${s}`).toBe(true);
    }
    // One-lane carriageway of a dual avenue: nothing runnable on the left (the median).
    expect(track.layoutAt(sOf("Avenida Adolfo Díaz Ambrona", (x) => x.dual && x.lanes === 1)).ids).toEqual(["own-1", "walk-R"]);
    const base = city.sections.find((x) => x.name === "Avenida de Elvas" && x.dual)!;
    expect(sectionLayout({ ...base, medianKind: "barrier" }).ids).toEqual(["own-2", "own-1", "walk-R"]);
    const narrow = sectionLayout({ ...base, medianKind: "kerb", medianWidth: 1.5 });
    expect(narrow.ids).toEqual(["opp-2", "opp-1", "own-2", "own-1"]);
    expect(narrow.median[0]!.to - narrow.median[0]!.from).toBeCloseTo(1.5, 2);
    for (const st of track.stretches) expect(st.layout.ids.includes("median")).toBe(false);
  });

  it("lanes are stable across every transition", () => {
    let checked = 0;
    for (const t of track.transitions) {
      const a = track.stretches[t.fromIndex]!.layout;
      const b = track.stretches[t.toIndex]!.layout;
      expect(t.map.length).toBe(a.ids.length);
      const targets = t.map.filter((x): x is number => x !== null);
      expect(new Set(targets).size).toBe(targets.length);
      expect([...targets, ...t.begins].sort()).toEqual(b.ids.map((_, j) => j));
      a.ids.forEach((id, i) => {
        const j = t.map[i];
        if (j === null || j === undefined) return;
        const moved = Math.abs(b.offsets[j]! - a.offsets[i]!);
        if (b.ids[j] === id) expect(moved, `${id} at ${t.s}`).toBeLessThan(1.0);
        else expect(moved, `${id}→${b.ids[j]!} at ${t.s}`).toBeLessThanOrEqual(ringEdge(t) ? 2.0 : 1.5);
        // Off the rings a lane never turns oncoming; at ring boundaries flow changes are listed.
        if (!ringEdge(t)) expect(b.flow[j] === -1 && a.flow[i] !== -1, `${id} turns oncoming at ${t.s}`).toBe(false);
        expect(t.flowChanges.includes(i), `${id} flow change at ${t.s}`).toBe(b.flow[j] !== a.flow[i]);
        checked++;
      });
      // A lane id present on both sides is the same lane.
      if (!ringEdge(t)) {
        a.ids.forEach((id, i) => {
          if (b.ids.includes(id)) expect(t.map[i]).toBe(b.ids.indexOf(id));
        });
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it("rings keep their real lanes, continuous with the approach, clear of the island", () => {
    expect(track.roundabouts.length).toBe(city.roundabouts.length);
    const f = createFrame();
    const p = { x: 0, y: 0, z: 0 };
    for (const rb of track.roundabouts) {
      expect(rb.stretchIndices.length, rb.id).toBeGreaterThan(0);
      const on = track.layoutAt((rb.entryS + rb.exitS) / 2);
      const road = on.ids.filter((id) => id.startsWith("own-") || id.startsWith("ring-"));
      expect(on.ids.every((id) => id.startsWith("own-") || id.startsWith("ring-") || id === "walk-R"), rb.id).toBe(true);
      expect(road.length, rb.id).toBeGreaterThanOrEqual(1);
      expect(road.length, rb.id).toBeLessThanOrEqual(rb.lanes);
      // Lanes flow through 1:1: every ring lane continues from the approach (none begins in the arc).
      const i = rb.stretchIndices[0]!;
      const tIn = track.transitions.find((t) => t.toIndex === i);
      if (tIn) expect(tIn.begins, `${rb.id} lanes beginning on the ring`).toEqual([]);
      // Shifts at the ring boundaries ≤ 0.3 m unless the island forces the ring lane outward.
      let dMin = Infinity;
      for (let s = rb.entryS; s <= rb.exitS; s += 0.5) {
        track.frameAt(s, f);
        dMin = Math.min(dMin, Math.hypot(f.x - rb.cx, f.z - rb.cz));
      }
      const R = track.stretches[i]!.layout;
      const tOut = track.transitions.find((t) => t.fromIndex === i);
      for (const t of [tIn, tOut]) {
        if (!t) continue;
        const a = track.stretches[t.fromIndex]!.layout;
        const b = track.stretches[t.toIndex]!.layout;
        t.map.forEach((j, k) => {
          if (j === null) return;
          if (a.kinds[k] === "pedestrian" || b.kinds[j] === "pedestrian") return; // narrow streets: geometry-limited
          const ringLane = t.toIndex === i ? j : k;
          const islandBound = dMin + R.offsets[ringLane]! - R.widths[ringLane]! / 2 <= rb.rInner + 0.3 + 0.15;
          const shift = Math.abs(b.offsets[j]! - a.offsets[k]!);
          if (!islandBound) expect(shift, `${rb.id} ${a.ids[k]!}→${b.ids[j]!}`).toBeLessThanOrEqual(0.31);
        });
      }
      expect(on.offsets[on.ids.indexOf("own-1")]).toBe(0);
      // Own lanes continue from the approach within 1 m.
      const before = track.layoutAt(rb.entryS - 1);
      for (const id of on.ids) {
        const j = before.ids.indexOf(id);
        if (j >= 0 && id.startsWith("own-")) expect(Math.abs(before.offsets[j]! - on.offsets[on.ids.indexOf(id)]!), `${rb.id} ${id}`).toBeLessThan(1);
      }
      // No lane inside the island (+0.3 m) anywhere on the arc.
      for (let s = rb.entryS + 0.5; s < rb.exitS; s += 2) {
        track.frameAt(s, f);
        const l = track.layoutAt(s);
        l.ids.forEach((id, i) => {
          if (l.kinds[i] !== "road") return;
          track.toWorld(s, l.offsets[i]! - l.widths[i]! / 2, 0, p);
          expect(Math.hypot(p.x - rb.cx, p.z - rb.cz), `${rb.id} ${id} at ${s}`).toBeGreaterThanOrEqual(rb.rInner + 0.3 - 0.05);
        });
      }
    }
  });

  it("every lane that ends is announced by laneEndsAhead from 60 m before", () => {
    const N = track.stretches.length;
    const prevT = new Map<number, (typeof track.transitions)[number]>();
    for (const t of track.transitions) prevT.set(t.toIndex, t);
    let ends = 0;
    let shortLived = 0;
    for (const t of track.transitions) {
      t.map.forEach((j, lane) => {
        if (j !== null) return;
        ends++;
        // Walk back up to 60 m, following the lane through earlier transitions.
        let si = t.fromIndex;
        let li: number | null = lane;
        for (let d = 0.5; d <= 60; d += 2.5) {
          const s = t.s === 0 ? lap - d : t.s - d;
          const want = track.stretchIndexAt(s);
          while (si !== want && li !== null) {
            const back = prevT.get(si);
            if (back) li = back.map.indexOf(li) >= 0 ? back.map.indexOf(li) : null;
            si = (si - 1 + N) % N;
          }
          if (li === null) {
            if (!track.stretches[t.fromIndex]!.layout.ids[lane]!.startsWith("ring-")) shortLived++;
            break;
          }
          expect(track.laneEndsAhead(s, li), `lane ${track.stretches[t.fromIndex]!.layout.ids[lane]!} ending at ${t.s}, ${d} m before`).toBeCloseTo(d, 1);
        }
      });
    }
    expect(ends).toBeGreaterThan(5);
    expect(shortLived).toBe(0);
    // A lane that continues: own-1 on Puente Real.
    expect(track.laneEndsAhead(300, track.layoutAt(300).ids.indexOf("own-1"))).toBeNull();
  });

  it("lanes fit between the real walls, except in short listed pinches", () => {
    const w = track.walls;
    expect(wallClearance(city, track)).toBe(w);
    expect(w.left.length).toBe(Math.ceil(lap));
    const inPinch = (i: number, side: "left" | "right"): boolean => track.pinches.some((p) => p.side === side && i >= p.fromS && i < p.toS);
    let bad = 0;
    for (const st of track.stretches) {
      for (let i = Math.floor(st.fromS); i < Math.ceil(st.toS) && i < w.left.length; i++) {
        const l = st.layout;
        if (l.left < w.left[i]! + 0.2 && !inPinch(i, "left")) bad++;
        if (l.right > w.right[i]! - 0.2 && !inPinch(i, "right")) bad++;
      }
    }
    expect(bad).toBe(0);
    const total = track.pinches.reduce((a, p) => a + p.toS - p.fromS, 0);
    if (env?.["PRINT_LAYOUTS"]) console.log(`pinches (${total} m):`, JSON.stringify(track.pinches));
    // Pinches caused by buildings the pipeline itself flags as reaching into the carriageway
    // (corner cuts, data errors) cannot be solved by the layout; the rest stays within ~40 m.
    const unflagged = track.pinches.filter((p) => !p.flagged).reduce((a, p) => a + p.toS - p.fromS, 0);
    expect(unflagged).toBeLessThanOrEqual(40);
    expect(total).toBeLessThanOrEqual(75);
    for (const p of track.pinches) expect(p.toS - p.fromS).toBeLessThan(25);
  });

  it("turns: every roundabout pass is one turn; turnAhead looks 150 m ahead", () => {
    for (const rb of city.roundabouts) {
      const t = track.turns.filter((x) => x.roundabout && x.entryS === rb.entryS);
      expect(t.length, rb.id).toBe(1);
      expect(t[0]!.sweep).toBe(rb.sweep);
      if (t[0]!.angle < 20) expect(t[0]!.direction).toBe("straight");
      else expect(t[0]!.direction).not.toBe("straight");
      const exitArm = rb.arms.find((a) => a.onRoute === "exit" || a.onRoute === "entry-exit");
      if (exitArm?.name) expect(t[0]!.exitName).toBe(exitArm.name);
    }
    for (const t of track.turns) {
      expect(t.endS).toBeGreaterThan(t.s);
      if (!t.roundabout) expect(t.angle >= 25 || t.radius < 60).toBe(true);
      expect(track.turnAhead(t.s - 100)).not.toBeNull();
      expect(track.turnAhead((t.s + t.endS) / 2)).toBe(t);
    }
    expect(track.turnAhead(marks.bridgeDeckStart + 80)).toBeNull();
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
    for (const s of [sOf("Paseo San Francisco"), sOf("Calle San Juan"), marks.plazaAlta - 20, marks.puentePalmasStart + 100, marks.puentePalmasEnd - 100]) {
      const l = track.layoutAt(s);
      expect(l.flow.every((f) => f === 0), `s ${s}`).toBe(true);
      expect(l.kinds.every((k) => k === "pedestrian"), `s ${s}`).toBe(true);
      expect(l.carriageways.length).toBe(0);
    }
    const palmas = track.layoutAt((marks.puentePalmasStart + marks.puentePalmasEnd) / 2);
    expect(palmas.offsets.length).toBe(3);
    expect(palmas.right - palmas.left).toBeLessThanOrEqual(7.1);
  });

  it("two-way and one-way rules", () => {
    const base = city.sections.find((x) => x.name === "Avenida de Europa")!;
    expect(sectionLayout(base).ids).toEqual(["opp-1", "own-1", "walk-R"]);
    expect(sectionLayout({ ...base, oneway: true, lanes: 1, width: 3 }).ids).toEqual(["walk-L", "own-1", "walk-R"]);
    expect(sectionLayout({ ...base, oneway: true, lanes: 2, width: 6 }).ids).toEqual(["own-2", "own-1", "walk-R"]);
    expect(sectionLayout({ ...base, lanes: 4, width: 13 }).ids).toEqual(["opp-2", "opp-1", "own-2", "own-1"]);
    expect(sectionLayout({ ...base, lanes: 3, width: 9.75 }).ids).toEqual(["opp-1", "own-2", "own-1"]);
    const narrowPed = sectionLayout({ ...base, pedestrian: true, lanes: 0, clearance: 3.8, facadeWidth: 4.4, width: 3 });
    expect(narrowPed.ids).toEqual(["ped-1", "ped-2"]);
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
