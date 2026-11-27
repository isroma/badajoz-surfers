/**
 * Human-like autopilot study (skipped by default: ~90 s). Run with `STUDY=1 npx vitest run
 * src/game/human.study.test.ts` to print the distribution of death distances, zones and patterns
 * over 30 runs (vitest swallows console output of passing tests, so it writes to stdout).
 */
import { expect, it } from "vitest";
import { POWERUPS, type GameEvent } from "../contracts";
import { Bot, HUMAN } from "./bot";
import { Run } from "./run";
import { TICK, zoneAt } from "./tuning";
import { useRealCourse } from "./test-course";

useRealCourse();
/** Node globals (the project has no @types/node). */
declare const process: { env: Record<string, string | undefined>; stdout: { write(s: string): boolean } };
const study = typeof process !== "undefined" && process.env["STUDY"] === "1";
const out = (line: string): void => void process.stdout.write(`${line}\n`);

it.skipIf(!study)("human-like bot study over 30 seeds", () => {
  const rows: string[] = [];
  const dists: number[] = [];
  const byPat = new Map<string, number>();
  const byZone = new Map<string, number>();
  for (let seed = 1; seed <= 30; seed++) {
    const events: GameEvent[] = [];
    const run = new Run({ seed: seed * 4241, powerupDuration: (k) => POWERUPS[k].baseDuration, baseMultiplier: () => 1, emit: (e) => events.push(e), fx: () => {} });
    run.begin();
    const bot = new Bot({ ...HUMAN, seed });
    for (let i = 0; i < 420 / TICK; i++) { if (run.phase === "ending" || run.phase === "over") break; bot.update(run); run.tick(TICK); }
    const s = run.player;
    dists.push(s.p);
    if (run.phase === "running") { rows.push(`seed ${seed}: ALIVE ${s.p.toFixed(0)}`); continue; }
    const pat = run.gen.placed.filter((p) => p.start < s.p + 2 && p.end > s.p - 15).map((p) => p.name).join("+") || "gap";
    const zone = zoneAt(s.p).zone.id;
    byPat.set(pat, (byPat.get(pat) ?? 0) + 1);
    byZone.set(zone, (byZone.get(zone) ?? 0) + 1);
    const st = events.filter((e) => e.type === "stumble").length;
    const near = run.gen.obstacles.filter((o) => o.d - s.p < 14 && o.d - s.p > -8).map((o) => `${o.kind}[${o.lane}]@${(o.d - s.p).toFixed(1)}${o.k ? "k" : ""}`);
    rows.push(`seed ${seed}: ${s.p.toFixed(0)} m ${run.cause}${run.crashedOn ? ":" + run.crashedOn : ""} ${zone} pat=${pat} lane ${s.lane} y ${s.y.toFixed(2)} roll ${s.roll > 0} st ${st} v ${s.speed.toFixed(1)} near ${near.join(" ")}`);
  }
  dists.sort((a, b) => a - b);
  out(rows.join("\n"));
  out(["MEDIAN", dists[15]?.toFixed(0), "Q1", dists[7]?.toFixed(0), "Q3", dists[22]?.toFixed(0)].join(" "));
  out(`ZONES ${[...byZone].join(" | ")}`);
  out(`PATS ${[...byPat].sort((a, b) => b[1] - a[1]).join(" | ")}`);
}, 900000);

it("a human-like player gets well past the opening", () => {
  const dists: number[] = [];
  for (const seed of [3, 7, 11, 19]) {
    const run = new Run({ seed: seed * 4241, powerupDuration: (k) => POWERUPS[k].baseDuration, baseMultiplier: () => 1, emit: () => {}, fx: () => {} });
    run.begin();
    const bot = new Bot({ ...HUMAN, seed });
    for (let i = 0; i < 60 / TICK; i++) {
      if (run.phase === "ending" || run.phase === "over") break;
      bot.update(run);
      run.tick(TICK);
    }
    dists.push(run.player.p);
  }
  dists.sort((a, b) => a - b);
  expect(dists[2]).toBeGreaterThan(500);
}, 120000);