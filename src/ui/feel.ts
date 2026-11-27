/** Pure helpers for game-feel UI: bellota combos, distance milestones, lap captions, share text. */
import { formatInt, formatMetres } from "../meta/format";

/** Bellotas picked with no gap longer than `gapMs` count as one combo. */
export class Combo {
  count = 0;
  private last = -Infinity;

  constructor(private readonly gapMs = 1000) {}

  /** Register a pickup at `now` (ms). Returns the combo length. */
  hit(now: number): number {
    this.count = now - this.last <= this.gapMs ? this.count + 1 : 1;
    this.last = now;
    return this.count;
  }

  /** True while the combo is still alive at `now`. */
  alive(now: number): boolean {
    return now - this.last <= this.gapMs;
  }

  reset(): void {
    this.count = 0;
    this.last = -Infinity;
  }
}

/** Combo sizes that deserve a little sound and pop. */
export const COMBO_STEPS = [10, 25, 50, 100, 150, 200] as const;

/** Index of the combo step reached exactly at `count`, or -1. */
export const comboStep = (count: number): number => COMBO_STEPS.indexOf(count as (typeof COMBO_STEPS)[number]);

/** Milestones (multiples of `step` metres) crossed going from `prev` to `next`. */
export function milestonesCrossed(prev: number, next: number, step = 1000): number[] {
  if (!(next > prev) || !Number.isFinite(prev) || !Number.isFinite(next)) return [];
  const out: number[] = [];
  // A warp can jump kilometres in one frame: only the last few milestones matter.
  const first = Math.max((Math.floor(Math.max(0, prev) / step) + 1) * step, (Math.floor(next / step) - 9) * step);
  for (let m = first; m <= next; m += step) out.push(m);
  return out;
}

const QUIPS = [
  "El camarero resopla",
  "El camarero se afloja la pajarita",
  "¡Qué piernas!",
  "El camarero ya no siente los pies",
  "El camarero va con la lengua fuera",
  "La cuenta sigue subiendo",
];

export function milestoneText(metres: number): { title: string; text: string } {
  const i = Math.max(0, Math.round(metres / 1000) - 1);
  return { title: `¡${formatMetres(metres)}!`, text: QUIPS[i % QUIPS.length] ?? "" };
}

/** Caption for a new lap: even laps run at night, odd ones (from the third) at dawn and faster. */
export function lapCaption(lap: number): string {
  if (lap % 2 === 0) return `Vuelta ${formatInt(lap)} · de noche`;
  return `Vuelta ${formatInt(lap)} · amanece, más rápido`;
}

export const SHARE_URL = "https://isroma.github.io/badajoz-surfers/";

/** `zone` reads inside a sentence, e.g. "la Margen derecha" (see copy.ts). */
export function shareText(distance: number, zone: string, lap: number): string {
  return `He corrido ${formatMetres(distance)} por Badajoz en Simpa (hasta ${zone}, vuelta ${formatInt(lap)}) 🏃‍♂️🍺 ¿Me pillas? ${SHARE_URL}`;
}
