/**
 * Lane layouts: turns the real street sections of city.json into the runner's lanes.
 *
 * Design rule (docs/design.md, "The road and the route"): lanes are STABLE. A lane keeps its id
 * and its lateral offset across stretches, junctions and roundabouts; the game never moves the
 * runner sideways. A lane that really ends is reported ahead (see Track.laneEndsAhead).
 *
 * Offsets are metres from the route centreline, + to the runner's RIGHT. Canonical anchor: the
 * KERB lane of our carriageway ("own-1") is always centred on the centreline (offset 0), so
 * whatever the street, own-1 never moves. Further own lanes are added towards the LEFT (own-2 at
 * about −w, own-3 at −2w): ids count from the kerb, not left to right, because that is the only
 * numbering in which a change of lane count moves nothing (a 2-lane carriageway drawn centred on
 * the polyline is 1.6 m off its OSM axis; that is the price of stability).
 *
 * Lane ids: "own-1".."own-3" (ours, from the kerb leftwards), "opp-1", "opp-2" (oncoming, from the
 * centre outwards), "median", "walk-L", "walk-R", "ped-1".."ped-3" (left to right), "ring-2",
 * "ring-3" (ring lanes beyond the approach's own lanes; they exist only on the ring arc).
 *
 * Rules (numbers are the constants below):
 * - Road lane width w = carriageway width / lanes, clamped ROAD_LANE_MIN..ROAD_LANE_MAX.
 * - Own lanes: dual or one-way: min(lanes, 3); single two-way with n lanes (2..4): ceil(n/2).
 * - Runnable lanes are car-road lanes. Opposite lanes ("opp-*", flow −1) are runnable on single
 *   two-way carriageways (right next to own lanes) and on dual carriageways whose median is
 *   narrow (< MEDIAN_RUNNABLE_GAP) and crossable (medianKind cable-plane / kerb / unmapped / null):
 *   Puente Real = opp-2 opp-1 own-2 own-1. Medians are NEVER runnable (`median` strips are drawing
 *   info only); the gap is the data's `medianWidth` when present.
 * - Pavement lanes only to reach MIN_LANES: "walk-R" (centre = kerb + sw/2, sw from facades,
 *   SIDEWALK_* constants) when road lanes < 3, then "walk-L" only on one-way streets (nothing on
 *   the left). So 2-lane avenue carriageways = own-2 own-1 walk-R; two-way streets = opp-1 own-1
 *   walk-R; one-lane one-way = walk-L own-1 walk-R; a one-lane carriageway of a dual avenue =
 *   own-1 walk-R (its left is the median).
 * - Pedestrian streets / plazas / footbridges: "ped-1..3" centred (2 under PED_NARROW between
 *   walls), spacing clamp(U / n, PED_MIN_SPACING, PED_MAX_SPACING).
 * - Roundabout rings (the arc entryS..exitS): the ring's real circulating lanes from
 *   city.roundabouts (ringLayoutFromData). Lanes flow through the ring 1:1 in order from the kerb
 *   (mapLanesInOrder, aligned so a pavement on one side only does not shift the pairing): own-1 ↔
 *   the outer ring lane, own-2 ↔ the second, the approach's next lane inward (opp-1 on Puente
 *   Real, ped-1) ↔ the third; walk-R continues round the ring when the approach has it. Only lanes
 *   without a counterpart end; ring lanes nothing continues onto are not offered (non-runnable).
 *   The approach is the stretch before the ring, or after it when the one before is pedestrian.
 *   Without data, the approach's own lanes + walk-R.
 * - 2 ≤ lanes ≤ MAX_LANES.
 *
 * Stabilisation (`buildStretches`, circular over the lap): consecutive non-ring sections with
 * compatible layouts (same lane ids, offsets within MERGE_TOLERANCE) merge (length-weighted);
 * non-ring stretches shorter than MIN_STRETCH are absorbed (shortest first) into a non-ring
 * neighbour (same class pedestrian/road first, then same own-lane count, then longer); rings then
 * get their approach's lanes, and neighbours with identical layouts merge. Opposite offsets and
 * median widths are the length-weighted median over runs of like dual sections.
 */
import type { CitySection } from "./data";

/** "median" is kept for API compatibility; no layout produces median lanes any more. */
export type LaneKind = "road" | "sidewalk" | "pedestrian" | "median";
export type Flow = 1 | -1 | 0;

export interface Strip {
  from: number;
  to: number;
}

export interface LaneLayout {
  /** Stable key; same id = same layout (built from ids and rounded numbers). */
  id: string;
  /** Stable lane ids (see header), aligned with offsets. */
  ids: readonly string[];
  /** Lane centres, metres from the route centreline, + to the runner's right, ascending. */
  offsets: readonly number[];
  /** Usable width of each lane. */
  widths: readonly number[];
  /** +1 traffic drives the runner's way, -1 oncoming, 0 no vehicles. */
  flow: readonly Flow[];
  kinds: readonly LaneKind[];
  /** Centre-to-centre distance between consecutive lanes (length = lanes − 1). */
  gaps: readonly number[];
  /** Outer limits of the runnable surface (outer edges of the outermost lanes). */
  left: number;
  right: number;
  /** Asphalt strips (kerb to kerb) for drawing; gaps between them are medians. */
  carriageways: readonly { from: number; to: number; flow: Flow }[];
  /** Paved pedestrian strips beside the carriageways (runnable or not). */
  sidewalks: readonly Strip[];
  /** Drawing info: the whole gap between carriageways, whether or not a median lane runs on it. */
  median: readonly Strip[];
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
export const MAX_DUAL_OFFSET = 30;
/** Medians at least this wide (kerb to kerb) are never crossed by runnable oncoming lanes. */
export const MEDIAN_RUNNABLE_GAP = 3.5;
export const MIN_LANES = 3;
export const MAX_LANES = 4;
/** Non-ring stretches shorter than this are absorbed into a neighbour. */
export const MIN_STRETCH = 120;
export const MERGE_TOLERANCE = 0.75;
/** Suggested blend length for drawing after a stretch boundary (lane offsets never jump > 1 m). */
export const TRANSITION_LENGTH = 12;
/** Lanes of different ids continue into each other across a boundary within this distance. */
export const MAP_NEAREST = 1.5;

const PED_HIGHWAYS = new Set(["pedestrian", "footway", "living_street", "cycleway", "steps", "path"]);
const CROSSABLE_MEDIANS = new Set(["cable-plane", "kerb", "unmapped"]);

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const r2 = (v: number): number => Math.round(v * 100) / 100 + 0; // + 0 turns -0 into 0

export function isPedestrianSection(sec: CitySection): boolean {
  return sec.pedestrian || sec.lanes === 0 || PED_HIGHWAYS.has(sec.highway);
}

export const isRingSection = (sec: CitySection): boolean => sec.roundabout !== null && !isPedestrianSection(sec);

interface DraftLane {
  id: string;
  offset: number;
  width: number;
  flow: Flow;
  kind: LaneKind;
}

interface Draft {
  lanes: DraftLane[];
  carriageways: { from: number; to: number; flow: Flow }[];
  sidewalks: Strip[];
  median: Strip[];
}

function layoutId(d: Draft): string {
  const f = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);
  const lanes = d.lanes.map((l) => `${l.id}@${f(l.offset)}/${f(l.width)}`).join(",");
  const strips = (x: Strip[]): string => x.map((c) => `${f(c.from)}:${f(c.to)}`).join(",");
  return `${lanes}|c${d.carriageways.map((c) => `${f(c.from)}:${f(c.to)}:${c.flow}`).join(",")}|s${strips(d.sidewalks)}|m${strips(d.median)}`;
}

function finish(d: Draft): LaneLayout {
  const sorted: Draft = {
    lanes: [...d.lanes].sort((a, b) => a.offset - b.offset).map((l) => ({ ...l, offset: r2(l.offset), width: r2(l.width) })),
    carriageways: [...d.carriageways].sort((a, b) => a.from - b.from).map((c) => ({ from: r2(c.from), to: r2(c.to), flow: c.flow })),
    sidewalks: [...d.sidewalks].sort((a, b) => a.from - b.from).map((c) => ({ from: r2(c.from), to: r2(c.to) })),
    median: [...d.median].sort((a, b) => a.from - b.from).map((c) => ({ from: r2(c.from), to: r2(c.to) })),
  };
  const ls = sorted.lanes;
  const first = ls[0];
  const last = ls[ls.length - 1];
  return {
    id: layoutId(sorted),
    ids: ls.map((l) => l.id),
    offsets: ls.map((l) => l.offset),
    widths: ls.map((l) => l.width),
    flow: ls.map((l) => l.flow),
    kinds: ls.map((l) => l.kind),
    gaps: ls.slice(1).map((l, i) => r2(l.offset - ls[i]!.offset)),
    left: first ? r2(first.offset - first.width / 2) : 0,
    right: last ? r2(last.offset + last.width / 2) : 0,
    carriageways: sorted.carriageways,
    sidewalks: sorted.sidewalks,
    median: sorted.median,
  };
}

function toDraft(l: LaneLayout): Draft {
  return {
    lanes: l.ids.map((id, i) => ({ id, offset: l.offsets[i]!, width: l.widths[i]!, flow: l.flow[i]!, kind: l.kinds[i]! })),
    carriageways: l.carriageways.map((c) => ({ ...c })),
    sidewalks: l.sidewalks.map((c) => ({ ...c })),
    median: l.median.map((c) => ({ ...c })),
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
  const lanes: DraftLane[] = [];
  for (let i = 0; i < n; i++) lanes.push({ id: `ped-${i + 1}`, offset: (i - (n - 1) / 2) * sp, width: sp, flow: 0, kind: "pedestrian" });
  const paved = clamp(u, n * sp, PED_MAX_PAVED);
  return { lanes, carriageways: [], sidewalks: [{ from: -paved / 2, to: paved / 2 }], median: [] };
}

/** Our carriageway: k own lanes from the kerb lane at 0 leftwards. Returns its left kerb. */
function addOwn(d: Draft, k: number, w: number): number {
  for (let j = 0; j < k; j++) d.lanes.push({ id: `own-${j + 1}`, offset: -j * w, width: w, flow: 1, kind: "road" });
  return w / 2 - k * w;
}

/** Layout of one non-ring section on its own (rings: see ringLayout). */
export function sectionLayout(sec: CitySection): LaneLayout {
  return finish(sectionDraft(sec));
}

function sectionDraft(sec: CitySection): Draft {
  if (isPedestrianSection(sec)) return pedestrianDraft(sec);
  const d: Draft = { lanes: [], carriageways: [], sidewalks: [], median: [] };
  const lanes = Math.max(1, sec.lanes);
  const opp = sec.opposite;

  const twoWay = !sec.oneway && !sec.dual && !sec.roundabout;
  const nTotal = twoWay ? clamp(lanes, 2, 4) : Math.min(lanes, 3);
  const k = twoWay ? Math.ceil(nTotal / 2) : nTotal;
  const w = clamp(sec.width / nTotal, ROAD_LANE_MIN, ROAD_LANE_MAX);
  const kerbR = w / 2;
  const kerbL = addOwn(d, k, w);
  let leftEdge = kerbL; // outer left edge of all carriageways
  let walkLeftAllowed = true;

  if (twoWay) {
    const m = nTotal - k;
    for (let j = 0; j < m; j++) d.lanes.push({ id: `opp-${j + 1}`, offset: kerbL - (j + 0.5) * w, width: w, flow: -1, kind: "road" });
    leftEdge = kerbL - m * w;
    d.carriageways.push({ from: leftEdge, to: kerbR, flow: 0 });
    walkLeftAllowed = false;
  } else {
    d.carriageways.push({ from: kerbL, to: kerbR, flow: 1 });
    if (sec.dual && opp && Math.abs(opp.offset) <= MAX_DUAL_OFFSET && opp.offset < 0) {
      const m = Math.max(1, Math.min(opp.lanes, 2));
      // Kerb-to-kerb gap: the data's medianWidth, else from the centre-to-centre offset.
      const gap = sec.medianWidth !== null && sec.medianWidth > 0 ? sec.medianWidth : Math.max(0.5, -opp.offset - (k * w) / 2 - (m * w) / 2);
      const oppR = kerbL - gap;
      const oppL = oppR - m * w;
      d.carriageways.push({ from: oppL, to: oppR, flow: -1 });
      d.median.push({ from: oppR, to: kerbL });
      leftEdge = oppL;
      walkLeftAllowed = false;
      const kind = sec.medianKind;
      const crossable = gap < MEDIAN_RUNNABLE_GAP && (kind === null || CROSSABLE_MEDIANS.has(kind));
      if (crossable) {
        for (let j = 0; j < m; j++) d.lanes.push({ id: `opp-${j + 1}`, offset: oppR - (j + 0.5) * w, width: w, flow: -1, kind: "road" });
      }
      // A wide or planted median is never runnable: drawing info only.
    }
  }

  const sw = sidewalkWidth(sec, kerbR - leftEdge);
  d.sidewalks.push({ from: kerbR, to: kerbR + sw }, { from: leftEdge - sw, to: leftEdge });
  // Pavement lanes only to reach MIN_LANES: walk-R first, walk-L only on one-way streets.
  if (d.lanes.length < MIN_LANES) d.lanes.push({ id: "walk-R", offset: kerbR + sw / 2, width: sw, flow: 0, kind: "sidewalk" });
  if (walkLeftAllowed && d.lanes.length < MIN_LANES) {
    d.lanes.push({ id: "walk-L", offset: kerbL - sw / 2, width: sw, flow: 0, kind: "sidewalk" });
  }
  return d;
}

/** Ring geometry for `ringLayoutFromData` (radii from city.roundabouts, d = route distance to the centre on the arc). */
export interface RingGeometry {
  lanes: number;
  rInner: number;
  rOuter: number;
  /** Smallest and mean distance of the route from the ring centre along the arc. */
  dMin: number;
  dMean: number;
}

/** Island clearance: no ring lane comes closer than this to the island kerb. */
export const ISLAND_MARGIN = 0.3;
/** Ring lanes may be narrowed this far to keep ISLAND_MARGIN: the solved line runs up to ~0.3 m
 *  inside rRef, and 1-lane rings are only 3.5 m wide (Reyes Católicos, Minayo). */
export const RING_OWN1_MIN = 2.6;

/** Lanes continue across a ring boundary, in order from the kerb, when their centres are this close. */
export const RING_PAIR_MAX = 2.0;

/** Lane indices of `l` from the outside (kerb, largest offset) inward. */
const outsideIn = (l: LaneLayout): number[] => l.offsets.map((_, i) => i).sort((a, b) => l.offsets[b]! - l.offsets[a]!);

/**
 * Order-preserving correspondence across a ring boundary: counting from the outside inward, the
 * k-th lane of `a` continues as the k-th lane of `b` when their centres are within RING_PAIR_MAX
 * (ids and kinds may differ). Returns, for each lane of `a`, its index in `b` or null.
 */
export function mapLanesInOrder(a: LaneLayout, b: LaneLayout, maxD = RING_PAIR_MAX): (number | null)[] {
  const oa = outsideIn(a);
  const ob = outsideIn(b);
  // Order-preserving: the k-th lane from the kerb on one side pairs with the (k + δ)-th on the
  // other, with the alignment δ that pairs the most lanes (then the smallest total shift), so a
  // pavement lane present on one side only does not throw the road lanes out of step.
  let best: (number | null)[] = a.ids.map(() => null);
  let bestScore = -Infinity;
  for (let delta = -ob.length; delta <= oa.length; delta++) {
    const map: (number | null)[] = a.ids.map(() => null);
    let score = 0;
    for (let k = 0; k < oa.length; k++) {
      const j = ob[k + delta];
      const i = oa[k]!;
      if (j === undefined) continue;
      const dist = Math.abs(a.offsets[i]! - b.offsets[j]!);
      if (dist <= maxD) {
        map[i] = j;
        score += 100 - dist;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = map;
    }
  }
  return best;
}

/**
 * A ring's layout from the roundabout data. Lanes flow through the ring 1:1 in order from the kerb
 * (see mapLanesInOrder): walk-R ↔ walk-R (outside the outer kerb, when the approach or exit has a
 * pavement), the approach's outermost road/pedestrian lane ↔ "own-1" (the route's outer lane,
 * offset 0), the next lanes inward ↔ the ring's inner lanes. A ring lane after own-1 is offered
 * ONLY if an approach lane continues onto it (no lane begins inside the arc); its id is the
 * approach lane's id when that is an own lane, else "ring-j". Its offset is the mean of the
 * continuing lanes' offsets at entry and exit (so each end shifts ≤ half their difference), moved
 * or narrowed (≥ RING_OWN1_MIN) as needed to stay ISLAND_MARGIN clear of the island at the
 * route's closest point and not to overlap the lane outside it. The ring's capacity — how many
 * lanes of width ≤ (rOuter − rInner) / lanes fit between own-1 and the island — caps the count.
 */
export function ringLayoutFromData(g: RingGeometry, approach: LaneLayout, exit: LaneLayout = approach): LaneLayout {
  const n = Math.max(1, Math.round(g.lanes));
  const lw = (g.rOuter - g.rInner) / n;
  const limit = g.rInner + ISLAND_MARGIN;
  const minOffsetEdge = limit - g.dMin; // lane inner edges must stay ≥ this (lateral)
  const w1 = Math.min(lw, Math.max(RING_OWN1_MIN, 2 * (g.dMin - limit)));
  const kerbOut = Math.max(g.rOuter - g.dMean, w1 / 2);
  // Capacity: nominal inner lanes sharing the band evenly.
  const band = g.dMin - w1 / 2 - limit;
  let cap = n - 1;
  let wn = cap > 0 ? Math.min(lw, band / cap) : 0;
  while (cap > 0 && wn < RING_OWN1_MIN) {
    cap--;
    wn = cap > 0 ? Math.min(lw, band / cap) : 0;
  }
  // walk-R continues round the ring when the approach has it (a pedestrian street counts).
  const paved = (l: LaneLayout): boolean => l.ids.includes("walk-R") || (l.kinds.length > 0 && l.kinds.every((k) => k === "pedestrian"));
  const hasWalk = paved(approach);
  // Pavement width: the mean of the approach's and exit's (so walk-R shifts little at both ends).
  const ws = [approach, exit].flatMap((l) => (l.ids.includes("walk-R") ? [l.widths[l.ids.indexOf("walk-R")]!] : []));
  const walkW = ws.length > 0 ? ws.reduce((x, y) => x + y, 0) / ws.length : SIDEWALK_DEFAULT;
  // Nominal ring lanes from the outside in.
  const nominal: DraftLane[] = [];
  if (hasWalk) nominal.push({ id: "walk-R", offset: kerbOut + walkW / 2, width: walkW, flow: 0, kind: "sidewalk" });
  nominal.push({ id: "own-1", offset: 0, width: w1, flow: 1, kind: "road" });
  for (let j = 1; j <= cap; j++) nominal.push({ id: `ring-${j + 1}`, offset: -w1 / 2 - (j - 0.5) * wn, width: wn, flow: 1, kind: "road" });
  // Continuations (order-preserving), as indices into `nominal`.
  const nom = finish({ lanes: nominal.map((x) => ({ ...x })), carriageways: [], sidewalks: [], median: [] });
  const nomIndex = nominal.map((x) => nom.ids.indexOf(x.id));
  const pairWith = (l: LaneLayout, lFirst: boolean): (number | null)[] => {
    const m = lFirst ? mapLanesInOrder(l, nom) : mapLanesInOrder(nom, l);
    return nominal.map((_, k) => {
      const ni = nomIndex[k]!;
      if (lFirst) {
        const i = m.indexOf(ni);
        return i >= 0 ? i : null;
      }
      return m[ni] ?? null;
    });
  };
  const fromA = pairWith(approach, true);
  const toE = pairWith(exit, false);
  const lanes: DraftLane[] = [];
  nominal.forEach((x, k) => {
    if (x.id === "walk-R" || x.id === "own-1") {
      lanes.push(x);
      return;
    }
    const ia = fromA[k];
    if (ia === null || ia === undefined) return; // not offered: nothing continues onto it
    const aId = approach.ids[ia]!;
    const id = /^own-\d$/.test(aId) ? aId : x.id;
    const ie = toE[k];
    const a = approach.offsets[ia]!;
    let target = ie !== null && ie !== undefined ? (a + exit.offsets[ie]!) / 2 : a;
    let w = x.width;
    const outer = lanes[lanes.length - 1]!;
    const maxOff = outer.offset - outer.width / 2 - w / 2;
    target = Math.min(target, maxOff);
    if (target - w / 2 < minOffsetEdge) {
      // Too close to the island: move out as far as the outer lane allows, then narrow.
      target = Math.min(maxOff, minOffsetEdge + w / 2);
      if (target - w / 2 < minOffsetEdge) {
        const top = outer.offset - outer.width / 2;
        w = top - minOffsetEdge;
        target = top - w / 2;
      }
    }
    if (w < RING_OWN1_MIN - 1e-9) return;
    lanes.push({ id, offset: target, width: w, flow: 1, kind: "road" });
  });
  const kerbIn = Math.min(g.rInner - g.dMean, ...lanes.filter((l) => l.kind === "road").map((l) => l.offset - l.width / 2));
  const d: Draft = { lanes, carriageways: [{ from: kerbIn, to: kerbOut, flow: 1 }], sidewalks: [], median: [] };
  if (hasWalk) d.sidewalks.push({ from: kerbOut, to: kerbOut + walkW });
  return finish(d);
}

/** A ring's layout without data: exactly the approach's own lanes and walk-R, with our carriageway only. */
export function ringLayout(approach: LaneLayout): LaneLayout {
  const a = toDraft(approach);
  const lanes = a.lanes.filter((l) => l.id.startsWith("own-") || l.id === "walk-R");
  const own = lanes.filter((l) => l.id.startsWith("own-"));
  const walk = lanes.find((l) => l.id === "walk-R");
  if (own.length === 0 || !walk) throw new Error("ringLayout: approach has no own lanes");
  const kerbR = Math.max(...own.map((l) => l.offset + l.width / 2));
  const kerbL = Math.min(...own.map((l) => l.offset - l.width / 2));
  return finish({
    lanes,
    carriageways: [{ from: kerbL, to: kerbR, flow: 1 }],
    sidewalks: [{ from: kerbR, to: walk.offset + walk.width / 2 }],
    median: [],
  });
}

const ownCount = (l: LaneLayout): number => l.ids.filter((x) => x.startsWith("own-")).length;

// ---------------------------------------------------------------------------
// Stabilisation
// ---------------------------------------------------------------------------

export function compatible(a: LaneLayout, b: LaneLayout, tol = MERGE_TOLERANCE): boolean {
  if (a.ids.length !== b.ids.length || a.ids.some((x, i) => x !== b.ids[i])) return false;
  if (a.carriageways.length !== b.carriageways.length || a.sidewalks.length !== b.sidewalks.length || a.median.length !== b.median.length) return false;
  for (let i = 0; i < a.offsets.length; i++) {
    if (Math.abs(a.offsets[i]! - b.offsets[i]!) > tol || Math.abs(a.widths[i]! - b.widths[i]!) > tol) return false;
  }
  const strips = (x: readonly Strip[], y: readonly Strip[]): boolean =>
    x.every((s, i) => Math.abs(s.from - y[i]!.from) <= 2 * tol && Math.abs(s.to - y[i]!.to) <= 2 * tol);
  return strips(a.carriageways, b.carriageways) && strips(a.sidewalks, b.sidewalks) && strips(a.median, b.median) &&
    a.carriageways.every((c, i) => c.flow === b.carriageways[i]!.flow);
}

/** Length-weighted average of two compatible layouts. */
function blend(a: LaneLayout, wa: number, b: LaneLayout, wb: number): LaneLayout {
  const t = wb / (wa + wb);
  const mix = (x: number, y: number): number => x + (y - x) * t;
  const da = toDraft(a);
  const db = toDraft(b);
  const mixStrips = (x: Strip[], y: Strip[]): Strip[] => x.map((s, i) => ({ from: mix(s.from, y[i]!.from), to: mix(s.to, y[i]!.to) }));
  return finish({
    lanes: da.lanes.map((l, i) => ({ ...l, offset: mix(l.offset, db.lanes[i]!.offset), width: mix(l.width, db.lanes[i]!.width) })),
    carriageways: da.carriageways.map((c, i) => ({ from: mix(c.from, db.carriageways[i]!.from), to: mix(c.to, db.carriageways[i]!.to), flow: c.flow })),
    sidewalks: mixStrips(da.sidewalks, db.sidewalks),
    median: mixStrips(da.median, db.median),
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
  secs: number[];
  len: number;
  /** null for rings until their approach is known. */
  layout: LaneLayout | null;
  ring: boolean;
  ped: boolean;
}

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

/** Replaces opposite offsets / median widths by their run medians (see header). */
function steadySections(sections: readonly CitySection[]): CitySection[] {
  const n = sections.length;
  const steady = sections.map((x) => x);
  const runKey = (x: CitySection): string | null =>
    x.dual && x.opposite && !x.roundabout ? `${x.name ?? ""}|${x.lanes}|${x.opposite.lanes}|${x.medianKind === "barrier"}` : null;
  for (let i = 0; i < n; ) {
    const key = runKey(sections[i]!);
    let j = i + 1;
    while (key !== null && j < n && runKey(sections[j]!) === key) j++;
    if (key !== null && j - i > 1) {
      const slice = sections.slice(i, j);
      const med = weightedMedian(slice.map((x) => ({ off: x.opposite!.offset, len: x.toS - x.fromS })));
      const mws = slice.filter((x) => x.medianWidth !== null).map((x) => ({ off: x.medianWidth!, len: x.toS - x.fromS }));
      const mw = mws.length > 0 ? weightedMedian(mws) : null;
      for (let k = i; k < j; k++) {
        const x = sections[k]!;
        steady[k] = { ...x, opposite: { ...x.opposite!, offset: med }, medianWidth: x.medianWidth === null ? null : mw };
      }
    }
    i = j;
  }
  return steady;
}

/**
 * Builds the stabilised stretches over the lap from the sections (contiguous, covering
 * 0..lapLength). Returns stretches split at s = 0 / lapLength, in order.
 */
export function buildStretches(
  sections: readonly CitySection[],
  lapLength: number,
  /** Ring layout from the roundabout data (track.ts), else null → approach's own lanes. */
  ringFor?: (ring: CitySection, approach: LaneLayout, exit: LaneLayout) => LaneLayout | null,
): Stretch[] {
  const n = sections.length;
  if (n === 0) throw new Error("buildStretches: no sections");
  const secLen = (i: number): number => sections[i]!.toS - sections[i]!.fromS;
  const steady = steadySections(sections);

  let groups: Group[] = sections.map((sec, i) => ({
    secs: [i],
    len: secLen(i),
    layout: isRingSection(sec) ? null : sectionLayout(steady[i]!),
    ring: isRingSection(sec),
    ped: isPedestrianSection(sec),
  }));

  const replacePair = (i: number, j: number, g: Group): void => {
    if (j === 0) {
      groups.splice(i, 1, g);
      groups.shift();
    } else groups.splice(i, 2, g);
  };
  const join = (a: Group, b: Group, layout: LaneLayout | null, like: Group): Group => ({
    secs: [...a.secs, ...b.secs],
    len: a.len + b.len,
    layout,
    ring: like.ring,
    ped: like.ped,
  });

  /** Merges neighbours: compatible non-ring ones (blended), or identical ones of any kind. */
  const mergeNeighbours = (identicalOnly: boolean): void => {
    let changed = true;
    while (changed && groups.length > 1) {
      changed = false;
      for (let i = 0; i < groups.length && groups.length > 1; i++) {
        const j = (i + 1) % groups.length;
        const a = groups[i]!;
        const b = groups[j]!;
        if (!a.layout || !b.layout) continue;
        if (a.layout.id === b.layout.id) {
          replacePair(i, j, join(a, b, a.layout, a.len >= b.len ? a : b));
        } else if (!identicalOnly && !a.ring && !b.ring && a.ped === b.ped && compatible(a.layout, b.layout)) {
          replacePair(i, j, join(a, b, blend(a.layout, a.len, b.layout, b.len), a));
        } else continue;
        changed = true;
        i--;
      }
    }
  };

  mergeNeighbours(false);

  // Absorb short non-ring stretches into a non-ring neighbour.
  const frozen = new Set<Group>();
  for (;;) {
    if (groups.length <= 1) break;
    let best = -1;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]!;
      if (g.ring || g.len >= MIN_STRETCH || frozen.has(g)) continue;
      if (best < 0 || g.len < groups[best]!.len) best = i;
    }
    if (best < 0) break;
    const g = groups[best]!;
    const L = groups.length;
    const prev = (best - 1 + L) % L;
    const next = (best + 1) % L;
    const cands = [prev, next].filter((k, idx, arr) => arr.indexOf(k) === idx && k !== best && !groups[k]!.ring);
    if (cands.length === 0) {
      frozen.add(g);
      continue;
    }
    const score = (k: number): number => {
      const o = groups[k]!;
      return (o.ped === g.ped ? 8 : 0) + (o.layout && g.layout && ownCount(o.layout) === ownCount(g.layout) ? 2 : 0) + o.len / 1e6;
    };
    cands.sort((x, y) => score(y) - score(x));
    const k = cands[0]!;
    const o = groups[k]!;
    if (k === prev) replacePair(prev, best, join(o, g, o.layout, o));
    else replacePair(best, next, join(g, o, o.layout, o));
    mergeNeighbours(false);
  }

  // Rings take their approach's own lanes and walk-R.
  for (let pass = 0; pass < groups.length; pass++) {
    let pending = false;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]!;
      if (g.layout) continue;
      const L = groups.length;
      const before = groups[(i - 1 + L) % L]!;
      const after = groups[(i + 1) % L]!;
      const road = (x: Group): LaneLayout | null => (x.layout && !x.ped ? x.layout : null);
      const approach = road(before) ?? road(after);
      if (approach) {
        const ap = before.layout ?? approach;
        const ex = after.layout ?? approach;
        g.layout = ringFor?.(sections[g.secs[0]!]!, ap, ex) ?? ringLayout(approach);
      }
      else pending = true;
    }
    if (!pending) break;
  }
  for (const g of groups) if (!g.layout) g.layout = finish(sectionDraft({ ...sections[g.secs[0]!]!, roundabout: null, oneway: true }));
  mergeNeighbours(true);

  // Deduplicate layouts by id, then emit stretches split at the seam.
  const byId = new Map<string, LaneLayout>();
  const out: Stretch[] = [];
  const emit = (secs: number[], layout: LaneLayout, fromS: number, toS: number): void => {
    let longest = secs[0]!;
    for (const i of secs) if (secLen(i) > secLen(longest)) longest = i;
    out.push({ fromS, toS, layout, section: sections[longest]! });
  };
  for (const g of groups) {
    const layout = byId.get(g.layout!.id) ?? g.layout!;
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
    emit(piece, layout, sections[piece[0]!]!.fromS, sections[piece[piece.length - 1]!]!.toS);
  }
  out.sort((x, y) => x.fromS - y.fromS);
  return out;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface LaneTransition {
  /** Where the next stretch starts (0 for the lap seam). */
  s: number;
  fromIndex: number;
  toIndex: number;
  /** For each lane of the stretch before: its index in the stretch after, or null if it ends. */
  map: readonly (number | null)[];
  /** Lanes of the stretch after that are new. */
  begins: readonly number[];
  /** Lanes of the stretch before (indices) that continue with a different flow (e.g. a median or
   *  oncoming lane continuing onto a ring becomes +1): the engine keeps vehicles apart there. */
  flowChanges: readonly number[];
}

/**
 * Lane correspondence across a boundary: same id → same lane; otherwise, between lanes without
 * traffic (pavement, median, pedestrian), across a road ↔ pedestrian boundary, or between a ring
 * lane "ring-j" and an own lane "own-j" of the same rank, the nearest centre within MAP_NEAREST continues — but never onto an oncoming (−1) lane. Everything else
 * ends / begins.
 */
export function mapLanes(a: LaneLayout, b: LaneLayout): { map: (number | null)[]; begins: number[] } {
  const map: (number | null)[] = a.ids.map((id) => {
    const j = b.ids.indexOf(id);
    return j >= 0 ? j : null;
  });
  const taken = new Set(map.filter((x): x is number => x !== null));
  const pairs: { i: number; j: number; d: number }[] = [];
  const pedBoundary = a.kinds.every((k) => k === "pedestrian") !== b.kinds.every((k) => k === "pedestrian");
  for (let i = 0; i < a.ids.length; i++) {
    if (map[i] !== null) continue;
    for (let j = 0; j < b.ids.length; j++) {
      if (taken.has(j) || b.flow[j] === -1) continue;
      const quiet = a.flow[i] === 0 && b.flow[j] === 0;
      // A ring lane continues as the exit street's own lane of the same rank (and vice versa).
      const ringRank = /^(ring|own)-(\d)$/;
      const ma = ringRank.exec(a.ids[i]!);
      const mb = ringRank.exec(b.ids[j]!);
      const ringToOwn = ma !== null && mb !== null && ma[2] === mb[2] && (ma[1] === "ring") !== (mb[1] === "ring");
      if (!quiet && !pedBoundary && !ringToOwn) continue;
      const d = Math.abs(a.offsets[i]! - b.offsets[j]!);
      if (d <= MAP_NEAREST) pairs.push({ i, j, d });
    }
  }
  pairs.sort((x, y) => x.d - y.d);
  for (const p of pairs) {
    if (map[p.i] !== null || taken.has(p.j)) continue;
    map[p.i] = p.j;
    taken.add(p.j);
  }
  const begins: number[] = [];
  for (let j = 0; j < b.ids.length; j++) if (!taken.has(j)) begins.push(j);
  return { map, begins };
}

/**
 * Copy of `l` with lane k moved/narrowed (newOffset, width) or dropped (newOffset null), and the
 * pavement strips on that side clamped to the wall line `wall` (a lateral; + right, − left).
 * Used by the wall fitting (walls.ts).
 */
export function relayout(l: LaneLayout, k: number, newOffset: number | null, width: number, wall: number): LaneLayout {
  const d = toDraft(l);
  if (newOffset === null) d.lanes.splice(k, 1);
  else d.lanes[k] = { ...d.lanes[k]!, offset: newOffset, width };
  d.sidewalks = d.sidewalks
    .map((s) => (wall > 0 ? { from: s.from, to: s.to > wall && s.from < wall ? wall : s.to } : { from: s.from < wall && s.to > wall ? wall : s.from, to: s.to }))
    .filter((s) => s.to - s.from > 0.05);
  return finish(d);
}

/**
 * Two-lane shared street (walls.ts fallback): ped-1 left of the centreline (width wl), ped-2 right
 * (width wr), paved from wall to wall (clearances cl, cr).
 */
export function sharedStreet(wl: number, wr: number, cl: number, cr: number): LaneLayout {
  return finish({
    lanes: [
      { id: "ped-1", offset: -wl / 2, width: wl, flow: 0, kind: "pedestrian" },
      { id: "ped-2", offset: wr / 2, width: wr, flow: 0, kind: "pedestrian" },
    ],
    carriageways: [],
    sidewalks: [{ from: -Math.min(cl, PED_MAX_PAVED / 2), to: Math.min(cr, PED_MAX_PAVED / 2) }],
    median: [],
  });
}
