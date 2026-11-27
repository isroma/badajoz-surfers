/** Outfit previews for the shop: a little bust (head, headwear, top) in each outfit's colours. */
import type { OutfitId } from "../contracts";

const INK = "#24140f";
const SKIN = "#f2b58d";

interface Look {
  /** Background disc colour. */
  bg: string;
  /** Top: either a flat colour or SVG markup drawn inside the torso clip. */
  top: string;
  pattern?: string;
  /** Headwear markup (drawn over the head). */
  hat?: string;
  /** Extra details over the torso. */
  extra?: string;
}

const LOOKS: Record<OutfitId, Look> = {
  clasico: {
    bg: "#ffd9a0",
    top: "#f07a1e",
    hat: `<path d="M19 22 C19 12 45 12 45 22 Z" fill="#2f5aa8" stroke="${INK}" stroke-width="2.5"/><path d="M40 21 H54 C54 24 50 25 44 24 Z" fill="#2f5aa8" stroke="${INK}" stroke-width="2.5"/>`,
    extra: `<path d="M26 46 C28 50 36 50 38 46" fill="none" stroke="#c45c10" stroke-width="2.5"/><path d="M29 47 V55 M35 47 V55" stroke="#fff4dc" stroke-width="2"/>`,
  },
  futbolera: {
    bg: "#d9dde6",
    top: "#ffffff",
    pattern: `<path d="M18 40 V64 M26 40 V64 M34 40 V64 M42 40 V64" stroke="#1d1d1d" stroke-width="4.5"/>`,
    extra: `<circle cx="32" cy="50" r="3.2" fill="#1d1d1d" stroke="#fff" stroke-width="1"/>`,
  },
  feria: {
    bg: "#ffe0e6",
    top: "#e0303a",
    pattern: `<g fill="#ffffff"><circle cx="20" cy="48" r="2.4"/><circle cx="30" cy="54" r="2.4"/><circle cx="40" cy="47" r="2.4"/><circle cx="46" cy="57" r="2.4"/><circle cx="22" cy="59" r="2.4"/><circle cx="36" cy="61" r="2.4"/></g>`,
    hat: `<circle cx="22" cy="16" r="5" fill="#e0303a" stroke="${INK}" stroke-width="2"/><circle cx="22" cy="16" r="2" fill="#ffd0d6"/><path d="M26 18 L30 15" stroke="#2f8a3a" stroke-width="2.5"/>`,
  },
  carnaval: {
    bg: "#e8dcff",
    top: "#6b3fc4",
    pattern: `<g fill="#ffd23f"><path d="M20 46 l2 4 l4 1 l-3 3 l1 4 l-4 -2 l-4 2 l1 -4 l-3 -3 l4 -1 Z"/><circle cx="40" cy="52" r="2"/><circle cx="34" cy="60" r="1.6"/><circle cx="46" cy="60" r="1.6"/></g>`,
    hat: `<path d="M24 14 C20 2 26 0 28 12 M32 12 C32 -2 38 -1 36 12 M40 14 C44 2 50 4 42 14" fill="#ff5fa2" stroke="${INK}" stroke-width="2"/><path d="M20 17 H44 V21 H20 Z" fill="#ffd23f" stroke="${INK}" stroke-width="2"/>`,
  },
  romano: {
    bg: "#e8f0d8",
    top: "#f5f0e4",
    pattern: `<path d="M14 42 C26 52 36 56 50 64" stroke="#b0303a" stroke-width="5" fill="none"/>`,
    hat: `<path d="M18 22 C20 14 26 11 32 11 C38 11 44 14 46 22" fill="none" stroke="#3f8a3a" stroke-width="3.5" stroke-dasharray="3 1.5"/>`,
  },
  cigueno: {
    bg: "#d6ecfa",
    top: "#ffffff",
    pattern: `<path d="M14 54 C18 50 22 52 24 58 L24 64 H14 Z M50 54 C46 50 42 52 40 58 L40 64 H50 Z" fill="#1d1d1d"/>`,
    hat: `<path d="M20 22 C20 8 44 8 44 22 Z" fill="#ffffff" stroke="${INK}" stroke-width="2.5"/><path d="M40 18 L58 22 L40 23 Z" fill="#e8423a" stroke="${INK}" stroke-width="2"/><circle cx="36" cy="16" r="1.4" fill="${INK}"/>`,
  },
};

let uid = 0;

/** SVG bust for an outfit (64×64). */
export function outfitPreview(id: OutfitId): string {
  const look = LOOKS[id];
  const clip = `of-clip-${++uid}`;
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <defs><clipPath id="${clip}"><path d="M10 64 C10 48 18 40 32 40 C46 40 54 48 54 64 Z"/></clipPath></defs>
    <circle cx="32" cy="32" r="31" fill="${look.bg}"/>
    <path d="M10 64 C10 48 18 40 32 40 C46 40 54 48 54 64 Z" fill="${look.top}"/>
    <g clip-path="url(#${clip})">${look.pattern ?? ""}</g>
    <path d="M10 64 C10 48 18 40 32 40 C46 40 54 48 54 64" fill="none" stroke="${INK}" stroke-width="3"/>
    ${look.extra ?? ""}
    <circle cx="32" cy="26" r="12" fill="${SKIN}" stroke="${INK}" stroke-width="3"/>
    <circle cx="28" cy="27" r="1.6" fill="${INK}"/><circle cx="36" cy="27" r="1.6" fill="${INK}"/>
    <path d="M28 32 C30 34 34 34 36 32" fill="none" stroke="${INK}" stroke-width="2"/>
    ${look.hat ?? ""}
  </svg>`;
}
