/**
 * Runner physics and control state. Pure, no three.js: the same code drives the game, the
 * solvability tests and the autopilot's look-ahead.
 *
 * Lanes are indices into the lane layout at the runner's distance (see lanes.ts). The runner's
 * lateral position is `laneX(lane, p) + drift + changeOffset`:
 * - `laneX` is the lane's own centre, a continuous function of the distance (on the real lap it
 *   blends across layout boundaries and tapers into the merge target where a lane ends, see
 *   lanes.ts `laneOffsetAt`), so the street changing under the runner carries them smoothly;
 * - `changeOffset` is the only thing lane-change input animates: a remap never blocks, queues or
 *   re-times a lane change;
 * - `drift` only absorbs a jump of a layout that is not continuous (test layouts without a track):
 *   it decays to 0 over TRANSITION_LENGTH of running.
 */
import { TRANSITION_LENGTH } from "../city/lanes";
import type { Aabb } from "./collision";
import { courseLaneX, centreLane, laneKind, laneOffset, layoutAt, remapLane, sameOffsets, type Flow, type LaneKind, type LaneLayout } from "./lanes";
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
   * Continuous lane geometry (the real lap): the lateral centre of `lane` (index in layout(p)) at
   * p, the index `lane` (in layout(fromS)) has at toS (undefined: cannot follow it), and whether
   * the lane is still there (not merged away). Without them the layout's offsets are used.
   */
  laneX?(lane: number, p: number): number;
  followLane?(fromS: number, toS: number, lane: number): number | undefined;
  laneOpen?(lane: number, p: number): boolean;
  /** Is the lane still offered (not past the midpoint of its taper: the HUD hides it)? */
  laneShown?(lane: number, p: number): boolean;
}

export interface PlayerState {
  /** Distance run (−z). */
  p: number;
  speed: number;
  x: number;
  /** Target lane (index into the layout at `p`). */
  lane: number;
  /** Where the current/last lane change started and was heading (world lateral, informational). */
  targetX: number;
  fromX: number;
  /** Lane before the current/last lane change (a side stumble bounces back to it). */
  prevLane: number;
  /** Lane change progress 0..1 (1 = done). */
  laneT: number;
  /** Duration (s) of the current lane change (longer across wide gaps). */
  laneDur: number;
  /** Lateral offset from the target lane's centre that the lane change eases out (0 when done). */
  changeOffset: number;
  /** changeOffset at the start of the current lane change. */
  changeFrom: number;
  /** Layout discontinuity being eased out (see the module comment): value at `driftAt`. */
  driftFrom: number;
  driftAt: number;
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
  /** The lane index changed under the runner (a layout boundary or a completed merge). */
  laneRemapped: boolean;
}

export function createPlayer(p = 0, lane?: number, layout: LaneLayout = layoutAt(p)): PlayerState {
  const l = lane ?? centreLane(layout);
  const x = courseLaneX(layout, l, p);
  return {
    p, speed: 0, x, lane: l, targetX: x, prevLane: l, fromX: x, laneT: 1, laneDur: LANE_CHANGE_TIME, queuedDir: 0,
    changeOffset: 0, changeFrom: 0, driftFrom: 0, driftAt: p,
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
 * Lane-change duration for a lateral distance: 0.18 s at 1.6 m, 0.22 s from 2.6 to 3 m, 0.24 s for a 3.3 m lane,
 * 0.34 s across Puente Real's 5 m cable-plane median (and no longer beyond).
 */
export function laneChangeTime(distance: number): number {
  const d = Math.abs(distance);
  // Shorter hops (the old town's 1.6 m lanes) are quicker: 0.18 s at 1.6 m.
  return LANE_CHANGE_TIME + Math.min(0.12, Math.max(0, (d - 3) * 0.06)) - Math.min(0.06, Math.max(0, (2.6 - d) * 0.04));
}

/** Gap (m) wider than this between neighbouring lanes is a non-runnable median (a vault across it). */
export const MEDIAN_GAP = 4.2;

/** Lateral centre of a lane at p (the world's continuous geometry when it has one). */
function laneXOf(world: PlayerWorld | null, layout: LaneLayout, lane: number, p: number): number {
  return world?.laneX ? world.laneX(lane, p) : laneOffset(layout, lane);
}

/** The drift still to ease out at distance p. */
export function driftAt(s: PlayerState, p = s.p): number {
  if (s.driftFrom === 0) return 0;
  const t = Math.min(1, Math.max(0, (p - s.driftAt) / TRANSITION_LENGTH));
  return s.driftFrom * (1 - t * t * (3 - 2 * t));
}

function setTarget(s: PlayerState, layout: LaneLayout, lane: number): void {
  s.lane = lane;
  s.laneKind = laneKind(layout, lane);
  s.laneFlow = layout.flow[lane] ?? 0;
}

/** Start easing from the current position into `lane` (no event). */
function moveTo(s: PlayerState, layout: LaneLayout, lane: number, world: PlayerWorld | null): void {
  const target = laneXOf(world, layout, lane, s.p);
  s.prevLane = s.lane;
  s.fromX = s.x;
  s.targetX = target;
  setTarget(s, layout, lane);
  s.changeFrom = s.x - driftAt(s) - target;
  s.changeOffset = s.changeFrom;
  s.laneT = Math.abs(s.changeFrom) < 1e-9 ? 1 : 0;
  s.laneDur = laneChangeTime(s.changeFrom);
}

/** The nearest lane in direction `dir` that is still there, or `from` when there is none. */
function neighbour(s: PlayerState, layout: LaneLayout, dir: number, world: PlayerWorld | null): number {
  const n = layout.offsets.length;
  for (let l = s.lane + dir; l >= 0 && l < n; l += dir) {
    if (world?.laneOpen && !world.laneOpen(l, s.p)) continue;
    // A lane past the midpoint of its taper is not offered (it is closing): an edge bump.
    if (world?.laneShown && !world.laneShown(l, s.p)) continue;
    return l;
  }
  return s.lane;
}

function startLaneChange(s: PlayerState, dir: number, layout: LaneLayout, ev: StepEvents, world: PlayerWorld | null): void {
  const target = neighbour(s, layout, dir, world);
  // Carried by the stork, no hops across a non-runnable median (bridge cables live there).
  const across = Math.abs(laneXOf(world, layout, target, s.p) - laneXOf(world, layout, s.lane, s.p)) > MEDIAN_GAP;
  if (target === s.lane || (s.carried && across)) {
    ev.edgeBump = true;
    ev.bumpDir = dir;
    return;
  }
  moveTo(s, layout, target, world);
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
export function bounceBack(s: PlayerState, layout: LaneLayout = layoutAt(s.p), world: PlayerWorld | null = null): void {
  let back = Math.max(0, Math.min(layout.offsets.length - 1, s.prevLane));
  if (world?.laneOpen && !world.laneOpen(back, s.p)) back = s.lane;
  moveTo(s, layout, back, world);
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
 * After moving from s.pp to s.p: keep `lane` (and `prevLane`) indexing the layout at s.p. With the
 * world's continuous geometry the lane is followed through the road's lane map and completed
 * merges and nothing else changes; otherwise (test layouts) the nearest lane of the same kind and
 * flow is taken and the jump becomes drift.
 */
function followStreet(s: PlayerState, before: LaneLayout, world: PlayerWorld, ev: StepEvents): void {
  const after = world.layout(s.p);
  const followed = world.followLane?.(s.pp, s.p, s.lane);
  if (followed !== undefined && followed < after.offsets.length) {
    if (followed !== s.lane || after !== before) {
      if (followed !== s.lane) ev.laneRemapped = true;
      const prev = world.followLane?.(s.pp, s.p, s.prevLane);
      setTarget(s, after, followed);
      s.prevLane = prev !== undefined && prev < after.offsets.length ? prev : followed;
    }
    return;
  }
  if (after === before || (sameOffsets(after, before) && s.lane < after.offsets.length)) {
    if (after !== before) setTarget(s, after, s.lane);
    return;
  }
  // A jump in the layout: the nearest lane of the same kind and flow; the position stays put.
  const xBefore = laneOffset(before, s.lane) + driftAt(s) + s.changeOffset;
  const lane = remapLane(after, laneOffset(before, s.lane), s.laneKind, s.laneFlow);
  setTarget(s, after, lane);
  s.prevLane = lane;
  s.driftFrom = xBefore - s.changeOffset - laneXOf(world, after, lane, s.p);
  s.driftAt = s.p;
  ev.laneRemapped = true;
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

  const layout = world.layout(s.p);
  for (const action of actions) {
    switch (action) {
      case "left":
      case "right": {
        const dir = action === "left" ? -1 : 1;
        if (s.laneT < 1) s.queuedDir = dir;
        else startLaneChange(s, dir, layout, ev, world);
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

  // Lane change: ease the offset from the target lane out.
  if (s.laneT < 1) {
    s.laneT = Math.min(1, s.laneT + dt / s.laneDur);
    s.changeOffset = s.changeFrom * (1 - laneEase(s.laneT));
    if (s.laneT >= 1) {
      s.changeOffset = 0;
      if (s.queuedDir !== 0) {
        const dir = s.queuedDir;
        s.queuedDir = 0;
        startLaneChange(s, dir, layout, ev, world);
      }
    }
  }

  // Forward.
  s.p += s.speed * dt;
  world.prepare(s.pp, s.p);
  followStreet(s, layout, world, ev);
  s.x = laneXOf(world, world.layout(s.p), s.lane, s.p) + driftAt(s) + s.changeOffset;

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
