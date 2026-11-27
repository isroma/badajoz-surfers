/**
 * Old-town landmarks: the Cathedral of San Juan Bautista (fortress-like square tower), the
 * neoclassical Ayuntamiento, and the arcaded red-and-white houses of Plaza Alta.
 */
import { T, xf, type Builder } from "../geom";
import { GLOW, SOLID } from "../materials";
import { surfaceMat } from "../text";

const STONE = 0xcdb38a;
const STONE_DARK = 0xb39a74;
const STONE_LIGHT = 0xe0cba4;

/** Merlons along a wall top from (x0,z0) to (x1,z1) at height y. */
export function merlons(b: Builder, x0: number, z0: number, x1: number, z1: number, y: number, size: number, color: number, thick = size): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.floor(len / (size * 2)));
  const ry = Math.atan2(x1 - x0, z1 - z0);
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    b.box(x0 + (x1 - x0) * t, y + size * 0.6, z0 + (z1 - z0) * t, thick, size * 1.2, size, color, SOLID, ry);
  }
}

/**
 * Cathedral on the left side of the road (x < 0). (tx, tz) is the tower centre.
 * The tower faces the road (+X) with its clock; the nave runs behind it along -Z.
 */
export function catedral(b: Builder, tx: number, tz: number): void {
  const w = 12;
  const H = 34;
  // nave and aisles behind the tower
  b.span(tx - 22, tx - 4, 0, 20, tz - 4, tz - 46, STONE, SOLID);
  b.span(tx - 20, tx - 6, 20, 25, tz - 6, tz - 44, STONE_DARK, SOLID);
  merlons(b, tx - 4, tz - 4, tx - 4, tz - 46, 20, 0.9, STONE_LIGHT);
  for (let k = 0; k < 6; k++) {
    // buttresses along the road-facing side
    b.span(tx - 4, tx - 2.6, 0, 16, tz - 8 - k * 7, tz - 9.6 - k * 7, STONE_DARK, SOLID);
    // tall arched windows (dark)
    b.span(tx - 3.98, tx - 3.9, 9, 15, tz - 10.5 - k * 7, tz - 12.3 - k * 7, 0x3a2e25, SOLID);
  }
  // renaissance side portal facing the road
  b.span(tx - 4, tx - 2.2, 0, 12, tz - 24, tz - 32, STONE_LIGHT, SOLID);
  b.span(tx - 2.25, tx - 2.15, 0.2, 6, tz - 26, tz - 30, 0x4a3426, SOLID);
  b.span(tx - 2.2, tx - 2.0, 6, 7, tz - 25, tz - 31, STONE, SOLID);
  b.span(tx - 2.3, tx - 1.9, 10.5, 12, tz - 23.5, tz - 32.5, STONE, SOLID);
  // the tower: plain massive body with slit windows
  b.span(tx - w / 2, tx + w / 2, 0, H, tz + w / 2, tz - w / 2, STONE, SOLID);
  b.span(tx - w / 2 - 0.4, tx + w / 2 + 0.4, 0, 3, tz + w / 2 + 0.4, tz - w / 2 - 0.4, STONE_DARK, SOLID);
  for (const y of [10, 17, 24]) {
    b.span(tx + w / 2, tx + w / 2 + 0.05, y, y + 2.2, tz + 0.4, tz - 0.4, 0x3a2e25, SOLID);
    b.span(tx - 0.4, tx + 0.4, y, y + 2.2, tz + w / 2, tz + w / 2 + 0.05, 0x3a2e25, SOLID);
  }
  // string course + clock faces (road side and the side towards the runner)
  b.span(tx - w / 2 - 0.3, tx + w / 2 + 0.3, 26.4, 27, tz + w / 2 + 0.3, tz - w / 2 - 0.3, STONE_LIGHT, SOLID);
  b.sign("clock", tx + w / 2 + 0.06, 30, tz, 3.4, Math.PI / 2);
  b.sign("clock", tx, 30, tz + w / 2 + 0.06, 3.4, 0);
  // belfry stage with arched openings
  const by = H;
  b.span(tx - w / 2 + 0.8, tx + w / 2 - 0.8, by, by + 6, tz + w / 2 - 0.8, tz - w / 2 + 0.8, STONE_LIGHT, SOLID);
  for (const d of [-2.4, 2.4]) {
    b.span(tx + w / 2 - 0.82, tx + w / 2 - 0.7, by + 1.2, by + 4.6, tz + d + 1, tz + d - 1, 0x2d241d, SOLID);
    b.span(tx + d - 1, tx + d + 1, by + 1.2, by + 4.6, tz + w / 2 - 0.7, tz + w / 2 - 0.82, 0x2d241d, SOLID);
    // bells
    b.cone(tx + w / 2 - 1.4, by + 1.6, tz + d, 0.7, 1.2, 0x8a6a2a, 6, SOLID);
  }
  // crenellated top with corner pinnacles
  b.span(tx - w / 2, tx + w / 2, H - 0.4, H + 0.4, tz + w / 2, tz - w / 2, STONE_LIGHT, SOLID);
  for (const [x0, z0, x1, z1] of [
    [tx - w / 2, tz + w / 2, tx + w / 2, tz + w / 2],
    [tx + w / 2, tz + w / 2, tx + w / 2, tz - w / 2],
    [tx + w / 2, tz - w / 2, tx - w / 2, tz - w / 2],
    [tx - w / 2, tz - w / 2, tx - w / 2, tz + w / 2],
  ] as const) merlons(b, x0, z0, x1, z1, H + 0.4, 1.0, STONE_LIGHT);
  for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    b.span(tx + cx * (w / 2) - 0.7, tx + cx * (w / 2) + 0.7, H, H + 3.4, tz + cz * (w / 2) + 0.7, tz + cz * (w / 2) - 0.7, STONE, SOLID);
    b.cone(tx + cx * (w / 2), H + 3.4, tz + cz * (w / 2), 0.9, 1.6, STONE_LIGHT, 4, SOLID);
  }
  b.span(tx - w / 2 + 0.8, tx + w / 2 - 0.8, by + 6, by + 6.6, tz + w / 2 - 0.8, tz - w / 2 + 0.8, STONE, SOLID);
  b.cone(tx, by + 6.6, tz, 3.4, 2.2, 0xa98a62, 4, SOLID);
  b.cyl(tx, by + 8.8, tz, 0.08, 2.2, 0x333333, 4, SOLID);
  b.span(tx - 0.7, tx + 0.7, by + 10.2, by + 10.35, tz + 0.05, tz - 0.05, 0x333333, SOLID);
}

/** Ayuntamiento on the right side (x > 0): white neoclassical facade at x = fx, centred at z. */
export function ayuntamiento(b: Builder, fx: number, z: number, night: boolean): void {
  const white = 0xf7f4ec;
  const cream = 0xeadfc4;
  const len = 30;
  const H = 14;
  b.span(fx, fx + 18, 0, H, z + len / 2, z - len / 2, white, SOLID);
  b.span(fx - 0.2, fx + 18, H, H + 0.6, z + len / 2 + 0.2, z - len / 2 - 0.2, cream, SOLID);
  b.span(fx - 0.1, fx, 0, 1.0, z + len / 2, z - len / 2, cream, SOLID);
  // windows: tall, with pediments, on three floors
  for (let k = 0; k < 7; k++) {
    const wz = z + len / 2 - 2.2 - k * 4.27;
    if (Math.abs(wz - z) < 4) continue;
    for (const [y, h] of [[1.6, 2.6], [5.6, 3.0], [10.0, 2.4]] as const) {
      b.span(fx - 0.06, fx, y, y + h, wz + 0.7, wz - 0.7, night ? 0xffd48a : 0x3c4a58, night ? GLOW : SOLID);
      b.span(fx - 0.18, fx, y + h, y + h + 0.3, wz + 0.95, wz - 0.95, cream, SOLID);
    }
    b.span(fx - 0.6, fx, 5.5, 5.62, wz + 1.0, wz - 1.0, cream, SOLID);
    b.span(fx - 0.58, fx - 0.55, 5.62, 6.5, wz + 1.0, wz - 1.0, 0x22262a, SOLID);
  }
  // central portico: four columns, balcony, entablature and pediment
  const px = fx - 2.2;
  b.span(px - 0.3, fx, 0, 0.6, z + 5, z - 5, cream, SOLID);
  for (const dz of [-3.6, -1.2, 1.2, 3.6]) {
    b.cyl(px + 0.5, 0.6, z + dz, 0.38, 9.4, white, 10, SOLID);
    b.span(px + 0.05, px + 0.95, 9.9, 10.3, z + dz + 0.5, z + dz - 0.5, cream, SOLID);
  }
  b.span(px - 0.2, fx, 10.3, 11.6, z + 5.2, z - 5.2, white, SOLID);
  b.span(px - 0.3, fx, 5.0, 5.25, z + 5.0, z - 5.0, cream, SOLID);
  b.span(px - 0.32, px - 0.26, 5.25, 6.2, z + 5.0, z - 5.0, 0x22262a, SOLID);
  b.hexa([
    [px - 0.2, 11.6, z + 5.4], [fx, 11.6, z + 5.4], [fx, 11.6, z - 5.4], [px - 0.2, 11.6, z - 5.4],
    [px - 0.2, 14.6, z + 0.2], [fx, 14.6, z + 0.2], [fx, 14.6, z - 0.2], [px - 0.2, 14.6, z - 0.2],
  ], white, SOLID);
  b.sign("escudo", px - 0.25, 12.7, z, 1.6, -Math.PI / 2);
  b.sign("ayuntamiento", px - 0.25, 10.95, z, 0.75, -Math.PI / 2);
  // doors behind the columns
  for (const dz of [-2.4, 0, 2.4]) b.span(fx - 0.08, fx, 0.6, 4.2, z + dz + 0.8, z + dz - 0.8, 0x5a3a24, SOLID);
  // flags on the balcony: Spain, Extremadura, Europe
  const flags: [number, number, number][] = [[0xc60b1e, 0xffc400, 0xc60b1e], [0x007a33, 0xffffff, 0x111111], [0x003399, 0x003399, 0x003399]];
  flags.forEach((cols, k) => {
    const fz = z - 1.6 + k * 1.6;
    b.beam([px - 0.3, 6.0, fz], [px - 1.8, 8.4, fz], 0.05, 0x888888, SOLID);
    cols.forEach((c, j) => b.add(T.box, xf(px - 1.4, 8.15 - j * 0.28, fz, 0.06, 0.28, 1.1, 0, 0, 0), c, SOLID));
  });
  // clock and bell gable on the roof
  b.span(fx + 0.5, fx + 1.5, H + 0.6, H + 4.4, z + 2, z - 2, white, SOLID);
  b.sign("clock", fx + 0.45, H + 2.4, z, 2.4, -Math.PI / 2);
}

/**
 * A row of Plaza Alta houses: arcades with horseshoe arches below and the red/white geometric
 * painted walls above. Facade plane at x = fx facing the road (side -1: faces +X; side 1: faces -X).
 */
export function plazaAltaRow(b: Builder, side: -1 | 1, fx: number, z0: number, z1: number, depth = 10, storeys = 2): void {
  const len = z0 - z1;
  const bayW = 4;
  const bays = Math.max(1, Math.round(len / bayW));
  const realBay = len / bays;
  const H = storeys * 4.2;
  const back = fx + side * depth;
  b.span(fx, back, 0, H, z0, z1, 0xf3ece0, SOLID);
  const ry = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  const faceX = fx - side * 0.04;
  // painted facade (one texture bay per arcade bay)
  b.quad(xf(faceX, H / 2, (z0 + z1) / 2, len, H, 1, 0, ry, 0), 0xffffff, surfaceMat("plaza-alta"), [0, 0, bays, storeys / 2]);
  // 3D piers between arches and a projecting eave with terracotta roof
  for (let k = 0; k <= bays; k++) {
    const z = z0 - k * realBay;
    b.span(fx - side * 0.35, fx, 0, 2.2, z + 0.3, z - 0.3, 0xb8322a, SOLID);
    b.span(fx - side * 0.45, fx, 2.2, 2.45, z + 0.4, z - 0.4, 0xf6efe2, SOLID);
  }
  b.span(fx - side * 0.7, back, H, H + 0.25, z0 + 0.2, z1 - 0.2, 0xf6efe2, SOLID);
  const xm = (fx + back) / 2;
  const xa = Math.min(fx - side * 0.7, back);
  const xb = Math.max(fx - side * 0.7, back);
  b.hexa([
    [xa, H + 0.25, z0 + 0.2], [xb, H + 0.25, z0 + 0.2], [xb, H + 0.25, z1 - 0.2], [xa, H + 0.25, z1 - 0.2],
    [xm - 0.1, H + 2.6, z0 + 0.2], [xm + 0.1, H + 2.6, z0 + 0.2], [xm + 0.1, H + 2.6, z1 - 0.2], [xm - 0.1, H + 2.6, z1 - 0.2],
  ], 0xb5532f, SOLID);
  // painted end wall towards +Z so the pattern reads when approaching
  b.quad(xf((fx + back) / 2, H / 2, z0 + 0.04, depth, H, 1), 0xffffff, surfaceMat("plaza-alta"), [0, 0, depth / bayW, storeys / 2]);
}
