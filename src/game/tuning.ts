/**
 * Gameplay tuning constants and the deterministic speed/difficulty curves, plus the zone schedule.
 * Pure: no three.js. Distances are metres along the run (distance = -z), times seconds.
 */
import { ZONES, type ZoneDef } from "../contracts";
import { onCourse } from "./course";

// --- Simulation -------------------------------------------------------------------------------
export const TICK_RATE = 120;
export const TICK = 1 / TICK_RATE;

// --- Runner physics ---------------------------------------------------------------------------
// Target feel (verified in player.test.ts):
// - jump: snappy rise, a slightly floaty ~80 ms apex, a faster fall; feet ≈ 1.75 m (zapatillas
//   ≈ 3.6 m) with ≈ 0.63 s of airtime (≈ 0.88 s super). No hold-to-jump-higher.
// - lane change 0.22-0.24 s on a 3-3.3 m lane (0.34 s across a 5 m median), ease-in-out.
// - roll 0.65 s, the hitbox is low from the first tick.
/** Gravity while rising. */
export const GRAVITY = 32;
/** Gravity scale in the apex band (|vy| < APEX_BAND) and while falling. */
export const APEX_GRAVITY_SCALE = 0.55;
export const FALL_GRAVITY_SCALE = 1.75;
/** Seconds spent in the floaty apex band. */
export const APEX_TIME = 0.08;
export const APEX_BAND = (GRAVITY * APEX_GRAVITY_SCALE * APEX_TIME) / 2;
export const JUMP_HEIGHT = 1.75;
export const SUPER_JUMP_HEIGHT = 3.6;
/** Take-off speed that peaks at `height` with the asymmetric gravity. */
export function jumpVelocityFor(height: number): number {
  const a = APEX_BAND;
  const apexGain = (a * a) / (2 * GRAVITY * APEX_GRAVITY_SCALE);
  return Math.sqrt(2 * GRAVITY * (height - apexGain) + a * a);
}
export const JUMP_VELOCITY = jumpVelocityFor(JUMP_HEIGHT); // ≈ 10.56 m/s
export const SUPER_JUMP_VELOCITY = jumpVelocityFor(SUPER_JUMP_HEIGHT); // ≈ 15.17 m/s
/** Gravity for a vertical speed (asymmetric jump). */
export function gravityFor(vy: number): number {
  if (vy > APEX_BAND) return GRAVITY;
  if (vy > -APEX_BAND) return GRAVITY * APEX_GRAVITY_SCALE;
  return GRAVITY * FALL_GRAVITY_SCALE;
}
/** Height of a jump from the ground `t` seconds after take-off (closed form, may go negative). */
export function jumpHeightAt(t: number, v0 = JUMP_VELOCITY): number {
  const a = APEX_BAND;
  const g1 = GRAVITY;
  const g2 = GRAVITY * APEX_GRAVITY_SCALE;
  const g3 = GRAVITY * FALL_GRAVITY_SCALE;
  const t1 = (v0 - a) / g1;
  if (t <= t1) return v0 * t - 0.5 * g1 * t * t;
  const h1 = v0 * t1 - 0.5 * g1 * t1 * t1;
  const t2 = (2 * a) / g2;
  if (t <= t1 + t2) {
    const u = t - t1;
    return h1 + a * u - 0.5 * g2 * u * u;
  }
  const u = t - t1 - t2;
  return h1 - a * u - 0.5 * g3 * u * u;
}
/** Seconds from take-off to the apex. */
export function jumpApexTime(v0 = JUMP_VELOCITY): number {
  return (v0 - APEX_BAND) / GRAVITY + APEX_TIME / 2;
}
/** Seconds in the air for a jump from and back to the same height. */
export function jumpAirtime(v0 = JUMP_VELOCITY): number {
  const a = APEX_BAND;
  const g3 = GRAVITY * FALL_GRAVITY_SCALE;
  const t1 = (v0 - a) / GRAVITY;
  const t2 = (2 * a) / (GRAVITY * APEX_GRAVITY_SCALE);
  const h = jumpHeightAt(t1 + t2, v0);
  return t1 + t2 + (-a + Math.sqrt(a * a + 2 * g3 * h)) / g3;
}
export const MAX_FALL_SPEED = 30;
export const FAST_FALL_SPEED = 22;
/** Lane change over a normal lane (≤ 3 m); longer across wider gaps (see laneChangeTime). */
export const LANE_CHANGE_TIME = 0.22;
export const ROLL_TIME = 0.65;
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

// --- Course: lap length and zone limits (the real route's once a course is installed) ---------
/** Length of one lap ("vuelta"). Live binding: the real route's once `setCourse` ran. */
export let LAP_LENGTH = ZONES.reduce((sum, zone) => sum + zone.length, 0);
/** Zone limits within a lap, in ZONES order. */
let ZONE_STARTS: number[] = [];
let ZONE_ENDS: number[] = [];
function useZones(lapLength: number, limits: readonly { id: string; fromS: number; toS: number }[] | null): void {
  LAP_LENGTH = lapLength;
  ZONE_STARTS = [];
  ZONE_ENDS = [];
  let acc = 0;
  for (const zone of ZONES) {
    const real = limits?.find((z) => z.id === zone.id);
    ZONE_STARTS.push(real ? real.fromS : acc);
    ZONE_ENDS.push(real ? real.toS : acc + zone.length);
    acc += zone.length;
  }
}
useZones(LAP_LENGTH, null);
onCourse((c) => useZones(c ? c.lapLength : ZONES.reduce((sum, zone) => sum + zone.length, 0), c ? c.zones : null));

/** Lap ("vuelta", 1-based) at a distance. */
export function lapAt(distance: number): number {
  return Math.max(1, Math.floor(distance / LAP_LENGTH) + 1);
}

/**
 * Planned running speed (without power-ups) at a distance. The real lap is 8.2 km: the first one
 * builds slowly (11 m/s at the start, ~18 at the first roundabouts' end, ~22 by the old town at
 * 5 km); each later lap starts faster and caps higher.
 */
export function speedAt(distance: number): number {
  const d = Math.max(0, distance);
  const lap = lapAt(d);
  const cap = Math.min(34, 24 + 2.5 * (lap - 1));
  const ramp = START_SPEED + 12.5 * (1 - Math.exp(-d / 2500)) + 2 * (lap - 1);
  return Math.min(cap, ramp);
}

/** 0..1 difficulty at a distance (full difficulty during the second lap). */
export function difficultyAt(distance: number): number {
  return Math.min(1, Math.max(0, distance) / 12000);
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

export function zoneAt(distance: number): ZoneSpan {
  const lapIndex = Math.floor(distance / LAP_LENGTH);
  const within = distance - lapIndex * LAP_LENGTH;
  let index = ZONES.length - 1;
  for (let i = 0; i < ZONES.length; i++) {
    if (within >= (ZONE_STARTS[i] ?? 0) && within < (ZONE_ENDS[i] ?? 0)) {
      index = i;
      break;
    }
  }
  const base = ZONES[index] ?? ZONES[0]!;
  const start = lapIndex * LAP_LENGTH + (ZONE_STARTS[index] ?? 0);
  const end = lapIndex * LAP_LENGTH + (ZONE_ENDS[index] ?? 0);
  const zone: ZoneDef = base.length === end - start ? base : { ...base, length: end - start };
  return { serial: lapIndex * ZONES.length + index, index, zone, lap: Math.max(1, lapIndex + 1), start, end };
}

/** Start distance of the zone with this ZONES index in a given lap (1-based). */
export function zoneStartDistance(index: number, lap: number): number {
  return (lap - 1) * LAP_LENGTH + (ZONE_STARTS[index] ?? 0);
}
