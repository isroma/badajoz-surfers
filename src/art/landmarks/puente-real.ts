/**
 * Puente Real landmarks: the white inverted-Y pylon that straddles the deck, its fans of stay
 * cables, and the Torre de Caja Badajoz glass tower on the right bank.
 */
import type * as THREE from "three";
import type { Builder, V3 } from "../geom";
import { FAR, GLASS, GLOW, SOLID } from "../materials";

const CONCRETE = 0xf1f0ea;
const CONCRETE_SHADE = 0xdedcd3;

export const PYLON_TOP = 74;
export const PYLON_APEX = 44;
const LEG_BASE_X = 12.5;

/** Pylon centred at (0, 0, z) on the deck, legs straddling the road. `waterY` is the river level. */
export function pylon(b: Builder, z: number, waterY: number, mat: THREE.Material = SOLID): void {
  const legW = 2.2;
  const legD = 3.2;
  for (const sx of [-1, 1]) {
    // above the deck: leaning legs converging at the apex
    const base: V3 = [sx * LEG_BASE_X, -2, z];
    const apex: V3 = [sx * 0.9, PYLON_APEX, z];
    b.beam(base, apex, legW, CONCRETE, mat);
    // the face of the leg in shade reads better with a darker inner strip
    b.beam([base[0] - sx * 0.6, base[1], z + legD / 2 - 0.2], [apex[0] - sx * 0.3, apex[1], z + legD / 2 - 0.2], 0.4, CONCRETE_SHADE, mat);
    b.beam([base[0] - sx * 0.6, base[1], z - legD / 2 + 0.2], [apex[0] - sx * 0.3, apex[1], z - legD / 2 + 0.2], 0.4, CONCRETE_SHADE, mat);
    // below the deck, down into the river
    b.beam([sx * (LEG_BASE_X + 1.6), waterY - 1, z], [sx * LEG_BASE_X, -1.5, z], legW + 0.4, CONCRETE_SHADE, mat);
  }
  // the legs are deeper than wide: thicken them along z with flat plates
  for (const sx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      b.beam([sx * LEG_BASE_X, -2, z + dz * 0.8], [sx * 0.9, PYLON_APEX, z + dz * 0.8], legW * 0.92, CONCRETE, mat);
    }
  }
  // cross beam under the deck and the mast above the apex
  b.span(-LEG_BASE_X - 1, LEG_BASE_X + 1, -3.2, -1.6, z + 1.8, z - 1.8, CONCRETE_SHADE, mat);
  b.span(-2.0, 2.0, PYLON_APEX - 2, PYLON_TOP, z + 1.9, z - 1.9, CONCRETE, mat);
  b.span(-2.2, 2.2, PYLON_TOP, PYLON_TOP + 0.8, z + 2.1, z - 2.1, CONCRETE_SHADE, mat);
  // anchorage band where the cables meet the mast
  b.span(-2.05, 2.05, 50, 70, z + 1.95, z - 1.95, CONCRETE_SHADE, mat);
  // aircraft warning light
  b.box(0, PYLON_TOP + 1.1, z, 0.6, 0.6, 0.6, 0xff3b30, GLOW);
}

/**
 * Stay cables anchored on the deck edges between z0 and z1 (segment-local), running up to the
 * mast at z = pylonZ. Farther anchors attach higher up the mast (a fan).
 */
export function stayCables(b: Builder, z0: number, z1: number, pylonZ: number, deckX: number, spacing = 4): void {
  for (let z = z0 - spacing / 2; z > z1; z -= spacing) {
    const d = Math.abs(z - pylonZ);
    if (d < 10 || d > 150) continue;
    const y = 50 + Math.min(1, d / 150) * 19;
    const mz = pylonZ + Math.sign(z - pylonZ) * 1.6;
    for (const sx of [-1, 1]) {
      b.beam([sx * deckX, 0.9, z], [sx * 1.6, y, mz], 0.11, 0xf7f7f2, FAR);
      // anchor block on the deck edge
      b.box(sx * deckX, 0.6, z, 0.4, 0.6, 0.5, CONCRETE_SHADE, SOLID);
    }
  }
}

/** Torre de Caja Badajoz: ~90 m slim glass tower with white fins and a crown. Base at y = baseY. */
export function torreCaja(b: Builder, x: number, z: number, baseY = 0, night = false, mat: THREE.Material = FAR): void {
  const H = 88;
  const w = 15;
  const d = 15;
  const glass = night ? 0x6d86b8 : 0x4f86b0;
  // podium
  b.span(x - 16, x + 16, baseY, baseY + 8, z + 14, z - 14, 0xe4e1d8, mat);
  b.span(x - 16.3, x + 16.3, baseY + 3.5, baseY + 4.2, z + 14.3, z - 14.3, 0x2c3e50, GLASS);
  // glass shaft with chamfered corners (octagonal prism)
  const c = 3;
  for (const [cx, cz, sx, sz] of [
    [x, z, w, d - 2 * c],
    [x, z, w - 2 * c, d],
  ] as const) {
    b.span(cx - sx / 2, cx + sx / 2, baseY + 8, baseY + H, cz + sz / 2, cz - sz / 2, glass, GLASS);
  }
  // white vertical fins and floor bands
  for (const fx of [-w / 2, -w / 4, 0, w / 4, w / 2]) {
    b.span(x + fx - 0.25, x + fx + 0.25, baseY + 8, baseY + H + 2, z + d / 2 + 0.4, z + d / 2 - 0.2, 0xf4f4f0, mat);
  }
  for (const fz of [-d / 4, d / 4]) {
    for (const sx of [-1, 1]) {
      b.span(x + sx * (w / 2) - 0.2, x + sx * (w / 2) + 0.2, baseY + 8, baseY + H + 2, z + fz + 0.25, z + fz - 0.25, 0xf4f4f0, mat);
    }
  }
  for (let y = baseY + 12; y < baseY + H; y += 8) {
    b.span(x - w / 2 - 0.1, x + w / 2 + 0.1, y, y + 0.35, z + d / 2 + 0.1, z - d / 2 - 0.1, 0xdfe6ea, mat);
  }
  if (night) {
    for (let y = baseY + 10; y < baseY + H - 2; y += 4) {
      b.span(x - w / 2 + 1, x + w / 2 - 1, y, y + 1.6, z + d / 2 + 0.12, z + d / 2 + 0.05, 0xffe0a0, GLOW);
    }
  }
  // crown and mast
  b.span(x - w / 2 - 0.5, x + w / 2 + 0.5, baseY + H, baseY + H + 3, z + d / 2 + 0.5, z - d / 2 - 0.5, 0xf4f4f0, mat);
  b.cyl(x, baseY + H + 3, z, 0.4, 10, 0xdddddd, 6, mat);
  b.box(x, baseY + H + 13.2, z, 0.6, 0.6, 0.6, 0xff3b30, GLOW);
}
