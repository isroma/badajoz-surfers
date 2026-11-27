/**
 * Runner physics and control state. Pure, no three.js: the same code drives the game, the
 * solvability tests and the autopilot's look-ahead.
 */
import { laneX, type Lane } from "../contracts";
import type { Aabb } from "./collision";
import {
  COYOTE_TIME,
  FAST_FALL_SPEED,
  GRAVITY,
  JUMP_BUFFER_TIME,
  JUMP_VELOCITY,
  LANE_CHANGE_TIME,
  MAX_FALL_SPEED,
  ROLL_HEIGHT,
  ROLL_TIME,
  RUNNER_HALF_DEPTH,
  RUNNER_HALF_WIDTH,
  STAND_HEIGHT,
  SUPER_JUMP_VELOCITY,
} from "./tuning";

export type PlayerAction = "left" | "right" | "jump" | "roll";

export interface SurfaceHit {
  height: number;
  /** Spawn id of the walkable top, or -1 for the road. */
  id: number;
}

/** What the physics needs to know about the world (implemented by BoxSet). */
export interface PlayerWorld {
  /** Called after the runner moved forward from `pPrev` to `p` this tick. */
  prepare(pPrev: number, p: number): void;
  surface(x: number, p: number, feetY: number): SurfaceHit;
  ceiling(x: number, halfWidth: number, p: number, feetY: number, standHeight: number): boolean;
}

export interface PlayerState {
  /** Distance run (−z). */
  p: number;
  speed: number;
  x: number;
  /** Target lane. */
  lane: Lane;
  /** Lane before the current/last lane change (a side stumble bounces back to it). */
  prevLane: Lane;
  fromX: number;
  /** Lane change progress 0..1 (1 = done). */
  laneT: number;
  /** One queued lane change: -1, 0 or 1. */
  queuedDir: number;
  y: number;
  vy: number;
  grounded: boolean;
  /** Spawn id we stand on, -1 = road. */
  supportId: number;
  coyote: number;
  jumpBuffer: number;
  /** Remaining roll time (> 0 = rolling). */
  roll: number;
  /** Fast-falling: roll as soon as we land. */
  rollQueued: boolean;
  superJump: boolean;
  /**
   * Carried by the stork: no gravity, jump and roll ignored, lanes still work. The feet follow
   * `flightY`, which the run animates (rise, cruise, descent).
   */
  carried: boolean;
  flightY: number;
  /** Previous tick values for swept collision. */
  pp: number;
  px: number;
  py: number;
  prolling: boolean;
}

export interface StepEvents {
  jumped: boolean;
  superJumped: boolean;
  landed: boolean;
  rolled: boolean;
  laneChanged: boolean;
  /** Tried to change lanes past the edge of the road. */
  edgeBump: boolean;
}

export function createPlayer(p = 0, lane: Lane = 0): PlayerState {
  const x = laneX(lane);
  return {
    p, speed: 0, x, lane, prevLane: lane, fromX: x, laneT: 1, queuedDir: 0,
    y: 0, vy: 0, grounded: true, supportId: -1, coyote: 0, jumpBuffer: 0, roll: 0, rollQueued: false,
    superJump: false, carried: false, flightY: 0, pp: p, px: x, py: 0, prolling: false,
  };
}

export function clonePlayer(s: PlayerState): PlayerState {
  return { ...s };
}

export function copyPlayer(into: PlayerState, from: PlayerState): PlayerState {
  return Object.assign(into, from);
}

export function createEvents(): StepEvents {
  return { jumped: false, superJumped: false, landed: false, rolled: false, laneChanged: false, edgeBump: false };
}

const clampLane = (lane: number): Lane => (lane <= -1 ? -1 : lane >= 1 ? 1 : 0);
/** Ease-out cubic: snappy start, soft arrival. */
const ease = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);

function startLaneChange(s: PlayerState, dir: number, ev: StepEvents): void {
  const target = clampLane(s.lane + dir);
  if (target === s.lane) {
    ev.edgeBump = true;
    return;
  }
  s.prevLane = s.lane;
  s.lane = target;
  s.fromX = s.x;
  s.laneT = 0;
  ev.laneChanged = true;
}

function startRoll(s: PlayerState, ev: StepEvents): void {
  s.roll = ROLL_TIME;
  s.rollQueued = false;
  s.jumpBuffer = 0;
  ev.rolled = true;
}

export function isRolling(s: PlayerState): boolean {
  return s.roll > 0;
}

export function isChangingLane(s: PlayerState): boolean {
  return s.laneT < 1;
}

/** A side stumble: go back to the lane we came from. */
export function bounceBack(s: PlayerState): void {
  const back = s.prevLane;
  s.prevLane = s.lane;
  s.lane = back;
  s.fromX = s.x;
  s.laneT = 0;
  s.queuedDir = 0;
}

export function runnerBox(s: PlayerState, out: Aabb): Aabb {
  out.xMin = s.x - RUNNER_HALF_WIDTH;
  out.xMax = s.x + RUNNER_HALF_WIDTH;
  out.yMin = s.y;
  out.yMax = s.y + (s.roll > 0 ? ROLL_HEIGHT : STAND_HEIGHT);
  out.dMin = s.p - RUNNER_HALF_DEPTH;
  out.dMax = s.p + RUNNER_HALF_DEPTH;
  return out;
}

export function prevRunnerBox(s: PlayerState, out: Aabb): Aabb {
  out.xMin = s.px - RUNNER_HALF_WIDTH;
  out.xMax = s.px + RUNNER_HALF_WIDTH;
  out.yMin = s.py;
  out.yMax = s.py + (s.prolling ? ROLL_HEIGHT : STAND_HEIGHT);
  out.dMin = s.pp - RUNNER_HALF_DEPTH;
  out.dMax = s.pp + RUNNER_HALF_DEPTH;
  return out;
}

/**
 * Advance the runner by one fixed tick. `s.speed` must be set by the caller. Applies `actions`
 * (key presses since the last tick, in order). Fills `ev` (reset first).
 */
export function stepPlayer(s: PlayerState, actions: readonly PlayerAction[], dt: number, world: PlayerWorld, ev: StepEvents): void {
  ev.jumped = ev.superJumped = ev.landed = ev.rolled = ev.laneChanged = ev.edgeBump = false;
  s.pp = s.p;
  s.px = s.x;
  s.py = s.y;
  s.prolling = s.roll > 0;

  for (const action of actions) {
    switch (action) {
      case "left":
      case "right": {
        const dir = action === "left" ? -1 : 1;
        if (s.laneT < 1) s.queuedDir = dir;
        else startLaneChange(s, dir, ev);
        break;
      }
      case "jump":
        if (!s.carried) s.jumpBuffer = JUMP_BUFFER_TIME;
        break;
      case "roll":
        if (s.carried) break;
        if (s.grounded) startRoll(s, ev);
        else {
          // Fast-fall into a roll.
          s.vy = Math.min(s.vy, -FAST_FALL_SPEED);
          s.rollQueued = true;
          s.jumpBuffer = 0;
        }
        break;
    }
  }

  // Jump (also cancels a roll); coyote time lets you jump just after running off a roof.
  if (s.jumpBuffer > 0 && (s.grounded || s.coyote > 0)) {
    s.roll = 0;
    s.rollQueued = false;
    s.vy = s.superJump ? SUPER_JUMP_VELOCITY : JUMP_VELOCITY;
    s.grounded = false;
    s.supportId = -1;
    s.coyote = 0;
    s.jumpBuffer = 0;
    ev.jumped = true;
    ev.superJumped = s.superJump;
    // A roll started earlier this very tick was cancelled by the jump: it never happened.
    ev.rolled = false;
  }
  s.jumpBuffer = Math.max(0, s.jumpBuffer - dt);

  // Lanes.
  if (s.laneT < 1) {
    s.laneT = Math.min(1, s.laneT + dt / LANE_CHANGE_TIME);
    const target = laneX(s.lane);
    s.x = s.fromX + (target - s.fromX) * ease(s.laneT);
    if (s.laneT >= 1 && s.queuedDir !== 0) {
      const dir = s.queuedDir;
      s.queuedDir = 0;
      startLaneChange(s, dir, ev);
    }
  }

  // Forward.
  s.p += s.speed * dt;
  world.prepare(s.pp, s.p);

  // Vertical.
  if (s.carried) {
    s.y = s.flightY;
    s.vy = 0;
    s.grounded = false;
    s.supportId = -1;
    s.roll = 0;
    s.rollQueued = false;
    s.coyote = 0;
    return;
  }
  if (!s.grounded) {
    s.vy = Math.max(s.vy - GRAVITY * dt, -MAX_FALL_SPEED);
    const prevY = s.y;
    s.y += s.vy * dt;
    s.coyote = Math.max(0, s.coyote - dt);
    const hit = world.surface(s.x, s.p, Math.max(prevY, s.y));
    if (s.y <= hit.height) {
      if (s.vy <= 0) {
        s.y = hit.height;
        s.vy = 0;
        s.grounded = true;
        s.supportId = hit.id;
        s.coyote = 0;
        ev.landed = true;
        if (s.rollQueued) startRoll(s, ev);
      } else {
        // Rising past the lip of a walkable top: lift the feet onto it and keep going.
        s.y = hit.height;
      }
    }
  } else {
    const hit = world.surface(s.x, s.p, s.y);
    if (hit.height >= s.y - 0.02) {
      s.y = hit.height;
      s.supportId = hit.id;
    } else {
      // Ran off the edge of a roof.
      s.grounded = false;
      s.supportId = -1;
      s.vy = 0;
      s.coyote = COYOTE_TIME;
    }
  }

  // Roll; stay down while something is overhead (forgiving).
  if (s.roll > 0) {
    s.roll -= dt;
    if (s.roll <= 0) {
      s.roll = world.ceiling(s.x, RUNNER_HALF_WIDTH, s.p, s.y, STAND_HEIGHT) ? dt : 0;
    }
  }
}
