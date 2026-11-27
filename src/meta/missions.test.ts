import { describe, expect, it } from "vitest";
import {
  MISSION_POOL,
  commitRun,
  describeMission,
  drawMissions,
  emptyRunStats,
  getTemplate,
  liveProgress,
  targetOf,
  updateLive,
  type MissionsState,
  type RunStats,
} from "./missions";

const run = (patch: Partial<RunStats>): RunStats => ({ ...emptyRunStats(), runs: 1, ...patch });
const state = (ids: string[], setsCompleted = 0): MissionsState => ({
  setsCompleted,
  active: ids.map((id) => ({ id, progress: 0, done: false })),
});

describe("mission pool", () => {
  it("has unique ids, five increasing targets and Spanish text", () => {
    const ids = new Set(MISSION_POOL.map((m) => m.id));
    expect(ids.size).toBe(MISSION_POOL.length);
    for (const m of MISSION_POOL) {
      expect(m.targets).toHaveLength(5);
      for (let i = 1; i < 5; i++) expect(m.targets[i]).toBeGreaterThanOrEqual(m.targets[i - 1] ?? 0);
      expect(m.text(m.targets[0]).length).toBeGreaterThan(5);
    }
  });

  it("formats numbers the Spanish way", () => {
    expect(getTemplate("distance-run")?.text(1500)).toBe("Corre 1.500 m en una sola carrera");
    expect(getTemplate("zone-reach")?.text(3)).toBe("Llega al Casco Antiguo");
    expect(getTemplate("laps")?.text(6)).toBe("Da una vuelta completa a Badajoz");
  });
});

describe("drawMissions", () => {
  it("draws three missions with distinct metrics, deterministically", () => {
    for (let s = 0; s < 30; s++) {
      const a = drawMissions(s);
      expect(a).toHaveLength(3);
      const metrics = a.map((m) => getTemplate(m.id)?.metric);
      expect(new Set(metrics).size).toBe(3);
      expect(drawMissions(s)).toEqual(a);
    }
  });

  it("respects minTier", () => {
    expect(drawMissions(0).some((m) => m.id === "laps")).toBe(false);
  });

  it("targets get harder with each set and cap at the last tier", () => {
    expect(targetOf("jumps", 0)).toBe(20);
    expect(targetOf("jumps", 1)).toBe(40);
    expect(targetOf("jumps", 4)).toBe(250);
    expect(targetOf("jumps", 99)).toBe(250);
  });
});

describe("progress", () => {
  it("accumulates total missions across runs", () => {
    let s = state(["jumps", "distance-run", "rolls"]);
    s = commitRun(s, run({ jumps: 12 })).state;
    expect(s.active[0]?.progress).toBe(12);
    const r = commitRun(s, run({ jumps: 9 }));
    expect(r.newlyDone).toEqual(["jumps"]);
    expect(r.state.active[0]).toEqual({ id: "jumps", progress: 20, done: true });
  });

  it("single-run missions need the value in one run", () => {
    let s = state(["distance-run", "jumps", "rolls"]);
    s = commitRun(s, run({ distance: 400 })).state;
    s = commitRun(s, run({ distance: 300 })).state;
    expect(s.active[0]?.progress).toBe(400);
    expect(s.active[0]?.done).toBe(false);
    expect(commitRun(s, run({ distance: 520 })).newlyDone).toEqual(["distance-run"]);
  });

  it("live updates mark missions done once and never double count", () => {
    let s = state(["jumps", "rolls", "distance-run"]);
    s = commitRun(s, run({ jumps: 15 })).state;
    const live = updateLive(s, run({ jumps: 5 }));
    expect(live.newlyDone).toEqual(["jumps"]);
    expect(updateLive(live.state, run({ jumps: 6 })).newlyDone).toEqual([]);
    const end = commitRun(live.state, run({ jumps: 30, rolls: 3 }));
    expect(end.newlyDone).toEqual([]);
    expect(end.state.active[0]).toEqual({ id: "jumps", progress: 20, done: true });
    expect(end.state.active[1]?.progress).toBe(3);
  });

  it("completing the three missions rolls over to a harder set", () => {
    const s = state(["jumps", "rolls", "runs"]);
    const r = commitRun(s, run({ jumps: 100, rolls: 100 }));
    expect(r.setCompleted).toBe(false);
    const r2 = commitRun(r.state, run({}));
    const r3 = commitRun(r2.state, run({}));
    expect(r3.setCompleted).toBe(true);
    expect(r3.state.setsCompleted).toBe(1);
    expect(r3.state.active.every((m) => !m.done && m.progress === 0)).toBe(true);
  });

  it("describes progress with labels and ratios", () => {
    const m = { id: "distance-run", progress: 0, done: false };
    expect(liveProgress(m, run({ distance: 250.7 }), 0)).toBeCloseTo(250.7);
    const v = describeMission(m, run({ distance: 250.7 }), 0);
    expect(v.label).toBe("250 / 500 m");
    expect(v.ratio).toBeCloseTo(0.5, 2);
    expect(describeMission({ ...m, done: true }, emptyRunStats(), 0).label).toBe("¡Hecho!");
  });
});
