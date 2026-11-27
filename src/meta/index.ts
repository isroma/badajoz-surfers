/**
 * The persistent profile: wallet, records, upgrades, missions and settings, saved in
 * localStorage. Works (in memory only) when storage is unavailable, and never throws.
 */
import type { GameOptions, PowerupKind } from "../contracts";
import { baseMultiplier, powerupDuration, upgradeCost } from "./economy";
import { commitRun, describeMission, emptyRunStats, updateLive, type MissionView, type RunStats } from "./missions";
import { LEGACY_KEYS, SAVE_KEY, defaultSave, parseSaveJson, type SaveData, type Settings } from "./save";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): KeyValueStorage | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = "__simpa_probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export interface RunResult {
  bellotasEarned: number;
  wallet: number;
  newBestScore: boolean;
  newBestDistance: boolean;
  /** Missions completed by this run (including the ones already toasted mid-run). */
  completed: MissionView[];
  setCompleted: boolean;
  multiplier: number;
}

export class MetaStore {
  private data: SaveData;
  private readonly storage: KeyValueStorage | null;
  private readonly listeners = new Set<() => void>();
  /** Missions completed during the current run, kept for the game-over receipt. */
  private runCompleted: MissionView[] = [];

  constructor(storage: KeyValueStorage | null = browserStorage()) {
    this.storage = storage;
    this.data = this.load();
  }

  private load(): SaveData {
    if (!this.storage) return defaultSave();
    try {
      const current = this.storage.getItem(SAVE_KEY);
      if (current !== null) return parseSaveJson(current);
      for (const key of LEGACY_KEYS) {
        const old = this.storage.getItem(key);
        if (old !== null) return parseSaveJson(old);
      }
    } catch {
      // Storage blocked mid-session: fall through to defaults.
    }
    return defaultSave();
  }

  private persist(): void {
    try {
      this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      // Quota or privacy mode: keep playing with the in-memory copy.
    }
    for (const l of this.listeners) l();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get save(): Readonly<SaveData> {
    return this.data;
  }

  get settings(): Readonly<Settings> {
    return this.data.settings;
  }

  get multiplier(): number {
    return baseMultiplier(this.data.missions.setsCompleted);
  }

  readonly gameOptions: GameOptions = {
    powerupDuration: (kind) => powerupDuration(kind, this.data.upgrades[kind]),
    baseMultiplier: () => this.multiplier,
  };

  updateSettings(patch: Partial<Settings>): void {
    this.data = { ...this.data, settings: { ...this.data.settings, ...patch } };
    this.persist();
  }

  markHowToSeen(): void {
    if (this.data.seenHowTo) return;
    this.data = { ...this.data, seenHowTo: true };
    this.persist();
  }

  /** Buy the next level of a power-up. Returns false when maxed out or too expensive. */
  buyUpgrade(kind: PowerupKind): boolean {
    const level = this.data.upgrades[kind];
    const cost = upgradeCost(level);
    if (cost === null || this.data.wallet < cost) return false;
    this.data = {
      ...this.data,
      wallet: this.data.wallet - cost,
      upgrades: { ...this.data.upgrades, [kind]: level + 1 },
    };
    this.persist();
    return true;
  }

  missionViews(run: RunStats = emptyRunStats()): MissionView[] {
    const m = this.data.missions;
    return m.active.map((a) => describeMission(a, run, m.setsCompleted));
  }

  beginRun(): void {
    this.runCompleted = [];
  }

  /** Check the run in progress; returns missions that just got completed (for the toast). */
  updateRun(run: RunStats): MissionView[] {
    const { state, newlyDone } = updateLive(this.data.missions, run);
    if (newlyDone.length === 0) return [];
    const views = this.missionViews(run).filter((v) => newlyDone.includes(v.id));
    this.runCompleted.push(...views);
    this.data = { ...this.data, missions: state };
    this.persist();
    return views;
  }

  /** Commit a finished run. Call exactly once per run. */
  finishRun(run: RunStats): RunResult {
    const before = this.missionViews(run);
    const { state, newlyDone, setCompleted } = commitRun(this.data.missions, run);
    for (const v of before) {
      if (newlyDone.includes(v.id)) this.runCompleted.push({ ...v, done: true, label: "¡Hecho!", ratio: 1 });
    }
    const earned = Math.max(0, Math.floor(run.bellotas));
    const newBestScore = run.score > this.data.bestScore;
    const newBestDistance = run.distance > this.data.bestDistance;
    this.data = {
      ...this.data,
      wallet: this.data.wallet + earned,
      bestScore: Math.max(this.data.bestScore, Math.floor(run.score)),
      bestDistance: Math.max(this.data.bestDistance, Math.floor(run.distance)),
      runsPlayed: this.data.runsPlayed + 1,
      missions: state,
      seenHowTo: true,
    };
    this.persist();
    const completed = this.runCompleted;
    this.runCompleted = [];
    return {
      bellotasEarned: earned,
      wallet: this.data.wallet,
      newBestScore: newBestScore && run.score > 0,
      newBestDistance,
      completed,
      setCompleted,
      multiplier: this.multiplier,
    };
  }

  addBellotas(n: number): void {
    if (!Number.isFinite(n)) return;
    this.data = { ...this.data, wallet: Math.max(0, this.data.wallet + Math.floor(n)) };
    this.persist();
  }

  reset(): void {
    this.data = defaultSave();
    try {
      this.storage?.removeItem(SAVE_KEY);
      for (const key of LEGACY_KEYS) this.storage?.removeItem(key);
    } catch {
      // ignore
    }
    this.persist();
  }
}

export type { MissionView, RunStats } from "./missions";
export { emptyRunStats } from "./missions";
