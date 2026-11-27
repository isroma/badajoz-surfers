import { describe, expect, it } from "vitest";
import { OBSTACLE_DEFS, ZONES } from "../contracts";
import { createPlayer } from "./player";
import { solve } from "./solver";
import type { ObstacleSpawn } from "./spawns";
import { EMPTY_START, TrackGenerator, ZONE_MARGIN, lightFor, spawnInterval as interval } from "./track";
import { collides, lateralOverlap } from "./traffic";
import { layoutAt } from "./lanes";
import { LAP_LENGTH, zoneAt, zoneStartDistance } from "./tuning";
import { useRealCourse } from "./test-course";

/** Node global (the project has no @types/node). */
declare const process: { env: Record<string, string | undefined> };

useRealCourse();

function check(seed: number, from: number, length: number): { gen: TrackGenerator; ok: boolean; reached: number } {
  const gen = new TrackGenerator(seed, from);
  gen.generateUntil(from + length + 200);
  const start = createPlayer(from + 1);
  // Inputs only every 0.25 s (a human pace, not frame-perfect play) with the game's 120 Hz physics.
  const result = solve(gen.obstacles, start, from + length, { decision: 0.25, dt: 1 / 120, maxFrontier: 200 });
  return { gen, ...result };
}

describe("track generator", () => {
  it("is deterministic for a seed", () => {
    const a = new TrackGenerator(42);
    const b = new TrackGenerator(42);
    a.generateUntil(1500);
    b.generateUntil(1500);
    expect(a.obstacles).toEqual(b.obstacles);
    expect(a.pickups).toEqual(b.pickups);
  });

  it("keeps the start of a fresh run empty and zone edges clear", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const gen = new TrackGenerator(seed);
      gen.generateUntil(LAP_LENGTH + 500);
      for (const o of gen.obstacles) {
        const [a, b] = interval(o);
        expect(a).toBeGreaterThanOrEqual(EMPTY_START - 0.01);
        const span = zoneAt(o.d);
        expect(a).toBeGreaterThanOrEqual(span.start + ZONE_MARGIN - 0.01);
        expect(b).toBeLessThanOrEqual(span.end - ZONE_MARGIN + 0.01);
      }
      for (const p of gen.pickups) {
        if (p.kind === "bellota") continue;
        const span = zoneAt(p.d);
        expect(p.d).toBeGreaterThan(span.start + ZONE_MARGIN - 3);
        expect(p.d).toBeLessThan(span.end - ZONE_MARGIN + 3);
      }
    }
  });

  it("never overlaps obstacles in the same lane, and traffic never drives through anything", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const gen = new TrackGenerator(seed * 7919);
      gen.generateUntil(LAP_LENGTH * 2);
      const list = gen.obstacles;
      for (let i = 0; i < list.length; i++) {
        const a = list[i]!;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j]!;
          if (b.d - a.d > 500) break;
          if (!lateralOverlap(a, b)) continue;
          if (a.k === 0 && b.k === 0) {
            if (b.d - a.d > 30) continue;
            const [a0, a1] = interval(a);
            const [b0, b1] = interval(b);
            const overlap = Math.min(a1, b1) - Math.max(a0, b0);
            // Scaffolds may sit back to back; nothing may interpenetrate.
            expect(overlap, `seed ${seed}: ${a.kind}@${a.d.toFixed(1)} vs ${b.kind}@${b.d.toFixed(1)}`).toBeLessThanOrEqual(0.01);
          } else {
            expect(collides(a, b), `seed ${seed}: ${a.kind}@${a.d.toFixed(1)} k${a.k.toFixed(2)} vs ${b.kind}@${b.d.toFixed(1)} k${b.k.toFixed(2)}`).toBe(false);
          }
        }
      }
    }
  });

  it("spaces power-ups 430-650 m apart and a whole BADAJOZ about once per lap", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const gen = new TrackGenerator(seed);
      gen.generateUntil(LAP_LENGTH);
      const powerups = gen.pickups.filter((p) => p.kind !== "bellota" && p.kind !== "letra");
      for (let i = 1; i < powerups.length; i++) {
        const gap = powerups[i]!.d - powerups[i - 1]!.d;
        expect(gap).toBeGreaterThan(400);
      }
      expect(powerups.length).toBeGreaterThan(LAP_LENGTH / 900);
      const letters = gen.pickups.filter((p) => p.kind === "letra");
      expect(letters.length).toBeGreaterThanOrEqual(6);
      expect(letters.length).toBeLessThanOrEqual(10);
      for (let i = 1; i < letters.length; i++) expect(letters[i]!.d - letters[i - 1]!.d).toBeGreaterThan(900);
    }
  });

  it("the first 120 m of a fresh run are gentle", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const gen = new TrackGenerator(seed);
      gen.generateUntil(400);
      const early = gen.obstacles.filter((o) => o.d < 120);
      expect(early.every((o) => o.k === 0 || o.kind === "peaton")).toBe(true);
      expect(early.length).toBeLessThanOrEqual(5);
    }
  });

  it("the solver detects an impossible wall", () => {
    const offsets = layoutAt(60).offsets;
    const wall: ObstacleSpawn[] = offsets.map((x, lane) => ({
      id: lane + 1, kind: "bus", lane, x, d: 60, k: 0, seed: 0, flipped: false,
    }));
    expect(solve(wall, createPlayer(0), 120, { decision: 0.1, dt: 1 / 60, maxFrontier: 160 }).ok).toBe(false);
    const passable = wall.slice(0, 2);
    expect(solve(passable, createPlayer(0), 120, { decision: 0.1, dt: 1 / 60, maxFrontier: 160 }).ok).toBe(true);
  });

  it("is always solvable (fuzz across seeds, zones and laps)", () => {
    const failures: string[] = [];
    let runs = 0;
    // 16 seeds on CI (hosted runners are several times slower); all 48 locally.
    const seeds = process.env["CI"] ? 16 : 48;
    for (let seed = 1; seed <= seeds; seed++) {
      const lap = 1 + (seed % 4);
      const zoneIndex = seed % ZONES.length;
      const from = seed <= 4 ? 0 : zoneStartDistance(zoneIndex, lap);
      const zone = ZONES[zoneIndex]!;
      const length = seed <= 4 ? 900 : zone.length;
      const r = check(seed * 104729, from, length);
      runs++;
      if (!r.ok) {
        const near = r.gen.placed.find((p) => p.end > r.reached - 5);
        failures.push(`seed ${seed} lap ${lap} ${zone.id}: stuck at ${r.reached.toFixed(1)} (${near?.name ?? "?"})`);
      }
    }
    expect(failures).toEqual([]);
    expect(runs).toBeGreaterThan(0);
  }, 120_000);

  it("opens lap 1 with the first obstacle around 45-60 m", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const gen = new TrackGenerator(seed);
      gen.generateUntil(300);
      const first = Math.min(...gen.obstacles.map((o) => interval(o)[0]));
      expect(first).toBeGreaterThanOrEqual(45);
      expect(first).toBeLessThanOrEqual(66);
    }
  });

  it("every zone ends with a finale and big-vehicle zones (nearly always) get a roof route", () => {
    let roofZones = 0;
    let roofs = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const gen = new TrackGenerator(seed * 13);
      gen.generateUntil(LAP_LENGTH * 2);
      for (let serial = 0; serial < ZONES.length * 2 - 1; serial++) {
        const lap = Math.floor(serial / ZONES.length) + 1;
        const index = serial % ZONES.length;
        const start = zoneStartDistance(index, lap);
        const zone = ZONES[index]!;
        const inZone = gen.placed.filter((p) => p.start >= start && p.start < start + zone.length);
        // A stork landing reserved at the end of the zone may take the finale's place.
        const end = start + zone.length;
        const light = lightFor(zoneAt(start + 1));
        const landing = gen.flights.some((f) => f.clearTo > light - 60 && f.clearFrom < end);
        if (!landing) expect(inZone.some((p) => p.name === "finale"), `seed ${seed} ${zone.id} lap ${lap}: finale`).toBe(true);
        if (zone.id === "valdepasillas" || zone.id === "margen-derecha") {
          roofZones++;
          if (inZone.some((p) => p.name === "rampRoof")) roofs++;
        }
      }
    }
    expect(roofs / roofZones).toBeGreaterThan(0.8);
  });

  it("the tutorial is a spaced, solvable script: dodge, jump, roll, jump onto a roof", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const gen = new TrackGenerator(seed, 0, { tutorial: true });
      gen.generateUntil(600);
      const steps = gen.tutorial;
      expect(steps.map((t) => t.action).slice(1)).toEqual(["jump", "roll", "jump"]);
      expect(["left", "right"]).toContain(steps[0]!.action);
      for (let i = 1; i < steps.length; i++) {
        // At least 2 s apart at the start speed (11 m/s).
        expect(steps[i]!.front - steps[i - 1]!.end).toBeGreaterThanOrEqual(22);
      }
      expect(gen.tutorialEnd).toBeLessThan(230);
      // Nothing generated inside the script.
      const scripted = gen.obstacles.filter((o) => o.d < gen.tutorialEnd);
      expect(scripted.length).toBe(4);
      expect(solve(gen.obstacles, createPlayer(0), 500, { decision: 0.25, dt: 1 / 120, maxFrontier: 200 }).ok).toBe(true);
    }
  });

  it("storks: rarer than other power-ups, never early, at normal height, with a clear landing", () => {
    let storks = 0;
    let others = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const gen = new TrackGenerator(seed * 31, 0, { flightDuration: 9 });
      gen.generateUntil(LAP_LENGTH * 2);
      for (const p of gen.pickups) {
        if (p.kind === "ciguena") {
          storks++;
          expect(p.d).toBeGreaterThanOrEqual(400);
          expect(p.y).toBeLessThan(1.5);
          // Not under anything overhead.
          const over = gen.obstacles.some((o) => OBSTACLE_DEFS[o.kind].yMin > 0 && Math.abs(o.d - p.d) < 3);
          expect(over).toBe(false);
        } else if (p.kind !== "bellota" && p.kind !== "letra") others++;
      }
      for (const f of gen.flights) {
        const blocked = gen.obstacles.filter((o) => {
          const [a, b] = interval(o);
          return b > f.clearFrom && a < f.clearTo;
        });
        expect(blocked, `seed ${seed}: landing ${f.clearFrom.toFixed(0)}-${f.clearTo.toFixed(0)}`).toEqual([]);
        // No other power-up or letter during the flight or its landing.
        const rewards = gen.pickups.filter((p) => p.kind !== "bellota" && p.kind !== "ciguena" && p.d > f.start && p.d < f.clearTo);
        expect(rewards).toEqual([]);
      }
    }
    expect(storks).toBeGreaterThan(5);
    const share = storks / (storks + others);
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeLessThan(0.28);
  });

  it("never leaves a long empty stretch: something (an obstacle or bellotas) at least every 70 m", () => {
    const gaps: string[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const gen = new TrackGenerator(seed * 97);
      gen.generateUntil(LAP_LENGTH * 3);
      const iv: [number, number][] = [];
      for (const o of gen.obstacles) iv.push(interval(o));
      for (const p of gen.pickups) iv.push([p.d, p.d]);
      iv.sort((a, b) => a[0] - b[0]);
      let reach = -Infinity;
      for (const [a, b] of iv) {
        if (reach > EMPTY_START + 10 && a - reach > 70) gaps.push(`seed ${seed}: ${reach.toFixed(0)}-${a.toFixed(0)}`);
        reach = Math.max(reach, b);
      }
    }
    expect(gaps).toEqual([]);
  }, 120_000);
});
