/** Player-facing Spanish copy that depends on game data. */
import type { ObstacleKind, RunSummary } from "../contracts";

const CRASH_LINES: Record<ObstacleKind, string> = {
  valla: "Esa valla de obras no se iba a mover",
  conos: "Los conos estaban ahí por algo",
  terraza: "Otra terraza, otro disgusto",
  "valla-larga": "Había que saltar, campeón",
  andamio: "¡Agacha la cabeza!",
  pancarta: "Te has llevado la pancarta de la feria",
  contenedor: "Directo al contenedor",
  coche: "Ese coche no estaba en tus planes",
  moto: "La moto ni te ha visto venir",
  furgoneta: "Has frenado la furgoneta… con la cara",
  bus: "Te has comido el autobús",
  "camion-rampa": "La grúa te ha recogido a ti",
};

const CRASH_SUBS = [
  "Y el camarero ya viene con la cuenta.",
  "El camarero se frota las manos.",
  "Desde la terraza se oyen las risas.",
];

export function gameOverHeadline(summary: RunSummary): { title: string; sub: string } {
  if (summary.cause === "caught") {
    return { title: "¡Te pilló el camarero!", sub: "Dos tropiezos seguidos y te ha alcanzado. Toca pagar." };
  }
  const title = summary.obstacle ? CRASH_LINES[summary.obstacle] : "¡Menudo golpe!";
  const sub = CRASH_SUBS[Math.floor(summary.distance) % CRASH_SUBS.length] ?? CRASH_SUBS[0] ?? "";
  return { title, sub };
}

export const PREMISE = "Te has ido sin pagar. El camarero no perdona.";
