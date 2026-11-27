/**
 * The real lap's lane tapers, passages and guidance (regressions for the review of the lane
 * model): nothing is placed where a lane tapers away or under an arch, the runner's lane index
 * always matches the street, lane-ends and turn events are true and one at a time.
 */
import { describe, expect, it } from "vitest";
import { OBSTACLE_DEFS, POWERUPS, type GameEvent } from "../contracts";
import { PASSAGE_AFTER, PASSAGE_BEFORE } from "./course";
import { laneMergeAhead, laneShownAt, layoutAt, merges } from "./lanes";
import { Run } from "./run";
import { obstacleCentre } from "./spawns";
import { MERGE_CLOSED, TARGET_CLEAR_AFTER, TARGET_CLEAR_BEFORE, TrackGenerator } from "./track";
import { footprintOf } from "./traffic";
import { LAP_BONUS_EASE, TICK, speedAt } from "./tuning";
import { useRealCourse } from "./test-course";

const course = useRealCourse();
const track = course.track;
const L = course.lapLength;

describe("lane tapers, passages and guides on the real lap", () => {
  it("nothing in a tapering lane's last 80 m, its target kept clear, nothing under the arches (20 seeds × 2 laps)", () => {
    const bad: string[] = [];
    const zones: { from: number; to: number; x: number; what: string; target: boolean }[] = [];
    for (const m of merges(track)) {
      const lay = track.stretches[m.fromStretch]!.layout;
      zones.push({ from: m.s1 - MERGE_CLOSED, to: m.end, x: lay.offsets[m.lane]!, what: `${lay.ids[m.lane]} ending at ${m.end.toFixed(0)}`, target: false });
      zones.push({ from: m.s1 - TARGET_CLEAR_BEFORE, to: Math.min(m.end, m.s1 + TARGET_CLEAR_AFTER), x: lay.offsets[m.into]!, what: `target ${lay.ids[m.into]} at ${m.end.toFixed(0)}`, target: true });
    }
    for (let seed = 1; seed <= 20; seed++) {
      const gen = new TrackGenerator(seed * 101);
      gen.generateUntil(2 * L + 200);
      for (const lap of [0, 1]) {
        const base = lap * L;
        for (const z of zones) {
          for (const o of gen.obstacles) {
            const [a, b] = footprintOf(o);
            const half = (o.span ?? OBSTACLE_DEFS[o.kind].width) / 2;
            if (b > base + z.from && a < base + z.to && Math.abs(o.x - z.x) < half + 0.7) bad.push(`seed ${seed}: ${o.kind} in ${z.what}`);
          }
          // (bellotas may lead into a merge target: it is only kept clear of obstacles)
          for (const p of z.target ? [] : gen.pickups) {
            if (p.d >= base + z.from && p.d <= base + z.to && Math.abs(p.x - z.x) < 1.0) bad.push(`seed ${seed}: ${p.kind} in ${z.what}`);
          }
        }
        for (const [a0, b0] of course.passages) {
          const a = base + a0 - PASSAGE_BEFORE;
          const b = base + b0 + PASSAGE_AFTER;
          for (const o of gen.obstacles) {
            const [fa, fb] = footprintOf(o);
            const c = obstacleCentre(o, fa);
            if ((fb > a && fa < b) || (c > a && c < b)) bad.push(`seed ${seed}: ${o.kind} under the arch at ${a0.toFixed(0)}`);
          }
          for (const p of gen.pickups) if (p.d > a && p.d < b && p.y > 1.2) bad.push(`seed ${seed}: high ${p.kind} under the arch at ${a0.toFixed(0)}`);
        }
      }
      if (bad.length > 10) break;
    }
    expect(course.passages.length).toBeGreaterThanOrEqual(2);
    expect(bad).toEqual([]);
  }, 120_000);

  it("the lane index always matches the street, and lane-ends is only said of a lane that really tapers ahead", () => {
    const events: { e: GameEvent; p: number; lane: number; ending: number | null }[] = [];
    let run: Run | null = null;
    run = new Run({
      seed: 5, powerupDuration: (k) => POWERUPS[k].baseDuration, baseMultiplier: () => 1, fx: () => {},
      emit: (e) => events.push({ e, p: run?.player.p ?? 0, lane: run?.player.lane ?? -1, ending: run?.laneEnding ?? null }),
    });
    run.invincible = true;
    run.begin();
    const bad: string[] = [];
    for (let i = 0; i < 2 / TICK; i++) run.tick(TICK);
    // Keep to the right-hand pavement (walk-R never ends on the rings).
    while (run.player.p < L) {
      const lay = layoutAt(run.player.p);
      if (run.player.laneT >= 1 && run.player.lane < lay.offsets.length - 1) run.push("right");
      run.tick(TICK);
      const now = layoutAt(run.player.p);
      if (run.player.lane < 0 || run.player.lane >= now.offsets.length) bad.push(`index ${run.player.lane}/${now.offsets.length} at ${run.player.p.toFixed(1)}`);
    }
    for (const x of events) {
      if (x.e.type !== "lane-ends") continue;
      const m = laneMergeAhead(track, x.lane, x.p, 400);
      if (!m || m.s0 - x.p > 121) bad.push(`false lane-ends at ${x.p.toFixed(1)} (lane ${x.lane}, ending ${x.ending})`);
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it("turn events: one at a time, the next one only after the previous turn's end, with its end distance", () => {
    const events: { e: GameEvent; p: number }[] = [];
    let run: Run | null = null;
    run = new Run({ seed: 9, powerupDuration: (k) => POWERUPS[k].baseDuration, baseMultiplier: () => 1, fx: () => {}, emit: (e) => events.push({ e, p: run?.player.p ?? 0 }) });
    run.invincible = true;
    run.begin();
    while (run.player.p < L + 300) run.tick(TICK);
    const turns = events.filter((x) => x.e.type === "turn");
    expect(turns.length).toBeGreaterThan(20);
    let prevEnd = -Infinity;
    for (const x of turns) {
      if (x.e.type !== "turn") continue;
      expect(x.e.endDistance).toBeDefined();
      expect(x.e.endDistance!).toBeGreaterThanOrEqual(x.e.distance);
      expect(x.e.distance).toBeLessThanOrEqual(120);
      expect(x.p).toBeGreaterThanOrEqual(prevEnd - 0.6); // (distances are rounded to metres)
      prevEnd = x.p + x.e.endDistance!;
    }
  }, 120_000);

  it("the HUD drops a tapering lane from the midpoint of its taper; s 3132's taper starts in the stretch before", () => {
    for (const m of merges(track)) {
      const mid = (m.s0 + m.s1) / 2;
      const st = track.stretches[m.fromStretch]!;
      if (mid < st.fromS) {
        // A lane too short for its taper: closed for its whole life, its taper runs on the lane it
        // continues from, in the stretch before.
        const t = track.transitions.find((x) => x.toIndex === m.fromStretch)!;
        const pi = t.map.findIndex((j) => j === m.lane);
        expect(laneShownAt(track, pi, mid - 1)).toBe(true);
        expect(laneShownAt(track, pi, mid + 1)).toBe(false);
        expect(laneShownAt(track, m.lane, st.fromS + 0.5)).toBe(false);
        continue;
      }
      if (mid - 1 > st.fromS) expect(laneShownAt(track, m.lane, mid - 1)).toBe(true);
      expect(laneShownAt(track, m.lane, Math.min(m.end - 0.1, mid + 1))).toBe(false);
      expect(laneShownAt(track, m.into, mid + 1)).toBe(true);
      // Every taper is at least MERGE_LENGTH long (the short ring stretch borrows the one before).
      expect(m.s1 - m.s0).toBeGreaterThanOrEqual(59.9);
    }
    const short = merges(track).find((m) => Math.abs(m.end - 3132) < 2)!;
    expect(short.s0).toBeLessThan(track.stretches[short.fromStretch]!.fromS);
  });

  it("no speed step at the lap seam: the new lap's bonus eases in", () => {
    expect(Math.abs(speedAt(L + 0.01) - speedAt(L - 0.01))).toBeLessThan(0.01);
    let prev = speedAt(L - 1);
    for (let d = L; d < L + LAP_BONUS_EASE + 50; d += 1) {
      const v = speedAt(d);
      expect(v - prev).toBeLessThan(0.02);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    expect(speedAt(L + LAP_BONUS_EASE + 10) - speedAt(L - 1)).toBeGreaterThan(1.5);
  });
});
