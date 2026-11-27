import { describe, expect, it } from "vitest";
import { OBSTACLE_DEFS, POWERUPS, type GameEvent, type Lane, type ObstacleKind } from "../contracts";
import { Bot } from "./bot";
import { Run, type RunFx } from "./run";
import { TICK } from "./tuning";

function makeRun(seed: number, tutorial = false): { run: Run; events: GameEvent[]; fx: RunFx[] } {
  const events: GameEvent[] = [];
  const fx: RunFx[] = [];
  const run = new Run({
    seed,
    powerupDuration: (k) => POWERUPS[k].baseDuration,
    baseMultiplier: () => 1,
    emit: (e) => events.push(e),
    fx: (f) => fx.push(f),
    tutorial,
  });
  run.begin();
  return { run, events, fx };
}

function startRunning(seed: number): { run: Run; events: GameEvent[]; fx: RunFx[] } {
  const r = makeRun(seed);
  for (let i = 0; i < 1.6 / TICK; i++) r.run.tick(TICK);
  // Clear the generated track so the test controls what is ahead.
  r.run.gen.obstacles.length = 0;
  r.run.gen.pickups.length = 0;
  return r;
}

let ids = 100000;
function put(run: Run, kind: ObstacleKind, lane: Lane, front: number): void {
  run.gen.obstacles.push({ id: ids++, kind, lane, d: front + OBSTACLE_DEFS[kind].length / 2, k: 0, seed: 1, flipped: false });
  run.gen.obstacles.sort((a, b) => a.d - b.d);
}

function ticks(run: Run, seconds: number): void {
  for (let i = 0; i < seconds / TICK && run.phase !== "over"; i++) run.tick(TICK);
}

describe("run", () => {
  it("counts down 3-2-1-0 then runs", () => {
    const { run, events } = makeRun(1);
    for (let i = 0; i < 2 / TICK; i++) run.tick(TICK);
    const counts = events.filter((e) => e.type === "countdown").map((e) => (e.type === "countdown" ? e.value : -1));
    expect(counts).toEqual([3, 2, 1, 0]);
    expect(events[0]).toMatchObject({ type: "zone", first: true });
    expect(run.phase).toBe("running");
    expect(run.player.p).toBeGreaterThan(3);
  });

  it("without input the runner eventually crashes and the run ends", () => {
    const { run, events } = makeRun(2);
    for (let i = 0; i < 120 / TICK && run.phase !== "over"; i++) run.tick(TICK);
    expect(run.phase).toBe("over");
    const over = events.find((e) => e.type === "gameover");
    expect(over).toBeDefined();
    expect(events.some((e) => e.type === "crash" || e.type === "caught")).toBe(true);
  });

  it("the autopilot gets far and collects things", () => {
    let best = 0;
    for (const seed of [11, 12, 13]) {
      const { run, events } = makeRun(seed);
      const bot = new Bot();
      let maxPlan = 0;
      for (let i = 0; i < 150 / TICK && run.phase !== "over"; i++) {
        bot.update(run);
        maxPlan = Math.max(maxPlan, bot.lastPlanMs);
        run.tick(TICK);
      }
      best = Math.max(best, run.player.p);
      const summary = run.summary();
      // eslint-disable-next-line no-console
      console.info(`seed ${seed}: ${summary.distance} m, score ${summary.score}, bellotas ${summary.bellotas}, powerups ${summary.powerups}, jumps ${summary.jumps}, rolls ${summary.rolls}, near ${summary.nearMisses}, roof ${summary.roofMetres} m, zones ${summary.zonesCompleted}, ${run.phase === "over" ? summary.cause : "alive"}, stumbles ${events.filter((e) => e.type === "stumble").length}, max plan ${maxPlan.toFixed(1)} ms`);
      expect(summary.bellotas).toBeGreaterThan(20);
    }
    expect(best).toBeGreaterThan(1500);
  }, 120_000);

  it("a side stumble bounces back; a second one soon after gets you caught", () => {
    const { run, events } = startRunning(3);
    const p = run.player.p;
    put(run, "bus", -1, p - 2);
    run.push("left");
    ticks(run, 0.3);
    expect(events.some((e) => e.type === "stumble")).toBe(true);
    expect(run.player.lane).toBe(0);
    expect(run.chaser.value).toBeGreaterThan(0.8);
    put(run, "bus", 1, run.player.p - 2);
    run.push("right");
    ticks(run, 2);
    expect(events.some((e) => e.type === "caught")).toBe(true);
    const over = events.find((e) => e.type === "gameover");
    expect(over?.type === "gameover" && over.summary.cause).toBe("caught");
  });

  it("the patinete absorbs one crash", () => {
    const { run, events } = startRunning(4);
    run.powerups.push({ kind: "patinete", remaining: 10, duration: 10 });
    put(run, "coche", 0, run.player.p + 8);
    ticks(run, 1.5);
    expect(events.some((e) => e.type === "shield-break")).toBe(true);
    expect(events.some((e) => e.type === "crash")).toBe(false);
    expect(run.active("patinete")).toBeUndefined();
    put(run, "coche", 0, run.player.p + 10);
    ticks(run, 2);
    expect(events.some((e) => e.type === "crash")).toBe(true);
  });

  it("collecting the seven letters completes the word", () => {
    const { run, events } = startRunning(5);
    const p = run.player.p;
    for (let i = 0; i < 7; i++) run.gen.pickups.push({ id: 200000 + i, kind: "letra", lane: 0, d: p + 10 + i * 6, y: 1 });
    ticks(run, 5);
    const letters = events.flatMap((e) => (e.type === "pickup" && e.kind === "letra" ? [e.letterIndex] : []));
    expect(letters).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(events.some((e) => e.type === "word-complete")).toBe(true);
    expect(run.lettersCollected).toBe(0);
    expect(run.summary().wordsCompleted).toBe(1);
  });

  it("tutorial: prompts each step, forgives mistakes and hands over to normal play", () => {
    const { run, events } = makeRun(8, true);
    let slowed = false;
    const end = run.gen.tutorialEnd;
    for (let i = 0; i < 40 / TICK && run.phase !== "over" && run.player.p < end + 3; i++) {
      run.tick(TICK);
      if (run.timeScale < 0.7) slowed = true;
    }
    // No input at all: every obstacle is stumbled through, the run goes on.
    expect(run.phase).toBe("running");
    expect(run.player.p).toBeGreaterThan(end);
    expect(slowed).toBe(true);
    const hints = events.flatMap((e) => (e.type === "hint" ? [e.action] : []));
    expect(hints.slice(1)).toEqual(["done", "jump", "done", "roll", "done", "jump", "done", "complete"]);
    expect(events.some((e) => e.type === "stumble" || e.type === "crash" || e.type === "caught")).toBe(false);
    expect(run.timeScale).toBe(1);
  });

  it("tutorial: the autopilot performs each prompted action", () => {
    const { run, events } = makeRun(9, true);
    const bot = new Bot();
    for (let i = 0; i < 40 / TICK && run.phase !== "over" && run.player.p < 260; i++) {
      bot.update(run);
      run.tick(TICK);
    }
    expect(run.player.p).toBeGreaterThan(250);
    expect(events.some((e) => e.type === "hint" && e.action === "complete")).toBe(true);
    expect(run.jumps).toBeGreaterThanOrEqual(2);
    expect(run.rolls).toBeGreaterThanOrEqual(1);
  });

  it("resume countdowns are flagged", () => {
    const { run, events } = startRunning(10);
    run.startCountdown(false, true);
    ticks(run, 2);
    const resumed = events.filter((e) => e.type === "countdown" && e.resume === true).length;
    expect(resumed).toBe(4);
  });
});
