import { describe, expect, it } from "vitest";
import { QualityGovernor, type QualityLevel } from "./quality";

/** Feed `seconds` of frames of `ms` each (with a work time) and return the levels seen. */
function feed(g: QualityGovernor, seconds: number, ms: number | (() => number), work: number | ((ms: number) => number), opts: { hidden?: boolean; focused?: boolean; active?: boolean } = {}): QualityLevel[] {
  const levels: QualityLevel[] = [];
  let t = 0;
  while (t < seconds * 1000) {
    const dt = typeof ms === "number" ? ms : ms();
    t += dt;
    const w = typeof work === "number" ? work : work(dt);
    levels.push(g.frame({ intervalMs: dt, workMs: w, hidden: opts.hidden ?? false, focused: opts.focused ?? true, active: opts.active ?? true }));
  }
  return levels;
}

const rng = (seed: number): (() => number) => {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
};

describe("quality governor", () => {
  it("60 Hz steady: stays at the best level, and steps back up after a slow patch", () => {
    const g = new QualityGovernor();
    feed(g, 30, 1000 / 60, 6);
    expect(g.level).toBe(0);
    expect(g.refreshMs).toBeCloseTo(16.67, 1);
    // A real slow patch (40 fps, heavy work) steps down...
    feed(g, 4, 25, 20);
    expect(g.level).toBeGreaterThan(0);
    // ...and a steady 60 Hz again steps back up (the old governor needed < 12.5 ms: never on 60 Hz).
    feed(g, 40, 1000 / 60, 6);
    expect(g.level).toBe(0);
  });

  it("60 Hz with hitches (a long frame now and then, light work): no change", () => {
    const g = new QualityGovernor();
    const r = rng(7);
    feed(g, 60, () => (r() < 0.03 ? 70 : r() < 0.05 ? 33.3 : 1000 / 60), 5);
    expect(g.level).toBe(0);
  });

  it("30 fps sustained on a 60 Hz display with heavy work: steps down, one level per two windows", () => {
    const g = new QualityGovernor();
    feed(g, 3, 1000 / 60, 8, { active: false }); // the menu: refresh measured, no decisions
    expect(g.level).toBe(0);
    const levels = feed(g, 8, 1000 / 30, 28);
    expect(g.level).toBe(3);
    expect(levels.indexOf(1)).toBeGreaterThan(0);
  });

  it("30 fps because the GPU is late (light CPU work, frames missing the refresh): steps down too", () => {
    const g = new QualityGovernor();
    feed(g, 3, 1000 / 60, 4, { active: false });
    feed(g, 3, 1000 / 30, 4);
    expect(g.level).toBeGreaterThan(0);
  });

  it("144 Hz: steady frames keep the best level; 60 fps on it is fine (the target is 60 fps)", () => {
    const g = new QualityGovernor(2);
    feed(g, 30, 1000 / 144, 3);
    expect(g.level).toBe(0);
    expect(g.refreshMs).toBeCloseTo(6.94, 1);
    feed(g, 30, 1000 / 60, 9);
    expect(g.level).toBe(0);
  });

  it("a throttled background tab (1 fps, hidden): no change, and nothing is measured", () => {
    const g = new QualityGovernor();
    feed(g, 60, 1000, 2, { hidden: true, focused: false });
    expect(g.level).toBe(0);
    // Hidden but at full rate (some browsers): windows are thrown away.
    feed(g, 20, 40, 30, { hidden: true });
    expect(g.level).toBe(0);
    // Unfocused (another window in front) at a low rate: ignored too.
    feed(g, 20, 40, 30, { focused: false });
    expect(g.level).toBe(0);
  });

  it("loading and the menu never change the level; a pinned level never changes", () => {
    const g = new QualityGovernor();
    feed(g, 20, 40, 35, { active: false });
    expect(g.level).toBe(0);
    const p = new QualityGovernor(1, true);
    feed(p, 10, 40, 35);
    feed(p, 30, 1000 / 60, 3);
    expect(p.level).toBe(1);
  });
});
