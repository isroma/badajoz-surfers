import { describe, expect, it } from "vitest";
import { Combo, comboStep, lapCaption, milestoneText, milestonesCrossed, shareText } from "./feel";

describe("combo", () => {
  it("counts pickups without a gap longer than a second", () => {
    const c = new Combo();
    expect(c.hit(0)).toBe(1);
    expect(c.hit(400)).toBe(2);
    expect(c.hit(1400)).toBe(3);
    expect(c.alive(2000)).toBe(true);
    expect(c.alive(2401)).toBe(false);
    expect(c.hit(2500)).toBe(1);
    c.reset();
    expect(c.count).toBe(0);
  });

  it("marks the combo steps", () => {
    expect(comboStep(10)).toBe(0);
    expect(comboStep(25)).toBe(1);
    expect(comboStep(26)).toBe(-1);
  });
});

describe("milestones", () => {
  it("reports every 1.000 m crossed", () => {
    expect(milestonesCrossed(990, 1003)).toEqual([1000]);
    expect(milestonesCrossed(1000, 1500)).toEqual([]);
    expect(milestonesCrossed(500, 3200)).toEqual([1000, 2000, 3000]);
    expect(milestonesCrossed(1200, 900)).toEqual([]);
    expect(milestonesCrossed(Number.NaN, 2000)).toEqual([]);
    expect(milestoneText(1000)).toEqual({ title: "¡1.000 m!", text: "El camarero resopla" });
  });
});

describe("copy", () => {
  it("captions laps by day and night", () => {
    expect(lapCaption(2)).toBe("Vuelta 2 · de noche");
    expect(lapCaption(3)).toBe("Vuelta 3 · amanece, más rápido");
  });

  it("builds the share text", () => {
    expect(shareText(3231.7, "la Margen derecha", 1)).toBe(
      "He corrido 3.231 m por Badajoz en Simpa (hasta la Margen derecha, vuelta 1) 🏃‍♂️🍺 ¿Me pillas? https://isroma.github.io/badajoz-surfers/",
    );
  });
});
