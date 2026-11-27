/**
 * Turn-hint selection (pure): which turn the HUD shows, given the engine's latest `turn` event
 * and the track model's `turnAhead`. Always the nearest upcoming turn, kept until its end.
 */

/** The next turn, as the HUD shows it. */
export interface TurnHint {
  dir: "left" | "right" | "straight";
  roundabout: boolean;
  /** Street after the turn. */
  name: string | null;
}

/** A turn pinned to run distances (from a `turn` event). */
export interface EventTurn {
  hint: TurnHint;
  /** Run distance where the turn starts. */
  startAt: number;
  /** Run distance where it ends (exact when the event had `endDistance`, else an estimate). */
  endAt: number;
  /** True when `endAt` came from the engine. */
  exactEnd: boolean;
}

/** A turn relative to the runner (from `track.turnAhead`). */
export interface TrackTurn extends TurnHint {
  /** Metres to the start of the turn (negative once inside it). */
  ahead: number;
  /** Metres to its end. */
  toEnd: number;
}

/** Show a turn from this far before its start. */
export const TURN_SHOW_AHEAD = 120;

/** Estimated length of a turn when the engine did not say: roundabouts are long. */
export const estimatedTurnLength = (roundabout: boolean): number => (roundabout ? 120 : 40);

/** Build an EventTurn from a `turn` event received at run distance `at`. */
export function eventTurn(
  at: number,
  e: { direction?: unknown; roundabout?: unknown; street?: unknown; distance?: unknown; endDistance?: unknown },
): EventTurn | null {
  const d = e.direction;
  if (d !== "left" && d !== "right" && d !== "straight") return null;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const roundabout = e.roundabout === true;
  const startAt = at + (num(e.distance) ?? 0);
  const end = num(e.endDistance);
  return {
    hint: { dir: d, roundabout, name: typeof e.street === "string" && e.street.trim() ? e.street : null },
    startAt,
    endAt: end !== null ? at + end : startAt + estimatedTurnLength(roundabout),
    exactEnd: end !== null,
  };
}

const eventVisible = (distance: number, ev: EventTurn): boolean => distance <= ev.endAt && ev.startAt - distance <= TURN_SHOW_AHEAD;

/**
 * The hint to show at run distance `distance`. An event with an exact end wins; otherwise the
 * track model (which already returns the turn you are in, else the nearest next one); the
 * event with an estimated end is the last resort.
 */
export function chooseTurn(distance: number, ev: EventTurn | null, track: TrackTurn | null): TurnHint | null {
  if (ev && ev.exactEnd) return eventVisible(distance, ev) ? ev.hint : null;
  if (track) {
    if (track.ahead <= TURN_SHOW_AHEAD && track.toEnd >= 0) return { dir: track.dir, roundabout: track.roundabout, name: track.name };
    return null;
  }
  if (ev && eventVisible(distance, ev)) return ev.hint;
  return null;
}
