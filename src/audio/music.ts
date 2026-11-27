/** Music player: a lookahead step scheduler that plays the song data in song.ts. */
import { BASE_BPM, BASS, CHORDS, CLAPS, KICK, MELODY, MENU_BPM, PROGRESSION, SHAKER, STRUM } from "./song";
import { midiToFreq, noise, noteToMidi, tone } from "./synth";

export type MusicMode = "off" | "menu" | "play" | "paused";

const STEPS_PER_BAR = 16;
const LOOKAHEAD = 0.12;
const TICK_MS = 25;

interface LeadEvent {
  step: number;
  midi: number;
  len: number;
}

/** Melody converted to per-bar lists of note starts. */
const LEAD_BARS: LeadEvent[][] = MELODY.map((bar) => {
  const events: LeadEvent[] = [];
  let step = 0;
  for (const [name, len] of bar) {
    if (name) events.push({ step, midi: noteToMidi(name), len });
    step += len;
  }
  return events;
});

interface LayerLevels {
  drums: number;
  kick: number;
  chords: number;
  bass: number;
  lead: number;
  extra: number;
  cutoff: number;
}

const LEVELS: Record<Exclude<MusicMode, "off">, LayerLevels> = {
  menu: { drums: 0.45, kick: 0.35, chords: 0.9, bass: 0.8, lead: 0.55, extra: 0, cutoff: 1300 },
  paused: { drums: 0.3, kick: 0.2, chords: 0.8, bass: 0.7, lead: 0.35, extra: 0, cutoff: 650 },
  play: { drums: 1, kick: 1, chords: 1, bass: 1, lead: 1, extra: 0, cutoff: 7000 },
};

export class Music {
  private readonly ctx: AudioContext;
  private readonly mixer: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly layers: Record<"drums" | "kick" | "chords" | "bass" | "lead" | "extra", GainNode>;
  private mode: MusicMode = "off";
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;
  private bpm = MENU_BPM;
  private targetBpm = MENU_BPM;
  private powerup = false;
  private enabled = true;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.mixer = ctx.createGain();
    this.mixer.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 1200;
    this.filter.Q.value = 0.7;
    this.mixer.connect(this.filter);
    this.filter.connect(out);

    const mk = (): GainNode => {
      const g = ctx.createGain();
      g.connect(this.mixer);
      return g;
    };
    this.layers = { drums: mk(), kick: mk(), chords: mk(), bass: mk(), lead: mk(), extra: mk() };

    // A short feedback echo on the lead gives it some space without reverb.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = (60 / BASE_BPM) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.25;
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    this.layers.lead.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(this.mixer);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  setMode(mode: MusicMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    const now = this.ctx.currentTime;
    if (mode === "off") {
      this.mixer.gain.setTargetAtTime(0, now, 0.08);
      this.stopTimer();
      return;
    }
    this.mixer.gain.cancelScheduledValues(now);
    this.mixer.gain.setTargetAtTime(0.9, now, 0.15);
    this.targetBpm = mode === "play" ? BASE_BPM : MENU_BPM;
    this.applyLevels(0.25);
    if (!this.timer) {
      this.nextTime = now + 0.08;
      this.timer = setInterval(() => this.tick(), TICK_MS);
    }
  }

  /** Tempo follows the running speed a little (m/s). */
  setSpeed(speed: number): void {
    if (this.mode !== "play" || !Number.isFinite(speed)) return;
    this.targetBpm = BASE_BPM + Math.min(22, Math.max(0, (speed - 12) * 1.1));
  }

  setPowerup(on: boolean): void {
    if (on === this.powerup) return;
    this.powerup = on;
    this.applyLevels(on ? 0.4 : 0.3);
  }

  /** Stop the loop and play a short "game over" sting. */
  sting(out: AudioNode): void {
    this.setMode("off");
    const t = this.ctx.currentTime + 0.05;
    const notes = ["E5", "D5", "C5", "B4"];
    notes.forEach((n, i) =>
      tone(this.ctx, out, t + i * 0.13, { type: "square", freq: midiToFreq(noteToMidi(n)), gain: 0.07, decay: 0.16, lowpass: 2400 }),
    );
    for (const n of ["A3", "E4", "A4", "C5"]) {
      tone(this.ctx, out, t + 0.56, { type: "triangle", freq: midiToFreq(noteToMidi(n)), gain: 0.09, hold: 0.25, decay: 0.7 });
    }
  }

  dispose(): void {
    this.stopTimer();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private applyLevels(time: number): void {
    if (this.mode === "off") return;
    const lv = LEVELS[this.mode];
    const now = this.ctx.currentTime;
    const boost = this.powerup && this.mode === "play";
    const set = (g: GainNode, v: number): void => {
      g.gain.setTargetAtTime(v, now, time / 3);
    };
    set(this.layers.drums, lv.drums);
    set(this.layers.kick, lv.kick);
    set(this.layers.chords, lv.chords);
    set(this.layers.bass, lv.bass);
    set(this.layers.lead, lv.lead);
    set(this.layers.extra, boost ? 1 : lv.extra);
    this.filter.frequency.cancelScheduledValues(now);
    this.filter.frequency.setValueAtTime(this.filter.frequency.value, now);
    this.filter.frequency.exponentialRampToValueAtTime(boost ? 16000 : lv.cutoff, now + time + (boost ? 0.6 : 0));
  }

  private tick(): void {
    const now = this.ctx.currentTime;
    // After a long stall (tab hidden), don't try to catch up on missed steps.
    if (this.nextTime < now - 0.25) this.nextTime = now + 0.05;
    while (this.nextTime < now + LOOKAHEAD) {
      if (this.enabled) this.playStep(this.step, this.nextTime);
      this.bpm += (this.targetBpm - this.bpm) * 0.04;
      this.nextTime += 60 / this.bpm / 4;
      this.step = (this.step + 1) % (PROGRESSION.length * STEPS_PER_BAR);
    }
  }

  private playStep(step: number, t: number): void {
    const ctx = this.ctx;
    const bar = Math.floor(step / STEPS_PER_BAR);
    const s = step % STEPS_PER_BAR;
    const chord = CHORDS[PROGRESSION[bar] ?? "Am"];
    const stepDur = 60 / this.bpm / 4;
    const L = this.layers;

    const kick = KICK[s] ?? 0;
    if (kick) tone(ctx, L.kick, t, { freq: 140, freqEnd: 45, gain: 0.55 * kick, decay: 0.16 });

    const clap = CLAPS[s] ?? 0;
    if (clap) {
      for (let i = 0; i < 3; i++) noise(ctx, L.drums, t + i * 0.009, { gain: 0.16 * clap, decay: 0.07 + i * 0.03, freq: 1400, q: 0.9 });
    }
    const shaker = SHAKER[s] ?? 0;
    if (shaker) noise(ctx, L.drums, t, { gain: 0.045 * shaker, decay: 0.035, filter: "highpass", freq: 7500 });

    const strum = STRUM[s] ?? 0;
    if (strum) {
      chord.notes.forEach((midi, i) => {
        const when = t + i * 0.011;
        const f = midiToFreq(midi);
        tone(ctx, L.chords, when, { type: "triangle", freq: f, gain: 0.07 * strum, decay: 0.24 });
        tone(ctx, L.chords, when, { type: "sawtooth", freq: f, gain: 0.022 * strum, decay: 0.12, lowpass: 2200 });
      });
    }

    for (const [bStep, interval, len] of BASS) {
      if (bStep !== s) continue;
      tone(ctx, L.bass, t, {
        type: "sawtooth",
        freq: midiToFreq(chord.root + interval),
        gain: 0.2,
        hold: len * stepDur * 0.5,
        decay: len * stepDur * 0.6,
        lowpass: 520,
      });
    }

    for (const ev of LEAD_BARS[bar] ?? []) {
      if (ev.step !== s) continue;
      const f = midiToFreq(ev.midi);
      const hold = Math.max(0.02, ev.len * stepDur * 0.7);
      tone(ctx, L.lead, t, { type: "square", freq: f, gain: 0.05, attack: 0.008, hold, decay: 0.12, lowpass: 2800 });
      tone(ctx, L.lead, t, { type: "triangle", freq: f * 2, gain: 0.025, attack: 0.008, hold, decay: 0.1, detune: 6 });
    }

    // Power-up layer: a sparkly arpeggio over the chord, one octave up.
    if (this.powerup && this.mode === "play") {
      const midi = (chord.notes[s % chord.notes.length] ?? 60) + 12 + (s >= 8 ? 12 : 0);
      tone(ctx, L.extra, t, { type: "square", freq: midiToFreq(midi), gain: 0.022, decay: 0.07, lowpass: 5000 });
    }
  }
}
