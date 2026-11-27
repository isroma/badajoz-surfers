import { POWERUPS, type PowerupKind } from "../contracts";

export const MAX_UPGRADE_LEVEL = 5;
/** Cost in bellotas to go from level i to level i + 1. */
export const UPGRADE_COSTS: readonly number[] = [200, 600, 1500, 3500, 7500];
/** Extra seconds per upgrade level. */
export const SECONDS_PER_LEVEL = 2;
export const MAX_MULTIPLIER = 10;

export function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.min(MAX_UPGRADE_LEVEL, Math.max(0, Math.floor(level)));
}

/** Price of the next level, or null when the power-up is maxed out. */
export function upgradeCost(level: number): number | null {
  const l = clampLevel(level);
  return l >= MAX_UPGRADE_LEVEL ? null : (UPGRADE_COSTS[l] ?? null);
}

export function powerupDuration(kind: PowerupKind, level: number): number {
  return POWERUPS[kind].baseDuration + clampLevel(level) * SECONDS_PER_LEVEL;
}

/** Base score multiplier: one extra point for every completed mission set. */
export function baseMultiplier(setsCompleted: number): number {
  const sets = Number.isFinite(setsCompleted) ? Math.max(0, Math.floor(setsCompleted)) : 0;
  return Math.min(MAX_MULTIPLIER, 1 + sets);
}
