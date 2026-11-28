"""Roundabouts: full ring geometry from OSM, and a fluid driving line through each ring pass.

The driving line through a ring pass is solved as a curvature profile: the path is integrated
from a fixed start state (position, heading, curvature of the route ~40 m before the ring) to a
fixed end state (~40 m after it), minimising the curvature rate (smooth, clothoid-like
transitions) plus curvature, while staying off the island (≥ rInner + half a lane), inside the
carriageway on the ring (≤ rOuter − 1 m), pulled towards the outer lane's reference radius
(rOuter − half a lane), with |curvature| ≤ 1 / target radius and |d curvature/ds| bounded so the
heading rate ramps over ≥ 12 m.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import minimize
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import polygonize, unary_union

from osm import OSM, Geo

LANE = 3.5
APPROACH = 40.0  # metres of route re-solved before entry and after exit
RAMP = 12.0  # the heading rate must ramp over at least this length


@dataclass
class Ring:
    key: tuple[float, float]
    cx: float
    cz: float
    r: float  # radius of the OSM ring centreline (equivalent circle of the enclosed island polygon)
    lanes: int
    width: float
    rInner: float
    rOuter: float
    island_mapped: bool
    ways: list[int] = field(default_factory=list)
    name: str | None = None
    highway: str | None = None

    @property
    def r_ref(self) -> float:
        """Reference radius of the runner's line on the ring: the outer (kerb) lane."""
        return max(self.rOuter - LANE / 2, self.rInner + LANE / 2)

    @property
    def r_target(self) -> float:
        """Minimum radius aimed for anywhere on a pass through this ring."""
        return 20.0 if self.r >= 20 else self.r_ref


def num(v):
    try:
        return float(str(v).split(";")[0].replace(",", "."))
    except (TypeError, ValueError):
        return None


def ring_geometry(osm: OSM, geo: Geo, rings: dict) -> dict[tuple[float, float], Ring]:
    """One Ring per roundabout (keyed by rounded centre), from the per-way `rings` map."""
    by_key: dict[tuple[float, float], Ring] = {}
    green_areas = [poly for _, _, t, poly in geo.areas(
        lambda t: t.get("landuse") in ("grass", "flowerbed") or t.get("leisure") in ("garden", "park")
        or t.get("natural") in ("scrub", "grassland") or t.get("amenity") == "fountain" or t.get("place") == "square"
        or (t.get("highway") == "pedestrian" and t.get("area") == "yes") or t.get("area:highway") == "traffic_island")]
    for wid, (cx, cz, r) in rings.items():
        key = (round(cx, 1), round(cz, 1))
        ring = by_key.get(key)
        if ring is None:
            ring = Ring(key, cx, cz, r, 0, 0.0, 0.0, 0.0, False)
            by_key[key] = ring
        ring.ways.append(wid)
    for ring in by_key.values():
        tags = [osm.ways[w].tags for w in ring.ways]
        lanes = [num(t.get("lanes")) for t in tags if num(t.get("lanes"))]
        widths = [num(t.get("width")) for t in tags if num(t.get("width"))]
        hw = max((t.get("highway") for t in tags), key=lambda h: ["residential", "unclassified", "tertiary", "secondary", "primary", "trunk"].index(h) if h in ("residential", "unclassified", "tertiary", "secondary", "primary", "trunk") else -1)
        ring.highway = hw
        ring.lanes = int(max(lanes)) if lanes else (2 if hw in ("trunk", "primary", "secondary") else 1)
        ring.width = float(max(widths)) if widths else ring.lanes * LANE
        names = [t.get("name") for t in tags if t.get("name")]
        ring.name = max(set(names), key=names.count) if names else None
        ring.rInner, ring.rOuter = ring.r - ring.width / 2, ring.r + ring.width / 2
        # a mapped island area (grass, garden, fountain, square…) of plausible size gives the kerb
        c = Point(ring.cx, ring.cz)
        best = None
        for poly in green_areas:
            if poly.contains(c) and poly.area < math.pi * (ring.r + 2) ** 2:
                ri = math.sqrt(poly.area / math.pi)
                # only an area that reaches out to about where the kerb should be (not a fountain
                # or flowerbed in the middle of the island)
                if ring.r - ring.width / 2 - 1.5 <= ri <= ring.r - 0.5 and (best is None or ri > best):
                    best = ri
        if best is not None:
            ring.rInner, ring.rOuter, ring.island_mapped = best, best + ring.width, True
    return by_key


def _integrate(kappa: np.ndarray, ds: float, x0: np.ndarray, psi0: float):
    psi = psi0 + np.concatenate([[0], np.cumsum((kappa[:-1] + kappa[1:]) / 2 * ds)])
    mid = (psi[:-1] + psi[1:]) / 2
    steps = np.c_[np.cos(mid), np.sin(mid)] * ds
    pos = x0 + np.vstack([[0, 0], np.cumsum(steps, axis=0)])
    return pos, psi


def _state(p: np.ndarray, k: int):
    """Position, heading (rad, in the x/z plane) and signed curvature at index k (1 m samples)."""
    a, b, c = p[k - 3], p[k], p[k + 3]
    t = c - a
    psi = math.atan2(t[1], t[0])
    ab, bc, ca = b - a, c - b, a - c
    cross = ab[0] * bc[1] - ab[1] * bc[0]
    la, lb, lc = np.hypot(*ab), np.hypot(*bc), np.hypot(*ca)
    kappa = 2 * cross / (la * lb * lc) if la * lb * lc > 0 else 0.0
    return p[k].copy(), psi, kappa


def radius3(P: np.ndarray, span: int = 1) -> np.ndarray:
    a, b, c = np.roll(P, span, 0), P, np.roll(P, -span, 0)
    ab, bc, ca = b - a, c - b, a - c
    cross = ab[:, 0] * bc[:, 1] - ab[:, 1] * bc[:, 0]
    la, lb, lc = (np.hypot(*v.T) for v in (ab, bc, ca))
    with np.errstate(divide="ignore", invalid="ignore"):
        r = la * lb * lc / (2 * np.abs(cross))
    return np.where(np.abs(cross) < 1e-12, np.inf, r)


def solve_pass(p: np.ndarray, w0: int, w1: int, a: int, b: int, ring: Ring, relax: float = 1.0,
               rate_relax: float = 1.0) -> tuple[np.ndarray | None, dict]:
    """Re-solve p[w0..w1] (1 m samples; the ring run is p[a..b]). Returns the new points
    (same count as the old window) or None when the solver fails."""
    old = p[w0:w1 + 1]
    seg = np.hypot(*np.diff(old, axis=0).T)
    L0 = float(seg.sum())
    K = max(40, int(L0 / 1.5))
    x0, psi0, k0 = _state(p, w0)
    x1, psi1, k1 = _state(p, w1)
    # the net turn of the old window fixes the 2π ambiguity of the end heading
    hd = np.unwrap(np.arctan2(*np.diff(old, axis=0).T[::-1]))
    turn = hd[-1] - hd[0]
    psi1 = psi0 + turn + ((psi1 - psi0 - turn + math.pi) % (2 * math.pi) - math.pi)
    # initial guess: curvature of the old window resampled to K segments
    cum = np.concatenate([[0], np.cumsum(seg)])
    tt = np.linspace(0, L0, K + 1)
    guess_pts = np.c_[np.interp(tt, cum, old[:, 0]), np.interp(tt, cum, old[:, 1])]
    gh = np.unwrap(np.arctan2(*np.diff(guess_pts, axis=0).T[::-1]))
    gk = np.gradient(np.r_[gh[0], gh], tt) if K > 2 else np.zeros(K + 1)
    gk[0], gk[-1] = k0, k1
    # where along the window the ring is (fractions), for the band constraint
    fa, fb = (cum[a - w0]) / L0, (cum[b - w0]) / L0
    core = (tt / L0 > fa + 4 / L0) & (tt / L0 < fb - 4 / L0)
    C = np.array([ring.cx, ring.cz])
    r_in = ring.rInner + LANE / 2
    r_out = ring.rOuter - 1.0
    r_ref = ring.r_ref
    kmax = 0.96 * relax / ring.r_target  # 4 % margin for the 2 m resampling and 0.01 m rounding
    rate_max = 0.92 * rate_relax / ring.r_target / RAMP

    def unpack(x):
        kappa = np.concatenate([[k0], x[:-1], [k1]])
        return kappa, x[-1]

    def path(x):
        kappa, ds = unpack(x)
        return _integrate(kappa, ds, x0, psi0)

    def objective(x):
        kappa, ds = unpack(x)
        pos, _ = _integrate(kappa, ds, x0, psi0)
        d = np.hypot(*(pos - C).T)
        rate = np.diff(kappa) / ds
        return (400.0 * np.sum(rate ** 2) * ds + 1.0 * np.sum(kappa ** 2) * ds
                + 0.02 * np.sum((d[core] - r_ref) ** 2) * ds)

    def eq(x):
        pos, psi = path(x)
        return np.r_[pos[-1] - x1, psi[-1] - psi1]

    def ineq(x):
        kappa, ds = unpack(x)
        pos, _ = _integrate(kappa, ds, x0, psi0)
        d = np.hypot(*(pos - C).T)
        rate = np.diff(kappa) / ds
        out = [d - r_in, kmax * 1.0 - np.abs(kappa[1:-1]) + 1e-9, rate_max - np.abs(rate)]
        if core.any():
            out.append(r_out - d[core])
        return np.concatenate(out)

    xg = np.r_[gk[1:-1], L0 / K]
    bounds = [(-0.3, 0.3)] * (K - 1) + [(0.6 * L0 / K, 1.6 * L0 / K)]
    res = minimize(objective, xg, method="SLSQP", bounds=bounds,
                   constraints=[{"type": "eq", "fun": eq}, {"type": "ineq", "fun": ineq}],
                   options={"maxiter": 400, "ftol": 1e-9})
    info = {"success": bool(res.success), "message": str(res.message)}
    pos, psi = path(res.x)
    viol = min(float(ineq(res.x).min()), 0.0)
    err = float(np.abs(eq(res.x)).max())
    info.update({"eqError": err, "ineqViolation": viol})
    if err > 0.05 or viol < -0.02:
        return None, info
    # back to as many points as the old window, evenly spaced along the new curve
    segn = np.hypot(*np.diff(pos, axis=0).T)
    cn = np.concatenate([[0], np.cumsum(segn)])
    tn = np.linspace(0, cn[-1], len(old))
    new = np.c_[np.interp(tn, cn, pos[:, 0]), np.interp(tn, cn, pos[:, 1])]
    kappa, ds = unpack(res.x)
    info.update({"maxRate": float(np.abs(np.diff(kappa) / ds).max()), "length": float(cn[-1]), "oldLength": L0,
                 "maxCurvature": float(np.abs(kappa).max()), "kappaEnds": (float(k0), float(k1)), "kmax": kmax})
    return new, info


def fluid_rings(p: np.ndarray, way1: np.ndarray, rings: dict, ringgeo: dict) -> tuple[np.ndarray, list[dict]]:
    """Replace every ring pass of the closed 1 m route p with a solved fluid line."""
    n = len(p)
    ring1 = np.array([w in rings for w in way1])
    keys = [(round(rings[w][0], 1), round(rings[w][1], 1)) if w in rings else None for w in way1]
    # roll so that index 0 is in the middle of the longest stretch without rings
    idx = np.where(ring1)[0]
    gaps = np.diff(np.r_[idx, idx[0] + n])
    g = int(np.argmax(gaps))
    shift = int((idx[g] + gaps[g] // 2) % n)
    P = np.roll(p, -shift, 0)
    R1 = np.roll(ring1, -shift)
    K1 = keys[shift:] + keys[:shift]
    runs = []
    k = 0
    while k < n:
        if R1[k]:
            j = k
            while j + 1 < n and R1[j + 1] and K1[j + 1] == K1[k]:
                j += 1
            runs.append((k, j, K1[k]))
            k = j + 1
        else:
            k += 1
    report = []
    for i, (a, b, key) in enumerate(runs):
        ring = ringgeo[key]
        prev_b = runs[i - 1][1] if i > 0 else -10**9
        next_a = runs[i + 1][0] if i + 1 < len(runs) else 10**9
        w0 = int(max(a - APPROACH, (prev_b + a) // 2 + 1, 4))
        w1 = int(min(b + APPROACH, (b + next_a) // 2 - 1, n - 5))
        before = radius3(P[max(w0 - 3, 0):w1 + 4][::2], 1)[2:-2].min()
        # first relax only the curvature-rate limit, then the radius
        for relax, rate_relax in ((1.0, 1.0), (1.0, 1.3), (1.0, 1.6), (1.1, 1.8), (1.25, 2.2), (1.45, 2.6)):
            new, info = solve_pass(P, w0, w1, a, b, ring, relax, rate_relax)
            info["relax"], info["rateRelax"] = relax, rate_relax
            if new is not None:
                break
        entry = {"key": key, "name": ring.name, "fromIdx": w0, "toIdx": w1, "minRadiusBefore": float(before),
                 "startXZ": P[w0].copy(), "endXZ": P[w1].copy(), **info}
        if new is not None:
            # lateral deviation of the new ring arc from the OSM ring centreline
            d = np.hypot(*(new[(a - w0):(b - w0 + 1)] - (ring.cx, ring.cz)).T)
            entry["maxDeviationFromRingCentreline"] = float(np.abs(d - ring.r).max())
            entry["maxShift"] = float(np.hypot(*(new - P[w0:w1 + 1]).T).max())
            P[w0:w1 + 1] = new
            entry["minRadiusAfter"] = float(radius3(P[max(w0 - 3, 0):w1 + 4][::2], 1)[2:-2].min())
        report.append(entry)
    return np.roll(P, shift, 0), report


# ---------------------------------------------------------------------------
# Arms and island contents for the `roundabouts` output


def ring_arms(osm: OSM, geo: Geo, ring: Ring, route_ways: set[int]) -> list[dict]:
    ring_nodes = set()
    for w in ring.ways:
        ring_nodes.update(osm.ways[w].nodes)
    # all ring ways of this roundabout, including ones the route does not use
    for w in osm.ways.values():
        if w.tags.get("junction") in ("roundabout", "circular") and "highway" in w.tags and set(w.nodes) & ring_nodes:
            c = geo.way_xz(w)
            if c is not None and abs(np.hypot(*(c.mean(0) - (ring.cx, ring.cz))) - ring.r) < ring.r * 0.6 + 3:
                ring_nodes.update(w.nodes)
    legs = []
    for w in osm.ways.values():
        t = w.tags
        hw = t.get("highway")
        if not hw or t.get("junction") in ("roundabout", "circular"):
            continue
        if hw in ("footway", "path", "cycleway", "steps", "construction", "proposed", "platform", "corridor"):
            continue
        touch = [i for i, nd in enumerate(w.nodes) if nd in ring_nodes]
        if not touch or (touch[0] not in (0, len(w.nodes) - 1) and len(w.nodes) > 1):
            # a way crossing the ring node mid-way: treat both halves as legs
            pass
        c = geo.way_xz(w)
        if c is None:
            continue
        for ti in touch:
            for direction in (+1, -1):
                seg = c[ti::direction] if direction > 0 else c[ti::-1]
                if len(seg) < 2:
                    continue
                # outward only: the leg must leave the ring
                if np.hypot(*(seg[-1] - (ring.cx, ring.cz))) < ring.r + 1:
                    continue
                ow = t.get("oneway")
                if ow in ("yes", "1", "true"):
                    flow = "exit" if direction > 0 else "entry"
                elif ow == "-1":
                    flow = "entry" if direction > 0 else "exit"
                else:
                    flow = "both"
                ln = LineString(seg)
                cut = LineString([ln.interpolate(d).coords[0] for d in np.arange(0, min(40.0, ln.length) + 0.01, 2.0)]) if ln.length > 2 else ln
                q = seg[0]
                brg = (math.degrees(math.atan2(q[0] - ring.cx, -(q[1] - ring.cz))) + 360) % 360
                lanes = num(t.get("lanes"))
                legs.append({"way": w.id, "name": t.get("name"), "highway": hw, "flow": flow, "bearing": brg,
                             "lanes": lanes, "width": num(t.get("width")), "line": np.asarray(cut.coords),
                             "onRoute": w.id in route_ways})
    # group legs into arms: a two-way leg is an arm on its own; a one-way entry and a one-way exit
    # form one arm (with a splitter island between them) when they share a name and are < 100°
    # apart round the ring, or when their ends 40 m out are < 20 m apart (a divided road whose
    # carriageways carry different names)
    legs.sort(key=lambda l: l["bearing"])

    def dang(a, b):
        d = abs(a - b) % 360
        return min(d, 360 - d)

    used = set()
    arms: list[list[dict]] = []
    for i, leg in enumerate(legs):
        if i in used:
            continue
        used.add(i)
        arm = [leg]
        if leg["flow"] != "both":
            want = "exit" if leg["flow"] == "entry" else "entry"
            best, bd = None, 1e9
            for j, o in enumerate(legs):
                if j in used or o["flow"] != want:
                    continue
                gap = float(np.hypot(*(o["line"][-1] - leg["line"][-1])))
                same = o["name"] == leg["name"] and dang(o["bearing"], leg["bearing"]) < 100
                if (same or gap < 20) and dang(o["bearing"], leg["bearing"]) < bd:
                    best, bd = j, dang(o["bearing"], leg["bearing"])
            if best is not None:
                used.add(best)
                arm.append(legs[best])
        arms.append(arm)
    return arms


def island_contents(osm: OSM, geo: Geo, ring: Ring) -> list[dict]:
    out = []
    c = Point(ring.cx, ring.cz)
    disc = c.buffer(max(ring.rInner, 1.0))
    for nid, t in osm.node_tags.items():
        x, z = geo.node_xz[nid]
        if disc.contains(Point(x, z)) and (t.get("natural") or t.get("amenity") or t.get("historic") or t.get("tourism")
                                           or t.get("man_made") or t.get("name") or t.get("leisure")):
            out.append({"osm": f"n{nid}", "x": x, "z": z, "tags": {k: v for k, v in t.items() if k in (
                "natural", "amenity", "historic", "tourism", "man_made", "name", "leisure", "memorial", "artwork_type", "genus", "species")}})
    for kind, oid, t, poly in geo.areas(lambda t: any(k in t for k in ("landuse", "leisure", "amenity", "natural", "historic", "tourism", "man_made", "place", "area:highway", "building"))):
        if poly.representative_point().within(disc) and poly.area < disc.area * 1.5:
            out.append({"osm": f"{kind}{oid}", "x": poly.centroid.x, "z": poly.centroid.y, "area": poly.area,
                        "tags": {k: v for k, v in t.items() if k in ("landuse", "leisure", "amenity", "natural", "historic", "tourism", "man_made", "name", "place", "area:highway", "building")}})
    return out
