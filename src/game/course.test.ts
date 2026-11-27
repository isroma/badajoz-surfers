import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { OBSTACLE_DEFS, POWERUPS, type GameEvent } from "../contracts";
import { underArch } from "./course";
import { laneKind, laneWidth, layoutAt, sameOffsets } from "./lanes";
import { Bot } from "./bot";
import { Run } from "./run";
import { TrackSpace } from "./space";
import { footprintOf } from "./traffic";
import { TrackGenerator } from "./track";
import { LAP_LENGTH, TICK, speedAt, zoneAt } from "./tuning";
import { useRealCourse } from "./test-course";

const course = useRealCourse();

describe("the real course", () => {
  it("drives the lap length, zones and lanes", () => {
    expect(LAP_LENGTH).toBeCloseTo(course.lapLength, 6);
    expect(LAP_LENGTH).toBeGreaterThan(8000);
    expect(zoneAt(500).zone.id).toBe("puente-real");
    expect(zoneAt(1100).zone.id).toBe("valdepasillas");
    expect(zoneAt(4600).zone.id).toBe("casco-antiguo");
    expect(zoneAt(LAP_LENGTH + 500).lap).toBe(2);
    // Real zone lengths in the zone definitions handed to the shell.
    const z = zoneAt(1500);
    expect(z.zone.length).toBeCloseTo(z.end - z.start, 6);
    expect(layoutAt(600).offsets.length).toBe(5);
    expect(layoutAt(4700).offsets.length).toBe(2);
  });

  it("finds the real stop lines, bus stops, bars, trees and arches", () => {
    expect(course.stopLines.filter((l) => l.kind === "signal").length).toBeGreaterThanOrEqual(4);
    expect(course.stopLines.some((l) => l.kind === "giveway")).toBe(true);
    expect(course.busStops.length).toBeGreaterThan(5);
    expect(course.bars.length).toBeGreaterThan(5);
    expect(course.trees.length).toBeGreaterThan(200);
    // Arco del Peso (route through a building, s ≈ 4903–4916).
    expect(underArch(course, 4905, 4910)).toBe(true);
    expect(underArch(course, 2000, 2100)).toBe(false);
    expect(underArch(course, 4905 + LAP_LENGTH, 4910 + LAP_LENGTH)).toBe(true);
  });

  it("speed builds slowly over the 8.2 km lap: 15 m/s by 2 km, ~21 by 5 km, faster on lap 2", () => {
    expect(speedAt(0)).toBeCloseTo(11, 6);
    expect(speedAt(2000)).toBeCloseTo(15, 1);
    expect(speedAt(5000)).toBeGreaterThan(20);
    expect(speedAt(5000)).toBeLessThan(23);
    expect(speedAt(LAP_LENGTH + 100)).toBeGreaterThan(speedAt(LAP_LENGTH - 100));
  });

  it("generates street-appropriate obstacles: they fit their lanes, avoid trees, nothing tall under arches, nothing in transitions", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const gen = new TrackGenerator(seed * 811);
      gen.generateUntil(LAP_LENGTH * 2);
      for (const o of gen.obstacles) {
        const def = OBSTACLE_DEFS[o.kind];
        const [a, b] = footprintOf(o);
        const layout = layoutAt(o.d);
        // The layout is the same over the whole footprint (no straddling a street change).
        expect(sameOffsets(layoutAt(a), layout) && sameOffsets(layoutAt(b), layout), `seed ${seed}: ${o.kind}@${o.d.toFixed(0)}`).toBe(true);
        if (def.lanes === 3) continue;
        const kind = laneKind(layout, o.lane);
        expect(def.width).toBeLessThanOrEqual(laneWidth(layout, o.lane) + 0.31);
        if (def.vehicle && o.kind !== "moto") expect(kind, `${o.kind} on a ${kind} at ${o.d.toFixed(0)}`).toBe("road");
        if (o.kind === "peaton") expect(kind).not.toBe("road");
        if (o.k === 0 && (def.yMax > 2 || def.yMin > 0 || def.vehicle)) expect(underArch(course, a - 2, b + 2), `${o.kind} under an arch at ${o.d.toFixed(0)}`).toBe(false);
        if (o.k === 0 && (kind === "median" || kind === "sidewalk")) {
          const tree = course.trees.some((t) => Math.abs(((t.s - o.d) % LAP_LENGTH + LAP_LENGTH + LAP_LENGTH / 2) % LAP_LENGTH - LAP_LENGTH / 2) < def.length / 2 + 1 && Math.abs(t.lateral - o.x) < def.width / 2 + 1);
          expect(tree, `${o.kind} on a tree at ${o.d.toFixed(0)}`).toBe(false);
        }
      }
      // Real things: buses at real stops, pedestrians on foot.
      expect(gen.obstacles.some((o) => o.role === "bus-stop")).toBe(true);
      expect(gen.obstacles.some((o) => o.kind === "peaton" && o.k !== 0)).toBe(true);
    }
  }, 120_000);

  it("announces the real street names as you run", () => {
    const events: GameEvent[] = [];
    const run = new Run({ seed: 21, powerupDuration: (k) => POWERUPS[k].baseDuration, baseMultiplier: () => 1, emit: (e) => events.push(e), fx: () => {} });
    run.invincible = true;
    run.begin(undefined, 1000);
    const bot = new Bot();
    for (let i = 0; i < 40 / TICK && run.player.p < 1500; i++) {
      bot.update(run);
      run.tick(TICK);
    }
    const names = events.flatMap((e) => (e.type === "street" ? [e.name] : []));
    expect(names).toContain("Avenida Sinforiano Madroñero");
    // No repeats back to back.
    for (let i = 1; i < names.length; i++) expect(names[i]).not.toBe(names[i - 1]);
  }, 60_000);

  it("the tutorial on the Puente Real approach: dodge left/right, jump, roll, jump onto a car; the autopilot does it", () => {
    const events: GameEvent[] = [];
    const run = new Run({
      seed: 9, powerupDuration: (k) => POWERUPS[k].baseDuration, baseMultiplier: () => 1, emit: (e) => events.push(e), fx: () => {}, tutorial: true,
    });
    run.begin();
    const steps = run.gen.tutorial;
    expect(steps.map((t) => t.action).slice(1)).toEqual(["jump", "roll", "jump"]);
    expect(steps[0]!.front).toBeGreaterThanOrEqual(50);
    expect(steps[steps.length - 1]!.end).toBeLessThan(190);
    const bot = new Bot();
    for (let i = 0; i < 40 / TICK && run.phase !== "over" && run.player.p < 260; i++) {
      bot.update(run);
      run.tick(TICK);
    }
    expect(run.player.p).toBeGreaterThan(250);
    expect(events.some((e) => e.type === "hint" && e.action === "complete")).toBe(true);
  }, 60_000);

  it("maps track space onto the real route: models face along the street, pitched with the slope", () => {
    const space = new TrackSpace(course.track);
    const obj = new THREE.Object3D();
    for (const s of [100, 1040, 4700, 8100, LAP_LENGTH + 100]) {
      space.place(obj, s, 1.5, 0);
      obj.updateMatrixWorld();
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(obj.quaternion);
      const f = course.track.frameAt(s);
      expect(forward.x * f.tx + forward.z * f.tz).toBeGreaterThan(0.97);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(obj.quaternion);
      expect(right.x * f.nx + right.z * f.nz).toBeGreaterThan(0.97);
      expect(obj.position.x).toBeCloseTo(f.x + f.nx * 1.5, 6);
      // Back from world to track.
      const back = space.toTrack(obj.position, s, { s: 0, lateral: 0, y: 0 });
      expect(back.s).toBeCloseTo(s, 1);
      expect(back.lateral).toBeCloseTo(1.5, 1);
    }
  });
});
