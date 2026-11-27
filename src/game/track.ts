/**
 * Seeded, pattern-based track generator: obstacle and pickup spawns for the stretch ahead.
 * Pure: no three.js. Deterministic for a given seed and sequence of calls.
 */
import { OBSTACLE_DEFS, type Lane, type PowerupKind } from "../contracts";
import {
  PATTERNS,
  PatternBuilder,
  moverEffectiveHalf,
  patternWeights,
  type LaneReservation,
  type ObstacleDraft,
  type PatternContext,
  type PatternName,
  type RewardSlot,
} from "./patterns";
import { createRng, type Rng } from "./rng";
import type { ObstacleSpawn, PickupSpawn } from "./spawns";
import { difficultyAt, reactionWindow, speedAt, zoneAt } from "./tuning";

/** Nothing is placed this close to the start or end of a zone (room for the zone banner). */
export const ZONE_MARGIN = 25;
/** A fresh run starts with this much empty road... */
export const EMPTY_START = 40;
/** ...followed by very easy patterns until here. */
export const EASY_UNTIL = 120;

const POWERUP_KINDS: readonly PowerupKind[] = ["iman", "zapatillas", "jamon", "patinete"];

export interface PlacedPattern {
  name: PatternName;
  start: number;
  end: number;
}

function draftInterval(o: ObstacleDraft): [number, number] {
  if (o.k > 0) {
    const half = moverEffectiveHalf(o.kind, o.k);
    return [o.d - half, o.d + half];
  }
  const half = OBSTACLE_DEFS[o.kind].length / 2;
  return [o.d - half, o.d + half];
}

export class TrackGenerator {
  /** Sorted by `d`. */
  readonly obstacles: ObstacleSpawn[] = [];
  /** Sorted by `d`. */
  readonly pickups: PickupSpawn[] = [];
  readonly placed: PlacedPattern[] = [];
  private readonly rng: Rng;
  private cursor: number;
  private line: Lane = 0;
  private nextId = 1;
  private nextPowerupAt: number;
  private nextLetterAt: number;
  private lastPowerup: PowerupKind | null = null;
  private reservations: LaneReservation[] = [];
  private fresh: boolean;

  constructor(seed: number, startDistance = 0) {
    this.rng = createRng(seed);
    this.fresh = startDistance <= 0;
    this.cursor = this.fresh ? EMPTY_START : startDistance + ZONE_MARGIN;
    this.nextPowerupAt = this.cursor + this.rng.range(160, 260);
    this.nextLetterAt = this.cursor + this.rng.range(90, 160);
  }

  /** Where generation has reached. */
  get generatedUntil(): number {
    return this.cursor;
  }

  /** Throw everything away and continue from `distance` (used by the debug warp). */
  restartAt(distance: number): void {
    this.obstacles.length = 0;
    this.pickups.length = 0;
    this.reservations = [];
    this.fresh = false;
    this.cursor = distance + ZONE_MARGIN;
    this.nextPowerupAt = this.cursor + this.rng.range(60, 160);
    this.nextLetterAt = this.cursor + this.rng.range(40, 120);
  }

  /** Drop spawns well behind `distance`. */
  prune(distance: number): void {
    const cut = distance - 40;
    let i = 0;
    while (i < this.obstacles.length && (this.obstacles[i]?.d ?? Infinity) < cut) i++;
    if (i > 0) this.obstacles.splice(0, i);
    let j = 0;
    while (j < this.pickups.length && (this.pickups[j]?.d ?? Infinity) < cut) j++;
    if (j > 0) this.pickups.splice(0, j);
    if (this.placed.length > 200) this.placed.splice(0, this.placed.length - 100);
    this.reservations = this.reservations.filter((r) => r.to > cut);
  }

  generateUntil(distance: number): void {
    let guard = 0;
    while (this.cursor < distance && guard++ < 1000) this.step();
  }

  private context(at: number, easy: boolean): PatternContext {
    const span = zoneAt(at);
    const difficulty = difficultyAt(at);
    return {
      rng: this.rng,
      v: speedAt(at),
      difficulty,
      reaction: reactionWindow(difficulty),
      zone: span.zone.id,
      zoneT: (at - span.start) / span.zone.length,
      entryLane: this.line,
      easy,
      lap: span.lap,
    };
  }

  private step(): void {
    const span = zoneAt(this.cursor);
    if (this.cursor < span.start + ZONE_MARGIN) this.cursor = span.start + ZONE_MARGIN;
    const limit = span.end - ZONE_MARGIN;
    if (limit - this.cursor < 10) {
      this.cursor = span.end + ZONE_MARGIN;
      return;
    }
    const easy = this.fresh && this.cursor < EASY_UNTIL;
    const ctx = this.context(this.cursor, easy);
    const tutorial = ctx.zone === "puente-real" && ctx.lap === 1;
    const weights = patternWeights(ctx).filter(([name]) => {
      const def = PATTERNS[name];
      if (easy && !def.easy) return false;
      if (def.movers && tutorial && this.cursor < 250) return false;
      return true;
    });
    for (let attempt = 0; attempt < 8; attempt++) {
      const name = this.rng.weighted(weights);
      const b = new PatternBuilder(ctx, this.cursor);
      if (!PATTERNS[name].fn(b)) continue;
      if (b.end > limit) continue;
      if (this.conflicts(b)) {
        b.mirror();
        if (this.conflicts(b)) continue;
      }
      this.commit(name, b, limit, easy);
      return;
    }
    // Nothing fits before the end of the zone: a short breather, then try again.
    this.cursor += 8;
  }

  /** Does anything in `b` sit in a lane a moving vehicle drives through? */
  private conflicts(b: PatternBuilder): boolean {
    const all = [...this.reservations, ...b.reservations];
    for (const o of b.obstacles) {
      const [from, to] = draftInterval(o);
      const lanes3 = OBSTACLE_DEFS[o.kind].lanes === 3;
      for (const r of all) {
        if (r.owner === o) continue;
        if (!lanes3 && r.lane !== o.lane) continue;
        if (o.k > 0 && o.k === r.k) continue; // Same speed: they travel together.
        if (from < r.to && r.from < to) return true;
      }
    }
    return false;
  }

  private commit(name: PatternName, b: PatternBuilder, limit: number, easy: boolean): void {
    const ctx = b.ctx;
    const vEnd = speedAt(b.end);
    let gap = vEnd * (ctx.reaction + 0.15 + b.tail) + this.rng.range(0, vEnd * 0.45);
    if (easy) gap *= 1.7;
    else if (ctx.zone === "puente-real" && ctx.lap === 1) gap *= 1.25;

    const obstacles = b.obstacles
      .map((o): ObstacleSpawn => ({ ...o, id: this.nextId++ }))
      .sort((a, c) => a.d - c.d);
    for (const o of obstacles) this.obstacles.push(o);
    this.reservations.push(...b.reservations);

    const pickups: PickupSpawn[] = b.pickups.map((p) => ({ ...p, id: this.nextId++ }));

    // Letters and power-ups.
    const gapSpot: RewardSlot | null =
      b.end + gap * 0.5 <= limit ? { lane: b.line, d: b.end + gap * 0.5, y: 1.0, risky: false } : null;
    const used = new Set<RewardSlot>();
    const takeSlot = (preferRisky: boolean): RewardSlot | null => {
      const candidates = b.slots.filter((s) => !used.has(s) && s.d <= limit);
      const risky = candidates.filter((s) => s.risky);
      const safe = candidates.filter((s) => !s.risky);
      let slot: RewardSlot | null = null;
      if (preferRisky && risky.length > 0) slot = this.rng.pick(risky);
      else if (!preferRisky && safe.length > 0) slot = this.rng.pick(safe);
      else if (gapSpot && !used.has(gapSpot)) slot = gapSpot;
      else if (candidates.length > 0) slot = this.rng.pick(candidates);
      if (slot) used.add(slot);
      return slot;
    };
    const placeReward = (kind: PickupSpawn["kind"], slot: RewardSlot): void => {
      // Make room among the bellotas.
      for (let i = pickups.length - 1; i >= 0; i--) {
        const p = pickups[i];
        if (p && p.kind === "bellota" && p.lane === slot.lane && Math.abs(p.d - slot.d) < 1.6) pickups.splice(i, 1);
      }
      pickups.push({ id: this.nextId++, kind, lane: slot.lane, d: slot.d, y: slot.y });
    };

    if (b.end >= this.nextPowerupAt && !easy) {
      const slot = takeSlot(false);
      if (slot) {
        const options = POWERUP_KINDS.filter((k) => k !== this.lastPowerup);
        const kind = this.rng.pick(options);
        this.lastPowerup = kind;
        placeReward(kind, slot);
        this.nextPowerupAt = slot.d + this.rng.range(250, 400);
      }
    }
    if (b.end >= this.nextLetterAt) {
      const slot = takeSlot(this.rng.chance(0.5));
      if (slot) {
        placeReward("letra", slot);
        this.nextLetterAt = slot.d + this.rng.range(150, 250);
      }
    }

    pickups.sort((a, c) => a.d - c.d);
    const last = this.pickups[this.pickups.length - 1];
    for (const p of pickups) this.pickups.push(p);
    if (last && pickups[0] && pickups[0].d < last.d) this.pickups.sort((a, c) => a.d - c.d);

    this.placed.push({ name, start: b.start, end: b.end });
    this.line = b.line;
    this.cursor = b.end + gap;
  }
}
