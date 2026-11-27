import { describe, expect, it } from "vitest";
import { laneX } from "../contracts";
import { BoxSet } from "./collision";
import { createEvents, createPlayer, stepPlayer, type PlayerAction, type PlayerState } from "./player";
import { JUMP_HEIGHT, LANE_CHANGE_TIME, ROLL_TIME, SUPER_JUMP_HEIGHT, TICK } from "./tuning";

const empty = new BoxSet([]);

function run(s: PlayerState, seconds: number, actionsAt: Record<number, PlayerAction> = {}, onTick?: (s: PlayerState, t: number) => void): void {
  const ev = createEvents();
  const ticks = Math.round(seconds / TICK);
  for (let i = 0; i < ticks; i++) {
    const a = actionsAt[i];
    s.speed = 12;
    stepPlayer(s, a ? [a] : [], TICK, empty, ev);
    onTick?.(s, i * TICK);
  }
}

describe("player physics", () => {
  it("a normal jump lifts the feet about 1.75 m with about 0.63 s of airtime", () => {
    const s = createPlayer();
    let apex = 0;
    let landedAt = -1;
    run(s, 1.2, { 0: "jump" }, (st, t) => {
      apex = Math.max(apex, st.y);
      if (landedAt < 0 && t > 0.05 && st.grounded) landedAt = t;
    });
    expect(apex).toBeGreaterThan(JUMP_HEIGHT - 0.05);
    expect(apex).toBeLessThan(JUMP_HEIGHT + 0.05);
    expect(landedAt).toBeGreaterThan(0.6);
    expect(landedAt).toBeLessThan(0.66);
  });

  it("zapatillas make a super jump of about 3.6 m", () => {
    const s = createPlayer();
    s.superJump = true;
    let apex = 0;
    run(s, 1.5, { 0: "jump" }, (st) => (apex = Math.max(apex, st.y)));
    expect(apex).toBeGreaterThan(SUPER_JUMP_HEIGHT - 0.08);
    expect(apex).toBeLessThan(SUPER_JUMP_HEIGHT + 0.08);
  });

  it("a roll lasts about 0.7 s", () => {
    const s = createPlayer();
    let rollEnd = -1;
    run(s, 1.2, { 0: "roll" }, (st, t) => {
      if (rollEnd < 0 && st.roll <= 0) rollEnd = t;
    });
    expect(rollEnd).toBeGreaterThan(ROLL_TIME - 0.03);
    expect(rollEnd).toBeLessThan(ROLL_TIME + 0.03);
  });

  it("jump during a roll cancels it; roll in the air fast-falls into a roll", () => {
    const s = createPlayer();
    run(s, 0.2, { 0: "roll" });
    expect(s.roll).toBeGreaterThan(0);
    run(s, 0.05, { 0: "jump" });
    expect(s.roll).toBe(0);
    expect(s.grounded).toBe(false);
    let landedAt = -1;
    run(s, 0.6, { 0: "roll" }, (st, t) => {
      if (landedAt < 0 && st.grounded) landedAt = t;
    });
    expect(landedAt).toBeGreaterThan(0);
    expect(landedAt).toBeLessThan(0.25);
    expect(s.roll).toBeGreaterThan(0);
  });

  it("buffers a jump pressed just before landing", () => {
    const s = createPlayer();
    let jumps = 0;
    const ev = createEvents();
    for (let i = 0; i < Math.round(1.6 / TICK); i++) {
      s.speed = 12;
      const a: PlayerAction | null = i === 0 || i === Math.round(0.62 / TICK) ? "jump" : null;
      stepPlayer(s, a ? [a] : [], TICK, empty, ev);
      if (ev.jumped) jumps++;
    }
    expect(jumps).toBe(2);
  });

  it("changes lane in about 0.12 s and queues one more lane input", () => {
    const s = createPlayer();
    run(s, LANE_CHANGE_TIME + 0.01, { 0: "left" });
    expect(s.x).toBeCloseTo(laneX(-1), 5);
    run(s, 0.4, { 0: "right", 2: "right" });
    expect(s.lane).toBe(2);
    expect(s.x).toBeCloseTo(laneX(1), 5);
  });

  it("does not leave the road", () => {
    const s = createPlayer(0, 2);
    run(s, 0.3, { 0: "right" });
    expect(s.lane).toBe(2);
  });

  it("roll then jump in the same tick is just a jump", () => {
    const s = createPlayer();
    const ev = createEvents();
    s.speed = 12;
    stepPlayer(s, ["roll", "jump"], TICK, empty, ev);
    expect(ev.jumped).toBe(true);
    expect(ev.rolled).toBe(false);
    expect(s.roll).toBe(0);
  });
});
