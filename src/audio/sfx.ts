/** Sound effects, all synthesized. Each function schedules its voices at `t`. */
import { midiToFreq, noise, tone } from "./synth";

export type SfxName =
  | "jump"
  | "superJump"
  | "land"
  | "roll"
  | "lane"
  | "bellota"
  | "powerupStart"
  | "powerupEnd"
  | "letter"
  | "word"
  | "nearMiss"
  | "stumble"
  | "shieldBreak"
  | "crash"
  | "caught"
  | "countdown"
  | "go"
  | "zone"
  | "click"
  | "hover"
  | "purchase"
  | "denied"
  | "mission"
  | "hint"
  | "hintDone";

type Ctx = BaseAudioContext;
type Player = (ctx: Ctx, out: AudioNode, t: number, arg: number) => void;

const n = (midi: number): number => midiToFreq(midi);

/** Major pentatonic steps used by the climbing bellota ping. */
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];

export const SFX: Record<SfxName, Player> = {
  jump: (c, o, t) => {
    tone(c, o, t, { type: "square", freq: 300, freqEnd: 620, gain: 0.07, decay: 0.12, lowpass: 3000 });
    noise(c, o, t, { gain: 0.05, decay: 0.08, filter: "highpass", freq: 3000 });
  },
  superJump: (c, o, t) => {
    tone(c, o, t, { type: "square", freq: 220, freqEnd: 900, gain: 0.08, decay: 0.28, lowpass: 3500 });
    tone(c, o, t + 0.04, { type: "triangle", freq: 440, freqEnd: 1760, gain: 0.07, decay: 0.3 });
    noise(c, o, t, { gain: 0.08, decay: 0.3, filter: "bandpass", freq: 800, freqEnd: 5000, q: 2 });
  },
  land: (c, o, t) => {
    tone(c, o, t, { freq: 120, freqEnd: 50, gain: 0.22, decay: 0.1 });
    noise(c, o, t, { gain: 0.05, decay: 0.05, filter: "lowpass", freq: 900 });
  },
  roll: (c, o, t) => {
    noise(c, o, t, { gain: 0.12, attack: 0.03, decay: 0.25, filter: "bandpass", freq: 2500, freqEnd: 500, q: 1.5 });
  },
  lane: (c, o, t) => {
    noise(c, o, t, { gain: 0.06, decay: 0.07, filter: "bandpass", freq: 1800, freqEnd: 3200, q: 2 });
    tone(c, o, t, { type: "triangle", freq: 1100, gain: 0.025, decay: 0.03 });
  },
  bellota: (c, o, t, streak) => {
    const base = 76 + (PENTA[Math.min(streak, 8)] ?? 0); // E5 upwards
    tone(c, o, t, { type: "square", freq: n(base), gain: 0.045, decay: 0.05, lowpass: 6000 });
    tone(c, o, t + 0.045, { type: "square", freq: n(base + 7), gain: 0.05, decay: 0.14, lowpass: 6000 });
    tone(c, o, t + 0.045, { freq: n(base + 12), gain: 0.025, decay: 0.12 });
  },
  powerupStart: (c, o, t) => {
    [0, 4, 7, 12, 16].forEach((s, i) =>
      tone(c, o, t + i * 0.055, { type: "square", freq: n(69 + s), gain: 0.06, decay: 0.12, lowpass: 4000 }),
    );
    tone(c, o, t + 0.28, { type: "triangle", freq: n(93), gain: 0.06, hold: 0.1, decay: 0.3 });
  },
  powerupEnd: (c, o, t) => {
    tone(c, o, t, { type: "square", freq: n(76), gain: 0.05, decay: 0.08, lowpass: 2500 });
    tone(c, o, t + 0.09, { type: "square", freq: n(69), gain: 0.05, decay: 0.15, lowpass: 2000 });
  },
  letter: (c, o, t, index) => {
    const root = 72 + (PENTA[Math.min(index, 6)] ?? 0);
    tone(c, o, t, { type: "triangle", freq: n(root), gain: 0.09, decay: 0.12 });
    tone(c, o, t + 0.06, { type: "triangle", freq: n(root + 12), gain: 0.08, decay: 0.25 });
    noise(c, o, t + 0.06, { gain: 0.03, decay: 0.2, filter: "highpass", freq: 8000 });
  },
  word: (c, o, t) => {
    // Little fanfare: A–C#–E, then a held A major chord.
    const seq = [69, 73, 76, 81];
    seq.forEach((m, i) => tone(c, o, t + i * 0.1, { type: "square", freq: n(m), gain: 0.06, decay: 0.12, lowpass: 3500 }));
    for (const m of [69, 73, 76, 81, 85]) {
      tone(c, o, t + 0.42, { type: "sawtooth", freq: n(m), gain: 0.03, hold: 0.25, decay: 0.5, lowpass: 3000 });
    }
    noise(c, o, t + 0.42, { gain: 0.05, decay: 0.5, filter: "highpass", freq: 6000 });
  },
  nearMiss: (c, o, t) => {
    noise(c, o, t, { gain: 0.1, attack: 0.01, decay: 0.16, filter: "bandpass", freq: 900, freqEnd: 4500, q: 3 });
    tone(c, o, t + 0.02, { type: "triangle", freq: n(88), freqEnd: n(95), gain: 0.03, decay: 0.08 });
  },
  stumble: (c, o, t) => {
    tone(c, o, t, { freq: 160, freqEnd: 60, gain: 0.3, decay: 0.16 });
    noise(c, o, t, { gain: 0.12, decay: 0.12, filter: "lowpass", freq: 1200 });
    // A shouted "¡eh!": a buzzy voice through two formant filters.
    tone(c, o, t + 0.07, { type: "sawtooth", freq: 240, freqEnd: 190, gain: 0.035, hold: 0.08, decay: 0.12, lowpass: 1800 });
    noise(c, o, t + 0.07, { gain: 0.05, decay: 0.14, filter: "bandpass", freq: 600, q: 4 });
    noise(c, o, t + 0.07, { gain: 0.04, decay: 0.14, filter: "bandpass", freq: 1900, q: 5 });
  },
  shieldBreak: (c, o, t) => {
    noise(c, o, t, { gain: 0.22, decay: 0.3, filter: "lowpass", freq: 3000, freqEnd: 300 });
    tone(c, o, t, { freq: 110, freqEnd: 40, gain: 0.3, decay: 0.2 });
    [96, 100, 103, 108].forEach((m, i) => tone(c, o, t + 0.12 + i * 0.045, { type: "triangle", freq: n(m), gain: 0.04, decay: 0.12 }));
  },
  crash: (c, o, t) => {
    noise(c, o, t, { gain: 0.3, decay: 0.45, filter: "lowpass", freq: 2500, freqEnd: 200 });
    noise(c, o, t + 0.03, { gain: 0.12, decay: 0.2, filter: "bandpass", freq: 4000, q: 1 });
    tone(c, o, t, { freq: 90, freqEnd: 32, gain: 0.4, decay: 0.3 });
  },
  caught: (c, o, t) => {
    // Sad trombone: four sliding, wobbling steps down.
    [62, 61, 60, 59].forEach((m, i) => {
      const last = i === 3;
      tone(c, o, t + i * 0.32, {
        type: "sawtooth",
        freq: n(m),
        freqEnd: last ? n(m - 1.5) : n(m) * 0.985,
        gain: 0.07,
        attack: 0.03,
        hold: last ? 0.5 : 0.18,
        decay: last ? 0.4 : 0.1,
        lowpass: 1100,
      });
    });
  },
  countdown: (c, o, t) => {
    tone(c, o, t, { type: "square", freq: n(72), gain: 0.06, hold: 0.06, decay: 0.12, lowpass: 3000 });
  },
  go: (c, o, t) => {
    tone(c, o, t, { type: "square", freq: n(84), gain: 0.07, hold: 0.15, decay: 0.3, lowpass: 3500 });
    tone(c, o, t, { type: "triangle", freq: n(72), gain: 0.06, hold: 0.15, decay: 0.3 });
  },
  zone: (c, o, t) => {
    [76, 79, 81, 84].forEach((m, i) => tone(c, o, t + i * 0.08, { type: "triangle", freq: n(m), gain: 0.07, decay: 0.2 }));
  },
  click: (c, o, t) => {
    tone(c, o, t, { type: "triangle", freq: 900, freqEnd: 600, gain: 0.08, decay: 0.05 });
  },
  hover: (c, o, t) => {
    tone(c, o, t, { type: "sine", freq: 1400, gain: 0.025, decay: 0.03 });
  },
  purchase: (c, o, t) => {
    [0, 7, 12, 16, 19].forEach((s, i) => tone(c, o, t + i * 0.05, { type: "square", freq: n(76 + s), gain: 0.045, decay: 0.1, lowpass: 5000 }));
    noise(c, o, t + 0.2, { gain: 0.04, decay: 0.25, filter: "highpass", freq: 7000 });
  },
  denied: (c, o, t) => {
    tone(c, o, t, { type: "square", freq: 180, gain: 0.05, decay: 0.08, lowpass: 1200 });
    tone(c, o, t + 0.1, { type: "square", freq: 150, gain: 0.05, decay: 0.12, lowpass: 1200 });
  },
  hint: (c, o, t) => {
    tone(c, o, t, { type: "triangle", freq: n(81), gain: 0.07, decay: 0.12 });
    tone(c, o, t + 0.11, { type: "triangle", freq: n(81), gain: 0.07, decay: 0.16 });
  },
  hintDone: (c, o, t) => {
    tone(c, o, t, { type: "square", freq: n(79), gain: 0.05, decay: 0.07, lowpass: 4000 });
    tone(c, o, t + 0.07, { type: "square", freq: n(86), gain: 0.05, decay: 0.16, lowpass: 4000 });
  },
  mission: (c, o, t) => {
    [72, 76, 79, 84, 88].forEach((m, i) => tone(c, o, t + i * 0.07, { type: "triangle", freq: n(m), gain: 0.08, decay: 0.15 }));
    tone(c, o, t + 0.36, { type: "square", freq: n(91), gain: 0.04, hold: 0.15, decay: 0.35, lowpass: 4000 });
  },
};
