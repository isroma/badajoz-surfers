/**
 * Stylised route map of the loop around Badajoz: the Guadiana, the six zones, a few landmarks
 * and the runner. Laid out from real coordinates (equirectangular projection, north up).
 */
import { ZONES } from "../contracts";

type LatLon = readonly [number, number];

/** The loop, zone by zone (index into ZONES). Each zone starts where the previous one ends. */
const ROUTE: readonly (readonly LatLon[])[] = [
  // Puente Real: from the right bank (north) across the Guadiana.
  [[38.8792, -6.9948], [38.8768, -6.9934], [38.8745, -6.992]],
  // Valdepasillas: south along the avenues.
  [[38.8745, -6.992], [38.8718, -6.9905], [38.87, -6.988], [38.8712, -6.983], [38.8735, -6.979]],
  // San Francisco: Paseo de San Francisco, Avenida de Europa.
  [[38.8735, -6.979], [38.8758, -6.976], [38.8775, -6.9735]],
  // Casco Antiguo: Plaza de España, calle San Juan, Plaza Alta.
  [[38.8775, -6.9735], [38.8785, -6.9705], [38.88, -6.969], [38.8812, -6.9683]],
  // Alcazaba, Puerta de Palmas and over the Puente de Palmas.
  [[38.8812, -6.9683], [38.8824, -6.9682], [38.8818, -6.9725], [38.8805, -6.9756], [38.8824, -6.9773], [38.8846, -6.979]],
  // Margen derecha: Avenida de Elvas back to the Puente Real.
  [[38.8846, -6.979], [38.8846, -6.983], [38.884, -6.985], [38.8822, -6.99], [38.8792, -6.9948]],
];

/** The Guadiana, flowing from the north-east to the south-west. */
const RIVER: readonly LatLon[] = [
  [38.8895, -6.957], [38.8862, -6.968], [38.8838, -6.977], [38.8812, -6.986],
  [38.879, -6.991], [38.8768, -6.9936], [38.874, -6.999], [38.871, -7.005],
];

const LANDMARKS = {
  puenteReal: [38.8768, -6.9934],
  catedral: [38.8787, -6.9708],
  alcazaba: [38.8834, -6.9668],
  puertaPalmas: [38.8803, -6.9759],
  puentePalmas: [38.8835, -6.9781],
} as const satisfies Record<string, LatLon>;

const SHORT_NAMES = ["Puente Real", "Valdepasillas", "San Francisco", "Casco Antiguo", "Alcazaba", "Margen dcha."];
/** Label offsets (in map units) so names sit beside the route, not on it. */
const LABEL_POS: readonly [number, number, "start" | "middle" | "end"][] = [
  [-6, 4, "end"],
  [0, 15, "middle"],
  [8, 8, "start"],
  [8, 4, "start"],
  [2, -10, "middle"],
  [0, -9, "middle"],
];

// ---------------------------------------------------------------- projection

const W = 200;
const PAD = 16;
const all = ROUTE.flat();
const lats = all.map((p) => p[0]);
const lons = all.map((p) => p[1]);
const minLat = Math.min(...lats);
const maxLat = Math.max(...lats);
const minLon = Math.min(...lons);
const maxLon = Math.max(...lons);
const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
const scale = (W - PAD * 2) / ((maxLon - minLon) * kx);
const H = Math.round((maxLat - minLat) * scale + PAD * 2);

const project = ([lat, lon]: LatLon): [number, number] => [PAD + (lon - minLon) * kx * scale, PAD + (maxLat - lat) * scale];

interface Seg {
  pts: [number, number][];
  lens: number[];
  length: number;
  start: number;
}

const SEGS: Seg[] = [];
{
  let start = 0;
  for (const zone of ROUTE) {
    const pts = zone.map(project);
    const lens: number[] = [];
    let length = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const d = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
      lens.push(d);
      length += d;
    }
    SEGS.push({ pts, lens, length, start });
    start += length;
  }
}
const TOTAL = SEGS.reduce((n, s) => n + s.length, 0);

const fmt = (n: number): string => n.toFixed(1);
const pathOf = (pts: readonly [number, number][]): string => pts.map((p, i) => `${i ? "L" : "M"}${fmt(p[0])} ${fmt(p[1])}`).join("");

/** Smooth path through points (Catmull-Rom → cubic Bézier). */
function smoothPath(pts: readonly [number, number][]): string {
  if (pts.length < 3) return pathOf(pts);
  let d = `M${fmt(pts[0]?.[0] ?? 0)} ${fmt(pts[0]?.[1] ?? 0)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    if (!p0 || !p1 || !p2 || !p3) continue;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${fmt(c1[0] ?? 0)} ${fmt(c1[1] ?? 0)} ${fmt(c2[0] ?? 0)} ${fmt(c2[1] ?? 0)} ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d;
}

const ROUTE_PATH = pathOf(SEGS.flatMap((s, i) => (i === 0 ? s.pts : s.pts.slice(1))));
const RIVER_PATH = smoothPath(RIVER.map(project));

/** Point at a distance along the loop. */
function pointAt(dist: number): [number, number] {
  let d = ((dist % TOTAL) + TOTAL) % TOTAL;
  for (const s of SEGS) {
    if (d > s.length) {
      d -= s.length;
      continue;
    }
    for (let i = 0; i < s.lens.length; i++) {
      const len = s.lens[i] ?? 0;
      const a = s.pts[i];
      const b = s.pts[i + 1];
      if (!a || !b) continue;
      if (d <= len || i === s.lens.length - 1) {
        const t = len > 0 ? Math.min(1, d / len) : 0;
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }
      d -= len;
    }
  }
  return SEGS[0]?.pts[0] ?? [0, 0];
}

/** Distance along the loop for a zone and 0..1 progress through it. */
export function routeDistance(zoneIndex: number, progress: number): number {
  const s = SEGS[Math.max(0, Math.min(SEGS.length - 1, zoneIndex))];
  if (!s) return 0;
  return s.start + s.length * Math.min(1, Math.max(0, progress));
}

// ---------------------------------------------------------------- landmark glyphs

const at = (ll: LatLon, body: string, size = 1): string => {
  const [x, y] = project(ll);
  return `<g class="mm-lm" transform="translate(${fmt(x)} ${fmt(y)}) scale(${size})">${body}</g>`;
};

/** Tiny glyphs centred on (0,0), about 10 units tall, drawn with the current palette classes. */
const GLYPHS = {
  // Cable-stayed pylon of the Puente Real.
  pylon: `<path d="M0 -11 L0 3 M0 -9 L-6 2 M0 -9 L6 2 M0 -6 L-4 2 M0 -6 L4 2" class="mm-ink" stroke-width="1.3" fill="none"/>`,
  // Cathedral tower with a cross.
  catedral: `<path d="M-3 4 V-5 H3 V4 Z M-2 -5 L0 -8 L2 -5 M0 -8 V-11 M-1.4 -10 H1.4" class="mm-ink mm-fill" stroke-width="1"/>`,
  // Alcazaba: crenellated tower (Torre de Espantaperros).
  alcazaba: `<path d="M-4 4 V-6 H-2.5 V-4.5 H-0.8 V-6 H0.8 V-4.5 H2.5 V-6 H4 V4 Z" class="mm-ink mm-fill" stroke-width="1"/>`,
  // Puerta de Palmas: two round towers and an arch.
  puerta: `<path d="M-6 4 V-5 H-3 V4 M3 4 V-5 H6 V4 M-3 -3 H3 V4 H1.6 A1.6 1.6 0 0 0 -1.6 4 H-3" class="mm-ink mm-fill" stroke-width="1"/>`,
  // Puente de Palmas: a row of arches.
  arches: `<path d="M-7 1 H7 M-7 1 V4 M-3.5 1 V4 M0 1 V4 M3.5 1 V4 M7 1 V4" class="mm-ink" stroke-width="1" fill="none"/>`,
};

const LANDMARK_SVG = [
  at(LANDMARKS.puenteReal, GLYPHS.pylon),
  at(LANDMARKS.catedral, GLYPHS.catedral),
  at(LANDMARKS.alcazaba, GLYPHS.alcazaba),
  at(LANDMARKS.puertaPalmas, GLYPHS.puerta),
  at(LANDMARKS.puentePalmas, GLYPHS.arches),
].join("");

// ---------------------------------------------------------------- component

export interface MinimapOptions {
  /** Zone names next to the route. */
  labels?: boolean;
  /** Monochrome "printed" look for the receipt. */
  ink?: boolean;
  className?: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export class Minimap {
  readonly el: HTMLElement;
  private readonly done: SVGPathElement;
  private readonly dot: SVGGElement;
  private last = "";

  constructor(opts: MinimapOptions = {}) {
    this.el = document.createElement("div");
    this.el.className = `minimap${opts.ink ? " ink" : ""}${opts.className ? ` ${opts.className}` : ""}`;
    const ticks = SEGS.map((s) => {
      const p = s.pts[0];
      return p ? `<circle cx="${fmt(p[0])}" cy="${fmt(p[1])}" r="2.4" class="mm-tick"/>` : "";
    }).join("");
    const labels = opts.labels
      ? SEGS.map((s, i) => {
          const mid = pointAt(s.start + s.length / 2);
          const [dx, dy, anchor] = LABEL_POS[i] ?? [0, 0, "middle"];
          return `<text x="${fmt(mid[0] + dx)}" y="${fmt(mid[1] + dy)}" text-anchor="${anchor}" class="mm-label" data-zone="${i}">${SHORT_NAMES[i] ?? ZONES[i]?.name ?? ""}</text>`;
        }).join("")
      : "";
    this.el.innerHTML = `
      <svg viewBox="${opts.labels ? `-34 -6 ${W + 84} ${H + 12}` : `0 0 ${W} ${H}`}" xmlns="${SVG_NS}" role="img" aria-label="Mapa de la huida por Badajoz">
        <path d="${RIVER_PATH}" class="mm-river-bank"/>
        <path d="${RIVER_PATH}" class="mm-river"/>
        <text class="mm-river-name" x="${fmt(project([38.8861, -6.9712])[0])}" y="${fmt(project([38.8861, -6.9712])[1])}">Guadiana</text>
        <path d="${ROUTE_PATH}" class="mm-route-bg"/>
        <path d="${ROUTE_PATH}" class="mm-route"/>
        <path d="${ROUTE_PATH}" class="mm-done" stroke-dasharray="0 ${fmt(TOTAL + 1)}"/>
        ${ticks}
        ${LANDMARK_SVG}
        ${labels}
        <g class="mm-dot"><circle r="7" class="mm-pulse"/><circle r="4.2" class="mm-runner"/></g>
      </svg>`;
    this.done = this.el.querySelector(".mm-done") as SVGPathElement;
    this.dot = this.el.querySelector(".mm-dot") as SVGGElement;
    this.update(0, 0);
  }

  /** Place the runner: zone index (0..5) and 0..1 progress through it. */
  update(zoneIndex: number, progress: number): void {
    const d = routeDistance(zoneIndex, progress);
    const key = d.toFixed(1);
    if (key === this.last) return;
    this.last = key;
    this.done.setAttribute("stroke-dasharray", `${fmt(d)} ${fmt(TOTAL + 1)}`);
    const [x, y] = pointAt(d);
    this.dot.setAttribute("transform", `translate(${fmt(x)} ${fmt(y)})`);
    this.el.querySelectorAll<SVGTextElement>(".mm-label").forEach((t) => {
      t.classList.toggle("here", Number(t.dataset["zone"]) === zoneIndex);
    });
  }
}

export const shortZoneName = (index: number): string => SHORT_NAMES[index] ?? ZONES[index]?.name ?? "";

export const zoneIndexOf = (id: string): number => Math.max(0, ZONES.findIndex((z) => z.id === id));
