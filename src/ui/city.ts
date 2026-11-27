/**
 * The shell's copy of the real-city data (public/data/city.json), for the maps, street names and
 * credits. The engine loads the same URL, so the browser serves it from cache. If it fails the
 * shell keeps its stylised map and static credits.
 */
import { loadCity, type CityData } from "../city/data";

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
