/**
 * Long-term progression (pure logic): lifetime totals, local records, achievements ("Logros")
 * and the daily challenge ("Reto del día").
 */
import { ZONES } from "../contracts";
import { formatInt, formatMetres } from "./format";
import { MISSION_POOL, getTemplate, type RunStats } from "./missions";

// ------------------------------------------------------------------ lifetime totals

export interface Lifetime {
  /** Sums of every finished run. */
  totals: RunStats;
  /** Bitmask of zone indices ever reached (bit i = ZONES[i]). */
  zonesSeen: number;
  /** Most zones completed in a single run. */
  bestZones: number;
  /** Best single-run values, for achievements like "10.000 m en una carrera". */
  bestRun: { distance: number; bellotas: number; zones: number; score: number };
}

const ALL_ZONES_MASK = (1 << ZONES.length) - 1;

/** Zones reached in a run that completed `zones` zones (the start zone counts). */
export const zonesMask = (zones: number): number => {
  const reached = Math.min(ZONES.length, Math.max(0, Math.floor(zones)) + 1);
  return (1 << reached) - 1;
};

export function addRunToLifetime(life: Lifetime, run: RunStats): Lifetime {
  const totals = { ...life.totals };
  for (const k of Object.keys(totals) as (keyof RunStats)[]) totals[k] += Math.max(0, run[k]);
  return {
    totals,
    zonesSeen: life.zonesSeen | zonesMask(run.zones),
    bestZones: Math.max(life.bestZones, run.zones),
    bestRun: {
      distance: Math.max(life.bestRun.distance, run.distance),
      bellotas: Math.max(life.bestRun.bellotas, run.bellotas),
      zones: Math.max(life.bestRun.zones, run.zones),
      score: Math.max(life.bestRun.score, run.score),
    },
  };
}

/** Zone and lap reached for a number of completed zones: 9 → Casco Antiguo, vuelta 2. */
export function zoneReached(zones: number): { zoneIndex: number; name: string; lap: number } {
  const z = Math.max(0, Math.floor(zones));
  const zoneIndex = z % ZONES.length;
  return { zoneIndex, name: ZONES[zoneIndex]?.name ?? "", lap: Math.floor(z / ZONES.length) + 1 };
}

// ------------------------------------------------------------------ records

export interface RunRecord {
  /** Local calendar day, "YYYY-MM-DD". */
  date: string;
  score: number;
  distance: number;
  /** Zones completed in the run. */
  zones: number;
}

export const MAX_RECORDS = 5;

/** Insert a run into the top list (by score, then distance). Returns the list and the new rank (or -1). */
export function addRecord(records: readonly RunRecord[], rec: RunRecord): { records: RunRecord[]; rank: number } {
  if (rec.score <= 0 && rec.distance <= 0) return { records: [...records], rank: -1 };
  const list = [...records, rec].sort((a, b) => b.score - a.score || b.distance - a.distance);
  const top = list.slice(0, MAX_RECORDS);
  return { records: top, rank: top.indexOf(rec) };
}

export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "2026-11-27" → "27 nov 2026". */
export function formatDay(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""} ${m[1]}`;
}

// ------------------------------------------------------------------ achievements

/** What achievements look at besides the lifetime totals. */
export interface AchievementExtra {
  /** Outfits owned, including the free one. */
  outfitsOwned: number;
  outfitsTotal: number;
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  reward: number;
  /** `life` already includes the run in progress. */
  check(life: Lifetime, extra: AchievementExtra): boolean;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: "primer-simpa", name: "Primer simpa", description: "Termina tu primera carrera", reward: 50, check: (l) => l.totals.runs >= 1 },
  { id: "plaza-alta", name: "Subiendo a la Plaza Alta", description: "Llega al Casco Antiguo", reward: 100, check: (l) => l.bestZones >= 3 },
  { id: "turista", name: "Turista", description: "Llega a cada una de las seis zonas", reward: 200, check: (l) => (l.zonesSeen & ALL_ZONES_MASK) === ALL_ZONES_MASK },
  { id: "vuelta-al-ruedo", name: "Vuelta al ruedo", description: "Completa una vuelta a Badajoz", reward: 300, check: (l) => l.bestZones >= 6 },
  { id: "ni-el-camarero", name: "Ni el camarero te sigue", description: "Da dos vueltas en una sola carrera", reward: 600, check: (l) => l.bestZones >= 12 },
  { id: "simpa-profesional", name: "Simpa profesional", description: `Corre ${formatMetres(10000)} en una carrera`, reward: 1000, check: (l) => l.bestRun.distance >= 10000 },
  { id: "maraton", name: "Maratón del Guadiana", description: `Corre ${formatMetres(42195)} en total`, reward: 500, check: (l) => l.totals.distance >= 42195 },
  { id: "ciguena", name: "Cigüeña", description: `Corre ${formatMetres(500)} por los techos en total`, reward: 250, check: (l) => l.totals.roofMetres >= 500 },
  { id: "pacense-de-pro", name: "Pacense de pro", description: "Completa BADAJOZ 5 veces", reward: 400, check: (l) => l.totals.words >= 5 },
  { id: "por-los-pelos", name: "Por los pelos", description: "Roza 50 vehículos", reward: 200, check: (l) => l.totals.nearMisses >= 50 },
  { id: "saltimbanqui", name: "Saltimbanqui", description: "Salta 500 veces", reward: 200, check: (l) => l.totals.jumps >= 500 },
  { id: "croqueta", name: "La croqueta", description: "Rueda 200 veces", reward: 200, check: (l) => l.totals.rolls >= 200 },
  { id: "hucha", name: "Hucha de barro", description: `Recoge ${formatInt(5000)} bellotas en total`, reward: 300, check: (l) => l.totals.bellotas >= 5000 },
  { id: "atracon", name: "Atracón de bellotas", description: "Recoge 300 bellotas en una carrera", reward: 300, check: (l) => l.bestRun.bellotas >= 300 },
  { id: "jamonero", name: "Jamonero", description: "Usa 50 potenciadores", reward: 250, check: (l) => l.totals.powerups >= 50 },
  { id: "parroquiano", name: "Parroquiano", description: "Juega 25 carreras", reward: 200, check: (l) => l.totals.runs >= 25 },
  { id: "estrenando", name: "De estreno", description: "Compra tu primer atuendo", reward: 100, check: (_l, x) => x.outfitsOwned >= 2 },
  { id: "fondo-de-armario", name: "Fondo de armario", description: "Consigue todos los atuendos", reward: 1500, check: (_l, x) => x.outfitsTotal > 0 && x.outfitsOwned >= x.outfitsTotal },
];

/** Achievements newly unlocked by `life` (not in `unlocked`). */
export function newAchievements(
  unlocked: readonly string[],
  life: Lifetime,
  extra: AchievementExtra = { outfitsOwned: 1, outfitsTotal: 0 },
): AchievementDef[] {
  const have = new Set(unlocked);
  return ACHIEVEMENTS.filter((a) => !have.has(a.id) && a.check(life, extra));
}

// ------------------------------------------------------------------ daily challenge

export interface DailyState {
  /** Day the progress belongs to. */
  date: string;
  progress: number;
  done: boolean;
}

export interface DailyChallenge {
  date: string;
  templateId: string;
  target: number;
  reward: number;
  text: string;
}

/** Templates good for a one-day challenge, with their daily target tier and reward. */
const DAILY_POOL: readonly { id: string; tier: number; reward: number }[] = [
  { id: "bellotas-run", tier: 2, reward: 400 },
  { id: "distance-run", tier: 2, reward: 400 },
  { id: "jumps", tier: 1, reward: 300 },
  { id: "rolls", tier: 1, reward: 300 },
  { id: "roofs", tier: 1, reward: 400 },
  { id: "near-misses", tier: 1, reward: 350 },
  { id: "words", tier: 1, reward: 350 },
  { id: "zone-reach", tier: 2, reward: 450 },
  { id: "laps", tier: 0, reward: 600 },
  { id: "powerups", tier: 1, reward: 300 },
  { id: "score-run", tier: 2, reward: 500 },
  { id: "letters", tier: 1, reward: 300 },
];

/** FNV-1a hash of the day key: the same day always gives the same challenge. */
function hashDay(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function dailyChallenge(date: string): DailyChallenge {
  const pick = DAILY_POOL[hashDay(date) % DAILY_POOL.length] ?? DAILY_POOL[0] ?? { id: "jumps", tier: 1, reward: 300 };
  const tpl = getTemplate(pick.id) ?? MISSION_POOL[0];
  const target = tpl?.targets[pick.tier] ?? 10;
  return { date, templateId: pick.id, target, reward: pick.reward, text: tpl?.text(target) ?? "" };
}

/** Today's state (a stored state from another day starts over). */
export const dailyFor = (state: DailyState, date: string): DailyState =>
  state.date === date ? state : { date, progress: 0, done: false };

/** Progress with the run in progress (not committed). */
export function dailyLive(state: DailyState, run: RunStats, date: string): number {
  const s = dailyFor(state, date);
  const c = dailyChallenge(date);
  if (s.done) return c.target;
  const tpl = getTemplate(c.templateId);
  if (!tpl) return 0;
  const value = Math.max(0, run[tpl.metric]);
  return Math.min(c.target, tpl.mode === "total" ? s.progress + value : Math.max(s.progress, value));
}

/** Mark the daily done during a run (progress of unfinished days is only added by `dailyCommit`). */
export function dailyCheck(state: DailyState, run: RunStats, date: string): { state: DailyState; completed: boolean } {
  const s = dailyFor(state, date);
  if (s.done) return { state: s, completed: false };
  const c = dailyChallenge(date);
  if (dailyLive(s, run, date) >= c.target) return { state: { date, progress: c.target, done: true }, completed: true };
  return { state: s, completed: false };
}

export function dailyCommit(state: DailyState, run: RunStats, date: string): { state: DailyState; completed: boolean } {
  const s = dailyFor(state, date);
  if (s.done) return { state: s, completed: false };
  const c = dailyChallenge(date);
  const progress = Math.floor(dailyLive(s, run, date));
  const done = progress >= c.target;
  return { state: { date, progress, done }, completed: done };
}
