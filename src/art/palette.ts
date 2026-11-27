/**
 * The palette of docs/design.md (Sol y Cerveza): the single source of colours for the 3D world.
 * Import from here; do not write hex colours elsewhere in the city art.
 */
export const PAL = {
  land: 0xf6eee2,
  pavement: 0xefe4d2,
  street: 0xffffff,
  streetCasing: 0xdad3c8,
  road: 0x5b6270,
  /** Carriageway the runner cannot use (beyond a median, side streets): a lighter, greyer road. */
  roadOff: 0x8b919c,
  marking: 0xffffff,
  runnable: 0xe7d7bc,
  kerb: 0xcfc5b6,
  buildings: [0xf0e4d3, 0xf2e6d6, 0xead9c2, 0xf7efe3] as const,
  brick: 0xd9a066,
  albero: 0xe8c07a,
  glass: 0xc9d6df,
  terracotta: 0xb8876b,
  flatRoof: 0xfcf8f1,
  window: 0x8fa6b8,
  windowLit: 0xffd98a,
  trees: [0xa8c98c, 0xbfdda0, 0x8db87a] as const,
  trunk: 0x9a7b5f,
  grass: 0xcde5ae,
  water: 0x9acbef,
  stone: 0xd8c9a8,
  sun: 0xffc53d,
  amber: 0xf59e0b,
  danger: 0xe5484d,
  ink: 0x1f2328,
  nightBg: 0x141826,
  // vehicles and obstacles: few saturated colours
  white: 0xffffff,
  red: 0xe5484d,
  blue: 0x3e7bd6,
  yellow: 0xf2b632,
  darkGrey: 0x3a3f4b,
} as const;

/** Night values (same shapes, Sol y Cerveza night). */
export const NIGHT = {
  land: 0x161a26,
  building: 0x2b3144,
  road: 0x2a3043,
  trees: 0x22302a,
  water: 0x16263d,
} as const;
