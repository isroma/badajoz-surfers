/**
 * Lane layouts: turns the real street sections of city.json into the runner's lanes.
 *
 * Reference line: the route centreline = the centre of OUR carriageway (for a single two-way road,
 * the road's centre). Offsets are metres from it, + to the runner's RIGHT.
 *
 * Rules (numbers are the constants below):
 * - Dual carriageway (`dual`, |opposite.offset| ≤ MAX_DUAL_OFFSET): our n lanes centred on 0
 *   (lane width = width / n clamped to ROAD_LANE_MIN..ROAD_LANE_MAX), flow +1; the other
 *   carriageway's lanes (opposite.lanes) centred on opposite.offset (see medianWidth below) with the
 *   same lane width, flow -1. The strip between them is a median; its two edge lanes still count as
 *   adjacent (a lane change crosses it). With n = 1 the right-hand sidewalk becomes a lane too.
 *   Medians: when the gap between the inner kerbs is ≥ MEDIAN_RUNNABLE_GAP (3.5 m), kind
 *   "median" lanes (flow 0) run on it so a lane change never leaps the whole boulevard: one lane
 *   if the gap is < MEDIAN_TWO_LANE_GAP (7 m), else two; fewer if that would exceed MAX_LANES
 *   (a 2+2 avenue gets one). Width: one lane gap − 2·0.3, two lanes gap/2 − 0.3 each, clamped
 *   1.8–3.0. Their centres are spaced evenly between the two inner road-lane centres. Narrower
 *   gaps stay non-runnable (Puente Real's cable plane, 1.6 m → 4.9 m lane change) unless the
 *   lane change across them would exceed MAX_ACROSS_MEDIAN (5.5 m) and a 1.8 m lane fits
 *   (Avenida de Elvas: 3.3 m gap, 6.8 m across → one 2.7 m median lane). The `median` strip is
 *   always the whole gap, for drawing.
 *   The gap is the data's `medianWidth` (kerb to kerb) when present — the other carriageway is
 *   placed from it — else |opposite.offset| minus both half-carriageways.
 *   The opposite offset (and medianWidth) is the length-weighted median over each run of consecutive dual
 *   sections with the same name and lane counts, so small drifts in the data (−10.3/−10.6 on
 *   Adolfo Díaz Ambrona) do not flip the median-lane count back and forth.
 *   Opposite lanes are dropped from the left if the total would exceed MAX_LANES. A wider gap
 *   (|offset| > MAX_DUAL_OFFSET) or one too narrow for both carriageways is treated as a plain
 *   one-way street.
 * - Single two-way carriageway: 2 lanes (a tagged 1 is treated as 2) → [-1, +1] plus both
 *   sidewalks (4 lanes). 3–4 lanes: split by direction, the runner's right-hand ceil(n/2) lanes are
 *   +1 (Spain drives on the right), sidewalks only while the total is < MIN_LANES.
 * - One-way street (not a ring): all road lanes +1, then sidewalks (right first) until MIN_LANES.
 * - Roundabout ring: road lanes = round(width / RING_LANE_WIDTH) clamped 2..3, all +1, centred on
 *   0; then the outer (right) sidewalk, then the inner (left) apron, until the lane count equals
 *   the approach's (previous section's) count, and at least MIN_LANES.
 * - Pedestrian street / plaza / footbridge (`pedestrian`, or highway pedestrian/footway/…):
 *   usable width U = deck width − PED_DECK_MARGIN on bridges, else clearance ?? facadeWidth ??
 *   width (PED_DEFAULT_WIDTH when only the pipeline's 3 m default is known). U < PED_NARROW → 2 lanes at spacing clamp(U / 2, PED_MIN_SPACING, PED_MAX_SPACING),
 *   else 3 lanes at clamp(U / 3, …). Kind "pedestrian", flow 0, no carriageway; the whole
 *   paved width is reported as one sidewalk strip for drawing.
 * - Sidewalk lanes (kind "sidewalk", flow 0) sit just outside the kerb: centre = kerb ± w/2 with
 *   w = (facadeWidth − road surface) / 2 − SIDEWALK_FACADE_MARGIN clamped to SIDEWALK_MIN..MAX
 *   when facades are known, SIDEWALK_MIN where OSM says `sidewalk=no`, else SIDEWALK_DEFAULT.
 *   Every road layout also reports outer sidewalk strips (for drawing) whether runnable or not.
 * - 2 ≤ lanes ≤ MAX_LANES; only narrow pedestrian streets have 2.
 *
 * Stabilisation (`buildStretches`), on the circular list of sections:
 * 1. Consecutive sections whose layouts are compatible (same lane kinds/flows/strip counts, every
 *    offset and edge within MERGE_TOLERANCE) are merged; the merged layout is the
 *    length-weighted average.
 * 2. Stretches shorter than MIN_STRETCH are absorbed (shortest first) into a neighbour, taking the
 *    neighbour's layout. Preferred neighbour: same class (pedestrian vs road), then not a ring, then
 *    same lane count, then longer. A ring is never absorbed into a layout with oncoming lanes (a
 *    median layout would put them inside the island, a two-way one would send traffic the wrong
 *    way round); such a ring keeps its own layout even when short.
 * 3. A stretch shorter than SANDWICH_MAX whose two neighbours are compatible with each other (and
 *    which is not a ring) is absorbed into them (A B A → A), then step 1 again.
 * Layouts are piecewise constant over stretches; TRANSITION_LENGTH is the suggested length over
 * which the engine/art should blend lane positions after a stretch boundary.
 */
import type { CitySection } from "./data";

export type LaneKind = "road" | "sidewalk" | "pedestrian" | "median";
export type Flow = 1 | -1 | 0;

export interface Strip {
  from: number;
  to: number;
}

export interface LaneLayout {
  /** Stable key; same id = same layout (built from the rounded numbers). */
  id: string;
  /** Lane centres, metres from the route centreline, + to the runner's right, ascending. */
  offsets: readonly number[];
  /** Usable width of each lane. */
  widths: readonly number[];
  /** +1 traffic drives the runner's way, -1 oncoming, 0 no vehicles. */
  flow: readonly Flow[];
  kinds: readonly LaneKind[];
  /** Outer limits of the runnable surface (outer edges of the outermost lanes). */
  left: number;
  right: number;
  /** Asphalt strips (kerb to kerb) for drawing; gaps between them are medians. */
  carriageways: readonly { from: number; to: number; flow: Flow }[];
  /** Paved pedestrian strips beside the carriageways (runnable or not). */
  sidewalks: readonly Strip[];
  /** Drawing info: the whole gap between carriageways, whether or not a median lane runs on it. */
  median: readonly Strip[];
  /** Centre-to-centre distance between consecutive lanes (length = lanes − 1), to scale lane-change time. */
  gaps: readonly number[];
}

export const ROAD_LANE_MIN = 2.9;
export const ROAD_LANE_MAX = 3.5;
export const SIDEWALK_MIN = 2.0;
export const SIDEWALK_MAX = 2.6;
export const SIDEWALK_DEFAULT = 2.2;
export const SIDEWALK_FACADE_MARGIN = 0.5;
export const PED_MAX_SPACING = 2.6;
export const PED_MIN_SPACING = 1.5;
export const PED_NARROW = 4.5;
export const PED_DECK_MARGIN = 0.6;
/** Usable width assumed for a pedestrian way with no measured width at all (OSM default 3 m). */
export const PED_DEFAULT_WIDTH = 6;
/** Drawn paved width of pedestrian streets is clamped to this (open plazas would be huge). */
export const PED_MAX_PAVED = 14;
export const RING_LANE_WIDTH = 3.3;
export const MAX_DUAL_OFFSET = 20;
/** Median lanes: a gap between inner kerbs ≥ this gets runnable lanes on it. */
export const MEDIAN_RUNNABLE_GAP = 3.5;
/** …two lanes from this gap on (one if that would exceed MAX_LANES). */
export const MEDIAN_TWO_LANE_GAP = 7;
export const MEDIAN_LANE_MAX = 3.0;
/** Largest centre-to-centre lane change across a non-runnable median. */
export const MAX_ACROSS_MEDIAN = 5.5;
export const MEDIAN_LANE_MIN = 1.8;
export const MEDIAN_LANE_MARGIN = 0.3;
export const MIN_LANES = 3;
export const MAX_LANES = 5;
export const MIN_STRETCH = 60;
export const SANDWICH_MAX = 100;
export const MERGE_TOLERANCE = 0.75;
export const TRANSITION_LENGTH = 12;

const PED_HIGHWAYS = new Set(["pedestrian", "footway", "living_street", "cycleway", "steps", "path"]);

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function isPedestrianSection(sec: CitySection): boolean {
  return sec.pedestrian || sec.lanes === 0 || PED_HIGHWAYS.has(sec.highway);
}

/** A layout before it gets its id; all arrays mutable while building. */
interface Draft {
  lanes: { offset: number; width: number; flow: Flow; kind: LaneKind }[];
  carriageways: { from: number; to: number; flow: Flow }[];
  sidewalks: Strip[];
  median: Strip[];
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

function layoutId(d: Draft): string {
  const f = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);
  const lanes = d.lanes.map((l) => `${l.kind[0]}${l.flow > 0 ? "+" : l.flow < 0 ? "-" : "0"}@${f(l.offset)}/${f(l.width)}`).join(",");
  const cw = d.carriageways.map((c) => `${f(c.from)}:${f(c.to)}`).join(",");
  const sw = d.sidewalks.map((c) => `${f(c.from)}:${f(c.to)}`).join(",");
  return `${lanes}|c${cw}|s${sw}`;
}

function finish(d: Draft): LaneLayout {
  const lanes = [...d.lanes].sort((a, b) => a.offset - b.offset);
  const sorted: Draft = {
    lanes: lanes.map((l) => ({ ...l, offset: r2(l.offset), width: r2(l.width) })),
    carriageways: [...d.carriageways].sort((a, b) => a.from - b.from).map((c) => ({ from: r2(c.from), to: r2(c.to), flow: c.flow })),
    sidewalks: [...d.sidewalks].sort((a, b) => a.from - b.from).map((c) => ({ from: r2(c.from), to: r2(c.to) })),
    median: [...d.median].sort((a, b) => a.from - b.from).map((c) => ({ from: r2(c.from), to: r2(c.to) })),
  };
  const first = sorted.lanes[0];
  const last = sorted.lanes[sorted.lanes.length - 1];
  return {
    id: layoutId(sorted),
    offsets: sorted.lanes.map((l) => l.offset),
    widths: sorted.lanes.map((l) => l.width),
    flow: sorted.lanes.map((l) => l.flow),
    kinds: sorted.lanes.map((l) => l.kind),
    gaps: sorted.lanes.slice(1).map((l, i) => r2(l.offset - sorted.lanes[i]!.offset)),
    left: first ? r2(first.offset - first.width / 2) : 0,
    right: last ? r2(last.offset + last.width / 2) : 0,
    carriageways: sorted.carriageways,
    sidewalks: sorted.sidewalks,
    median: sorted.median,
  };
}

/** Sidewalk width beside a road whose paved surface (kerb to kerb, all carriageways) is `road` wide. */
export function sidewalkWidth(sec: CitySection, road: number): number {
  if (sec.sidewalk === "no" || sec.sidewalk === "none") return SIDEWALK_MIN;
  if (sec.facadeWidth !== null && sec.facadeWidth > road) {
    return clamp((sec.facadeWidth - road) / 2 - SIDEWALK_FACADE_MARGIN, SIDEWALK_MIN, SIDEWALK_MAX);
  }
  return SIDEWALK_DEFAULT;
}

/** Usable width between walls / parapets of a pedestrian section. */
export function pedestrianUsableWidth(sec: CitySection): number {
  if (sec.deckWidth !== null && sec.bridge !== null) return sec.deckWidth - PED_DECK_MARGIN;
  if (sec.clearance === null && sec.facadeWidth === null && sec.widthSource === "default") return PED_DEFAULT_WIDTH;
  return sec.clearance ?? sec.facadeWidth ?? sec.width;
}

function pedestrianDraft(sec: CitySection): Draft {
  const u = pedestrianUsableWidth(sec);
  const n = u < PED_NARROW ? 2 : 3;
  const sp = clamp(u / n, PED_MIN_SPACING, PED_MAX_SPACING);
  const lanes = [];
  for (let i = 0; i < n; i++) lanes.push({ offset: (i - (n - 1) / 2) * sp, width: sp, flow: 0 as Flow, kind: "pedestrian" as LaneKind });
  const paved = clamp(u, n * sp, PED_MAX_PAVED);
  return { lanes, carriageways: [], sidewalks: [{ from: -paved / 2, to: paved / 2 }], median: [] };
}

/** Adds road lanes [from..] across a carriageway centred on `centre`. */
function addRoad(d: Draft, centre: number, n: number, w: number, flowOf: (i: number) => Flow): void {
  const left = centre - (n * w) / 2;
  for (let i = 0; i < n; i++) d.lanes.push({ offset: left + (i + 0.5) * w, width: w, flow: flowOf(i), kind: "road" });
}

/** Adds sidewalk lanes outside the kerbs (right first, then left) until `target` lanes. */
function addSidewalkLanes(d: Draft, kerbL: number, kerbR: number, sw: number, target: number): void {
  if (d.lanes.length < target) d.lanes.push({ offset: kerbR + sw / 2, width: sw, flow: 0, kind: "sidewalk" });
  if (d.lanes.length < target) d.lanes.push({ offset: kerbL - sw / 2, width: sw, flow: 0, kind: "sidewalk" });
}

/**
 * Runnable median lanes in the gap [gapL, gapR] between the carriageways' inner kerbs, spaced
 * evenly between the two inner road-lane centres a (oncoming) and b (ours). See the header.
 */
function addMedianLanes(d: Draft, gapL: number, gapR: number, a: number, b: number): void {
  const gap = gapR - gapL;
  const across = (b - a) - (gapR - gapL) > 0 ? b - a : gap;
  // Runnable from 3.5 m; narrower gaps too when the lane change across them would exceed
  // MAX_ACROSS_MEDIAN and a minimum-width lane fits.
  const runnable = gap >= MEDIAN_RUNNABLE_GAP || (across > MAX_ACROSS_MEDIAN && gap >= MEDIAN_LANE_MIN + 2 * MEDIAN_LANE_MARGIN);
  if (!runnable) return;
  let k = gap < MEDIAN_TWO_LANE_GAP ? 1 : 2;
  while (k > 0 && d.lanes.length + k > MAX_LANES) k--;
  if (k === 0) return;
  const w = k === 1
    ? clamp(gap - 2 * MEDIAN_LANE_MARGIN, MEDIAN_LANE_MIN, MEDIAN_LANE_MAX)
    : clamp(gap / 2 - MEDIAN_LANE_MARGIN, MEDIAN_LANE_MIN, MEDIAN_LANE_MAX);
  for (let j = 1; j <= k; j++) d.lanes.push({ offset: a + ((b - a) * j) / (k + 1), width: w, flow: 0, kind: "median" });
}

/**
 * Layout of one section on its own. `approachLanes` is the lane count of the previous section
 * (used by rings to keep the count steady).
 */
export function sectionLayout(sec: CitySection, approachLanes = MIN_LANES): LaneLayout {
  return finish(sectionDraft(sec, approachLanes));
}

function sectionDraft(sec: CitySection, approachLanes: number): Draft {
  if (isPedestrianSection(sec)) return pedestrianDraft(sec);
  const d: Draft = { lanes: [], carriageways: [], sidewalks: [], median: [] };

  if (sec.roundabout) {
    const n = clamp(Math.round(sec.width / RING_LANE_WIDTH), 2, 3);
    const w = clamp(sec.width / n, ROAD_LANE_MIN, ROAD_LANE_MAX);
    addRoad(d, 0, n, w, () => 1);
    const half = (n * w) / 2;
    const sw = sidewalkWidth(sec, n * w);
    d.carriageways.push({ from: -half, to: half, flow: 1 });
    d.sidewalks.push({ from: half, to: half + sw });
    addSidewalkLanes(d, -half, half, sw, clamp(approachLanes, MIN_LANES, MAX_LANES));
    if (d.lanes.some((l) => l.kind === "sidewalk" && l.offset < 0)) d.sidewalks.push({ from: -half - sw, to: -half });
    return d;
  }

  const lanes = Math.max(1, sec.lanes);
  const opp = sec.opposite;
  if (sec.dual && opp) {
    const n = Math.min(lanes, 3);
    const w = clamp(sec.width / n, ROAD_LANE_MIN, ROAD_LANE_MAX);
    const m = Math.max(1, Math.min(opp.lanes, MAX_LANES - n));
    // Prefer the pipeline's kerb-to-kerb median width: it places the other carriageway's inner
    // kerb exactly, whatever lane width we chose.
    const off = sec.medianWidth !== null && sec.medianWidth > 0 ? -((n * w) / 2 + sec.medianWidth + (m * w) / 2) : opp.offset;
    const fits = Math.abs(off) >= ((n + m) * w) / 2 + 0.3;
    if (Math.abs(off) <= MAX_DUAL_OFFSET && fits && off < 0) {
      const half = (n * w) / 2;
      const oppL = off - (m * w) / 2;
      const oppR = off + (m * w) / 2;
      const sw = sidewalkWidth(sec, half + (-oppL));
      addRoad(d, off, m, w, () => -1);
      addRoad(d, 0, n, w, () => 1);
      d.carriageways.push({ from: oppL, to: oppR, flow: -1 }, { from: -half, to: half, flow: 1 });
      d.median.push({ from: oppR, to: -half });
      d.sidewalks.push({ from: oppL - sw, to: oppL }, { from: half, to: half + sw });
      if (n === 1) d.lanes.push({ offset: half + sw / 2, width: sw, flow: 0, kind: "sidewalk" });
      addMedianLanes(d, oppR, -half, off + ((m - 1) / 2) * w, -((n - 1) / 2) * w);
      return d;
    }
  }

  if (sec.oneway) {
    const n = Math.min(lanes, 4);
    const w = clamp(sec.width / n, ROAD_LANE_MIN, ROAD_LANE_MAX);
    const half = (n * w) / 2;
    const sw = sidewalkWidth(sec, n * w);
    addRoad(d, 0, n, w, () => 1);
    d.carriageways.push({ from: -half, to: half, flow: 1 });
    d.sidewalks.push({ from: -half - sw, to: -half }, { from: half, to: half + sw });
    addSidewalkLanes(d, -half, half, sw, MIN_LANES);
    return d;
  }

  // Single two-way carriageway.
  const n = clamp(lanes, 2, 4);
  const w = clamp(sec.width / n, ROAD_LANE_MIN, ROAD_LANE_MAX);
  const half = (n * w) / 2;
  const sw = sidewalkWidth(sec, n * w);
  const oncoming = Math.floor(n / 2);
  addRoad(d, 0, n, w, (i) => (i < oncoming ? -1 : 1));
  d.carriageways.push({ from: -half, to: half, flow: 0 });
  d.sidewalks.push({ from: -half - sw, to: -half }, { from: half, to: half + sw });
  addSidewalkLanes(d, -half, half, sw, n === 2 ? 4 : MIN_LANES);
  return d;
}

// ---------------------------------------------------------------------------
// Stabilisation
// ---------------------------------------------------------------------------

export function compatible(a: LaneLayout, b: LaneLayout, tol = MERGE_TOLERANCE): boolean {
  if (a.offsets.length !== b.offsets.length) return false;
  if (a.carriageways.length !== b.carriageways.length || a.sidewalks.length !== b.sidewalks.length || a.median.length !== b.median.length) return false;
  for (let i = 0; i < a.offsets.length; i++) {
    if (a.flow[i] !== b.flow[i] || a.kinds[i] !== b.kinds[i]) return false;
    if (Math.abs((a.offsets[i] ?? 0) - (b.offsets[i] ?? 0)) > tol) return false;
    if (Math.abs((a.widths[i] ?? 0) - (b.widths[i] ?? 0)) > tol) return false;
  }
  const strips = (x: readonly Strip[], y: readonly Strip[]): boolean =>
    x.every((s, i) => {
      const t = y[i];
      return t !== undefined && Math.abs(s.from - t.from) <= tol && Math.abs(s.to - t.to) <= tol;
    });
  return strips(a.carriageways, b.carriageways) && strips(a.sidewalks, b.sidewalks) && strips(a.median, b.median) &&
    a.carriageways.every((c, i) => c.flow === b.carriageways[i]?.flow);
}

/** Length-weighted average of two compatible layouts. */
function blend(a: LaneLayout, wa: number, b: LaneLayout, wb: number): LaneLayout {
  const t = wb / (wa + wb);
  const mix = (x: number, y: number): number => x + (y - x) * t;
  const mixStrips = (x: readonly Strip[], y: readonly Strip[]): Strip[] =>
    x.map((s, i) => ({ from: mix(s.from, y[i]?.from ?? s.from), to: mix(s.to, y[i]?.to ?? s.to) }));
  return finish({
    lanes: a.offsets.map((o, i) => ({
      offset: mix(o, b.offsets[i] ?? o),
      width: mix(a.widths[i] ?? 0, b.widths[i] ?? 0),
      flow: a.flow[i] ?? 0,
      kind: a.kinds[i] ?? "road",
    })),
    carriageways: a.carriageways.map((c, i) => ({ ...mixStrips([c], [b.carriageways[i] ?? c])[0]!, flow: c.flow })),
    sidewalks: mixStrips(a.sidewalks, b.sidewalks),
    median: mixStrips(a.median, b.median),
  });
}

export interface Stretch {
  fromS: number;
  toS: number;
  layout: LaneLayout;
  /** The longest city section inside the stretch. */
  section: CitySection;
}

interface Group {
  /** Section indices in order (may wrap past the end of the list). */
  secs: number[];
  len: number;
  layout: LaneLayout;
  ring: boolean;
  ped: boolean;
}

const hasOncoming = (l: LaneLayout): boolean => l.flow.includes(-1);

/** Length-weighted median of `off` (0 for an empty list). */
function weightedMedian(run: { off: number; len: number }[]): number {
  const sorted = [...run].sort((a, b) => a.off - b.off);
  const total = sorted.reduce((acc, r) => acc + r.len, 0);
  let acc = 0;
  for (const r of sorted) {
    acc += r.len;
    if (acc >= total / 2) return r.off;
  }
  return sorted[sorted.length - 1]?.off ?? 0;
}

/**
 * Builds the stabilised stretches over the lap from the sections (which must be contiguous and
 * cover 0..lapLength). Returns stretches split at s = 0 / lapLength, in order.
 */
export function buildStretches(sections: readonly CitySection[], lapLength: number): Stretch[] {
  const n = sections.length;
  if (n === 0) throw new Error("buildStretches: no sections");
  const secLen = (i: number): number => {
    const s = sections[i]!;
    return s.toS - s.fromS;
  };

  // Steady opposite offsets per run of like dual sections (length-weighted median).
  const steady: CitySection[] = sections.map((x) => x);
  const runKey = (x: CitySection): string | null =>
    x.dual && x.opposite && !x.roundabout ? `${x.name ?? ""}|${x.lanes}|${x.opposite.lanes}` : null;
  for (let i = 0; i < n; ) {
    const key = runKey(sections[i]!);
    let j = i + 1;
    while (key !== null && j < n && runKey(sections[j]!) === key) j++;
    if (key !== null && j - i > 1) {
      const med = weightedMedian(sections.slice(i, j).map((x) => ({ off: x.opposite!.offset, len: x.toS - x.fromS })));
      const medianWidths = sections.slice(i, j).map((x) => ({ off: x.medianWidth, len: x.toS - x.fromS }));
      const mw = weightedMedian(medianWidths.filter((r): r is { off: number; len: number } => r.off !== null));
      for (let k = i; k < j; k++) {
        const x = sections[k]!;
        steady[k] = { ...x, opposite: { ...x.opposite!, offset: med }, medianWidth: x.medianWidth === null ? null : mw };
      }
    }
    i = j;
  }

  // Raw layouts; rings look at the previous non-ring section's lane count.
  const raw: LaneLayout[] = new Array<LaneLayout>(n);
  const plain = (i: number): LaneLayout => sectionLayout(steady[i]!);
  for (let i = 0; i < n; i++) {
    const sec = sections[i]!;
    if (sec.roundabout && !isPedestrianSection(sec)) {
      let j = (i - 1 + n) % n;
      while (j !== i && sections[j]!.roundabout) j = (j - 1 + n) % n;
      raw[i] = sectionLayout(steady[i]!, plain(j).offsets.length);
    } else raw[i] = plain(i);
  }

  let groups: Group[] = sections.map((sec, i) => ({
    secs: [i],
    len: secLen(i),
    layout: raw[i]!,
    ring: sec.roundabout !== null && !isPedestrianSection(sec),
    ped: isPedestrianSection(sec),
  }));

  const join = (a: Group, b: Group, layout: LaneLayout, like: Group): Group => ({
    secs: [...a.secs, ...b.secs],
    len: a.len + b.len,
    layout,
    ring: like.ring,
    ped: like.ped,
  });

  /** Merges compatible neighbours (circularly). */
  const mergeCompatible = (): void => {
    let changed = true;
    while (changed && groups.length > 1) {
      changed = false;
      for (let i = 0; i < groups.length && groups.length > 1; i++) {
        const j = (i + 1) % groups.length;
        const a = groups[i]!;
        const b = groups[j]!;
        if (a.ring !== b.ring || a.ped !== b.ped || !compatible(a.layout, b.layout)) continue;
        replacePair(i, j, join(a, b, blend(a.layout, a.len, b.layout, b.len), a));
        changed = true;
        i--;
      }
    }
  };
  const replacePair = (i: number, j: number, g: Group): void => {
    if (j === 0) {
      // Wrapped pair: the merged group sits at the end, its sections start in the last group.
      groups.splice(i, 1, g);
      groups.shift();
    } else groups.splice(i, 2, g);
  };

  mergeCompatible();

  // Absorb short stretches.
  const frozen = new Set<Group>();
  for (;;) {
    if (groups.length <= 1) break;
    let best = -1;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]!;
      if (g.len >= MIN_STRETCH || frozen.has(g)) continue;
      if (best < 0 || g.len < groups[best]!.len) best = i;
    }
    if (best < 0) break;
    const g = groups[best]!;
    const L = groups.length;
    const cands = [(best - 1 + L) % L, (best + 1) % L]
      .filter((k, idx, arr) => arr.indexOf(k) === idx && k !== best)
      .filter((k) => !(g.ring && hasOncoming(groups[k]!.layout)));
    if (cands.length === 0) {
      frozen.add(g);
      continue;
    }
    const score = (k: number): number => {
      const o = groups[k]!;
      return (o.ped === g.ped ? 8 : 0) + (o.ring ? 0 : 4) + (o.layout.offsets.length === g.layout.offsets.length ? 2 : 0) + o.len / 1e6;
    };
    cands.sort((x, y) => score(y) - score(x));
    const k = cands[0]!;
    const o = groups[k]!;
    const before = k === (best - 1 + L) % L;
    const merged = before ? join(o, g, o.layout, o) : join(g, o, o.layout, o);
    if (before) replacePair(k, best, merged);
    else replacePair(best, k, merged);
    mergeCompatible();
  }

  // Sandwich rule: A B A → A.
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 0; i < groups.length && groups.length >= 3; i++) {
      const L = groups.length;
      const g = groups[i]!;
      const a = groups[(i - 1 + L) % L]!;
      const b = groups[(i + 1) % L]!;
      if (g.ring || g.len >= SANDWICH_MAX || a === b || a.ped !== b.ped || a.ring !== b.ring || !compatible(a.layout, b.layout)) continue;
      replacePair(i, (i + 1) % L, join(g, b, b.layout, b));
      mergeCompatible();
      changed = true;
      break;
    }
    if (!changed) break;
  }

  // Deduplicate layouts by id, then emit stretches split at the seam.
  const byId = new Map<string, LaneLayout>();
  const out: Stretch[] = [];
  const emit = (secs: number[], layout: LaneLayout, fromS: number, toS: number): void => {
    let longest = secs[0]!;
    for (const i of secs) if (secLen(i) > secLen(longest)) longest = i;
    out.push({ fromS, toS, layout, section: sections[longest]! });
  };
  for (const g of groups) {
    const layout = byId.get(g.layout.id) ?? g.layout;
    byId.set(layout.id, layout);
    let piece: number[] = [];
    for (const i of g.secs) {
      const prev = piece[piece.length - 1];
      if (prev !== undefined && i < prev) {
        emit(piece, layout, sections[piece[0]!]!.fromS, lapLength);
        piece = [];
      }
      piece.push(i);
    }
    emit(piece, layout, piece[0] === 0 ? 0 : sections[piece[0]!]!.fromS, sections[piece[piece.length - 1]!]!.toS);
  }
  out.sort((x, y) => x.fromS - y.fromS);
  return out;
}
