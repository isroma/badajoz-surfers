/** Plain data produced by the track generator and consumed by the simulation and the scene. Pure. */
import type { Lane, ObstacleKind, PickupKind } from "../contracts";

export interface ObstacleSpawn {
  id: number;
  kind: ObstacleKind;
  /** Lane of the box centre; 3-lane obstacles always use 0. */
  lane: Lane;
  /**
   * Centre distance of the box. For a moving vehicle this is where its centre is when the
   * runner's centre passes it (the meeting point).
   */
  d: number;
  /**
   * Moving vehicles: speed towards the runner as a fraction of the runner's speed (0 = parked).
   * The vehicle centre is at `d + k * (d - p)` when the runner is at distance `p`, so the meeting
   * point is exact whatever the runner's real speed.
   */
  k: number;
  /** Variant seed for the art. */
  seed: number;
  /** Parked vehicles may face away from the runner (visual only, the box is symmetric). */
  flipped: boolean;
}

export interface PickupSpawn {
  id: number;
  /** For "letra" the engine decides which letter to show when it appears. */
  kind: PickupKind;
  lane: Lane;
  d: number;
  /** Height of the pickup centre above the road. */
  y: number;
}

/** Centre distance of an obstacle when the runner is at `p`. */
export function obstacleCentre(spawn: ObstacleSpawn, p: number): number {
  return spawn.k === 0 ? spawn.d : spawn.d + spawn.k * (spawn.d - p);
}
