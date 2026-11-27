/**
 * Hand-designed obstacle patterns. Each pattern places a short authored stretch (a slalom of
 * cars, a ramp onto bus roofs, a convoy to overtake, oncoming traffic...) and declares its
 * intended line, which the bellota trails trace. Pure: no three.js.
 *
 * Lanes are indices into the lane layout at the pattern start (`ctx.layout`); traffic follows the
 * lanes' flow (+1 same direction as the runner, -1 oncoming, 0 none).
 *
 * Fairness rules every pattern follows (verified by the solvability fuzz test):
 * - Rows that force an action on the line are at least one reaction window apart (more after a
 *   jump or roll), measured in runner distance from the end of the previous row's longest
 *   footprint. A moving vehicle's footprint is the stretch of runner distance where it overlaps
 *   the runner (longer than the vehicle for same-direction traffic, shorter for oncoming), so in
 *   runner distance traffic is laid out exactly like parked obstacles.
 * - The line lane of every row is free, or passable with a single jump or roll.
 * - Moving vehicles never share a lane with the line around their meeting point.
 * - Vehicles never drive through anything while on screen, never change lane, and keep one speed
 *   per lane (a platoon), checked against everything already placed (see traffic.ts).
 */
import { OBSTACLE_DEFS, type ObstacleKind, type PickupKind, type ZoneId } from "../contracts";
import { laneIndices, laneKind, laneOffset, laneWidth, runnableSpan, centreLane, type Flow, type LaneKind, type LaneLayout } from "./lanes";
import type { Rng } from "./rng";
import { BRAKE_DISTANCE, meetingPoint, whenAhead, type ObstacleSpawn, type PickupSpawn, type Trajectory, type VehicleRole } from "./spawns";
import { footprintOf, sweep, lateralOverlap, collides } from "./traffic";
import { RUNNER_HALF_DEPTH, jumpAirtime, jumpApexTime, jumpHeightAt } from "./tuning";

export type ObstacleDraft = Omit<ObstacleSpawn, "id">;
export type PickupDraft = Omit<PickupSpawn, "id">;

/** A good spot for a letter or a power-up on the intended line. */
export interface RewardSlot {
  lane: number;
  d: number;
  y: number;
  /** On a roof, over a barrier...: worth a little risk. */
  risky: boolean;
  /** On a moving roof: rides with it. */
  ride?: { spawn: Trajectory; off: number };
}

export interface PatternContext {
  rng: Rng;
  /** Planned runner speed at the pattern start (m/s). */
  v: number;
  difficulty: number;
  /** Seconds between forced actions. */
  reaction: number;
  zone: ZoneId;
  /** 0..1 progress through the zone at the pattern start. */
  zoneT: number;
  /** Lane index the line enters on. */
  entryLane: number;
  /** Fresh-run warm-up: only the gentlest patterns. */
  easy: boolean;
  lap: number;
  /** Lane layout over the whole pattern. */
  layout: LaneLayout;
  /** World distance same-direction traffic never drives past (the zone-end traffic light). */
  lightAt: number;
  /** Does a new vehicle avoid everything already committed, and drive only where its lane flows its way? */
  canDrive(o: ObstacleDraft): boolean;
  /** Same-direction speed (k) already flowing in a lane around `d`, if any (platoons keep one speed). */
  laneK(lane: number, d: number): number | null;
  /** Centre where the next vehicle queueing at the zone-end light in this lane stops. */
  queueStop(lane: number, length: number): number;
  /**
   * The first real stop line (traffic signal, zebra crossing) in this lane within (from, to], and
   * where the next vehicle queueing at it stops (its centre), or null.
   */
  stopLine(lane: number, length: number, from: number, to: number): { line: number; stop: number } | null;
  /** Would a static obstacle here stay clear of all committed traffic? */
  clearOfTraffic(o: ObstacleDraft): boolean;
  /** Is any of [from, to] under a real arch or gate (nothing tall may go there)? */
  underArch(from: number, to: number): boolean;
  /** Is a real tree trunk within 1 m of the box (lateral x ± halfWidth, distance from..to)? */
  treeNear(x: number, halfWidth: number, from: number, to: number): boolean;
  /** Bars and cafés beside the route within [from, to]: their terraces belong outside. */
  barsNear(from: number, to: number): { s: number; side: "left" | "right" }[];
  /** Real bus stops beside our carriageway within [from, to]. */
  busStopsNear(from: number, to: number): number[];
  /**
   * Live traffic lanes (same direction) in this stretch: only vehicles go there (driving, or
   * queueing at a light), so the traffic can flow; clutter goes in the other lanes.
   */
  live: ReadonlySet<number>;
  /** No oncoming vehicles in this pattern (they reach far ahead: a finale or roof route is coming). */
  holdOncoming: boolean;
  /** World distance where the last static obstacle in a lane ends (-Infinity if none). */
  lastStatic(lane: number): number;
}

/** Oncoming speed towards the runner as a fraction of the runner's speed. */
export const MOVER_K: Readonly<Partial<Record<ObstacleKind, number>>> = {
  coche: 0.55,
  moto: 0.7,
  furgoneta: 0.45,
  bus: 0.35,
  peaton: 0.08,
};
/** Same-direction traffic drives at 25-55% of the runner's speed. */
export const SAME_DIR_K: readonly [number, number] = [-0.55, -0.25];
/** Clear world gap kept between the vehicles of a platoon. */
const PLATOON_GAP: readonly [number, number] = [2.5, 7];

/** Half length of the stretch (in runner distance) where a free-flowing vehicle overlaps the runner. */
export function moverEffectiveHalf(kind: ObstacleKind, k: number): number {
  return (OBSTACLE_DEFS[kind].length / 2 + RUNNER_HALF_DEPTH) / (1 + k) - RUNNER_HALF_DEPTH;
}

const isCar = (kind: ObstacleKind): boolean => kind === "coche" || kind === "furgoneta" || kind === "bus";

export class PatternBuilder {
  readonly obstacles: ObstacleDraft[] = [];
  readonly pickups: PickupDraft[] = [];
  readonly slots: RewardSlot[] = [];
  /** Furthest distance occupied by anything placed. */
  end: number;
  line: number;
  /** Extra seconds of empty road the next pattern must leave (e.g. after falling off a roof). */
  tail = 0;
  /** Something could not be placed: the pattern is rejected. */
  ok = true;
  /** The finale sits past the zone-end light (no traffic): it may use every lane. */
  ignoreLive = false;
  readonly lanes: number[];
  /** Lanes where static clutter may go (not live traffic lanes). */
  readonly clutter: number[];
  private readonly kByLane = new Map<number, number>();
  private readonly queueTail = new Map<string, number>();

  constructor(
    readonly ctx: PatternContext,
    readonly start: number,
  ) {
    this.end = start;
    this.line = ctx.entryLane;
    this.lanes = laneIndices(ctx.layout);
    this.clutter = this.lanes.filter((l) => !ctx.live.has(l));
  }

  isLive(lane: number): boolean {
    return !this.ignoreLive && this.ctx.live.has(lane);
  }

  /** Seconds to metres at the planned speed. */
  s(seconds: number): number {
    return seconds * this.ctx.v;
  }

  get rng(): Rng {
    return this.ctx.rng;
  }

  get n(): number {
    return this.lanes.length;
  }

  xOf(lane: number): number {
    return laneOffset(this.ctx.layout, lane);
  }

  flow(lane: number): Flow {
    return this.ctx.layout.flow[lane] ?? 0;
  }

  otherLanes(lane: number): number[] {
    return this.lanes.filter((l) => l !== lane);
  }

  /** Lanes next to `lane`. */
  neighbours(lane: number): number[] {
    return this.lanes.filter((l) => Math.abs(l - lane) === 1);
  }

  /** Extra run-up (metres) for the line to move from the entry lane to `lane`: 0.3 s per lane. */
  approach(lane: number): number {
    return this.s(0.3 * Math.abs(lane - this.ctx.entryLane));
  }

  /** Prefer staying or moving one lane. */
  nearLane(from: number, among: readonly number[] = this.lanes): number {
    return this.rng.weighted<number>(among.map((l) => [l, Math.abs(l - from) === 0 ? 3 : Math.abs(l - from) === 1 ? 2 : 1] as const));
  }

  /** A weighted pick; an empty list rejects the pattern (nothing of that role fits here). */
  pick(list: readonly (readonly [ObstacleKind, number])[]): ObstacleKind {
    if (!list.some(([, w]) => w > 0)) {
      this.ok = false;
      return "conos";
    }
    return this.rng.weighted(list);
  }

  isRoad(lane: number): boolean {
    return this.laneKind(lane) === "road";
  }

  /** Art variant seed; taxis are common near the centre. */
  seedFor(kind: ObstacleKind): number {
    const seed = this.rng.int(0, 9999);
    if (kind === "coche" && (this.ctx.zone === "san-francisco" || this.ctx.zone === "casco-antiguo") && this.rng.chance(0.35)) {
      return seed - (seed % 6) + 3;
    }
    return seed;
  }

  laneKind(lane: number): LaneKind {
    return laneKind(this.ctx.layout, lane);
  }

  /**
   * Widest obstacle a lane takes: its width + 0.3, and narrower than the distance to the next
   * lanes so side-by-side obstacles never overlap (narrow pedestrian streets).
   */
  laneWidth(lane: number): number {
    const own = laneWidth(this.ctx.layout, lane) + 0.3;
    const x = this.xOf(lane);
    let room = Infinity;
    for (const l of [lane - 1, lane + 1]) if (l >= 0 && l < this.n) room = Math.min(room, Math.abs(this.xOf(l) - x) - 0.1);
    return Math.min(own, room) - 0.3;
  }

  /** Would a static `kind` at `front` in `lane` stay clear of the traffic already on the road? */
  clearOfTraffic(kind: ObstacleKind, lane: number, front: number): boolean {
    const def = OBSTACLE_DEFS[kind];
    const o: ObstacleDraft = { kind, lane, x: this.xOf(lane), d: front + def.length / 2, k: 0, seed: 0, flipped: false };
    if (!this.ctx.clearOfTraffic(o)) return false;
    for (const other of this.obstacles) if (other.k !== 0 && lateralOverlap(o, other) && collides(o, other)) return false;
    return true;
  }

  /** Can this go here: it fits the lane, it is not on a real tree, nothing tall under an arch? */
  canPlace(kind: ObstacleKind, lane: number, front: number): boolean {
    const def = OBSTACLE_DEFS[kind];
    if (def.lanes === 1) {
      const kindL = this.laneKind(lane);
      if (def.width > this.laneWidth(lane) + 0.3) return false;
      if ((kindL === "median" || kindL === "sidewalk") && this.ctx.treeNear(this.xOf(lane), def.width / 2, front, front + def.length)) return false;
    }
    if ((def.yMax > 2 || def.yMin > 0 || def.vehicle) && this.ctx.underArch(front - 3, front + def.length + 3)) return false;
    return true;
  }

  /** Place a parked obstacle with its front (the end the runner reaches first) at `front`. Returns its end. */
  place(kind: ObstacleKind, lane: number, front: number, role?: VehicleRole): number {
    const def = OBSTACLE_DEFS[kind];
    if (!this.canPlace(kind, lane, front)) this.ok = false;
    // Nothing static in a live traffic lane (the traffic would have to drive through it).
    if (!this.ignoreLive && (def.lanes === 3 ? this.ctx.live.size > 0 : this.ctx.live.has(lane))) this.ok = false;
    // Stopped vehicles face the way their lane flows (oncoming lanes: towards the runner).
    const flow = this.flow(lane);
    const flipped = def.vehicle && kind !== "camion-rampa" ? (flow === 0 ? this.rng.chance(0.5) : flow === -1) : false;
    const o: ObstacleDraft = { kind, lane, x: this.xOf(lane), d: front + def.length / 2, k: 0, seed: this.seedFor(kind), flipped };
    if (def.lanes === 3) {
      const span = runnableSpan(this.ctx.layout);
      o.lane = centreLane(this.ctx.layout);
      o.x = span.centre;
      o.span = span.width;
    }
    if (def.vehicle && role) o.role = role;
    this.obstacles.push(o);
    const end = front + def.length;
    this.end = Math.max(this.end, end);
    return end;
  }

  /** Same-direction speed for a lane in this pattern (one per lane: a platoon never overtakes itself). */
  laneSpeed(lane: number): number {
    let k = this.kByLane.get(lane);
    if (k === undefined) {
      const known = this.ctx.laneK(lane, this.start);
      if (known !== null) k = known;
      else {
        // Slow enough that, back when it came into view, it was already past the last thing
        // parked in its lane.
        const back = this.start - this.ctx.lastStatic(lane) - 10;
        const reach = Number.isFinite(back) ? back / (175 + back) : 1;
        const fastest = Math.max(-SAME_DIR_K[1], Math.min(-SAME_DIR_K[0], reach));
        k = -this.rng.range(-SAME_DIR_K[1], fastest);
      }
      this.kByLane.set(lane, k);
    }
    return k;
  }

  private queueStopFor(lane: number, length: number): number {
    const tail = this.queueTail.get(`light|${lane}`);
    return tail !== undefined ? tail - length / 2 : this.ctx.queueStop(lane, length);
  }

  /** Footprint end of a placed obstacle. */
  endOf(o: ObstacleDraft): number {
    return footprintOf(o)[1];
  }

  /** Can `o` go in without hitting anything this pattern placed so far? */
  private fitsOwn(o: ObstacleDraft): boolean {
    for (const other of this.obstacles) {
      if (other.k === 0 && o.k === 0) continue;
      if (!lateralOverlap(o, other)) continue;
      if (collides(o, other)) return false;
    }
    return true;
  }

  /**
   * A vehicle driving in `lane` (k < 0 same direction, k > 0 oncoming) whose footprint starts at
   * `front`. Same-direction vehicles brake to a halt at the light once the runner has passed
   * them. Returns null (and places nothing) if it cannot drive there.
   */
  drive(kind: ObstacleKind, lane: number, front: number, k: number): ObstacleDraft | null {
    const def = OBSTACLE_DEFS[kind];
    const d = front + moverEffectiveHalf(kind, k);
    const o: ObstacleDraft = { kind, lane, x: this.xOf(lane), d, k, seed: this.seedFor(kind), flipped: false };
    if (this.ctx.underArch(o.d - 40, o.d + 40) && def.yMax > 2) return null;
    if (k < 0 && isCar(kind)) {
      // Stop at the first real signal or crossing it would reach, else at the zone-end light.
      const free = sweep(o)[1];
      const light = this.queueStopFor(lane, def.length);
      const found = this.ctx.stopLine(lane, def.length, d, free + def.length / 2);
      // The zone-end light comes first when it is nearer (the finale lies beyond it).
      const real = found && found.stop < light ? found : null;
      const key = real ? `${real.line}|${lane}` : `light|${lane}`;
      const tail = this.queueTail.get(key);
      const stop = tail !== undefined ? tail - def.length / 2 : real ? real.stop : light;
      if (free > stop) {
        const end = footprintOf(o)[1];
        o.d0 = d;
        o.stop = stop;
        if (real) o.stopLine = real.line;
        o.d = meetingPoint(o);
        // It must still be driving when the runner overtakes it.
        if (Math.abs(footprintOf(o)[1] - end) > 0.05) return null;
        if (sweep(o)[1] >= stop - 1e-6) this.queueTail.set(key, stop - def.length / 2 - 1.2);
      }
    }
    if (!this.ctx.canDrive(o) || !this.fitsOwn(o)) return null;
    this.obstacles.push(o);
    this.end = Math.max(this.end, this.endOf(o));
    return o;
  }

  /**
   * A vehicle standing in a queue at a light: its footprint is [front, front + length]; it drove
   * up and braked to a halt a couple of seconds before the runner gets there.
   */
  queued(kind: ObstacleKind, lane: number, front: number, lead: number, role: VehicleRole = "lights"): ObstacleDraft | null {
    const def = OBSTACLE_DEFS[kind];
    const k = this.laneSpeed(lane);
    const stop = front + def.length / 2;
    const pFull = stop - lead;
    const d0 = (stop + BRAKE_DISTANCE / 2 + k * pFull) / (1 + k);
    const o: ObstacleDraft = { kind, lane, x: this.xOf(lane), d: stop, d0, stop, k, seed: this.seedFor(kind), flipped: false, role };
    if (this.ctx.underArch(front - 10, front + def.length + 10) && def.yMax > 2) return null;
    o.d = meetingPoint(o);
    if (Math.abs(o.d - stop) > 0.05) return null;
    if (!this.ctx.canDrive(o) || !this.fitsOwn(o)) return null;
    this.obstacles.push(o);
    this.end = Math.max(this.end, this.endOf(o));
    return o;
  }

  /**
   * A vehicle blocking `lane` from `front`: it drives with the lane's traffic when it can, else it
   * is stopped there (at a light, broken down, at the bus stop). Returns the end of its footprint.
   */
  wall(kind: ObstacleKind, lane: number, front: number): number {
    const def = OBSTACLE_DEFS[kind];
    if (kind === "peaton" && this.rng.chance(0.55)) {
      // Walking slowly, towards you or away.
      const k = this.rng.chance(0.5) ? this.rng.range(0.05, 0.1) : -this.rng.range(0.04, 0.08);
      const o = this.drive(kind, lane, front, k);
      if (o) return this.endOf(o);
    }
    if (isCar(kind) && this.flow(lane) === 1 && this.isLive(lane)) {
      const o = this.drive(kind, lane, front, this.laneSpeed(lane));
      if (o) return this.endOf(o);
    }
    if (isCar(kind) && this.flow(lane) === -1 && !this.ctx.easy && !this.ctx.holdOncoming && this.start > 300) {
      // Oncoming: one speed per lane (the first vehicle's), so they never close up on each other.
      const k = this.kByLane.get(lane) ?? MOVER_K[kind] ?? 0.5;
      this.kByLane.set(lane, k);
      const o = this.drive(kind, lane, front, k);
      if (o) return this.endOf(o);
    }
    if (this.isLive(lane)) {
      // A live lane only takes traffic.
      this.ok = false;
      return front + def.length;
    }
    if (!def.vehicle) return this.place(kind, lane, front);
    const flow = this.flow(lane);
    const role: VehicleRole =
      flow === 1 ? (kind === "bus" && lane === this.n - 1 ? "bus-stop" : this.rng.chance(0.5) ? "broken" : "lights")
      : flow === -1 ? "lights" : "parked";
    return this.place(kind, lane, front, role);
  }

  /** Oncoming vehicle whose footprint starts at `front`. Returns its footprint end (rejects the pattern if it cannot drive). */
  mover(kind: ObstacleKind, lane: number, front: number): number {
    const o = this.drive(kind, lane, front, MOVER_K[kind] ?? 0.5);
    if (!o) {
      this.ok = false;
      return front + OBSTACLE_DEFS[kind].length;
    }
    return this.endOf(o);
  }

  /**
   * A same-direction platoon (one speed): `kinds` from the front of the convoy backwards is not
   * needed; they are listed in the order the runner reaches them. Returns the drafts or null
   * (nothing placed).
   */
  platoon(lane: number, front: number, kinds: readonly ObstacleKind[], k: number, gaps: readonly number[]): ObstacleDraft[] | null {
    const placed: ObstacleDraft[] = [];
    let f = front;
    let prev: ObstacleDraft | null = null;
    for (let i = 0; i < kinds.length; i++) {
      const kind = kinds[i];
      if (!kind) continue;
      if (prev) {
        const gap = gaps[i - 1] ?? gaps[gaps.length - 1] ?? 3;
        const dc = OBSTACLE_DEFS[prev.kind].length / 2 + OBSTACLE_DEFS[kind].length / 2 + gap;
        f = (prev.d0 ?? prev.d) + dc / (1 + k) - moverEffectiveHalf(kind, k);
      }
      const o = this.drive(kind, lane, f, k);
      if (!o) {
        for (const p of placed) this.obstacles.splice(this.obstacles.indexOf(p), 1);
        this.end = Math.max(this.start, ...this.obstacles.map((x) => this.endOf(x)));
        return null;
      }
      placed.push(o);
      prev = o;
    }
    return placed;
  }

  pickup(kind: PickupKind, lane: number, d: number, y: number): void {
    this.pickups.push({ kind, lane, x: this.xOf(lane), d, y });
  }

  /** Bellotas riding on a moving roof (or ramp), `spacing` apart, `y` above the road. */
  roofTrail(o: ObstacleDraft, y: number | ((off: number) => number), spacing = 2.2, margin = 0.8): void {
    const half = OBSTACLE_DEFS[o.kind].length / 2 - margin;
    for (let off = half; off >= -half - 1e-6; off -= spacing) {
      const yy = typeof y === "number" ? y : y(off);
      if (o.k === 0) this.pickup("bellota", o.lane, o.d + off, yy);
      else this.pickups.push({ kind: "bellota", lane: o.lane, x: o.x, d: whenAhead(o, -off), y: yy, ride: { spawn: o, off } });
    }
  }

  /** A reward slot on top of an obstacle (riding it if it moves). */
  roofSlot(o: ObstacleDraft, off: number, y: number): void {
    if (o.k === 0) this.slot(o.lane, o.d + off, y, true);
    else this.slots.push({ lane: o.lane, d: whenAhead(o, -off), y, risky: true, ride: { spawn: o, off } });
  }

  /** A straight bellota trail. */
  trail(lane: number, from: number, to: number, y = 0.9, spacing = 2.4): void {
    for (let d = from; d <= to + 1e-6; d += spacing) this.pickup("bellota", lane, d, y);
  }

  /** Bellotas along a normal jump taking off at `takeoff`, from height `baseY` (`portion` of the airtime). */
  arc(lane: number, takeoff: number, baseY = 0, portion = 1): void {
    const air = jumpAirtime();
    const n = 7;
    for (let i = 1; i <= n; i++) {
      const t = (air * i) / (n + 1);
      if (t > air * portion + 1e-6) break;
      const y = baseY + jumpHeightAt(t) + 0.9;
      this.pickup("bellota", lane, takeoff + this.ctx.v * t, y);
    }
  }

  /** Takeoff distance so that a normal jump peaks over `centre`. */
  takeoffFor(centre: number): number {
    return centre - this.s(jumpApexTime());
  }

  slot(lane: number, d: number, y: number, risky: boolean): void {
    this.slots.push({ lane, d, y, risky });
  }

  /** Mirror every lane (used to dodge traffic). False if the traffic cannot drive in the mirrored lanes. */
  mirror(): boolean {
    const n = this.n;
    const flip = (l: number): number => n - 1 - l;
    for (const o of this.obstacles) {
      const def = OBSTACLE_DEFS[o.kind];
      if (def.lanes === 3) continue;
      const m = flip(o.lane);
      // Same kind of lane on the other side, wide enough, same traffic.
      if (this.laneKind(m) !== this.laneKind(o.lane) || def.width > this.laneWidth(m) + 0.3) return false;
      if (o.k !== 0 && (this.ctx.layout.flow[m] ?? 0) !== (this.ctx.layout.flow[o.lane] ?? 0)) return false;
      if (o.k === 0 && this.isLive(m)) return false;
    }
    for (const o of this.obstacles) {
      if (OBSTACLE_DEFS[o.kind].lanes === 3) continue;
      o.lane = flip(o.lane);
      o.x = this.xOf(o.lane);
    }
    for (const p of this.pickups) {
      p.lane = flip(p.lane);
      p.x = this.xOf(p.lane);
    }
    for (const s of this.slots) s.lane = flip(s.lane);
    this.line = flip(this.line);
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Zone palettes
// ---------------------------------------------------------------------------------------------

type Weights<T> = readonly (readonly [T, number])[];

interface Palette {
  /** Jumpable, not walkable. */
  low: Weights<ObstacleKind>;
  /** Blocks a lane at ground level (cars and containers can also be jumped onto). */
  wall: Weights<ObstacleKind>;
  /** Roll under. */
  over: Weights<ObstacleKind>;
  /** Oncoming traffic. */
  movers: Weights<ObstacleKind>;
  /** 3-lane barriers. */
  full: Weights<ObstacleKind>;
}

const PALETTES: Readonly<Record<ZoneId, Palette>> = {
  "puente-real": {
    low: [["valla", 3], ["conos", 3]],
    wall: [["coche", 4], ["furgoneta", 1]],
    over: [["andamio", 1]],
    movers: [["coche", 3], ["moto", 1]],
    full: [["valla-larga", 3], ["pancarta", 1]],
  },
  valdepasillas: {
    low: [["valla", 2], ["conos", 2]],
    wall: [["coche", 3], ["furgoneta", 3], ["bus", 3], ["contenedor", 1]],
    over: [["andamio", 1]],
    movers: [["coche", 3], ["furgoneta", 2], ["bus", 2], ["moto", 1]],
    full: [["valla-larga", 2], ["pancarta", 1]],
  },
  "san-francisco": {
    low: [["terraza", 3], ["valla", 1.5], ["conos", 1], ["moto", 1.5]],
    wall: [["contenedor", 4], ["coche", 2], ["furgoneta", 1]],
    over: [["andamio", 2]],
    movers: [["moto", 3], ["coche", 1]],
    full: [["pancarta", 3], ["valla-larga", 1]],
  },
  "casco-antiguo": {
    low: [["terraza", 3], ["valla", 3], ["moto", 1], ["conos", 1]],
    wall: [["contenedor", 3], ["coche", 1]],
    over: [["andamio", 4]],
    movers: [["moto", 4]],
    full: [["pancarta", 2], ["valla-larga", 2]],
  },
  "alcazaba-palmas": {
    low: [["conos", 3], ["valla", 3], ["terraza", 1]],
    wall: [["contenedor", 2], ["coche", 1]],
    over: [["andamio", 3]],
    movers: [["moto", 3]],
    full: [["pancarta", 2], ["valla-larga", 2]],
  },
  "margen-derecha": {
    low: [["valla", 2], ["conos", 2], ["moto", 1]],
    wall: [["coche", 4], ["furgoneta", 3], ["bus", 2]],
    over: [["andamio", 1]],
    movers: [["coche", 4], ["furgoneta", 2], ["bus", 2], ["moto", 2]],
    full: [["valla-larga", 2], ["pancarta", 1]],
  },
};

const SIDEWALK: Palette = {
  low: [["bolardos", 3], ["maceta", 2], ["mesa", 1], ["valla", 1]],
  wall: [["peaton", 3], ["contenedor", 2], ["moto", 1]],
  over: [["andamio", 2]],
  movers: [["peaton", 1]],
  full: [],
};
const MEDIAN: Palette = {
  low: [["maceta", 2], ["bolardos", 2]],
  wall: [["peaton", 1]],
  over: [],
  movers: [["peaton", 1]],
  full: [],
};

/**
 * What goes in a lane: the zone's palette on the road; on sidewalks, medians and pedestrian
 * streets the narrow street kinds (pedestrians, planters, bollards, bar tables...), with more
 * tables outside real bars. Only kinds that fit the lane's width; nothing tall under arches.
 * Without `lane`: the street as a whole (full-width obstacles only where there is no road).
 */
function palette(b: PatternBuilder, lane?: number): Palette {
  const ctx = b.ctx;
  let base = PALETTES[ctx.zone];
  // The walled streets of the Alcazaba become the old Puente de Palmas: no terraces or scaffolds.
  if (ctx.zone === "alcazaba-palmas" && ctx.zoneT > 0.5) {
    base = { ...base, low: [["conos", 3], ["valla", 3]], over: [["andamio", 0.5]], wall: [["coche", 1]] };
  }
  const kinds = b.lanes.map((l) => b.laneKind(l));
  const road = kinds.includes("road");
  const kind: LaneKind = lane === undefined ? (road ? "road" : "pedestrian") : b.laneKind(lane);
  let pal: Palette;
  switch (kind) {
    case "road":
      pal = { ...base, over: [], full: [] };
      break;
    case "sidewalk":
      pal = SIDEWALK;
      break;
    case "median":
      pal = MEDIAN;
      break;
    case "pedestrian": {
      const old = ctx.zone === "casco-antiguo" || ctx.zone === "san-francisco";
      pal = {
        low: [["mesa", 3], ["maceta", 2], ["bolardos", 2], ["terraza", old ? 2 : 0.5], ["valla", 1]],
        wall: [["peaton", 4], ["contenedor", 1], ["moto", 1]],
        over: [["andamio", 2]],
        movers: [["peaton", 4], ["moto", 0.6]],
        full: road ? [] : base.full,
      };
      break;
    }
  }
  // Terraces outside real bars and cafés.
  if ((kind === "sidewalk" || kind === "pedestrian") && ctx.barsNear(b.start - 10, b.start + 60).length > 0) {
    pal = { ...pal, low: [...pal.low, ["mesa", 4], ["terraza", 2]] };
  }
  const width = lane === undefined ? Infinity : b.laneWidth(lane) + 0.3;
  const arch = ctx.underArch(b.start - 10, b.start + 110);
  const ok = ([k]: readonly [ObstacleKind, number]): boolean => {
    const def = OBSTACLE_DEFS[k];
    if (def.lanes === 1 && def.width > width) return false;
    if (arch && (def.yMax > 2 || def.yMin > 0 || def.vehicle)) return false;
    return true;
  };
  return {
    low: pal.low.filter(ok),
    wall: pal.wall.filter(ok),
    over: pal.over.filter(ok),
    movers: pal.movers.filter(ok),
    full: pal.full.filter(ok),
  };
}

function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/** Gap after a row: one reaction window, longer when the line needed an action there. */
function rowGap(b: PatternBuilder, action: boolean): number {
  // Early on (low difficulty) rows breathe a little more: humans need time to read them.
  const early = 0.25 * (1 - b.ctx.difficulty);
  return b.s(b.ctx.reaction + (action ? 0.35 : 0.05) + early);
}

/** Bellotas on the line for a row passed by a jump/roll/run. */
function lineCell(b: PatternBuilder, lane: number, kind: ObstacleKind | null, front: number): void {
  if (kind === null) {
    b.trail(lane, front - 2, front + 3);
    return;
  }
  const def = OBSTACLE_DEFS[kind];
  if (def.yMin > 0) {
    b.trail(lane, front - 1.5, front + def.length + 1.5, 0.45, 1.6);
  } else {
    b.arc(lane, b.takeoffFor(front + def.length / 2));
  }
}

/** Oncoming vehicles may use this lane (scooters ride pedestrian streets; pedestrians walk anywhere off the road). */
function oncomingLane(b: PatternBuilder, lane: number, kind: ObstacleKind): boolean {
  const f = b.flow(lane);
  const k = b.laneKind(lane);
  if (kind === "peaton") return k !== "road";
  if (kind === "moto") return f === -1 || k === "pedestrian";
  return f === -1 && k === "road" && OBSTACLE_DEFS[kind].width <= b.laneWidth(lane) + 0.3;
}

// ---------------------------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------------------------

export type PatternFn = (b: PatternBuilder) => boolean;

/** One obstacle; the line jumps it, rolls under it or goes round. */
const single: PatternFn = (b) => {
  const { rng } = b;
  const role = b.ctx.easy ? rng.weighted([["low", 3], ["wall", 2]] as const) : rng.weighted([["low", 3], ["wall", 3], ["over", 1.5]] as const);
  const choices = (role === "wall" ? b.lanes : b.clutter).filter((l) => palette(b, l)[role].length > 0);
  if (choices.length === 0) return false;
  const lane = rng.pick(choices);
  const pal = palette(b, lane);
  const kind = b.pick(role === "low" ? pal.low : role === "wall" ? pal.wall : pal.over);
  const front = b.start + b.approach(lane);
  const end = role === "wall" ? b.wall(kind, lane, front) : b.place(kind, lane, front);
  const gentle = b.ctx.zone === "puente-real" && b.ctx.lap === 1;
  if (role !== "wall" && rng.chance(gentle ? 0.3 : 0.55)) {
    b.line = lane;
    lineCell(b, lane, kind, front);
    if (role === "low") b.slot(lane, front + OBSTACLE_DEFS[kind].length / 2, 2.4, true);
  } else {
    const line = b.nearLane(b.ctx.entryLane, b.otherLanes(lane));
    b.line = line;
    b.trail(line, front - b.s(0.3), end + 2);
  }
  return true;
};

/** Every lane blocked but one gap (sometimes with a barrier to jump or a scaffold to roll under). */
const twoBlock: PatternFn = (b) => {
  const { rng, ctx } = b;
  const gap = b.nearLane(ctx.entryLane);
  const front = b.start;
  let rowEnd = front;
  for (const l of b.otherLanes(gap)) {
    const walls = palette(b, l).wall;
    // Sidewalks and medians are a cluttered refuge, not a wall: often left open.
    if (!b.isRoad(l) && rng.chance(0.4)) continue;
    rowEnd = Math.max(rowEnd, b.wall(b.pick(walls), l, front));
  }
  b.line = gap;
  if (!ctx.easy && !b.isLive(gap) && ctx.lap + ctx.difficulty > 1.2 && rng.chance(0.35 + 0.35 * ctx.difficulty)) {
    const pg = palette(b, gap);
    const kind = rng.chance(0.6) || pg.over.length === 0 ? b.pick(pg.low) : b.pick(pg.over);
    b.place(kind, gap, front);
    lineCell(b, gap, kind, front);
  } else {
    b.trail(gap, front - b.s(0.3), rowEnd + 1);
  }
  return true;
};

/** Cars leaving one gap that shifts lane row by row (driving ones in the traffic lanes). */
const slalom: PatternFn = (b) => {
  const { rng, ctx } = b;
  const rows = ctx.zone === "puente-real" && ctx.lap === 1 ? 3 : 3 + Math.round(ctx.difficulty * 2);
  let gap = rng.pick(b.lanes);
  let front = b.start;
  for (let r = 0; r < rows; r++) {
    let rowEnd = front;
    for (const l of b.otherLanes(gap)) {
      const walls = palette(b, l).wall;
      const kind = b.isRoad(l) && walls.some(([k]) => k === "coche") && rng.chance(0.75) ? "coche" : b.pick(walls);
      rowEnd = Math.max(rowEnd, b.wall(kind, l, front));
    }
    b.trail(gap, front - 1, rowEnd, 0.9, 2.2);
    b.line = gap;
    front = rowEnd + rowGap(b, true);
    gap = rng.pick(b.neighbours(gap));
  }
  return true;
};

/**
 * A line of cars to hop along roof to roof: a slow convoy in a traffic lane (one speed, bumper to
 * bumper), else parked. Sometimes every lane: a traffic jam you must climb.
 */
const carHop: PatternFn = (b) => {
  const { rng, ctx } = b;
  const roads = b.lanes.filter((l) => b.isRoad(l) && !ctx.underArch(b.start, b.start + 40));
  if (roads.length === 0) return false;
  const lane = b.nearLane(ctx.entryLane, roads);
  const count = rng.int(3, 5);
  // Bumper to bumper: the roofs form one continuous walkway (no falling between cars).
  const gapLen = 0.4;
  const jam = !ctx.easy && ctx.difficulty + (ctx.lap - 1) * 0.3 > 0.35 && rng.chance(0.45);
  const front = b.start + b.approach(lane);
  const roofY = OBSTACLE_DEFS.coche.yMax;
  let lineEnd = front;
  const lanes = jam ? roads : [lane];
  for (const l of lanes) {
    const n = l === lane ? count : rng.int(2, count);
    const kinds: ObstacleKind[] = Array.from({ length: n }, () => "coche");
    let convoy: ObstacleDraft[] | null = null;
    if (b.flow(l) === 1 && !ctx.easy) convoy = b.platoon(l, front, kinds, b.laneSpeed(l), [gapLen]);
    if (convoy) {
      const last = convoy[convoy.length - 1];
      if (l === lane && last) {
        lineEnd = b.endOf(last);
        for (const o of convoy) b.roofTrail(o, roofY + 0.9);
        const mid = convoy[Math.floor(convoy.length / 2)];
        if (mid) b.roofSlot(mid, 0, roofY + 1.0);
      }
    } else {
      let f = front;
      for (let i = 0; i < n; i++) f = b.place("coche", l, f, b.flow(l) === 0 ? "parked" : "lights") + gapLen;
      if (l === lane) {
        lineEnd = f - gapLen;
        b.trail(lane, front + 2, lineEnd - 0.5, roofY + 0.9, 2.2);
        b.slot(lane, front + (lineEnd - front) * 0.6, roofY + 1.0, true);
      }
    }
  }
  b.line = lane;
  b.arc(lane, b.takeoffFor(front), 0, 0.5);
  if (!jam && ctx.difficulty > 0.15) {
    // Something to think about on the ground lanes too.
    const others = b.clutter.filter((l) => l !== lane && palette(b, l).low.length > 0);
    if (others.length > 0) {
      const other = rng.pick(others);
      b.place(b.pick(palette(b, other).low), other, front + b.s(0.2));
    }
  }
  b.end = Math.max(b.end, lineEnd);
  b.tail = 0.35;
  return true;
};

/**
 * Tow-truck ramp straight onto van and bus roofs, bellotas along the top; the ground lanes are
 * busier. In a traffic lane the whole convoy drives (one speed): you run up a moving ramp onto
 * moving roofs.
 */
const rampRoof: PatternFn = (b) => {
  const { rng, ctx } = b;
  // Ramp trucks and buses need a road lane wide enough, and no arch overhead.
  const roads = b.lanes.filter((l) => b.isRoad(l) && b.laneWidth(l) + 0.3 >= OBSTACLE_DEFS.bus.width);
  if (roads.length === 0 || ctx.underArch(b.start - 10, b.start + 80)) return false;
  const traffic = roads.filter((l) => b.flow(l) === 1);
  let lane = traffic.length > 0 && rng.chance(0.8) ? rng.pick(traffic) : rng.pick(roads);
  const front = b.start;
  const chains: ObstacleKind[][] = [
    ["bus"],
    ["bus", "bus"],
    ["bus", "furgoneta"],
    ["furgoneta", "furgoneta"],
    ["bus", "furgoneta", "furgoneta"],
    ["bus", "bus", "furgoneta"],
  ];
  const chain = rng.pick(chains);
  // Parked, the gaps between roofs grow with speed (a hop); a driving convoy is bumper to bumper
  // (under the runner's own depth: the roofs form one walkway that never drops the feet).
  const sameHeightGap = b.flow(lane) === 1 ? 0.35 : Math.min(0.8, 0.05 * ctx.v);
  const kinds: ObstacleKind[] = ["camion-rampa", ...chain];
  const gaps: number[] = [];
  let prevTop = OBSTACLE_DEFS["camion-rampa"].yMax;
  for (const kind of chain) {
    const top = OBSTACLE_DEFS[kind].yMax;
    gaps.push(top >= prevTop ? sameHeightGap : rng.range(0.5, 1.2));
    prevTop = top;
  }
  let convoy: ObstacleDraft[] | null = null;
  if (b.flow(lane) === 1) convoy = b.platoon(lane, front, kinds, b.laneSpeed(lane), gaps);
  if (!convoy && b.isLive(lane)) {
    // The traffic lane is busy: park the ramp truck in a lane without traffic instead.
    const parked = roads.filter((l) => !b.isLive(l));
    if (parked.length === 0) return false;
    lane = rng.pick(parked);
  }
  let roofEnd: number;
  if (convoy) {
    const ramp = convoy[0];
    const last = convoy[convoy.length - 1];
    if (!ramp || !last) return false;
    roofEnd = b.endOf(last);
    const H = OBSTACLE_DEFS["camion-rampa"].yMax;
    const L = OBSTACLE_DEFS["camion-rampa"].length;
    b.roofTrail(ramp, (off) => (H * (L / 2 - off)) / L + 0.9, 1.8, 0.6);
    for (const o of convoy.slice(1)) b.roofTrail(o, OBSTACLE_DEFS[o.kind].yMax + 0.9);
    const bus = convoy[1];
    if (bus) b.roofSlot(bus, 0, OBSTACLE_DEFS.bus.yMax + 1.0);
  } else {
    let f = b.place("camion-rampa", lane, front);
    for (let i = 0; i < chain.length; i++) {
      const kind = chain[i];
      if (!kind) continue;
      f += gaps[i] ?? 0.5;
      f = b.place(kind, lane, f, b.flow(lane) === 0 ? "parked" : "lights");
    }
    roofEnd = f;
    b.trail(lane, front + 1, front + 6, 1.6, 1.8);
    b.trail(lane, front + 8, roofEnd - 1, prevTop + 0.9, 2.2);
    b.slot(lane, front + 7 + (roofEnd - front - 7) * 0.5, OBSTACLE_DEFS.bus.yMax + 1.0, true);
  }
  b.line = lane;
  // Ground lanes: one walled by big vehicles, the others a jumping route.
  const others = b.otherLanes(lane);
  if (others.length === 0) return false;
  const roadOthers = others.filter((l) => b.isRoad(l));
  const walled = roadOthers.length > 0 ? rng.pick(roadOthers) : -1;
  let w = front + rng.range(0, 4);
  let guard = 0;
  while (walled >= 0 && w < roofEnd - 4 && guard++ < 12) {
    const big = palette(b, walled).wall.filter(([k]) => k === "bus" || k === "furgoneta" || k === "coche");
    const kind = big.length > 0 ? rng.weighted(big) : "coche";
    w = b.wall(kind, walled, w) + rng.range(0.6, 3);
  }
  const step = b.s(1.05);
  for (const ground of others) {
    if (ground === walled || b.isLive(ground)) continue;
    const lows = palette(b, ground).low;
    if (lows.length === 0) continue;
    // Sidewalks stay a sparser refuge.
    const every = b.isRoad(ground) ? step + 1 : 2 * step + 1;
    for (let g = front + b.s(0.3); g < roofEnd - 2; g += every) b.place(b.pick(lows), ground, g);
  }
  b.end = Math.max(b.end, roofEnd);
  b.tail = 0.5;
  return true;
};

/** A barrier with an arc of bellotas over it; often the neighbours are blocked so the jump is the way. */
const arcValla: PatternFn = (b) => {
  const { rng, ctx } = b;
  const lanes = b.clutter.filter((l) => palette(b, l).low.length > 0);
  if (lanes.length === 0) return false;
  const lane = b.nearLane(ctx.entryLane, lanes);
  const kind = b.pick(palette(b, lane).low);
  const front = b.start + b.approach(lane);
  b.place(kind, lane, front);
  b.line = lane;
  lineCell(b, lane, kind, front);
  b.slot(lane, front + OBSTACLE_DEFS[kind].length / 2, 2.5, true);
  if (!ctx.easy && rng.chance(0.3 + 0.5 * ctx.difficulty)) {
    for (const l of b.otherLanes(lane)) {
      const pl = palette(b, l);
      if ((rng.chance(0.5) || b.isLive(l)) && pl.wall.length > 0) b.wall(b.pick(pl.wall), l, front);
      else if (pl.low.length > 0) b.place(b.pick(pl.low), l, front);
    }
  }
  return true;
};

/** Scaffolding to roll under with bellotas underneath. */
const andamioRoll: PatternFn = (b) => {
  const { rng, ctx } = b;
  const canRoll = (l: number): boolean => palette(b, l).over.some(([k]) => k === "andamio");
  const lanes = b.clutter.filter(canRoll);
  if (lanes.length === 0) return false;
  const lane = b.nearLane(ctx.entryLane, lanes);
  const front = b.start + b.approach(lane);
  const len = OBSTACLE_DEFS.andamio.length;
  const runs = ctx.difficulty > 0.3 && rng.chance(0.4) ? 2 : 1;
  // A run of scaffolds back to back is one long roll.
  let f = front;
  for (let i = 0; i < runs; i++) f = b.place("andamio", lane, f);
  b.line = lane;
  b.trail(lane, front - 1.5, f + 1.5, 0.45, 1.6);
  b.slot(lane, front + len / 2, 0.5, false);
  const mode = rng.weighted([["all", 2], ["walls", 2], ["free", 1]] as const);
  for (const l of b.otherLanes(lane)) {
    const walls = palette(b, l).wall;
    if (mode === "all" && !b.isLive(l) && canRoll(l)) for (let i = 0, g = front; i < runs; i++) g = b.place("andamio", l, g);
    else if ((mode === "walls" || b.isLive(l)) && walls.length > 0) b.wall(b.pick(walls), l, front);
  }
  return true;
};

/** Oncoming traffic in its own lanes: dodge it early, never forced into it. */
const oncoming: PatternFn = (b) => {
  const { rng, ctx } = b;
  let front = b.start + 6;
  const waves = ctx.difficulty > 0.35 && rng.chance(0.6) ? 2 : 1;
  // A lane keeps the same kind of vehicle (same speed) so traffic never overtakes itself.
  const laneKind = new Map<number, ObstacleKind>();
  let line = ctx.entryLane;
  for (let w = 0; w < waves; w++) {
    const kindFor = (l: number): ObstacleKind | null => {
      const known = laneKind.get(l);
      if (known) return known;
      const options = palette(b, l).movers.filter(([k]) => oncomingLane(b, l, k));
      return options.length > 0 ? rng.weighted(options) : null;
    };
    const candidates = b.lanes.filter((l) => kindFor(l) !== null);
    if (candidates.length === 0) return false;
    // The line stays (or moves one lane) out of the traffic.
    const safe = b.lanes.filter((l) => !candidates.includes(l) || candidates.length > 1);
    if (safe.length === 0) return false;
    line = b.nearLane(line, safe);
    const lanes = candidates.filter((l) => l !== line);
    if (lanes.length === 0) return false;
    const both = lanes.length > 1 && ctx.difficulty > 0.2 && rng.chance(0.25 + 0.5 * ctx.difficulty);
    const moverLanes = both ? lanes : [rng.pick(lanes)];
    let waveEnd = front;
    for (const l of moverLanes) {
      const kind = kindFor(l);
      if (!kind) continue;
      laneKind.set(l, kind);
      const f = front + (both ? rng.range(0, b.s(0.4)) : 0);
      waveEnd = Math.max(waveEnd, b.mover(kind, l, f));
    }
    b.line = line;
    b.trail(line, front - b.s(0.5), waveEnd + 1);
    const lows = palette(b, line).low;
    if (ctx.difficulty > 0.45 && !b.isLive(line) && lows.length > 0 && rng.chance(0.35)) {
      // A barrier on the safe lane, well clear of the meeting point.
      b.place(b.pick(lows), line, waveEnd + b.s(0.15));
    }
    front = b.end + rowGap(b, true);
    // Next wave: the safe lane moves to one of the lanes the traffic used.
    line = rng.pick(moverLanes);
  }
  return true;
};

/**
 * Overtaking: a slow convoy (a bus followed by cars, a van and cars...) in a same-direction lane,
 * one speed. You pass it in the next lane; when that lane is the oncoming one, a vehicle comes the
 * other way just after the convoy, so you cut back in ahead of it.
 */
const overtake: PatternFn = (b) => {
  const { rng, ctx } = b;
  const traffic = b.lanes.filter((l) => b.flow(l) === 1 && b.isRoad(l));
  if (traffic.length === 0) return false;
  const bigOk = traffic.every((l) => palette(b, l).wall.some(([k]) => k === "bus"));
  const convoys: Weights<ObstacleKind[]> = [
    [["coche", "coche"], 2],
    [["coche", "coche", "coche"], 1.5],
    [["furgoneta", "coche"], 1.5],
    [["bus", "coche"], bigOk ? 2.5 : 0],
    [["bus", "coche", "coche"], bigOk ? 1.5 : 0],
    [["coche", "furgoneta", "coche"], 1],
  ];
  const lane = b.nearLane(ctx.entryLane, traffic);
  const k = b.laneSpeed(lane);
  const front = b.start + b.s(0.2);
  const kinds = rng.weighted(convoys);
  const gaps = kinds.map(() => rng.range(PLATOON_GAP[0], PLATOON_GAP[1]));
  const convoy = b.platoon(lane, front, kinds, k, gaps);
  const last = convoy?.[convoy.length - 1];
  if (!convoy || !last) return false;
  const end = b.endOf(last);
  const passLanes = b.neighbours(lane);
  if (passLanes.length === 0) return false;
  const pass = b.nearLane(ctx.entryLane, passLanes);
  b.line = pass;
  b.trail(pass, front - b.s(0.4), end + 1);
  // A second, slower or faster convoy in the other traffic lane, starting after you are past.
  const other = traffic.find((l) => l !== lane && l !== pass);
  if (other !== undefined && rng.chance(0.4 + 0.3 * ctx.difficulty)) {
    const kind: ObstacleKind = rng.chance(0.3) && bigOk ? "bus" : "coche";
    b.platoon(other, front + rng.range(0, b.s(0.5)), [kind, "coche"], b.laneSpeed(other), [rng.range(3, 6)]);
  }
  if (b.flow(pass) === -1 && !ctx.easy && rng.chance(0.35 + 0.45 * ctx.difficulty)) {
    const options = palette(b, pass).movers.filter(([kk]) => oncomingLane(b, pass, kk));
    if (options.length > 0) {
      const kind = rng.weighted(options);
      const f = end + rowGap(b, false);
      const mEnd = b.mover(kind, pass, f);
      b.line = lane;
      b.trail(lane, end + 1.5, mEnd + 1);
    }
  }
  return true;
};

/** Barrier or banner across all lanes (two in a row when it gets harder). */
const fullBarrier: PatternFn = (b) => {
  const { rng, ctx } = b;
  const pal = palette(b);
  const lane = ctx.entryLane;
  let front = b.start;
  const count = !ctx.easy && ctx.difficulty > 0.3 && rng.chance(0.45) ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const kind = b.pick(pal.full);
    const end = b.place(kind, 0, front);
    lineCell(b, lane, kind, front);
    if (i === 0 && kind === "valla-larga") b.slot(rng.pick(b.lanes), front, 2.5, true);
    front = end + b.s(1.0);
  }
  b.line = lane;
  return true;
};

/**
 * Queues: vehicles standing at a light in the traffic lanes (they drive up and brake to a halt
 * as you approach), parked ones elsewhere; one lane is the street, with things to jump.
 */
const trafficJam: PatternFn = (b) => {
  const { rng, ctx } = b;
  const free = b.nearLane(ctx.entryLane);
  const length = Math.max(b.s(1.8), rng.range(24, 46));
  // Queue at a real signal or crossing when one is just ahead: the head of the queue stops at it.
  const line = ctx.stopLine(free, 0, b.start + length + 3, b.start + length + 40);
  const front = line ? line.line - 1.5 - length : b.start;
  if (front < b.start) return false;
  const roads = b.otherLanes(free).filter((l) => b.isRoad(l));
  if (roads.length === 0) return false;
  for (const l of roads) {
    const busOk = palette(b, l).wall.some(([k]) => k === "bus");
    // Built from the light backwards so the queue is in arrival order.
    const kinds: ObstacleKind[] = [];
    let total = rng.range(0, 3);
    while (total < length) {
      const kind = rng.weighted([["coche", 4], ["furgoneta", 2], ["bus", busOk ? 1.5 : 0]] as const);
      kinds.push(kind);
      total += OBSTACLE_DEFS[kind].length + rng.range(0.8, 2.5);
    }
    let f = front + rng.range(0, 3);
    const lead = b.s(2.2 + rng.range(0, 1.2));
    for (const kind of kinds) {
      const len = OBSTACLE_DEFS[kind].length;
      let placed = false;
      if (b.flow(l) === 1 && !ctx.easy) placed = b.queued(kind, l, f, lead + (f - front) * 0.4) !== null;
      if (!placed) b.place(kind, l, f, b.flow(l) === 0 ? "parked" : "lights");
      f += len + rng.range(0.8, 2.5);
    }
  }
  b.line = free;
  const pf = palette(b, free);
  if (ctx.difficulty > 0.25 && !b.isLive(free) && pf.low.length > 0) {
    const step = b.s(1.05);
    let g = front + b.s(0.4);
    let placed = 0;
    while (g < front + length - 3 && placed < 3) {
      const kind = rng.chance(0.7) || pf.over.length === 0 ? b.pick(pf.low) : b.pick(pf.over);
      b.place(kind, free, g);
      lineCell(b, free, kind, g);
      g += OBSTACLE_DEFS[kind].length + step;
      placed++;
    }
  } else {
    b.trail(free, front, front + length);
  }
  return true;
};

/** Single low obstacles in shifting lanes: weave or jump. */
const lowZigzag: PatternFn = (b) => {
  const { rng, ctx } = b;
  const rows = ctx.easy ? 2 : rng.int(3, 4 + Math.round(ctx.difficulty * 2));
  let front = b.start;
  let line = ctx.entryLane;
  let prevLane: number | null = null;
  const lanes = b.clutter.filter((l) => palette(b, l).low.length > 0);
  if (lanes.length === 0) return false;
  for (let r = 0; r < rows; r++) {
    const lane = rng.pick(lanes);
    if (prevLane === lane) front += b.s(0.4);
    const pal = palette(b, lane);
    const useOver = !ctx.easy && pal.over.length > 0 && rng.chance(0.2);
    const kind = b.pick(useOver ? pal.over : pal.low);
    const end = b.place(kind, lane, front);
    if (lane === line) {
      // Jump/roll it, or step aside.
      if (rng.chance(0.5)) lineCell(b, lane, kind, front);
      else {
        line = rng.pick(b.otherLanes(lane));
        b.trail(line, front - 1, end + 1);
      }
    } else {
      b.trail(line, front - 1, end + 1);
    }
    prevLane = lane;
    front = end + rowGap(b, true);
  }
  b.line = line;
  return true;
};

/** Rows of terraces, containers, scaffolds and parked scooters: old-street clutter. */
const mixedRows: PatternFn = (b) => {
  const { rng, ctx } = b;
  const rows = rng.int(2, 2 + Math.round(ctx.difficulty * 3));
  let front = b.start;
  let line = ctx.entryLane;
  for (let r = 0; r < rows; r++) {
    // Pick which lanes get something; at least one lane stays free or passable.
    const count = Math.min(b.n - 1, rng.chance(0.3 + 0.45 * ctx.difficulty) ? 2 : 1);
    const lanes = shuffled(rng, b.lanes).slice(0, count);
    let rowEnd = front;
    let lineKind: ObstacleKind | null = null;
    // Early on the line prefers a free lane (fewer forced jumps); later it may run through clutter.
    const freeLanes = b.lanes.filter((l) => !lanes.includes(l));
    const preferFree = rng.chance(0.8 - 0.5 * ctx.difficulty);
    const newLine =
      preferFree && freeLanes.length > 0
        ? freeLanes.reduce((a, l) => (Math.abs(l - line) < Math.abs(a - line) ? l : a))
        : rng.chance(0.6) ? line : b.nearLane(line);
    for (const l of lanes) {
      const pal = palette(b, l);
      const role = b.isLive(l) ? "wall" : rng.weighted([["low", 3], ["wall", pal.wall.length > 0 ? 2 : 0], ["over", pal.over.length > 0 ? 1.2 : 0]] as const);
      // Walls never on the line lane (and a live lane on the line stays free).
      if (l === newLine && (b.isLive(l) || pal.low.length === 0)) continue;
      if (role !== "wall" && pal.low.length === 0) continue;
      const kind = b.pick(role === "low" ? pal.low : role === "wall" ? pal.wall : pal.over);
      if (l === newLine && role === "wall") {
        const safe = b.pick(pal.low);
        rowEnd = Math.max(rowEnd, b.place(safe, l, front));
        lineKind = safe;
      } else {
        rowEnd = Math.max(rowEnd, role === "wall" ? b.wall(kind, l, front) : b.place(kind, l, front));
        if (l === newLine) lineKind = kind;
      }
    }
    line = newLine;
    lineCell(b, line, lineKind, front);
    front = rowEnd + rowGap(b, true);
  }
  b.line = line;
  return true;
};

/**
 * Zone finale at the zone-end traffic light: a dense, bellota-rich weave (rows of stopped cars
 * and clutter, the gap shifting lane by lane) ending with a barrier across the road and bellota
 * arcs in every lane.
 */
const finale: PatternFn = (b) => {
  const { rng, ctx } = b;
  const pal = palette(b);
  const rows = ctx.difficulty > 0.3 ? 4 : 3;
  b.ignoreLive = true;
  let gap = ctx.entryLane;
  let front = b.start;
  for (let r = 0; r < rows; r++) {
    let rowLen = 0;
    for (const l of b.otherLanes(gap)) {
      const pl = palette(b, l);
      const shortWalls = pl.wall.filter(([k]) => OBSTACLE_DEFS[k].length <= 5.4);
      if (pl.low.length === 0 && shortWalls.length === 0) continue;
      const kind = (rng.chance(0.65) && shortWalls.length > 0) || pl.low.length === 0 ? rng.weighted(shortWalls) : rng.weighted(pl.low);
      // Off the line, a lane that cannot take it (a tree on the median, traffic) just stays open.
      if (!b.canPlace(kind, l, front) || !b.clearOfTraffic(kind, l, front)) continue;
      b.place(kind, l, front, b.flow(l) === 0 ? "parked" : "lights");
      rowLen = Math.max(rowLen, OBSTACLE_DEFS[kind].length);
    }
    b.trail(gap, front - b.s(0.45), front + rowLen + 1, 0.9, 1.5);
    b.line = gap;
    front += rowLen + rowGap(b, true);
    gap = rng.pick(b.neighbours(gap));
  }
  const kind = pal.full.some(([k]) => k === "valla-larga") || pal.full.length === 0 ? "valla-larga" : rng.weighted(pal.full);
  // A beat to line up the jump over the closing barrier.
  front += b.s(0.35);
  b.place(kind, 0, front);
  for (const l of b.lanes) lineCell(b, l, kind, front);
  b.slot(b.line, front + b.s(1.3), 1.0, false);
  b.line = gap;
  return true;
};

/** A city bus standing at a real bus stop in the right-hand lane (it pulled in before you arrive). */
const busStop: PatternFn = (b) => {
  const { rng, ctx } = b;
  const stop = ctx.busStopsNear(b.start + 18, b.start + 70)[0];
  if (stop === undefined) return false;
  const lanes = b.lanes.filter((l) => b.isRoad(l) && b.flow(l) === 1 && b.laneWidth(l) + 0.3 >= OBSTACLE_DEFS.bus.width);
  const lane = lanes[lanes.length - 1];
  if (lane === undefined || ctx.underArch(stop - 20, stop + 20)) return false;
  const front = stop - OBSTACLE_DEFS.bus.length / 2;
  const placed = b.isLive(lane) ? b.queued("bus", lane, front, b.s(2.5 + rng.range(0, 1)), "bus-stop") !== null : (b.place("bus", lane, front, "bus-stop"), true);
  if (!placed) return false;
  const others = b.otherLanes(lane);
  const line = b.nearLane(ctx.entryLane, others);
  b.line = line;
  b.trail(line, front - b.s(0.4), front + OBSTACLE_DEFS.bus.length + 1);
  // Or run along its roof with zapatillas.
  b.slot(lane, front + OBSTACLE_DEFS.bus.length / 2, OBSTACLE_DEFS.bus.yMax + 1, true);
  return true;
};

/** Pedestrians on the sidewalks and pedestrian streets: standing in groups and walking both ways. */
const crowd: PatternFn = (b) => {
  const { rng, ctx } = b;
  const foot = b.lanes.filter((l) => !b.isRoad(l) && palette(b, l).wall.some(([k]) => k === "peaton"));
  if (foot.length === 0) return false;
  const rows = rng.int(2, 3 + Math.round(ctx.difficulty * 2));
  let front = b.start;
  let line = ctx.entryLane;
  for (let r = 0; r < rows; r++) {
    // One or two people per row, never all lanes: the line takes a free lane (or jumps a table).
    const count = Math.min(b.n - 1, foot.length, rng.chance(0.35) ? 2 : 1);
    const lanes = shuffled(rng, foot).slice(0, count);
    let rowEnd = front;
    for (const l of lanes) rowEnd = Math.max(rowEnd, b.wall("peaton", l, front + rng.range(0, 1.2)));
    const free = b.lanes.filter((l) => !lanes.includes(l));
    line = free.reduce((a, l) => (Math.abs(l - line) < Math.abs(a - line) ? l : a), free[0] ?? line);
    b.trail(line, front - 1.5, rowEnd + 1);
    front = rowEnd + rowGap(b, false);
  }
  b.line = line;
  return true;
};

/** The grass median as a reward lane: a long bellota trail with a planter or two to hop. */
const medianTrail: PatternFn = (b) => {
  const { rng, ctx } = b;
  const medians = b.lanes.filter((l) => b.laneKind(l) === "median");
  if (medians.length === 0) return false;
  const lane = b.nearLane(ctx.entryLane, medians);
  const front = b.start + b.approach(lane);
  const length = rng.range(35, 60);
  const lows = palette(b, lane).low;
  b.line = lane;
  let at = front;
  const hops = lows.length > 0 ? rng.int(0, 2) : 0;
  for (let i = 0; i < hops; i++) {
    const g = front + ((i + 1) * length) / (hops + 1);
    const kind = b.pick(lows);
    b.trail(lane, at, g - b.s(0.45), 0.9, 2.2);
    b.place(kind, lane, g);
    lineCell(b, lane, kind, g);
    at = g + OBSTACLE_DEFS[kind].length + b.s(0.4);
  }
  b.trail(lane, at, front + length, 0.9, 2.2);
  b.end = Math.max(b.end, front + length);
  b.slot(lane, front + length * 0.5, 1.0, false);
  return true;
};

export interface PatternDef {
  name: string;
  fn: PatternFn;
  /** Can be used during the fresh-run warm-up. */
  easy: boolean;
  /** Uses oncoming traffic (reaches far ahead). */
  movers: boolean;
  /** Needs a lane with same-direction traffic. */
  traffic?: boolean;
  /** Only placed on purpose (never picked at random). */
  special?: boolean;
}

export const PATTERNS = {
  single: { name: "single", fn: single, easy: true, movers: false },
  twoBlock: { name: "twoBlock", fn: twoBlock, easy: false, movers: false },
  slalom: { name: "slalom", fn: slalom, easy: false, movers: false },
  carHop: { name: "carHop", fn: carHop, easy: false, movers: false },
  rampRoof: { name: "rampRoof", fn: rampRoof, easy: false, movers: false },
  arcValla: { name: "arcValla", fn: arcValla, easy: true, movers: false },
  andamioRoll: { name: "andamioRoll", fn: andamioRoll, easy: false, movers: false },
  oncoming: { name: "oncoming", fn: oncoming, easy: false, movers: true },
  overtake: { name: "overtake", fn: overtake, easy: false, movers: true, traffic: true },
  fullBarrier: { name: "fullBarrier", fn: fullBarrier, easy: false, movers: false },
  trafficJam: { name: "trafficJam", fn: trafficJam, easy: false, movers: false },
  lowZigzag: { name: "lowZigzag", fn: lowZigzag, easy: true, movers: false },
  mixedRows: { name: "mixedRows", fn: mixedRows, easy: false, movers: false },
  busStop: { name: "busStop", fn: busStop, easy: false, movers: false, special: true },
  crowd: { name: "crowd", fn: crowd, easy: true, movers: false },
  medianTrail: { name: "medianTrail", fn: medianTrail, easy: true, movers: false },
  finale: { name: "finale", fn: finale, easy: false, movers: false, special: true },
} as const satisfies Record<string, PatternDef>;

export type PatternName = keyof typeof PATTERNS;

/** Pattern weights per zone. Difficulty shifts weight towards the harder patterns. */
export function patternWeights(ctx: PatternContext): Weights<PatternName> {
  const kinds = ctx.layout.kinds ?? [];
  const foot = kinds.filter((k) => k === "sidewalk" || k === "pedestrian").length;
  const median = kinds.includes("median");
  const pedestrianStreet = kinds.length > 0 && kinds.every((k) => k !== "road");
  // The real streets add their own moments: buses at real stops, people on foot, the grass median.
  const city: [PatternName, number][] = [
    ["crowd", pedestrianStreet ? 5 : foot > 0 ? 1.2 : 0],
    ["medianTrail", median ? 1.5 : 0],
  ];
  return [...zoneWeights(ctx), ...city];
}

function zoneWeights(ctx: PatternContext): Weights<PatternName> {
  const d = ctx.difficulty;
  const tutorial = ctx.zone === "puente-real" && ctx.lap === 1;
  switch (ctx.zone) {
    case "puente-real":
      return [
        ["single", tutorial ? 4 : 2], ["twoBlock", 3], ["arcValla", tutorial ? 2 : 3], ["lowZigzag", 3], ["slalom", 2],
        ["carHop", 1.2], ["fullBarrier", 1], ["andamioRoll", 0.5], ["oncoming", tutorial ? 0.5 : 2],
        ["overtake", tutorial ? 1.5 : 3], ["trafficJam", tutorial ? 0 : 1],
      ];
    case "valdepasillas":
      return [
        ["rampRoof", 4], ["overtake", 4 + 2 * d], ["oncoming", 2.5 + 2 * d], ["trafficJam", 2], ["slalom", 2], ["carHop", 2],
        ["twoBlock", 2], ["single", 1], ["fullBarrier", 1], ["arcValla", 1],
      ];
    case "san-francisco":
      return [
        ["mixedRows", 2.5 + 2 * d], ["fullBarrier", 1.5], ["overtake", 2.5 + d], ["oncoming", 1.5 + d], ["twoBlock", 2.5],
        ["arcValla", 2], ["andamioRoll", 1.5], ["slalom", 1.5], ["lowZigzag", 1.5], ["single", 1.5 - d],
      ];
    case "casco-antiguo":
      return [
        ["mixedRows", 4], ["andamioRoll", 3], ["lowZigzag", 2.5], ["fullBarrier", 1.5], ["oncoming", 1 + d],
        ["twoBlock", 2], ["arcValla", 1.5],
      ];
    case "alcazaba-palmas":
      return [
        ["lowZigzag", 3], ["mixedRows", ctx.zoneT < 0.5 ? 3 : 1], ["andamioRoll", ctx.zoneT < 0.5 ? 2.5 : 0.5],
        ["fullBarrier", 2], ["arcValla", 2.5], ["oncoming", 1 + d], ["single", 1],
      ];
    case "margen-derecha":
      return [
        ["oncoming", 4 + 2 * d], ["overtake", 3 + d], ["trafficJam", 1.5], ["slalom", 2], ["rampRoof", 3], ["carHop", 2],
        ["twoBlock", 2], ["single", 1], ["fullBarrier", 1],
      ];
  }
}
