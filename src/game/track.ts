/**
 * Seeded, pattern-based track generator: obstacle and pickup spawns for the stretch ahead.
 * Pure: no three.js. Deterministic for a given seed and sequence of calls.
 *
 * The generator owns the traffic: every moving vehicle is checked against everything already
 * placed (and everything placed later is checked against it) over the whole time it is on screen,
 * so vehicles never drive through anything; same-direction vehicles in a lane share one speed;
 * vehicles that would drive past the zone-end traffic light brake to a halt there (queueing).
 * In traffic zones most same-direction lanes are "live" for the whole zone: only vehicles go
 * there, so the traffic can flow; street clutter goes in the other lanes.
 */
import { OBSTACLE_DEFS, POWERUPS, type PowerupKind, type TutorialAction, type ZoneId } from "../contracts";
import { getCourse, inRange, underArch } from "./course";
import { centreLane, laneOffset, layoutAt, nearestLane, nextOffsetChange, type LaneLayout, type LayoutFn } from "./lanes";
import {
  PATTERNS,
  PatternBuilder,
  patternWeights,
  type ObstacleDraft,
  type PatternContext,
  type PatternDef,
  type PatternName,
  type RewardSlot,
} from "./patterns";
import { createRng, type Rng } from "./rng";
import type { ObstacleSpawn, PickupSpawn } from "./spawns";
import { collides, drivesThrough, flowAllows, footprintOf, lateralOverlap, lifetime, sweep } from "./traffic";
import {
  FLIGHT_DESCENT_TIME,
  FLIGHT_MIN_DISTANCE,
  FLIGHT_SPEED_FACTOR,
  START_SPEED,
  difficultyAt,
  reactionWindow,
  speedAt,
  zoneAt,
  type ZoneSpan,
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
  /** Lane of the obstacle (the centre lane for the full-width ones). */
  lane: number;
  /** Distance range of the obstacle. */
  front: number;
  end: number;
}

export interface TrackOptions {
  /** Open a fresh run with the scripted tutorial instead of generated patterns. */
  tutorial?: boolean;
  /** Stork flight duration in seconds (with upgrades), to reserve a clear landing. */
  flightDuration?: number;
  /** Lane layout by distance (the engine's `layoutAt` by default). */
  layout?: LayoutFn;
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
/** Metres between power-ups (≈ 15 per 8.2 km lap). */
export const POWERUP_SPACING: readonly [number, number] = [430, 650];
/** Metres between letters: a whole BADAJOZ (7) about once per lap. */
export const LETTER_SPACING: readonly [number, number] = [950, 1200];
/** Weight of the stork against 1 for each other power-up (≈ 1 in 6 spawns). */
const CIGUENA_WEIGHT = 0.75;

export interface PlacedPattern {
  name: PatternName;
  start: number;
  end: number;
}

/** Footprint (in runner distance) of an obstacle: where the runner meets it. */
export function spawnInterval(o: Omit<ObstacleSpawn, "id">): [number, number] {
  return footprintOf(o);
}

/** Length of the finale and the room ordinary patterns leave before it, for a zone. */
function finaleRoom(span: ZoneSpan): { finaleLength: number; before: number } {
  const v = speedAt(span.end);
  const difficulty = difficultyAt(span.end);
  const reaction = reactionWindow(difficulty);
  const rows = difficulty > 0.3 ? 4 : 3;
  const finaleLength = rows * (5.4 + v * (reaction + 0.35 + 0.25 * (1 - difficulty))) + v * 0.4 + 1;
  return { finaleLength, before: v * (reaction + 1.1 + 0.35 * (1 - difficulty)) + 4 };
}

/**
 * The zone-end traffic light: same-direction traffic stops here and the finale comes just after
 * it. On the real lap the finale must fit in one street (one lane layout), so the light goes in
 * the last stretch of the zone long enough to hold it.
 */
export function lightFor(span: ZoneSpan): number {
  const { finaleLength, before } = finaleRoom(span);
  const fallback = span.end - ZONE_MARGIN - finaleLength - before;
  const course = getCourse();
  if (!course) return fallback;
  const lapBase = span.start - (((span.start % course.lapLength) + course.lapLength) % course.lapLength);
  const stretches = course.track.stretches;
  for (let i = stretches.length - 1; i >= 0; i--) {
    const st = stretches[i];
    if (!st) continue;
    const from = lapBase + st.fromS + 16;
    const to = Math.min(lapBase + st.toS - 6, span.end - ZONE_MARGIN);
    if (to <= span.start || from >= span.end) continue;
    const light = to - finaleLength - before;
    if (light - 25 >= Math.max(from, span.start + ZONE_MARGIN)) return light;
  }
  return fallback;
}

export class TrackGenerator {
  /** Sorted by `d`. */
  readonly obstacles: ObstacleSpawn[] = [];
  /** Sorted by `d`. */
  readonly pickups: PickupSpawn[] = [];
  readonly placed: PlacedPattern[] = [];
  private readonly rng: Rng;
  private cursor: number;
  /** Lateral position of the intended line (survives lane layout changes). */
  private lineX: number;
  private nextId = 1;
  private nextPowerupAt: number;
  private nextLetterAt: number;
  private lastPowerup: PowerupKind | null = null;
  /** Committed moving vehicles that may still matter (pruned). */
  private movers: ObstacleSpawn[] = [];
  /** Back of the queue at each zone's light, by `${zoneSerial}|${x}`. */
  private readonly queues = new Map<string, number>();
  /** Live traffic lanes (lateral x) of each zone, by zone serial. */
  private readonly liveByZone = new Map<string, ReadonlySet<number>>();
  /** End (world distance) of the last static obstacle at each lateral x. */
  private readonly lastStatic = new Map<number, number>();
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
  readonly layoutFn: LayoutFn;

  constructor(seed: number, startDistance = 0, options: TrackOptions = {}) {
    this.rng = createRng(seed);
    this.layoutFn = options.layout ?? layoutAt;
    this.flightDuration = options.flightDuration ?? POWERUPS.ciguena.baseDuration;
    this.fresh = startDistance <= 0;
    this.cursor = this.fresh ? EMPTY_START : startDistance + ZONE_MARGIN;
    const layout = this.layoutFn(this.cursor);
    this.lineX = laneOffset(layout, centreLane(layout));
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
    const middle = centreLane(ctx.layout);
    // Teach "left/right" towards a neighbouring lane of the same carriageway (not across a median).
    const near = b.lanes.filter((l) => l !== middle && Math.abs(b.xOf(l) - b.xOf(middle)) < 3.8);
    const side = near.length > 0 ? this.rng.pick(near) : middle === 0 ? 1 : middle - 1;
    const step = (action: TutorialAction, lane: number, front: number, end: number): void => {
      this.tutorial.push({ action, lane, front, end });
    };
    // 1. A parked car in your lane: move to the lane with the bellotas.
    let end = b.place("coche", middle, 56, "parked");
    b.trail(side, 40, 74, 0.9, 2.2);
    step(side < middle ? "left" : "right", middle, 56, end);
    // 2. Roadworks barrier across the road: jump.
    end = b.place("valla-larga", middle, 95);
    b.arc(side, b.takeoffFor(95 + 0.15));
    step("jump", middle, 95, end);
    // 3. Fiesta banner across the road: roll.
    end = b.place("pancarta", middle, 132);
    b.trail(side, 129.5, 135, 0.45, 1.6);
    step("roll", middle, 132, end);
    // 4. A car with bellotas leading onto its roof: jump onto it.
    end = b.place("coche", side, 170, "parked");
    b.arc(side, b.takeoffFor(170), 0, 0.5);
    b.trail(side, 172, end - 0.5, OBSTACLE_DEFS.coche.yMax + 0.9, 1.6);
    step("jump", side, 170, end);
    this.tutorialEnd = end + 6;
    for (const o of b.obstacles) this.obstacles.push({ ...o, id: this.nextId++ });
    this.obstacles.sort((a, c) => a.d - c.d);
    for (const p of b.pickups) this.pickups.push({ ...p, id: this.nextId++ });
    this.pickups.sort((a, c) => a.d - c.d);
    for (const o of b.obstacles) this.noteStatic(o, ctx.layout);
    this.lineX = b.xOf(side);
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
    this.movers = [];
    this.queues.clear();
    this.lastStatic.clear();
    this.flights.length = 0;
    this.fresh = false;
    this.cursor = distance + ZONE_MARGIN;
    this.nextPowerupAt = this.cursor + this.rng.range(60, 160);
    this.nextLetterAt = this.cursor + this.rng.range(40, 120);
  }

  /** Drop spawns well behind `distance` (the scene keeps up to ~30 m behind the runner on screen). */
  prune(distance: number): void {
    const cut = distance - 90;
    let i = 0;
    while (i < this.obstacles.length && (this.obstacles[i]?.d ?? Infinity) < cut) i++;
    if (i > 0) this.obstacles.splice(0, i);
    let j = 0;
    while (j < this.pickups.length && (this.pickups[j]?.d ?? Infinity) < cut) j++;
    if (j > 0) this.pickups.splice(0, j);
    if (this.placed.length > 200) this.placed.splice(0, this.placed.length - 100);
    this.movers = this.movers.filter((m) => lifetime(m)[1] > distance - 10);
    while (this.flights.length > 0 && (this.flights[0]?.clearTo ?? Infinity) < cut) this.flights.shift();
  }

  generateUntil(distance: number): void {
    let guard = 0;
    while (this.cursor < distance && guard++ < 1000) this.step();
  }

  private context(at: number, easy: boolean): PatternContext {
    const span = zoneAt(at);
    const difficulty = difficultyAt(at);
    const layout = this.layoutFn(at);
    const lightAt = lightFor(span);
    const liveX = easy ? new Set<number>() : this.liveLanes(span, layout);
    const live = new Set<number>();
    layout.offsets.forEach((x, i) => {
      if (liveX.has(x)) live.add(i);
    });
    return {
      rng: this.rng,
      v: speedAt(at),
      difficulty,
      reaction: reactionWindow(difficulty),
      zone: span.zone.id,
      zoneT: (at - span.start) / span.zone.length,
      entryLane: nearestLane(layout, this.lineX),
      easy,
      lap: span.lap,
      layout,
      lightAt,
      live,
      holdOncoming: false,
      lastStatic: (lane) => this.lastStatic.get(laneOffset(layout, lane)) ?? -Infinity,
      canDrive: (o) => this.canDrive(o, layout),
      clearOfTraffic: (o) => {
        for (const m of this.movers) if (lateralOverlap(o, m) && collides(o, m)) return false;
        return true;
      },
      laneK: (lane, d) => this.laneK(laneOffset(layout, lane), d),
      queueStop: (lane, length) => {
        const tail = this.queues.get(`${span.serial}|${laneOffset(layout, lane)}`);
        return (tail ?? lightAt) - length / 2 - (tail === undefined ? 0.5 : 0);
      },
      stopLine: (lane, length, from, to) => {
        const course = getCourse();
        if (!course) return null;
        const hit = inRange(course.stopLines, course.lapLength, from, to)[0];
        if (!hit) return null;
        const tail = this.queues.get(`${hit.s.toFixed(1)}|${laneOffset(layout, lane)}`);
        return { line: hit.s, stop: (tail ?? hit.s - 1) - length / 2 };
      },
      underArch: (from, to) => underArch(getCourse(), from, to),
      treeNear: (x, halfWidth, from, to) => {
        const course = getCourse();
        if (!course) return false;
        for (const { item } of inRange(course.trees, course.lapLength, from - 1.5, to + 1.5)) {
          if (Math.abs(item.lateral - x) < halfWidth + item.r + 1) return true;
        }
        return false;
      },
      barsNear: (from, to) => {
        const course = getCourse();
        if (!course) return [];
        return inRange(course.bars, course.lapLength, from, to).map(({ item, s }) => ({ s, side: item.side }));
      },
      busStopsNear: (from, to) => {
        const course = getCourse();
        if (!course) return [];
        return inRange(course.busStops, course.lapLength, from, to).map(({ s }) => s);
      },
    };
  }

  /**
   * Which same-direction lanes carry live traffic through a zone (decided once per zone): most
   * of them, always at least one, never every lane of the road.
   */
  private liveLanes(span: ZoneSpan, layout: LaneLayout): ReadonlySet<number> {
    const key = `${span.serial}|${layout.offsets.join(",")}|${layout.flow.join(",")}`;
    const known = this.liveByZone.get(key);
    if (known) return known;
    const traffic = layout.offsets.filter((_, i) => layout.flow[i] === 1 && (layout.kinds?.[i] ?? "road") === "road");
    const live = new Set<number>();
    for (const x of traffic) if (this.rng.chance(0.75)) live.add(x);
    if (live.size === 0 && traffic.length > 0) live.add(this.rng.pick(traffic));
    if (live.size >= layout.offsets.length) live.delete(this.rng.pick([...live]));
    this.liveByZone.set(key, live);
    if (this.liveByZone.size > 64) {
      const first = this.liveByZone.keys().next().value;
      if (first !== undefined) this.liveByZone.delete(first);
    }
    return live;
  }

  private noteStatic(o: ObstacleDraft, layout: LaneLayout): void {
    if (o.k !== 0) return;
    const end = o.d + OBSTACLE_DEFS[o.kind].length / 2;
    const xs = OBSTACLE_DEFS[o.kind].lanes === 3 ? layout.offsets : [o.x];
    for (const x of xs) this.lastStatic.set(x, Math.max(this.lastStatic.get(x) ?? -Infinity, end));
  }

  /** Committed obstacles that might touch `o` (statics near its sweep, and the committed movers). */
  private *near(o: ObstacleDraft): Iterable<ObstacleSpawn> {
    const [s0, s1] = sweep(o);
    const from = s0 - 15;
    const to = s1 + 15;
    const list = this.obstacles;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((list[mid]?.d ?? Infinity) < from) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < list.length; i++) {
      const s = list[i];
      if (!s || s.d > to) break;
      if (s.k === 0) yield s;
    }
    yield* this.movers;
  }

  private canDrive(o: ObstacleDraft, layout: LaneLayout): boolean {
    if (!flowAllows(o, this.layoutFn, layout)) return false;
    for (const other of this.near(o)) {
      if (!lateralOverlap(o, other)) continue;
      if (collides(o, other)) return false;
    }
    return true;
  }

  /** Speed of the same-direction traffic already flowing at lateral `x` around `d`. */
  private laneK(x: number, d: number): number | null {
    let best: ObstacleSpawn | null = null;
    for (const m of this.movers) {
      if (m.k >= 0 || Math.abs(m.x - x) > 0.3 || !OBSTACLE_DEFS[m.kind].vehicle) continue;
      if (sweep(m)[1] < d - 200) continue;
      if (!best || m.d > best.d) best = m;
    }
    return best ? best.k : null;
  }

  private step(): void {
    // Skip over reserved stork landings.
    for (const f of this.flights) {
      if (this.cursor >= f.clearFrom - 1 && this.cursor < f.clearTo) this.cursor = f.clearTo + 0.01;
    }
    const span = zoneAt(this.cursor);
    if (this.cursor < span.start + ZONE_MARGIN) this.cursor = span.start + ZONE_MARGIN;
    let limit = span.end - ZONE_MARGIN;
    // A change in the lane layout ahead: patterns stop before it, and the line eases across.
    const change = nextOffsetChange(this.layoutFn, this.cursor, Math.min(limit, this.cursor + 300));
    if (change !== null) {
      if (change - this.cursor < 30) {
        const v = speedAt(change);
        this.cursor = change + v * (reactionWindow(difficultyAt(change)) + 0.6) + 4;
        const after = this.layoutFn(this.cursor);
        this.lineX = laneOffset(after, nearestLane(after, this.lineX));
        return;
      }
      limit = Math.min(limit, change - 6);
    }
    if (limit - this.cursor < 10) {
      this.cursor = change !== null && change < span.end ? change : span.end + ZONE_MARGIN;
      return;
    }
    const easy = this.fresh && this.cursor < this.easyUntil;
    const ctx = this.context(this.cursor, easy);
    const tutorial = ctx.zone === "puente-real" && ctx.lap === 1;
    // Signature moments: a finale closing every zone, a roof route in big-vehicle zones.
    let forced: PatternName | null = null;
    const { finaleLength } = finaleRoom(span);
    const finalePending = !easy && this.finaleSerial !== span.serial && this.cursor < ctx.lightAt + 40;
    // Ordinary patterns leave room for the finale at the end of the zone (it starts at the light).
    let normalLimit = finalePending ? Math.min(ctx.lightAt, limit) : limit;
    for (const f of this.flights) if (f.clearFrom > this.cursor) normalLimit = Math.min(normalLimit, f.clearFrom - 2);
    // Oncoming traffic reaches far ahead: none just before the finale.
    const finaleSoon = finalePending && normalLimit - this.cursor < 90;
    // A pending roof route needs its lanes free of oncoming traffic: hold the traffic back.
    const roofPending = !easy && ROOF_ZONES.has(ctx.zone) && this.roofSerial !== span.serial && ctx.zoneT > 0.15;
    const trafficLanes = ctx.layout.flow.some((f) => f === 1);
    // Oncoming walls too, just before the roof route is due (its lanes must stay clear ahead).
    ctx.holdOncoming = finaleSoon || (roofPending && ctx.zoneT > 0.18);
    const weights = patternWeights(ctx).filter(([name]) => {
      const def: PatternDef = PATTERNS[name];
      if (def.special) return false;
      if (def.movers && (finaleSoon || roofPending)) return false;
      if (def.traffic && !trafficLanes) return false;
      if (easy && !def.easy) return false;
      if (def.movers && tutorial && this.cursor < 250) return false;
      // The first stretch of the first lap: single obstacles and simple pairs only.
      if (tutorial && this.cursor < 360 && (name === "slalom" || name === "carHop" || name === "fullBarrier")) return false;
      return true;
    });
    if (finalePending && ctx.lightAt - this.cursor < 25) {
      forced = "finale";
      if (limit - this.cursor < finaleLength * 0.6 && this.cursor > ctx.lightAt) this.finaleSerial = span.serial; // No room left: give up.
    } else if (!easy && ROOF_ZONES.has(ctx.zone) && this.roofSerial !== span.serial && ctx.zoneT > 0.25) {
      forced = "rampRoof";
    } else if (!easy && ctx.busStopsNear(this.cursor + 18, this.cursor + 70).length > 0) {
      // A bus waits at the real stop just ahead.
      forced = "busStop";
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      const name = forced !== null && attempt < (forced === "busStop" ? 1 : 3) ? forced : this.rng.weighted(weights);
      if (forced === "finale" && name !== "finale") break; // Wait (a breather) rather than crowd the finale out.
      const b = new PatternBuilder(ctx, this.cursor);
      if (!PATTERNS[name].fn(b) || !b.ok) continue;
      const flightLimit = this.flights.reduce((m, f) => (f.clearFrom > this.cursor ? Math.min(m, f.clearFrom - 2) : m), Infinity);
      if (b.end > Math.min(name === "finale" ? limit : normalLimit, flightLimit)) continue;
      if (this.conflicts(b)) {
        if (!b.mirror() || this.conflicts(b)) continue;
      }
      if (name === "rampRoof") this.roofSerial = span.serial;
      this.commit(name, b, limit, easy, span);
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

  /** Would anything in `b` touch traffic (or traffic in `b` touch anything) while on screen? */
  private conflicts(b: PatternBuilder): boolean {
    const own = b.obstacles;
    for (let i = 0; i < own.length; i++) {
      const o = own[i];
      if (!o) continue;
      for (const other of this.near(o)) {
        if (o.k === 0 && other.k === 0) continue;
        if (!lateralOverlap(o, other)) continue;
        if (collides(o, other)) return true;
      }
      if (o.k !== 0) {
        for (let j = 0; j < own.length; j++) {
          const other = own[j];
          if (!other || j === i) continue;
          if (!lateralOverlap(o, other)) continue;
          if (collides(o, other)) return true;
        }
      }
    }
    return false;
  }

  /** Would some vehicle drive through a pickup or reward at this spot before the runner gets there? */
  private runOver(x: number, d: number, y: number, own: readonly ObstacleDraft[]): boolean {
    for (const o of own) if (drivesThrough(o, x, d, y)) return true;
    for (const m of this.movers) if (drivesThrough(m, x, d, y)) return true;
    return false;
  }

  private commit(name: PatternName, b: PatternBuilder, limit: number, easy: boolean, span: ZoneSpan): void {
    const ctx = b.ctx;
    const vEnd = speedAt(b.end);
    let gap = vEnd * (ctx.reaction + 0.15 + b.tail + 0.35 * (1 - ctx.difficulty)) + this.rng.range(0, vEnd * 0.45);
    if (easy) gap *= 1.7;
    else if (ctx.zone === "puente-real" && ctx.lap === 1) gap *= 1.25;

    const obstacles = b.obstacles
      .map((o): ObstacleSpawn => ({ ...o, id: this.nextId++ }))
      .sort((a, c) => a.d - c.d);
    const last = this.obstacles[this.obstacles.length - 1];
    for (const o of obstacles) {
      this.obstacles.push(o);
      if (o.k !== 0) this.movers.push(o);
      this.noteStatic(o, ctx.layout);
      // A vehicle that ends up standing at the light becomes the new back of the queue.
      if (o.k < 0 && o.stop !== undefined && sweep(o)[1] >= o.stop - 1e-6) {
        const key = o.stopLine !== undefined ? `${o.stopLine.toFixed(1)}|${o.x}` : `${span.serial}|${o.x}`;
        const back = o.stop - OBSTACLE_DEFS[o.kind].length / 2 - 1.2;
        this.queues.set(key, Math.min(this.queues.get(key) ?? Infinity, back));
      }
    }
    // Movers' meeting points can sit before earlier spawns: keep the list sorted.
    const first = obstacles[0];
    if (last && first && first.d < last.d) this.obstacles.sort((a, c) => a.d - c.d);

    const pickups: PickupSpawn[] = b.pickups
      .filter((p) => p.ride !== undefined || !this.runOver(p.x, p.d, p.y, b.obstacles))
      .map((p) => ({ ...p, id: this.nextId++ }));

    // Letters and power-ups.
    const gapLane = b.line;
    const gapD = b.end + gap * 0.5;
    const gapSpot: RewardSlot | null =
      gapD <= limit && !this.runOver(laneOffset(ctx.layout, gapLane), gapD, 1.0, b.obstacles) ? { lane: gapLane, d: gapD, y: 1.0, risky: false } : null;
    const slots = b.slots.filter((s) => s.ride !== undefined || !this.runOver(laneOffset(ctx.layout, s.lane), s.d, s.y, b.obstacles));
    const used = new Set<RewardSlot>();
    const takeSlot = (preferRisky: boolean): RewardSlot | null => {
      const candidates = slots.filter((s) => !used.has(s) && s.d <= limit);
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
      const pk: PickupSpawn = { id: this.nextId++, kind, lane: slot.lane, x: laneOffset(ctx.layout, slot.lane), d: slot.d, y: slot.y };
      if (slot.ride) pk.ride = slot.ride;
      pickups.push(pk);
    };

    if (b.end >= this.nextPowerupAt && !easy) {
      const slot = takeSlot(false);
      if (slot) {
        const lastFlight = this.flights[this.flights.length - 1];
        // No stork flight through an arch or a gate (the old town's Arco del Peso, Puerta de Palmas).
        const storkOk =
          gapSpot !== null && gapSpot.d >= FLIGHT_MIN_DISTANCE && (!lastFlight || gapSpot.d > lastFlight.clearTo) &&
          gapSpot.d > this.tutorialEnd && !underArch(getCourse(), gapSpot.d, flightPlan(gapSpot.d, this.flightDuration).clearTo);
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
          this.nextPowerupAt = plan.clearTo + this.rng.range(300, 500);
          this.nextLetterAt = Math.max(this.nextLetterAt, plan.clearTo + 20);
        } else {
          placeReward(kind, slot);
          this.nextPowerupAt = slot.d + this.rng.range(POWERUP_SPACING[0], POWERUP_SPACING[1]);
        }
      }
    }
    const lastFlight = this.flights[this.flights.length - 1];
    if (b.end >= this.nextLetterAt && !(lastFlight && b.end > lastFlight.start && b.end < lastFlight.clearTo)) {
      const slot = takeSlot(this.rng.chance(0.5));
      if (slot) {
        placeReward("letra", slot);
        this.nextLetterAt = slot.d + this.rng.range(LETTER_SPACING[0], LETTER_SPACING[1]);
      }
    }

    pickups.sort((a, c) => a.d - c.d);
    const lastPickup = this.pickups[this.pickups.length - 1];
    for (const p of pickups) this.pickups.push(p);
    if (lastPickup && pickups[0] && pickups[0].d < lastPickup.d) this.pickups.sort((a, c) => a.d - c.d);

    this.placed.push({ name, start: b.start, end: b.end });
    this.lineX = laneOffset(ctx.layout, b.line);
    this.cursor = b.end + gap;
  }
}
