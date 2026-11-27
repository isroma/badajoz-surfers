import { describe, expect, it } from "vitest";
import { OBSTACLE_DEFS, ZONES, type Lane } from "../contracts";
import { moverEffectiveHalf } from "./patterns";
import { createPlayer } from "./player";
import { solve } from "./solver";
import type { ObstacleSpawn } from "./spawns";
import { EMPTY_START, TrackGenerator, ZONE_MARGIN } from "./track";
import { LAP_LENGTH, zoneAt, zoneStartDistance } from "./tuning";

function interval(o: ObstacleSpawn): [number, number] {
  const half = o.k > 0 ? moverEffectiveHalf(o.kind, o.k) : OBSTACLE_DEFS[o.kind].length / 2;
  return [o.d - half, o.d + half];
}

function lanesOf(o: ObstacleSpawn): Lane[] {
  return OBSTACLE_DEFS[o.kind].lanes === 3 ? [-1, 0, 1] : [o.lane];
}

function check(seed: number, from: number, length: number): { gen: TrackGenerator; ok: boolean; reached: number } {
  const gen = new TrackGenerator(seed, from);
  gen.generateUntil(from + length + 200);
  const start = createPlayer(from + 1, 0);
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

  it("never overlaps obstacles in the same lane", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const gen = new TrackGenerator(seed * 7919);
      gen.generateUntil(LAP_LENGTH * 2);
      const list = gen.obstacles;
      for (let i = 0; i < list.length; i++) {
        const a = list[i]!;
        const [a0, a1] = interval(a);
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j]!;
          if (b.d - a.d > 30) break;
          const [b0, b1] = interval(b);
          const shared = lanesOf(a).some((l) => lanesOf(b).includes(l));
          if (!shared) continue;
          const overlap = Math.min(a1, b1) - Math.max(a0, b0);
          // Scaffolds may sit back to back; nothing may interpenetrate.
          expect(overlap, `seed ${seed}: ${a.kind}@${a.d.toFixed(1)} vs ${b.kind}@${b.d.toFixed(1)}`).toBeLessThanOrEqual(0.01);
        }
      }
    }
  });

  it("spaces power-ups 250-400 m apart and spawns letters regularly", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const gen = new TrackGenerator(seed);
      gen.generateUntil(LAP_LENGTH);
      const powerups = gen.pickups.filter((p) => p.kind !== "bellota" && p.kind !== "letra");
      for (let i = 1; i < powerups.length; i++) {
        const gap = powerups[i]!.d - powerups[i - 1]!.d;
        expect(gap).toBeGreaterThan(200);
      }
      expect(powerups.length).toBeGreaterThan(LAP_LENGTH / 500);
      const letters = gen.pickups.filter((p) => p.kind === "letra");
      expect(letters.length).toBeGreaterThan(LAP_LENGTH / 300);
      for (let i = 1; i < letters.length; i++) expect(letters[i]!.d - letters[i - 1]!.d).toBeGreaterThan(100);
    }
  });

  it("the first 120 m of a fresh run are gentle", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const gen = new TrackGenerator(seed);
      gen.generateUntil(400);
      const early = gen.obstacles.filter((o) => o.d < 120);
      expect(early.every((o) => o.k === 0)).toBe(true);
      expect(early.length).toBeLessThanOrEqual(5);
    }
  });

  it("the solver detects an impossible wall", () => {
    const wall: ObstacleSpawn[] = ([-1, 0, 1] as const).map((lane, i) => ({
      id: i + 1, kind: "bus", lane, d: 60, k: 0, seed: 0, flipped: false,
    }));
    expect(solve(wall, createPlayer(0), 120, { decision: 0.1, dt: 1 / 60, maxFrontier: 160 }).ok).toBe(false);
    const passable = wall.slice(0, 2);
    expect(solve(passable, createPlayer(0), 120, { decision: 0.1, dt: 1 / 60, maxFrontier: 160 }).ok).toBe(true);
  });

  it("is always solvable (fuzz across seeds, zones and laps)", () => {
    const failures: string[] = [];
    let runs = 0;
    for (let seed = 1; seed <= 48; seed++) {
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
});
