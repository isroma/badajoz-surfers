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
    [pad("s from-to", 15), pad("len", 5), pad("zone", 15), pad("street (longest section)", 36), pad("kind", 18), "n", pad("flows", 12), pad("kinds", 10), pad("offsets", 34), pad("widths", 24), "gaps"].join(" "),
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
        pad(l.kinds.map((k) => (k === "road" ? "R" : k === "sidewalk" ? "S" : k === "median" ? "M" : "P")).join(""), 10),
        pad(l.offsets.map(f1).join(" "), 34),
        pad(l.widths.map(f1).join(" "), 24),
        l.gaps.map(f1).join(" "),
      ].join(" "),
    );
  }
  return rows.join("\n");
}
