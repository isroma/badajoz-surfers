/**
 * Human-readable table of the lap's lane stretches, for sanity checks against the real streets.
 * Printed by `PRINT_LAYOUTS=1 npx vitest run src/city` (see city.test.ts).
 */
import type { Track } from "./track";

const pad = (v: string, n: number): string => (v.length >= n ? v : v + " ".repeat(n - v.length));
const f1 = (v: number): string => v.toFixed(1);

export function formatLayoutTable(track: Track): string {
  const rows: string[] = [];
  rows.push(
    [pad("s from-to", 15), pad("len", 5), pad("zone", 15), pad("street (longest section)", 36), pad("kind", 18), "n", pad("flows", 12), pad("ids", 40), pad("offsets", 34), pad("widths", 24), "gaps"].join(" "),
  );
  for (const st of track.stretches) {
    const l = st.layout;
    const sec = st.section;
    const kind = sec.roundabout ? `ring r${f1(sec.roundabout.r)}` : sec.pedestrian ? sec.highway : sec.dual ? `dual ${sec.opposite?.offset ?? ""}` : sec.oneway ? "oneway" : "two-way";
    rows.push(
      [
        pad(`${f1(st.fromS)}-${f1(st.toS)}`, 15),
        pad(String(Math.round(st.toS - st.fromS)), 5),
        pad(track.zoneAt((st.fromS + st.toS) / 2).id, 15),
        pad((sec.name ?? "(unnamed)").slice(0, 36), 36),
        pad(`${kind} ${sec.highway}`.slice(0, 18), 18),
        String(l.offsets.length),
        pad(l.flow.map((x) => (x > 0 ? "+" : x < 0 ? "-" : "0")).join(""), 12),
        pad(l.ids.join(" "), 40),
        pad(l.offsets.map(f1).join(" "), 34),
        pad(l.widths.map(f1).join(" "), 24),
        l.gaps.map(f1).join(" "),
      ].join(" "),
    );
  }
  rows.push("", "Transitions (s: ends | begins | continues as another id)");
  for (const t of track.transitions) {
    const a = track.stretches[t.fromIndex]!.layout;
    const b = track.stretches[t.toIndex]!.layout;
    const ends = a.ids.filter((_, i) => t.map[i] === null);
    const begins = t.begins.map((j) => b.ids[j]!);
    const renamed = a.ids.flatMap((id, i) => {
      const j = t.map[i];
      return j !== null && j !== undefined && b.ids[j] !== id ? [`${id}→${b.ids[j]!}`] : [];
    });
    rows.push(`${pad(f1(t.s), 8)} ${pad((track.stretches[t.toIndex]!.section.name ?? "(unnamed)").slice(0, 30), 30)} ends: ${pad(ends.join(",") || "-", 24)} begins: ${pad(begins.join(",") || "-", 24)} ${renamed.join(" ")}`);
  }
  rows.push("", "Turns");
  for (const t of track.turns) {
    rows.push(
      `${pad(`${f1(t.s)}-${f1(t.endS)}`, 16)} ${pad(t.direction, 6)} ${pad(`${Math.round(t.angle)}°`, 5)} r ${pad(f1(t.radius), 7)} ${t.roundabout ? `ROUNDABOUT ring ${f1(t.entryS ?? 0)}-${f1(t.exitS ?? 0)} ` : ""}→ ${t.exitName ?? "-"}`,
    );
  }
  return rows.join("\n");
}
