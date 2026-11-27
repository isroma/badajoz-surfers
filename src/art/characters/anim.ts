/**
 * Procedural animation for the human rig. A pose is a flat Float32Array of channels: Euler angles
 * for the 21 animated bones, a hips offset, the roll spin, grounding controls and the 14 facial
 * expression weights. Clips are pure functions of time / stride phase that write a target pose;
 * the actor cross-fades between them (see characters.ts) and then plants the feet, adds a landing
 * absorb, blinks, and runs the spring-driven secondary bones.
 */
import { FX, FACE_CHANNELS } from "./face";
import { ANIMATED, B } from "./rig";

export const HX = ANIMATED * 3;
export const HY = HX + 1;
export const HZ = HX + 2;
export const SPIN = HX + 3;
/** 0..1: how much the lowest foot is planted on the ground (pelvis height solved from the feet). */
export const GROUND = HX + 4;
/** Extra height above the planted foot (run flight, hops, tiptoes when lifted). */
export const LIFT = HX + 5;
/** Which feet count for planting: -1 left only, 0 both, 1 right only. */
export const GMASK = HX + 6;
/** 0..1: roll tuck amount (the actor scales the ball down a touch for tall hats). */
export const ROLLK = HX + 7;
export const FACE = HX + 8;
export const NCH = FACE + FACE_CHANNELS;

export type Clip = "idle" | "run" | "jump" | "fall" | "roll" | "stumble" | "caught" | "celebrate" | "ride" | "carried";

export interface ClipCtx {
  /** Seconds since this clip started. */
  t: number;
  /** Seconds since the actor was created (for idle loops). */
  time: number;
  /** Stride phase in radians (continuous). */
  phase: number;
  speed: number;
  waiter: boolean;
  /** Which leg leads this jump (alternates). */
  lead: 1 | -1;
  /** The fall continues a jump (legs were tucked). */
  fromJump: boolean;
}

const TAU = Math.PI * 2;
const SIDES = [-1, 1] as const;
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
export const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const frac = (x: number): number => x - Math.floor(x);

/** Periodic Catmull-Rom through evenly spaced keys. */
function loop(keys: readonly number[], u: number): number {
  const n = keys.length;
  const x = frac(u) * n;
  const i = Math.floor(x);
  const t = x - i;
  const p0 = keys[(i - 1 + n) % n] ?? 0;
  const p1 = keys[i % n] ?? 0;
  const p2 = keys[(i + 1) % n] ?? 0;
  const p3 = keys[(i + 2) % n] ?? 0;
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// ---------------------------------------------------------------------------
// pose writers (semantic, mirrored per side)
// ---------------------------------------------------------------------------

function rot(o: Float32Array, bone: number, x: number, y: number, z: number): void {
  o[bone * 3] = x;
  o[bone * 3 + 1] = y;
  o[bone * 3 + 2] = z;
}

/** Spine: pitch (+ = forward bend), yaw (+ = turn to the character's left), roll. */
function spine(o: Float32Array, bone: number, pitch: number, yaw = 0, roll = 0): void {
  rot(o, bone, -pitch, yaw, roll);
}

/**
 * Arm pose for one side (mirrored). sw: shoulder flexion (+ forward/up); ab: abduction relative to
 * the slightly-out bind pose; tw: internal rotation; el: elbow flexion; up/fwd: clavicle shrug and
 * protraction; wf/wx: wrist flexion (towards the palm) and pitch; ft: forearm twist.
 */
function arm(o: Float32Array, side: -1 | 1, sw: number, ab = 0, tw = 0, el = 0, up = 0, fwd = 0, wf = 0, wx = 0, ft = 0): void {
  const L = side < 0;
  rot(o, L ? B.clavL : B.clavR, 0, side * fwd, side * up);
  rot(o, L ? B.armL : B.armR, sw, side * tw, side * ab);
  rot(o, L ? B.foreL : B.foreR, el, side * ft, 0);
  rot(o, L ? B.handL : B.handR, wx, 0, -side * wf);
}

/** Leg pose for one side: fl hip flexion (+ thigh forward), ab abduction, tw toes-out rotation, kn knee flexion, an ankle (+ toes up), toe. */
function leg(o: Float32Array, side: -1 | 1, fl: number, ab = 0, tw = 0, kn = 0, an = 0, toe = 0): void {
  const L = side < 0;
  rot(o, L ? B.thighL : B.thighR, fl, -side * tw, side * ab);
  rot(o, L ? B.shinL : B.shinR, -kn, 0, 0);
  rot(o, L ? B.footL : B.footR, an, 0, 0);
  rot(o, L ? B.toeL : B.toeR, toe, 0, 0);
}

function face(o: Float32Array, k: keyof typeof FX, v: number): void {
  o[FACE + FX[k]] = (o[FACE + FX[k]] ?? 0) + v;
}

function reset(o: Float32Array): void {
  o.fill(0);
  o[GROUND] = 1;
}

/** Linear blend b into a (a = a + (b - a) * k). */
export function mixInto(a: Float32Array, b: Float32Array, k: number): void {
  for (let i = 0; i < a.length; i++) a[i] = (a[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)) * k;
}

const tmpA = new Float32Array(NCH);
const tmpB = new Float32Array(NCH);

// ---------------------------------------------------------------------------
// clips
// ---------------------------------------------------------------------------

const HIP = [0.42, 0.08, -0.36, -0.6, -0.3, 0.4, 1.0, 0.84];
const KNEE = [0.24, 0.62, 0.42, 1.05, 1.95, 2.05, 1.38, 0.52];
const ANKLE = [0.16, 0.0, -0.48, -0.85, -0.45, 0.02, 0.22, 0.26];
const TOE = [0, 0, 0.55, 0.15, 0, 0, 0, 0];

function runLegs(o: Float32Array, u: number, amp: number, knee: number): void {
  for (const side of SIDES) {
    const v = side < 0 ? u : u + 0.5;
    leg(o, side, loop(HIP, v) * amp + 0.06, 0.015, 0.05, loop(KNEE, v) * knee, loop(ANKLE, v), loop(TOE, v));
  }
}

function run(o: Float32Array, c: ClipCtx): void {
  const u = frac(c.phase / TAU);
  const s = clamp((c.speed - 6) / 14, 0, 1);
  const w = c.waiter;
  const amp = w ? 0.78 : 0.82 + 0.22 * s;
  runLegs(o, u, amp, w ? 0.8 : 0.9 + 0.12 * s);
  o[LIFT] = (w ? 0.04 : 0.035 + 0.025 * s) * Math.max(0, Math.sin(TAU * 2 * (u - 0.3)));
  const lean = w ? 0.12 + 0.006 * c.speed : clamp(0.13 + 0.012 * c.speed, 0.15, 0.36);
  const hipYaw = -0.15 * Math.cos(TAU * (u - 0.8));
  const shYaw = (w ? 0.16 : 0.22) * Math.cos(TAU * (u - 0.8));
  const bob = Math.cos(TAU * 2 * (u - 0.1));
  spine(o, B.hips, 0.06, hipYaw, -0.06 * Math.sin(TAU * (u + 0.125)));
  spine(o, B.spine, lean * 0.5 + 0.02 * bob, (shYaw - hipYaw) * 0.45, 0.03 * Math.sin(TAU * (u + 0.125)));
  spine(o, B.chest, lean * 0.4 + 0.03 * bob, (shYaw - hipYaw) * 0.55);
  spine(o, B.neck, -lean * 0.45, -shYaw * 0.5);
  spine(o, B.head, -lean * 0.42 - 0.04 * bob, -shYaw * 0.45);
  const A = w ? 0.6 : 0.72 + 0.28 * s;
  for (const side of SIDES) {
    const f = Math.cos(TAU * (u - (side < 0 ? 0.3 : 0.8)));
    arm(o, side, 0.08 + lean * 0.8 + A * f, 0.0 - 0.06 * f, 0.3 + 0.15 * f, 1.32 + 0.38 * f, 0.04 + 0.05 * Math.max(0, f), 0.07 * f, 0.2, -0.15);
  }
  if (w) {
    // the bill held high and shaken, the tea-towel arm pumping
    const sh = Math.sin(c.time * 17);
    arm(o, 1, 2.55 + 0.14 * sh, 0.25 + 0.08 * Math.sin(c.time * 11), -0.2, 0.55 + 0.22 * Math.sin(c.time * 17 + 1), 0.25, 0, 0, 0.35 * Math.sin(c.time * 17 + 2));
    const f = Math.cos(TAU * (u - 0.3));
    arm(o, -1, 0.55 + 0.35 * f, 0.05, 0.35, 1.55, 0.05);
    face(o, "browAngry", 1);
    face(o, "open", 0.6 + 0.2 * Math.sin(c.time * 6.3));
    face(o, "grit", 0.55);
    face(o, "squint", 0.35);
  } else {
    face(o, "browAngry", 0.45);
    face(o, "squint", 0.25);
    face(o, "frown", 0.2);
    face(o, "grit", 0.15 + 0.1 * s);
    face(o, "open", 0.05 + 0.08 * Math.max(0, Math.sin(TAU * 2 * u)));
  }
}

function idle(o: Float32Array, c: ClipCtx): void {
  const t = c.time;
  const br = Math.sin(t * (c.waiter ? 2.4 : 4.6));
  const sway = Math.sin(t * 0.9);
  o[HX] = 0.015 * sway;
  spine(o, B.hips, 0.02, 0.04 * sway, -0.03 * sway);
  if (c.waiter) {
    // hands on hips, foot tapping, head shaking: unimpressed
    spine(o, B.spine, -0.02 + 0.01 * br);
    spine(o, B.chest, -0.06 + 0.02 * br);
    spine(o, B.neck, 0.05, 0.12 * Math.sin(t * 2.2));
    spine(o, B.head, 0.05, 0.2 * Math.sin(t * 2.2));
    for (const side of SIDES) arm(o, side, -0.45, 0.78, 0.75, 1.75, 0.08, -0.05, -0.3);
    leg(o, -1, 0.02, 0.06, 0, 0.08);
    const tap = Math.max(0, Math.sin(t * 9));
    leg(o, 1, 0.1, 0.08, 0.2, 0.12, 0.35 * tap);
    o[GMASK] = -1;
    face(o, "browAngry", 1);
    face(o, "frown", 0.8);
    face(o, "squint", 0.35);
    return;
  }
  // catching breath, glancing back over the shoulder now and then
  const cyc = t % 4.6;
  const sideK = Math.floor(t / 4.6) % 2 ? 1 : -1;
  const look = smooth(1.4, 1.75, cyc) * (1 - smooth(2.9, 3.3, cyc));
  spine(o, B.spine, 0.1 + 0.02 * br, 0.12 * sideK * look);
  spine(o, B.chest, 0.04 - 0.035 * br, 0.25 * sideK * look);
  spine(o, B.neck, -0.08, 0.4 * sideK * look);
  spine(o, B.head, -0.04 - 0.03 * br, 0.65 * sideK * look, 0.05 * sideK * look);
  for (const side of SIDES) {
    arm(o, side, -0.42, 0.75, 0.62, 1.75, 0.06 + 0.04 * Math.max(0, br), -0.06, -0.25);
  }
  leg(o, -1, 0.06, 0.05, 0.12, 0.2, 0.05);
  leg(o, 1, -0.02, 0.04, 0.08, 0.06);
  face(o, "open", 0.28 + 0.14 * br);
  face(o, "browWorried", 0.35 + 0.3 * look);
  face(o, "wide", 0.3 * look);
  face(o, "lookX", -sideK * 0.9 * look);
}

function launchPose(o: Float32Array, c: ClipCtx): void {
  const L = c.lead;
  spine(o, B.hips, -0.04);
  spine(o, B.spine, -0.06);
  spine(o, B.chest, -0.06);
  spine(o, B.neck, 0.02);
  spine(o, B.head, -0.1);
  leg(o, L, 1.05, 0, 0, 1.55, 0.15);
  leg(o, (-L) as -1 | 1, -0.32, 0, 0, 0.18, -0.75, 0.2);
  arm(o, L, 1.7, 0.2, 0.25, 0.7, 0.2);
  arm(o, (-L) as -1 | 1, 2.25, 0.3, 0.1, 0.45, 0.25);
  face(o, "grit", 0.8);
  face(o, "browAngry", 0.5);
  face(o, "squint", 0.5);
}

function tuckPose(o: Float32Array, c: ClipCtx): void {
  const L = c.lead;
  spine(o, B.hips, 0.1);
  spine(o, B.spine, 0.22);
  spine(o, B.chest, 0.12);
  spine(o, B.neck, -0.1);
  spine(o, B.head, -0.12);
  leg(o, L, 1.55, 0, 0, 2.15, 0.25);
  leg(o, (-L) as -1 | 1, 1.2, 0, 0, 2.25, 0.1);
  for (const side of SIDES) arm(o, side, 0.55 + (side === L ? -0.25 : 0.3), 0.85, 0.1, 1.35, 0.15, 0, 0.2);
  face(o, "open", 0.3);
  face(o, "browUp", 0.45);
  face(o, "wide", 0.2);
  face(o, "smile", 0.2);
}

function jump(o: Float32Array, c: ClipCtx): void {
  reset(tmpA);
  reset(tmpB);
  launchPose(tmpA, c);
  tuckPose(tmpB, c);
  const k = smooth(0.05, 0.3, c.t);
  mixInto(tmpA, tmpB, k);
  o.set(tmpA);
  o[GROUND] = 0;
  if (c.waiter) {
    arm(o, 1, 2.7, 0.3, 0, 0.4, 0.25);
    face(o, "browAngry", 1);
  }
}

function fallPose(o: Float32Array, c: ClipCtx): void {
  const wob = Math.sin(c.time * 7);
  spine(o, B.hips, 0.02);
  spine(o, B.spine, 0.04);
  spine(o, B.chest, -0.02);
  spine(o, B.neck, 0.08);
  spine(o, B.head, 0.12);
  leg(o, c.lead, 0.5, 0, 0, 0.55, -0.05);
  leg(o, (-c.lead) as -1 | 1, 0.12, 0, 0, 0.75, -0.2);
  for (const side of SIDES) arm(o, side, 0.55 + 0.1 * side * wob, 1.0 + 0.12 * side * wob, -0.1, 0.5, 0.12, 0, -0.2);
  face(o, "oh", 0.5);
  face(o, "browUp", 0.5);
  face(o, "wide", 0.3);
}

function fall(o: Float32Array, c: ClipCtx): void {
  reset(tmpA);
  reset(tmpB);
  tuckPose(tmpA, c);
  fallPose(tmpB, c);
  const k = c.fromJump ? smooth(0, 0.32, c.t) : 1;
  mixInto(tmpA, tmpB, k);
  o.set(tmpA);
  o[GROUND] = 0;
  if (c.waiter) {
    arm(o, 1, 2.6, 0.35, 0, 0.45, 0.25);
    face(o, "browAngry", 1);
  }
}

/** ROLL_TIME in the engine (src/game/tuning.ts). */
const ROLL = 0.7;

function roll(o: Float32Array, c: ClipCtx): void {
  const n = c.t / ROLL;
  const tuck = smooth(0, 0.15, n) * (1 - smooth(0.74, 1.0, n));
  // the ball rolls forward through a full turn
  o[SPIN] = -TAU * smooth(0.08, 0.8, n);
  o[ROLLK] = tuck;
  o[GROUND] = 1 - tuck;
  reset(tmpA);
  // tucked ball, chin on chest, arms hugging the shins (the actor centres the ball on the pivot)
  tmpA[GROUND] = 0;
  spine(tmpA, B.hips, 0.7);
  spine(tmpA, B.spine, 0.55);
  spine(tmpA, B.chest, 0.5);
  spine(tmpA, B.neck, 0.5);
  spine(tmpA, B.head, 0.4);
  for (const side of SIDES) {
    leg(tmpA, side, 2.25, 0.1, 0, 2.6, 0.35);
    arm(tmpA, side, 1.15, 0.05, 0.5, 1.5, 0.15, 0.2, 0.3);
  }
  // the waiter keeps the bill flat against his shins
  if (c.waiter) arm(tmpA, 1, 0.7, 0.05, 0.6, 2.1, 0.15, 0.15, 1.1);
  face(tmpA, "squint", 1);
  face(tmpA, "grit", 0.5);
  face(tmpA, "browAngry", 0.5);
  // coming out of it: legs reach for the road, arms swing into the run
  reset(tmpB);
  run(tmpB, c);
  const out = smooth(0.7, 1.0, n);
  mixInto(tmpA, tmpB, out * (1 - tuck));
  const spin = o[SPIN] ?? 0;
  const rk = o[ROLLK] ?? 0;
  const g = o[GROUND] ?? 0;
  o.set(tmpA);
  o[SPIN] = spin;
  o[ROLLK] = rk;
  o[GROUND] = g;
}

function stumble(o: Float32Array, c: ClipCtx): void {
  const t = c.t;
  const trip = smooth(0, 0.08, t);
  const recover = smooth(0.12, 0.55, t);
  // fast stutter steps
  const u = frac((c.phase * 1.35) / TAU);
  runLegs(o, u, 0.55, 0.8);
  const L = c.lead;
  const k = trip * (1 - recover);
  // the catch: one leg flung forward, one caught behind
  o[B.thighL * 3] = (o[B.thighL * 3] ?? 0) * (1 - k) + (L < 0 ? 1.0 : -0.45) * k;
  o[B.thighR * 3] = (o[B.thighR * 3] ?? 0) * (1 - k) + (L < 0 ? -0.45 : 1.0) * k;
  o[B.shinL * 3] = (o[B.shinL * 3] ?? 0) * (1 - k) - (L < 0 ? 0.3 : 1.3) * k;
  o[B.shinR * 3] = (o[B.shinR * 3] ?? 0) * (1 - k) - (L < 0 ? 1.3 : 0.3) * k;
  const pitch = 0.55 * trip - 0.3 * recover + 0.08 * Math.sin(t * 9) * recover;
  spine(o, B.hips, 0.1 * trip);
  spine(o, B.spine, pitch * 0.6, 0.12 * Math.sin(t * 7));
  spine(o, B.chest, pitch * 0.4, 0.15 * Math.sin(t * 7 + 1));
  spine(o, B.neck, -pitch * 0.5);
  spine(o, B.head, -pitch * 0.4 - 0.1);
  // windmilling arms
  const wm = t * 15;
  for (const side of SIDES) {
    const ph = wm + (side < 0 ? 0 : 2.2);
    arm(o, side, 1.5 + 1.2 * Math.sin(ph) * (0.5 + 0.5 * recover), 0.85 + 0.45 * Math.cos(ph), -0.2, 0.45 + 0.2 * Math.sin(ph + 1), 0.25, 0, -0.3);
  }
  o[LIFT] = 0.02 * Math.max(0, Math.sin(TAU * 2 * u));
  face(o, "open", 0.75);
  face(o, "browWorried", 1);
  face(o, "wide", 1);
  face(o, "oh", 0.25);
  if (c.waiter) face(o, "browAngry", 0.6);
}

function caught(o: Float32Array, c: ClipCtx): void {
  const t = c.time;
  if (c.waiter) {
    // grabbing forward
    spine(o, B.spine, 0.2);
    spine(o, B.chest, 0.1);
    for (const side of SIDES) arm(o, side, 1.45, 0.05, 0.2, 0.45, 0.15, 0.15);
    leg(o, -1, 0.25, 0, 0, 0.3);
    leg(o, 1, -0.15, 0, 0, 0.2);
    face(o, "browAngry", 1);
    face(o, "smirk", 0.8);
    face(o, "squint", 0.4);
    return;
  }
  // lifted by the collar: on tiptoe, shoulders up, sheepish grin, peeking back at the waiter
  const sw = Math.sin(t * 2.1);
  o[LIFT] = 0.05 + 0.01 * sw;
  spine(o, B.hips, -0.06, 0.08 * sw, 0.04 * sw);
  spine(o, B.spine, -0.08);
  spine(o, B.chest, -0.04);
  spine(o, B.neck, 0.18, 0.25);
  spine(o, B.head, 0.02, 0.2, 0.16);
  for (const side of SIDES) {
    arm(o, side, 0.45, 0.5, -0.3, 2.0, 0.32, 0.05, -0.5);
    leg(o, side, 0.08 + 0.06 * side * sw, 0.03, 0, 0.22 + 0.05 * side * sw, -0.55, 0.4);
  }
  face(o, "smile", 0.5);
  face(o, "smirk", 0.75);
  face(o, "browWorried", 0.75);
  face(o, "lookX", -0.85);
  face(o, "lookY", 0.1);
}

function celebrate(o: Float32Array, c: ClipCtx): void {
  const t = c.time;
  if (c.waiter) {
    const hop = Math.abs(Math.sin(t * 4.2));
    o[LIFT] = 0.05 * hop;
    spine(o, B.spine, -0.04);
    spine(o, B.chest, -0.08);
    spine(o, B.neck, -0.08);
    spine(o, B.head, -0.18 + 0.05 * Math.sin(t * 9));
    arm(o, 1, 2.75, 0.35 + 0.35 * Math.sin(t * 7), -0.2, 0.3, 0.25, 0, 0, 0.3 * Math.sin(t * 7 + 1));
    arm(o, -1, -0.3, 0.6, 0.8, 1.75, 0.06, 0, -0.3);
    for (const side of SIDES) leg(o, side, 0.12 * (1 - hop), 0.06, 0, 0.25 * (1 - hop) + 0.05, -0.2 * hop);
    face(o, "smile", 1);
    face(o, "open", 0.55 + 0.2 * Math.sin(t * 9));
    face(o, "squint", 0.5);
    face(o, "browUp", 0.25);
    return;
  }
  const hop = Math.abs(Math.sin(t * 5.2));
  o[LIFT] = 0.13 * hop;
  spine(o, B.spine, -0.05);
  spine(o, B.chest, -0.1);
  spine(o, B.head, -0.15);
  arm(o, 1, 2.9, 0.25, 0, 0.35 + 0.4 * (1 - hop), 0.3, 0, 0.3);
  arm(o, -1, 1.2 + 0.3 * hop, 0.25, 0.4, 1.9, 0.1, 0, 0.3);
  for (const side of SIDES) leg(o, side, 0.2 + 0.25 * (1 - hop), 0.06, 0, 0.25 + 0.55 * (1 - hop), -0.35 * hop);
  face(o, "smile", 1);
  face(o, "open", 0.55);
  face(o, "browUp", 0.4);
}

function ride(o: Float32Array, c: ClipCtx): void {
  const t = c.time;
  const lean = 0.2 + 0.006 * c.speed;
  const sway = Math.sin(t * 2.3);
  // a kick-push now and then with the back foot
  const kc = t % 2.6;
  const kick = kc < 0.9 ? kc / 0.9 : -1;
  spine(o, B.hips, 0.18, -0.22, 0.03 * sway);
  spine(o, B.spine, lean * 0.5, 0.12);
  spine(o, B.chest, lean * 0.4, 0.08, -0.03 * sway);
  spine(o, B.neck, -lean * 0.45, -0.08);
  spine(o, B.head, -lean * 0.4 - 0.05, -0.06, 0.04 * sway);
  for (const side of SIDES) arm(o, side, 0.5 + lean * 0.5, -0.08, 0.45, 0.95, 0.1, 0.15, 0.3, -0.5);
  o[GMASK] = -1;
  if (kick >= 0) {
    // step off beside the deck, push back along the road (the front knee bends to reach), recover
    const push = smooth(0.12, 0.3, kick) * (1 - smooth(0.7, 0.88, kick));
    const back = smooth(0.25, 0.75, kick);
    const rec = smooth(0.72, 1, kick);
    leg(o, -1, 0.45 + 0.25 * push, -0.1, 0.1, 0.65 + 0.75 * push, 0.1 + 0.35 * push);
    leg(o, 1, (0.3 - 0.8 * back) * (1 - rec) + 0.02 * rec, 0.06 - 0.14 * rec, 0.35 * rec, 0.15 * (1 - rec) + 1.1 * rec * (1 - smooth(0.9, 1, kick)) + 0.55 * smooth(0.9, 1, kick), -0.45 * (1 - rec) + 0.2 * rec, 0.3 * back * (1 - rec));
  } else {
    leg(o, -1, 0.45, -0.1, 0.1, 0.65, 0.1);
    leg(o, 1, 0.02, -0.08, 0.35, 0.55, 0.2);
  }
  face(o, "smile", 0.6);
  face(o, "smirk", 0.3);
  face(o, "squint", 0.25);
  face(o, "browUp", 0.15);
}

function carried(o: Float32Array, c: ClipCtx): void {
  const t = c.time;
  o[GROUND] = 0;
  const w = t * 7.5;
  spine(o, B.hips, 0.08, 0.06 * Math.sin(t * 0.9), 0.05 * Math.sin(t * 1.3));
  spine(o, B.spine, 0.02);
  spine(o, B.chest, -0.06);
  spine(o, B.neck, 0.3, 0.2 * Math.sin(t * 0.8));
  spine(o, B.head, 0.32, 0.25 * Math.sin(t * 0.8 + 0.4));
  // left hand keeps the cap on, right hand grips the stork's leg
  arm(o, -1, 2.5, 0.45, 0.7, 2.3, 0.35, 0.1, 0.3, 0.3);
  arm(o, 1, 2.85, 0.18, 0.1, 0.35 + 0.08 * Math.sin(t * 2), 0.4, 0, 0.4);
  for (const side of SIDES) {
    const ph = w + (side < 0 ? 0 : Math.PI);
    leg(o, side, 0.6 + 0.5 * Math.sin(ph), 0.06, 0, 1.15 + 0.65 * Math.sin(ph + 1.3), -0.35 + 0.2 * Math.sin(ph + 0.6));
  }
  face(o, "oh", 0.35);
  face(o, "smile", 0.35);
  face(o, "browUp", 0.6);
  face(o, "wide", 0.4);
  face(o, "lookY", -0.85);
}

export function evalClip(clip: Clip, c: ClipCtx, o: Float32Array): void {
  reset(o);
  switch (clip) {
    case "idle": idle(o, c); break;
    case "run": run(o, c); break;
    case "jump": jump(o, c); break;
    case "fall": fall(o, c); break;
    case "roll": roll(o, c); break;
    case "stumble": stumble(o, c); break;
    case "caught": caught(o, c); break;
    case "celebrate": celebrate(o, c); break;
    case "ride": ride(o, c); break;
    case "carried": carried(o, c); break;
  }
}

/** Landing absorb, added on top of the grounded clip for ~0.35 s after touching down. */
export function addLanding(o: Float32Array, tl: number, strength: number): void {
  const a = Math.sin(Math.min(1, tl / 0.07) * (Math.PI / 2)) * Math.exp(-Math.max(0, tl - 0.07) * 9) * strength;
  if (a < 1e-3) return;
  for (const side of SIDES) {
    const th = side < 0 ? B.thighL : B.thighR;
    const sh = side < 0 ? B.shinL : B.shinR;
    const ft = side < 0 ? B.footL : B.footR;
    o[th * 3] = (o[th * 3] ?? 0) + 0.5 * a;
    o[sh * 3] = (o[sh * 3] ?? 0) - 0.85 * a;
    o[ft * 3] = (o[ft * 3] ?? 0) + 0.3 * a;
    const ar = side < 0 ? B.armL : B.armR;
    o[ar * 3] = (o[ar * 3] ?? 0) + 0.25 * a;
    o[ar * 3 + 2] = (o[ar * 3 + 2] ?? 0) + side * 0.25 * a;
  }
  o[B.spine * 3] = (o[B.spine * 3] ?? 0) - 0.25 * a;
  o[B.chest * 3] = (o[B.chest * 3] ?? 0) - 0.1 * a;
  o[B.head * 3] = (o[B.head * 3] ?? 0) + 0.25 * a;
  o[FACE + FX.squint] = (o[FACE + FX.squint] ?? 0) + 0.5 * a;
  o[FACE + FX.grit] = (o[FACE + FX.grit] ?? 0) + 0.3 * a;
}
