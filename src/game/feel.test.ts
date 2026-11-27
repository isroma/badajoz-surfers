/**
 * Target feel parameters, checked numerically (the owner wants it to feel like a top mobile
 * runner, and nobody here can play it).
 */
import { describe, expect, it } from "vitest";
import { LANE_WIDTH } from "../contracts";
import { clearOfSolids, springStep } from "./camera";
import { BoxSet } from "./collision";
import { createEvents, createPlayer, laneChangeTime, laneEase, stepPlayer, type PlayerAction, type PlayerState } from "./player";
import { fadeTarget, segmentHitsBox } from "./world";
import {
  APEX_BAND,
  COYOTE_TIME,
  FALL_GRAVITY_SCALE,
  GRAVITY,
  JUMP_BUFFER_TIME,
  JUMP_VELOCITY,
  LANE_CHANGE_TIME,
  ROLL_HEIGHT,
  ROLL_TIME,
  SUPER_JUMP_VELOCITY,
  TICK,
  jumpAirtime,
  jumpApexTime,
  jumpHeightAt,
} from "./tuning";

const empty = new BoxSet([]);

function simulate(s: PlayerState, seconds: number, actions: Record<number, PlayerAction> = {}, each?: (s: PlayerState, t: number) => void): void {
  const ev = createEvents();
  for (let i = 0; i < Math.round(seconds / TICK); i++) {
    s.speed = 12;
    const a = actions[i];
    stepPlayer(s, a ? [a] : [], TICK, empty, ev);
    each?.(s, (i + 1) * TICK);
  }
}

describe("game feel targets", () => {
  it("jump: snappy rise, ~80 ms floaty apex, faster fall; same clearances, 0.60-0.66 s airtime", () => {
    expect(jumpAirtime()).toBeGreaterThan(0.6);
    expect(jumpAirtime()).toBeLessThan(0.66);
    // Rise takes longer than the fall (fall gravity ×1.75): it reads as a pop, then a drop.
    const apex = jumpApexTime();
    expect(apex).toBeGreaterThan(jumpAirtime() - apex);
    expect(FALL_GRAVITY_SCALE).toBeGreaterThanOrEqual(1.6);
    expect(FALL_GRAVITY_SCALE).toBeLessThanOrEqual(1.9);
    // Apex band: about 80 ms within 4 cm of the top.
    let near = 0;
    for (let t = 0; t < jumpAirtime(); t += 0.001) if (jumpHeightAt(t) > 1.75 - 0.04) near += 0.001;
    expect(near).toBeGreaterThan(0.07);
    expect(near).toBeLessThan(0.14);
    // The simulation matches the closed form within a centimetre.
    const s = createPlayer();
    let peak = 0;
    let landed = -1;
    simulate(s, 1, { 0: "jump" }, (st, t) => {
      peak = Math.max(peak, st.y);
      if (landed < 0 && t > 0.1 && st.grounded) landed = t;
    });
    expect(Math.abs(peak - 1.75)).toBeLessThan(0.01);
    expect(Math.abs(landed - jumpAirtime())).toBeLessThan(2 * TICK);
    // Zapatillas: 3.6 m, under a second of air.
    expect(Math.abs(jumpHeightAt(jumpApexTime(SUPER_JUMP_VELOCITY), SUPER_JUMP_VELOCITY) - 3.6)).toBeLessThan(0.01);
    expect(jumpAirtime(SUPER_JUMP_VELOCITY)).toBeLessThan(0.95);
    expect(APEX_BAND).toBeGreaterThan(0);
    expect(JUMP_VELOCITY).toBeGreaterThan(Math.sqrt(2 * GRAVITY * 1.7));
  });

  it("lane change: 0.22-0.26 s on a real lane, ~0.34 s across the 5 m median, ease-in-out, settles exactly", () => {
    expect(laneChangeTime(3.3)).toBeGreaterThanOrEqual(0.22);
    expect(laneChangeTime(3.3)).toBeLessThanOrEqual(0.26);
    expect(laneChangeTime(5.0)).toBeCloseTo(0.34, 2);
    expect(laneChangeTime(6.3)).toBeLessThanOrEqual(0.35);
    expect(LANE_CHANGE_TIME).toBeGreaterThanOrEqual(0.22);
    // Ease in and out: slow start, fastest in the middle, no overshoot.
    expect(laneEase(0.5)).toBeCloseTo(0.5, 9);
    expect(laneEase(0.15)).toBeLessThan(0.05);
    let max = 0;
    for (let t = 0; t <= 1; t += 0.001) max = Math.max(max, laneEase(t));
    expect(max).toBeLessThanOrEqual(1 + 1e-9);
    expect(laneEase(1)).toBeCloseTo(1, 9);
    const s = createPlayer();
    simulate(s, laneChangeTime(LANE_WIDTH) + TICK, { 0: "right" });
    expect(s.x).toBeCloseTo(LANE_WIDTH, 9);
  });

  it("roll: 0.6-0.7 s and the hitbox is low from the first tick (within 50 ms)", () => {
    expect(ROLL_TIME).toBeGreaterThanOrEqual(0.6);
    expect(ROLL_TIME).toBeLessThanOrEqual(0.7);
    const s = createPlayer();
    const ev = createEvents();
    s.speed = 12;
    stepPlayer(s, ["roll"], TICK, empty, ev);
    expect(s.roll).toBeGreaterThan(0);
    expect(ROLL_HEIGHT).toBeLessThan(0.8);
  });

  it("jump buffer 0.15 s and coyote 0.1 s", () => {
    expect(JUMP_BUFFER_TIME).toBeCloseTo(0.15, 6);
    expect(COYOTE_TIME).toBeCloseTo(0.1, 6);
  });

  it("camera springs are critically damped and frame-rate independent", () => {
    const run = (hz: number): number[] => {
      const s = { x: 0, v: 0 };
      const out: number[] = [];
      for (let i = 0; i < hz; i++) {
        springStep(s, 1, 9, 1 / hz);
        if ((i + 1) % (hz / 4) === 0) out.push(s.x);
      }
      return out;
    };
    const a = run(60);
    const b = run(120);
    const c = run(144);
    for (let i = 0; i < a.length; i++) {
      expect(Math.abs((a[i] ?? 0) - (c[i] ?? 0))).toBeLessThan(0.03);
      expect(Math.abs((b[i] ?? 0) - (c[i] ?? 0))).toBeLessThan(0.02);
      // No overshoot.
      expect(a[i]).toBeLessThanOrEqual(1);
    }
    expect(c[3]).toBeGreaterThan(0.99);
  });

  it("the lens never sits inside a vehicle: lifted over a roof, or slid forward along the boom", () => {
    const bus = { xMin: -1.25, xMax: 1.25, yMin: 0, yMax: 3.1, zMin: -5.5, zMax: 5.5 };
    const pos = { x: 0, y: 2.9, z: 0 };
    clearOfSolids(pos, { x: 0, y: 1.2, z: -6.5 }, [bus]);
    expect(pos.y).toBeGreaterThan(3.1);
    const low = { x: 0, y: 1.0, z: 0 };
    clearOfSolids(low, { x: 0, y: 1.2, z: -8 }, [bus]);
    expect(low.z).toBeLessThan(-5.5);
  });

  it("fades: an object near the lens or hiding the runner goes see-through, others stay solid", () => {
    expect(fadeTarget(5, false)).toBe(1);
    expect(fadeTarget(0.2, false)).toBe(0);
    expect(fadeTarget(5, true)).toBeLessThan(0.4);
    expect(segmentHitsBox(0, 3, 6, 0, 1, 0, -1, 1, 0, 3.1, 1, 4)).toBe(true);
    expect(segmentHitsBox(0, 3, 6, 0, 1, 0, 2, 3, 0, 3.1, 1, 4)).toBe(false);
  });
});
