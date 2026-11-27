/** The chase camera in narrow streets of the real lap (pure parts: walls, clamp, boom). */
import { describe, expect, it } from "vitest";
import { boomFor, clampToStreet, streetNarrowness, WALL_GAP, NARROW_BACK } from "./camera";
import { inPassage, wallsBetween } from "./course";
import { laneOffsetAt } from "./lanes";
import { useRealCourse } from "./test-course";

const course = useRealCourse();

describe("camera in narrow streets", () => {
  it("the clamp keeps ≥ 0.9 m from both walls, centres in narrow streets, and the boom shortens", () => {
    expect(clampToStreet(5, -10, 4)).toBeCloseTo(4 - WALL_GAP, 6);
    expect(clampToStreet(-1, -2.4, 2.2)).toBeCloseTo(-0.1, 6); // under 6 m: the middle
    expect(clampToStreet(1, -10, 10)).toBe(1);
    expect(clampToStreet(1, -0.5, 0.6)).toBeCloseTo(0.05, 6); // too tight for the gap: the middle
    expect(streetNarrowness(20, false)).toBe(0);
    expect(streetNarrowness(5, false)).toBe(1);
    expect(streetNarrowness(20, true)).toBe(1);
    expect(boomFor(1).back).toBe(NARROW_BACK);
    expect(boomFor(1).up).toBeCloseTo(2.6, 6);
  });

  it("over the whole lap, from every lane, the lens is never within 0.9 m of a building wall", () => {
    const walls = course.walls();
    const L = course.lapLength;
    const box = { left: 0, right: 0 };
    const at = { left: 0, right: 0 };
    const bad: string[] = [];
    let narrow = 0;
    for (let p = 10; p < L; p += 1) {
      wallsBetween(walls, L, p - 7.5, p + 6, box);
      const n = streetNarrowness(box.right - box.left, inPassage(course, p - 8, p + 4));
      if (n > 0.5) narrow++;
      const back = boomFor(n).back;
      const lanes = course.layoutAt(p).offsets.length;
      for (let lane = 0; lane < lanes; lane++) {
        const x = laneOffsetAt(course.track, lane, p);
        const pull = Math.max(-2, Math.min(2, x * 0.4));
        const cam = clampToStreet(x - pull, box.left, box.right);
        // The walls where the lens is (and along the boom).
        wallsBetween(walls, L, p - back - 0.5, p, at);
        if (at.right - at.left < 2 * WALL_GAP) continue; // (never on the lap: checked below)
        if (cam - at.left < WALL_GAP - 1e-6 || at.right - cam < WALL_GAP - 1e-6) bad.push(`s ${p} lane ${lane}: lens ${cam.toFixed(2)} walls ${at.left.toFixed(2)}..${at.right.toFixed(2)}`);
      }
    }
    for (let p = 10; p < L; p += 1) {
      wallsBetween(walls, L, p - 7.5, p + 6, box);
      if (box.right - box.left < 2 * WALL_GAP) bad.push(`s ${p}: street ${(box.right - box.left).toFixed(2)} m wide`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
    // The old town and the two arches count as narrow.
    expect(narrow).toBeGreaterThan(150);
    for (const s of [4600, 4900, 5722]) {
      wallsBetween(walls, L, s - 7.5, s + 6, box);
      expect(streetNarrowness(box.right - box.left, inPassage(course, s - 8, s + 4)), `s ${s}`).toBeGreaterThan(0.5);
    }
  }, 60_000);
});
