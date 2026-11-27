/**
 * "Rumba del Simpa": the original in-game theme, written as data.
 *
 * 16 bars of 4/4 in A minor with a Phrygian (Andalusian) flavour, 16 steps per bar.
 * A section: the Andalusian cadence Am–G–F–E twice. B section: F–G–Am–Am–Dm–Am–E–E, which
 * lands back on Am at the top of the loop. The rhythm is a rumba strum with palmas (claps).
 */

export type ChordName = "Am" | "G" | "F" | "E" | "Dm";

/** Chord tones as MIDI notes (a close voicing around middle C) and the bass root. */
export const CHORDS: Readonly<Record<ChordName, { notes: readonly number[]; root: number }>> = {
  Am: { notes: [57, 60, 64], root: 45 },
  G: { notes: [55, 59, 62], root: 43 },
  F: { notes: [53, 57, 60], root: 41 },
  E: { notes: [52, 56, 59], root: 40 },
  Dm: { notes: [50, 53, 57], root: 38 },
};

export const PROGRESSION: readonly ChordName[] = [
  // A
  "Am", "G", "F", "E", "Am", "G", "F", "E",
  // B
  "F", "G", "Am", "Am", "Dm", "Am", "E", "E",
];

/** A melody note: name (null = rest) and length in 16th notes. Each bar sums to 16. */
export type MelodyNote = readonly [string | null, number];

export const MELODY: readonly (readonly MelodyNote[])[] = [
  // A — the hook
  [["A4", 2], ["C5", 2], ["E5", 3], ["D5", 1], ["C5", 2], ["B4", 2], ["C5", 4]],
  [["B4", 2], ["D5", 2], ["G5", 3], ["F5", 1], ["E5", 2], ["D5", 2], ["B4", 4]],
  [["A4", 2], ["C5", 2], ["F5", 3], ["E5", 1], ["D5", 2], ["C5", 2], ["A4", 4]],
  [["G#4", 2], ["B4", 2], ["E5", 4], ["F5", 2], ["E5", 2], ["D5", 2], ["C5", 1], ["B4", 1]],
  [["E5", 2], ["E5", 1], ["F5", 1], ["E5", 2], ["D5", 2], ["C5", 3], ["B4", 1], ["A4", 4]],
  [["D5", 2], ["D5", 1], ["E5", 1], ["D5", 2], ["C5", 2], ["B4", 3], ["A4", 1], ["G4", 4]],
  [["C5", 2], ["A4", 2], ["C5", 2], ["F5", 2], ["E5", 3], ["D5", 1], ["C5", 2], ["A4", 2]],
  [["B4", 3], ["C5", 1], ["B4", 2], ["A4", 2], ["G#4", 4], [null, 4]],
  // B — the soaring part
  [["A5", 6], ["G5", 2], ["F5", 4], ["E5", 4]],
  [["D5", 4], ["G5", 4], ["F5", 2], ["E5", 2], ["D5", 4]],
  [["E5", 8], ["C5", 4], ["A4", 4]],
  [["B4", 2], ["C5", 2], ["D5", 2], ["E5", 2], ["A5", 6], [null, 2]],
  [["F5", 4], ["E5", 2], ["D5", 2], ["A5", 4], ["F5", 4]],
  [["E5", 4], ["C5", 2], ["E5", 2], ["A4", 8]],
  [["G#4", 2], ["B4", 2], ["D5", 2], ["F5", 2], ["E5", 4], ["D5", 2], ["C5", 2]],
  [["B4", 4], ["G#4", 4], ["E4", 4], [null, 4]],
];

/** Per-step velocity (0 = silent) for the 16 steps of a bar. */
type Pattern = readonly number[];

// Rumba strum: down on 1, the "and" of 1, 2-and, 3, and the push into 4.
export const STRUM: Pattern = [1, 0, 0.35, 0.8, 0, 0, 0.9, 0, 0.7, 0, 0.35, 0.8, 0, 0, 0.9, 0];
// Palmas: backbeat claps plus soft off-beat "sordas".
export const CLAPS: Pattern = [0, 0, 0, 0, 1, 0, 0, 0.3, 0, 0, 0.35, 0, 1, 0, 0, 0.3];
export const KICK: Pattern = [1, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0.45, 0, 0, 0, 0, 0];
export const SHAKER: Pattern = [0.5, 0.25, 0.7, 0.25, 0.5, 0.25, 0.7, 0.25, 0.5, 0.25, 0.7, 0.25, 0.5, 0.25, 0.7, 0.35];

/** Bass line per bar: step, interval from the chord root in semitones, length in steps. */
export const BASS: readonly (readonly [number, number, number])[] = [
  [0, 0, 3],
  [3, 0, 2],
  [6, 7, 2],
  [8, 12, 3],
  [11, 7, 2],
  [14, 0, 2],
];

export const BASE_BPM = 112;
export const MENU_BPM = 96;
