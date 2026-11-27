/**
 * Autopilot for automated playtesting: every 0.1 s it searches the next ~1.5 s of inputs with the
 * real physics (see solver.ts) and presses the first input of the best plan, preferring plans
 * that collect power-ups, letters and bellotas. Good, not perfect: the short horizon and coarse
 * physics step make it fail now and then.
 */
import type { PickupSpawn } from "./spawns";
import type { Run } from "./run";
import { plan } from "./solver";
import { TICK } from "./tuning";

const HORIZON = 1.4;
/** Replan every this many simulation ticks (exactly one planner decision). */
const DECISION_TICKS = 12;
const DECISION = DECISION_TICKS * TICK;

const value = (p: PickupSpawn): number => (p.kind === "bellota" ? 1 : p.kind === "letra" ? 8 : 6);

export class Bot {
  private ticks = 0;
  private readonly window: PickupSpawn[] = [];
  /** Milliseconds spent planning last time (for stats). */
  lastPlanMs = 0;

  reset(): void {
    this.ticks = 0;
  }

  /** Call once per simulation tick, before `run.tick()`. */
  update(run: Run): void {
    if (run.phase !== "running" || run.countdown > 0) return;
    if (this.ticks++ % DECISION_TICKS !== 0) return;
    const s = run.player;
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
      decision: DECISION,
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
    if (action) run.push(action);
  }
}
