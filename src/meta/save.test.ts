import { describe, expect, it } from "vitest";
import { MetaStore, emptyRunStats, type KeyValueStorage } from "./index";
import { SAVE_KEY, defaultSave, parseSave, parseSaveJson } from "./save";

class MemoryStorage implements KeyValueStorage {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

class BrokenStorage implements KeyValueStorage {
  getItem(): string | null {
    throw new Error("SecurityError");
  }
  setItem(): void {
    throw new Error("QuotaExceeded");
  }
  removeItem(): void {
    throw new Error("SecurityError");
  }
}

describe("parseSave", () => {
  it("returns defaults for garbage", () => {
    for (const raw of [null, undefined, 42, "x", [], { wallet: "lots" }]) {
      const s = parseSave(raw);
      expect(s.wallet).toBe(0);
      expect(s.missions.active).toHaveLength(3);
    }
    expect(parseSaveJson("{not json")).toEqual(defaultSave());
    expect(parseSaveJson(null)).toEqual(defaultSave());
  });

  it("clamps and sanitises values", () => {
    const s = parseSave({
      wallet: -5,
      bestScore: 1234.7,
      upgrades: { iman: 9, jamon: -1, zapatillas: 2.9, nonsense: 3 },
      settings: { music: false, volume: 7 },
      missions: { setsCompleted: 2, active: [{ id: "jumps", progress: 9999 }, { id: "nope" }] },
    });
    expect(s.wallet).toBe(0);
    expect(s.bestScore).toBe(1234);
    expect(s.upgrades).toEqual({ iman: 5, zapatillas: 2, jamon: 0, patinete: 0 });
    expect(s.settings).toEqual({ music: false, sfx: true, volume: 1 });
    // Invalid mission list is redrawn for the stored set.
    expect(s.missions.setsCompleted).toBe(2);
    expect(s.missions.active).toHaveLength(3);
  });

  it("keeps a valid mission list and caps progress", () => {
    const s = parseSave({
      missions: {
        setsCompleted: 0,
        active: [
          { id: "jumps", progress: 500, done: false },
          { id: "rolls", progress: 3, done: false },
          { id: "runs", progress: 1, done: false },
        ],
      },
    });
    expect(s.missions.active[0]).toEqual({ id: "jumps", progress: 20, done: true });
    expect(s.missions.active[1]).toEqual({ id: "rolls", progress: 3, done: false });
  });

  it("migrates the version 0 wallet field", () => {
    const s = parseSave({ bellotas: 321, runsPlayed: 4 });
    expect(s.wallet).toBe(321);
    expect(s.seenHowTo).toBe(true);
    expect(s.version).toBe(1);
  });
});

describe("MetaStore", () => {
  it("persists and reloads", () => {
    const mem = new MemoryStorage();
    const a = new MetaStore(mem);
    a.addBellotas(1000);
    expect(a.buyUpgrade("iman")).toBe(true);
    const b = new MetaStore(mem);
    expect(b.save.wallet).toBe(800);
    expect(b.save.upgrades.iman).toBe(1);
    expect(b.gameOptions.powerupDuration("iman")).toBe(12);
    expect(JSON.parse(mem.getItem(SAVE_KEY) ?? "{}").version).toBe(1);
  });

  it("migrates from the legacy key", () => {
    const mem = new MemoryStorage();
    mem.setItem("simpa.save", JSON.stringify({ bellotas: 50 }));
    expect(new MetaStore(mem).save.wallet).toBe(50);
  });

  it("never throws without storage or with broken storage", () => {
    for (const s of [null, new BrokenStorage()]) {
      const m = new MetaStore(s);
      m.addBellotas(10);
      m.updateSettings({ music: false });
      expect(m.save.wallet).toBe(10);
      expect(() => m.reset()).not.toThrow();
    }
  });

  it("refuses upgrades it cannot afford", () => {
    const m = new MetaStore(null);
    m.addBellotas(199);
    expect(m.buyUpgrade("jamon")).toBe(false);
    expect(m.save.wallet).toBe(199);
  });

  it("finishRun adds bellotas, records and missions once", () => {
    const m = new MetaStore(null);
    m.beginRun();
    const r = m.finishRun({ ...emptyRunStats(), runs: 1, bellotas: 77, score: 900, distance: 420 });
    expect(r.bellotasEarned).toBe(77);
    expect(r.wallet).toBe(77);
    expect(r.newBestScore).toBe(true);
    expect(m.save.bestDistance).toBe(420);
    expect(m.save.runsPlayed).toBe(1);
    const r2 = m.finishRun({ ...emptyRunStats(), runs: 1, bellotas: 3, score: 100 });
    expect(r2.newBestScore).toBe(false);
    expect(m.save.wallet).toBe(80);
  });
});
