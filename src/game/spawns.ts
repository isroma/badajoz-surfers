/**
 * Plain data produced by the track generator and consumed by the simulation and the scene, and
 * the trajectories of moving vehicles. Pure.
 *
 * Traffic lives in track space and is a function of the runner's distance `p`, not of time: a
 * vehicle's centre is `d0 + k * (d0 - p)` (k > 0 drives towards the runner at k times the
 * runner's speed, k < 0 drives away from it at |k| times its speed). This makes every meeting
 * point exact whatever the runner's real speed (patinete, stumbles, slow-mo), keeps the solver and
 * the bots deterministic, and means a vehicle is, for collisions, equivalent to a static
 * obstacle occupying a fixed stretch of the runner's distance (its "footprint").
 */
import type { ObstacleKind, PickupKind } from "../contracts";

/** Visual flavour of a vehicle that is not driving (the art may read it from `userData.role`). */
export type VehicleRole = "parked" | "lights" | "bus-stop" | "broken";

export interface ObstacleSpawn {
  id: number;
  kind: ObstacleKind;
  /** Lane index in the layout at `d` (full-width obstacles: the lane nearest the road centre). */
  lane: number;
  /** Lateral centre of the box (track space, metres). */
  x: number;
  /** Full-width obstacles: the width they cover (all lanes). Others use OBSTACLE_DEFS. */
  span?: number;
  /**
   * Distance where the runner's centre meets the box centre (the meeting point). Static
   * obstacles: their centre. Used for sorting and windowing.
   */
  d: number;
  /** Moving vehicles: see the module comment (0 = static). */
  k: number;
  /** Moving vehicles: free-flow meeting distance (defaults to `d`; differs when it stops). */
  d0?: number;
  /**
   * Same-direction vehicles: centre distance where they brake to a halt (a traffic light, the
   * back of a queue). They decelerate smoothly over the last BRAKE_DISTANCE metres.
   */
  stop?: number;
  /** Same-direction vehicles that stop: the stop line (signal, crossing, zone light) they queue at. */
  stopLine?: number;
  /** Variant seed for the art. */
  seed: number;
  /** Parked vehicles may face away from the runner (visual only, the box is symmetric). */
  flipped: boolean;
  /** Not driving: why (visual only). */
  role?: VehicleRole;
  /**
   * Moving vehicles on a lane that changes flow at a boundary (an oncoming lane that becomes a
   * ring lane): the vehicle exists only while its centre is short of this distance; it comes out
   * of (or turns off at) that boundary, behind the splitter island, never through it.
   */
  beyond?: number;
}

export interface PickupSpawn {
  id: number;
  /** For "letra" the engine decides which letter to show when it appears. */
  kind: PickupKind;
  lane: number;
  /** Lateral position (track space). */
  x: number;
  /** Where the runner meets it (its position, or where it is when met if it rides a vehicle). */
  d: number;
  /** Height of the pickup centre above the road. */
  y: number;
  /** Rides on a moving vehicle's roof: `off` metres from its centre. */
  ride?: { spawn: Trajectory; off: number };
}

/** Metres of free-flow travel over which a stopping vehicle brakes (it covers half of it). */
export const BRAKE_DISTANCE = 7;

/** Centre distance of an obstacle when the runner is at `p`. */
export function obstacleCentre(spawn: Trajectory, p: number): number {
  const k = spawn.k;
  if (k === 0) return spawn.d;
  const base = spawn.d0 ?? spawn.d;
  const free = base + k * (base - p);
  const stop = spawn.stop;
  if (stop === undefined || k > 0) return free;
  // Smooth halt: C1 quadratic blend from free flow to standing at `stop`.
  const L = BRAKE_DISTANCE / 2;
  const e = stop - free;
  if (e >= L) return free;
  if (e <= -L) return stop;
  return stop - ((e + L) * (e + L)) / (4 * L);
}

/** d(centre)/d(runner distance): the vehicle's world speed as a fraction of the runner's (signed, +forward). */
export function obstacleRate(spawn: Trajectory, p: number): number {
  if (spawn.k === 0) return 0;
  const h = 0.05;
  return (obstacleCentre(spawn, p + h) - obstacleCentre(spawn, p - h)) / (2 * h);
}

/**
 * Runner distance at which the runner's centre meets the vehicle's centre. `c(p) - p` is
 * strictly decreasing (vehicles are slower than the runner), so bisection is exact.
 */
export function meetingPoint(spawn: Trajectory): number {
  if (spawn.k === 0) return spawn.d;
  const base = spawn.d0 ?? spawn.d;
  let lo = base - 4000;
  let hi = base + 4000;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (obstacleCentre(spawn, mid) - mid > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Runner distance at which the vehicle centre is `ahead` metres ahead of the runner (negative = behind). */
export function whenAhead(spawn: Trajectory, ahead: number): number {
  const base = spawn.d0 ?? spawn.d;
  let lo = base - 4000;
  let hi = base + 4000;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (obstacleCentre(spawn, mid) - mid > ahead) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The fields that define where an obstacle is. */
export type Trajectory = Pick<ObstacleSpawn, "d" | "k" | "d0" | "stop"> & { beyond?: number };

/** Runner distance at which the vehicle's centre is at `c` (monotonic in p for a moving vehicle). */
export function whenCentre(spawn: Trajectory, c: number): number {
  const base = spawn.d0 ?? spawn.d;
  let lo = base - 4000;
  let hi = base + 4000;
  // k > 0 comes towards the runner (centre falls as p grows); k < 0 drives on (centre grows).
  const falling = spawn.k > 0;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    const at = obstacleCentre(spawn, mid);
    if (falling ? at > c : at < c) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Distance of a pickup when the runner is at `p`. */
export function pickupD(pk: PickupSpawn, p: number): number {
  return pk.ride ? obstacleCentre(pk.ride.spawn, p) + pk.ride.off : pk.d;
}

/**
 * The stretch of runner distance where the runner's box overlaps the obstacle lengthwise, shrunk
 * by the runner's half depth on both sides so a static obstacle's footprint is its own length.
 */
export function footprint(spawn: Trajectory, length: number, halfDepth: number): [number, number] {
  const half = length / 2;
  if (spawn.k === 0) return [spawn.d - half, spawn.d + half];
  if (spawn.stop === undefined) {
    // Free flow: closed form (exact).
    const base = spawn.d0 ?? spawn.d;
    const e = (half + halfDepth) / (1 + spawn.k) - halfDepth;
    return [base - e, base + e];
  }
  return [whenAhead(spawn, half + halfDepth) + halfDepth, whenAhead(spawn, -(half + halfDepth)) - halfDepth];
}
