import { describe, expect, it } from "vitest";
import { LANE_WIDTH, OBSTACLE_DEFS, POWERUPS, ZONES } from "../contracts";
import { Bot, HUMAN } from "./bot";
import { BoxSet } from "./collision";
import { FOUR_LANES, layoutAt, nearestLane, nextOffsetChange, type LaneLayout, type LayoutFn } from "./lanes";
import { createEvents, createPlayer, stepPlayer, type PlayerAction } from "./player";
import { Run } from "./run";
import { solve } from "./solver";
import { TrackGenerator } from "./track";
import { collides, flowAllows, lateralOverlap } from "./traffic";
import { TICK, zoneStartDistance } from "./tuning";

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
});
