/**
 * The owner's complaint, numerically: through every roundabout, a runner who presses nothing stays
 * in the lane that keeps its place from the kerb (k-th from the kerb before, on and after the
 * ring), is never moved sideways faster than 2.5 m/s, and never changes lane except where a lane
 * really ends (merges).
 */
import { describe, expect, it } from "vitest";
import { BoxSet } from "./collision";
import { followLane, laneMergeAhead, laneOffsetAt, layoutAt, merges } from "./lanes";
import { createEvents, createPlayer, stepPlayer } from "./player";
import { TICK, speedAt } from "./tuning";
import { useRealCourse } from "./test-course";

const course = useRealCourse();
const track = course.track;
const L = track.lapLength;

/**
 * The runner's place from the kerb, counted the way the lanes map through the boundaries: the
 * number of the approach's lanes to its right that carry on through the whole pass (lanes that
 * end or begin on the way do not count), followed to distance `at`. Pure.
 */
function placeAt(from: number, to: number, lane0: number, at: number, laneNow: number): number {
  const lay = layoutAt(from);
  let n = 0;
  for (let l = lane0 + 1; l < lay.offsets.length; l++) {
    if (laneMergeAhead(track, l, from, to - from) !== null) continue;
    const there = followLane(track, l, from, at);
    if (there !== undefined && there > laneNow) n++;
  }
  return n;
}

export interface Pass {
  ring: number;
  lane: string;
  kerb: number[];
  vmax: number;
  ended: boolean;
}

/** Every approach lane through every ring with no input, at the planned speed of `lap`. */
export function ringPasses(lap: number): Pass[] {
  const world = new BoxSet([]);
  const out: Pass[] = [];
  const ends = merges(track).filter((m) => !m.opens);
  for (const rb of track.roundabouts) {
    const from = rb.arcFromS - 60;
    const lay = layoutAt(from) as ReturnType<typeof layoutAt> & { ids: readonly string[] };
    for (let lane = 0; lane < lay.offsets.length; lane++) {
      const base = (lap - 1) * L;
      const s = createPlayer(base + from, lane, lay);
      const ev = createEvents();
      const kerb: number[] = [];
      let vmax = 0;
      let x0 = s.x;
      // A lane that really ends during the pass (before, on or at the exit of the ring) hands the
      // runner over to its merge target.
      const ended = laneMergeAhead(track, lane, from, rb.arcToS + 2 - from) !== null;
      void ends;
      for (const at of [rb.arcFromS - 5, (rb.arcFromS + rb.arcToS) / 2, rb.arcToS + 40]) {
        while (s.p < base + at) {
          s.speed = speedAt(s.p);
          stepPlayer(s, [], TICK, world, ev);
          vmax = Math.max(vmax, Math.abs(s.x - x0) / TICK);
          x0 = s.x;
          expect(Math.abs(s.x - laneOffsetAt(track, s.lane, s.p))).toBeLessThan(1e-6);
        }
        kerb.push(placeAt(base + from, base + rb.arcToS + 40, lane, s.p, s.lane));
      }
      out.push({ ring: rb.arcFromS, lane: lay.ids[lane] ?? String(lane), kerb, vmax, ended });
    }
  }
  return out;
}

describe("through the roundabouts with no input", () => {
  it("the runner keeps its place from the kerb before, on and after every ring, carried at most 2.5 m/s", () => {
    for (const lap of [1, 4]) {
      for (const p of ringPasses(lap)) {
        const what = `lap ${lap} ring ${p.ring.toFixed(0)} from ${p.lane}`;
        expect(p.vmax, what).toBeLessThanOrEqual(2.5);
        if (!p.ended) expect(new Set(p.kerb).size, `${what}: places ${p.kerb.join(" → ")}`).toBe(1);
      }
    }
  }, 120_000);
});
