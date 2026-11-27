import { describe, expect, it } from "vitest";
import { OBSTACLE_DEFS, type Lane, type ObstacleKind } from "../contracts";
import { BoxSet, type Aabb, type Contact } from "./collision";
import { createEvents, createPlayer, prevRunnerBox, runnerBox, stepPlayer, type PlayerAction, type PlayerState } from "./player";
import type { ObstacleSpawn } from "./spawns";
import { TICK } from "./tuning";

let nextId = 1;
const obstacle = (kind: ObstacleKind, lane: Lane, front: number, k = 0): ObstacleSpawn => ({
  id: nextId++, kind, lane, d: front + OBSTACLE_DEFS[kind].length / 2, k, seed: 1, flipped: false,
});

interface Outcome {
  contact: Contact["type"] | null;
  state: PlayerState;
  maxRoof: number;
}

/** Run the runner through a world, applying `actions` at given times, until a contact or `seconds`. */
function simulate(spawns: ObstacleSpawn[], start: PlayerState, seconds: number, actions: [number, PlayerAction][] = [], speed = 12): Outcome {
  const world = new BoxSet([...spawns].sort((a, b) => a.d - b.d));
  const ev = createEvents();
  const a: Aabb = { xMin: 0, xMax: 0, yMin: 0, yMax: 0, dMin: 0, dMax: 0 };
  const b: Aabb = { ...a };
  let maxRoof = 0;
  for (let i = 0; i < Math.round(seconds / TICK); i++) {
    const t = i * TICK;
    const now = actions.filter(([at]) => Math.abs(at - t) < TICK / 2).map(([, act]) => act);
    start.speed = speed;
    stepPlayer(start, now, TICK, world, ev);
    if (start.grounded && start.supportId >= 0) maxRoof = Math.max(maxRoof, start.y);
    const c = world.contact(prevRunnerBox(start, a), runnerBox(start, b));
    if (c) return { contact: c.type, state: start, maxRoof };
  }
  return { contact: null, state: start, maxRoof };
}

describe("collisions", () => {
  it("running into the front of a car is a crash", () => {
    expect(simulate([obstacle("coche", 0, 10)], createPlayer(), 2).contact).toBe("front");
  });

  it("jumping over a barrier clears it", () => {
    // Take off ~0.35 s before reaching it at 12 m/s.
    expect(simulate([obstacle("valla", 0, 6)], createPlayer(), 2, [[0.2, "jump"]]).contact).toBeNull();
  });

  it("rolling under a banner clears it; standing does not", () => {
    expect(simulate([obstacle("pancarta", 0, 6)], createPlayer(), 2, [[0.2, "roll"]]).contact).toBeNull();
    expect(simulate([obstacle("pancarta", 0, 6)], createPlayer(), 2).contact).toBe("front");
  });

  it("the roll lasts while under a long scaffold", () => {
    const r = simulate([obstacle("andamio", 0, 6), obstacle("andamio", 0, 8)], createPlayer(), 2, [[0.3, "roll"]]);
    expect(r.contact).toBeNull();
  });

  it("changing lanes into the side of a car is a side stumble", () => {
    // Already alongside the car when the lane change starts.
    const r = simulate([obstacle("coche", -1, -1)], createPlayer(), 1, [[0.1, "left"]]);
    expect(r.contact).toBe("side");
  });

  it("jumping onto a car lands on the roof and lets you run along it", () => {
    const r = simulate([obstacle("coche", 0, 6), obstacle("coche", 0, 11.3)], createPlayer(), 1.3, [[0.2, "jump"]]);
    expect(r.contact).toBeNull();
    expect(r.maxRoof).toBeCloseTo(OBSTACLE_DEFS.coche.yMax, 5);
  });

  it("a ramp carries you onto a bus roof", () => {
    const ramp = obstacle("camion-rampa", 0, 5);
    const bus = obstacle("bus", 0, 5 + 7 + 0.5);
    const r = simulate([ramp, bus], createPlayer(), 2.2);
    expect(r.contact).toBeNull();
    expect(r.maxRoof).toBeCloseTo(OBSTACLE_DEFS.bus.yMax, 5);
  });

  it("landing marginally on a barrier is only a clip", () => {
    // Jump too early: the feet come down on the terrace.
    const r = simulate([obstacle("terraza", 0, 9)], createPlayer(), 1.5, [[0.1, "jump"]], 12);
    expect(r.contact).toBe("clip");
  });

  it("an oncoming car meets you exactly at its meeting point", () => {
    const car = obstacle("coche", 0, 20, 0.55);
    const r = simulate([car], createPlayer(), 3);
    expect(r.contact).toBe("front");
    // The runner's front met the vehicle's front close to the meeting distance.
    expect(Math.abs(r.state.p - car.d)).toBeLessThan(2.5);
  });

  it("a car in the next lane is harmless", () => {
    expect(simulate([obstacle("coche", 1, 5, 0.55), obstacle("bus", -1, 5)], createPlayer(), 2).contact).toBeNull();
  });
});
