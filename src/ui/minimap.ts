/**
 * Route map of the lap round Badajoz: the Guadiana, the six zones, landmarks and the runner,
 * north up. Drawn from the real route in city.json once it has loaded (see ./city.ts); until
 * then, or if it never loads, from a stylised hand-placed loop.
 */
import { ZONES } from "../contracts";
import type { CityData } from "../city/data";
import { onCity } from "./city";

/** Everything a map needs, in SVG units (width W). */
export interface MapGeometry {
  real: boolean;
  w: number;
  h: number;
  /** Projected length of the whole route path. */
  total: number;
  routePath: string;
  /** One path per zone, in ZONES order. */
  zonePaths: string[];
  /** Zone start points. */
  ticks: [number, number][];
  /** Ready-made SVG for the river (and its bank). */
  water: string;
  riverLabel: [number, number] | null;
  landmarks: string;
  /** Anchor for each zone label (outside the loop). */
  labels: { x: number; y: number; anchor: "start" | "middle" | "end" }[];
  /** Hover targets with real street names (real map only). */
  streets: { d: string; name: string }[];
  /** Runner position for a zone and 0..1 progress: map point, length along the path, heading (deg). */
  locate(zoneIndex: number, progress: number): { x: number; y: number; len: number; angle: number };
  /** Street name at that position (real map only). */
  streetAt(zoneIndex: number, progress: number): string | null;
}

const W = 200;
const PAD = 14;
const fmt = (n: number): string => n.toFixed(1);
const pathOf = (pts: readonly (readonly [number, number])[]): string =>
  pts.map((p, i) => `${i ? "L" : "M"}${fmt(p[0])} ${fmt(p[1])}`).join("");

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
  // Plaza Alta: an arcaded square.
  plaza: `<path d="M-4 3 V-3 H4 V3 Z M-4 0 H4 M0 -3 V3" class="mm-ink mm-fill" stroke-width="0.9"/>`,
  // Templete de la Música (Paseo de San Francisco): a dome on posts.
  templete: `<path d="M-4 -2 A4 3.2 0 0 1 4 -2 Z M-3.4 -2 V3 M3.4 -2 V3 M0 -2 V3 M-4.5 3 H4.5 M0 -5.2 V-6.8" class="mm-ink mm-fill" stroke-width="0.9"/>`,
  // Edificio Siglo XXI: a slim tower.
  torre: `<path d="M-2 5 V-8 L0 -10 L2 -8 V5 Z" class="mm-ink mm-fill" stroke-width="0.9"/>`,
};

const glyphAt = (x: number, y: number, body: string, size = 1): string =>
  `<g class="mm-lm" transform="translate(${fmt(x)} ${fmt(y)}) scale(${size})">${body}</g>`;

/** Label anchor for a point, pushed away from the map centre. */
function labelFor(x: number, y: number, cx: number, cy: number, push: number): { x: number; y: number; anchor: "start" | "middle" | "end" } {
  const dx = x - cx;
  const dy = y - cy;
  const d = Math.hypot(dx, dy) || 1;
  const lx = x + (dx / d) * push;
  const ly = y + (dy / d) * push + 3;
  const anchor = Math.abs(dx / d) < 0.35 ? "middle" : dx > 0 ? "start" : "end";
  return { x: lx, y: ly, anchor };
}

// ---------------------------------------------------------------- stylised fallback

type LatLon = readonly [number, number];

/** The loop, zone by zone (index into ZONES). Each zone starts where the previous one ends. */
const ROUTE: readonly (readonly LatLon[])[] = [
  [[38.8792, -6.9948], [38.8768, -6.9934], [38.8745, -6.992]],
  [[38.8745, -6.992], [38.8718, -6.9905], [38.87, -6.988], [38.8712, -6.983], [38.8735, -6.979]],
  [[38.8735, -6.979], [38.8758, -6.976], [38.8775, -6.9735]],
  [[38.8775, -6.9735], [38.8785, -6.9705], [38.88, -6.969], [38.8812, -6.9683]],
  [[38.8812, -6.9683], [38.8824, -6.9682], [38.8818, -6.9725], [38.8805, -6.9756], [38.8824, -6.9773], [38.8846, -6.979]],
  [[38.8846, -6.979], [38.8846, -6.983], [38.884, -6.985], [38.8822, -6.99], [38.8792, -6.9948]],
];
const RIVER: readonly LatLon[] = [
  [38.8895, -6.957], [38.8862, -6.968], [38.8838, -6.977], [38.8812, -6.986],
  [38.879, -6.991], [38.8768, -6.9936], [38.874, -6.999], [38.871, -7.005],
];

function stylised(): MapGeometry {
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

  const segs = ROUTE.map((zone) => {
    const pts = zone.map(project);
    const lens: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      lens.push(a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0);
    }
    return { pts, lens, length: lens.reduce((x, y) => x + y, 0), start: 0 };
  });
  let acc = 0;
  for (const s of segs) {
    s.start = acc;
    acc += s.length;
  }
  const total = acc;
  const pointAt = (dist: number): [number, number] => {
    let d = ((dist % total) + total) % total;
    for (const s of segs) {
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
    return segs[0]?.pts[0] ?? [0, 0];
  };
  const river = smoothPath(RIVER.map(project));
  const cx = W / 2;
  const cy = H / 2;
  const lm = (ll: LatLon, body: string): string => glyphAt(...project(ll), body);
  return {
    real: false,
    w: W,
    h: H,
    total,
    routePath: pathOf(segs.flatMap((s, i) => (i === 0 ? s.pts : s.pts.slice(1)))),
    zonePaths: segs.map((s) => pathOf(s.pts)),
    ticks: segs.map((s) => s.pts[0] ?? [0, 0]),
    water: `<path d="${river}" class="mm-river-bank"/><path d="${river}" class="mm-river"/>`,
    riverLabel: project([38.8861, -6.9712]),
    landmarks: [
      lm([38.8768, -6.9934], GLYPHS.pylon),
      lm([38.8787, -6.9708], GLYPHS.catedral),
      lm([38.8834, -6.9668], GLYPHS.alcazaba),
      lm([38.8803, -6.9759], GLYPHS.puerta),
      lm([38.8835, -6.9781], GLYPHS.arches),
    ].join(""),
    labels: segs.map((s) => {
      const [x, y] = pointAt(s.start + s.length / 2);
      return labelFor(x, y, cx, cy, 12);
    }),
    streets: [],
    locate(zoneIndex, progress) {
      const s = segs[Math.max(0, Math.min(segs.length - 1, zoneIndex))];
      const len = s ? s.start + s.length * Math.min(1, Math.max(0, progress)) : 0;
      const [x, y] = pointAt(len);
      const [x2, y2] = pointAt(len + 2);
      return { x, y, len, angle: (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI };
    },
    streetAt: () => null,
  };
}

// ---------------------------------------------------------------- real route

/** Douglas-Peucker on a polyline; returns the kept indices (first and last always kept). */
export function simplify(xs: ArrayLike<number>, ys: ArrayLike<number>, tolerance: number): number[] {
  const n = xs.length;
  if (n < 3) return Array.from({ length: n }, (_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const ax = xs[a] ?? 0;
    const ay = ys[a] ?? 0;
    const dx = (xs[b] ?? 0) - ax;
    const dy = (ys[b] ?? 0) - ay;
    const l2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = t2;
    for (let i = a + 1; i < b; i++) {
      const px = (xs[i] ?? 0) - ax;
      const py = (ys[i] ?? 0) - ay;
      const t = l2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0;
      const ex = px - t * dx;
      const ey = py - t * dy;
      const d = ex * ex + ey * ey;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/** Landmarks drawn on the real map: city.json id → glyph (first id found wins for a slot). */
const REAL_LANDMARKS: readonly { ids: readonly string[]; glyph: string; small?: boolean }[] = [
  { ids: ["puente-real"], glyph: GLYPHS.pylon },
  { ids: ["torre-siglo-xxi"], glyph: GLYPHS.torre },
  { ids: ["templete-san-francisco"], glyph: GLYPHS.templete, small: true },
  { ids: ["catedral"], glyph: GLYPHS.catedral },
  { ids: ["plaza-alta"], glyph: GLYPHS.plaza, small: true },
  { ids: ["torre-espantaperros", "alcazaba"], glyph: GLYPHS.alcazaba },
  { ids: ["puerta-palmas"], glyph: GLYPHS.puerta },
  { ids: ["puente-palmas"], glyph: GLYPHS.arches },
];

export function realGeometry(city: CityData): MapGeometry {
  const P = city.route.points;
  const S = city.route.s;
  const lap = city.meta.lapLength;
  const n = S.length;
  // Closed loop: repeat the first point at s = lap.
  const xs = new Float64Array(n + 1);
  const zs = new Float64Array(n + 1);
  const ss = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    xs[i] = P[i * 3] ?? 0;
    zs[i] = P[i * 3 + 1] ?? 0;
    ss[i] = S[i] ?? 0;
  }
  xs[n] = xs[0] ?? 0;
  zs[n] = zs[0] ?? 0;
  ss[n] = lap;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i <= n; i++) {
    minX = Math.min(minX, xs[i] ?? 0);
    maxX = Math.max(maxX, xs[i] ?? 0);
    minZ = Math.min(minZ, zs[i] ?? 0);
    maxZ = Math.max(maxZ, zs[i] ?? 0);
  }
  const k = (W - PAD * 2) / Math.max(1, maxX - minX);
  const H = Math.round((maxZ - minZ) * k + PAD * 2);
  // X east → right, Z south → down: north is up.
  const px = (x: number): number => PAD + (x - minX) * k;
  const py = (z: number): number => PAD + (z - minZ) * k;

  // A few hundred points: a tolerance of about 0.08 map units (≈ 1 m).
  const idx = simplify(xs, zs, 0.08 / k);
  const m = idx.length;
  const KX = new Float64Array(m);
  const KY = new Float64Array(m);
  const KS = new Float64Array(m);
  const KL = new Float64Array(m);
  idx.forEach((i, j) => {
    KX[j] = px(xs[i] ?? 0);
    KY[j] = py(zs[i] ?? 0);
    KS[j] = ss[i] ?? 0;
    KL[j] = j ? (KL[j - 1] ?? 0) + Math.hypot((KX[j] ?? 0) - (KX[j - 1] ?? 0), (KY[j] ?? 0) - (KY[j - 1] ?? 0)) : 0;
  });
  const total = KL[m - 1] ?? 1;

  /** Map point, path length and heading at route distance s (wrapped). */
  const at = (sRaw: number): { x: number; y: number; len: number; angle: number } => {
    const s = ((sRaw % lap) + lap) % lap;
    let lo = 0;
    let hi = m - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((KS[mid] ?? 0) <= s) lo = mid;
      else hi = mid;
    }
    const s0 = KS[lo] ?? 0;
    const s1 = KS[hi] ?? s0;
    const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    const x0 = KX[lo] ?? 0;
    const y0 = KY[lo] ?? 0;
    const x1 = KX[hi] ?? x0;
    const y1 = KY[hi] ?? y0;
    const l0 = KL[lo] ?? 0;
    const l1 = KL[hi] ?? l0;
    return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, len: l0 + (l1 - l0) * t, angle: (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI };
  };
  /** Polyline of the route between two distances (fromS < toS ≤ lap). */
  const span = (fromS: number, toS: number): string => {
    const a = at(fromS);
    const pts: [number, number][] = [[a.x, a.y]];
    for (let j = 0; j < m; j++) {
      const s = KS[j] ?? 0;
      if (s > fromS && s < toS) pts.push([KX[j] ?? 0, KY[j] ?? 0]);
    }
    const b = toS >= lap ? { x: KX[m - 1] ?? 0, y: KY[m - 1] ?? 0 } : at(toS);
    pts.push([b.x, b.y]);
    return pathOf(pts);
  };

  const zoneSpans = ZONES.map((z, i) => {
    const cz = city.zones.find((c) => c.id === z.id) ?? city.zones[i];
    return { fromS: cz?.fromS ?? 0, toS: cz?.toS ?? lap };
  });
  const sAt = (zoneIndex: number, progress: number): number => {
    const zs2 = zoneSpans[Math.max(0, Math.min(zoneSpans.length - 1, zoneIndex))] ?? { fromS: 0, toS: lap };
    const s = zs2.fromS + (zs2.toS - zs2.fromS) * Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
    // The end of the last zone is the end of the lap, not its start.
    return Math.min(s, lap - 0.01);
  };

  // The Guadiana (and any river polygon), clipped by the viewBox.
  const ring = (r: readonly number[]): string => {
    let d = "";
    for (let i = 0; i + 1 < r.length; i += 2) d += `${i ? "L" : "M"}${fmt(px(r[i] ?? 0))} ${fmt(py(r[i + 1] ?? 0))}`;
    return `${d}Z`;
  };
  const rivers = city.water.filter((w) => w.kind === "river" || w.kind === "riverbank");
  const riverD = rivers.map((w) => ring(w.ring) + (w.holes ?? []).map(ring).join("")).join("");
  // Label the river at its widest visible spot near the middle of the map.
  let riverLabel: [number, number] | null = null;
  {
    let best = Infinity;
    for (const w of rivers) {
      for (let i = 0; i + 1 < w.ring.length; i += 2) {
        const x = px(w.ring[i] ?? 0);
        const y = py(w.ring[i + 1] ?? 0);
        if (x < 20 || x > W - 40 || y < 12 || y > H - 12) continue;
        const d = Math.hypot(x - W * 0.42, y - H * 0.2);
        if (d < best) {
          best = d;
          riverLabel = [x, y];
        }
      }
    }
  }

  const landmarks = REAL_LANDMARKS.map((spec) => {
    for (const id of spec.ids) {
      const l = city.landmarks.find((c) => c.id === id && !c.missing);
      const x = id === "puente-real" ? (l?.pylon?.x ?? l?.x) : l?.x;
      const z = id === "puente-real" ? (l?.pylon?.z ?? l?.z) : l?.z;
      if (l && x !== undefined && z !== undefined) return glyphAt(px(x), py(z), spec.glyph, spec.small ? 0.7 : 0.85);
    }
    return "";
  }).join("");

  // Hover targets: consecutive sections with the same name.
  const streets: { d: string; name: string }[] = [];
  {
    let cur: { name: string; fromS: number; toS: number } | null = null;
    const flush = (): void => {
      if (cur) streets.push({ name: cur.name, d: span(cur.fromS, cur.toS) });
      cur = null;
    };
    for (const sec of city.sections) {
      if (!sec.name) {
        flush();
        continue;
      }
      if (cur && cur.name === sec.name && Math.abs(cur.toS - sec.fromS) < 1) cur.toS = sec.toS;
      else {
        flush();
        cur = { name: sec.name, fromS: sec.fromS, toS: sec.toS };
      }
    }
    flush();
  }
  const sections = city.sections;
  const nameAt = (s: number): string | null => {
    let lo = 0;
    let hi = sections.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((sections[mid]?.fromS ?? 0) <= s) lo = mid;
      else hi = mid - 1;
    }
    return sections[lo]?.name ?? null;
  };

  let cx = 0;
  let cy = 0;
  for (let j = 0; j < m; j++) {
    cx += KX[j] ?? 0;
    cy += KY[j] ?? 0;
  }
  cx /= m;
  cy /= m;

  return {
    real: true,
    w: W,
    h: H,
    total,
    routePath: span(0, lap),
    zonePaths: zoneSpans.map((z) => span(z.fromS, z.toS)),
    ticks: zoneSpans.map((z) => {
      const p = at(z.fromS);
      return [p.x, p.y];
    }),
    water: riverD ? `<path d="${riverD}" class="mm-water" fill-rule="evenodd"/>` : "",
    riverLabel,
    landmarks,
    labels: zoneSpans.map((z) => {
      const p = at((z.fromS + z.toS) / 2);
      return labelFor(p.x, p.y, cx, cy, 13);
    }),
    streets,
    locate: (zoneIndex, progress) => at(sAt(zoneIndex, progress)),
    streetAt: (zoneIndex, progress) => nameAt(sAt(zoneIndex, progress)),
  };
}

// ---------------------------------------------------------------- current geometry

let geometry: MapGeometry = stylised();
let version = 0;

export const mapGeometry = (): MapGeometry => geometry;

/** Swap the geometry; live maps redraw on their next update. */
export function setMapGeometry(g: MapGeometry): void {
  geometry = g;
  version++;
}

onCity((city) => {
  try {
    setMapGeometry(realGeometry(city));
  } catch (err) {
    console.error("[shell] could not build the real map, keeping the stylised one", err);
  }
});

const SHORT_NAMES = ["Puente Real", "Valdepasillas", "San Francisco", "Casco Antiguo", "Alcazaba", "Margen dcha."];

// ---------------------------------------------------------------- component

export interface MinimapOptions {
  /** Zone names next to the route, street names on hover. */
  labels?: boolean;
  /** Monochrome "printed" look for the receipt. */
  ink?: boolean;
  className?: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export class Minimap {
  readonly el: HTMLElement;
  private done: SVGPathElement | null = null;
  private dot: SVGGElement | null = null;
  private last = "";
  private built = -1;
  private pos: [number, number] = [0, 0];

  constructor(private readonly opts: MinimapOptions = {}) {
    this.el = document.createElement("div");
    this.el.className = `minimap${opts.ink ? " ink" : ""}${opts.className ? ` ${opts.className}` : ""}`;
    this.build();
    this.update(0, 0);
  }

  private build(): void {
    const g = geometry;
    this.built = version;
    this.last = "";
    this.el.classList.toggle("real", g.real);
    const ticks = g.ticks.map(([x, y]) => `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="2.4" class="mm-tick"/>`).join("");
    const labels = this.opts.labels
      ? g.labels
          .map((l, i) => `<text x="${fmt(l.x)}" y="${fmt(l.y)}" text-anchor="${l.anchor}" class="mm-label" data-zone="${i}">${SHORT_NAMES[i] ?? ZONES[i]?.name ?? ""}</text>`)
          .join("")
      : "";
    const escape = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const hits = this.opts.labels
      ? g.streets.map((s) => `<path d="${s.d}" class="mm-hit"><title>${escape(s.name)}</title></path>`).join("")
      : "";
    const zones = g.zonePaths.map((d, i) => `<path d="${d}" class="mm-zone mm-z${i}"/>`).join("");
    const vb = this.opts.labels ? `-52 -8 ${g.w + 104} ${g.h + 16}` : `0 0 ${g.w} ${g.h}`;
    const river = g.riverLabel && this.opts.labels ? `<text class="mm-river-name" x="${fmt(g.riverLabel[0])}" y="${fmt(g.riverLabel[1])}">Guadiana</text>` : "";
    this.el.innerHTML = `
      <svg viewBox="${vb}" xmlns="${SVG_NS}" role="img" aria-label="Mapa de la huida por Badajoz">
        ${g.water}
        ${river}
        <path d="${g.routePath}" class="mm-route-bg"/>
        ${zones}
        <path d="${g.routePath}" class="mm-done" stroke-dasharray="0 ${fmt(g.total + 1)}"/>
        ${ticks}
        ${g.landmarks}
        ${hits}
        ${labels}
        <g class="mm-dot"><circle r="7" class="mm-pulse"/><path d="M8 0 L3.2 -3.4 L3.2 3.4 Z" class="mm-heading"/><circle r="4.2" class="mm-runner"/></g>
      </svg>`;
    this.done = this.el.querySelector(".mm-done");
    this.dot = this.el.querySelector(".mm-dot");
  }

  /** Place the runner: zone index (0..5) and 0..1 progress through it. */
  update(zoneIndex: number, progress: number): void {
    if (this.built !== version) this.build();
    const p = geometry.locate(zoneIndex, progress);
    const key = `${zoneIndex}:${p.len.toFixed(1)}`;
    if (key === this.last) return;
    this.last = key;
    this.pos = [p.x, p.y];
    this.done?.setAttribute("stroke-dasharray", `${fmt(p.len)} ${fmt(geometry.total + 1)}`);
    this.dot?.setAttribute("transform", `translate(${fmt(p.x)} ${fmt(p.y)}) rotate(${p.angle.toFixed(0)})`);
    this.el.querySelectorAll<SVGTextElement>(".mm-label").forEach((t) => {
      t.classList.toggle("here", Number(t.dataset["zone"]) === zoneIndex);
    });
  }

  /** Last runner position in map units (for tests and the harness). */
  get position(): [number, number] {
    return this.pos;
  }
}

export const shortZoneName = (index: number): string => SHORT_NAMES[index] ?? ZONES[index]?.name ?? "";

export const zoneIndexOf = (id: string): number => Math.max(0, ZONES.findIndex((z) => z.id === id));

/** Street at a zone position from the map data (null until the real map has loaded). */
export const streetFromMap = (zoneIndex: number, progress: number): string | null => geometry.streetAt(zoneIndex, progress);
