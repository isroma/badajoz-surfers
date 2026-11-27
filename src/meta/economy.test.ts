import { describe, expect, it } from "vitest";
import { POWERUPS } from "../contracts";
import { MAX_MULTIPLIER, MAX_UPGRADE_LEVEL, baseMultiplier, powerupDuration, upgradeCost } from "./economy";
import { formatInt, formatMetres, formatSeconds } from "./format";

describe("upgrades", () => {
  it("costs rise and stop at the max level", () => {
    let prev = 0;
    for (let l = 0; l < MAX_UPGRADE_LEVEL; l++) {
      const c = upgradeCost(l);
      expect(c).not.toBeNull();
      expect(c ?? 0).toBeGreaterThan(prev);
      prev = c ?? 0;
    }
    expect(upgradeCost(MAX_UPGRADE_LEVEL)).toBeNull();
    expect(upgradeCost(99)).toBeNull();
    expect(upgradeCost(-3)).toBe(upgradeCost(0));
  });

  it("adds two seconds per level", () => {
    expect(powerupDuration("iman", 0)).toBe(POWERUPS.iman.baseDuration);
    expect(powerupDuration("jamon", 3)).toBe(POWERUPS.jamon.baseDuration + 6);
    expect(powerupDuration("patinete", 42)).toBe(POWERUPS.patinete.baseDuration + 10);
  });
});

describe("multiplier", () => {
  it("is 1 + completed sets, capped", () => {
    expect(baseMultiplier(0)).toBe(1);
    expect(baseMultiplier(3)).toBe(4);
    expect(baseMultiplier(500)).toBe(MAX_MULTIPLIER);
    expect(baseMultiplier(Number.NaN)).toBe(1);
  });
});

describe("format", () => {
  it("uses Spanish grouping", () => {
    expect(formatInt(0)).toBe("0");
    expect(formatInt(999)).toBe("999");
    expect(formatInt(1234)).toBe("1.234");
    expect(formatInt(1234567.9)).toBe("1.234.567");
    expect(formatInt(-1500)).toBe("-1.500");
    expect(formatMetres(350)).toBe("350 m");
    expect(formatSeconds(12)).toBe("12 s");
    expect(formatSeconds(12.5)).toBe("12,5 s");
  });
});
