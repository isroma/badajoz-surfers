/**
 * Traffic bookkeeping for the generator: when a vehicle is on screen (its lifetime, in runner
 * distance), which stretch of its lane it sweeps, and whether two obstacles ever touch. Pure.
 *
 * Fairness/consistency rules enforced with these (see track.ts):
 * - A moving vehicle never drives through anything (static or moving) in its lane while it exists
 *   (from OBSTACLE_VIEW ahead of the runner until KEEP_BEHIND behind it), checked by sampling both
 *   trajectories over the shared lifetime.
 * - Vehicles never change lane, and drive only where the lane's flow allows their direction.
 */
import { OBSTACLE_DEFS } from "../contracts";
import type { LaneLayout, LayoutFn } from "./lanes";
import { footprint, obstacleCentre, whenAhead, type ObstacleSpawn } from "./spawns";
import { RUNNER_HALF_DEPTH } from "./tuning";

/** Obstacles appear this far ahead of the runner (world metres, the fog is thick beyond). */
export const OBSTACLE_VIEW = 175;
/**
 * Vehicles are reserved as existing until their centre is this far behind the runner: what the
 * scene keeps behind (30 m, for the end-of-run camera) plus the visual braking after a crash.
 */
export const KEEP_BEHIND = 46;
/** Clearance kept between vehicles (bumper to bumper) at all times. */
export const TRAFFIC_CLEARANCE = 0.6;

type Spawnish = Omit<ObstacleSpawn, "id">;

export function lengthOf(o: Spawnish): number {
  return OBSTACLE_DEFS[o.kind].length;
}

export function widthOf(o: Spawnish): number {
  return o.span ?? OBSTACLE_DEFS[o.kind].width;
}

interface Cached {
  key: string;
  life: [number, number];
  sweep: [number, number];
}
const cache = new WeakMap<object, Cached>();

function cached(o: Spawnish): Cached {
  const key = `${o.d}|${o.k}|${o.d0}|${o.stop}|${o.kind}`;
  let c = cache.get(o);
  if (c && c.key === key) return c;
  const half = lengthOf(o) / 2;
  const life: [number, number] = [whenAhead(o, OBSTACLE_VIEW + half), whenAhead(o, -(KEEP_BEHIND + half))];
  const ca = obstacleCentre(o, life[0]);
  const cb = obstacleCentre(o, life[1]);
  c = { key, life, sweep: ca < cb ? [ca, cb] : [cb, ca] };
  cache.set(o, c);
  return c;
}

/** Runner-distance range during which the obstacle exists (statics: forever). */
export function lifetime(o: Spawnish): [number, number] {
  if (o.k === 0) return [-Infinity, Infinity];
  return cached(o).life;
}

/** World range of the centre over the lifetime. */
export function sweep(o: Spawnish): [number, number] {
  if (o.k === 0) return [o.d, o.d];
  return cached(o).sweep;
}

/** The stretch of runner distance where the runner meets it lengthwise (see spawns.footprint). */
export function footprintOf(o: Spawnish): [number, number] {
  return footprint(o, lengthOf(o), RUNNER_HALF_DEPTH);
}

/** Do the two occupy overlapping lateral space? */
export function lateralOverlap(a: Spawnish, b: Spawnish): boolean {
  return Math.abs(a.x - b.x) < (widthOf(a) + widthOf(b)) / 2 - 0.05;
}

/** Do two obstacles in overlapping lateral space ever interpenetrate while both exist? */
export function collides(a: Spawnish, b: Spawnish): boolean {
  const need = (lengthOf(a) + lengthOf(b)) / 2 + (a.k !== 0 && b.k !== 0 ? TRAFFIC_CLEARANCE : 0.15);
  if (a.k === 0 && b.k === 0) return Math.abs(a.d - b.d) < need - 0.15;
  const [sa0, sa1] = sweep(a);
  const [sb0, sb1] = sweep(b);
  if (sa1 + need < sb0 || sb1 + need < sa0) return false;
  const [la0, la1] = lifetime(a);
  const [lb0, lb1] = lifetime(b);
  const from = Math.max(la0, lb0);
  const to = Math.min(la1, lb1);
  if (!(from <= to)) return false;
  // Centres move at most |k| < 1 metres per metre run, so the gap changes by less than 1.3 per
  // metre: skip ahead by what the gap allows.
  for (let p = from, guard = 0; ; ) {
    if (++guard > 20000 || Number.isNaN(p)) return true;
    const at = Math.min(p, to);
    const gap = Math.abs(obstacleCentre(a, at) - obstacleCentre(b, at));
    if (gap < need) return true;
    if (at >= to) break;
    p = at + Math.max(0.25, (gap - need) / 1.3);
  }
  return false;
}

/**
 * Can this vehicle drive its whole sweep in its lane: the lane positions stay the same and the
 * lane's flow allows its direction (scooters may also ride the pedestrian streets towards you)?
 */
export function flowAllows(o: Spawnish, layoutFn: LayoutFn, origin: LaneLayout): boolean {
  if (o.k === 0) return true;
  const [s0, s1] = sweep(o);
  if (!Number.isFinite(s0) || !Number.isFinite(s1)) return false;
  const half = lengthOf(o) / 2;
  void origin;
  // Its lane must exist all along the sweep (same lateral position: the real lanes keep their
  // offsets through junctions and roundabouts), with traffic its way.
  for (let d = s0 - half; ; d += 8) {
    const at = Math.min(d, s1 + half);
    const layout = layoutFn(at);
    let lane = -1;
    for (let i = 0; i < layout.offsets.length; i++) if (Math.abs((layout.offsets[i] ?? 0) - o.x) < 0.05) lane = i;
    if (lane < 0) return false;
    const flow = layout.flow[lane] ?? 0;
    const kind = layout.kinds?.[lane] ?? "road";
    const walker = o.kind === "peaton" && flow === 0 && kind !== "road";
    if (o.kind !== "peaton" && o.kind !== "moto" && kind !== "road") return false;
    if (o.k < 0 && flow !== 1 && !walker) return false;
    if (o.k > 0 && !(flow === -1 || walker || (flow === 0 && o.kind === "moto"))) return false;
    if (at >= s1 + half) break;
  }
  return true;
}

/**
 * Does moving vehicle `o` drive through a point (a pickup at distance `d`, lateral `x`, height
 * `y`) before the runner gets there?
 */
export function drivesThrough(o: Spawnish, x: number, d: number, y: number): boolean {
  if (o.k === 0) return false;
  if (Math.abs(o.x - x) > widthOf(o) / 2 + 0.3) return false;
  if (y - 0.35 > OBSTACLE_DEFS[o.kind].yMax) return false;
  const half = lengthOf(o) / 2 + 0.4;
  const [s0, s1] = sweep(o);
  if (d < s0 - half || d > s1 + half) return false;
  const [l0, l1] = lifetime(o);
  const to = Math.min(l1, d);
  for (let p = l0; p <= to; ) {
    const gap = Math.abs(obstacleCentre(o, p) - d);
    if (gap < half) return true;
    p += Math.max(0.25, (gap - half) / 1.0);
  }
  return false;
}
