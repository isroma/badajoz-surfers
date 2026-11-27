/**
 * Autopilot for automated playtesting: every 0.1 s it searches the next ~1.5 s of inputs with the
 * real physics (see solver.ts) and presses the first input of the best plan, preferring plans
 * that collect power-ups, letters and bellotas. Good, not perfect: the short horizon and coarse
 * physics step make it fail now and then.
 */
import { BoxSet } from "./collision";
import { clonePlayer, type PlayerAction } from "./player";
import { createRng, type Rng } from "./rng";
import type { PickupSpawn } from "./spawns";
import type { Run } from "./run";
import { plan, simulate } from "./solver";
import { TICK } from "./tuning";

/**
 * Human-like limits (tests only): it reacts to the world as it was `reaction` seconds ago (it
 * plans from the predicted state `reaction` seconds ahead with no input, then the input lands
 * then), presses at most one input every `minInterval` seconds, and misses `missChance` of them.
 */
export interface HumanLimits {
  reaction: number;
  minInterval: number;
  missChance: number;
  seed: number;
}

export const HUMAN: Omit<HumanLimits, "seed"> = { reaction: 0.28, minInterval: 0.22, missChance: 0.03 };

const HORIZON = 1.4;
/** Replan every this many simulation ticks (exactly one planner decision). */
const DECISION_TICKS = 12;
const DECISION = DECISION_TICKS * TICK;
/** The human-like planner assumes it can only act every 0.2 s. */
const HUMAN_DECISION = 24 * TICK;

const value = (p: PickupSpawn): number => (p.kind === "bellota" ? 1 : p.kind === "letra" ? 8 : 6);

export class Bot {
  private ticks = 0;
  private readonly rng: Rng | null;
  /** Human mode: the pending input and when it lands (in ticks), and the last input time. */
  private readonly queue: { action: PlayerAction; at: number }[] = [];
  private lastInput = -1e9;
  private readonly reactionTicks: number;
  private readonly intervalTicks: number;

  constructor(private readonly human: HumanLimits | null = null) {
    this.rng = human ? createRng(human.seed) : null;
    this.reactionTicks = human ? Math.round(human.reaction / TICK) : 0;
    this.intervalTicks = human ? Math.round(human.minInterval / TICK) : 0;
  }
  private readonly window: PickupSpawn[] = [];
  /** Milliseconds spent planning last time (for stats). */
  lastPlanMs = 0;

  reset(): void {
    this.ticks = 0;
    this.queue.length = 0;
    this.lastInput = -1e9;
  }

  /** Call once per simulation tick, before `run.tick()`. */
  update(run: Run): void {
    if (run.phase !== "running" || run.countdown > 0) return;
    const tick = this.ticks++;
    if (this.human) {
      this.updateHuman(run, tick);
      return;
    }
    if (tick % DECISION_TICKS !== 0) return;
    const action = this.decide(run, run.player);
    if (action) run.push(action);
  }

  private updateHuman(run: Run, tick: number): void {
    const human = this.human;
    if (!human || !this.rng) return;
    // Inputs whose reaction time has elapsed land now.
    while (this.queue.length > 0 && (this.queue[0]?.at ?? Infinity) <= tick) {
      const next = this.queue.shift();
      if (next && !this.rng.chance(human.missChance)) run.push(next.action);
    }
    if (tick % DECISION_TICKS !== 0) return;
    // What the player sees now only acts after the reaction delay: predict that moment (with the
    // inputs already on their way) and plan from there.
    const future = clonePlayer(run.player);
    const world = new BoxSet(run.gen.obstacles, run.ignore);
    const speed = Math.max(1, future.speed);
    for (let k = 0; k < this.reactionTicks; k++) {
      const queued = this.queue.find((q) => q.at === tick + k) ?? null;
      simulate(future, queued ? queued.action : null, 1, TICK, world, () => speed);
    }
    const action = this.decide(run, future, HUMAN_DECISION);
    if (!action) return;
    const last = this.queue[this.queue.length - 1]?.at ?? this.lastInput;
    const at = Math.max(tick + this.reactionTicks, last + this.intervalTicks);
    this.queue.push({ action, at });
    this.lastInput = at;
  }

  private decide(run: Run, s: Run["player"], decision = DECISION): PlayerAction | null | undefined {
    const speed = Math.max(1, s.speed);
    const reach = s.p + speed * HORIZON + 4;
    this.window.length = 0;
    for (const p of run.gen.pickups) {
      if (p.d < s.p - 1) continue;
      if (p.d > reach) break;
      if (!run.taken.has(p.id)) this.window.push(p);
    }
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    const action = plan(run.gen.obstacles, s, {
      decision,
      dt: TICK,
      maxFrontier: 18,
      horizon: HORIZON,
      pickups: this.window,
      taken: run.taken,
      ignore: run.ignore,
      speed: () => speed,
      pickupValue: value,
    });
    if (typeof performance !== "undefined") this.lastPlanMs = performance.now() - t0;
    return action;
  }
}
