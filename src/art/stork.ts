/**
 * The big white stork that carries the runner (power-up "ciguena"): a body with neck, beak,
 * tail and gripping legs, plus one wing template (mirrored for the left wing). ~3.6 m span.
 */
import { T, xf, type Builder } from "./geom";
import { SKIN } from "./materials";

const WHITE = 0xfbfbf8;
const BLACK = 0x141414;
const RED = 0xe23b24;

/** Body in local space: centre at the origin, flying towards -Z; feet reach down to y = -0.95. */
export function buildStorkBody(b: Builder): void {
  b.add(T.sphere(12, 8), xf(0, 0, 0.05, 0.26, 0.24, 0.6), WHITE, SKIN);
  // tail feathers
  b.add(T.box, xf(0, 0.02, 0.68, 0.3, 0.05, 0.3, -0.15, 0, 0), WHITE, SKIN);
  // neck stretched forward, head, long red beak
  b.beam([0, 0.06, -0.45], [0, 0.14, -0.95], 0.13, WHITE, SKIN, 8);
  b.sphere(0, 0.16, -1.02, 0.11, 0.1, 0.13, WHITE, SKIN, 8, 6);
  b.add(T.cone(8), xf(0, 0.12, -1.38, 0.045, 0.5, 0.04, -Math.PI / 2, 0, 0), RED, SKIN);
  for (const sx of [-1, 1]) b.sphere(sx * 0.07, 0.2, -1.06, 0.02, 0.022, 0.02, BLACK, SKIN, 5, 3);
  // long red legs reaching down to the runner's shoulders, toes curled round them
  for (const sx of [-1, 1]) {
    b.beam([sx * 0.1, -0.15, 0.1], [sx * 0.2, -0.85, 0.06], 0.045, RED, SKIN, 6);
    for (const dz of [-0.07, 0, 0.07]) b.beam([sx * 0.2, -0.85, 0.06], [sx * 0.24, -0.95, 0.06 + dz * 1.6], 0.025, RED, SKIN, 4);
  }
}

/** Right wing: pivot at the shoulder, extends towards +X. White coverts, black flight feathers. */
export function buildStorkWing(b: Builder): void {
  b.hexa([
    [0, -0.04, 0.28], [0.95, -0.04, 0.32], [0.95, -0.04, -0.18], [0, -0.04, -0.22],
    [0, 0.04, 0.28], [0.95, 0.04, 0.32], [0.95, 0.04, -0.18], [0, 0.04, -0.22],
  ], WHITE, SKIN, false);
  // black primaries fanning out at the tip and secondaries along the trailing edge
  for (let k = 0; k < 6; k++) {
    const z = -0.12 + k * 0.085;
    b.add(T.box, xf(1.32 + k * 0.03, 0, z, 0.8 - k * 0.05, 0.03, 0.11, 0, -0.05 + k * 0.06, 0), BLACK, SKIN);
  }
  b.add(T.box, xf(0.5, 0, 0.36, 0.9, 0.03, 0.16), BLACK, SKIN);
}
