import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTrack, validateCity } from "../../city";
import { checkRunnableClear, buildContext } from "./context";

describe("city art: the runnable surface", () => {
  it("has no building standing in it below the arch clearance, anywhere on the lap", () => {
    const city = validateCity(JSON.parse(readFileSync("public/data/city.json", "utf8")));
    const ctx = buildContext(city, createTrack(city));
    const bad = checkRunnableClear(ctx);
    expect(bad).toEqual([]);
  });
});
