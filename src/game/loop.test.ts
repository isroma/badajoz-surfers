import { describe, expect, it } from "vitest";
import { StepClock } from "./loop";
import { TICK } from "./tuning";

/** Rendered simulation time after each frame: ticks run so far plus the interpolation. */
function renderedTimes(hz: number, scale: number, frames: number): number[] {
  const clock = new StepClock();
  let ticks = 0;
  const out: number[] = [];
  for (let f = 0; f < frames; f++) {
    ticks += clock.frame(1 / hz, scale);
    out.push((ticks + clock.alpha) * TICK);
  }
  return out;
}

describe("frame → tick accounting", () => {
  for (const hz of [60, 120, 144]) {
    for (const scale of [1, 0.6]) {
      it(`${hz} Hz at ${scale}x: monotonic, even progress`, () => {
        const times = renderedTimes(hz, scale, 600);
        const expected = scale / hz;
        for (let i = 1; i < times.length; i++) {
          const step = (times[i] ?? 0) - (times[i - 1] ?? 0);
          expect(step).toBeGreaterThan(0);
          expect(Math.abs(step - expected)).toBeLessThan(1e-6);
        }
      });
    }
  }
});
