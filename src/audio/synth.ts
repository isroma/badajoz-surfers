/** Tiny synthesis helpers. Every voice uses short attack/release ramps so nothing clicks. */

export const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "A4", "G#3", "Bb5" -> MIDI number. */
export function noteToMidi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return 69;
  const [, letter = "A", acc = "", oct = "4"] = m;
  const semis = (NOTE_INDEX[letter] ?? 9) + (acc === "#" ? 1 : acc === "b" ? -1 : 0);
  return (Number(oct) + 1) * 12 + semis;
}

export interface ToneOptions {
  type?: OscillatorType;
  /** Start frequency in Hz. */
  freq: number;
  /** Optional glide target in Hz (exponential). */
  freqEnd?: number;
  /** Peak gain. */
  gain: number;
  attack?: number;
  /** Hold at peak before the decay starts. */
  hold?: number;
  /** Exponential-ish decay time. */
  decay: number;
  detune?: number;
  /** Optional lowpass cutoff. */
  lowpass?: number;
}

export function tone(ctx: BaseAudioContext, out: AudioNode, when: number, o: ToneOptions): void {
  const osc = ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(Math.max(1, o.freq), when);
  const attack = o.attack ?? 0.005;
  const hold = o.hold ?? 0;
  const end = when + attack + hold + o.decay;
  if (o.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), end);
  if (o.detune) osc.detune.setValueAtTime(o.detune, when);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(o.gain, when + attack);
  g.gain.setValueAtTime(o.gain, when + attack + hold);
  g.gain.setTargetAtTime(0, when + attack + hold, o.decay / 4);
  let node: AudioNode = osc;
  if (o.lowpass) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = o.lowpass;
    osc.connect(f);
    node = f;
  }
  node.connect(g);
  g.connect(out);
  osc.start(when);
  osc.stop(end + o.decay * 0.6 + 0.02);
  // Release the whole voice once it has played, so nothing accumulates over a long session.
  osc.onended = () => {
    osc.disconnect();
    if (node !== osc) node.disconnect();
    g.disconnect();
  };
}

let noiseBuffer: AudioBuffer | null = null;
let noiseOwner: BaseAudioContext | null = null;

function getNoise(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBuffer && noiseOwner === ctx) return noiseBuffer;
  const len = Math.floor(ctx.sampleRate * 1.5);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  noiseOwner = ctx;
  return buf;
}

export interface NoiseOptions {
  gain: number;
  attack?: number;
  decay: number;
  filter?: BiquadFilterType;
  freq?: number;
  freqEnd?: number;
  q?: number;
}

export function noise(ctx: BaseAudioContext, out: AudioNode, when: number, o: NoiseOptions): void {
  const src = ctx.createBufferSource();
  src.buffer = getNoise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = o.filter ?? "bandpass";
  f.frequency.setValueAtTime(o.freq ?? 2000, when);
  const attack = o.attack ?? 0.003;
  if (o.freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), when + attack + o.decay);
  f.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(o.gain, when + attack);
  g.gain.setTargetAtTime(0, when + attack, o.decay / 4);
  src.connect(f);
  f.connect(g);
  g.connect(out);
  // Random offset so consecutive bursts don't sound identical.
  src.start(when, Math.random() * 0.5);
  src.stop(when + attack + o.decay * 1.6 + 0.02);
  src.onended = () => {
    src.disconnect();
    f.disconnect();
    g.disconnect();
  };
}
