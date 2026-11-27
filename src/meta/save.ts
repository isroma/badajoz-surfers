/**
 * Save data shape, defaults and defensive parsing (pure: no storage access here).
 * `parseSave` accepts anything (corrupt JSON, old versions, hand-edited values) and always
 * returns a valid SaveData.
 */
import { POWERUPS, type PowerupKind } from "../contracts";
import { clampLevel } from "./economy";
import { drawMissions, getTemplate, initialMissions, targetOf, type ActiveMission, type MissionsState } from "./missions";

export const SAVE_VERSION = 1;
export const SAVE_KEY = "simpa.save.v1";
/** Keys of older formats that are read once and migrated. */
export const LEGACY_KEYS: readonly string[] = ["simpa.save"];

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
}

const POWERUP_KINDS = Object.keys(POWERUPS) as PowerupKind[];

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    wallet: 0,
    bestScore: 0,
    bestDistance: 0,
    runsPlayed: 0,
    upgrades: { iman: 0, zapatillas: 0, jamon: 0, patinete: 0 },
    missions: initialMissions(),
    settings: { music: true, sfx: true, volume: 0.8 },
    seenHowTo: false,
  };
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
