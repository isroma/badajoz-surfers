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
import { PASSAGE_PICKUP_Y, getCourse, tableAt, inPassage, inRange, mapLane, underArch, type Course } from "./course";
import { centreLane, laneOffset, laneOffsetAt, laneOpenAt, laneShownAt, layoutAt, merges, nearestLane, nextOffsetChange, type LaneLayout, type LayoutFn } from "./lanes";
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
import { PLAIN_JUMP, PLAIN_ROLL, narrowPoints, unfairPoints } from "./fairness";
import type { ObstacleSpawn, PickupSpawn } from "./spawns";
import { collides, drivesThrough, flowAllows, footprintOf, lateralOverlap, lifetime, sweep } from "./traffic";
import {
  FLIGHT_DESCENT_TIME,
  FLIGHT_MIN_DISTANCE,
  FLIGHT_SPEED_FACTOR,
  START_SPEED,
  EARLY_GAP,
  WELCOME_GAP,
  WELCOME_RAMP,
  WELCOME_UNTIL,
  difficultyAt,
  reactionWindow,
  speedAt,
  zoneAt,
  type ZoneSpan,
} from "./tuning";

/** A lane that ends is closed to the generator this far before its end (≥ 80 m: the art tapers it over 60 m). */
const LANE_CLOSE_AHEAD = 160;
/** No obstacle and no pickup in a tapering lane's last metres (up to where it is gone)... */
export const MERGE_CLOSED = 80;
/** ...and none in its merge target from this far before the merge end to this far after it. */
export const TARGET_CLEAR_BEFORE = 40;
export const TARGET_CLEAR_AFTER = 25;

/** A stretch of one lane closed to the generator (lap-relative s, lateral centre x). */
export interface Closure {
  from: number;
  to: number;
  x: number;
  /** The ending lane itself (true): moving vehicles may not even drive through its taper... */
  ending: boolean;
  /** ...which starts here. */
  taper: number;
}

const closuresByTrack = new WeakMap<object, Closure[]>();

/** The lane closures of the real lap's merges (see lanes.ts `merges`). */
export function mergeClosures(course: Course): readonly Closure[] {
  const track = course.track;
  const known = closuresByTrack.get(track);
  if (known) return known;
  const out: Closure[] = [];
  const st = track.stretches;
  for (const m of merges(track)) {
    if (m.opens) {
      // A lane still opening is not there yet: nothing in it.
      const x = st[m.fromStretch]!.layout.offsets[m.lane] ?? 0;
      out.push({ from: m.s0, to: m.s1 + 5, x, ending: true, taper: m.s0 });
      continue;
    }
    const lay = st[m.fromStretch]!.layout;
    out.push({ from: Math.min(m.s1 - MERGE_CLOSED, m.s0 - 10), to: m.end, x: lay.offsets[m.lane] ?? 0, ending: true, taper: m.s0 });
    if (m.s0 < st[m.fromStretch]!.fromS) {
      // The taper starts on the lane this one continues from, in the stretch before.
      const k = m.fromStretch;
      const kp = (k - 1 + st.length) % st.length;
      const t = track.transitions.find((x) => x.toIndex === k);
      const pi = t ? t.map.findIndex((j) => j === m.lane) : m.lane;
      const px = st[kp]!.layout.offsets[pi];
      const shift = k === 0 ? track.lapLength : 0;
      if (px !== undefined) out.push({ from: Math.min(m.s1 - MERGE_CLOSED, m.s0 - 10) + shift, to: st[k]!.fromS + shift, x: px, ending: true, taper: m.s0 + shift });
    }
    const tx = lay.offsets[m.into] ?? 0;
    out.push({ from: m.s1 - TARGET_CLEAR_BEFORE, to: Math.min(m.end, m.s1 + TARGET_CLEAR_AFTER), x: tx, ending: false, taper: Infinity });
    if (m.s1 + TARGET_CLEAR_AFTER > m.end) {
      // The target carries on past the boundary (where it may sit a little elsewhere).
      const t = track.transitions.find((x) => x.fromIndex === m.fromStretch);
      let lane = m.into;
      for (let g = 0; g < 8; g++) {
        const next = merges(track).find((x) => !x.opens && x.fromStretch === m.fromStretch && x.lane === lane);
        if (!next) break;
        lane = next.into;
      }
      const j = t?.map[lane];
      const after = t ? st[t.toIndex]?.layout.offsets[j ?? -1] : undefined;
      const base = m.end >= track.lapLength ? 0 : m.end;
      if (after !== undefined) out.push({ from: base, to: base + (m.s1 + TARGET_CLEAR_AFTER - m.end), x: after, ending: false, taper: Infinity });
    }
  }
  closuresByTrack.set(track, out);
  return out;
}

const ROW_SLACK = 2;

/** Lap 1: no bellotas lure the runner into pavement clutter before this distance. */
const NO_LURE_UNTIL = 2000;

/** Lap 1's set piece at the Puente Real pylon. */
const PYLON_SET_PIECE: PatternName = "oncoming";
/** The pylon set-piece starts up to this many metres before the pylon. */
const PYLON_LEAD = 80;

/** Nothing is met within this many metres after a layout boundary. */
export const BOUNDARY_CLEAR = 15;

/** No obstacles where the road curves harder than this (1/m: a radius under 18 m). */
export const CALM_CURVATURE = 1 / 18;

/** In two-lane streets the other lane stays free this long (s) around an obstacle. */
export const TWO_LANE_FREE = 1.2;

/** Lateral reach of a closure (a lane is about 3 m wide; this keeps the runner's line clear). */
const CLOSURE_HALF = 0.7;
const PICKUP_CLOSURE_HALF = 1.0;

/** Nothing is placed this close to the start or end of a zone (room for the zone banner). */
export const ZONE_MARGIN = 25;
/** The first obstacle of a fresh run (no tutorial) is met this far in (to +6 m). */
export const OPENING_AT = 31;
/** A fresh run starts with this much empty road... */
export const EMPTY_START = 30;
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
  // Row gap as in patterns.rowGap(+0.12 s lane change), plus the lap-1 breather of the finale.
  const extra = 0.12 + (span.lap === 1 ? 0.25 : 0);
  // (the welcoming first kilometre spaces the rows WELCOME_GAP s apart)
  const rowTime = Math.max(reaction + 0.35 + extra + 0.25 * (1 - difficulty), span.lap === 1 && span.start < WELCOME_RAMP ? EARLY_GAP + 0.1 : 0);
  const finaleLength = rows * (5.4 + v * rowTime) + v * (span.lap === 1 ? 0.65 : 0.4) + 1;
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
    let to = Math.min(lapBase + st.toS - 6, span.end - ZONE_MARGIN);
    // The finale stays clear of the lane tapers at the end of the stretch.
    for (const c of mergeClosures(course)) if (c.from > st.fromS && c.from < st.toS) to = Math.min(to, lapBase + c.from - 4);
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
  private readonly liveByZone = new Map<string, boolean>();
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
    else if (this.fresh) this.placeOpening();
    // Lap 1's first letter comes with the pylon set-piece.
    const marks = this.course()?.track.marks;
    if (this.fresh && marks) this.nextLetterAt = Math.max(this.nextLetterAt, marks.pylon - PYLON_LEAD);
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
    // Dodge left into the next road lane of our carriageway (own-2) where there is one, else the
    // nearest lane a normal change away.
    const near = b.lanes.filter((l) => l !== middle && Math.abs(b.xOf(l) - b.xOf(middle)) < 3.8);
    const road = near.filter((l) => b.isRoad(l));
    const side = road.length > 0 ? road.reduce((a, l) => (b.xOf(l) < b.xOf(a) ? l : a)) : near.length > 0 ? near[0]! : middle === 0 ? 1 : middle - 1;
    this.rng.next();
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

  /**
   * The opening beat on the bridge head: a parked car in the runner's lane 30-40 m ahead with a
   * line of bellotas pulling them across to the next lane (a dodge, nothing to jump).
   */
  private placeOpening(): void {
    const ctx = this.context(0, true);
    ctx.v = START_SPEED;
    const b = new PatternBuilder(ctx, 0);
    const lane = centreLane(ctx.layout);
    const near = b.lanes.filter((l) => l !== lane && Math.abs(b.xOf(l) - b.xOf(lane)) < 3.8);
    const road = near.filter((l) => b.isRoad(l));
    const side = road[0] ?? near[0];
    if (side === undefined) return;
    const front = OPENING_AT + this.rng.range(0, 6);
    const end = b.place("coche", lane, front, "parked");
    b.trail(side, front - 16, end + 4, 0.9, 2.2);
    if (!b.ok) return;
    for (const o of b.obstacles) this.obstacles.push({ ...o, id: this.nextId++ });
    for (const p of b.pickups) this.pickups.push({ ...p, id: this.nextId++ });
    this.pickups.sort((a, c) => a.d - c.d);
    for (const o of b.obstacles) this.noteStatic(o, ctx.layout);
    this.lineX = b.xOf(side);
    this.contentEnd = end + 4;
    this.cursor = end + speedAt(end) * (WELCOME_GAP + 0.2);
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
    // Decided per lateral position for the whole zone, so a lane keeps its role through
    // roundabouts and junctions (the real lanes keep their offsets).
    const live = new Set<number>();
    const traffic = layout.offsets.filter((_, i) => layout.flow[i] === 1 && (layout.kinds?.[i] ?? "road") === "road");
    for (const x of traffic) {
      const key = `${span.lap}|${x.toFixed(1)}`;
      let on = this.liveByZone.get(key);
      if (on === undefined) {
        on = this.rng.chance(0.92);
        this.liveByZone.set(key, on);
      }
      if (on) live.add(x);
    }
    if (live.size === 0 && traffic.length > 0) {
      const x = traffic[traffic.length - 1] ?? 0;
      live.add(x);
      this.liveByZone.set(`${span.lap}|${x.toFixed(1)}`, true);
    }
    if (live.size >= layout.offsets.length) live.delete([...live][0] ?? 0);
    if (this.liveByZone.size > 256) {
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

  /** The real lap's closures and passages apply (the generator runs on the installed course). */
  private course(): Course | null {
    return this.layoutFn === layoutAt ? getCourse() : null;
  }

  /** Would this obstacle sit (or drive) in a tapering lane, a merge target or a passage? */
  private blockedObstacle(o: ObstacleDraft): boolean {
    const course = this.course();
    if (!course) return false;
    const [f0, f1] = footprintOf(o);
    let [w0, w1] = [f0, f1];
    if (o.k !== 0) {
      const [s0, s1] = sweep(o);
      const half = OBSTACLE_DEFS[o.kind].length / 2;
      w0 = Math.min(w0, s0 - half);
      w1 = Math.max(w1, s1 + half);
    }
    if (inPassage(course, w0, w1)) return true;
    // Calm in tight bends: nothing to dodge, jump or roll where the road curves harder than
    // CALM_CURVATURE (rings, old-town corners): only bellota trails along the lanes.
    // Lap 1's first roundabout is a clean bellota arc.
    const marks = course.track.marks;
    if (f0 < course.lapLength && f1 > marks.firstRoundaboutEntry - 5 && f0 < marks.firstRoundaboutExit + 5) return true;
    // Nothing just after a layout boundary (a ring entry, a street change: the lanes blend there).
    for (const t of course.track.transitions) {
      for (let k = Math.floor(f0 / course.lapLength) - 1; k <= Math.floor(f1 / course.lapLength) + 1; k++) {
        const at = t.s + k * course.lapLength;
        if (f1 > at - 3 && f0 < at + BOUNDARY_CLEAR) return true;
      }
    }
    // ...nor within a reaction's worth of running after one (the camera is still swinging).
    const bends = course.bends().curvature;
    const after = speedAt(f0) * reactionWindow(difficultyAt(f0));
    for (let d = Math.floor(f0 - after); d <= Math.ceil(f1); d++) if (tableAt(bends, course.lapLength, d) > CALM_CURVATURE) return true;
    const half = (o.span ?? OBSTACLE_DEFS[o.kind].width) / 2;
    const L = course.lapLength;
    const hits = (a: number, b: number, from: number, to: number): boolean => {
      for (let k = Math.floor(a / L) - 1; k <= Math.floor(b / L) + 1; k++) if (b > from + k * L && a < to + k * L) return true;
      return false;
    };
    for (const c of mergeClosures(course)) {
      if (Math.abs(o.x - c.x) >= half + CLOSURE_HALF) continue;
      // Where the runner meets it; and a vehicle never drives through the taper's barriers.
      if (hits(f0, f1, c.from, c.to) || (o.k !== 0 && hits(w0, w1, c.taper, c.to))) return true;
    }
    return false;
  }

  /** Would a pickup at (x, d, y) sit in a tapering lane, a merge target, or high in a passage? */
  private blockedPickup(x: number, d: number, y: number, targetsOk = false): boolean {
    const course = this.course();
    if (!course) return false;
    if (y > PASSAGE_PICKUP_Y && inPassage(course, d, d)) return true;
    const L = course.lapLength;
    const w = d - L * Math.floor(d / L);
    for (const c of mergeClosures(course)) {
      // Patterns keep out of merge targets too; gap-fill bellotas may lead along a target.
      if ((targetsOk && !c.ending) || Math.abs(x - c.x) >= PICKUP_CLOSURE_HALF) continue;
      for (const at of [w - L, w, w + L]) if (at >= c.from - 1 && at <= c.to + 1) return true;
    }
    return false;
  }

  /**
   * The welcoming first kilometre of a run (lap 1, before WELCOME_UNTIL): nothing in a road lane
   * that needs a jump or a roll (low clutter only on the pavements, no street-wide barriers or
   * banners), no oncoming vehicles, rows at least WELCOME_GAP s apart, and two neighbouring
   * passable lanes everywhere. Patterns over it are refused otherwise.
   */
  private unwelcoming(b: PatternBuilder): boolean {
    if (this.tutorial.length > 0 && b.start < this.tutorialEnd) return false;
    let from = Infinity;
    let to = -Infinity;
    let warm = false;
    for (const o of b.obstacles) {
      const [a, c] = footprintOf(o);
      if (a >= WELCOME_RAMP) continue;
      from = Math.min(from, a);
      to = Math.max(to, c);
      if (a >= WELCOME_UNTIL) continue;
      // The warm-up: dodges only in the road lanes, nothing across the street.
      warm = true;
      if (OBSTACLE_DEFS[o.kind].lanes === 3) return true;
      if (o.k > 0 && !this.quietOncoming(o, b)) return true;
      if (PLAIN_JUMP.has(o.kind) || PLAIN_ROLL.has(o.kind)) {
        const lay = this.layoutFn(o.d);
        const lane = nearestLane(lay, o.x);
        if ((lay.kinds?.[lane] ?? "road") === "road") return true;
      }
    }
    if (!Number.isFinite(from)) return false;
    const room = (from < WELCOME_UNTIL ? WELCOME_GAP : EARLY_GAP) * speedAt(from);
    const near: Omit<ObstacleSpawn, "id">[] = [...b.obstacles];
    for (const o of this.obstacles) {
      if (o.d < from - room - 20 || o.d > to + room + 20) continue;
      near.push(o);
    }
    // Rows apart (obstacles side by side, footprints within ROW_SLACK m, are a row).
    const spans = near.map((o) => footprintOf(o)).sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < spans.length; i++) {
      const gap = spans[i]![0] - Math.max(...spans.slice(0, i).map((x) => x[1]));
      const need = (spans[i]![0] < WELCOME_UNTIL ? WELCOME_GAP : EARLY_GAP) * speedAt(spans[i]![0]);
      if (spans[i]![0] < WELCOME_RAMP && gap > ROW_SLACK && gap < need) return true;
    }
    if (!warm) return false;
    const course = this.course();
    return narrowPoints(near, from - 2, Math.min(WELCOME_UNTIL, to + 2), { layout: this.layoutFn, track: course?.track ?? null, speed: speedAt }, 1).length > 0;
  }

  /**
   * The welcoming opening keeps the bridge alive with oncoming traffic only where it never asks
   * anything of a runner on our side: in an oncoming lane, and when that lane is next to one of
   * ours (opp-1), only while our neighbouring lanes are free for the vehicle's whole pass.
   */
  private quietOncoming(o: ObstacleDraft, b: PatternBuilder): boolean {
    const lay = this.layoutFn(o.d);
    const lane = nearestLane(lay, o.x);
    if ((lay.flow[lane] ?? 0) !== -1) return false;
    // Not where the zone's finale will stand (it may use the oncoming lanes too).
    if (sweep(o)[1] + OBSTACLE_DEFS[o.kind].length / 2 > lightFor(zoneAt(o.d)) - 10) return false;
    const [a0, a1] = footprintOf(o);
    const room = WELCOME_GAP * speedAt(a0);
    for (const l of [lane - 1, lane + 1]) {
      if (l < 0 || l >= lay.offsets.length || (lay.flow[l] ?? 0) === -1) continue;
      // Our lane beside it: it and the next of ours stay free around the pass.
      const ours = [l, l + (l > lane ? 1 : -1)].filter((q) => q >= 0 && q < lay.offsets.length).map((q) => laneOffset(lay, q));
      const busy = (other: Omit<ObstacleSpawn, "id">): boolean => {
        if (other === o || !ours.some((x) => Math.abs(other.x - x) < 0.5)) return false;
        const [c0, c1] = footprintOf(other);
        return c1 > a0 - room && c0 < a1 + 10;
      };
      if (b.obstacles.some(busy)) return false;
      for (const other of this.obstacles) if (other.d > a0 - room - 30 && other.d < a1 + 40 && busy(other)) return false;
      for (const other of this.movers) if (busy(other)) return false;
    }
    return true;
  }

  /**
   * The fairness invariant over the composed track (fairness.ts): with this pattern added to
   * everything already placed around it, is there still an obvious way through everywhere?
   */
  private unfair(b: PatternBuilder): boolean {
    let from = b.start;
    let to = b.end;
    for (const o of b.obstacles) {
      const [a, c] = footprintOf(o);
      from = Math.min(from, a);
      to = Math.max(to, c);
    }
    from -= 45;
    to += 45;
    const near: Omit<ObstacleSpawn, "id">[] = [...b.obstacles];
    const list = this.obstacles;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((list[mid]?.d ?? Infinity) < from - 60) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < list.length; i++) {
      const o = list[i]!;
      if (o.d > to + 60) break;
      near.push(o);
    }
    for (const m of this.movers) if (m.d < from - 60 || m.d > to + 60) continue; else if (!near.includes(m)) near.push(m);
    const course = this.course();
    return unfairPoints(near, from, to, { layout: this.layoutFn, track: course?.track ?? null, speed: speedAt }, 1).length > 0;
  }

  /**
   * Two-lane streets (the old town's narrow lanes, shared streets): one lane always stays free for
   * TWO_LANE_FREE s of running around anything in the other (full-width jumpable rows aside).
   */
  private twoLaneSqueeze(b: PatternBuilder): boolean {
    for (const o of b.obstacles) {
      if (OBSTACLE_DEFS[o.kind].lanes === 3) continue;
      const [a0, a1] = footprintOf(o);
      const two = this.layoutFn(o.d).offsets.length === 2;
      // (the faster of the two speeds: the pace eases through bends)
      const room = TWO_LANE_FREE * speedAt(o.d);
      const clash = (other: ObstacleDraft): boolean => {
        if (other === o || OBSTACLE_DEFS[other.kind].lanes === 3 || Math.abs(other.x - o.x) < 0.3) return false;
        // Either of the two in a two-lane street.
        if (!two && this.layoutFn(other.d).offsets.length !== 2) return false;
        const [b0, b1] = footprintOf(other);
        return Math.max(a0, b0) - Math.min(a1, b1) < Math.max(room, TWO_LANE_FREE * speedAt(other.d));
      };
      for (const other of b.obstacles) if (clash(other)) return true;
      for (const other of this.movers) if (clash(other)) return true;
      const list = this.obstacles;
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((list[mid]?.d ?? Infinity) < a0 - room - 25) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < list.length; i++) {
        const other = list[i]!;
        if (other.d > a1 + room + 25) break;
        if (other.k === 0 && clash(other)) return true;
      }
    }
    return false;
  }

  /** Lap 1's pylon set-piece is still to place, and the generator is at it. */
  private pylonDone = false;
  private pylonDue(easy: boolean, lap: number): boolean {
    const m = this.course()?.track.marks;
    if (!m || this.pylonDone || easy || lap !== 1) return false;
    return this.cursor > m.pylon - PYLON_LEAD && this.cursor < m.pylon - 5;
  }

  /**
   * A pattern is refused whole when anything it places sits in a closure or a passage; a plain
   * moving vehicle there (background traffic: nothing rides on it, the pattern does not need it)
   * is just left out.
   */
  private blocked(b: PatternBuilder, name: PatternName): boolean {
    const essential = name === "rampRoof" || name === "finale";
    for (let i = b.obstacles.length - 1; i >= 0; i--) {
      const o = b.obstacles[i]!;
      if (!this.blockedObstacle(o)) continue;
      const rides = b.pickups.some((p) => p.ride?.spawn === o) || b.slots.some((p) => p.ride?.spawn === o);
      if (o.k !== 0 && !essential && !rides) b.obstacles.splice(i, 1);
      else return true;
    }
    for (const p of b.pickups) if (this.blockedPickup(p.x, p.d, p.y)) return true;
    return false;
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
    const zone0 = zoneAt(this.cursor);
    if (this.cursor < zone0.start + ZONE_MARGIN) this.cursor = zone0.start + ZONE_MARGIN;
    // Skip over reserved stork landings (after the zone margin, which may move into one).
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
        this.cursor = change + Math.max(15, v * (reactionWindow(difficultyAt(change)) + 0.6) + 4);
        const after = this.layoutFn(this.cursor);
        this.lineX = laneOffset(after, nearestLane(after, this.lineX));
        return;
      }
      // Nothing within ±15 m of a layout change.
      limit = Math.min(limit, change - 15);
    }
    if (limit - this.cursor < 10) {
      if (change !== null && change < span.end) {
        // Past the layout change by a reaction's worth of running, as above (never a pattern
        // starting right on the boundary).
        const v = speedAt(change);
        this.cursor = change + Math.max(15, v * (reactionWindow(difficultyAt(change)) + 0.6) + 4);
        const after = this.layoutFn(this.cursor);
        this.lineX = laneOffset(after, nearestLane(after, this.lineX));
      } else this.cursor = span.end + ZONE_MARGIN;
      return;
    }
    const easy = this.fresh && this.cursor < this.easyUntil;
    const ctx = this.context(this.cursor, easy);
    // Lanes that end at the coming change are closed (barriers taper them off ahead of it).
    if (change !== null && change - this.cursor < LANE_CLOSE_AHEAD) {
      const closed = new Set<number>();
      for (let l = 0; l < ctx.layout.offsets.length; l++) if (mapLane(getCourse(), change - 0.5, change + 0.5, l) === null) closed.add(l);
      if (closed.size > 0 && closed.size <= ctx.layout.offsets.length - 2) {
        ctx.closed = closed;
        if (closed.has(ctx.entryLane)) ctx.entryLane = [...ctx.layout.offsets.keys()].filter((l) => !closed.has(l)).reduce((a, l) => (Math.abs(l - ctx.entryLane) < Math.abs(a - ctx.entryLane) ? l : a));
      }
    }
    const tutorial = ctx.zone === "puente-real" && ctx.lap === 1;
    // Signature moments: a finale closing every zone, a roof route in big-vehicle zones.
    let forced: PatternName | null = null;
    const { finaleLength } = finaleRoom(span);
    const finalePending = !easy && this.finaleSerial !== span.serial && this.cursor < ctx.lightAt + 90;
    // Ordinary patterns leave room for the finale at the end of the zone (it starts at the light).
    // (ordinary patterns stop a pattern gap before the light, longer in the welcoming opening, so
    // the finale starts at its light and ends before the lane tapers)
    const finaleSlack = (ctx.lap === 1 && this.cursor < WELCOME_RAMP ? 2.5 : 1.5) * ctx.v;
    let normalLimit = finalePending ? Math.min(ctx.lightAt - finaleSlack, limit) : limit;
    for (const f of this.flights) if (f.clearFrom > this.cursor) normalLimit = Math.min(normalLimit, f.clearFrom - 2);
    // Oncoming traffic reaches far ahead: none just before the finale.
    const finaleSoon = finalePending && normalLimit - this.cursor < 90;
    // A pending roof route needs its lanes free of oncoming traffic: hold the traffic back.
    // (lap 1: the roof route waits until past the middle of the zone, once the run has warmed up)
    const roofFrom = ctx.lap === 1 ? 0.5 : 0.25;
    const roofPending = !easy && ROOF_ZONES.has(ctx.zone) && this.roofSerial !== span.serial && ctx.zoneT > roofFrom - 0.1;
    const trafficLanes = ctx.layout.flow.some((f) => f === 1);
    // Oncoming walls too, just before the roof route is due (its lanes must stay clear ahead).
    ctx.holdOncoming = finaleSoon || (roofPending && ctx.zoneT > roofFrom - 0.07);
    const weights = patternWeights(ctx).filter(([name]) => {
      const def: PatternDef = PATTERNS[name];
      if (def.special) return false;
      if (def.movers && (finaleSoon || roofPending)) return false;
      if (def.traffic && !trafficLanes) return false;
      if (easy && !def.easy) return false;
      if (def.movers && tutorial && this.cursor < 250) return false;
      // The first stretch of the first lap: single obstacles and simple pairs only.
      if (tutorial && this.cursor < 360 && (name === "slalom" || name === "carHop" || name === "fullBarrier")) return false;
      // First 1.5 km of a run: no barriers across the whole street (a forced jump).
      if (ctx.lap === 1 && this.cursor < 1500 && name === "fullBarrier") return false;
      return true;
    });
    const pylon = this.pylonDue(easy, ctx.lap);
    if (pylon) {
      ctx.holdOncoming = false;
      // The bridge's signature moment on lap 1: an oncoming convoy past the pylon on the far
      // lanes, a letter as the reward; it stands in for the bridge's finale.
      forced = PYLON_SET_PIECE;
    } else if (finalePending && ctx.lightAt - this.cursor < 25) {
      forced = "finale";
      if (limit - this.cursor < finaleLength * 0.6 && this.cursor > ctx.lightAt) this.finaleSerial = span.serial; // No room left: give up.
    } else if (!easy && ROOF_ZONES.has(ctx.zone) && this.roofSerial !== span.serial && ctx.zoneT > roofFrom) {
      forced = "rampRoof";
    } else if (!easy && ctx.busStopsNear(this.cursor + 18, this.cursor + 70).length > 0) {
      // A bus waits at the real stop just ahead.
      forced = "busStop";
    }
    ctx.roofDue = forced === "rampRoof";
    // The finale stands at the zone-end light (the stopped traffic queues there), not before it.
    if (forced === "finale" && this.cursor < ctx.lightAt) {
      // (a stork's reserved landing there takes the finale's place)
      if (this.flights.some((f) => ctx.lightAt + finaleLength > f.clearFrom - 2 && ctx.lightAt < f.clearTo)) {
        this.finaleSerial = span.serial;
        forced = null;
      } else this.cursor = ctx.lightAt;
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      const name = forced !== null && attempt < (forced === "busStop" ? 1 : 3) ? forced : this.rng.weighted(weights);
      if (forced === "finale" && name !== "finale") break; // Wait (a breather) rather than crowd the finale out.
      const b = new PatternBuilder(ctx, this.cursor);
      if (!PATTERNS[name].fn(b) || !b.ok) continue;
      const flightLimit = this.flights.reduce((m, f) => (f.clearFrom > this.cursor ? Math.min(m, f.clearFrom - 2) : m), Infinity);
      if (b.end > Math.min(name === "finale" || (pylon && name === PYLON_SET_PIECE) ? limit : normalLimit, flightLimit)) continue;
      const refused = (): boolean => this.blocked(b, name) || this.conflicts(b) || this.twoLaneSqueeze(b) || this.unwelcoming(b) || this.unfair(b);
      if (refused()) {
        if (!b.mirror() || refused()) continue;
      }
      if (pylon && name === PYLON_SET_PIECE) {
        this.pylonDone = true;
        this.finaleSerial = span.serial; // (it stands in for the bridge's finale on lap 1)
      } else if (name === "rampRoof") this.roofSerial = span.serial;
      this.commit(name, b, limit, easy, span);
      if (name === "finale") {
        // The finale closes the zone's traffic; what is left of the zone (a plaza, a paseo)
        // still gets its street patterns.
        this.finaleSerial = span.serial;
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

  /** End of the last committed pattern (to fill long empty stretches with bellotas). */
  private contentEnd = -Infinity;

  /**
   * A bellota trail along the line through an empty stretch (roundabouts, the run-up to a lane
   * change, zone edges): never more than ~45 m without something on the road.
   */
  private fillGap(from: number, to: number, avoid = NaN, own: readonly ObstacleDraft[] = []): void {
    if (to - from < 45 || !Number.isFinite(from)) return;
    const pickups: PickupSpawn[] = [];
    for (let d = from + 10; d <= to - 6; d += 2.6) {
      if (Math.abs(d - avoid) < 3) continue;
      const layout = this.layoutFn(d);
      // Where each lane really is here (lanes opening, tapering), and only lanes the runner can be in.
      const track = this.course()?.track ?? null;
      const xOf = (l: number): number => (track ? laneOffsetAt(track, l, d) : laneOffset(layout, l));
      const usable = (l: number): boolean => !track || (laneOpenAt(track, l, d) && laneShownAt(track, l, d));
      // The line's lane (or the nearest one), else the nearest lane no vehicle drives through.
      const order = layout.offsets.map((_, i) => i).filter(usable).sort((p, q) => Math.abs(xOf(p) - this.lineX) - Math.abs(xOf(q) - this.lineX));
      const lane = order.find((l) => !this.runOver(xOf(l), d, 0.9, own) && !this.blockedPickup(xOf(l), d, 0.9, true) && !own.some((o) => o.k === 0 && Math.abs(o.x - xOf(l)) < 1.2 && Math.abs(o.d - d) < OBSTACLE_DEFS[o.kind].length / 2 + 1.5));
      if (lane === undefined) continue;
      pickups.push({ id: this.nextId++, kind: "bellota", lane, x: xOf(lane), d, y: 0.9 });
    }
    if (pickups.length === 0) return;
    const last = this.pickups[this.pickups.length - 1];
    for (const p of pickups) this.pickups.push(p);
    if (last && pickups[0] && pickups[0].d < last.d) this.pickups.sort((a, c) => a.d - c.d);
  }

  private commit(name: PatternName, b: PatternBuilder, limit: number, easy: boolean, span: ZoneSpan): void {
    const ctx = b.ctx;
    // Fill up to where this pattern's own content begins (some start with a run-up).
    let begin = b.end;
    for (const o of b.obstacles) begin = Math.min(begin, footprintOf(o)[0]);
    for (const p of b.pickups) begin = Math.min(begin, p.d);
    this.fillGap(this.contentEnd, begin, NaN, b.obstacles);
    const prevEnd = this.contentEnd;
    this.contentEnd = Math.max(this.contentEnd, b.end);
    const vEnd = speedAt(b.end);
    let gap = vEnd * (ctx.reaction + 0.15 + b.tail + 0.35 * (1 - ctx.difficulty)) + this.rng.range(0, vEnd * 0.45);
    if (easy) gap *= 1.7;
    else if (ctx.zone === "puente-real" && ctx.lap === 1) gap *= 1.25;
    // Lap 1: breathing room easing back to normal density between WELCOME_UNTIL and WELCOME_RAMP.
    if (ctx.lap === 1 && b.end < WELCOME_RAMP) gap *= 1 + 0.4 * Math.min(1, (WELCOME_RAMP - b.end) / (WELCOME_RAMP - WELCOME_UNTIL));

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

    // The welcoming first kilometres (to WELCOME_RAMP): no bellotas leading into clutter on the
    // pavements (it is there to run past; a lure into a late jump is not welcoming).
    const lure = (p: Omit<PickupSpawn, "id">): boolean =>
      ctx.lap === 1 && p.d < NO_LURE_UNTIL &&
      b.obstacles.some((o) => (PLAIN_JUMP.has(o.kind) || PLAIN_ROLL.has(o.kind)) && Math.abs(o.x - p.x) < 1 && p.d > o.d - WELCOME_GAP * ctx.v && p.d < o.d + 3 &&
        (p.d < WELCOME_UNTIL || !b.isRoad(o.lane)));
    // On the real line of a lane the runner can be in there (lanes blend, open and taper).
    const onLine = (p: Omit<PickupSpawn, "id">): Omit<PickupSpawn, "id"> | null => {
      const track = this.course()?.track;
      if (!track || p.ride) return p;
      const lay = this.layoutFn(p.d);
      let best = -1;
      let bestD = 1.2;
      for (let l = 0; l < lay.offsets.length; l++) {
        if (!laneOpenAt(track, l, p.d)) continue;
        const d = Math.abs(laneOffsetAt(track, l, p.d) - p.x);
        if (d < bestD) {
          bestD = d;
          best = l;
        }
      }
      return best < 0 ? null : { ...p, lane: best, x: laneOffsetAt(track, best, p.d) };
    };
    const pickups: PickupSpawn[] = b.pickups
      .map(onLine)
      .filter((p): p is Omit<PickupSpawn, "id"> => p !== null)
      .filter((p) => !lure(p) && (p.ride !== undefined || !this.runOver(p.x, p.d, p.y, b.obstacles)) && !this.blockedPickup(p.x, p.d, p.y))
      .map((p) => ({ ...p, id: this.nextId++ }));

    // Letters and power-ups.
    const gapLane = b.line;
    const gapD = b.end + gap * 0.5;
    const gapSpot: RewardSlot | null =
      gapD <= limit && !this.runOver(laneOffset(ctx.layout, gapLane), gapD, 1.0, b.obstacles) && !this.blockedPickup(laneOffset(ctx.layout, gapLane), gapD, 1.0)
        ? { lane: gapLane, d: gapD, y: 1.0, risky: false }
        : null;
    const slots = b.slots.filter((s) => (s.ride !== undefined || !this.runOver(laneOffset(ctx.layout, s.lane), s.d, s.y, b.obstacles)) && !this.blockedPickup(laneOffset(ctx.layout, s.lane), s.d, s.y));
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
      const placed = onLine(pk);
      if (placed) pickups.push({ ...placed, id: pk.id });
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
          // Ground bellotas up to and through the landing stretch (it stays clear of obstacles).
          this.fillGap(Math.min(plan.clearFrom - 10, b.end), plan.clearTo + 6, gapSpot.d);
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
    // A pattern thinned out (traffic left out of a closure or a bend, bellotas a vehicle would run
    // over) may have a hole: bellotas along it.
    const items: [number, number][] = [...b.obstacles.map((o) => footprintOf(o)), ...pickups.map((p): [number, number] => [p.d, p.d])].sort((x, y) => x[0] - y[0]);
    // (from the previous content: the pattern's own first bellotas may have been left out)
    let reach = Number.isFinite(prevEnd) && prevEnd < begin && begin - prevEnd < 45 ? prevEnd : begin;
    for (const [x0, x1] of items) {
      if (x0 - reach > 45) this.fillGap(reach - 8, x0, NaN, b.obstacles);
      reach = Math.max(reach, x1);
    }
    if (b.end - reach > 45) this.fillGap(reach - 8, b.end, NaN, b.obstacles);
    const lastPickup = this.pickups[this.pickups.length - 1];
    for (const p of pickups) this.pickups.push(p);
    if (lastPickup && pickups[0] && pickups[0].d < lastPickup.d) this.pickups.sort((a, c) => a.d - c.d);

    this.placed.push({ name, start: b.start, end: b.end });
    this.lineX = laneOffset(ctx.layout, b.line);
    this.cursor = b.end + gap;
  }
}
