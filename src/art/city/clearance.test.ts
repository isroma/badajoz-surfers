import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTrack, validateCity } from "../../city";
import { CLEARANCE, checkRunnableClear, buildContext } from "./context";
import { palmasGate } from "./landmarks";
import { ringPoints, signedArea } from "./geo";

describe("city art: the runnable surface", () => {
  it("has no building standing in it below the arch clearance, anywhere on the lap", () => {
    const city = validateCity(JSON.parse(readFileSync("public/data/city.json", "utf8")));
    const ctx = buildContext(city, createTrack(city));
    const bad = checkRunnableClear(ctx);
    expect(bad).toEqual([]);
  });

  it("opens the passages (Puerta de Palmas, Arco del Peso) over the full runnable width and ≥ 4.8 m", () => {
    const city = validateCity(JSON.parse(readFileSync("public/data/city.json", "utf8")));
    const track = createTrack(city);
    const ctx = buildContext(city, track);
    // Puerta de Palmas: the gate model's opening vs the lanes over its whole depth
    const pp = city.landmarks.find((l) => l.id === "puerta-palmas");
    const pal = city.landmarks.find((l) => l.id === "puente-palmas");
    if (pp?.footprint?.[0] && pal?.footprint?.[0]) {
      const ring = (f: number[]) => { const r = ringPoints(f); return signedArea(r) > 0 ? r.reverse() : r; };
      const gate = palmasGate(ctx, ring(pp.footprint[0]), pp.ground ?? 0, ring(pal.footprint[0]));
      expect(gate.onRoute).toBe(true);
      expect(gate.spring).toBeGreaterThanOrEqual(4.8);
      const f = track.frameAt(gate.s);
      const centreLat = (gate.c.x - f.x) * f.nx + (gate.c.z - f.z) * f.nz;
      for (let ds = -3; ds <= 3; ds += 0.5) {
        const lay = track.layoutAt(gate.s + ds);
        expect(lay.left - 0.3).toBeGreaterThanOrEqual(centreLat - gate.half - 1e-6);
        expect(lay.right + 0.3).toBeLessThanOrEqual(centreLat + gate.half + 1e-6);
      }
    }
    // Arco del Peso (and any passage building): solid only above the clearance over the lanes
    for (const pb of ctx.buildings.filter((b) => b.src.passage)) {
      expect(pb.upperRing).not.toBeNull();
      expect(Math.min(pb.top - 1.5, pb.G + CLEARANCE) - pb.G).toBeGreaterThanOrEqual(4.8 - 1e-6);
    }
  });
});
