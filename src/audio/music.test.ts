import { describe, expect, it } from "vitest";
import { stepAction } from "./music";

describe("music scheduler", () => {
  it("plays steps inside the lookahead window", () => {
    expect(stepAction(10.1, 10)).toBe("play");
    expect(stepAction(10.29, 10)).toBe("stop");
  });

  it("skips steps whose time has passed instead of stacking them after a stall", () => {
    // A 300 ms stall at 120 BPM (125 ms per 16th): the missed steps are skipped, not played late.
    const now = 10.3;
    const step = 0.125;
    const actions = [10, 10 + step, 10 + 2 * step, 10 + 3 * step, 10 + 4 * step].map((t) => stepAction(t, now));
    expect(actions).toEqual(["skip", "skip", "skip", "play", "play"]);
    expect(actions.filter((a) => a === "play").length).toBeLessThanOrEqual(3);
  });
});
