/**
 * Seeded, pattern-based track generator: obstacle and pickup spawns for the stretch ahead.
 * Pure: no three.js. Deterministic for a given seed and sequence of calls.
 */
import { OBSTACLE_DEFS, POWERUPS, type Lane, type PowerupKind, type TutorialAction, type ZoneId } from "../contracts";
import {
  PATTERNS,
  PatternBuilder,
  moverEffectiveHalf,
  patternWeights,
  type LaneReservation,
  type ObstacleDraft,
  type PatternContext,
  type PatternDef,
  type PatternName,
  type RewardSlot,
} from "./patterns";
import { createRng, type Rng } from "./rng";
import type { ObstacleSpawn, PickupSpawn } from "./spawns";
import {
  FLIGHT_DESCENT_TIME,
  FLIGHT_MIN_DISTANCE,
  FLIGHT_SPEED_FACTOR,
  START_SPEED,
  difficultyAt,
  reactionWindow,
  speedAt,
  zoneAt,
} from "./tuning";

/** Nothing is placed this close to the start or end of a zone (room for the zone banner). */
export const ZONE_MARGIN = 25;
/** A fresh run starts with this much empty road... */
export const EMPTY_START = 48;
/** ...followed by very easy patterns until here. */
export const EASY_UNTIL = 130;
/** With the tutorial, easy patterns continue until here. */
export const TUTORIAL_EASY_UNTIL = 330;
/** Zones with big vehicles always get at least one ramp-and-roofs route. */
const ROOF_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>(["valdepasillas", "margen-derecha"]);

/** One scripted tutorial obstacle and the action it teaches. */
export interface TutorialStep {
  action: TutorialAction;
  /** Lane of the obstacle (0 for the 3-lane ones). */
  lane: Lane;
  /** Distance range of the obstacle. */
  front: number;
  end: number;
}

export interface TrackOptions {
  /** Open a fresh run with the scripted tutorial instead of generated patterns. */
  tutorial?: boolean;
  /** Stork flight duration in seconds (with upgrades), to reserve a clear landing. */
  flightDuration?: number;
}

/** Where a stork flight that starts at `start` will glide down, and the clear stretch it needs. */
export interface FlightPlan {
  start: number;
  /** Nominal distance where the feet touch down. */
  land: number;
  /** No obstacles in any lane between these distances. */
  clearFrom: number;
  clearTo: number;
}

export function flightPlan(start: number, duration: number): FlightPlan {
  const v = speedAt(start) * FLIGHT_SPEED_FACTOR;
  const land = start + v * duration;
  const reaction = reactionWindow(difficultyAt(land));
  return {
    start,
    land,
    clearFrom: start + v * (duration - FLIGHT_DESCENT_TIME) * 0.95 - 6,
    clearTo: land + (land - start) * 0.05 + speedAt(land) * (reaction + 1.2) + 8,
  };
}

const POWERUP_KINDS: readonly PowerupKind[] = ["iman", "zapatillas", "jamon", "patinete"];
/** Weight of the stork against 1 for each other power-up (≈ 1 in 6 spawns). */
const CIGUENA_WEIGHT = 0.75;

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
  private easyUntil = EASY_UNTIL;
  /** Zone serials that already got their finale / roof route. */
  private finaleSerial = -1;
  private roofSerial = -1;
  /** Scripted tutorial steps (empty when there is no tutorial). */
  readonly tutorial: TutorialStep[] = [];
  /** Distance where the tutorial is over ("complete"). */
  tutorialEnd = 0;
  /** Landing stretches reserved for stork pickups (kept clear of obstacles). */
  readonly flights: FlightPlan[] = [];
  private readonly flightDuration: number;

  constructor(seed: number, startDistance = 0, options: TrackOptions = {}) {
    this.rng = createRng(seed);
    this.flightDuration = options.flightDuration ?? POWERUPS.ciguena.baseDuration;
    this.fresh = startDistance <= 0;
    this.cursor = this.fresh ? EMPTY_START : startDistance + ZONE_MARGIN;
    this.nextPowerupAt = this.cursor + this.rng.range(160, 260);
    this.nextLetterAt = this.cursor + this.rng.range(90, 160);
    if (options.tutorial && this.fresh) this.placeTutorial();
  }

  /**
   * The scripted opening: dodge a car (towards the bellotas), jump a barrier, roll under a
   * banner, jump onto a car roof. Spaced well over 2 s apart at the start speed.
   */
  private placeTutorial(): void {
    const ctx = this.context(0, true);
    ctx.v = START_SPEED;
    const b = new PatternBuilder(ctx, 0);
    const side: Lane = this.rng.chance(0.5) ? -1 : 1;
    const step = (action: TutorialAction, lane: Lane, front: number, end: number): void => {
      this.tutorial.push({ action, lane, front, end });
    };
    // 1. A parked car in your lane: move to the lane with the bellotas.
    let end = b.place("coche", 0, 56);
    b.trail(side, 40, 74, 0.9, 2.2);
    step(side < 0 ? "left" : "right", 0, 56, end);
    // 2. Roadworks barrier across the road: jump.
    end = b.place("valla-larga", 0, 95);
    b.arc(side, b.takeoffFor(95 + 0.15));
    step("jump", 0, 95, end);
    // 3. Fiesta banner across the road: roll.
    end = b.place("pancarta", 0, 132);
    b.trail(side, 129.5, 135, 0.45, 1.6);
    step("roll", 0, 132, end);
    // 4. A car with bellotas leading onto its roof: jump onto it.
    end = b.place("coche", side, 170);
    b.arc(side, b.takeoffFor(170), 0, 0.5);
    b.trail(side, 172, end - 0.5, OBSTACLE_DEFS.coche.yMax + 0.9, 1.6);
    step("jump", side, 170, end);
    this.tutorialEnd = end + 6;
    for (const o of b.obstacles) this.obstacles.push({ ...o, id: this.nextId++ });
    this.obstacles.sort((a, c) => a.d - c.d);
    for (const p of b.pickups) this.pickups.push({ ...p, id: this.nextId++ });
    this.pickups.sort((a, c) => a.d - c.d);
    this.line = side;
    this.cursor = end + 40;
    this.easyUntil = TUTORIAL_EASY_UNTIL;
    this.nextPowerupAt = this.cursor + this.rng.range(120, 200);
    this.nextLetterAt = this.cursor + this.rng.range(40, 90);
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
    this.flights.length = 0;
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
    while (this.flights.length > 0 && (this.flights[0]?.clearTo ?? Infinity) < cut) this.flights.shift();
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
    // Skip over reserved stork landings.
    for (const f of this.flights) {
      if (this.cursor >= f.clearFrom - 1 && this.cursor < f.clearTo) this.cursor = f.clearTo;
    }
    const span = zoneAt(this.cursor);
    if (this.cursor < span.start + ZONE_MARGIN) this.cursor = span.start + ZONE_MARGIN;
    const limit = span.end - ZONE_MARGIN;
    if (limit - this.cursor < 10) {
      this.cursor = span.end + ZONE_MARGIN;
      return;
    }
    const easy = this.fresh && this.cursor < this.easyUntil;
    const ctx = this.context(this.cursor, easy);
    const tutorial = ctx.zone === "puente-real" && ctx.lap === 1;
    // Signature moments: a finale closing every zone, a roof route in big-vehicle zones.
    let forced: PatternName | null = null;
    const finaleRows = ctx.difficulty > 0.3 ? 4 : 3;
    const finaleLength = finaleRows * (5.4 + ctx.v * (ctx.reaction + 0.35 + 0.25 * (1 - ctx.difficulty))) + ctx.v * 0.25 + 1;
    const finalePending = !easy && this.finaleSerial !== span.serial;
    // Ordinary patterns leave room for the finale at the end of the zone.
    let normalLimit = finalePending ? limit - finaleLength - ctx.v * (ctx.reaction + 1.1 + 0.35 * (1 - ctx.difficulty)) - 4 : limit;
    for (const f of this.flights) if (f.clearFrom > this.cursor) normalLimit = Math.min(normalLimit, f.clearFrom - 2);
    // Oncoming traffic reserves its lane far ahead: none just before the finale.
    const finaleSoon = finalePending && normalLimit - this.cursor < 70;
    // A pending roof route needs its lanes free of oncoming traffic: hold the traffic back.
    const roofPending = !easy && ROOF_ZONES.has(ctx.zone) && this.roofSerial !== span.serial && ctx.zoneT > 0.15;
    const weights = patternWeights(ctx).filter(([name]) => {
      const def: PatternDef = PATTERNS[name];
      if (def.special) return false;
      if (def.movers && (finaleSoon || roofPending)) return false;
      if (easy && !def.easy) return false;
      if (def.movers && tutorial && this.cursor < 250) return false;
      // The first stretch of the first lap: single obstacles and simple pairs only.
      if (tutorial && this.cursor < 360 && (name === "slalom" || name === "carHop" || name === "fullBarrier")) return false;
      return true;
    });
    if (finalePending && normalLimit - this.cursor < 25) {
      forced = "finale";
      if (limit - this.cursor < finaleLength * 0.6) this.finaleSerial = span.serial; // No room left: give up.
    } else if (!easy && ROOF_ZONES.has(ctx.zone) && this.roofSerial !== span.serial && ctx.zoneT > 0.25) {
      forced = "rampRoof";
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      const name = forced !== null && attempt < 3 ? forced : this.rng.weighted(weights);
      if (forced === "finale" && name !== "finale") break; // Wait (a breather) rather than crowd the finale out.
      const b = new PatternBuilder(ctx, this.cursor);
      if (!PATTERNS[name].fn(b)) continue;
      const flightLimit = this.flights.reduce((m, f) => (f.clearFrom > this.cursor ? Math.min(m, f.clearFrom - 2) : m), Infinity);
      if (b.end > Math.min(name === "finale" ? limit : normalLimit, flightLimit)) continue;
      if (this.conflicts(b)) {
        b.mirror();
        if (this.conflicts(b)) continue;
      }
      if (name === "rampRoof") this.roofSerial = span.serial;
      this.commit(name, b, limit, easy);
      if (name === "finale") {
        // The finale closes the zone.
        this.finaleSerial = span.serial;
        this.cursor = Math.max(this.cursor, span.end + ZONE_MARGIN);
      }
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
    let gap = vEnd * (ctx.reaction + 0.15 + b.tail + 0.35 * (1 - ctx.difficulty)) + this.rng.range(0, vEnd * 0.45);
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
        const lastFlight = this.flights[this.flights.length - 1];
        const storkOk =
          gapSpot !== null && gapSpot.d >= FLIGHT_MIN_DISTANCE && (!lastFlight || gapSpot.d > lastFlight.clearTo) &&
          gapSpot.d > this.tutorialEnd;
        const options: [PowerupKind, number][] = POWERUP_KINDS.filter((k) => k !== this.lastPowerup).map((k) => [k, 1]);
        if (storkOk && this.lastPowerup !== "ciguena") options.push(["ciguena", CIGUENA_WEIGHT]);
        const kind = this.rng.weighted(options);
        this.lastPowerup = kind;
        if (kind === "ciguena" && gapSpot) {
          // The stork sits at normal height in the open; its landing stretch is reserved now.
          if (slot !== gapSpot) used.add(gapSpot);
          placeReward(kind, gapSpot);
          const plan = flightPlan(gapSpot.d, this.flightDuration);
          this.flights.push(plan);
          this.nextPowerupAt = plan.clearTo + this.rng.range(150, 300);
          this.nextLetterAt = Math.max(this.nextLetterAt, plan.clearTo + 20);
        } else {
          placeReward(kind, slot);
          this.nextPowerupAt = slot.d + this.rng.range(250, 400);
        }
      }
    }
    const lastFlight = this.flights[this.flights.length - 1];
    if (b.end >= this.nextLetterAt && !(lastFlight && b.end > lastFlight.start && b.end < lastFlight.clearTo)) {
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
