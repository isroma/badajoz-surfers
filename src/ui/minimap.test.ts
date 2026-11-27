import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateCity } from "../city/data";
import { realGeometry, simplify } from "./minimap";
import { splitStreet } from "./hud";

const city = validateCity(JSON.parse(readFileSync("public/data/city.json", "utf8")));

describe("real route map", () => {
  const g = realGeometry(city);

  it("simplifies the lap to a few hundred points", () => {
    const points = (g.routePath.match(/[ML]/g) ?? []).length;
    expect(points).toBeGreaterThan(150);
    expect(points).toBeLessThan(600);
    expect(g.zonePaths).toHaveLength(6);
    expect(g.real).toBe(true);
  });

  it("places the runner on the route, north up, within the map", () => {
    for (let zone = 0; zone < 6; zone++) {
      for (const p of [0, 0.5, 0.99]) {
        const at = g.locate(zone, p);
        expect(at.x).toBeGreaterThanOrEqual(0);
        expect(at.x).toBeLessThanOrEqual(g.w);
        expect(at.y).toBeGreaterThanOrEqual(0);
        expect(at.y).toBeLessThanOrEqual(g.h);
      }
    }
    // The lap starts at the Puente Real on the right bank (north-west) and the old town is east.
    const start = g.locate(0, 0);
    const casco = g.locate(3, 0.5);
    expect(casco.x).toBeGreaterThan(start.x);
    expect(g.locate(5, 1).len).toBeGreaterThan(g.locate(5, 0.5).len);
  });

  it("knows the real street names", () => {
    expect(g.streetAt(1, 0.3)).toBe("Avenida Sinforiano Madroñero");
    expect(g.streets.some((s) => s.name === "Calle San Juan")).toBe(true);
  });

  it("simplify keeps the ends", () => {
    expect(simplify([0, 1, 2, 3], [0, 0, 0, 0], 0.1)).toEqual([0, 3]);
  });
});

describe("street plaques", () => {
  it("put the street type on its own line", () => {
    expect(splitStreet("Avenida Sinforiano Madroñero")).toEqual(["Avenida", "Sinforiano Madroñero"]);
    expect(splitStreet("Puente Real")).toEqual([null, "Puente Real"]);
  });
});
