import { describe, expect, it } from "vitest";
import { LANE_WIDTH, OBSTACLE_DEFS, POWERUPS, ZONES } from "../contracts";
import { Bot, HUMAN } from "./bot";
import { BoxSet } from "./collision";
import { BLEND_LENGTH, BLEND_RATE, BLEND_TIME, FOUR_LANES, MERGE_LENGTH, laneOffsetAt, layoutAt, merges, nearestLane, nextOffsetChange, type LaneLayout, type LayoutFn } from "./lanes";
import { createEvents, createPlayer, stepPlayer, type PlayerAction } from "./player";
import { Run } from "./run";
import { solve } from "./solver";
import { TrackGenerator } from "./track";
import { collides, flowAllows, lateralOverlap } from "./traffic";
import { TICK, speedAt, zoneStartDistance } from "./tuning";
import { setCourse } from "./course";
import { realCourse } from "./test-course";

const THREE: LaneLayout = { offsets: [-LANE_WIDTH, 0, LANE_WIDTH], flow: [-1, 1, 1] };
const four: LayoutFn = () => FOUR_LANES;
/** 3 lanes, then 4 lanes between 600 and 1400 m, then 3 again. */
const changing: LayoutFn = (d) => (d >= 600 && d < 1400 ? FOUR_LANES : THREE);

describe("lane layouts", () => {
  it("the engine layout: three lanes, Spanish traffic (oncoming on the left), none in pedestrian zones", () => {
    for (const [i, zone] of ZONES.entries()) {
      const l = layoutAt(zoneStartDistance(i, 1) + 10);
      expect(l.offsets).toEqual([-LANE_WIDTH, 0, LANE_WIDTH]);
      if (zone.id === "casco-antiguo" || zone.id === "alcazaba-palmas") expect(l.flow).toEqual([0, 0, 0]);
      else {
        // Same-direction traffic in the right-hand lane, oncoming never right of it.
        expect(l.flow[2]).toBe(1);
        const firstSame = l.flow.indexOf(1);
        expect(l.flow.slice(firstSame).every((f) => f === 1)).toBe(true);
      }
    }
  });

  it("nearest lane prefers the right on ties and finds layout changes", () => {
    expect(nearestLane(FOUR_LANES, 0)).toBe(2);
    expect(nearestLane(FOUR_LANES, -2.6)).toBe(1);
    expect(nextOffsetChange(changing, 500, 700)).toBeCloseTo(600, 1);
    expect(nextOffsetChange(changing, 700, 1000)).toBeNull();
  });

  it("the runner changes lanes across four lanes and stops at the edges", () => {
    const world = new BoxSet([], null, 26, four);
    const s = createPlayer(0, undefined, FOUR_LANES);
    expect(s.x).toBeCloseTo(1.3, 6);
    const ev = createEvents();
    const press = (a: PlayerAction | null, seconds: number): void => {
      for (let i = 0; i < Math.round(seconds / TICK); i++) {
        s.speed = 12;
        stepPlayer(s, a && i === 0 ? [a] : [], TICK, world, ev);
      }
    };
    press("left", 0.3);
    press("left", 0.3);
    press("left", 0.3);
    expect(s.lane).toBe(0);
    expect(s.x).toBeCloseTo(-3.9, 6);
    press("right", 0.3);
    press("right", 0.3);
    press("right", 0.3);
    press("right", 0.3);
    expect(s.lane).toBe(3);
    expect(s.x).toBeCloseTo(3.9, 6);
  });

  it("when the street changes from 3 to 4 to 3 lanes the runner eases to the nearest lane", () => {
    const world = new BoxSet([], null, 26, changing);
    const s = createPlayer(590, 1, THREE);
    const ev = createEvents();
    const xs: number[] = [];
    let remaps = 0;
    for (let i = 0; i < Math.round(80 / TICK); i++) {
      s.speed = 12;
      const before = s.p;
      stepPlayer(s, [], TICK, world, ev);
      if (ev.laneRemapped) remaps++;
      if (before < 600 && s.p >= 600 + 1) xs.push(s.x);
      if (s.p > 1430) break;
    }
    expect(remaps).toBeGreaterThanOrEqual(2);
    // Ended in the 3-lane layout on a lane centre, after easing (no teleport).
    expect([-LANE_WIDTH, 0, LANE_WIDTH].some((x) => Math.abs(x - s.x) < 1e-6)).toBe(true);
    expect(s.laneT).toBe(1);
  });

  it("generator, solver and bots work on a four-lane road (2 each way)", () => {
    for (const seed of [5, 9, 23]) {
      const gen = new TrackGenerator(seed * 131, 0, { layout: four });
      gen.generateUntil(1600);
      expect(gen.obstacles.length).toBeGreaterThan(30);
      // Lanes come from the layout, traffic drives the right way and never through anything.
      for (const o of gen.obstacles) {
        if (o.k === 0) continue;
        expect(FOUR_LANES.offsets).toContain(o.x);
        expect(flowAllows(o, four, FOUR_LANES)).toBe(true);
        if (o.k < 0) expect(o.x).toBeGreaterThan(0);
        else if (o.kind !== "moto") expect(o.x).toBeLessThan(0);
      }
      for (let i = 0; i < gen.obstacles.length; i++) {
        for (let j = i + 1; j < gen.obstacles.length; j++) {
          const a = gen.obstacles[i]!;
          const b = gen.obstacles[j]!;
          if (b.d - a.d > 500) break;
          if (a.k === 0 && b.k === 0) continue;
          if (lateralOverlap(a, b)) expect(collides(a, b)).toBe(false);
        }
      }
      expect(gen.obstacles.some((o) => o.k < 0)).toBe(true);
      const r = solve(gen.obstacles, createPlayer(1, undefined, FOUR_LANES), 1500, { decision: 0.25, dt: TICK, maxFrontier: 200, layout: four });
      expect(r.ok, `seed ${seed}: stuck at ${r.reached.toFixed(0)}`).toBe(true);
    }
  }, 120_000);

  it("a run with the layout changing 3 → 4 → 3 lanes: the autopilot and a human-like bot get through", () => {
    for (const human of [false, true]) {
      const run = new Run({
        seed: 77, powerupDuration: (k) => POWERUPS[k].baseDuration, baseMultiplier: () => 1, emit: () => {}, fx: () => {},
        layout: changing,
      });
      run.begin();
      run.invincible = false;
      const bot = human ? new Bot({ ...HUMAN, seed: 3 }) : new Bot();
      let laneCounts = new Set<number>();
      for (let i = 0; i < 140 / TICK && run.phase !== "over" && run.player.p < 1500; i++) {
        bot.update(run);
        run.tick(TICK);
        laneCounts.add(changing(run.player.p).offsets.length);
      }
      expect(laneCounts.has(4)).toBe(true);
      // Nothing generated straddles a layout change.
      for (const o of run.gen.obstacles) {
        if (OBSTACLE_DEFS[o.kind].lanes === 3) continue; // Full width: centred on the road.
        const here = changing(o.d);
        expect(here.offsets).toContain(o.x);
      }
      if (!human) expect(run.player.p).toBeGreaterThan(1450);
      laneCounts = new Set();
    }
  }, 120_000);

  it("on the real lap lanes are continuous: no input, the runner only moves inside a blend or a taper", () => {
    const course = realCourse();
    setCourse(course);
    try {
      const track = course.track;
      const world = new BoxSet([]);
      const ms = merges(track);
      const L = track.lapLength;
      const near = (s: number): boolean => {
        const w = ((s % L) + L) % L;
        // (the engine's blends last BLEND_TIME at the planned speed: ≤ 22 m/s on lap 1)
        const half = Math.max(BLEND_LENGTH / 2, (BLEND_TIME * 22) / 2, (1.5 * 1.5 * 22) / (2 * BLEND_RATE)) + 0.5;
        if (track.transitions.some((t) => Math.abs(w - t.s) < half || Math.abs(w - t.s - L) < half)) return true;
        return ms.some((m) => w > m.s0 - 0.5 && w < m.s1 + 0.5);
      };
      const failures: string[] = [];
      const start = layoutAt(0);
      for (let lane0 = 0; lane0 < start.offsets.length; lane0++) {
        const s = createPlayer(0.5, lane0, start);
        const ev = createEvents();
        while (s.p < L + 50) {
          s.speed = 20;
          const x0 = s.x;
          stepPlayer(s, [], TICK, world, ev);
          const lay = layoutAt(s.p);
          if (s.lane < 0 || s.lane >= lay.offsets.length) failures.push(`lane ${lane0}: index ${s.lane} out of range at ${s.p.toFixed(1)}`);
          const v = Math.abs(s.x - x0) / TICK;
          if (v > 3.2) failures.push(`lane ${lane0}: ${v.toFixed(2)} m/s sideways at ${s.p.toFixed(1)}`);
          if (v > 1e-6 && !near(s.p)) failures.push(`lane ${lane0}: moved at ${s.p.toFixed(1)} outside blends and tapers`);
          if (failures.length > 5) break;
        }
      }
      expect(failures).toEqual([]);
    } finally {
      setCourse(null);
    }
  }, 120_000);

  it("lane endings are merges: a runner who stays in an ending lane is carried smoothly onto its target", () => {
    const course = realCourse();
    setCourse(course);
    try {
      const track = course.track;
      const world = new BoxSet([]);
      const L = track.lapLength;
      const ms = merges(track);
      expect(ms.length).toBeGreaterThan(10);
      // Puente Real: the two oncoming lanes taper in sequence into own-2.
      const pr = ms.filter((m) => Math.abs(m.end - 1010) < 2);
      const ids = track.stretches[pr[0]!.fromStretch]!.layout.ids;
      const opp2 = pr.find((m) => ids[m.lane] === "opp-2")!;
      const opp1 = pr.find((m) => ids[m.lane] === "opp-1")!;
      expect(ids[opp2.into]).toBe("opp-1");
      expect(ids[opp1.into]).toBe("own-2");
      expect(opp2.s1).toBeCloseTo(opp1.s0, 6);
      expect(opp1.s1 - opp1.s0).toBeCloseTo(MERGE_LENGTH, 6);
      expect(opp1.end - opp2.s0).toBeCloseTo(2 * MERGE_LENGTH, 6);
      const report: string[] = [];
      for (const lap of [0, 1]) {
        for (const m of ms) {
          const st = track.stretches[m.fromStretch]!;
          const lay = st.layout;
          // Never into oncoming traffic, except an oncoming lane merging into its inner neighbour first.
          if (lay.flow[m.into] === -1) expect(lay.flow[m.lane]).toBe(-1);
          const from = lap * L + Math.max(st.fromS + 8, m.s0 - 30);
          const s = createPlayer(from, m.lane, lay);
          const ev = createEvents();
          let vmax = 0;
          let x0 = s.x;
          while (s.p < lap * L + m.end + 20) {
            s.speed = speedAt(s.p);
            stepPlayer(s, [], TICK, world, ev);
            const step = Math.abs(s.x - x0);
            vmax = Math.max(vmax, step / TICK);
            x0 = s.x;
          }
          // Ended exactly on (the continuation of) the target lane, which is not an oncoming one.
          const after = layoutAt(s.p);
          expect(s.x, `lane ${lay.ids[m.lane]} ending at ${m.end.toFixed(0)} lap ${lap} now ${(after as { ids?: readonly string[] }).ids?.[s.lane]} at ${s.p.toFixed(1)}`).toBeCloseTo(laneOffsetAt(track, s.lane, s.p, speedAt), 6);
          expect(after.flow[s.lane]).not.toBe(-1);
          expect(vmax, `lap ${lap + 1}: lane ${lay.ids[m.lane]} ending at ${m.end.toFixed(0)}`).toBeLessThan(2.7);
          // Carried earlier on faster laps, but still inside the lane's own width where the drawn taper starts.
          const atDrawn = laneOffsetAt(track, m.lane, lap * L + m.s0 + (m.s0 < st.fromS ? 0 : 0), speedAt);
          if (m.s0 >= st.fromS && m.s1 > m.s0) expect(Math.abs(atDrawn - lay.offsets[m.lane]!)).toBeLessThan(lay.widths[m.lane]! / 2 - 0.3);
          report.push(`${lay.ids[m.lane]}@${m.end.toFixed(0)}: ${vmax.toFixed(2)}`);
        }
      }
      void report;
    } finally {
      setCourse(null);
    }
  }, 120_000);

  it("lane input is never blocked or re-timed by a layout change (Plaza de España, the rings)", () => {
    const course = realCourse();
    setCourse(course);
    try {
      const track = course.track;
      const world = new BoxSet([]);
      const slow: string[] = [];
      for (const t of track.transitions) {
        const lay = layoutAt(t.s - 5);
        for (let lane = 0; lane < lay.offsets.length; lane++) {
          for (const pressAt of [-2, 0.6, 3]) {
            const s = createPlayer(t.s - 6, lane, lay);
            const ev = createEvents();
            let pressed = false;
            let took = -1;
            let ticks = 0;
            while (s.p < t.s + 30) {
              s.speed = 18;
              const press = !pressed && s.p >= t.s + pressAt;
              const n = layoutAt(s.p).offsets.length;
              stepPlayer(s, press ? [s.lane > 0 ? "left" : "right"] : [], TICK, world, ev);
              if (press) {
                pressed = true;
                // The press acts at once: a lane change starts or the edge bumps (no queueing).
                if (!ev.laneChanged && !ev.edgeBump) slow.push(`s ${t.s.toFixed(0)} lane ${lane}/${n}: press at ${pressAt} queued`);
                if (!ev.laneChanged) break;
              }
              if (pressed) {
                ticks++;
                if (s.laneT >= 1) {
                  took = ticks * TICK;
                  break;
                }
              }
            }
            if (took > 0.36) slow.push(`s ${t.s.toFixed(0)} lane ${lane}: change took ${took.toFixed(2)} s`);
          }
        }
      }
      expect(slow).toEqual([]);
    } finally {
      setCourse(null);
    }
  }, 120_000);
});
