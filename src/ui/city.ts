/**
 * The shell's copy of the real-city data (public/data/city.json), for the maps, street names and
 * credits. The engine loads the same URL, so the browser serves it from cache. If it fails the
 * shell keeps its stylised map and static credits.
 */
import { loadCity, type CityData } from "../city/data";
import { createTrack, type Track } from "../city/track";

let city: CityData | null = null;
let loading: Promise<CityData | null> | null = null;
const listeners = new Set<(c: CityData) => void>();

export const getCity = (): CityData | null => city;

/** Call `fn` once the data is available (immediately if it already is). */
export function onCity(fn: (c: CityData) => void): void {
  if (city) fn(city);
  else listeners.add(fn);
}

/** Hand over data loaded elsewhere (tests, or an engine that already has it). */
export function setCity(c: CityData): void {
  city = c;
  for (const fn of listeners) {
    try {
      fn(c);
    } catch (err) {
      console.error("[shell] city listener failed", err);
    }
  }
  listeners.clear();
}

/** Start loading once; never throws. */
export function loadShellCity(url?: string): Promise<CityData | null> {
  loading ??= loadCity(url).then(
    (c) => {
      setCity(c);
      return c;
    },
    (err: unknown) => {
      console.warn("[shell] city data unavailable, using the stylised map", err);
      return null;
    },
  );
  return loading;
}

let track: Track | null = null;
let trackFailed = false;

/** The track model for the loaded city, built once (null before the data arrives or if it fails). */
export function getTrack(): Track | null {
  if (track || trackFailed || !city) return track;
  try {
    track = createTrack(city);
  } catch (err) {
    trackFailed = true;
    console.warn("[shell] could not build the track model", err);
  }
  return track;
}

/** What the HUD needs about the next turn. */
export interface TurnInfo {
  /** Metres from s to the start of the turn (negative once inside it). */
  ahead: number;
  /** Metres from s to the end of the turn. */
  toEnd: number;
  dir: "left" | "right" | "straight";
  roundabout: boolean;
  exitName: string | null;
}

/** The turn at or just ahead of lap distance `s`, from `track.turnAhead(s)`. */
export function turnAt(s: number): TurnInfo | null {
  const t = getTrack() as (Track & { turnAhead?: Track["turnAhead"] }) | null;
  if (!t || typeof t.turnAhead !== "function") return null;
  let turn: ReturnType<Track["turnAhead"]>;
  try {
    turn = t.turnAhead(s);
  } catch {
    return null;
  }
  if (!turn || !Number.isFinite(turn.s)) return null;
  const lap = t.lapLength;
  // Unwrap across the lap seam so "ahead" is the short way round.
  let ahead = turn.s - s;
  if (ahead < -lap / 2) ahead += lap;
  if (ahead > lap / 2) ahead -= lap;
  const toEnd = ahead + (turn.endS - turn.s);
  const roundabout = turn.roundabout === true;
  // Straight through a roundabout: the net heading change is about 0°.
  const straight = roundabout && Number.isFinite(turn.angle) && Math.abs(turn.angle) < 20;
  return { ahead, toEnd, dir: straight ? "straight" : turn.direction === "left" ? "left" : "right", roundabout, exitName: turn.exitName ?? null };
}
