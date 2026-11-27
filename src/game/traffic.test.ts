import { describe, expect, it } from "vitest";
import { OBSTACLE_DEFS, POWERUPS, type GameEvent } from "../contracts";
import { layoutAt } from "./lanes";
import { Run, HORN_TIME } from "./run";
import { BRAKE_DISTANCE, footprint, meetingPoint, obstacleCentre, obstacleRate, type ObstacleSpawn } from "./spawns";
import { TrackGenerator, lightFor } from "./track";
import { OBSTACLE_VIEW, collides, footprintOf, lateralOverlap, lifetime } from "./traffic";
import { LAP_LENGTH, RUNNER_HALF_DEPTH, TICK, difficultyAt, reactionWindow, speedAt, zoneAt } from "./tuning";
import { useRealCourse } from "./test-course";

useRealCourse();

const car = (over: Partial<ObstacleSpawn>): ObstacleSpawn => ({
  id: 1, kind: "coche", lane: 2, x: 2.6, d: 100, k: -0.4, seed: 1, flipped: false, ...over,
});

describe("traffic model", () => {
  it("same-direction cars drive away from the runner, slower than it; oncoming ones come at it", () => {
    const same = car({});
    expect(obstacleRate(same, 50)).toBeCloseTo(0.4, 6);
    expect(obstacleCentre(same, 100)).toBeCloseTo(100, 9);
    expect(obstacleCentre(same, 50)).toBeCloseTo(80, 9); // 20 m behind its meeting point, 30 m ahead of the runner
    const onc = car({ k: 0.55, lane: 0, x: -2.6 });
    expect(obstacleRate(onc, 50)).toBeCloseTo(-0.55, 6);
    // Oncoming vehicles drive at 8-14 m/s whatever the runner's speed.
    // Footprints: longer than the car for slow same-direction traffic, shorter for oncoming.
    const [a, b] = footprint(same, 4.3, RUNNER_HALF_DEPTH);
    expect(b - a).toBeGreaterThan(4.3);
    const [c, d] = footprint(onc, 4.3, RUNNER_HALF_DEPTH);
    expect(d - c).toBeLessThan(4.3);
  });

  it("a vehicle brakes smoothly to a halt at its stop and stays there", () => {
    const v = car({ d0: 100, stop: 150 });
    v.d = meetingPoint(v);
    let last = -Infinity;
    let lastRate = 0.4;
    for (let p = 0; p < 400; p += 0.25) {
      const c = obstacleCentre(v, p);
      expect(c).toBeGreaterThanOrEqual(last - 1e-9);
      expect(c).toBeLessThanOrEqual(150 + 1e-9);
      const rate = obstacleRate(v, p);
      expect(Math.abs(rate - lastRate)).toBeLessThan(0.05); // no jolts
      last = c;
      lastRate = rate;
    }
    expect(obstacleCentre(v, 400)).toBe(150);
    expect(BRAKE_DISTANCE).toBeGreaterThan(4);
  });

  it("most vehicles drive in the traffic zones; none in the pedestrian streets; queues stop at lights", () => {
    let driving = 0;
    let parked = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const gen = new TrackGenerator(seed * 4421);
      gen.generateUntil(LAP_LENGTH * 2);
      for (const o of gen.obstacles) {
        const def = OBSTACLE_DEFS[o.kind];
        if (!def.vehicle || o.kind === "moto" || o.kind === "camion-rampa" || o.kind === "peaton") continue;
        const span = zoneAt(o.d);
        const flow = layoutAt(o.d).flow;
        if (flow.every((f) => f === 0)) {
          expect(o.k, `${span.zone.id}: ${o.kind} must not drive`).toBe(0);
          continue;
        }
        if (o.d > lightFor(span)) continue; // The finale: everything stands at the zone-end light.
        // Queued at a light: drove up and stopped (counted neither way).
        if (o.k !== 0 && o.stop !== undefined && Math.abs(o.d - o.stop) < 0.05) continue;
        if (o.k !== 0) driving++;
        else parked++;
        if (o.k < 0) {
          // 55-75% of the runner's speed, overtaken at 3-6 m/s.
          // (at lap-2 speeds the 3-6 m/s closing speed wins: up to 1 - 6/v)
          expect(o.k).toBeGreaterThanOrEqual(-Math.max(0.75, 1 - 6 / speedAt(o.d)) - 0.02);
          expect(o.k).toBeLessThanOrEqual(-0.55 + 1e-9);
          const closing = (1 + o.k) * speedAt(o.d);
          expect(closing).toBeGreaterThanOrEqual(2.99);
          expect(closing).toBeLessThanOrEqual(6.01 + 0.1 * speedAt(o.d));
          // Never past the zone-end light while it exists.
          expect(obstacleCentre(o, lifetime(o)[1]) + def.length / 2).toBeLessThanOrEqual(lightFor(span) + 1e-6);
        }
      }
    }
    expect(driving / (driving + parked)).toBeGreaterThan(0.5);
  });

  it("same-direction vehicles in a lane share one speed while on screen together (no overtaking)", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const gen = new TrackGenerator(seed * 733);
      gen.generateUntil(LAP_LENGTH);
      const same = gen.obstacles.filter((o) => o.k < 0 && o.kind !== "peaton");
      for (let i = 0; i < same.length; i++) {
        for (let j = i + 1; j < same.length; j++) {
          const a = same[i]!;
          const b = same[j]!;
          if (!lateralOverlap(a, b)) continue;
          expect(collides(a, b)).toBe(false);
          // Order along the lane never changes.
          const s0 = Math.sign(obstacleCentre(a, a.d - 300) - obstacleCentre(b, a.d - 300));
          const s1 = Math.sign(obstacleCentre(a, a.d + 60) - obstacleCentre(b, a.d + 60));
          expect(s0).toBe(s1);
        }
      }
    }
  });

  it("oncoming traffic is on screen long enough for its real closing speed", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const gen = new TrackGenerator(seed * 977);
      gen.generateUntil(LAP_LENGTH * 2);
      for (const o of gen.obstacles) {
        if (o.k <= 0) continue;
        const [front] = footprintOf(o);
        const v = speedAt(front);
        // Visible from the fog line (≈ 210 m in the densest fog, OBSTACLE_VIEW otherwise): the
        // gap closes at (1 + k) v.
        const visibleFrom = Math.min(OBSTACLE_VIEW, 200);
        const p0 = front - visibleFrom / (1 + o.k);
        const seconds = (front - p0) / v;
        expect(seconds).toBeGreaterThan(reactionWindow(difficultyAt(front)) + 1.2);
        expect(HORN_TIME).toBeGreaterThan(reactionWindow(difficultyAt(front)) + 0.5);
      }
    }
  });

  it("an oncoming car in your lane flashes and honks before it reaches you", () => {
    const events: GameEvent[] = [];
    const run = new Run({ seed: 3, powerupDuration: (k) => POWERUPS[k].baseDuration, baseMultiplier: () => 1, emit: (e) => events.push(e), fx: () => {} });
    run.begin();
    for (let i = 0; i < 1.6 / TICK; i++) run.tick(TICK);
    run.gen.obstacles.length = 0;
    const p = run.player.p;
    const x = run.player.x;
    run.gen.obstacles.push({ id: 99, kind: "coche", lane: run.player.lane, x, d: p + 60, k: 0.55, seed: 1, flipped: false });
    let hornAt = -1;
    for (let i = 0; i < 4 / TICK && run.phase === "running"; i++) {
      run.tick(TICK);
      if (hornAt < 0 && events.some((e) => e.type === "horn")) hornAt = run.player.p;
    }
    expect(hornAt).toBeGreaterThan(0);
    const front = footprintOf(run.gen.obstacles[0] ?? car({}))[0];
    expect((front - hornAt) / speedAt(hornAt)).toBeGreaterThan(HORN_TIME - 0.05);
  });
});
