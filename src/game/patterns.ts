/**
 * Hand-designed obstacle patterns. Each pattern places a short authored stretch (a slalom of
 * parked cars, a ramp onto bus roofs, oncoming traffic...) and declares its intended line, which
 * the bellota trails trace. Pure: no three.js.
 *
 * Fairness rules every pattern follows (verified by the solvability fuzz test):
 * - Rows that force an action on the line are at least one reaction window apart (more after a
 *   jump or roll), measured from the end of the previous row's longest obstacle.
 * - The line lane of every row is free, or passable with a single jump or roll.
 * - Moving vehicles never share a lane with the line around their meeting point, and their lane
 *   ahead of the meeting point is reserved so they never drive through anything.
 */
import { OBSTACLE_DEFS, type Lane, type ObstacleKind, type PickupKind, type ZoneId } from "../contracts";
import type { Rng } from "./rng";
import type { ObstacleSpawn, PickupSpawn } from "./spawns";
import { GRAVITY, JUMP_VELOCITY, RUNNER_HALF_DEPTH } from "./tuning";

export type ObstacleDraft = Omit<ObstacleSpawn, "id">;
export type PickupDraft = Omit<PickupSpawn, "id">;

/** A good spot for a letter or a power-up on the intended line. */
export interface RewardSlot {
  lane: Lane;
  d: number;
  y: number;
  /** On a roof, over a barrier...: worth a little risk. */
  risky: boolean;
}

/** A moving vehicle drives through its lane from far ahead: nothing else may be there. */
export interface LaneReservation {
  lane: Lane;
  from: number;
  to: number;
  k: number;
  /** The vehicle that made it. */
  owner: ObstacleDraft;
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
  entryLane: Lane;
  /** Fresh-run warm-up: only the gentlest patterns. */
  easy: boolean;
  lap: number;
}

/** A moving vehicle becomes visible (is spawned) this far ahead of the runner. */
export const MOVER_VIEW_DISTANCE = 140;

export const MOVER_K: Readonly<Partial<Record<ObstacleKind, number>>> = {
  coche: 0.55,
  moto: 0.7,
  furgoneta: 0.45,
  bus: 0.35,
};

/** Half length of the stretch (in runner distance) where a mover overlaps the runner. */
export function moverEffectiveHalf(kind: ObstacleKind, k: number): number {
  return (OBSTACLE_DEFS[kind].length / 2 + RUNNER_HALF_DEPTH) / (1 + k) - RUNNER_HALF_DEPTH;
}

const LANES3: readonly Lane[] = [-1, 0, 1];

export class PatternBuilder {
  readonly obstacles: ObstacleDraft[] = [];
  readonly pickups: PickupDraft[] = [];
  readonly slots: RewardSlot[] = [];
  readonly reservations: LaneReservation[] = [];
  /** Furthest distance occupied by anything placed. */
  end: number;
  line: Lane;
  /** Extra seconds of empty road the next pattern must leave (e.g. after falling off a roof). */
  tail = 0;

  constructor(
    readonly ctx: PatternContext,
    readonly start: number,
  ) {
    this.end = start;
    this.line = ctx.entryLane;
  }

  /** Seconds to metres at the planned speed. */
  s(seconds: number): number {
    return seconds * this.ctx.v;
  }

  get rng(): Rng {
    return this.ctx.rng;
  }

  /** Place a parked obstacle with its front (the end the runner reaches first) at `front`. Returns its end. */
  place(kind: ObstacleKind, lane: Lane, front: number): number {
    const def = OBSTACLE_DEFS[kind];
    const flipped = def.vehicle && kind !== "camion-rampa" ? this.rng.chance(0.5) : false;
    this.obstacles.push({
      kind, lane: def.lanes === 3 ? 0 : lane, d: front + def.length / 2, k: 0, seed: this.rng.int(0, 9999), flipped,
    });
    const end = front + def.length;
    this.end = Math.max(this.end, end);
    return end;
  }

  /**
   * Place an oncoming vehicle so that the stretch where it overlaps the runner starts at `front`.
   * Returns the end of that stretch.
   */
  mover(kind: ObstacleKind, lane: Lane, front: number): number {
    const k = MOVER_K[kind] ?? 0.5;
    const half = moverEffectiveHalf(kind, k);
    const c = front + half;
    const owner: ObstacleDraft = { kind, lane, d: c, k, seed: this.rng.int(0, 9999), flipped: false };
    this.obstacles.push(owner);
    const runwayAhead = (k * MOVER_VIEW_DISTANCE) / (1 + k) + OBSTACLE_DEFS[kind].length / 2 + 2;
    this.reservations.push({ lane, from: c - half - 1, to: c + runwayAhead, k, owner });
    this.end = Math.max(this.end, c + half);
    return c + half;
  }

  pickup(kind: PickupKind, lane: Lane, d: number, y: number): void {
    this.pickups.push({ kind, lane, d, y });
  }

  /** A straight bellota trail. */
  trail(lane: Lane, from: number, to: number, y = 0.9, spacing = 2.4): void {
    for (let d = from; d <= to + 1e-6; d += spacing) this.pickup("bellota", lane, d, y);
  }

  /** Bellotas along a normal jump taking off at `takeoff`, from height `baseY` (`portion` of the airtime). */
  arc(lane: Lane, takeoff: number, baseY = 0, portion = 1): void {
    const air = (2 * JUMP_VELOCITY) / GRAVITY;
    const n = 7;
    for (let i = 1; i <= n; i++) {
      const t = (air * i) / (n + 1);
      if (t > air * portion + 1e-6) break;
      const y = baseY + JUMP_VELOCITY * t - 0.5 * GRAVITY * t * t + 0.9;
      this.pickup("bellota", lane, takeoff + this.ctx.v * t, y);
    }
  }

  /** Takeoff distance so that a normal jump peaks over `centre`. */
  takeoffFor(centre: number): number {
    return centre - this.s(JUMP_VELOCITY / GRAVITY);
  }

  slot(lane: Lane, d: number, y: number, risky: boolean): void {
    this.slots.push({ lane, d, y, risky });
  }

  /** Mirror every lane (used to dodge a lane reservation). */
  mirror(): void {
    const flip = (l: Lane): Lane => (l === -1 ? 1 : l === 1 ? -1 : 0);
    for (const o of this.obstacles) o.lane = flip(o.lane);
    for (const p of this.pickups) p.lane = flip(p.lane);
    for (const s of this.slots) s.lane = flip(s.lane);
    for (const r of this.reservations) r.lane = flip(r.lane);
    this.line = flip(this.line);
  }
}

// ---------------------------------------------------------------------------------------------
// Zone palettes
// ---------------------------------------------------------------------------------------------

type Weights<T extends string> = readonly (readonly [T, number])[];

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
    movers: [["moto", 4], ["coche", 1]],
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

/** The walled streets of the Alcazaba become the old Puente de Palmas halfway: no terraces or scaffolds there. */
function palette(ctx: PatternContext): Palette {
  const base = PALETTES[ctx.zone];
  if (ctx.zone === "alcazaba-palmas" && ctx.zoneT > 0.5) {
    return { ...base, low: [["conos", 3], ["valla", 3]], over: [["andamio", 0.5]], wall: [["coche", 1]] };
  }
  return base;
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

function otherLanes(lane: Lane): Lane[] {
  return LANES3.filter((l) => l !== lane);
}

function nearLane(rng: Rng, from: Lane): Lane {
  // Prefer staying or moving one lane.
  return rng.weighted<Lane>(LANES3.map((l) => [l, Math.abs(l - from) === 0 ? 3 : Math.abs(l - from) === 1 ? 2 : 1] as const));
}

/** Gap after a row: one reaction window, longer when the line needed an action there. */
function rowGap(b: PatternBuilder, action: boolean): number {
  // Early on (low difficulty) rows breathe a little more: humans need time to read them.
  const early = 0.25 * (1 - b.ctx.difficulty);
  return b.s(b.ctx.reaction + (action ? 0.35 : 0.05) + early);
}

/** Bellotas on the line for a row passed by a jump/roll/run. */
function lineCell(b: PatternBuilder, lane: Lane, kind: ObstacleKind | null, front: number): void {
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

// ---------------------------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------------------------

export type PatternFn = (b: PatternBuilder) => boolean;

/** One obstacle; the line jumps it, rolls under it or goes round. */
const single: PatternFn = (b) => {
  const { rng } = b;
  const pal = palette(b.ctx);
  const role = b.ctx.easy ? rng.weighted([["low", 3], ["wall", 2]] as const) : rng.weighted([["low", 3], ["wall", 3], ["over", 1.5]] as const);
  const kind = rng.weighted(role === "low" ? pal.low : role === "wall" ? pal.wall : pal.over);
  const lane = rng.pick(LANES3);
  const front = b.start;
  const end = b.place(kind, lane, front);
  const gentle = b.ctx.zone === "puente-real" && b.ctx.lap === 1;
  if (role !== "wall" && rng.chance(gentle ? 0.3 : 0.55)) {
    b.line = lane;
    lineCell(b, lane, kind, front);
    if (role === "low") b.slot(lane, front + OBSTACLE_DEFS[kind].length / 2, 2.4, true);
  } else {
    const line = rng.pick(otherLanes(lane));
    b.line = line;
    b.trail(line, front - b.s(0.3), end + 2);
  }
  return true;
};

/** Two lanes blocked side by side, one gap (sometimes with a barrier to jump or a scaffold to roll under). */
const twoBlock: PatternFn = (b) => {
  const { rng, ctx } = b;
  const pal = palette(ctx);
  const gap = nearLane(rng, ctx.entryLane);
  const front = b.start;
  const kindA = rng.weighted(pal.wall);
  const kindB = rng.chance(0.5) ? kindA : rng.weighted(pal.wall);
  const [l1, l2] = otherLanes(gap);
  if (l1 === undefined || l2 === undefined) return false;
  b.place(kindA, l1, front);
  b.place(kindB, l2, front);
  b.line = gap;
  if (!ctx.easy && ctx.lap + ctx.difficulty > 1.2 && rng.chance(0.35 + 0.35 * ctx.difficulty)) {
    const kind = rng.chance(0.6) ? rng.weighted(pal.low) : rng.weighted(pal.over);
    b.place(kind, gap, front);
    lineCell(b, gap, kind, front);
  } else {
    b.trail(gap, front - b.s(0.3), b.end + 1);
  }
  return true;
};

/** Parked cars leaving one gap that shifts lane row by row. */
const slalom: PatternFn = (b) => {
  const { rng, ctx } = b;
  const pal = palette(ctx);
  const rows = (ctx.zone === "puente-real" && ctx.lap === 1 ? 3 : 3 + Math.round(ctx.difficulty * 2));
  let gap = rng.pick(LANES3);
  let front = b.start;
  for (let r = 0; r < rows; r++) {
    let rowLen = 0;
    for (const l of otherLanes(gap)) {
      const kind = rng.chance(0.75) ? "coche" : rng.weighted(pal.wall);
      b.place(kind, l, front);
      rowLen = Math.max(rowLen, OBSTACLE_DEFS[kind].length);
    }
    b.trail(gap, front - 1, front + rowLen, 0.9, 2.2);
    b.line = gap;
    front += rowLen + rowGap(b, true);
    const options = LANES3.filter((l) => Math.abs(l - gap) === 1);
    gap = rng.pick(options);
  }
  return true;
};

/** A line of parked cars to hop along roof to roof (sometimes all three lanes: a traffic jam you must climb). */
const carHop: PatternFn = (b) => {
  const { rng, ctx } = b;
  const lane = rng.pick(LANES3);
  const count = rng.int(3, 5);
  // Bumper to bumper: the roofs form one continuous walkway (no falling between cars).
  const gapLen = 0.4;
  const jam = !ctx.easy && ctx.difficulty + (ctx.lap - 1) * 0.3 > 0.35 && rng.chance(0.45);
  const front = b.start;
  const lanes = jam ? LANES3 : [lane];
  for (const l of lanes) {
    let f = front;
    const n = l === lane ? count : rng.int(2, count);
    for (let i = 0; i < n; i++) {
      f = b.place("coche", l, f) + gapLen;
    }
  }
  const roofY = OBSTACLE_DEFS.coche.yMax;
  const lineEnd = front + count * (OBSTACLE_DEFS.coche.length + gapLen) - gapLen;
  b.line = lane;
  b.arc(lane, b.takeoffFor(front), 0, 0.5);
  b.trail(lane, front + 2, lineEnd - 0.5, roofY + 0.9, 2.2);
  b.slot(lane, front + (lineEnd - front) * 0.6, roofY + 1.0, true);
  if (!jam && ctx.difficulty > 0.15) {
    // Something to think about on the ground lanes too.
    const pal = palette(ctx);
    const other = rng.pick(otherLanes(lane));
    b.place(rng.weighted(pal.low), other, front + b.s(0.2));
  }
  b.tail = 0.35;
  return true;
};

/** Tow-truck ramp straight onto van and bus roofs, bellotas along the top; the ground lanes are busier. */
const rampRoof: PatternFn = (b) => {
  const { rng, ctx } = b;
  const pal = palette(ctx);
  const lane = rng.pick(LANES3);
  const front = b.start;
  let f = b.place("camion-rampa", lane, front);
  const chains: ObstacleKind[][] = [
    ["bus"],
    ["bus", "bus"],
    ["bus", "furgoneta"],
    ["furgoneta", "furgoneta"],
    ["bus", "furgoneta", "furgoneta"],
    ["bus", "bus", "furgoneta"],
  ];
  const chain = rng.pick(chains);
  const sameHeightGap = Math.min(0.8, 0.05 * ctx.v);
  let prevTop = OBSTACLE_DEFS["camion-rampa"].yMax;
  for (const kind of chain) {
    const top = OBSTACLE_DEFS[kind].yMax;
    f += top >= prevTop ? sameHeightGap : rng.range(0.5, 1.2);
    f = b.place(kind, lane, f);
    prevTop = top;
  }
  const roofEnd = f;
  b.line = lane;
  b.trail(lane, front + 1, front + 6, 1.6, 1.8);
  b.trail(lane, front + 8, roofEnd - 1, prevTop + 0.9, 2.2);
  b.slot(lane, front + 7 + (roofEnd - front - 7) * 0.5, OBSTACLE_DEFS.bus.yMax + 1.0, true);
  // Ground lanes: one walled by parked big vehicles, the other a jumping route.
  const [a, c] = otherLanes(lane);
  if (a === undefined || c === undefined) return false;
  const walled = rng.chance(0.5) ? a : c;
  const ground = walled === a ? c : a;
  let w = front + rng.range(0, 4);
  while (w < roofEnd - 4) {
    const big = pal.wall.filter(([k]) => k === "bus" || k === "furgoneta" || k === "coche");
    const kind = big.length > 0 ? rng.weighted(big) : "coche";
    w = b.place(kind, walled, w) + rng.range(0.6, 3);
  }
  const step = b.s(1.05);
  for (let g = front + b.s(0.3); g < roofEnd - 2; g += step + 1) {
    b.place(rng.weighted(pal.low), ground, g);
  }
  b.tail = 0.5;
  return true;
};

/** A barrier with an arc of bellotas over it; often the neighbours are blocked so the jump is the way. */
const arcValla: PatternFn = (b) => {
  const { rng, ctx } = b;
  const pal = palette(ctx);
  const lane = nearLane(rng, ctx.entryLane);
  const kind = rng.weighted(pal.low);
  const front = b.start;
  b.place(kind, lane, front);
  b.line = lane;
  lineCell(b, lane, kind, front);
  b.slot(lane, front + OBSTACLE_DEFS[kind].length / 2, 2.5, true);
  if (!ctx.easy && rng.chance(0.3 + 0.5 * ctx.difficulty)) {
    for (const l of otherLanes(lane)) {
      const k = rng.chance(0.5) ? rng.weighted(pal.wall) : rng.weighted(pal.low);
      b.place(k, l, front);
    }
  }
  return true;
};

/** Scaffolding to roll under with bellotas underneath. */
const andamioRoll: PatternFn = (b) => {
  const { rng, ctx } = b;
  const pal = palette(ctx);
  const lane = nearLane(rng, ctx.entryLane);
  const front = b.start;
  const len = OBSTACLE_DEFS.andamio.length;
  const runs = ctx.difficulty > 0.3 && rng.chance(0.4) ? 2 : 1;
  // A run of scaffolds back to back is one long roll.
  let f = front;
  for (let i = 0; i < runs; i++) f = b.place("andamio", lane, f);
  b.line = lane;
  b.trail(lane, front - 1.5, f + 1.5, 0.45, 1.6);
  b.slot(lane, front + len / 2, 0.5, false);
  const mode = rng.weighted([["all", 2], ["walls", 2], ["free", 1]] as const);
  for (const l of otherLanes(lane)) {
    if (mode === "all") for (let i = 0, g = front; i < runs; i++) g = b.place("andamio", l, g);
    else if (mode === "walls") b.place(rng.weighted(pal.wall), l, front);
  }
  return true;
};

/** Oncoming traffic in its own lanes: dodge it early, never forced into it. */
const oncoming: PatternFn = (b) => {
  const { rng, ctx } = b;
  const pal = palette(ctx);
  let line = nearLane(rng, ctx.entryLane);
  let front = b.start + 6;
  const waves = ctx.difficulty > 0.35 && rng.chance(0.6) ? 2 : 1;
  // A lane keeps the same kind of vehicle (same speed) so traffic never overtakes itself.
  const laneKind = new Map<Lane, ObstacleKind>();
  for (let w = 0; w < waves; w++) {
    const lanes = otherLanes(line);
    const both = ctx.difficulty > 0.2 && rng.chance(0.25 + 0.5 * ctx.difficulty);
    const moverLanes = both ? lanes : [rng.pick(lanes)];
    let waveEnd = front;
    for (const l of moverLanes) {
      const kind = laneKind.get(l) ?? rng.weighted(pal.movers);
      laneKind.set(l, kind);
      const f = front + (both ? rng.range(0, b.s(0.4)) : 0);
      waveEnd = Math.max(waveEnd, b.mover(kind, l, f));
    }
    b.line = line;
    b.trail(line, front - b.s(0.5), waveEnd + 1);
    if (ctx.difficulty > 0.45 && rng.chance(0.35)) {
      // A barrier on the safe lane, well clear of the meeting point.
      const kind = rng.weighted(pal.low);
      b.place(kind, line, waveEnd + b.s(0.15));
    }
    front = b.end + rowGap(b, true);
    // Next wave: the safe lane moves to one of the lanes the traffic used.
    line = rng.pick(moverLanes);
  }
  return true;
};

/** Barrier or banner across all three lanes (two in a row when it gets harder). */
const fullBarrier: PatternFn = (b) => {
  const { rng, ctx } = b;
  const pal = palette(ctx);
  const lane = ctx.entryLane;
  let front = b.start;
  const count = !ctx.easy && ctx.difficulty > 0.3 && rng.chance(0.45) ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const kind = rng.weighted(pal.full);
    const end = b.place(kind, 0, front);
    lineCell(b, lane, kind, front);
    if (i === 0 && kind === "valla-larga") b.slot(rng.pick(LANES3), front, 2.5, true);
    front = end + b.s(1.0);
  }
  b.line = lane;
  return true;
};

/** Long queues of parked vehicles in two lanes; the third lane is the street, with things to jump. */
const trafficJam: PatternFn = (b) => {
  const { rng, ctx } = b;
  const pal = palette(ctx);
  const free = nearLane(rng, ctx.entryLane);
  const front = b.start;
  const length = Math.max(b.s(1.8), rng.range(24, 46));
  for (const l of otherLanes(free)) {
    let f = front + rng.range(0, 3);
    while (f < front + length) {
      const kind = rng.weighted([["coche", 4], ["furgoneta", 2], ["bus", pal.wall.some(([k]) => k === "bus") ? 1.5 : 0]] as const);
      f = b.place(kind, l, f) + rng.range(0.5, 3.5);
    }
  }
  b.line = free;
  if (ctx.difficulty > 0.25) {
    const step = b.s(1.05);
    let g = front + b.s(0.4);
    let placed = 0;
    while (g < front + length - 3 && placed < 3) {
      const kind = rng.chance(0.7) ? rng.weighted(pal.low) : rng.weighted(pal.over);
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
  const pal = palette(ctx);
  const rows = ctx.easy ? 2 : rng.int(3, 4 + Math.round(ctx.difficulty * 2));
  let front = b.start;
  let line = ctx.entryLane;
  let prevLane: Lane | null = null;
  for (let r = 0; r < rows; r++) {
    const lane = rng.pick(LANES3);
    if (prevLane === lane) front += b.s(0.4);
    const useOver = !ctx.easy && rng.chance(0.2);
    const kind = rng.weighted(useOver ? pal.over : pal.low);
    const end = b.place(kind, lane, front);
    if (lane === line) {
      // Jump/roll it, or step aside.
      if (rng.chance(0.5)) lineCell(b, lane, kind, front);
      else {
        line = rng.pick(otherLanes(lane));
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
  const pal = palette(ctx);
  const rows = rng.int(2, 2 + Math.round(ctx.difficulty * 3));
  let front = b.start;
  let line = ctx.entryLane;
  for (let r = 0; r < rows; r++) {
    // Pick which lanes get something; at least one lane stays free or passable.
    const count = rng.chance(0.3 + 0.45 * ctx.difficulty) ? 2 : 1;
    const lanes = shuffled(rng, LANES3).slice(0, count);
    let rowLen = 0;
    let lineKind: ObstacleKind | null = null;
    // Early on the line prefers a free lane (fewer forced jumps); later it may run through clutter.
    const freeLanes = LANES3.filter((l) => !lanes.includes(l));
    const preferFree = rng.chance(0.8 - 0.5 * ctx.difficulty);
    const newLine =
      preferFree && freeLanes.length > 0
        ? freeLanes.reduce((a, l) => (Math.abs(l - line) < Math.abs(a - line) ? l : a))
        : rng.chance(0.6) ? line : nearLane(rng, line);
    for (const l of lanes) {
      const role = rng.weighted([["low", 3], ["wall", 2], ["over", 1.2]] as const);
      const kind = rng.weighted(role === "low" ? pal.low : role === "wall" ? pal.wall : pal.over);
      // Walls never on the line lane.
      const safeKind = l === newLine && role === "wall" ? rng.weighted(pal.low) : kind;
      b.place(safeKind, l, front);
      if (l === newLine) lineKind = safeKind;
      rowLen = Math.max(rowLen, OBSTACLE_DEFS[safeKind].length);
    }
    line = newLine;
    lineCell(b, line, lineKind, front);
    front += rowLen + rowGap(b, true);
  }
  b.line = line;
  return true;
};

/**
 * Zone finale: a dense, bellota-rich weave (rows of two obstacles, the gap shifting lane by lane)
 * ending with a barrier across the road and bellota arcs in every lane.
 */
const finale: PatternFn = (b) => {
  const { rng, ctx } = b;
  const pal = palette(ctx);
  const rows = ctx.difficulty > 0.3 ? 4 : 3;
  let gap = ctx.entryLane;
  let front = b.start;
  for (let r = 0; r < rows; r++) {
    let rowLen = 0;
    const shortWalls = pal.wall.filter(([k]) => OBSTACLE_DEFS[k].length <= 5.4);
    for (const l of otherLanes(gap)) {
      const kind = rng.chance(0.65) && shortWalls.length > 0 ? rng.weighted(shortWalls) : rng.weighted(pal.low);
      b.place(kind, l, front);
      rowLen = Math.max(rowLen, OBSTACLE_DEFS[kind].length);
    }
    b.trail(gap, front - b.s(0.45), front + rowLen + 1, 0.9, 1.5);
    b.line = gap;
    front += rowLen + rowGap(b, true);
    const options = LANES3.filter((l) => Math.abs(l - gap) === 1);
    gap = rng.pick(options);
  }
  const kind = pal.full.some(([k]) => k === "valla-larga") ? "valla-larga" : rng.weighted(pal.full);
  front += b.s(0.2);
  b.place(kind, 0, front);
  for (const l of LANES3) lineCell(b, l, kind, front);
  b.slot(b.line, front + b.s(1.3), 1.0, false);
  b.line = gap;
  return true;
};

export interface PatternDef {
  name: string;
  fn: PatternFn;
  /** Can be used during the fresh-run warm-up. */
  easy: boolean;
  /** Uses moving vehicles. */
  movers: boolean;
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
  fullBarrier: { name: "fullBarrier", fn: fullBarrier, easy: false, movers: false },
  trafficJam: { name: "trafficJam", fn: trafficJam, easy: false, movers: false },
  lowZigzag: { name: "lowZigzag", fn: lowZigzag, easy: true, movers: false },
  mixedRows: { name: "mixedRows", fn: mixedRows, easy: false, movers: false },
  finale: { name: "finale", fn: finale, easy: false, movers: false, special: true },
} as const satisfies Record<string, PatternDef>;

export type PatternName = keyof typeof PATTERNS;

/** Pattern weights per zone. Difficulty shifts weight towards the harder patterns. */
export function patternWeights(ctx: PatternContext): Weights<PatternName> {
  const d = ctx.difficulty;
  const tutorial = ctx.zone === "puente-real" && ctx.lap === 1;
  switch (ctx.zone) {
    case "puente-real":
      return [
        ["single", tutorial ? 4 : 2], ["twoBlock", 3], ["arcValla", tutorial ? 2 : 3], ["lowZigzag", 3], ["slalom", 2],
        ["carHop", 1.2], ["fullBarrier", 1], ["andamioRoll", 0.5], ["oncoming", tutorial ? 0.5 : 2],
        ["trafficJam", tutorial ? 0 : 1],
      ];
    case "valdepasillas":
      return [
        ["rampRoof", 4], ["oncoming", 2.5 + 2 * d], ["trafficJam", 3], ["slalom", 2], ["carHop", 2],
        ["twoBlock", 2], ["single", 1], ["fullBarrier", 1], ["arcValla", 1],
      ];
    case "san-francisco":
      return [
        ["mixedRows", 2.5 + 2 * d], ["fullBarrier", 1.5], ["oncoming", 1.5 + d], ["twoBlock", 2.5], ["arcValla", 2],
        ["andamioRoll", 1.5], ["slalom", 1.5], ["lowZigzag", 1.5], ["single", 1.5 - d],
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
        ["oncoming", 4 + 2 * d], ["trafficJam", 3], ["slalom", 2], ["rampRoof", 3], ["carHop", 2],
        ["twoBlock", 2], ["single", 1], ["fullBarrier", 1],
      ];
  }
}
