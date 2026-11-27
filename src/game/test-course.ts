/**
 * Tests only: install the real Badajoz lap (public/data/city.json) as the engine's course.
 * Reads the file with node:fs, so it must never be imported by the game itself.
 */
import { readFileSync } from "node:fs";
import { validateCity } from "../city/data";
import { createTrack } from "../city/track";
import { buildCourse, setCourse, type Course } from "./course";

let cached: Course | null = null;

export function realCourse(): Course {
  if (!cached) {
    const city = validateCity(JSON.parse(readFileSync("public/data/city.json", "utf8")));
    cached = buildCourse(city, createTrack(city));
  }
  return cached;
}

/** Install the real lap for this test file (call at module level). */
export function useRealCourse(): Course {
  const c = realCourse();
  setCourse(c);
  return c;
}
