/**
 * Missions ("Misiones"): pure logic, no storage. Three missions are always active. They are
 * drawn from a pool of templates; each template has five difficulty tiers, and the tier rises
 * with every completed set (capped at the last one).
 */
import { formatInt, formatMetres } from "./format";

/** What a run contributes to the missions. Built live from game events and at the end from the RunSummary. */
export interface RunStats {
  bellotas: number;
  distance: number;
  score: number;
  jumps: number;
  rolls: number;
  nearMisses: number;
  roofMetres: number;
  powerups: number;
  words: number;
  letters: number;
  /** Zones completed in this run (6 = one full lap). */
  zones: number;
  /** 1 for a finished run. */
  runs: number;
}

export const emptyRunStats = (): RunStats => ({
  bellotas: 0,
  distance: 0,
  score: 0,
  jumps: 0,
  rolls: 0,
  nearMisses: 0,
  roofMetres: 0,
  powerups: 0,
  words: 0,
  letters: 0,
  zones: 0,
  runs: 0,
});

export type MissionMetric = keyof RunStats;

/** Replace NaN, infinities and negatives with 0 so odd engine values can't poison the save. */
export function sanitizeStats(run: RunStats): RunStats {
  const out = emptyRunStats();
  for (const k of Object.keys(out) as (keyof RunStats)[]) {
    const v = run[k];
    out[k] = Number.isFinite(v) && v > 0 ? v : 0;
  }
  return out;
}

export interface MissionTemplate {
  id: string;
  metric: MissionMetric;
  /** "total" accumulates across runs; "single" must be reached within one run. */
  mode: "total" | "single";
  /** Target per tier (5 tiers). */
  targets: readonly [number, number, number, number, number];
  /** Lowest tier at which this template can be drawn. */
  minTier?: number;
  text(target: number): string;
  /** Progress label, e.g. "120 / 300". Defaults to plain numbers. */
  label?(progress: number, target: number): string;
}

const times = (n: number, one: string, many: string): string => (n === 1 ? one : many);
const metres = (p: number, t: number): string => `${formatInt(p)} / ${formatMetres(t)}`;

const ZONE_GOALS: Record<number, string> = {
  1: "Llega a Valdepasillas",
  2: "Llega a San Francisco",
  3: "Llega al Casco Antiguo",
  4: "Llega a la Alcazaba",
  5: "Llega a la Margen derecha",
};

export const MISSION_POOL: readonly MissionTemplate[] = [
  {
    id: "bellotas-total",
    metric: "bellotas",
    mode: "total",
    targets: [150, 300, 600, 1000, 1800],
    text: (t) => `Recoge ${formatInt(t)} bellotas`,
  },
  {
    id: "bellotas-run",
    metric: "bellotas",
    mode: "single",
    targets: [60, 120, 200, 320, 500],
    text: (t) => `Recoge ${formatInt(t)} bellotas en una sola carrera`,
  },
  {
    id: "distance-run",
    metric: "distance",
    mode: "single",
    targets: [500, 1000, 1500, 2500, 4000],
    text: (t) => `Corre ${formatMetres(t)} en una sola carrera`,
    label: metres,
  },
  {
    id: "distance-total",
    metric: "distance",
    mode: "total",
    targets: [2000, 4000, 8000, 15000, 25000],
    text: (t) => `Corre ${formatMetres(t)} en total`,
    label: metres,
  },
  {
    id: "jumps",
    metric: "jumps",
    mode: "total",
    targets: [20, 40, 80, 150, 250],
    text: (t) => `Salta ${formatInt(t)} veces`,
  },
  {
    id: "rolls",
    metric: "rolls",
    mode: "total",
    targets: [10, 25, 50, 90, 150],
    text: (t) => `Rueda ${formatInt(t)} veces`,
  },
  {
    id: "roofs",
    metric: "roofMetres",
    mode: "total",
    targets: [60, 150, 300, 600, 1000],
    text: (t) => `Corre ${formatMetres(t)} por los techos`,
    label: metres,
  },
  {
    id: "near-misses",
    metric: "nearMisses",
    mode: "total",
    targets: [5, 10, 20, 35, 60],
    text: (t) => `Roza ${formatInt(t)} ${times(t, "vehículo", "vehículos")}`,
  },
  {
    id: "words",
    metric: "words",
    mode: "total",
    targets: [1, 1, 2, 3, 5],
    text: (t) => (t === 1 ? "Completa la palabra BADAJOZ" : `Completa la palabra BADAJOZ ${formatInt(t)} veces`),
  },
  {
    id: "letters",
    metric: "letters",
    mode: "total",
    targets: [5, 10, 20, 35, 60],
    text: (t) => `Recoge ${formatInt(t)} letras de BADAJOZ`,
  },
  {
    id: "zone-reach",
    metric: "zones",
    mode: "single",
    targets: [2, 3, 4, 5, 5],
    text: (t) => ZONE_GOALS[t] ?? `Recorre ${formatInt(t)} zonas en una sola carrera`,
    label: (p, t) => `${formatInt(Math.min(p, t))} / ${formatInt(t)} zonas`,
  },
  {
    id: "laps",
    metric: "zones",
    mode: "single",
    targets: [6, 6, 6, 12, 18],
    minTier: 1,
    text: (t) =>
      t <= 6 ? "Da una vuelta completa a Badajoz" : `Da ${formatInt(Math.round(t / 6))} vueltas a Badajoz en una carrera`,
    label: (p, t) => `${formatInt(Math.min(p, t))} / ${formatInt(t)} zonas`,
  },
  {
    id: "powerups",
    metric: "powerups",
    mode: "total",
    targets: [3, 5, 10, 18, 30],
    text: (t) => `Usa ${formatInt(t)} potenciadores`,
  },
  {
    id: "score-run",
    metric: "score",
    mode: "single",
    targets: [5000, 15000, 40000, 80000, 150000],
    text: (t) => `Consigue ${formatInt(t)} puntos en una sola carrera`,
  },
  {
    id: "runs",
    metric: "runs",
    mode: "total",
    targets: [3, 5, 8, 12, 20],
    text: (t) => `Juega ${formatInt(t)} carreras`,
  },
];

const TEMPLATE_BY_ID = new Map(MISSION_POOL.map((m) => [m.id, m]));
export const getTemplate = (id: string): MissionTemplate | undefined => TEMPLATE_BY_ID.get(id);

export const MAX_TIER = 4;
export const tierFor = (setsCompleted: number): number => Math.min(MAX_TIER, Math.max(0, Math.floor(setsCompleted)));

export interface ActiveMission {
  id: string;
  /** Committed progress before the current run (capped at the target). */
  progress: number;
  done: boolean;
}

export interface MissionsState {
  setsCompleted: number;
  active: ActiveMission[];
}

export function targetOf(id: string, setsCompleted: number): number {
  const tpl = getTemplate(id);
  return tpl ? (tpl.targets[tierFor(setsCompleted)] ?? tpl.targets[0]) : 1;
}

/** Small deterministic PRNG so a given set always draws the same missions. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw three missions with distinct metrics for the given set. */
export function drawMissions(setsCompleted: number): ActiveMission[] {
  const tier = tierFor(setsCompleted);
  const rand = mulberry32(setsCompleted * 7919 + 17);
  const pool = MISSION_POOL.filter((m) => (m.minTier ?? 0) <= tier);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = pool[i];
    const b = pool[j];
    if (a && b) {
      pool[i] = b;
      pool[j] = a;
    }
  }
  const picked: ActiveMission[] = [];
  const metrics = new Set<MissionMetric>();
  for (const m of pool) {
    if (picked.length === 3) break;
    if (metrics.has(m.metric)) continue;
    metrics.add(m.metric);
    picked.push({ id: m.id, progress: 0, done: false });
  }
  return picked;
}

export const initialMissions = (): MissionsState => ({ setsCompleted: 0, active: drawMissions(0) });

/** Progress including the run in progress (not committed). */
export function liveProgress(mission: ActiveMission, run: RunStats, setsCompleted: number): number {
  const tpl = getTemplate(mission.id);
  const target = targetOf(mission.id, setsCompleted);
  if (!tpl) return 0;
  if (mission.done) return target;
  const value = Math.max(0, run[tpl.metric]);
  const p = tpl.mode === "total" ? mission.progress + value : Math.max(mission.progress, value);
  return Math.min(target, p);
}

export interface MissionView {
  id: string;
  text: string;
  progress: number;
  target: number;
  done: boolean;
  label: string;
  ratio: number;
}

export function describeMission(mission: ActiveMission, run: RunStats, setsCompleted: number): MissionView {
  const tpl = getTemplate(mission.id);
  const target = targetOf(mission.id, setsCompleted);
  const progress = Math.floor(liveProgress(mission, run, setsCompleted));
  const done = mission.done || progress >= target;
  const label = tpl?.label ? tpl.label(progress, target) : `${formatInt(progress)} / ${formatInt(target)}`;
  return {
    id: mission.id,
    text: tpl ? tpl.text(target) : "",
    progress,
    target,
    done,
    label: done ? "¡Hecho!" : label,
    ratio: target > 0 ? Math.min(1, progress / target) : 1,
  };
}

/**
 * Mark missions completed by the run in progress. Committed progress of unfinished missions is
 * left alone (the run is only added in `commitRun`), so nothing is ever counted twice.
 */
export function updateLive(state: MissionsState, run: RunStats): { state: MissionsState; newlyDone: string[] } {
  const newlyDone: string[] = [];
  const active = state.active.map((m) => {
    if (m.done) return m;
    const target = targetOf(m.id, state.setsCompleted);
    if (liveProgress(m, run, state.setsCompleted) >= target) {
      newlyDone.push(m.id);
      return { ...m, progress: target, done: true };
    }
    return m;
  });
  return { state: newlyDone.length ? { ...state, active } : state, newlyDone };
}

export interface CommitResult {
  state: MissionsState;
  newlyDone: string[];
  /** True when the three missions were done and a new set was drawn. */
  setCompleted: boolean;
}

/** Add a finished run to the missions. When all three are done, the set rolls over. */
export function commitRun(state: MissionsState, run: RunStats): CommitResult {
  const newlyDone: string[] = [];
  const active = state.active.map((m) => {
    if (m.done) return m;
    const target = targetOf(m.id, state.setsCompleted);
    const progress = Math.min(target, Math.floor(liveProgress(m, run, state.setsCompleted)));
    const done = progress >= target;
    if (done) newlyDone.push(m.id);
    return { ...m, progress, done };
  });
  if (active.length > 0 && active.every((m) => m.done)) {
    const setsCompleted = state.setsCompleted + 1;
    return { state: { setsCompleted, active: drawMissions(setsCompleted) }, newlyDone, setCompleted: true };
  }
  return { state: { ...state, active }, newlyDone, setCompleted: false };
}
