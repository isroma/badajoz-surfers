/**
 * Gameplay tuning constants and the deterministic speed/difficulty curves, plus the zone schedule.
 * Pure: no three.js. Distances are metres along the run (distance = -z), times seconds.
 */
import { ZONES, type ZoneDef } from "../contracts";

// --- Simulation -------------------------------------------------------------------------------
export const TICK_RATE = 120;
export const TICK = 1 / TICK_RATE;

// --- Runner physics ---------------------------------------------------------------------------
export const GRAVITY = 27;
export const JUMP_HEIGHT = 1.75;
export const SUPER_JUMP_HEIGHT = 3.6;
export const JUMP_VELOCITY = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT); // ≈ 9.72 m/s, airtime ≈ 0.72 s
export const SUPER_JUMP_VELOCITY = Math.sqrt(2 * GRAVITY * SUPER_JUMP_HEIGHT); // ≈ 13.9 m/s, ≈ 1.03 s
export const MAX_FALL_SPEED = 30;
export const FAST_FALL_SPEED = 22;
export const LANE_CHANGE_TIME = 0.12;
export const ROLL_TIME = 0.7;
export const COYOTE_TIME = 0.1;
export const JUMP_BUFFER_TIME = 0.15;
/** Landing or running onto a walkable top this far above the feet still snaps up. */
export const STEP_UP = 0.35;

// Runner hitbox (slightly smaller than the visual body: forgiving).
export const RUNNER_HALF_WIDTH = 0.3;
export const RUNNER_HALF_DEPTH = 0.2;
export const STAND_HEIGHT = 1.75;
export const ROLL_HEIGHT = 0.75;
// Obstacle boxes are shrunk a little too.
export const OBSTACLE_SHRINK_X = 0.1;
export const OBSTACLE_SHRINK_TOP = 0.05;
/** Clipping an obstacle by less than this (feet below its top, or head above its bottom) is a stumble, not a crash. */
export const MARGINAL_CLIP = 0.3;

// --- Run --------------------------------------------------------------------------------------
export const START_SPEED = 11;
export const PATINETE_SPEED_FACTOR = 1.25;
export const STUMBLE_SLOWDOWN = 0.65; // speed factor right after a stumble, recovers over ~1 s
export const STUMBLE_WINDOW = 8; // a second stumble within this many seconds = caught
export const SHIELD_INVULNERABLE_TIME = 1.2;
export const MAGNET_RADIUS = 6;

// Stork flight ("ciguena").
export const FLIGHT_SPEED_FACTOR = 1.15;
/** Seconds to rise to FLIGHT_HEIGHT, and to glide back down at the end of the flight. */
export const FLIGHT_RISE_TIME = 0.6;
export const FLIGHT_DESCENT_TIME = 1.2;
/** No stork before this distance. */
export const FLIGHT_MIN_DISTANCE = 400;

export const LAP_LENGTH = ZONES.reduce((sum, zone) => sum + zone.length, 0);

/** Lap ("vuelta", 1-based) at a distance. */
export function lapAt(distance: number): number {
  return Math.max(1, Math.floor(distance / LAP_LENGTH) + 1);
}

/** Planned running speed (without power-ups) at a distance. Each lap starts faster and caps higher. */
export function speedAt(distance: number): number {
  const d = Math.max(0, distance);
  const lap = lapAt(d);
  const cap = Math.min(34, 24 + 2.5 * (lap - 1));
  const ramp = START_SPEED + 13 * (1 - Math.exp(-d / 1400)) + 2 * (lap - 1);
  return Math.min(cap, ramp);
}

/** 0..1 difficulty at a distance. */
export function difficultyAt(distance: number): number {
  return Math.min(1, Math.max(0, distance) / 7000);
}

/** Minimum time between two forced actions on the intended line. */
export function reactionWindow(difficulty: number): number {
  return 0.65 - 0.12 * difficulty;
}

// --- Zone schedule ----------------------------------------------------------------------------
export interface ZoneSpan {
  /** Global zone counter since the start of the run (0 = first Puente Real). */
  serial: number;
  /** Index into ZONES. */
  index: number;
  zone: ZoneDef;
  lap: number;
  start: number;
  end: number;
}

const ZONE_STARTS: number[] = [];
{
  let acc = 0;
  for (const zone of ZONES) {
    ZONE_STARTS.push(acc);
    acc += zone.length;
  }
}

export function zoneAt(distance: number): ZoneSpan {
  const lapIndex = Math.floor(distance / LAP_LENGTH);
  const within = distance - lapIndex * LAP_LENGTH;
  let index = ZONES.length - 1;
  for (let i = 0; i < ZONES.length; i++) {
    const start = ZONE_STARTS[i] ?? 0;
    const zone = ZONES[i];
    if (zone && within >= start && within < start + zone.length) {
      index = i;
      break;
    }
  }
  const zone = ZONES[index] ?? ZONES[0]!;
  const start = lapIndex * LAP_LENGTH + (ZONE_STARTS[index] ?? 0);
  return { serial: lapIndex * ZONES.length + index, index, zone, lap: Math.max(1, lapIndex + 1), start, end: start + zone.length };
}

/** Start distance of the zone with this ZONES index in a given lap (1-based). */
export function zoneStartDistance(index: number, lap: number): number {
  return (lap - 1) * LAP_LENGTH + (ZONE_STARTS[index] ?? 0);
}
