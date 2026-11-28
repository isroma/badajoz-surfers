/**
 * The obvious-way invariant over whole generated laps, and calm in tight bends and rings.
 */
import { describe, expect, it } from "vitest";
import { OBSTACLE_DEFS } from "../contracts";
import { PACE_MIN, tableAt } from "./course";
import { PLAIN_JUMP, PLAIN_ROLL, narrowPoints, unfairPoints } from "./fairness";
import { layoutAt, merges, nearestLane } from "./lanes";
import { sweep, footprintOf } from "./traffic";
import { CALM_CURVATURE, TrackGenerator } from "./track";
import { WELCOME_GAP, WELCOME_UNTIL, paceAt, speedAt } from "./tuning";
import { useRealCourse } from "./test-course";

const course = useRealCourse();
const track = course.track;
const L = course.lapLength;

describe("an obvious way through, everywhere", () => {
  it("30 seeds × laps 1-3: from every lane with a free run-up, a plainly passable lane is reachable in time (0.5 s to spare)", () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const gen = new TrackGenerator(seed * 7717);
      gen.generateUntil(3 * L + 300);
      for (const v of unfairPoints(gen.obstacles, 60, 3 * L, { layout: layoutAt, track, speed: speedAt }, 5)) {
        bad.push(`seed ${seed}: lap ${Math.floor(v.d / L) + 1} s ${(v.d % L).toFixed(0)} lane ${v.lane}`);
      }
      if (bad.length > 10) break;
    }
    expect(bad).toEqual([]);
  }, 300_000);

  it("the first kilometre welcomes: no jump or roll needed in a road lane, no oncoming traffic, two lanes open, rows 2.2 s apart", () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const gen = new TrackGenerator(seed * 7717);
      gen.generateUntil(WELCOME_UNTIL + 400);
      const early = gen.obstacles.filter((o) => footprintOf(o)[0] < WELCOME_UNTIL);
      for (const o of early) {
        const lay = layoutAt(o.d);
        const road = (lay.kinds?.[nearestLane(lay, o.x)] ?? "road") === "road";
        if (o.k > 0) bad.push(`seed ${seed}: oncoming ${o.kind} at ${o.d.toFixed(0)}`);
        if (OBSTACLE_DEFS[o.kind].lanes === 3) bad.push(`seed ${seed}: ${o.kind} across the street at ${o.d.toFixed(0)}`);
        if (road && (PLAIN_JUMP.has(o.kind) || PLAIN_ROLL.has(o.kind))) bad.push(`seed ${seed}: ${o.kind} in a road lane at ${o.d.toFixed(0)}`);
      }
      const spans = early.map((o) => footprintOf(o)).sort((x, y) => x[0] - y[0]);
      let reach = -Infinity;
      for (const [a, b] of spans) {
        const gap = a - reach;
        if (gap > 2 && gap < WELCOME_GAP * speedAt(a) - 1e-6) bad.push(`seed ${seed}: rows ${gap.toFixed(1)} m apart at ${a.toFixed(0)}`);
        reach = Math.max(reach, b);
      }
      for (const d of narrowPoints(early, 60, WELCOME_UNTIL, { layout: layoutAt, track, speed: speedAt }, 3)) bad.push(`seed ${seed}: one lane open at ${d.toFixed(0)}`);
      if (bad.length > 10) break;
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it("a wall of parked cars across every lane is caught (the check itself)", () => {
    const at = 300;
    const lay = layoutAt(at);
    const wall = lay.offsets.map((x, i) => ({ kind: "coche" as const, lane: i, x, d: at, k: 0, seed: 0, flipped: false }));
    expect(unfairPoints(wall, at - 80, at + 60, { layout: layoutAt, track, speed: speedAt }).length).toBeGreaterThan(0);
    // The same row with the middle lane left open is fine (reachable from every lane in time).
    expect(unfairPoints(wall.filter((_, i) => i !== 2), at - 80, at + 60, { layout: layoutAt, track, speed: speedAt })).toEqual([]);
    // A street-wide barrier is plainly jumpable.
    expect(unfairPoints([{ kind: "valla-larga", lane: 1, x: 0, span: 30, d: at, k: 0, seed: 0, flipped: false }], at - 80, at + 60, { layout: layoutAt, track, speed: speedAt })).toEqual([]);
  });

  it("calm in tight bends and rings: nothing to dodge there, only ring lanes' own short tapers in a ring, the pace eases", () => {
    const bends = course.bends();
    let min = 1;
    for (let s = 0; s < L; s += 1) min = Math.min(min, paceAt(s));
    expect(min).toBeGreaterThanOrEqual(PACE_MIN - 1e-6);
    for (const m of merges(track)) {
      // A taper inside a ring is only a ring lane's own short closing (sized by sideways speed),
      // never an approach lane's taper running on into the ring.
      for (const st of track.stretches) {
        if (st.section.roundabout === null || m.s1 <= st.fromS + 0.5 || m.s0 >= st.toS) continue;
        expect(track.stretches[m.fromStretch], `taper ${m.s0.toFixed(0)}-${m.s1.toFixed(0)} in the ring ${st.fromS.toFixed(0)}`).toBe(st);
        expect(m.s1 - m.s0).toBeLessThan(50);
      }
    }
    const rings = track.stretches.filter((st) => st.section.roundabout !== null);
    let circulating = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const gen = new TrackGenerator(seed * 31);
      gen.generateUntil(2 * L);
      for (const o of gen.obstacles) {
        const [a, b] = footprintOf(o);
        for (let d = Math.floor(a); d <= b; d++) expect(tableAt(bends.curvature, L, d), `${o.kind} at ${(d % L).toFixed(0)}`).toBeLessThanOrEqual(CALM_CURVATURE);
        if (o.k === 0 || !OBSTACLE_DEFS[o.kind].vehicle) continue;
        // On a ring traffic only circulates the ring's way, in its own lane.
        const [s0, s1] = sweep(o);
        for (const st of rings) {
          for (const base of [0, L]) {
            if (s1 > base + st.fromS && s0 < base + st.toS) {
              expect(o.k, `${o.kind} on the ring at ${st.fromS.toFixed(0)}`).toBeLessThan(0);
              circulating++;
            }
          }
        }
      }
    }
    // Traffic does circulate on the rings.
    expect(circulating).toBeGreaterThan(8);
  }, 120_000);
});
