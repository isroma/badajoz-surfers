/**
 * Runner physics and control state. Pure, no three.js: the same code drives the game, the
 * solvability tests and the autopilot's look-ahead.
 *
 * Lanes are indices into the lane layout at the runner's distance (see lanes.ts). When the layout
 * changes under the runner (a street with more or fewer lanes), the runner eases to the nearest
 * lane of the new layout.
 */
import { TRANSITION_LENGTH } from "../city/lanes";
import type { Aabb } from "./collision";
import { centreLane, laneKind, laneOffset, layoutAt, remapLane, type Flow, type LaneKind, type LaneLayout } from "./lanes";
import {
  COYOTE_TIME,
  FAST_FALL_SPEED,
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
  gravityFor,
} from "./tuning";

export type PlayerAction = "left" | "right" | "jump" | "roll";

export interface SurfaceHit {
  height: number;
  /** Spawn id of the walkable top, or -1 for the road. */
  id: number;
}

/** What the physics needs to know about the world (implemented by BoxSet). */
export interface PlayerWorld {
  /** Lane layout at a distance. */
  layout(p: number): LaneLayout;
  /** Called after the runner moved forward from `pPrev` to `p` this tick. */
  prepare(pPrev: number, p: number): void;
  surface(x: number, p: number, feetY: number): SurfaceHit;
  ceiling(x: number, halfWidth: number, p: number, feetY: number, standHeight: number): boolean;
  /**
   * The lane `lane` continues as after a layout boundary crossed between `fromS` and `toS`:
   * the new index, null when it ends there, undefined when unknown (fall back to the nearest lane).
   */
  mapLane?(fromS: number, toS: number, lane: number): number | null | undefined;
}

export interface PlayerState {
  /** Distance run (−z). */
  p: number;
  speed: number;
  x: number;
  /** Target lane (index into the layout). */
  lane: number;
  /** Lateral centre of the target lane when it was chosen (detects layout changes). */
  targetX: number;
  /** Lane before the current/last lane change (a side stumble bounces back to it). */
  prevLane: number;
  fromX: number;
  /** Lane change progress 0..1 (1 = done). */
  laneT: number;
  /** Duration (s) of the current lane change (longer across wide gaps and layout changes). */
  laneDur: number;
  /** Kind and flow of the target lane (to stay on the same side when the street changes). */
  laneKind: LaneKind;
  laneFlow: Flow;
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
  /** Seconds since the feet left a surface (0 while grounded). */
  air: number;
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
  /** Landing speed (m/s, positive) when `landed`. */
  impact: number;
  rolled: boolean;
  laneChanged: boolean;
  /** Tried to change lanes past the edge of the road (no lane there): -1 left, 1 right. */
  edgeBump: boolean;
  bumpDir: number;
  /** The lane layout changed and the runner is easing to the nearest lane. */
  laneRemapped: boolean;
}

export function createPlayer(p = 0, lane?: number, layout: LaneLayout = layoutAt(p)): PlayerState {
  const l = lane ?? centreLane(layout);
  const x = laneOffset(layout, l);
  return {
    p, speed: 0, x, lane: l, targetX: x, prevLane: l, fromX: x, laneT: 1, laneDur: LANE_CHANGE_TIME, queuedDir: 0,
    laneKind: laneKind(layout, l), laneFlow: layout.flow[l] ?? 0,
    y: 0, vy: 0, grounded: true, supportId: -1, coyote: 0, jumpBuffer: 0, roll: 0, rollQueued: false,
    superJump: false, carried: false, flightY: 0, air: 0, pp: p, px: x, py: 0, prolling: false,
  };
}

export function clonePlayer(s: PlayerState): PlayerState {
  return { ...s };
}

export function copyPlayer(into: PlayerState, from: PlayerState): PlayerState {
  return Object.assign(into, from);
}

export function createEvents(): StepEvents {
  return {
    jumped: false, superJumped: false, landed: false, impact: 0, rolled: false, laneChanged: false, edgeBump: false, bumpDir: 0,
    laneRemapped: false,
  };
}

/** Ease-in-out (cubic): the runner visibly crosses, accelerating then settling into the lane. */
export function laneEase(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Lane-change duration for a lateral distance: 0.22 s up to 3 m, 0.24 s for a 3.3 m lane,
 * 0.34 s across Puente Real's 5 m cable-plane median (and no longer beyond).
 */
export function laneChangeTime(distance: number): number {
  return LANE_CHANGE_TIME + Math.min(0.12, Math.max(0, (Math.abs(distance) - 3) * 0.06));
}

/** Gap (m) wider than this between neighbouring lanes is a non-runnable median (a vault across it). */
export const MEDIAN_GAP = 4.2;

function setTarget(s: PlayerState, layout: LaneLayout, lane: number): void {
  s.lane = lane;
  s.targetX = laneOffset(layout, lane);
  s.laneKind = laneKind(layout, lane);
  s.laneFlow = layout.flow[lane] ?? 0;
}

function startLaneChange(s: PlayerState, dir: number, layout: LaneLayout, ev: StepEvents): void {
  const n = layout.offsets.length;
  const target = Math.max(0, Math.min(n - 1, s.lane + dir));
  // Carried by the stork, no hops across a non-runnable median (bridge cables live there).
  const across = Math.abs(laneOffset(layout, target) - laneOffset(layout, s.lane)) > MEDIAN_GAP;
  if (target === s.lane || (s.carried && across)) {
    ev.edgeBump = true;
    ev.bumpDir = dir;
    return;
  }
  s.prevLane = s.lane;
  setTarget(s, layout, target);
  s.fromX = s.x;
  s.laneT = 0;
  s.laneDur = laneChangeTime(s.targetX - s.x);
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
export function bounceBack(s: PlayerState, layout: LaneLayout = layoutAt(s.p)): void {
  const back = Math.max(0, Math.min(layout.offsets.length - 1, s.prevLane));
  s.prevLane = s.lane;
  setTarget(s, layout, back);
  s.fromX = s.x;
  s.laneT = 0;
  s.laneDur = laneChangeTime(s.targetX - s.x);
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

/** Integrate one tick of the asymmetric jump gravity (exact for the gravity at the tick start). */
function fall(s: PlayerState, dt: number): void {
  const g = gravityFor(s.vy);
  s.y += s.vy * dt - 0.5 * g * dt * dt;
  s.vy = Math.max(s.vy - g * dt, -MAX_FALL_SPEED);
}

/**
 * Advance the runner by one fixed tick. `s.speed` must be set by the caller. Applies `actions`
 * (key presses since the last tick, in order). Fills `ev` (reset first).
 */
export function stepPlayer(s: PlayerState, actions: readonly PlayerAction[], dt: number, world: PlayerWorld, ev: StepEvents): void {
  ev.jumped = ev.superJumped = ev.landed = ev.rolled = ev.laneChanged = ev.edgeBump = ev.laneRemapped = false;
  ev.impact = 0;
  s.pp = s.p;
  s.px = s.x;
  s.py = s.y;
  s.prolling = s.roll > 0;

  // The street changed under us (more or fewer lanes, other widths): ease to the nearest lane of
  // the same kind and flow, over the layout transition (TRANSITION_LENGTH of running).
  const layout = world.layout(s.p);
  const n = layout.offsets.length;
  if (s.lane >= n || laneOffset(layout, s.lane) !== s.targetX || laneKind(layout, s.lane) !== s.laneKind) {
    // The road's own lane map first (the runner's world position stays continuous); a lane that
    // ends hands the runner to the nearest surviving lane (a nudge, announced ahead).
    const mapped = world.mapLane?.(s.pp - 0.5, s.p + 0.5, s.lane);
    const ended = mapped === null;
    const lane = typeof mapped === "number" && mapped < n ? mapped : remapLane(layout, ended ? s.x : s.targetX, s.laneKind, s.laneFlow);
    s.prevLane = lane;
    setTarget(s, layout, lane);
    s.fromX = s.x;
    s.laneT = Math.abs(s.targetX - s.x) < 1e-6 ? 1 : 0;
    s.laneDur = ended ? laneChangeTime(s.targetX - s.x) : Math.max(laneChangeTime(s.targetX - s.x), TRANSITION_LENGTH / Math.max(4, s.speed));
    s.queuedDir = 0;
    ev.laneRemapped = true;
  }

  for (const action of actions) {
    switch (action) {
      case "left":
      case "right": {
        const dir = action === "left" ? -1 : 1;
        if (s.laneT < 1) s.queuedDir = dir;
        else startLaneChange(s, dir, layout, ev);
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
    s.laneT = Math.min(1, s.laneT + dt / s.laneDur);
    s.x = s.fromX + (s.targetX - s.fromX) * laneEase(s.laneT);
    if (s.laneT >= 1) {
      s.x = s.targetX;
      if (s.queuedDir !== 0) {
        const dir = s.queuedDir;
        s.queuedDir = 0;
        startLaneChange(s, dir, layout, ev);
      }
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
    s.air = 0;
    return;
  }
  if (!s.grounded) {
    const prevY = s.y;
    fall(s, dt);
    s.air += dt;
    s.coyote = Math.max(0, s.coyote - dt);
    const hit = world.surface(s.x, s.p, Math.max(prevY, s.y));
    if (s.y <= hit.height) {
      if (s.vy <= 0) {
        ev.impact = -s.vy;
        s.y = hit.height;
        s.vy = 0;
        s.grounded = true;
        s.supportId = hit.id;
        s.coyote = 0;
        s.air = 0;
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
