/**
 * Runner outfits (cosmetic): the same body parts and rig as the classic runner, re-dressed with
 * other colours and a few extra shapes. Every part is one merged vertex-coloured mesh.
 * Designs are generic (no real club crests or trademarks).
 */
import type { OutfitId } from "../contracts";
import { T, xf, type Builder } from "./geom";
import { SKIN } from "./materials";
import { FOREARM, SHIN, THIGH } from "./proportions";

export type BodyPart = "pelvis" | "torso" | "head" | "upperArmL" | "upperArmR" | "forearmL" | "forearmR" | "thigh" | "shin";

const SKIN_TONE = 0xe0a77c;
const HAIR = 0x3a2416;

// --- shared body shapes ---------------------------------------------------

function pelvis(b: Builder, c: number): void {
  b.sphere(0, 0.02, 0, 0.21, 0.15, 0.15, c, SKIN, 10, 6);
}
function torso(b: Builder, c: number): void {
  b.add(T.capsule(0.9, 4, 10), xf(0, 0.27, 0, 0.21, 0.17, 0.15), c, SKIN);
}
function neck(b: Builder, c = SKIN_TONE): void {
  b.cyl(0, 0.46, 0, 0.065, 0.1, c, 8, SKIN);
}
function face(b: Builder, skin = SKIN_TONE): void {
  b.sphere(0, 0.2, 0, 0.19, 0.2, 0.185, skin, SKIN, 14, 10);
  b.sphere(-0.185, 0.2, 0, 0.035, 0.05, 0.03, skin, SKIN, 6, 4);
  b.sphere(0.185, 0.2, 0, 0.035, 0.05, 0.03, skin, SKIN, 6, 4);
  b.sphere(-0.065, 0.22, -0.168, 0.028, 0.036, 0.015, 0x1a1a1a, SKIN, 6, 4);
  b.sphere(0.065, 0.22, -0.168, 0.028, 0.036, 0.015, 0x1a1a1a, SKIN, 6, 4);
  b.sphere(0, 0.17, -0.19, 0.03, 0.04, 0.03, skin, SKIN, 6, 4);
  b.box(0, 0.11, -0.172, 0.07, 0.015, 0.01, 0x8a3b2a, SKIN);
}
function hair(b: Builder, c = HAIR): void {
  b.add(T.dome(12, 5), xf(0, 0.22, 0.015, 0.2, 0.19, 0.2), c, SKIN);
}
function upperArm(b: Builder, c: number): void {
  b.limb(0, 0.04, 0, 0.068, 0.34, c, SKIN);
}
function shortSleeve(b: Builder, c: number): void {
  b.limb(0, 0.04, 0, 0.074, 0.18, c, SKIN);
  b.limb(0, -0.08, 0, 0.058, 0.24, SKIN_TONE, SKIN);
}
function forearm(b: Builder, c: number, hand = SKIN_TONE): void {
  b.limb(0, 0.02, 0, 0.06, FOREARM - 0.05, c, SKIN);
  b.sphere(0, -FOREARM, 0, 0.06, 0.075, 0.05, hand, SKIN, 8, 6);
}
function thigh(b: Builder, c: number, lower = c): void {
  b.limb(0, 0.05, 0, 0.1, THIGH * 0.72, c, SKIN);
  b.limb(0, -THIGH * 0.5, 0, 0.078, THIGH * 0.55, lower, SKIN);
}
function shin(b: Builder, leg: number, sock: number, shoe: number, sole = 0xf4f4f4): void {
  b.limb(0, 0.03, 0, 0.068, SHIN - 0.12, leg, SKIN);
  b.cyl(0, -SHIN + 0.09, 0, 0.066, 0.08, sock, 8, SKIN);
  b.add(T.capsule(1.4, 3, 8), xf(0, -SHIN + 0.06, -0.06, 0.075, 0.06, 0.065, Math.PI / 2, 0, 0), shoe, SKIN);
  b.box(0, -SHIN + 0.015, -0.06, 0.13, 0.03, 0.26, sole, SKIN);
}

/** Points on the torso capsule surface (front z < 0, back z > 0) for painted-on details. */
function surfZ(x: number, back: boolean, depth = 0.15, half = 0.21): number {
  const k = Math.max(0, 1 - (x / half) ** 2);
  return (back ? 1 : -1) * (depth * Math.sqrt(k) + 0.006);
}

// --- outfits ----------------------------------------------------------------

function futbolera(b: Builder, part: BodyPart): void {
  const black = 0x161616;
  const white = 0xf6f6f2;
  switch (part) {
    case "pelvis": pelvis(b, black); b.box(0, 0.1, 0, 0.36, 0.05, 0.25, black, SKIN); break;
    case "torso": {
      torso(b, white);
      // vertical black stripes front and back
      for (const x of [-0.15, -0.05, 0.05, 0.15]) {
        for (const back of [false, true]) b.box(x, 0.24, surfZ(x, back), 0.05, 0.46, 0.012, black, SKIN);
      }
      b.box(0, 0.03, 0, 0.4, 0.06, 0.29, black, SKIN);
      // striped scarf round the neck, one end hanging down the back
      b.add(T.torus(Math.PI * 2, 0.4, 6, 12), xf(0, 0.47, 0, 0.1, 0.1, 0.09, Math.PI / 2, 0, 0), white, SKIN);
      for (let k = 0; k < 4; k++) b.box(0.06, 0.4 - k * 0.07, 0.165, 0.07, 0.06, 0.02, k % 2 ? white : black, SKIN);
      neck(b);
      break;
    }
    case "head": face(b); hair(b, 0x1f140c); b.add(T.dome(12, 4), xf(0, 0.25, 0, 0.195, 0.12, 0.2), 0x1f140c, SKIN); break;
    case "upperArmL": case "upperArmR": shortSleeve(b, white); b.box(0, 0.0, 0.07, 0.02, 0.14, 0.01, black, SKIN); break;
    case "forearmL": case "forearmR": forearm(b, SKIN_TONE); break;
    case "thigh": thigh(b, black, SKIN_TONE); break;
    case "shin": shin(b, black, white, black); b.cyl(0, -0.05, 0, 0.071, 0.05, white, 8, SKIN); break;
  }
}

function feria(b: Builder, part: BodyPart): void {
  const red = 0xd7192a;
  const white = 0xfbf6ee;
  const dots = (x0: number, y0: number, z: (x: number) => number, n: number, m: number): void => {
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const x = x0 + i * 0.09 + (j % 2) * 0.045;
      b.sphere(x, y0 + j * 0.09, z(x), 0.022, 0.022, 0.008, white, SKIN, 5, 3);
    }
  };
  switch (part) {
    case "pelvis": {
      // ruffled short skirt (falda-short) in red with white frills
      b.add(T.frustum(0.75, 12), xf(0, -0.04, 0, 0.27, 0.22, 0.21), red, SKIN);
      b.add(T.torus(Math.PI * 2, 0.28, 5, 16), xf(0, -0.15, 0, 0.27, 0.27, 0.21, Math.PI / 2, 0, 0), white, SKIN);
      b.add(T.torus(Math.PI * 2, 0.25, 5, 16), xf(0, -0.04, 0, 0.23, 0.23, 0.18, Math.PI / 2, 0, 0), red, SKIN);
      break;
    }
    case "torso": {
      torso(b, red);
      dots(-0.14, 0.08, (x) => surfZ(x, false), 4, 4);
      dots(-0.14, 0.08, (x) => surfZ(x, true), 4, 4);
      // ruffle on the neckline and a fringed shawl knot at the back
      b.add(T.torus(Math.PI * 2, 0.3, 5, 14), xf(0, 0.43, 0, 0.14, 0.14, 0.11, Math.PI / 2, 0, 0), white, SKIN);
      b.add(T.cone(4), xf(0, 0.28, 0.165, 0.12, 0.2, 0.02, Math.PI, 0, 0), 0x1d1d1d, SKIN);
      neck(b);
      break;
    }
    case "head": {
      face(b);
      // sleek black hair in a bun with a red carnation (clavel) and a comb (peineta)
      b.add(T.dome(12, 5), xf(0, 0.22, 0.01, 0.2, 0.2, 0.2), 0x141010, SKIN);
      b.sphere(0, 0.25, 0.2, 0.09, 0.08, 0.07, 0x141010, SKIN, 8, 6);
      b.blob(0.13, 0.36, 0.05, 0.075, 0.06, 0.075, 0xe0112b, SKIN);
      b.blob(0.13, 0.385, 0.05, 0.05, 0.04, 0.05, 0xff3348, SKIN);
      b.box(0.17, 0.33, 0.07, 0.06, 0.02, 0.05, 0x2f8a3a, SKIN);
      b.box(0, 0.36, 0.16, 0.16, 0.08, 0.02, 0xf2e2b6, SKIN);
      b.sphere(-0.19, 0.12, -0.01, 0.025, 0.025, 0.025, 0xf2c14e, SKIN, 5, 3);
      b.sphere(0.19, 0.12, -0.01, 0.025, 0.025, 0.025, 0xf2c14e, SKIN, 5, 3);
      break;
    }
    case "upperArmL": case "upperArmR":
      shortSleeve(b, red);
      b.add(T.torus(Math.PI * 2, 0.35, 5, 12), xf(0, -0.1, 0, 0.08, 0.08, 0.08, Math.PI / 2, 0, 0), white, SKIN);
      break;
    case "forearmL": case "forearmR": forearm(b, SKIN_TONE); break;
    case "thigh": thigh(b, SKIN_TONE); break;
    case "shin": shin(b, SKIN_TONE, SKIN_TONE, red, 0x3a1a10); break;
  }
}

function carnaval(b: Builder, part: BodyPart): void {
  const colours = [0x7b2ff7, 0xffd60a, 0x00b894, 0xff006e];
  switch (part) {
    case "pelvis": pelvis(b, 0x7b2ff7); b.box(0, 0.1, 0, 0.37, 0.06, 0.26, 0xffd60a, SKIN); break;
    case "torso": {
      torso(b, 0xffd60a);
      // harlequin diamonds front and back
      for (const back of [false, true]) {
        let k = 0;
        for (const y of [0.12, 0.27, 0.42]) for (const x of [-0.11, 0, 0.11]) {
          if (y > 0.4 && Math.abs(x) > 0.05) continue;
          b.add(T.box, xf(x, y, surfZ(x, back, 0.15, 0.22), 0.09, 0.09, 0.012, 0, 0, Math.PI / 4), colours[(k++ + (back ? 1 : 0)) % 4] ?? 0x7b2ff7, SKIN);
        }
      }
      // glittering ruff collar
      b.add(T.torus(Math.PI * 2, 0.45, 6, 16), xf(0, 0.46, 0, 0.17, 0.17, 0.14, Math.PI / 2, 0, 0), 0xf5d76e, SKIN);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        b.sphere(Math.cos(a) * 0.2, 0.48, Math.sin(a) * 0.16, 0.025, 0.025, 0.025, k % 2 ? 0xffffff : 0xff4fd8, SKIN, 4, 3);
      }
      neck(b);
      break;
    }
    case "head": {
      face(b);
      b.box(-0.065, 0.27, -0.17, 0.08, 0.06, 0.01, 0x7b2ff7, SKIN); // face paint
      hair(b, 0x2b1a10);
      // feathered murga hat: low crown, wide band, three tall feathers
      b.cyl(0, 0.3, 0, 0.21, 0.04, 0x7b2ff7, 14, SKIN);
      b.cyl(0, 0.33, 0, 0.16, 0.1, 0x7b2ff7, 12, SKIN, 0.15);
      b.cyl(0, 0.33, 0, 0.165, 0.035, 0xffd60a, 12, SKIN);
      ([[-0.07, 0xff006e], [0, 0x00b894], [0.07, 0xffd60a]] as const).forEach(([x, c], i) => {
        b.add(T.sphere(6, 4), xf(x, 0.48, 0.02 - i * 0.01, 0.035, 0.12, 0.02, 0.3, 0, -x * 3), c, SKIN);
      });
      break;
    }
    case "upperArmL": upperArm(b, 0x00b894); b.box(0, -0.04, 0.07, 0.02, 0.15, 0.01, 0xffd60a, SKIN); break;
    case "upperArmR": upperArm(b, 0xff006e); b.box(0, -0.04, 0.07, 0.02, 0.15, 0.01, 0xffd60a, SKIN); break;
    case "forearmL": forearm(b, 0xff006e, 0xffffff); break;
    case "forearmR": forearm(b, 0x00b894, 0xffffff); break;
    case "thigh": thigh(b, 0x7b2ff7, 0xffd60a); break;
    case "shin": shin(b, 0xffd60a, 0x7b2ff7, 0xf5d76e, 0x7b2ff7); break;
  }
}

function romano(b: Builder, part: BodyPart): void {
  const white = 0xf8f5ec;
  const purple = 0x6a1b9a;
  const leather = 0x8a5a2b;
  switch (part) {
    case "pelvis": {
      // tunic skirt to above the knee, purple hem
      b.add(T.frustum(0.8, 12), xf(0, -0.08, 0, 0.27, 0.3, 0.2), white, SKIN);
      b.add(T.torus(Math.PI * 2, 0.12, 4, 14), xf(0, -0.22, 0, 0.265, 0.265, 0.2, Math.PI / 2, 0, 0), purple, SKIN);
      b.box(0, 0.08, 0, 0.38, 0.05, 0.27, 0xd9b44a, SKIN); // belt
      break;
    }
    case "torso": {
      torso(b, white);
      // the toga draped over the left shoulder, with the purple band across chest and back
      for (const back of [false, true]) b.add(T.box, xf(0, 0.25, surfZ(0, back) * 0.98, 0.07, 0.6, 0.012, 0, 0, back ? -0.7 : 0.7), purple, SKIN);
      b.sphere(-0.17, 0.42, 0, 0.11, 0.08, 0.15, white, SKIN, 8, 5);
      b.add(T.box, xf(-0.12, 0.2, 0.16, 0.12, 0.42, 0.03, 0, 0, 0.25), 0xefeadc, SKIN);
      neck(b);
      break;
    }
    case "head": {
      face(b);
      hair(b, 0x4a2c16);
      // laurel wreath
      b.add(T.torus(Math.PI * 2, 0.12, 4, 16), xf(0, 0.29, 0.01, 0.2, 0.2, 0.2, Math.PI / 2 + 0.15, 0, 0), 0x5f8f2f, SKIN);
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        if (Math.abs(Math.sin(a)) > 0.92 && Math.cos(a) < 0) continue;
        b.add(T.sphere(5, 3), xf(Math.cos(a) * 0.2, 0.3 + Math.sin(a) * 0.03, Math.sin(a) * 0.2, 0.035, 0.015, 0.06, 0, -a, 0.5), k % 2 ? 0x6fae3a : 0x4f8a2a, SKIN);
      }
      break;
    }
    case "upperArmL": upperArm(b, white); break;
    case "upperArmR": b.limb(0, 0.04, 0, 0.07, 0.14, white, SKIN); b.limb(0, -0.06, 0, 0.058, 0.26, SKIN_TONE, SKIN); break;
    case "forearmL": case "forearmR": forearm(b, SKIN_TONE); b.cyl(0, -0.24, 0, 0.064, 0.05, 0xd9b44a, 8, SKIN); break;
    case "thigh": thigh(b, SKIN_TONE); break;
    case "shin": {
      // bare legs with criss-cross sandal straps
      shin(b, SKIN_TONE, SKIN_TONE, leather, 0x5a3a1a);
      for (const y of [-0.12, -0.2, -0.28]) b.cyl(0, y, 0, 0.071, 0.025, leather, 8, SKIN);
      break;
    }
  }
}

function cigueno(b: Builder, part: BodyPart): void {
  const white = 0xfbfbf7;
  const black = 0x161616;
  const red = 0xe23b24;
  switch (part) {
    case "pelvis": {
      pelvis(b, white);
      // little black tail feathers
      for (const x of [-0.07, 0, 0.07]) b.add(T.box, xf(x, -0.02, 0.17, 0.06, 0.02, 0.16, -0.5, 0, 0), black, SKIN);
      break;
    }
    case "torso": {
      torso(b, white);
      b.box(0, 0.03, 0, 0.4, 0.06, 0.29, 0xe9e9e2, SKIN);
      // zip and fluffy chest
      b.box(0, 0.25, surfZ(0, false), 0.015, 0.4, 0.01, 0xcfcfc8, SKIN);
      b.sphere(0, 0.35, -0.1, 0.13, 0.1, 0.08, white, SKIN, 8, 5);
      neck(b, white);
      break;
    }
    case "head": {
      face(b);
      // white hood with a long red beak sticking out over the forehead and stork eyes
      b.add(T.sphere(12, 8), xf(0, 0.22, 0.02, 0.215, 0.23, 0.21), white, SKIN);
      // rounded face opening (an oval of skin set into the hood)
      b.add(T.sphere(12, 8), xf(0, 0.17, -0.1, 0.15, 0.15, 0.1), SKIN_TONE, SKIN);
      b.sphere(-0.065, 0.22, -0.19, 0.028, 0.036, 0.015, 0x1a1a1a, SKIN, 6, 4);
      b.sphere(0.065, 0.22, -0.19, 0.028, 0.036, 0.015, 0x1a1a1a, SKIN, 6, 4);
      b.add(T.cone(8), xf(0, 0.36, -0.3, 0.05, 0.26, 0.04, -Math.PI / 2 + 0.15, 0, 0), red, SKIN);
      b.sphere(-0.08, 0.38, -0.17, 0.03, 0.03, 0.015, 0x111111, SKIN, 5, 3);
      b.sphere(0.08, 0.38, -0.17, 0.03, 0.03, 0.015, 0x111111, SKIN, 5, 3);
      break;
    }
    case "upperArmL": case "upperArmR": {
      upperArm(b, white);
      // wing panel hanging behind the arm, white on top with black flight feathers
      b.box(0, -0.06, 0.09, 0.03, 0.28, 0.1, white, SKIN);
      break;
    }
    case "forearmL": case "forearmR":
      forearm(b, black, black);
      for (let k = 0; k < 3; k++) b.add(T.box, xf(0, -0.08 - k * 0.07, 0.1, 0.025, 0.1, 0.16, 0.2, 0, 0), black, SKIN);
      break;
    case "thigh": thigh(b, white, red); break;
    case "shin": shin(b, red, red, 0xff6a2a, 0xd84a1a); break;
  }
}

/** Build a runner body part for a non-classic outfit. */
export function buildOutfitPart(b: Builder, outfit: OutfitId, part: BodyPart): void {
  switch (outfit) {
    case "clasico": break;
    case "futbolera": futbolera(b, part); break;
    case "feria": feria(b, part); break;
    case "carnaval": carnaval(b, part); break;
    case "romano": romano(b, part); break;
    case "cigueno": cigueno(b, part); break;
  }
}
