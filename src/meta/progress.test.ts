import { describe, expect, it } from "vitest";
import { MetaStore } from "./index";
import { emptyRunStats, getTemplate, type RunStats } from "./missions";
import {
  ACHIEVEMENTS,
  MAX_RECORDS,
  addRecord,
  addRunToLifetime,
  dailyChallenge,
  dailyCheck,
  dailyCommit,
  dayKey,
  formatDay,
  newAchievements,
  zoneReached,
  zonesMask,
} from "./progress";
import { emptyLifetime, parseSave } from "./save";

const run = (patch: Partial<RunStats>): RunStats => ({ ...emptyRunStats(), runs: 1, ...patch });

describe("records", () => {
  it("keeps the top five by score", () => {
    let list = addRecord([], { date: "2026-11-01", score: 100, distance: 50, zones: 0 }).records;
    for (let i = 0; i < 8; i++) list = addRecord(list, { date: "2026-11-02", score: i * 50, distance: 10, zones: 0 }).records;
    expect(list).toHaveLength(MAX_RECORDS);
    expect(list.map((r) => r.score)).toEqual([350, 300, 250, 200, 150]);
    const r = addRecord(list, { date: "2026-11-03", score: 320, distance: 1, zones: 2 });
    expect(r.rank).toBe(1);
    expect(addRecord(list, { date: "x", score: 1, distance: 1, zones: 0 }).rank).toBe(-1);
    expect(addRecord(list, { date: "x", score: 0, distance: 0, zones: 0 }).records).toEqual(list);
  });

  it("formats days and reached zones in Spanish", () => {
    expect(dayKey(new Date(2026, 10, 7))).toBe("2026-11-07");
    expect(formatDay("2026-11-07")).toBe("7 nov 2026");
    expect(zoneReached(9)).toEqual({ zoneIndex: 3, name: "Casco Antiguo", lap: 2 });
    expect(zoneReached(0).name).toBe("Puente Real");
  });
});

describe("achievements", () => {
  it("have unique ids and positive rewards", () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(15);
    for (const a of ACHIEVEMENTS) expect(a.reward).toBeGreaterThan(0);
  });

  it("unlock from lifetime totals and single runs", () => {
    let life = emptyLifetime();
    expect(newAchievements([], life)).toEqual([]);
    life = addRunToLifetime(life, run({ zones: 3, roofMetres: 300 }));
    const ids = newAchievements([], life).map((a) => a.id);
    expect(ids).toContain("primer-simpa");
    expect(ids).toContain("plaza-alta");
    expect(ids).not.toContain("ciguena");
    life = addRunToLifetime(life, run({ roofMetres: 250 }));
    expect(newAchievements(ids, life).map((a) => a.id)).toEqual(["ciguena"]);
  });

  it("Turista needs every zone", () => {
    expect(zonesMask(0)).toBe(1);
    expect(zonesMask(5)).toBe(63);
    expect(zonesMask(40)).toBe(63);
    const life = addRunToLifetime(emptyLifetime(), run({ zones: 5 }));
    expect(newAchievements([], life).map((a) => a.id)).toContain("turista");
  });
});

describe("daily challenge", () => {
  it("is seeded by the day", () => {
    expect(dailyChallenge("2026-11-27")).toEqual(dailyChallenge("2026-11-27"));
    const ids = new Set(Array.from({ length: 30 }, (_, i) => dailyChallenge(`2026-12-${String(i + 1).padStart(2, "0")}`).templateId));
    expect(ids.size).toBeGreaterThan(4);
    const c = dailyChallenge("2026-11-27");
    expect(getTemplate(c.templateId)).toBeDefined();
    expect(c.text.length).toBeGreaterThan(5);
    expect(c.reward).toBeGreaterThanOrEqual(300);
  });

  it("progresses during a day and resets the next", () => {
    const date = "2026-11-27";
    const c = dailyChallenge(date);
    const metric = getTemplate(c.templateId)?.metric ?? "jumps";
    const half = run({ [metric]: Math.ceil(c.target / 2) });
    let s = dailyCommit({ date: "", progress: 0, done: false }, half, date).state;
    expect(s.date).toBe(date);
    expect(s.done).toBe(false);
    const full = run({ [metric]: c.target });
    const live = dailyCheck(s, full, date);
    expect(live.completed).toBe(true);
    s = live.state;
    expect(dailyCommit(s, full, date).completed).toBe(false);
    expect(dailyCommit(s, run({}), "2026-11-28").state).toEqual({ date: "2026-11-28", progress: 0, done: false });
  });
});

describe("store progression", () => {
  it("awards achievements, records and the daily once", () => {
    const m = new MetaStore(null, () => new Date(2026, 10, 27));
    const c = dailyChallenge("2026-11-27");
    const metric = getTemplate(c.templateId)?.metric ?? "jumps";
    m.beginRun();
    const big = run({ [metric]: c.target * 2, score: 999, distance: 300 });
    const live = m.updateRun({ ...big, runs: 0 });
    expect(live.daily?.templateId).toBe(c.templateId);
    const r = m.finishRun(big);
    expect(r.daily?.templateId).toBe(c.templateId);
    expect(r.achievements.map((a) => a.id)).toContain("primer-simpa");
    expect(r.bonus).toBeGreaterThanOrEqual(c.reward + 50);
    expect(r.recordRank).toBe(0);
    expect(m.save.wallet).toBe(r.bonus + r.bellotasEarned);
    expect(m.save.records).toHaveLength(1);
    const r2 = m.finishRun(big);
    expect(r2.daily).toBeNull();
    expect(r2.achievements.map((a) => a.id)).not.toContain("primer-simpa");
  });

  it("tutorial flag persists and migrates", () => {
    const m = new MetaStore(null);
    expect(m.gameOptions.tutorial()).toBe(true);
    m.completeTutorial();
    expect(m.gameOptions.tutorial()).toBe(false);
    expect(parseSave({ runsPlayed: 3 }).tutorialDone).toBe(true);
    expect(parseSave({}).tutorialDone).toBe(false);
    expect(parseSave({ achievements: ["turista", "nope", "turista"] }).achievements).toEqual(["turista"]);
  });
});
