/**
 * The two characters: the runner (who left without paying) and the angry waiter.
 * Chunky stylised figures with a joint hierarchy animated in code. Each body part is one merged,
 * vertex-coloured mesh whose geometry is shared by every instance of that character.
 */
import * as THREE from "three";
import type { Actor, ActorAnim } from "../contracts";
import { Builder, T, instance, xf } from "./geom";
import { GLOW, SKIN } from "./materials";

// ---------------------------------------------------------------------------
// Proportions (metres)
// ---------------------------------------------------------------------------

const HIP_Y = 0.88;
const THIGH = 0.43;
const SHIN = 0.45; // knee to sole
const TORSO = 0.5;
const UPPER_ARM = 0.28;
const FOREARM = 0.3;
const SHOULDER_X = 0.25;
const HIP_X = 0.11;
const SPIN_Y = 0.38;

type Kind = "runner" | "waiter";

interface Palette {
  skin: number;
  top: number;
  topDark: number;
  sleeve: number;
  bottom: number;
  shoe: number;
  sole: number;
  hair: number;
}

const RUNNER: Palette = {
  skin: 0xe0a77c,
  top: 0xff6a13,
  topDark: 0xd14f05,
  sleeve: 0xff6a13,
  bottom: 0x2f5d9b,
  shoe: 0xf4f4f4,
  sole: 0xf4f4f4,
  hair: 0x3a2416,
};

const WAITER: Palette = {
  skin: 0xe8b28e,
  top: 0x1c1c22,
  topDark: 0x111114,
  sleeve: 0xfbfbf8,
  bottom: 0x1b1b20,
  shoe: 0x111111,
  sole: 0x2a2a2a,
  hair: 0x2b2420,
};

// ---------------------------------------------------------------------------
// Part geometry (cached per character kind)
// ---------------------------------------------------------------------------

type PartName = "pelvis" | "torso" | "head" | "upperArmL" | "upperArmR" | "forearmL" | "forearmR" | "thigh" | "shin" | "apron" | "apronLow" | "scooter";

const partCache = new Map<string, THREE.Group>();

function part(kind: Kind, name: PartName): THREE.Group {
  const key = `${kind}:${name}`;
  let tpl = partCache.get(key);
  if (!tpl) {
    const b = new Builder();
    buildPart(b, kind, name);
    tpl = b.build(true);
    partCache.set(key, tpl);
  }
  return instance(tpl);
}

function buildPart(b: Builder, kind: Kind, name: PartName): void {
  const p = kind === "runner" ? RUNNER : WAITER;
  const waiter = kind === "waiter";
  switch (name) {
    case "pelvis": {
      // shorts / trousers seat, slightly wider than the hips
      b.sphere(0, 0.02, 0, 0.21, 0.15, 0.15, p.bottom, SKIN, 10, 6);
      if (!waiter) {
        b.box(0, 0.1, 0, 0.36, 0.05, 0.25, 0x222222, SKIN); // waistband
      } else {
        b.box(0, 0.1, 0, 0.38, 0.06, 0.27, 0xf4f1ea, SKIN); // apron string
      }
      break;
    }
    case "torso": {
      if (!waiter) {
        // hoodie body
        b.add(T.capsule(0.9, 4, 10), xf(0, 0.27, 0, 0.21, 0.17, 0.15), p.top, SKIN);
        b.box(0, 0.08, -0.14, 0.24, 0.12, 0.04, p.topDark, SKIN); // kangaroo pocket
        b.box(0, 0.03, 0, 0.4, 0.06, 0.29, p.topDark, SKIN); // hem
        // hood bundled on the back: very readable from the chase cam
        b.sphere(0, 0.47, 0.11, 0.15, 0.1, 0.09, p.topDark, SKIN, 10, 6);
        // white back print: stripes
        b.box(0, 0.3, 0.155, 0.3, 0.05, 0.01, 0xffffff, SKIN);
        b.box(0, 0.22, 0.155, 0.3, 0.05, 0.01, 0x1e88e5, SKIN);
        // drawstrings
        b.box(-0.04, 0.38, -0.155, 0.015, 0.1, 0.01, 0xffffff, SKIN);
        b.box(0.04, 0.38, -0.155, 0.015, 0.1, 0.01, 0xffffff, SKIN);
      } else {
        // white shirt under black waistcoat, slight belly
        b.add(T.capsule(0.8, 4, 10), xf(0, 0.27, 0, 0.22, 0.18, 0.165), p.sleeve, SKIN);
        b.add(T.capsule(0.75, 4, 10), xf(0, 0.24, 0.005, 0.227, 0.17, 0.168), p.top, SKIN);
        b.sphere(0, 0.12, -0.04, 0.2, 0.15, 0.16, p.top, SKIN, 10, 6); // belly
        // shirt V and buttons
        b.add(T.box, xf(0, 0.4, -0.165, 0.07, 0.12, 0.02, 0, 0, Math.PI / 4), p.sleeve, SKIN);
        for (let i = 0; i < 3; i++) b.box(0.035, 0.22 - i * 0.07, -0.2, 0.025, 0.025, 0.02, 0xd8c070, SKIN);
        // bow tie
        b.add(T.cone(4), xf(-0.045, 0.47, -0.17, 0.045, 0.06, 0.02, 0, 0, Math.PI / 2), 0x111111, SKIN);
        b.add(T.cone(4), xf(0.045, 0.47, -0.17, 0.045, 0.06, 0.02, 0, 0, -Math.PI / 2), 0x111111, SKIN);
        b.box(0, 0.47, -0.175, 0.03, 0.03, 0.02, 0x222222, SKIN);
        // shirt collar
        b.cyl(0, 0.46, 0, 0.09, 0.06, p.sleeve, 10, SKIN);
      }
      // neck
      b.cyl(0, 0.46, 0, 0.065, 0.1, p.skin, 8, SKIN);
      break;
    }
    case "head": {
      // head centre at y = 0.2 above the neck joint
      b.sphere(0, 0.2, 0, 0.19, 0.2, 0.185, p.skin, SKIN, 14, 10);
      b.sphere(-0.185, 0.2, 0, 0.035, 0.05, 0.03, p.skin, SKIN, 6, 4);
      b.sphere(0.185, 0.2, 0, 0.035, 0.05, 0.03, p.skin, SKIN, 6, 4);
      // eyes and nose (face looks towards -Z)
      b.sphere(-0.065, 0.22, -0.168, 0.028, 0.036, 0.015, 0x1a1a1a, SKIN, 6, 4);
      b.sphere(0.065, 0.22, -0.168, 0.028, 0.036, 0.015, 0x1a1a1a, SKIN, 6, 4);
      b.sphere(0, 0.17, -0.19, 0.03, 0.04, 0.03, p.skin, SKIN, 6, 4);
      if (!waiter) {
        // hair + cap (blue, peak forward)
        b.add(T.dome(12, 5), xf(0, 0.22, 0.015, 0.2, 0.19, 0.2), p.hair, SKIN);
        b.add(T.dome(12, 5), xf(0, 0.25, 0, 0.205, 0.16, 0.205), 0x1e88e5, SKIN);
        b.box(0, 0.255, -0.24, 0.24, 0.025, 0.14, 0x1565c0, SKIN, 0); // peak
        b.box(0, 0.26, 0.19, 0.1, 0.03, 0.03, 0xffffff, SKIN); // strap gap
        b.sphere(0, 0.41, 0, 0.03, 0.02, 0.03, 0xffffff, SKIN, 6, 3);
        // smile
        b.box(0, 0.11, -0.172, 0.07, 0.015, 0.01, 0x8a3b2a, SKIN);
        // eyebrows (worried)
        b.add(T.box, xf(-0.065, 0.275, -0.17, 0.06, 0.014, 0.01, 0, 0, -0.25), p.hair, SKIN);
        b.add(T.box, xf(0.065, 0.275, -0.17, 0.06, 0.014, 0.01, 0, 0, 0.25), p.hair, SKIN);
      } else {
        // bald crown, dark hair at the sides and back
        b.add(T.sphere(12, 8), xf(0, 0.19, 0.03, 0.195, 0.14, 0.17), p.hair, SKIN);
        b.sphere(0, 0.28, -0.01, 0.17, 0.13, 0.165, p.skin, SKIN, 12, 8);
        // big moustache
        b.add(T.capsule(1.2, 3, 8), xf(-0.05, 0.12, -0.185, 0.03, 0.03, 0.025, 0, 0, 1.25), 0x1d1712, SKIN);
        b.add(T.capsule(1.2, 3, 8), xf(0.05, 0.12, -0.185, 0.03, 0.03, 0.025, 0, 0, -1.25), 0x1d1712, SKIN);
        // angry eyebrows (V shape) and frown
        b.add(T.box, xf(-0.065, 0.27, -0.172, 0.085, 0.028, 0.02, 0, 0, -0.45), 0x1d1712, SKIN);
        b.add(T.box, xf(0.065, 0.27, -0.172, 0.085, 0.028, 0.02, 0, 0, 0.45), 0x1d1712, SKIN);
        b.box(0, 0.07, -0.172, 0.06, 0.016, 0.01, 0x6b2a20, SKIN);
        // red angry cheeks
        b.sphere(-0.11, 0.16, -0.14, 0.035, 0.025, 0.02, 0xe0705a, SKIN, 6, 4);
        b.sphere(0.11, 0.16, -0.14, 0.035, 0.025, 0.02, 0xe0705a, SKIN, 6, 4);
      }
      break;
    }
    case "upperArmL":
    case "upperArmR": {
      const sleeve = waiter ? p.sleeve : p.sleeve;
      b.limb(0, 0.04, 0, 0.068, UPPER_ARM + 0.06, sleeve, SKIN);
      if (!waiter) b.box(0, -0.06, 0.065, 0.02, 0.18, 0.01, 0xffffff, SKIN); // sleeve stripe
      break;
    }
    case "forearmL":
    case "forearmR": {
      const left = name === "forearmL";
      if (waiter) {
        // rolled-up white sleeve then forearm skin
        b.cyl(0, -0.09, 0, 0.068, 0.09, p.sleeve, 8, SKIN);
        b.limb(0, 0, 0, 0.055, FOREARM - 0.05, p.skin, SKIN);
      } else {
        b.limb(0, 0.02, 0, 0.062, FOREARM - 0.05, p.sleeve, SKIN);
        b.cyl(0, -FOREARM + 0.07, 0, 0.066, 0.05, p.topDark, 8, SKIN); // cuff
      }
      // hand (mitt)
      b.sphere(0, -FOREARM, 0, 0.06, 0.075, 0.05, p.skin, SKIN, 8, 6);
      if (waiter && !left) {
        // the unpaid bill ("la cuenta"): a long white paper strip with printed lines
        b.add(T.box, xf(0, -FOREARM - 0.13, -0.05, 0.12, 0.26, 0.008, 0.15, 0, 0), 0xfffdf2, SKIN);
        for (let i = 0; i < 6; i++) {
          b.add(T.box, xf(0, -FOREARM - 0.04 - i * 0.032, -0.06, 0.08, 0.008, 0.006, 0.15, 0, 0), 0x666666, SKIN);
        }
        b.add(T.box, xf(0.02, -FOREARM - 0.24, -0.07, 0.06, 0.016, 0.006, 0.15, 0, 0), 0xc62828, SKIN);
      }
      if (waiter && left) {
        // tea towel draped over the forearm
        b.add(T.box, xf(0, -0.12, 0, 0.16, 0.06, 0.16), 0xf6f1e6, SKIN);
        b.add(T.box, xf(0.085, -0.24, 0, 0.012, 0.24, 0.15), 0xf6f1e6, SKIN);
        b.add(T.box, xf(0.087, -0.27, 0, 0.012, 0.025, 0.152), 0xc62828, SKIN);
        b.add(T.box, xf(0.087, -0.32, 0, 0.012, 0.025, 0.152), 0xc62828, SKIN);
      }
      break;
    }
    case "thigh": {
      if (waiter) {
        b.limb(0, 0.06, 0, 0.095, THIGH + 0.08, p.bottom, SKIN);
      } else {
        b.limb(0, 0.05, 0, 0.1, THIGH * 0.72, p.bottom, SKIN); // shorts leg
        b.limb(0, -THIGH * 0.5, 0, 0.075, THIGH * 0.55, p.skin, SKIN);
      }
      break;
    }
    case "shin": {
      if (waiter) {
        b.limb(0, 0.03, 0, 0.082, SHIN - 0.08, p.bottom, SKIN);
      } else {
        b.limb(0, 0.03, 0, 0.068, SHIN - 0.12, p.skin, SKIN);
        b.cyl(0, -SHIN + 0.09, 0, 0.066, 0.08, 0xffffff, 8, SKIN); // sock
      }
      // shoe: sole at y = -SHIN
      b.add(T.capsule(1.4, 3, 8), xf(0, -SHIN + 0.06, -0.06, 0.075, 0.06, 0.065, Math.PI / 2, 0, 0), p.shoe, SKIN);
      b.box(0, -SHIN + 0.015, -0.06, 0.13, 0.03, 0.26, p.sole, SKIN);
      if (!waiter) b.box(0.076, -SHIN + 0.07, -0.05, 0.01, 0.04, 0.14, 0xe53935, SKIN); // swoosh-ish stripe
      break;
    }
    case "apron": {
      // long white bistro apron, upper panel (pivot at the waist front), slightly rounded
      b.add(T.box, xf(0, -0.16, -0.02, 0.42, 0.34, 0.022), 0xf8f6ef, SKIN);
      b.add(T.box, xf(0.1, -0.2, -0.035, 0.12, 0.1, 0.01), 0xeeeae0, SKIN); // pocket
      break;
    }
    case "apronLow": {
      // lower panel, hinged at the upper panel's hem; flares a little as it swings
      b.add(T.box, xf(0, -0.15, -0.02, 0.44, 0.3, 0.02), 0xf8f6ef, SKIN);
      b.box(0, -0.29, -0.02, 0.44, 0.025, 0.028, 0xe6e1d3, SKIN);
      break;
    }
    case "scooter": {
      // electric scooter (patinete), deck top at 0.18, stem at the front (-Z)
      b.box(0, 0.12, 0.02, 0.2, 0.06, 0.86, 0x1d1f24, SKIN);
      b.box(0, 0.155, 0.02, 0.17, 0.012, 0.8, 0x2e3138, SKIN); // grip tape
      b.box(0.101, 0.12, 0.02, 0.005, 0.03, 0.7, 0x18c29c, SKIN);
      b.box(-0.101, 0.12, 0.02, 0.005, 0.03, 0.7, 0x18c29c, SKIN);
      b.add(T.cyl(10), xf(0, 0.1, -0.44, 0.1, 0.06, 0.1, 0, 0, Math.PI / 2), 0x111111, SKIN);
      b.add(T.cyl(10), xf(0, 0.1, 0.46, 0.1, 0.06, 0.1, 0, 0, Math.PI / 2), 0x111111, SKIN);
      b.add(T.cyl(8), xf(0, 0.1, -0.44, 0.05, 0.065, 0.05, 0, 0, Math.PI / 2), 0x18c29c, SKIN);
      b.add(T.cyl(8), xf(0, 0.1, 0.46, 0.05, 0.065, 0.05, 0, 0, Math.PI / 2), 0x18c29c, SKIN);
      b.beam([0, 0.12, -0.4], [0, 1.05, -0.5], 0.045, 0x2e3138, SKIN, 8);
      b.beam([-0.26, 1.05, -0.5], [0.26, 1.05, -0.5], 0.035, 0x1d1f24, SKIN, 8);
      b.add(T.cyl(8), xf(-0.27, 1.05, -0.5, 0.03, 0.12, 0.03, 0, 0, Math.PI / 2), 0x18c29c, SKIN);
      b.add(T.cyl(8), xf(0.27, 1.05, -0.5, 0.03, 0.12, 0.03, 0, 0, Math.PI / 2), 0x18c29c, SKIN);
      b.box(0, 0.88, -0.5, 0.08, 0.06, 0.05, 0xffffff, GLOW); // headlight
      b.box(0, 0.2, 0.48, 0.12, 0.03, 0.04, 0xff2a2a, GLOW); // rear light
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------

const POSE_KEYS = [
  "hipY", "hipZ", "lean", "twist", "spine", "spineZ", "headX", "headY",
  "shLX", "shLZ", "shRX", "shRZ", "elL", "elR", "thLX", "thLZ", "thRX", "thRZ", "knL", "knR", "scale",
] as const;
type PoseKey = (typeof POSE_KEYS)[number];
type Pose = Record<PoseKey, number>;

function basePose(): Pose {
  return {
    hipY: HIP_Y, hipZ: 0, lean: 0, twist: 0, spine: 0, spineZ: 0, headX: 0, headY: 0,
    shLX: 0, shLZ: 0.12, shRX: 0, shRZ: 0.12, elL: 0.2, elR: 0.2, thLX: 0, thLZ: 0.03, thRX: 0, thRZ: 0.03,
    knL: 0.05, knR: 0.05, scale: 1,
  };
}

const smooth = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

function targetPose(kind: Kind, anim: ActorAnim | "ride", t: number, phase: number, p: Pose): void {
  Object.assign(p, basePose());
  const waiter = kind === "waiter";
  switch (anim) {
    case "idle": {
      const breath = Math.sin(t * 2.2);
      p.spine = 0.04 + breath * 0.025;
      p.hipY = HIP_Y - 0.02;
      p.knL = p.knR = 0.12;
      p.thLX = p.thRX = 0.06;
      if (!waiter) {
        // nervously looking back over the shoulder every few seconds
        const cyc = t % 4.2;
        const look = smooth((cyc - 1.6) / 0.35) * (1 - smooth((cyc - 3.0) / 0.4));
        const side = Math.floor(t / 4.2) % 2 ? 1 : -1;
        p.headY = side * 1.25 * look;
        p.twist = side * 0.35 * look;
        p.headX = -0.1 * look;
        p.shLZ = p.shRZ = 0.16;
        p.elL = p.elR = 0.35;
        p.hipY += Math.sin(t * 5) * 0.004; // fidget bounce
      } else {
        // hands on hips, foot tapping, head shaking
        p.shLZ = p.shRZ = 0.75;
        p.shLX = p.shRX = -0.25;
        p.elL = p.elR = 1.9;
        p.headY = Math.sin(t * 3) * 0.25;
        p.thRX = 0.15;
        p.knR = 0.2 + Math.max(0, Math.sin(t * 7)) * 0.25;
      }
      break;
    }
    case "run":
    case "stumble": {
      const s = Math.sin(phase);
      const c = Math.cos(phase);
      p.thLX = 0.8 * s + 0.12;
      p.thRX = -0.8 * s + 0.12;
      p.knL = 0.35 + 1.15 * (0.5 + 0.5 * Math.cos(phase - 0.9));
      p.knR = 0.35 + 1.15 * (0.5 - 0.5 * Math.cos(phase - 0.9));
      p.hipY = HIP_Y - 0.06 + 0.07 * Math.abs(c);
      p.lean = 0.16;
      p.spine = 0.1;
      p.twist = 0.14 * s;
      p.headX = -0.1;
      p.headY = -0.12 * s;
      p.shLX = -0.85 * s + 0.1;
      p.shRX = 0.85 * s + 0.1;
      p.shLZ = p.shRZ = 0.16;
      p.elL = 1.35 + 0.25 * s;
      p.elR = 1.35 - 0.25 * s;
      if (waiter) {
        // the right arm is raised, shaking the bill
        p.shRX = 2.75 + 0.18 * Math.sin(t * 17);
        p.shRZ = 0.32 + 0.12 * Math.sin(t * 13);
        p.elR = 0.35 + 0.2 * Math.sin(t * 17 + 1);
        p.lean = 0.22;
      }
      if (anim === "stumble") {
        p.spine = 0.55;
        p.lean = 0.25;
        p.headX = -0.35;
        p.shLX = 1.6 + 1.1 * Math.sin(t * 14);
        p.shRX = 1.6 + 1.1 * Math.sin(t * 14 + 2.4);
        p.shLZ = 0.7 + 0.4 * Math.sin(t * 11);
        p.shRZ = 0.7 + 0.4 * Math.sin(t * 11 + 1.3);
        p.elL = p.elR = 0.5;
        p.thLX = 0.5 * Math.sin(t * 12) + 0.2;
        p.thRX = -0.5 * Math.sin(t * 12) + 0.2;
        p.knL = p.knR = 0.7;
        p.twist = 0.3 * Math.sin(t * 6);
      }
      break;
    }
    case "jump": {
      p.thLX = 1.25;
      p.knL = 1.9;
      p.thRX = 0.35;
      p.knR = 1.5;
      p.shLX = 2.5;
      p.shRX = waiter ? 2.9 : 2.3;
      p.shLZ = p.shRZ = 0.45;
      p.elL = p.elR = 0.35;
      p.spine = 0.05;
      p.headX = 0.15;
      break;
    }
    case "fall": {
      p.thLX = 0.45;
      p.knL = 0.5;
      p.thRX = -0.15;
      p.knR = 0.7;
      p.shLX = p.shRX = 0.6;
      p.shLZ = p.shRZ = 1.25 + Math.sin(t * 9) * 0.12;
      p.elL = p.elR = 0.4;
      p.spine = -0.08;
      p.headX = -0.2;
      break;
    }
    case "roll": {
      // tight forward tuck; the spin is applied separately around the ball centre
      p.hipY = SPIN_Y - 0.05;
      p.hipZ = 0.32;
      p.lean = 0.5;
      p.spine = 0.85;
      p.headX = 0.7;
      p.thLX = p.thRX = 2.35;
      p.thLZ = p.thRZ = 0.15;
      p.knL = p.knR = 2.55;
      p.shLX = p.shRX = 1.25;
      p.shLZ = p.shRZ = 0.25;
      p.elL = p.elR = 1.9;
      p.scale = 0.72;
      break;
    }
    case "caught": {
      p.shLX = p.shRX = 2.95;
      p.shLZ = p.shRZ = 0.35;
      p.elL = p.elR = 0.25;
      p.headX = 0.35;
      p.spine = 0.2;
      p.knL = p.knR = 0.25;
      p.thLX = p.thRX = 0.15;
      p.hipY = HIP_Y - 0.05;
      if (waiter) {
        // waiter version: grabbing forward
        p.shLX = p.shRX = 1.5;
        p.shLZ = p.shRZ = 0.1;
        p.elL = p.elR = 0.4;
        p.headX = -0.1;
        p.spine = 0.3;
      }
      break;
    }
    case "celebrate": {
      const hop = Math.abs(Math.sin(t * 5.5));
      p.hipY = HIP_Y + hop * 0.16;
      p.knL = p.knR = 0.3 + (1 - hop) * 0.3;
      p.thLX = p.thRX = 0.2 + (1 - hop) * 0.15;
      p.headX = -0.25;
      if (!waiter) {
        p.shLX = 2.8 + Math.sin(t * 11) * 0.25;
        p.shRX = 2.8 - Math.sin(t * 11) * 0.25;
        p.shLZ = p.shRZ = 0.5;
        p.elL = p.elR = 0.4;
      } else {
        // triumphant bill waving, left fist on the hip
        p.shRX = 2.95;
        p.shRZ = 0.35 + 0.45 * Math.sin(t * 9);
        p.elR = 0.3;
        p.shLZ = 0.8;
        p.shLX = -0.25;
        p.elL = 1.9;
      }
      break;
    }
    case "ride": {
      const sway = Math.sin(t * 2.5);
      p.thLX = 0.22;
      p.thRX = -0.25;
      p.knL = 0.3;
      p.knR = 0.35;
      p.lean = 0.12;
      p.spine = 0.08;
      p.shLX = p.shRX = 1.05;
      p.shLZ = p.shRZ = 0.2;
      p.elL = p.elR = 0.55;
      p.headX = -0.05;
      p.twist = sway * 0.05;
      p.spineZ = sway * 0.04;
      p.hipY = HIP_Y - 0.03;
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Actor assembly
// ---------------------------------------------------------------------------

interface Rig {
  lift: THREE.Group;
  spin: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  shL: THREE.Group;
  shR: THREE.Group;
  elL: THREE.Group;
  elR: THREE.Group;
  thL: THREE.Group;
  thR: THREE.Group;
  knL: THREE.Group;
  knR: THREE.Group;
  apron: THREE.Group | null;
  apronLow: THREE.Group | null;
}

function joint(parent: THREE.Object3D, x: number, y: number, z: number, ...meshes: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  for (const m of meshes) g.add(m);
  parent.add(g);
  return g;
}

function buildRig(kind: Kind, root: THREE.Group): Rig {
  const lift = joint(root, 0, 0, 0);
  const spin = joint(lift, 0, SPIN_Y, 0);
  const hips = joint(spin, 0, HIP_Y - SPIN_Y, 0, part(kind, "pelvis"));
  const torso = joint(hips, 0, 0.05, 0, part(kind, "torso"));
  const head = joint(torso, 0, TORSO + 0.02, 0, part(kind, "head"));
  const shL = joint(torso, -SHOULDER_X, TORSO - 0.08, 0, part(kind, "upperArmL"));
  const shR = joint(torso, SHOULDER_X, TORSO - 0.08, 0, part(kind, "upperArmR"));
  const elL = joint(shL, 0, -UPPER_ARM, 0, part(kind, "forearmL"));
  const elR = joint(shR, 0, -UPPER_ARM, 0, part(kind, "forearmR"));
  const thL = joint(hips, -HIP_X, 0, 0, part(kind, "thigh"));
  const thR = joint(hips, HIP_X, 0, 0, part(kind, "thigh"));
  const knL = joint(thL, 0, -THIGH, 0, part(kind, "shin"));
  const knR = joint(thR, 0, -THIGH, 0, part(kind, "shin"));
  const apron = kind === "waiter" ? joint(hips, 0, 0.08, -0.17, part(kind, "apron")) : null;
  const apronLow = apron ? joint(apron, 0, -0.33, 0, part(kind, "apronLow")) : null;
  return { lift, spin, hips, torso, head, shL, shR, elL, elR, thL, thR, knL, knR, apron, apronLow };
}

function applyPose(r: Rig, p: Pose): void {
  r.spin.scale.setScalar(p.scale);
  r.hips.position.set(0, p.hipY - SPIN_Y, p.hipZ);
  r.hips.rotation.set(-p.lean, p.twist, 0, "YXZ");
  r.torso.rotation.set(-p.spine, -p.twist * 0.6, p.spineZ, "YXZ");
  r.head.rotation.set(-p.headX, p.headY, 0, "YXZ");
  r.shL.rotation.set(p.shLX, 0, -p.shLZ, "XYZ");
  r.shR.rotation.set(p.shRX, 0, p.shRZ, "XYZ");
  r.elL.rotation.set(p.elL, 0, 0);
  r.elR.rotation.set(p.elR, 0, 0);
  r.thL.rotation.set(p.thLX, 0, -p.thLZ, "XYZ");
  r.thR.rotation.set(p.thRX, 0, p.thRZ, "XYZ");
  r.knL.rotation.set(-p.knL, 0, 0);
  r.knR.rotation.set(-p.knR, 0, 0);
  if (r.apron) {
    const fwd = Math.max(0, p.thLX, p.thRX);
    r.apron.rotation.x = fwd * 0.7;
    // the hem lags behind and folds back over the shin as the knee comes up
    if (r.apronLow) r.apronLow.rotation.x = fwd * 0.3 - 0.1 - Math.max(0, p.knL, p.knR) * 0.15;
  }
}

function shadows(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
}

function createActor(kind: Kind): Actor {
  const root = new THREE.Group();
  root.name = kind;
  const rig = buildRig(kind, root);
  let scooter: THREE.Group | null = null;
  if (kind === "runner") {
    scooter = part("runner", "scooter");
    scooter.visible = false;
    root.add(scooter);
  }
  shadows(root);

  const current = basePose();
  const target = basePose();
  let riding = false;
  let t = Math.random() * 10;
  let phase = 0;
  let spinAngle = 0;
  let lastAnim: ActorAnim = "idle";

  const actor: Actor = {
    root,
    update(dt, anim, speed) {
      const step = Math.min(dt, 0.1);
      t += step;
      const freq = 1.25 + Math.max(0, speed) * 0.075;
      phase += step * Math.PI * 2 * freq;
      const effective = riding && (anim === "run" || anim === "idle") ? "ride" : anim;
      targetPose(kind, effective, t, phase, target);
      // snappier blending into and within fast cycles
      const rate = anim === "run" || anim === "stumble" ? 22 : anim === "roll" ? 18 : 11;
      const k = anim !== lastAnim && lastAnim === "roll" ? 1 - Math.exp(-step * 14) : 1 - Math.exp(-step * rate);
      for (const key of POSE_KEYS) current[key] += (target[key] - current[key]) * k;
      lastAnim = anim;
      // the roll spin: keep spinning while rolling, finish the turn smoothly afterwards
      const TAU = Math.PI * 2;
      if (anim === "roll") {
        spinAngle -= step * TAU * 1.9;
      } else if (spinAngle !== 0) {
        const target2 = Math.floor(spinAngle / TAU) * TAU; // next full turn in the roll direction
        spinAngle = Math.max(target2, spinAngle - step * TAU * 2.2);
        if (spinAngle <= target2 + 1e-4) spinAngle = 0;
      }
      rig.spin.rotation.x = spinAngle;
      applyPose(rig, current);
      rig.lift.position.y = riding ? 0.17 : 0;
      rig.lift.scale.setScalar(0.96);
    },
  };
  if (scooter) {
    const sc = scooter;
    actor.setRiding = (on: boolean) => {
      riding = on;
      sc.visible = on;
    };
  }
  return actor;
}

export const createRunner = (): Actor => createActor("runner");
export const createWaiter = (): Actor => createActor("waiter");
