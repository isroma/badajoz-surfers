/**
 * Breadth-first search over the real runner physics: from a state, try every input at regular
 * decision points and keep the distinct states that survive. Used by the solvability tests (is
 * there any way through?) and by the autopilot (which first input leads to the best future?).
 * Pure, no three.js.
 */
import { BoxSet, type Aabb } from "./collision";
import {
  clonePlayer,
  createEvents,
  prevRunnerBox,
  runnerBox,
  stepPlayer,
  type PlayerAction,
  type PlayerState,
} from "./player";
import type { ObstacleSpawn, PickupSpawn } from "./spawns";
import { speedAt } from "./tuning";
import { laneX } from "../contracts";

export const SOLVER_ACTIONS: readonly (PlayerAction | null)[] = [null, "left", "right", "jump", "roll"];

export interface SolveOptions {
  /** Seconds between decisions. */
  decision: number;
  /** Physics step. */
  dt: number;
  /** Frontier cap per decision. */
  maxFrontier: number;
  /** Speed for a state (defaults to the planned speed at its distance). */
  speed?: (p: number) => number;
}

export interface SolveResult {
  ok: boolean;
  /** Furthest distance any surviving state reached. */
  reached: number;
}

function stateKey(s: PlayerState): string {
  return `${s.lane}|${s.queuedDir}|${Math.round(s.x * 2)}|${Math.round(s.y * 5)}|${Math.round(s.vy * 0.7)}|${s.grounded ? 1 : 0}|${Math.round(s.roll * 8)}|${s.rollQueued ? 1 : 0}`;
}

const boxA: Aabb = { xMin: 0, xMax: 0, yMin: 0, yMax: 0, dMin: 0, dMax: 0 };
const boxB: Aabb = { xMin: 0, xMax: 0, yMin: 0, yMax: 0, dMin: 0, dMax: 0 };
const events = createEvents();

/**
 * Advance `s` by `ticks` physics steps applying `action` at the first. Returns false on any
 * contact (the solver treats stumbles as failures too).
 */
export function simulate(s: PlayerState, action: PlayerAction | null, ticks: number, dt: number, world: BoxSet, speed: (p: number) => number): boolean {
  for (let t = 0; t < ticks; t++) {
    s.speed = speed(s.p);
    stepPlayer(s, t === 0 && action ? [action] : [], dt, world, events);
    if (world.contact(prevRunnerBox(s, boxA), runnerBox(s, boxB))) return false;
  }
  return true;
}

/** Can a perfect player get from `start` to distance `to`? */
export function solve(spawns: readonly ObstacleSpawn[], start: PlayerState, to: number, opts: SolveOptions): SolveResult {
  const world = new BoxSet(spawns);
  const speed = opts.speed ?? speedAt;
  let frontier: PlayerState[] = [clonePlayer(start)];
  let reached = start.p;
  while (frontier.length > 0) {
    const next = new Map<string, PlayerState>();
    for (const s of frontier) {
      for (const action of SOLVER_ACTIONS) {
        const c = clonePlayer(s);
        const ticks = Math.max(1, Math.round(opts.decision / opts.dt));
        if (!simulate(c, action, ticks, opts.dt, world, speed)) continue;
        reached = Math.max(reached, c.p);
        if (c.p >= to) return { ok: true, reached };
        const key = stateKey(c);
        if (!next.has(key)) next.set(key, c);
      }
    }
    frontier = [...next.values()];
    if (frontier.length > opts.maxFrontier) frontier.length = opts.maxFrontier;
  }
  return { ok: false, reached };
}

export interface PlanOptions extends SolveOptions {
  /** Look-ahead in seconds. */
  horizon: number;
  pickups: readonly PickupSpawn[];
  /** Ids of pickups already taken. */
  taken?: ReadonlySet<number>;
  /** Value of a pickup kind for the plan (bellota 1, power-ups more). */
  pickupValue: (p: PickupSpawn) => number;
  /** Obstacles to treat as gone (knocked away, already clipped). */
  ignore?: ReadonlySet<number>;
}

interface PlanNode {
  s: PlayerState;
  first: PlayerAction | null;
  score: number;
  actions: number;
  got: Set<number> | null;
}

/** Coarse bucket so the beam keeps a variety of lanes and vertical states. */
function bucket(s: PlayerState): number {
  const vertical = s.roll > 0 ? 0 : s.grounded ? (s.supportId >= 0 ? 1 : 2) : 3;
  return (s.lane + 1) * 4 + vertical;
}

/**
 * Pick the first input of the best survivable plan over the horizon. When nothing survives the
 * whole horizon, returns the first input of the plan that survived longest.
 */
export function plan(spawns: readonly ObstacleSpawn[], start: PlayerState, opts: PlanOptions): PlayerAction | null | undefined {
  const world = new BoxSet(spawns, opts.ignore ?? null);
  const speed = opts.speed ?? speedAt;
  const ticks = Math.max(1, Math.round(opts.decision / opts.dt));
  const steps = Math.ceil(opts.horizon / opts.decision);
  let frontier: PlanNode[] = [{ s: clonePlayer(start), first: null, score: 0, actions: 0, got: null }];
  let lastAlive: PlanNode | null = null;
  for (let step = 0; step < steps && frontier.length > 0; step++) {
    const next = new Map<string, PlanNode>();
    for (const node of frontier) {
      for (const action of SOLVER_ACTIONS) {
        const c = clonePlayer(node.s);
        const p0 = c.p;
        if (!simulate(c, action, ticks, opts.dt, world, speed)) continue;
        let score = node.score;
        let got = node.got;
        // Pickups swept this decision (lane and height check, generous).
        for (const pk of opts.pickups) {
          if (pk.d < p0 - 1 || pk.d > c.p + 1) continue;
          if (opts.taken?.has(pk.id) || got?.has(pk.id)) continue;
          if (Math.abs(laneX(pk.lane) - c.x) > 1.2) continue;
          if (pk.y < c.y - 0.3 || pk.y > c.y + 2.2) continue;
          got = new Set(got ?? []);
          got.add(pk.id);
          score += opts.pickupValue(pk);
        }
        const actions = node.actions + (action ? 1 : 0);
        const child: PlanNode = { s: c, first: step === 0 ? action : node.first, score: score - (action ? 0.05 : 0), actions, got };
        const key = stateKey(c);
        const prev = next.get(key);
        if (!prev || prev.score < child.score) next.set(key, child);
      }
    }
    const all = [...next.values()].sort((a, b) => b.score - a.score);
    if (all.length > opts.maxFrontier) {
      // Best of each bucket first (diversity), then the best of the rest.
      const kept: PlanNode[] = [];
      const seen = new Set<number>();
      const rest: PlanNode[] = [];
      for (const n of all) {
        const b = bucket(n.s);
        if (seen.has(b)) rest.push(n);
        else {
          seen.add(b);
          kept.push(n);
        }
      }
      for (const n of rest) {
        if (kept.length >= opts.maxFrontier) break;
        kept.push(n);
      }
      frontier = kept;
    } else frontier = all;
    if (frontier[0]) lastAlive = frontier[0];
  }
  if (!lastAlive) return undefined;
  if (frontier.length === 0) return lastAlive.first;
  // Prefer plans that end in the middle lane (more options later).
  let pick = frontier[0] ?? lastAlive;
  const bonus = (s: PlayerState): number => (s.lane === 0 ? 0.3 : 0);
  for (const n of frontier) if (n.score + bonus(n.s) > pick.score + bonus(pick.s)) pick = n;
  return pick.first;
}
