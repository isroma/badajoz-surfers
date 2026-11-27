import { describe, expect, it } from "vitest";
import { FLIGHT_HEIGHT, LANE_WIDTH, OBSTACLE_DEFS, POWERUPS, ZONES, type GameEvent, type ObstacleKind } from "../contracts";
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
/** `lane` is relative to the centre lane (-1 left, 0 centre, 1 right). */
function put(run: Run, kind: ObstacleKind, lane: -1 | 0 | 1, front: number): void {
  const x = OBSTACLE_DEFS[kind].lanes === 3 ? 0 : lane * LANE_WIDTH;
  run.gen.obstacles.push({ id: ids++, kind, lane: lane + 1, x, d: front + OBSTACLE_DEFS[kind].length / 2, k: 0, seed: 1, flipped: false });
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
    expect(run.player.lane).toBe(1);
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
    for (let i = 0; i < 7; i++) run.gen.pickups.push({ id: 200000 + i, kind: "letra", lane: 1, x: 0, d: p + 10 + i * 6, y: 1 });
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

  it("stork flight: rises, flies over traffic, collects air bellotas, lands safely", () => {
    const { run, events } = startRunning(12);
    const s = run.player;
    run.gen.pickups.push({ id: 300000, kind: "ciguena", lane: 1, x: 0, d: s.p + 6, y: 1 });
    ticks(run, 0.6);
    expect(events.some((e) => e.type === "powerup-start" && e.kind === "ciguena")).toBe(true);
    expect(s.carried).toBe(true);
    ticks(run, 0.7);
    expect(s.y).toBeCloseTo(FLIGHT_HEIGHT, 1);
    // A wall of buses below is harmless, and lanes still work.
    for (const lane of [-1, 0, 1] as const) put(run, "bus", lane, s.p + 15);
    run.push("left");
    ticks(run, 0.5);
    expect(s.lane).toBe(0);
    const before = run.bellotas;
    // Put obstacles right where it will land: they must be cleared away.
    const landAt = s.p + s.speed * (POWERUPS.ciguena.baseDuration - 1.8);
    for (const lane of [-1, 0, 1] as const) put(run, "coche", lane, landAt);
    ticks(run, POWERUPS.ciguena.baseDuration);
    expect(s.carried).toBe(false);
    expect(run.phase).toBe("running");
    expect(run.removed.size).toBeGreaterThanOrEqual(3);
    expect(events.some((e) => e.type === "powerup-end" && e.kind === "ciguena")).toBe(true);
    expect(events.some((e) => e.type === "crash" || e.type === "stumble")).toBe(false);
    ticks(run, 0.5);
    expect(s.grounded).toBe(true);
    expect(s.y).toBe(0);
    expect(run.bellotas).toBeGreaterThanOrEqual(before);
  });

  it("stork flight: the autopilot steers into the air bellota lines", () => {
    const { run } = startRunning(13);
    const bot = new Bot();
    run.gen.pickups.push({ id: 300001, kind: "ciguena", lane: 1, x: 0, d: run.player.p + 6, y: 1 });
    const before = run.bellotas;
    for (let i = 0; i < 0.7 / TICK; i++) {
      bot.update(run);
      run.tick(TICK);
    }
    const air = run.gen.pickups.filter((p) => p.y > FLIGHT_HEIGHT).length;
    const length = run.player.speed * (POWERUPS.ciguena.baseDuration - 1.8);
    // About 3 bellotas per 10 m of cruise.
    expect(air).toBeGreaterThan((length / 10) * 2.4);
    for (let i = 0; i < 7 / TICK; i++) {
      bot.update(run);
      run.tick(TICK);
    }
    expect(run.bellotas - before).toBeGreaterThan(air * 0.7);
  });

  it("debug start zone: one consistent zone event and zone count", () => {
    const events: GameEvent[] = [];
    const run = new Run({
      seed: 5, powerupDuration: (k) => POWERUPS[k].baseDuration, baseMultiplier: () => 1,
      emit: (e) => events.push(e), fx: () => {},
    });
    run.begin("casco-antiguo");
    const zones = events.filter((e) => e.type === "zone");
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ type: "zone", first: true, zone: { id: "casco-antiguo" } });
    expect(ZONES[run.zonesCompleted % ZONES.length]?.id).toBe("casco-antiguo");
  });

  it("two letters on screen at once keep their own letters", () => {
    const { run, events } = startRunning(14);
    const p = run.player.p;
    run.gen.pickups.push({ id: 400000, kind: "letra", lane: 1, x: 0, d: p + 10, y: 1 });
    run.gen.pickups.push({ id: 400001, kind: "letra", lane: 1, x: 0, d: p + 30, y: 1 });
    // Both become visible (assigned) before the first is taken.
    expect(run.letterFor(400000)).toBe(0);
    expect(run.letterFor(400001)).toBe(1);
    ticks(run, 1.2);
    expect(run.letterFor(400001)).toBe(1);
    ticks(run, 2);
    const letters = events.flatMap((e) => (e.type === "pickup" && e.kind === "letra" ? [e.letterIndex] : []));
    expect(letters).toEqual([0, 1]);
    expect(run.summary().letters).toBe(2);
  });

  it("a missed letter hands its letter to the next one", () => {
    const { run, events } = startRunning(15);
    const p = run.player.p;
    run.gen.pickups.push({ id: 400010, kind: "letra", lane: 2, x: LANE_WIDTH, d: p + 10, y: 1 });
    run.gen.pickups.push({ id: 400011, kind: "letra", lane: 1, x: 0, d: p + 30, y: 1 });
    expect(run.letterFor(400010)).toBe(0);
    expect(run.letterFor(400011)).toBe(1);
    ticks(run, 3);
    const letters = events.flatMap((e) => (e.type === "pickup" && e.kind === "letra" ? [e.letterIndex] : []));
    expect(letters).toEqual([0]);
  });

  it("the HUD chaser starts as a head start and fades", () => {
    const { run } = makeRun(16);
    for (let i = 0; i < 1.6 / TICK; i++) run.tick(TICK);
    const start = run.chaser.hudValue;
    expect(start).toBeLessThanOrEqual(0.5);
    expect(start).toBeGreaterThan(0.3);
    ticks(run, 4.2);
    expect(run.chaser.hudValue).toBeLessThan(0.05);
  });
});
