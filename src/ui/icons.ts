/** Inline SVG icons (64×64, chunky outline). Trusted static markup. */
import type { PowerupKind } from "../contracts";

const INK = "#24140f";
const wrap = (body: string): string =>
  `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

/** Flat acorn: the bellota (sun-yellow nut, brown cap, no outline). Also the logo's mark. */
export const ICON_BELLOTA = wrap(`
  <path d="M31 13 C31 9 33 6 37 4" fill="none" stroke="#9A7B5F" stroke-width="4.5"/>
  <path d="M14 29 C14 45 23 56 32 60 C41 56 50 45 50 29 Z" fill="#FFC53D"/>
  <path d="M9 29 C9 19 19 12 32 12 C45 12 55 19 55 29 C55 32 53 34 50 34 L14 34 C11 34 9 32 9 29 Z" fill="#9A7B5F"/>`);

export const ICON_IMAN = wrap(`
  <path d="M17 10 V33 a15 15 0 0 0 30 0 V10" fill="none" stroke="${INK}" stroke-width="20" stroke-linecap="butt"/>
  <path d="M17 12 V33 a15 15 0 0 0 30 0 V12" fill="none" stroke="#E8423A" stroke-width="13" stroke-linecap="butt"/>
  <path d="M13 26 V33 a19 19 0 0 0 9 16" fill="none" stroke="#FF8A7A" stroke-width="3"/>
  <rect x="9.5" y="5" width="15" height="11" rx="2" fill="#E8EEF5" stroke="${INK}" stroke-width="3.5"/>
  <rect x="39.5" y="5" width="15" height="11" rx="2" fill="#E8EEF5" stroke="${INK}" stroke-width="3.5"/>`);

export const ICON_ZAPATILLAS = wrap(`
  <path d="M4 22 H16 M2 30 H12 M6 38 H14" stroke="#FFF4DC" stroke-width="3.5"/>
  <path d="M16 44 C16 34 18 26 22 22 L31 20 C33 27 39 31 47 32 L55 34 C60 36 62 40 62 44 Z" fill="#FFC53D" stroke="${INK}" stroke-width="3.5"/>
  <path d="M30 26 L36 23 M33 30 L39 27 M37 33 L42 30" stroke="${INK}" stroke-width="2.5"/>
  <path d="M22 22 C24 30 24 38 22 44" fill="none" stroke="#E8423A" stroke-width="4"/>
  <rect x="14" y="43" width="49" height="9" rx="4.5" fill="#FFF4DC" stroke="${INK}" stroke-width="3.5"/>`);

export const ICON_JAMON = wrap(`
  <path d="M9 43 C6 30 17 18 31 17 L47 9 C51 7 56 11 54 15 L46 29 C44 43 31 56 19 54 C14 53 10 49 9 43 Z" fill="#B3323E" stroke="${INK}" stroke-width="3.5"/>
  <path d="M15 40 C15 31 22 24 31 23" fill="none" stroke="#F7D9C4" stroke-width="5"/>
  <ellipse cx="22" cy="44" rx="8" ry="6.5" fill="#F7D9C4" stroke="${INK}" stroke-width="3"/>
  <ellipse cx="22" cy="44" rx="4" ry="3" fill="#D9545E"/>
  <path d="M46 10 L53 4 L60 10 L54 16 Z" fill="${INK}"/>`);

export const ICON_PATINETE = wrap(`
  <path d="M46 46 L40 11" stroke="${INK}" stroke-width="8"/>
  <path d="M46 46 L40 11" stroke="#2FB5A6" stroke-width="4"/>
  <path d="M33 10 H48" stroke="${INK}" stroke-width="7"/>
  <rect x="10" y="41" width="36" height="8" rx="4" fill="#2FB5A6" stroke="${INK}" stroke-width="3.5"/>
  <circle cx="14" cy="51" r="7" fill="#3A3A48" stroke="${INK}" stroke-width="3.5"/>
  <circle cx="48" cy="51" r="7" fill="#3A3A48" stroke="${INK}" stroke-width="3.5"/>
  <circle cx="14" cy="51" r="2.5" fill="#FFF4DC"/><circle cx="48" cy="51" r="2.5" fill="#FFF4DC"/>
  <path d="M50 22 L57 18" stroke="#FFC53D" stroke-width="3.5"/>`);

export const ICON_WAITER = wrap(`
  <path d="M10 64 C10 52 20 46 32 46 C44 46 54 52 54 64 Z" fill="#FFF4DC" stroke="${INK}" stroke-width="3.5"/>
  <path d="M24 49 L32 55 L40 49 L40 58 L32 54 L24 58 Z" fill="#E8423A" stroke="${INK}" stroke-width="3"/>
  <circle cx="32" cy="28" r="17" fill="#F2B58D" stroke="${INK}" stroke-width="3.5"/>
  <path d="M15 25 C15 13 24 9 32 9 C42 9 49 14 49 24 C43 18 32 16 22 19 C19 20 17 22 15 25 Z" fill="${INK}"/>
  <path d="M21 25 L28 28 M43 25 L36 28" stroke="${INK}" stroke-width="3.5"/>
  <circle cx="26" cy="31" r="2.3" fill="${INK}"/><circle cx="38" cy="31" r="2.3" fill="${INK}"/>
  <path d="M22 38 C26 34 30 36 32 37 C34 36 38 34 42 38 C38 39 35 39 32 38.5 C29 39 26 39 22 38 Z" fill="${INK}"/>`);

/** White stork in flight, black wing tips, red beak and legs. */
export const ICON_CIGUENA = wrap(`
  <path d="M6 30 C14 18 24 16 30 24 C36 14 48 10 60 16 C52 18 46 24 40 30 Z" fill="#ffffff" stroke="${INK}" stroke-width="3.5"/>
  <path d="M6 30 C10 25 14 22 18 21 L14 30 Z M60 16 C56 17 52 19 49 22 L52 25 Z" fill="${INK}"/>
  <path d="M18 34 C24 28 36 28 44 32 C40 38 30 40 22 38 Z" fill="#ffffff" stroke="${INK}" stroke-width="3.5"/>
  <path d="M44 32 C48 30 52 30 54 32" fill="none" stroke="${INK}" stroke-width="5"/>
  <path d="M44 32 C48 30 52 30 54 32" fill="none" stroke="#ffffff" stroke-width="2"/>
  <path d="M54 32 L63 35 L54 35 Z" fill="#E8423A" stroke="${INK}" stroke-width="2"/>
  <circle cx="51" cy="31.5" r="1.1" fill="${INK}"/>
  <path d="M22 38 L12 48 M26 38 L18 50" stroke="#E8423A" stroke-width="2.8"/>`);

const POWERUP_ICONS: Record<PowerupKind, string> = {
  iman: ICON_IMAN,
  zapatillas: ICON_ZAPATILLAS,
  jamon: ICON_JAMON,
  patinete: ICON_PATINETE,
  ciguena: ICON_CIGUENA,
};
export const powerupIcon = (kind: PowerupKind): string => POWERUP_ICONS[kind];

/** Accent colour per power-up for badges and timer bars. */
export const POWERUP_COLORS: Record<PowerupKind, string> = {
  iman: "#E8423A",
  zapatillas: "#FFC53D",
  jamon: "#C2485A",
  patinete: "#2FB5A6",
  ciguena: "#7CC6F2",
};

// Monochrome UI glyphs (use currentColor).
const glyph = (body: string): string =>
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const GLYPH_SOUND_ON = glyph(`<path d="M4 9 H8 L13 5 V19 L8 15 H4 Z" fill="currentColor"/><path d="M16.5 8.5 C18 10 18 14 16.5 15.5 M19.5 6 C22.5 9 22.5 15 19.5 18"/>`);
export const GLYPH_SOUND_OFF = glyph(`<path d="M4 9 H8 L13 5 V19 L8 15 H4 Z" fill="currentColor"/><path d="M17 9 L22 14 M22 9 L17 14"/>`);
export const GLYPH_MUSIC = glyph(`<path d="M9 18 V6 L20 4 V16"/><circle cx="6.5" cy="18" r="2.6" fill="currentColor"/><circle cx="17.5" cy="16" r="2.6" fill="currentColor"/>`);
export const GLYPH_PAUSE = glyph(`<path d="M8 5 V19 M16 5 V19" stroke-width="3.4"/>`);
export const GLYPH_PLAY = glyph(`<path d="M7 4.5 L19.5 12 L7 19.5 Z" fill="currentColor"/>`);
export const GLYPH_BACK = glyph(`<path d="M15 5 L8 12 L15 19"/>`);
export const GLYPH_HOME = glyph(`<path d="M4 11 L12 4 L20 11 M6.5 9.5 V20 H17.5 V9.5"/>`);
export const GLYPH_REPLAY = glyph(`<path d="M5 12 A7 7 0 1 0 8 6.3"/><path d="M4 4 V9 H9"/>`);
export const GLYPH_SHOP = glyph(`<path d="M4 9 H20 L18.5 20 H5.5 Z"/><path d="M8.5 9 V7 A3.5 3.5 0 0 1 15.5 7 V9"/>`);
export const GLYPH_FLAG = glyph(`<path d="M5 21 V4 M5 4 H18 L15.5 8.5 L18 13 H5"/>`);
export const GLYPH_HELP = glyph(`<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5 A2.6 2.6 0 1 1 13 12 C12.3 12.4 12 13 12 13.8"/><circle cx="12" cy="17.3" r="0.6" fill="currentColor"/>`);
export const GLYPH_CHECK = glyph(`<path d="M5 12.5 L10 17 L19 7"/>`);
export const GLYPH_STAR = glyph(`<path d="M12 3.5 L14.6 9 L20.5 9.6 L16 13.6 L17.3 19.5 L12 16.5 L6.7 19.5 L8 13.6 L3.5 9.6 L9.4 9 Z" fill="currentColor"/>`);
export const GLYPH_TROPHY = glyph(`<path d="M7 4 H17 V9 A5 5 0 0 1 7 9 Z" fill="currentColor"/><path d="M7 6 H4 V8 A3 3 0 0 0 7 11 M17 6 H20 V8 A3 3 0 0 1 17 11 M12 14 V18 M8 20 H16"/>`);
export const GLYPH_RUN = glyph(`<circle cx="14.5" cy="4.5" r="2" fill="currentColor"/><path d="M6 12 L9.5 8.5 L14 9.5 L12 14 L16 17 L15 21 M12 14 L8.5 17 L4.5 17 M14 9.5 L17 12.5 L20 12"/>`);
export const GLYPH_MEDAL = glyph(`<path d="M8 3 L10.5 9 M16 3 L13.5 9"/><circle cx="12" cy="15" r="5.5" fill="currentColor"/><path d="M12 12.3 L12.9 14.2 L15 14.4 L13.4 15.8 L13.9 17.8 L12 16.8 L10.1 17.8 L10.6 15.8 L9 14.4 L11.1 14.2 Z" fill="#fff4dc" stroke="none"/>`);
export const GLYPH_LIST = glyph(`<path d="M9 6 H20 M9 12 H20 M9 18 H20"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/>`);
export const GLYPH_CALENDAR = glyph(`<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10 H20.5 M8 3 V7 M16 3 V7"/><circle cx="12" cy="15" r="1.6" fill="currentColor"/>`);
export const GLYPH_LOCK = glyph(`<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5 V8 A4 4 0 0 1 16 8 V10.5"/>`);
export const GLYPH_MAP = glyph(`<path d="M3 6 L9 4 L15 6 L21 4 V18 L15 20 L9 18 L3 20 Z M9 4 V18 M15 6 V20"/>`);
export const GLYPH_COPY = glyph(`<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8 V5.5 A1.5 1.5 0 0 0 14.5 4 H5.5 A1.5 1.5 0 0 0 4 5.5 V14.5 A1.5 1.5 0 0 0 5.5 16 H8"/>`);
export const GLYPH_SHIRT = glyph(`<path d="M8 4 L4 7 L6 11 L8 10 V20 H16 V10 L18 11 L20 7 L16 4 C15 6 9 6 8 4 Z"/>`);
export const GLYPH_CLOSE = glyph(`<path d="M6 6 L18 18 M18 6 L6 18"/>`);
/** Turn chevrons for the direction hint (drawn pointing right; mirrored for left). */
export const GLYPH_TURN = glyph(`<path d="M5 19 V12 A4 4 0 0 1 9 8 H19 M15 4 L19 8 L15 12" stroke-width="2.6"/>`);
export const GLYPH_ROUNDABOUT = glyph(`<circle cx="12" cy="12" r="4.5"/><path d="M12 21 V16.5 M16.5 12 H21 M18 9 L21 12 L18 15" stroke-width="2.4"/>`);
