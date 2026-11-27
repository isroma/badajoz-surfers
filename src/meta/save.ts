/**
 * Save data shape, defaults and defensive parsing (pure: no storage access here).
 * `parseSave` accepts anything (corrupt JSON, old versions, hand-edited values) and always
 * returns a valid SaveData.
 */
import { OUTFITS, POWERUPS, type OutfitId, type PowerupKind } from "../contracts";
import { clampLevel } from "./economy";
import { ACHIEVEMENTS, MAX_RECORDS, type DailyState, type Lifetime, type RunRecord } from "./progress";
import {
  drawMissions,
  emptyRunStats,
  getTemplate,
  initialMissions,
  targetOf,
  type ActiveMission,
  type MissionsState,
  type RunStats,
} from "./missions";

export const SAVE_VERSION = 3;
export const SAVE_KEY = "simpa.save.v3";
/** Keys of older formats that are read once and migrated (newest first). */
export const LEGACY_KEYS: readonly string[] = ["simpa.save.v2", "simpa.save.v1", "simpa.save"];

export interface Settings {
  music: boolean;
  sfx: boolean;
  /** Master volume 0..1. */
  volume: number;
}

export interface SaveData {
  version: number;
  wallet: number;
  bestScore: number;
  bestDistance: number;
  runsPlayed: number;
  upgrades: Record<PowerupKind, number>;
  missions: MissionsState;
  settings: Settings;
  /** The "Cómo se juega" screen has been shown once. */
  seenHowTo: boolean;
  /** The in-game tutorial was completed (a `hint: "complete"` event arrived). */
  tutorialDone: boolean;
  lifetime: Lifetime;
  /** Unlocked achievement ids. */
  achievements: string[];
  /** Top local runs, best first. */
  records: RunRecord[];
  daily: DailyState;
  /** Outfits bought (free ones are always owned) and the one equipped. */
  outfits: { owned: OutfitId[]; equipped: OutfitId };
}

const OUTFIT_IDS = new Set<string>(OUTFITS.map((o) => o.id));
const FREE_OUTFITS: OutfitId[] = OUTFITS.filter((o) => o.price === 0).map((o) => o.id);
export const DEFAULT_OUTFIT: OutfitId = FREE_OUTFITS[0] ?? "clasico";
const isOutfit = (v: unknown): v is OutfitId => typeof v === "string" && OUTFIT_IDS.has(v);

export const emptyLifetime = (): Lifetime => ({
  totals: emptyRunStats(),
  zonesSeen: 0,
  bestZones: 0,
  bestRun: { distance: 0, bellotas: 0, zones: 0, score: 0 },
});

const POWERUP_KINDS = Object.keys(POWERUPS) as PowerupKind[];

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    wallet: 0,
    bestScore: 0,
    bestDistance: 0,
    runsPlayed: 0,
    upgrades: { iman: 0, zapatillas: 0, jamon: 0, patinete: 0, ciguena: 0 },
    missions: initialMissions(),
    settings: { music: true, sfx: true, volume: 0.7 },
    seenHowTo: false,
    tutorialDone: false,
    lifetime: emptyLifetime(),
    achievements: [],
    records: [],
    daily: { date: "", progress: 0, done: false },
    outfits: { owned: [...FREE_OUTFITS], equipped: DEFAULT_OUTFIT },
  };
}

function parseOutfits(raw: unknown): SaveData["outfits"] {
  const r = isRecord(raw) ? raw : {};
  const list = Array.isArray(r["owned"]) ? r["owned"].filter(isOutfit) : [];
  const owned = [...new Set<OutfitId>([...FREE_OUTFITS, ...list])];
  const equipped = isOutfit(r["equipped"]) && owned.includes(r["equipped"]) ? r["equipped"] : DEFAULT_OUTFIT;
  return { owned, equipped };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A non-negative integer, or the fallback. */
function count(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), Number.MAX_SAFE_INTEGER) : fallback;
}

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

function parseMissions(raw: unknown): MissionsState {
  if (!isRecord(raw)) return initialMissions();
  const setsCompleted = count(raw["setsCompleted"]);
  const list = Array.isArray(raw["active"]) ? raw["active"] : [];
  const active: ActiveMission[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!isRecord(item)) continue;
    const id = item["id"];
    if (typeof id !== "string" || !getTemplate(id) || seen.has(id)) continue;
    seen.add(id);
    const target = targetOf(id, setsCompleted);
    const progress = Math.min(target, count(item["progress"]));
    active.push({ id, progress, done: bool(item["done"], false) || progress >= target });
  }
  if (active.length !== 3) return { setsCompleted, active: drawMissions(setsCompleted) };
  return { setsCompleted, active };
}

function parseLifetime(raw: unknown): Lifetime {
  const base = emptyLifetime();
  if (!isRecord(raw)) return base;
  const t = isRecord(raw["totals"]) ? raw["totals"] : {};
  const totals = { ...base.totals };
  for (const k of Object.keys(totals) as (keyof RunStats)[]) totals[k] = count(t[k]);
  const b = isRecord(raw["bestRun"]) ? raw["bestRun"] : {};
  return {
    totals,
    zonesSeen: count(raw["zonesSeen"]) & 0xffff,
    bestZones: count(raw["bestZones"]),
    bestRun: { distance: count(b["distance"]), bellotas: count(b["bellotas"]), zones: count(b["zones"]), score: count(b["score"]) },
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseRecords(raw: unknown): RunRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: RunRecord[] = [];
  for (const r of raw) {
    if (!isRecord(r)) continue;
    const date = typeof r["date"] === "string" && DAY.test(r["date"]) ? r["date"] : "";
    out.push({ date, score: count(r["score"]), distance: count(r["distance"]), zones: count(r["zones"]) });
  }
  return out.sort((a, b) => b.score - a.score || b.distance - a.distance).slice(0, MAX_RECORDS);
}

function parseDaily(raw: unknown): DailyState {
  if (!isRecord(raw) || typeof raw["date"] !== "string" || !DAY.test(raw["date"])) return { date: "", progress: 0, done: false };
  return { date: raw["date"], progress: count(raw["progress"]), done: bool(raw["done"], false) };
}

const ACHIEVEMENT_IDS = new Set(ACHIEVEMENTS.map((a) => a.id));

export function parseSave(raw: unknown): SaveData {
  const base = defaultSave();
  if (!isRecord(raw)) return base;
  // Version 0 (pre-release) stored the wallet as "bellotas" and had no version field.
  const wallet = raw["wallet"] ?? raw["bellotas"];
  const upgradesRaw = isRecord(raw["upgrades"]) ? raw["upgrades"] : {};
  const upgrades = { ...base.upgrades };
  for (const kind of POWERUP_KINDS) upgrades[kind] = clampLevel(count(upgradesRaw[kind]));
  const s = isRecord(raw["settings"]) ? raw["settings"] : {};
  const volume = typeof s["volume"] === "number" && Number.isFinite(s["volume"]) ? Math.min(1, Math.max(0, s["volume"])) : base.settings.volume;
  return {
    version: SAVE_VERSION,
    wallet: count(wallet),
    bestScore: count(raw["bestScore"]),
    bestDistance: count(raw["bestDistance"]),
    runsPlayed: count(raw["runsPlayed"]),
    upgrades,
    missions: parseMissions(raw["missions"]),
    settings: { music: bool(s["music"], true), sfx: bool(s["sfx"], true), volume },
    seenHowTo: bool(raw["seenHowTo"], count(raw["runsPlayed"]) > 0),
    // Players from version 1 already know the controls.
    tutorialDone: bool(raw["tutorialDone"], count(raw["runsPlayed"]) > 0),
    lifetime: parseLifetime(raw["lifetime"]),
    achievements: Array.isArray(raw["achievements"])
      ? [...new Set(raw["achievements"].filter((a): a is string => typeof a === "string" && ACHIEVEMENT_IDS.has(a)))]
      : [],
    records: parseRecords(raw["records"]),
    daily: parseDaily(raw["daily"]),
    outfits: parseOutfits(raw["outfits"]),
  };
}

/** Parse a JSON string from storage. Never throws. */
export function parseSaveJson(text: string | null): SaveData {
  if (text === null) return defaultSave();
  try {
    return parseSave(JSON.parse(text));
  } catch {
    return defaultSave();
  }
}
