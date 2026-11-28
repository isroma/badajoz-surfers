"""Validate public/data/city.json. Exit code 1 if a hard check fails; warnings are only printed.

    uv run python check.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely.strtree import STRtree

CITY = Path(__file__).resolve().parents[2] / "public" / "data" / "city.json"
ZONE_IDS = ["puente-real", "valdepasillas", "san-francisco", "casco-antiguo", "alcazaba-palmas", "margen-derecha"]

fails: list[str] = []


def check(cond: bool, msg: str) -> None:
    print(("ok    " if cond else "FAIL  ") + msg)
    if not cond:
        fails.append(msg)


def radius(P: np.ndarray, span: int) -> np.ndarray:
    a, b, c = np.roll(P, span, 0), P, np.roll(P, -span, 0)
    ab, bc, ca = b - a, c - b, a - c
    cross = ab[:, 0] * bc[:, 1] - ab[:, 1] * bc[:, 0]
    la, lb, lc = (np.hypot(*v.T) for v in (ab, bc, ca))
    with np.errstate(divide="ignore", invalid="ignore"):
        r = la * lb * lc / (2 * np.abs(cross))
    return np.where(np.abs(cross) < 1e-9, np.inf, r), np.sign(cross)


def main() -> None:
    size = CITY.stat().st_size
    c = json.loads(CITY.read_text())
    m = c["meta"]
    P3 = np.asarray(c["route"]["points"], float).reshape(-1, 3)
    P, h = P3[:, :2], P3[:, 2]
    s = np.asarray(c["route"]["s"], float)
    L = m["lapLength"]
    n = len(s)
    print(f"lap {L} m, {n} points, file {size / 1e6:.2f} MB")

    # --- route
    check(len(P) == n == len(c["route"]["ground"]), "route arrays have the same length")
    check(bool(np.all(np.diff(s) > 0)) and s[0] == 0 and s[-1] < L, "s starts at 0, increases, ends before lapLength")
    gap = float(np.hypot(*(P[0] - P[-1])))
    check(gap <= 2.5 * m["routeStep"], f"loop closes in plan (last→first {gap:.2f} m)")
    check(abs(h[0] - h[-1]) <= 0.3, f"loop closes in height (Δh {h[0] - h[-1]:.2f} m)")
    check(abs(P[0]).max() < 1.5 and abs(h[0]) < 0.5, f"route starts at the origin at height ~0 ({P[0][0]:.2f}, {P[0][1]:.2f})")
    seg = np.hypot(*np.diff(np.vstack([P, P[:1]]), axis=0).T)
    check(seg.min() > 1.0 and seg.max() < 3.0, f"sample spacing {seg.min():.2f}–{seg.max():.2f} m")
    check(abs(seg.sum() - L) < 5, f"polyline length {seg.sum():.1f} ≈ lapLength")
    # curvature as the consumer measures it: circle through three consecutive 2 m samples. Inside
    # each roundabout pass window the ring's own target applies (≥ 20 m on rings with r ≥ 20 m,
    # the outer-lane radius on small ones); elsewhere ≥ 14 m.
    def in_rng(a, b):
        return (s >= a) & (s <= b) if a <= b else (s >= a) | (s <= b)

    r1, sign = radius(P, 1)
    need = np.full(n, 14.0)
    a2, b2, c2 = np.roll(P, 2, 0), P, np.roll(P, -2, 0)
    ab, bc, ca = b2 - a2, c2 - b2, a2 - c2
    k2 = 2 * (ab[:, 0] * bc[:, 1] - ab[:, 1] * bc[:, 0]) / (np.hypot(*ab.T) * np.hypot(*bc.T) * np.hypot(*ca.T))
    rate = np.abs(np.roll(k2, -1) - np.roll(k2, 1)) / np.hypot(*(np.roll(P, -1, 0) - np.roll(P, 1, 0)).T)
    rbs = c.get("roundabouts", [])
    check(len(rbs) == len({x["roundabout"]["cx"] for x in c["sections"] if x["roundabout"]}), f"{len(rbs)} roundabouts, one per ring the route uses")
    for rb in rbs:
        mm = in_rng(rb["passFromS"], rb["passToS"])
        need[mm] = np.minimum(need[mm], rb["minRadiusTarget"])
        rmin, rmax = float(r1[mm].min()), float(rate[mm].max())
        check(rmin >= rb["minRadiusTarget"] * 0.97 and rmax <= rb["curvatureRateLimit"] * 1.15,
              f"{rb['id']:34s} r {rb['minRadiusBefore']:5.1f} -> {rmin:5.1f} m (target {rb['minRadiusTarget']}), "
              f"dκ/ds {rmax:.4f} (≤ {rb['curvatureRateLimit']}), {rb['sweep']:4.0f}° round, ≤ {rb['maxDeviation']} m off the OSM ring")
        check(all(a["lines"] for a in rb["arms"]) and any(a["onRoute"] for a in rb["arms"]), f"{rb['id']}: {len(rb['arms'])} arms with geometry, route arm(s) identified")
    worst_i = int(np.argmin(r1 - need * 0.97))
    print(f"      min radius anywhere {r1.min():.2f} m (three consecutive samples)")
    check(bool(np.all(r1 >= need * 0.97)), f"curvature radius ≥ 14 m off roundabout passes and ≥ each ring's target on them (worst {r1[worst_i]:.2f} m at s={s[worst_i]:.1f})")
    off = np.ones(n, bool)
    for rb in rbs:
        off &= ~in_rng(rb["passFromS"], rb["passToS"])
    print(f"      max curvature rate off roundabout passes {rate[off].max():.4f} 1/m², on them {rate[~off].max():.4f}")
    r, sign = radius(P, 3)
    # grade over 10 m windows (heights are quantised to 0.1 m)
    k = 5
    g10 = np.abs(np.roll(h, -k) - h) / (k * m["routeStep"])
    check(float(g10.max()) <= 0.08 + 0.012, f"max grade over 10 m {g10.max() * 100:.1f} %")
    dg = np.abs(np.diff(np.r_[g10, g10[:1]]))
    print(f"      grade change per 2 m: max {dg.max() * 100:.2f} percentage points")

    # --- sections and zones
    secs = c["sections"]
    check(secs[0]["fromS"] == 0 and abs(secs[-1]["toS"] - L) < 0.2 and all(abs(a["toS"] - b["fromS"]) < 0.11 for a, b in zip(secs, secs[1:])),
          f"{len(secs)} sections tile [0, lap]")
    check(all(x["width"] > 0 for x in secs), "every section has a width")
    duals = [x for x in secs if x["dual"]]
    check(all(x["opposite"] and x["opposite"]["offset"] < 0 and x["opposite"]["lanes"] for x in duals),
          f"{len(duals)} dual sections: opposite carriageway on the left with a lane count")
    check(all(x["medianKind"] for x in duals if x["toS"] - x["fromS"] >= 20), "every dual section ≥ 20 m has a medianKind")
    for x in duals:
        print(f"      dual {x['fromS']:7.0f}–{x['toS']:7.0f} {x['name'] or '':32s} offset {x['opposite']['offset']:6.1f} "
              f"lanes {x['lanes']}+{x['opposite']['lanes']} median {x['medianKind']} {x['medianWidth']} m"
              f"{' footway' if x['medianFootway'] else ''}{' cycleway' if x['medianCycleway'] else ''} trees {x['medianTrees']}")
    zs = c["zones"]
    check([z["id"] for z in zs] == ZONE_IDS, "six zones in order with the game's ids")
    check(zs[0]["fromS"] == 0 and abs(zs[-1]["toS"] - L) < 0.2 and all(a["toS"] == b["fromS"] for a, b in zip(zs, zs[1:])), "zones tile the lap")
    check(all(z["toS"] - z["fromS"] > 200 for z in zs), "every zone is non-empty (> 200 m)")
    for z in zs:
        print(f"      {z['id']:16s} {z['fromS']:7.0f}–{z['toS']:7.0f}  {z['length']:6.0f} m")

    # roundabouts: anticlockwise (left turns: cross < 0 in x-east/z-south) and radius
    rings = [x for x in secs if x["roundabout"]]
    for x in rings:
        mm = (s >= x["fromS"]) & (s < x["toS"])
        idx = np.where(mm)[0]
        if len(idx) < 5:
            continue
        rb = x["roundabout"]
        # angle round the ring's centre, measured on the map (north up): anticlockwise = increasing
        ang = np.unwrap(np.arctan2(-(P[idx, 1] - rb["cz"]), P[idx, 0] - rb["cx"]))
        sweep = math.degrees(ang[-1] - ang[0])
        dist = np.hypot(P[idx, 0] - rb["cx"], P[idx, 1] - rb["cz"])
        check(sweep > 0, f"roundabout {x['name'] or '(unnamed)'} at s={x['fromS']:.0f}: r={rb['r']} m (route at {dist.min():.1f}–{dist.max():.1f} m from centre), anticlockwise sweep {sweep:.0f}°")

    # --- buildings
    B = c["buildings"]
    hs = np.array([b["height"] for b in B])
    check(bool(np.all((hs >= 2.5) & (hs <= 120))), f"{len(B)} buildings, heights within 2.5–120 m")
    pct = np.percentile(hs, [5, 25, 50, 75, 95, 99])
    print("      height percentiles 5/25/50/75/95/99: " + " / ".join(f"{v:.1f}" for v in pct) + f" ; max {hs.max():.1f}")
    srcs = {}
    for b in B:
        srcs[b["src"]] = srcs.get(b["src"], 0) + 1
    print(f"      height sources: {srcs}")
    tall = sorted(B, key=lambda b: -b["height"])[:8]
    print("      tallest: " + "; ".join(f"{(b.get('tags') or {}).get('name', b['id'])} {b['height']} m" for b in tall))

    # carriageway overlap, recomputed independently
    half = np.zeros(n)
    for x in secs:
        half[(s >= x["fromS"]) & (s < x["toS"])] = x["width"] / 2
    polys = [Polygon(np.asarray(b["ring"]).reshape(-1, 2)).buffer(0) for b in B]
    tree = STRtree(polys)
    hits = {}
    for i in range(n):
        q = Point(*P[i])
        for j in tree.query(q.buffer(half[i])):
            d = polys[j].distance(q)
            pen = half[i] - d if d > 0 else half[i] + polys[j].exterior.distance(q)
            if pen > 0.3:
                hits.setdefault(j, []).append((s[i], pen))
    flagged = {j for j, b in enumerate(B) if b.get("passesThrough")}
    check(set(hits) <= flagged, f"every building over the carriageway is flagged passesThrough ({len(hits)} found, {len(flagged)} flagged)")
    for j, lst in sorted(hits.items(), key=lambda kv: kv[1][0][0]):
        b = B[j]
        ss = [a for a, _ in lst]
        print(f"      over carriageway: {b['id']} {(b.get('tags') or {}).get('name', '')} s {min(ss):.0f}–{max(ss):.0f}, "
              f"{max(p for _, p in lst):.1f} m in{' (arch passage)' if b.get('passage') else ''}")

    # --- other layers
    T = np.asarray(c["trees"], float).reshape(-1, 5)
    check(len(T) <= 6000 and bool(np.all((T[:, 2] >= 2) & (T[:, 2] <= 35))) and set(np.unique(T[:, 4])) <= {0, 1, 2},
          f"{len(T)} trees (≤ 6000), heights 2–35 m; {int((T[:, 4] == 1).sum())} OSM palms, {int((T[:, 4] == 2).sum())} palm-likely")
    dec = [abs(v * 100 - round(v * 100)) < 1e-6 for v in c["route"]["points"][:300]]
    check(all(dec), "route written at 0.01 m precision")
    terr = c["terrain"]
    check(len(terr["h"]) == terr["nx"] * terr["nz"], f"terrain grid {terr['nx']}×{terr['nz']} @ {terr['cell']} m, water level {terr['waterLevel']}")
    for k in ("junctions", "streets", "landmarks", "water", "green", "squares", "parking", "furniture", "pois"):
        print(f"      {k}: {len(c[k])}")
    missing = [lm["id"] for lm in c["landmarks"] if lm.get("missing")]
    if missing:
        print(f"      landmarks not found in OSM: {missing}")
    check(size < 3_000_000, f"city.json is {size / 1e6:.2f} MB (< 3 MB)")
    if fails:
        print(f"\n{len(fails)} check(s) failed")
        sys.exit(1)
    print("\nall checks passed")


if __name__ == "__main__":
    main()
