"""Build public/data/city.json for Badajoz Surfers from OpenStreetMap and PNOA-LiDAR.

    cd tools/city && uv run python build.py      # then: uv run python check.py && uv run python render.py

See README.md for the output format and the method.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.ndimage import binary_dilation, distance_transform_edt, gaussian_filter1d, maximum_filter
from scipy.spatial import cKDTree
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box, mapping
from shapely.ops import transform as shp_transform
from shapely.ops import unary_union
from shapely.strtree import STRtree

from fetch_osm import merged_path
from lap import START_NODE, raw_lap, resample, radius_over, smooth_closed
from osm import CACHE, OSM, Frame, Geo
from rasters import DSM, DSM_LEAFOFF, DTM, Ndvi, Raster
from route import roundabout_islands

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "data" / "city.json"
STEP = 2.0  # route sample spacing (m)
R_MIN = 14.0  # minimum corner radius after smoothing
R_RING_MIN = 12.0  # roundabout rings keep their real radius if at least this
MAX_GRADE = 0.08
PINNED_WAYS = {96659407}  # footway out of the Puerta de Palmas archway (+ the connector to the bridge path)

ZONE_IDS = ["puente-real", "valdepasillas", "san-francisco", "casco-antiguo", "alcazaba-palmas", "margen-derecha"]

ATTRIBUTION = [
    "Datos de calles, edificios, comercios y mobiliario © colaboradores de OpenStreetMap (ODbL), openstreetmap.org/copyright",
    "Alturas de edificios, árboles y terreno: Obra derivada de MDS02 2015-2021 CC-BY 4.0 scne.es",
    "Obra derivada de MDT02-cob2 2015-2021 CC-BY 4.0 scne.es",
    "Índice de vegetación: contiene datos modificados de Copernicus Sentinel-2 (2025)",
]

PEDESTRIAN = {"pedestrian", "footway", "path", "steps", "living_street", "cycleway"}
LANE_W = {"trunk": 3.5, "primary": 3.25, "secondary": 3.25, "tertiary": 3.0, "residential": 3.0,
          "unclassified": 3.0, "living_street": 3.0, "service": 3.0}
DEFAULT_WIDTH = {"pedestrian": 6.0, "footway": 3.0, "path": 2.5, "cycleway": 2.5, "steps": 3.0, "living_street": 5.5}


def qn(v: float, nd: int = 1) -> float | int:
    r = round(float(v), nd)
    return int(r) if r == int(r) else r


def qflat(a: np.ndarray, nd: int = 1) -> list:
    return [qn(v, nd) for v in np.asarray(a, float).ravel()]


def num(tag: str | None) -> float | None:
    if tag is None:
        return None
    m = re.match(r"^\s*([0-9]+(?:[.,][0-9]+)?)", tag)
    return float(m.group(1).replace(",", ".")) if m else None


def ring_coords(poly: Polygon, tol: float) -> list:
    p = poly.simplify(tol, preserve_topology=True)
    if p.is_empty or not isinstance(p, Polygon):
        p = poly
    c = np.asarray(p.exterior.coords)[:-1]
    return qflat(c)


def polys_of(g) -> list[Polygon]:
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    return [p for p in getattr(g, "geoms", []) if isinstance(p, Polygon)]


# ---------------------------------------------------------------------------
# Route


@dataclass
class Route:
    p: np.ndarray  # (n, 2) x, z
    s: np.ndarray
    h: np.ndarray
    ground: np.ndarray
    way: np.ndarray  # way id per sample
    length: float
    tree: cKDTree
    tan: np.ndarray
    line: LineString
    raw: np.ndarray  # unsmoothed OSM centreline position matching each sample

    def locate(self, x, z):
        """Nearest sample: (s, signed lateral distance + right, index)."""
        d, i = self.tree.query(np.c_[np.atleast_1d(x), np.atleast_1d(z)])
        v = np.c_[np.atleast_1d(x), np.atleast_1d(z)] - self.p[i]
        t = self.tan[i]
        cross = t[:, 0] * v[:, 1] - t[:, 1] * v[:, 0]
        along = (v * t).sum(1)
        s = (self.s[i] + along) % self.length
        lat = np.sign(cross) * np.sqrt(np.maximum(d ** 2 - along ** 2, 0))
        return s, lat, i


def ring_info(osm: OSM, geo: Geo):
    """way id -> (cx, cz, radius) for roundabout ways."""
    isl = roundabout_islands(osm, geo)
    tree = STRtree(isl)
    out = {}
    for w in osm.ways.values():
        if w.tags.get("junction") in ("roundabout", "circular") and "highway" in w.tags:
            c = geo.way_xz(w)
            if c is None:
                continue
            mid = LineString(c).interpolate(0.5, normalized=True)
            best = None
            for i in tree.query(mid.buffer(2)):
                p = isl[i]
                if p.exterior.distance(mid) < 1.0:
                    best = p
                    break
            if best is not None:
                out[w.id] = (best.centroid.x, best.centroid.y, math.sqrt(best.area / math.pi))
    return out


def build_route(osm: OSM, geo: Geo, rings: dict, dtm: Raster, dsm: Raster) -> tuple[Route, dict]:
    lap = raw_lap(osm, geo)
    xz = lap.xz
    seg = np.hypot(*np.diff(xz, axis=0).T)
    cum = np.concatenate([[0], np.cumsum(seg)])
    p1, t1 = resample(xz, 1.0)
    ei = np.clip(np.searchsorted(cum, t1, side="right") - 1, 0, len(lap.ways) - 1)
    way1 = np.array(lap.ways)[ei]
    ring1 = np.array([w in rings for w in way1])
    # ring samples go onto a true circle of the ring's equivalent radius (OSM rings are coarse
    # polygons); tight rings (< R_RING_MIN) are eased out to R_MIN + 0.5 m
    for k in np.where(ring1)[0]:
        cx, cz, r = rings[way1[k]]
        v = p1[k] - (cx, cz)
        d = float(np.hypot(*v))
        if d > 0:
            p1[k] = np.array([cx, cz]) + v / d * (r if r >= R_RING_MIN else R_MIN + 0.5)
    # Ring cores (more than 6 m inside a ring run of at least 30 m) may be eased by the smoothing
    # but are pushed back out to at least max(0.8 R, 12.5 m) from the centre after every step (eased
    # tight rings: to their full 14.5 m), so
    # a three-quarter turn round a small roundabout cannot collapse into a cut across its island.
    # Short clips of a ring (< 30 m) are just bends and get no constraint.
    n1 = len(p1)
    core = ring1.copy()
    for sh in range(1, 7):
        core &= np.roll(ring1, sh) & np.roll(ring1, -sh)
    runs_core = np.zeros(n1, bool)
    k = 0
    while k < n1:
        if ring1[k]:
            j = k
            while j + 1 < n1 and ring1[j + 1]:
                j += 1
            cx, cz, rr = rings[way1[k]]
            ang = np.unwrap(np.arctan2(p1[k:j + 1, 1] - cz, p1[k:j + 1, 0] - cx))
            sweep = abs(math.degrees(ang[-1] - ang[0]))
            # a tight ring (< R_RING_MIN) is only held when driven at least 200° round (a
            # three-quarter turn); otherwise the smoothing eases it freely
            if j - k + 1 >= 30 and (rr >= R_RING_MIN or sweep >= 200):
                runs_core[k:j + 1] = True
            k = j + 1
        else:
            k += 1
    core &= runs_core
    cidx = np.where(core)[0]
    ctr = np.array([rings[way1[k]][:2] for k in cidx]) if len(cidx) else np.zeros((0, 2))
    crad = np.array([max(rings[way1[k]][2], R_MIN + 0.5) if rings[way1[k]][2] < R_RING_MIN else rings[way1[k]][2]
                     for k in cidx]) if len(cidx) else np.zeros(0)

    # pinned stretches keep their OSM geometry exactly: the straight line out of the Puerta de
    # Palmas archway, along the Puente de Palmas axis, to the bridge path
    pins = np.isin(way1, list(PINNED_WAYS))
    p_pins = p1[pins].copy()

    relax = [1.0]  # phase 2 lets ring cores ease inwards a little to iron out kinks at their ends

    def constrain(q):
        q[pins] = p_pins
        if len(cidx):
            v = q[cidx] - ctr
            d = np.hypot(*v.T)
            lim = relax[0] * np.where(crad <= R_MIN + 0.5, crad, np.maximum(0.8 * crad, R_RING_MIN + 0.5))
            m = d < lim
            q[cidx[m]] = ctr[m] + v[m] / d[m, None] * lim[m, None]
        return q

    p = constrain(smooth_closed(p1, np.where(core | pins, 0.0, 2.0)))
    rmin = np.where(ring1, R_RING_MIN, R_MIN)
    for it in range(3000):
        r = np.min([radius_over(p, k) for k in (2, 3, 6, 10)], axis=0)
        bad = r < rmin * 1.03
        if not bad.any():
            break
        if it == 600:
            relax[0] = 0.85
        if it < 600:
            wide = binary_dilation(np.r_[bad, bad, bad], iterations=8 if it < 200 else 25)[len(bad):2 * len(bad)]
            p = constrain(smooth_closed(p, np.where(wide & ~pins, 2.5 if it < 200 else 4.0, 0.0)))
        else:
            wide = binary_dilation(np.r_[bad, bad, bad], iterations=6)[len(bad):2 * len(bad)]
            p = constrain(smooth_closed(p, np.where(wide & ~pins, 1.5, 0.0)))
    print(f"route smoothing: {it} iterations" + (f"; still tight at s≈{[round(float(t1[k])) for k in np.where(bad)[0][::5]][:20]}" if bad.any() else ""))
    # resample to STEP along the smoothed curve, carrying the attributes
    closed = np.vstack([p, p[:1]])
    segs = np.hypot(*np.diff(closed, axis=0).T)
    c2 = np.concatenate([[0], np.cumsum(segs)])
    L = c2[-1]
    n = int(round(L / STEP))
    s = np.linspace(0, L, n, endpoint=False)
    x = np.interp(s, c2, closed[:, 0])
    z = np.interp(s, c2, closed[:, 1])
    idx = np.clip(np.searchsorted(c2, s, side="right") - 1, 0, len(p) - 1)
    way = way1[idx]
    P = np.c_[x, z]
    tan = np.roll(P, -1, 0) - np.roll(P, 1, 0)
    tan /= np.hypot(*tan.T)[:, None]
    # ground heights
    e, nn = geo.f.utm(x, z)
    g = dtm.sample(e, nn)
    dsm_s = dsm.sample(e, nn)
    meta = {"raw": lap, "p1": p1, "way1": way1}
    raw = p1[idx]
    return Route(P, s, g.copy(), g.copy(), way, L, cKDTree(P), tan, LineString(np.vstack([P, P[:1]])), raw), meta


def profile_heights(route: Route, osm: OSM, geo: Geo, dtm: Raster, dsm: Raster, z0: float) -> dict:
    """Bridge decks, smoothing and the grade limit. Fills route.h (relative to z0) and route.ground."""
    n = len(route.s)
    g = route.ground.copy()
    if np.isnan(g).any():
        ok = ~np.isnan(g)
        g = np.interp(np.arange(n), np.where(ok)[0], g[ok], period=n)
    h = g.copy()
    bridge = np.array([osm.ways[w].tags.get("bridge", "no") not in ("no",) for w in route.way])
    # contiguous bridge spans (wrap-aware enough: the start is not on a bridge)
    spans = []
    i = 0
    while i < n:
        if bridge[i]:
            j = i
            while j + 1 < n and bridge[j + 1]:
                j += 1
            spans.append((i, j))
            i = j + 1
        else:
            i += 1
    info = []
    e, nn = geo.f.utm(route.p[:, 0], route.p[:, 1])
    for i, j in spans:
        a, b = max(i - 2, 0), min(j + 2, n - 1)  # abutments just off the deck
        lin = np.interp(np.arange(a, b + 1), [a, b], [g[a], g[b]])
        # the DSM along the deck is the deck surface (plus cars, lamps): take a running minimum
        d = dsm.sample(e[a:b + 1], nn[a:b + 1])
        dmin = np.array([np.nanmin(d[max(0, k - 3):k + 4]) for k in range(len(d))])
        name = osm.ways[route.way[i]].tags.get("name", "")
        L = (j - i + 1) * STEP
        use_dsm = L > 40 and np.isfinite(dmin).all() and np.abs(dmin - lin).max() < 8
        if use_dsm:
            prof = gaussian_filter1d(dmin, 5, mode="nearest")
            # pin to the abutments
            w = np.linspace(0, 1, len(prof))
            prof = prof + (g[a] - prof[0]) * (1 - w) + (g[b] - prof[-1]) * w
            h[a:b + 1] = prof
        else:
            h[a:b + 1] = lin
        info.append({"name": name, "fromS": float(route.s[i]), "toS": float(route.s[j]), "length": L,
                     "method": "dsm-deck" if use_dsm else "linear", "dtmMinUnder": float(np.nanmin(g[i:j + 1])),
                     "deckMax": float(h[a:b + 1].max())})
        g[a:b + 1] = h[a:b + 1]  # off-route ground under a deck is still the river; route ground is the deck
    # smooth, then limit the grade on the closed loop: a forward and a backward clamp pass (two
    # laps each, so the seam is covered) are each 0.08-Lipschitz, so is their mean, and so is any
    # Gaussian smoothing of it.
    hs = gaussian_filter1d(h, 6, mode="wrap")
    dmax = MAX_GRADE * STEP * 0.98

    def clamp(vals, order):
        v = vals.copy()
        for _ in range(2):
            for k in order:
                prev = v[(k - 1) % n] if order is fwd else v[(k + 1) % n]
                v[k] = min(max(v[k], prev - dmax), prev + dmax)
        return v

    fwd = range(n)
    bwd = range(n - 1, -1, -1)
    hs = (clamp(hs, fwd) + clamp(hs, bwd)) / 2
    hs = gaussian_filter1d(hs, 3, mode="wrap")
    route.h = hs - z0
    route.ground = gaussian_filter1d(g, 1.5, mode="wrap") - z0
    return {"bridges": info}


# ---------------------------------------------------------------------------
# Sections, zones, junctions


def find_dual(osm: OSM, geo: Geo, way_id: int, route: Route, k: int, road_tree, road_ids) -> dict | None:
    w = osm.ways[way_id]
    t = w.tags
    if t.get("oneway") not in ("yes", "-1") or t.get("junction") in ("roundabout", "circular"):
        return None
    hw = t.get("highway")
    if hw in PEDESTRIAN or hw == "service":
        return None
    px, pz = route.p[k]
    tx, tz = route.tan[k]
    best = None
    probe = Point(px, pz)
    for i in road_tree.query(probe.buffer(60)):
        oid = road_ids[i]
        if oid == way_id:
            continue
        o = osm.ways[oid]
        ot = o.tags
        if ot.get("highway") != hw and not (ot.get("name") and ot.get("name") == t.get("name")):
            continue
        if ot.get("junction") in ("roundabout", "circular") or ot.get("oneway") not in ("yes", "-1"):
            continue
        if t.get("name") and ot.get("name") and ot.get("name") != t.get("name"):
            continue
        c = geo.way_xz(o)
        ln = LineString(c)
        d = ln.distance(probe)
        if d < 4 or d > 60:
            continue
        q = ln.interpolate(ln.project(probe))
        ss = ln.project(probe)
        a, b = ln.interpolate(max(ss - 2, 0)), ln.interpolate(min(ss + 2, ln.length))
        ov = np.array([b.x - a.x, b.y - a.y])
        if np.hypot(*ov) == 0:
            continue
        ov /= np.hypot(*ov)
        if ot.get("oneway") == "-1":
            ov = -ov
        if ov @ np.array([tx, tz]) > -0.7:
            continue
        v = np.array([q.x - px, q.y - pz])
        cross = tx * v[1] - tz * v[0]
        lat = math.copysign(d, cross)
        if lat > 0 or d > 30:
            continue  # right-hand traffic: the other carriageway is on the left
        if best is None or d < abs(best["offset"]):
            lanes = num(ot.get("lanes"))
            best = {"offset": qn(lat), "lanes": int(lanes) if lanes else None, "name": ot.get("name"), "osmWay": oid}
    return best


def facade_width(route: Route, bld_tree, blds, k: int, raw: bool = True) -> tuple[float | None, float | None]:
    """Distance to the first building wall to the right and to the left, from the OSM centreline
    (raw=True) or from the smoothed route."""
    line = route.raw if raw else route.p
    px, pz = line[k]
    a, b = line[max(k - 2, 0)], line[min(k + 2, len(line) - 1)]
    tx, tz = (b - a) / max(np.hypot(*(b - a)), 1e-6)
    rx, rz = -tz, tx  # right normal: cross(t, (−tz, tx)) = tx*tx + tz*tz > 0 → right
    out = []
    for sgn in (1, -1):
        ray = LineString([(px, pz), (px + sgn * rx * 40, pz + sgn * rz * 40)])
        best = None
        for i in bld_tree.query(ray):
            inter = blds[i].boundary.intersection(ray)
            if inter.is_empty:
                continue
            d = Point(px, pz).distance(inter)
            if best is None or d < best:
                best = d
        out.append(best)
    return out[0], out[1]


def build_sections(osm: OSM, geo: Geo, route: Route, rings: dict, blds: list[Polygon]) -> list[dict]:
    roads = [w for w in osm.ways.values() if "highway" in w.tags and geo.way_xz(w) is not None]
    road_ids = [w.id for w in roads]
    road_tree = STRtree([LineString(geo.way_xz(w)) for w in roads])
    bld_tree = STRtree(blds)
    bridge_areas = [(t, p) for _, _, t, poly in geo.areas(lambda t: t.get("man_made") == "bridge") for p in polys_of(poly)]
    n = len(route.s)
    # runs of constant way
    runs = []
    i = 0
    while i < n:
        j = i
        while j + 1 < n and route.way[j + 1] == route.way[i]:
            j += 1
        runs.append((i, j, int(route.way[i])))
        i = j + 1
    dual_cache: dict[int, dict | None] = {}
    sec_attrs = []
    for i, j, wid in runs:
        t = osm.ways[wid].tags
        hw = t.get("highway")
        mid = (i + j) // 2
        if wid not in dual_cache:
            dual_cache[wid] = find_dual(osm, geo, wid, route, mid, road_tree, road_ids)
        dual = dual_cache[wid]
        ring = wid in rings
        oneway = t.get("oneway") in ("yes", "-1", "true", "1") or ring
        lanes_tag = num(t.get("lanes"))
        lf, lb = num(t.get("lanes:forward")), num(t.get("lanes:backward"))
        if lf and lb and not oneway:
            lanes, lsrc = int(lf + lb), "tag"
        elif lanes_tag == 1 and not oneway and hw not in PEDESTRIAN:
            # a two-way road tagged lanes=1 is almost always "one lane each way" (e.g. Avenida
            # Miguel Ángel Celdrán Matute); count both directions
            lanes, lsrc = 2, "tag-per-direction"
        elif lanes_tag:
            lanes, lsrc = int(lanes_tag), "tag"
        elif hw in PEDESTRIAN:
            lanes, lsrc = 0, "pedestrian"
        elif oneway:
            lanes, lsrc = (2 if hw in ("trunk", "primary", "secondary") else 1), "default"
        else:
            lanes, lsrc = 2, "default"
        width_tag = num(t.get("width")) or num(t.get("est_width"))
        # facade-to-facade gap, sampled every ~10 m
        ks = list(range(i, j + 1, 5)) or [mid]
        gaps, clear = [], []
        for k in ks:
            r, l = facade_width(route, bld_tree, blds, k)
            if r is not None and l is not None:
                gaps.append(r + l)
            r2, l2 = facade_width(route, bld_tree, blds, k, raw=False)
            sides = [v for v in (r2, l2) if v is not None]
            if sides:
                clear.append(2 * min(sides))
        fac = float(np.median(gaps)) if len(gaps) >= max(1, len(ks) // 3) else None
        # clearance: twice the distance from the smoothed route to the nearest wall (20th percentile)
        clr = float(np.percentile(clear, 20)) if len(clear) >= max(1, len(ks) // 3) else None
        if width_tag and 2 <= width_tag <= 40:
            width, wsrc = width_tag, "tag"
        elif hw in PEDESTRIAN:
            if clr is not None and hw in ("pedestrian", "living_street"):
                width, wsrc = max(3.0, min(clr - 1.0, 14.0)), "facades"  # keep 0.5 m off each wall
            else:
                width, wsrc = DEFAULT_WIDTH.get(hw, 4.0), "default"
        else:
            width, wsrc = max(lanes, 1) * LANE_W.get(hw, 3.0) + (0.0 if dual or oneway else 0.5), "lanes"
            if clr is not None and not dual and clr - 1.0 < width:
                width, wsrc = max(clr - 1.0, 3.0), "facades"
        bridge = None
        deck = None
        if t.get("bridge", "no") != "no":
            bridge = t.get("bridge:name") or t.get("name") or "puente"
            q = Point(*route.raw[mid])
            for bt, bp in bridge_areas:
                if bp.buffer(1).contains(q):
                    P2, A = bp.length / 2, bp.area
                    deck = (P2 - math.sqrt(max(P2 * P2 - 4 * A, 0))) / 2
                    if bt.get("name"):
                        bridge = bt["name"]
                    break
            if deck and hw in PEDESTRIAN and wsrc == "default":
                width, wsrc = deck - 1.0, "bridge-deck"
        surface = t.get("surface") or ("asphalt" if hw not in PEDESTRIAN else None)
        rb = None
        if ring:
            cx, cz, rr = rings[wid]
            rb = {"cx": qn(cx), "cz": qn(cz), "r": qn(rr)}
        a = {
            "name": t.get("name"),
            "highway": hw,
            "lanes": lanes,
            "lanesSource": lsrc,
            "oneway": bool(oneway),
            "dual": bool(dual),
            "opposite": dual,
            "width": qn(width),
            "widthSource": wsrc,
            "facadeWidth": qn(fac) if fac is not None else None,
            "clearance": qn(clr) if clr is not None else None,
            "bridge": bridge,
            "deckWidth": qn(deck) if deck else None,
            "tunnel": t.get("tunnel", "no") != "no" or t.get("covered") == "yes",  # covered = under an arch
            "surface": surface,
            "pedestrian": hw in PEDESTRIAN,
            "roundabout": rb,
            "sidewalk": t.get("sidewalk") or t.get("sidewalk:both") or None,
            "maxspeed": t.get("maxspeed"),
        }
        sec_attrs.append((i, j, wid, a))
    # merge consecutive runs with identical attributes (ignoring facadeWidth noise)
    def key(a):
        return json.dumps({k: v for k, v in a.items() if k not in ("facadeWidth", "clearance")}, sort_keys=True, default=str)

    sections: list[dict] = []
    for i, j, wid, a in sec_attrs:
        if sections and key(sections[-1]["_a"]) == key(a):
            sections[-1]["_j"] = j
            sections[-1]["osmWays"].append(wid)
        else:
            sections.append({"_i": i, "_j": j, "_a": a, "osmWays": [wid]})
    rmerged: list[dict] = []
    for sec in sections:
        a = sec["_a"]
        if rmerged and a["roundabout"] and rmerged[-1]["_a"]["roundabout"] == a["roundabout"]:
            rmerged[-1]["_j"] = sec["_j"]
            rmerged[-1]["osmWays"] += sec["osmWays"]
        else:
            rmerged.append(sec)
    sections = rmerged
    # absorb slivers (< 8 m) that are not rings or bridges into the previous section
    merged: list[dict] = []
    for sec in sections:
        length = (sec["_j"] - sec["_i"] + 1) * STEP
        if merged and length < 8 and not sec["_a"]["roundabout"] and not sec["_a"]["bridge"] and not sec["_a"]["tunnel"] \
                and not merged[-1]["_a"]["roundabout"]:
            merged[-1]["_j"] = sec["_j"]
            merged[-1]["osmWays"] += sec["osmWays"]
        else:
            merged.append(sec)
    out = []
    for k, sec in enumerate(merged):
        fromS = route.s[sec["_i"]]
        toS = route.s[sec["_j"] + 1] if sec["_j"] + 1 < n else route.length
        d = {"fromS": qn(fromS), "toS": qn(toS)}
        d.update(sec["_a"])
        d["osmWays"] = sorted(set(sec["osmWays"]), key=sec["osmWays"].index)
        out.append(d)
    # approach footways named like the bridge they lead onto carry its deck width
    for k, d in enumerate(out):
        if d["pedestrian"] and d["widthSource"] == "default" and d["name"]:
            for nb in (out[k - 1] if k > 0 else None, out[k + 1] if k + 1 < len(out) else None):
                if nb and nb["bridge"] == d["name"] and nb["deckWidth"]:
                    d["width"], d["widthSource"] = qn(nb["deckWidth"] - 1.0), "bridge-deck"
                    break
    refine_duals(out, osm, geo, route, road_tree, road_ids)
    # sections split only because the old per-way opposite differed are merged again
    same = ("name", "highway", "lanes", "lanesSource", "oneway", "dual", "width", "widthSource", "bridge", "deckWidth",
            "tunnel", "surface", "pedestrian", "roundabout", "sidewalk", "maxspeed")
    merged2: list[dict] = []
    for d in out:
        prev = merged2[-1] if merged2 else None
        if prev and all(prev[k] == d[k] for k in same) and not d["roundabout"] and (
                not d["dual"] or abs(prev["opposite"]["offset"] - d["opposite"]["offset"]) < 1.0):
            prev["toS"] = d["toS"]
            prev["osmWays"] += [w for w in d["osmWays"] if w not in prev["osmWays"]]
        else:
            merged2.append(d)
    refine_duals(merged2, osm, geo, route, road_tree, road_ids)
    return merged2


def sec_index(route: Route, sec: dict) -> tuple[int, int]:
    i0 = int(np.searchsorted(route.s, sec["fromS"] - 0.05))
    i1 = int(np.searchsorted(route.s, sec["toS"] - 0.05)) - 1
    return i0, max(i0, min(i1, len(route.s) - 1))


def opposite_samples(osm: OSM, geo: Geo, route: Route, sec: dict, road_tree, road_ids) -> list[tuple[int, int, float, tuple]]:
    """For samples every 4 m of a one-way section: the nearest anti-parallel (within 15°) one-way
    road 4–30 m to the LEFT. Returns (sample index, way id, signed lateral, point on that way)."""
    i0, i1 = sec_index(route, sec)
    own = set(sec["osmWays"])
    name = sec["name"]
    out = []
    cos15 = math.cos(math.radians(15))
    for k in range(i0, i1 + 1, 2):
        px, pz = route.p[k]
        t = route.tan[k]
        probe = Point(px, pz)
        best = None
        for ci in road_tree.query(probe.buffer(30)):
            oid = road_ids[ci]
            if oid in own:
                continue
            o = osm.ways[oid]
            ot = o.tags
            if ot.get("junction") in ("roundabout", "circular") or ot.get("oneway") not in ("yes", "-1"):
                continue
            if ot.get("highway") in PEDESTRIAN or ot.get("highway") == "service":
                continue
            oname = ot.get("name")
            if name and oname and oname != name:
                continue
            if (not name or not oname) and ot.get("highway") != sec["highway"]:
                continue
            ln = LineString(geo.way_xz(o))
            d = ln.distance(probe)
            if d < 4 or d > 30:
                continue
            ss = ln.project(probe)
            a, b = ln.interpolate(max(ss - 3, 0)), ln.interpolate(min(ss + 3, ln.length))
            ov = np.array([b.x - a.x, b.y - a.y])
            nv = np.hypot(*ov)
            if nv == 0:
                continue
            ov /= nv
            if ot.get("oneway") == "-1":
                ov = -ov
            if ov @ t > -cos15:
                continue  # not running the other way, parallel within 15°
            q = ln.interpolate(ss)
            cross = t[0] * (q.y - pz) - t[1] * (q.x - px)
            if cross >= 0:
                continue  # right-hand traffic: the other carriageway is on our left
            if best is None or d < best[2]:
                best = (k, oid, d, (q.x, q.y))
        if best:
            out.append((best[0], best[1], -best[2], best[3]))
    return out


def refine_duals(secs: list[dict], osm: OSM, geo: Geo, route: Route, road_tree, road_ids) -> None:
    """Recompute `dual`/`opposite` per section: the median lateral distance over the section to
    the most frequent anti-parallel carriageway, found on at least half of the samples."""
    for sec in secs:
        sec["_opp"] = []
        if not sec["oneway"] or sec["roundabout"] or sec["pedestrian"]:
            sec["dual"], sec["opposite"] = False, None
            continue
        smp = opposite_samples(osm, geo, route, sec, road_tree, road_ids)
        i0, i1 = sec_index(route, sec)
        n_s = len(range(i0, i1 + 1, 2))
        if not smp:
            sec["dual"], sec["opposite"] = False, None
            continue
        ids = [o for _, o, _, _ in smp]
        top = max(set(ids), key=ids.count)
        same_road = smp  # every match is the same opposite carriageway (name/class, anti-parallel, on the left)
        if len(same_road) < 0.5 * n_s or (sec["toS"] - sec["fromS"] < 20 and len(same_road) < 0.8 * n_s):
            sec["dual"], sec["opposite"] = False, None
            continue
        lanes = None
        for o in [top] + [x[1] for x in smp]:
            v = num(osm.ways[o].tags.get("lanes"))
            if v:
                lanes = int(v)
                break
        lsrc = "tag"
        if lanes is None:
            lanes, lsrc = (2 if sec["highway"] in ("trunk", "primary", "secondary") else 1), "default"
        sec["dual"] = True
        sec["opposite"] = {"offset": qn(float(np.median([x[2] for x in same_road]))), "lanes": lanes, "lanesSource": lsrc,
                           "name": osm.ways[top].tags.get("name"), "osmWay": top,
                           "coverage": qn(len(same_road) / max(n_s, 1), 2)}
        sec["_opp"] = same_road
    # a short (< 30 m) stretch only counts as dual when a neighbour is dual at a similar offset
    # (e.g. the short bridge on Puente Real); otherwise it is a plaza or a split round an island
    for k, sec in enumerate(secs):
        if sec["dual"] and sec["toS"] - sec["fromS"] < 30:
            nbs = [secs[j] for j in (k - 1, k + 1) if 0 <= j < len(secs)]
            if not any(nb["dual"] and nb["toS"] - nb["fromS"] >= 30 and abs(nb["opposite"]["offset"] - sec["opposite"]["offset"]) < 2 for nb in nbs):
                sec["dual"], sec["opposite"], sec["_opp"] = False, None, []


MEDIAN_GREEN = lambda t: (t.get("landuse") in ("grass", "flowerbed", "meadow", "village_green", "plant_nursery")
                          or t.get("leisure") in ("park", "garden") or t.get("natural") in ("scrub", "grassland", "wood")
                          or t.get("barrier") == "hedge" or t.get("area:highway") == "verge")


def build_medians(secs: list[dict], osm: OSM, geo: Geo, route: Route, trees: np.ndarray) -> None:
    """What lies between our carriageway and the opposite one (from OSM), on every dual section."""
    greens = [p for _, _, _, poly in geo.areas(MEDIAN_GREEN) for p in polys_of(poly)]
    paved = [p for _, _, _, poly in geo.areas(lambda t: (t.get("highway") in ("pedestrian", "footway") and t.get("area") == "yes")
                                                 or t.get("place") == "square" or t.get("area:highway") in ("footway", "pedestrian"))
             for p in polys_of(poly)]
    g_tree, p_tree = STRtree(greens), STRtree(paved)
    lines = {"footway": [], "cycleway": [], "barrier": []}
    for w in osm.ways.values():
        t = w.tags
        c = geo.way_xz(w)
        if c is None or len(c) < 2:
            continue
        hw = t.get("highway")
        if hw in ("footway", "path", "pedestrian") and t.get("footway") != "crossing" and t.get("area") != "yes":
            lines["footway"].append(LineString(c))
        elif hw == "cycleway" and t.get("cycleway") != "crossing":
            lines["cycleway"].append(LineString(c))
        elif t.get("barrier") in ("guard_rail", "jersey_barrier", "fence", "wall", "kerb", "handrail", "retaining_wall"):
            lines["barrier"].append(LineString(c))
    l_trees = {k: STRtree(v) for k, v in lines.items()}
    T = trees.reshape(-1, 5) if len(trees) else np.zeros((0, 5))
    bridge_struct = {}
    for _, _, t, poly in geo.areas(lambda t: t.get("man_made") == "bridge"):
        if t.get("name"):
            bridge_struct[t["name"]] = t.get("bridge:structure")
    for sec in secs:
        opp = sec.pop("_opp", [])
        for k in ("medianKind", "medianWidth", "medianFootway", "medianCycleway", "medianGreen", "medianTrees"):
            sec[k] = None
        if not sec["dual"] or len(opp) < 2:
            continue
        ks = [x[0] for x in opp]
        P = route.p[ks]
        Q = np.array([x[3] for x in opp])
        mid = LineString((P + Q) / 2)
        o_lanes = sec["opposite"]["lanes"] or 1
        opp_half = o_lanes * LANE_W.get(sec["highway"], 3.0) / 2
        mw = float(np.median(np.hypot(*(Q - P).T))) - sec["width"] / 2 - opp_half
        mw = max(mw, 0.0)
        strip = mid.buffer(max(mw / 2, 0.5), cap_style="flat")
        L = max(mid.length, 1.0)

        def frac_area(tree, geoms):
            a = 0.0
            for i in tree.query(strip):
                a += geoms[i].intersection(strip).area
            return a / max(strip.area, 1e-6)

        def frac_len(kind):
            ln = 0.0
            for i in l_trees[kind].query(strip):
                ln += lines[kind][i].intersection(strip).length
            return ln / L

        green = min(frac_area(g_tree, greens), 1.0)
        pavedf = min(frac_area(p_tree, paved), 1.0)
        foot, cyc, bar = frac_len("footway"), frac_len("cycleway"), frac_len("barrier")
        from shapely import contains_xy
        ntree = int(contains_xy(strip, T[:, 0], T[:, 1]).sum()) if len(T) else 0
        if sec["bridge"] and sec["deckWidth"] and bridge_struct.get(sec["bridge"]) == "cable-stayed":
            kind = "cable-plane"
        elif bar > 0.3:
            kind = "barrier"
        elif (foot > 0.3 or pavedf > 0.3) and mw >= 4:
            kind = "promenade"
        elif green > 0.25 or ntree >= max(1, L / 25):
            kind = "planting"
        elif mw < 2.0:
            kind = "kerb"
        else:
            kind = "unmapped"
        sec["medianKind"] = kind
        sec["medianWidth"] = qn(mw)
        sec["medianFootway"] = foot > 0.3
        sec["medianCycleway"] = cyc > 0.3
        sec["medianGreen"] = qn(green, 2)
        sec["medianTrees"] = ntree


def build_zones(sections: list[dict], route: Route) -> list[dict]:
    def first(pred, after=0.0):
        for s in sections:
            if s["fromS"] >= after and pred(s):
                return s
        raise ValueError("zone cut not found")

    def last_end(pred, after=0.0):
        e = None
        for s in sections:
            if s["fromS"] >= after and pred(s):
                e = s
            elif e is not None:
                return e
        return e

    # 1 -> 2: entering the roundabout at Puente Real's south-east end
    c1 = first(lambda s: s["roundabout"] is not None, 300)["fromS"]
    # 2 -> 3: entering the ring-road roundabout where Avenida María Auxiliadora ends (Valdepasillas -> centre)
    aux = last_end(lambda s: (s["name"] or "").startswith("Avenida María Auxiliadora"), c1)
    c2 = first(lambda s: s["roundabout"] is not None, aux["fromS"])["fromS"]
    # 3 -> 4: leaving the Paseo / Plaza Minayo into Calle Obispo San Juan de Ribera (old town)
    c3 = first(lambda s: s["name"] == "Calle Obispo San Juan de Ribera", c2)["fromS"]
    # 4 -> 5: end of Calle Moreno Zancudo, arriving at Plaza Alta
    mz = last_end(lambda s: s["name"] == "Calle Moreno Zancudo", c3)
    c4 = mz["toS"]
    # 5 -> 6: right-bank end of Puente de Palmas
    pp = last_end(lambda s: s["bridge"] == "Puente de Palmas", c4)
    c5 = pp["toS"]
    cuts = [0.0, c1, c2, c3, c4, c5, route.length]
    return [{"id": z, "fromS": qn(a), "toS": qn(b), "length": qn(b - a)} for z, a, b in zip(ZONE_IDS, cuts[:-1], cuts[1:])]


def bearing(dx: float, dz: float) -> float:
    """Compass bearing (degrees clockwise from north) of a local-frame direction."""
    return (math.degrees(math.atan2(dx, -dz)) + 360) % 360


def build_junctions(osm: OSM, geo: Geo, route: Route, raw, sections) -> list[dict]:
    node_ways = defaultdict(list)
    for w in osm.ways.values():
        if "highway" in w.tags:
            for k, nd in enumerate(w.nodes):
                node_ways[nd].append((w, k))
    route_ways = set(int(x) for x in raw.ways)
    route_names = {}
    out = []
    seen = set()
    for idx, nd in enumerate(raw.nodes[:-1]):
        here = raw.ways[min(idx, len(raw.ways) - 1)]
        here_name = osm.ways[here].tags.get("name")
        x, z = geo.node_xz[nd]
        s, lat, i = route.locate(x, z)
        if abs(lat[0]) > 25:
            continue
        t = route.tan[i[0]]
        branches = defaultdict(list)
        for w, k in node_ways[nd]:
            if w.id in route_ways:
                continue
            tg = w.tags
            hw = tg["highway"]
            if tg.get("junction") in ("roundabout", "circular"):
                continue
            if tg.get("footway") in ("sidewalk", "crossing") or tg.get("cycleway") in ("crossing",):
                continue
            if hw in ("footway", "path", "cycleway", "service", "steps", "track", "corridor", "elevator", "platform", "bus_stop", "construction", "proposed") and not tg.get("name"):
                continue
            if tg.get("name") and tg.get("name") == here_name and tg.get("oneway") in ("yes", "-1"):
                continue  # our road's other carriageway
            c = geo.way_xz(w)
            if c is None:
                continue
            for nb in (k - 1, k + 1):
                if 0 <= nb < len(c):
                    # direction a few metres along the branch
                    ln = LineString(c[nb::-1] if nb < k else c[k:]) if False else None
                    seg = c[: k + 1][::-1] if nb < k else c[k:]
                    ls = LineString(seg)
                    q = ls.interpolate(min(15.0, ls.length))
                    dx, dz = q.x - x, q.y - z
                    if math.hypot(dx, dz) < 0.5:
                        continue
                    cross = t[0] * dz - t[1] * dx
                    rel = math.degrees(math.atan2(cross, t[0] * dx + t[1] * dz))
                    branches[(tg.get("name"), hw, w.id)].append(("right" if cross > 0 else "left", bearing(dx, dz), rel))
        for (name, hw, wid), br in branches.items():
            sides = {b[0] for b in br}
            side = "both" if len(sides) == 2 else br[0][0]
            k = (name or f"#{wid}", round(float(s[0]) / 6))
            if k in seen:
                continue
            seen.add(k)
            w = osm.ways[wid]
            lanes = num(w.tags.get("lanes"))
            out.append({"s": qn(s[0]), "side": side, "name": name, "highway": hw,
                        "bearing": qn(br[0][1], 0), "relAngle": qn(br[0][2], 0),
                        "lanes": int(lanes) if lanes else None, "oneway": w.tags.get("oneway") == "yes",
                        "x": qn(x), "z": qn(z), "osmWay": wid})
    out.sort(key=lambda j: j["s"])
    return out


# ---------------------------------------------------------------------------
# Buildings and heights


BUILDING_KEEP = ["building", "name", "amenity", "shop", "tourism", "historic", "roof:shape", "roof:colour",
                 "building:colour", "building:material", "roof:material", "building:levels", "height",
                 "religion", "office", "leisure", "heritage", "wikidata", "addr:street", "addr:housenumber"]


def building_heights(polys: list[Polygon], dsm: Raster, dtm: Raster, f: Frame) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """For each local-frame polygon: (85th pct of DSM−DTM inside 1 m from the edge, median DTM, max DSM−DTM)."""
    from rasterio.features import rasterize

    def to_utm(geom):
        return shp_transform(lambda x, y, z=None: f.utm(np.asarray(x), np.asarray(y)), geom)

    shapes_in, shapes_full = [], []
    for k, p in enumerate(polys):
        u = to_utm(p)
        shapes_full.append((u, k + 1))
        inner = u.buffer(-1.0)
        if not inner.is_empty and inner.area > 8:
            shapes_in.append((inner, k + 1))
    lab_full = rasterize(shapes_full, out_shape=dsm.a.shape, transform=dsm.t, fill=0, dtype="int32", all_touched=True)
    lab_in = rasterize(shapes_in, out_shape=dsm.a.shape, transform=dsm.t, fill=0, dtype="int32") if shapes_in else np.zeros_like(lab_full)
    chm = dsm.a - dtm.a
    N = len(polys)
    h85 = np.full(N, np.nan)
    hmax = np.full(N, np.nan)
    g50 = np.full(N, np.nan)

    def group(lab, vals):
        m = (lab > 0) & np.isfinite(vals)
        ids = lab[m]
        v = vals[m]
        order = np.argsort(ids, kind="stable")
        ids, v = ids[order], v[order]
        bounds = np.flatnonzero(np.diff(ids)) + 1
        starts = np.r_[0, bounds]
        ends = np.r_[bounds, len(ids)]
        return {int(ids[a]): v[a:b] for a, b in zip(starts, ends)}

    gi = group(lab_in, chm)
    gf = group(lab_full, chm)
    gg = group(lab_full, dtm.a)
    for k in range(N):
        vals = gi.get(k + 1)
        if vals is None or len(vals) < 3:
            vals = gf.get(k + 1)
        if vals is not None and len(vals):
            h85[k] = np.percentile(vals, 85)
            hmax[k] = np.percentile(vals, 99)
        gv = gg.get(k + 1)
        if gv is not None and len(gv):
            g50[k] = np.median(gv)
    return h85, g50, hmax


# ---------------------------------------------------------------------------


def main() -> None:
    osm = OSM.load(merged_path())
    lon0, lat0 = osm.nodes[START_NODE]
    f = Frame(lat0, lon0)
    geo = Geo(osm, f)
    rings = ring_info(osm, geo)

    # raster window: route bbox + 900 m
    lap_probe = raw_lap(osm, geo)
    mn, mx = lap_probe.xz.min(0) - 900, lap_probe.xz.max(0) + 900
    ex, nx_ = f.utm(np.array([mn[0], mx[0], mn[0], mx[0]]), np.array([mn[1], mn[1], mx[1], mx[1]]))
    ub = (float(ex.min()), float(nx_.min()), float(ex.max()), float(nx_.max()))
    dsm, dtm = Raster(DSM, ub), Raster(DTM, ub)
    dsm_off = Raster(DSM_LEAFOFF, ub)
    ndvi = Ndvi(ub)

    route, rmeta = build_route(osm, geo, rings, dtm, dsm)
    e0, n0 = f.utm(0.0, 0.0)
    z0 = float(dtm.sample(np.atleast_1d(e0), np.atleast_1d(n0))[0])
    prof = profile_heights(route, osm, geo, dtm, dsm, z0)
    print("lap length", round(route.length), "bridges", prof["bridges"])
    corridor = route.line.buffer(1.0)

    # --- buildings (needed for facade widths too)
    near130 = route.line.buffer(130)
    near600 = route.line.buffer(600)
    bentries = []
    for kind, oid, tags, poly in geo.areas(lambda t: t.get("building") not in (None, "no") and "building:part" not in t):
        for p in polys_of(poly):
            if p.area < 4 or not p.intersects(near600):
                continue
            bentries.append((kind, oid, tags, p))
    polys = [b[3] for b in bentries]
    h85, g50, hmax = building_heights(polys, dsm, dtm, f)
    secs = build_sections(osm, geo, route, rings, [p for p in polys if p.intersects(route.line.buffer(45))])
    zones = build_zones(secs, route)

    # half-width per sample for overlap tests
    half = np.zeros(len(route.s))
    tunnel = np.zeros(len(route.s), bool)
    for sec in secs:
        m = (route.s >= sec["fromS"]) & (route.s < sec["toS"])
        half[m] = sec["width"] / 2
        tunnel[m] = sec["tunnel"]
    buildings = []
    passes = []
    hstats = defaultdict(int)
    for (kind, oid, tags, p), hh, gg, hm in zip(bentries, h85, g50, hmax):
        landmarkish = bool(tags.get("name") or tags.get("historic") or tags.get("tourism") or tags.get("amenity") in ("place_of_worship", "townhall", "university"))
        within = p.intersects(near130)
        levels = num(tags.get("building:levels"))
        tag_h = num(tags.get("height"))
        if np.isfinite(hh) and hh >= 2.0:
            height, src = float(hh), "lidar"
        elif tag_h:
            height, src = tag_h, "tag"
        elif levels:
            height, src = levels * 3.0 + 1.0, "levels"
        else:
            height, src = {"garage": 2.6, "garages": 2.6, "roof": 3.5, "shed": 2.6, "kiosk": 3.0}.get(tags.get("building"), 6.0), "default"
        if src == "lidar" and hh > 90 and not (tags.get("name") or "").lower().count("siglo"):
            height = min(height, 90.0)
        height = float(np.clip(height, 2.5, 120.0))
        if not within and not (height >= 25 or landmarkish):
            continue
        s, lat, i = route.locate(p.centroid.x, p.centroid.y)
        dist = p.distance(route.line)
        b = {
            "id": f"{kind}{oid}",
            "ring": ring_coords(p, 0.5),
            "h0": qn((gg if np.isfinite(gg) else z0) - z0),
            "height": qn(height),
            "src": src,
            "levels": int(levels) if levels else max(1, int(round(height / 3.2))),
        }
        if src == "lidar" and np.isfinite(hm) and hm > height + 4:
            b["peak"] = qn(min(hm, 120))
        keep = {k: tags[k] for k in BUILDING_KEEP if k in tags and k not in ("building:levels", "height")}
        if keep:
            b["tags"] = keep
        b["s"] = qn(s[0])
        b["side"] = "right" if lat[0] > 0 else "left"
        b["dist"] = qn(dist)
        # overlap with the carriageway
        if dist < 25:
            ii = route.tree.query_ball_point([p.centroid.x, p.centroid.y], 120)
            if ii:
                ii = np.array(ii)
                pts = route.p[ii]
                # penetration of the footprint into the carriageway (half-width minus distance)
                pen = np.array([half[k] - (p.distance(Point(*q)) if not p.contains(Point(*q)) else -p.exterior.distance(Point(*q)))
                                for q, k in zip(pts, ii)])
                inside = pen > 0.3
                if inside.any():
                    b["passesThrough"] = True
                    ss = route.s[ii[inside]]
                    if tunnel[ii[inside]].any():
                        b["passage"] = True  # the route runs through it on an OSM tunnel/building passage (an arch)
                    passes.append({"id": b["id"], "name": tags.get("name"), "building": tags.get("building"),
                                   "s": [qn(ss.min()), qn(ss.max())], "height": b["height"],
                                   "penetration": qn(pen.max()), "overCentreline": bool(pen.max() > half[ii[inside]].max()),
                                   "passage": bool(b.get("passage", False))})
        hstats[min(int(height // 5) * 5, 60)] += 1
        buildings.append(b)
    print(f"buildings: {len(buildings)}; passes through carriageway: {len(passes)}")

    # --- landmarks, water, green, squares, parking
    from features import (build_furniture, build_landmarks, build_pois, build_streets, build_terrain,
                          build_trees, polygons_layer)

    landmarks = build_landmarks(osm, geo, route, dsm, dtm, z0, near600)
    water = polygons_layer(geo, route, lambda t: t.get("natural") == "water" or t.get("waterway") == "riverbank" or t.get("water") == "river" or t.get("landuse") == "reservoir", near600, tol=1.0, kind_key=("water", "natural"))
    green = polygons_layer(geo, route, lambda t: t.get("leisure") in ("park", "garden") or t.get("landuse") in ("grass", "forest", "meadow", "village_green", "recreation_ground") or t.get("natural") in ("wood", "scrub", "grassland"), route.line.buffer(300), tol=1.0, kind_key=("leisure", "landuse", "natural"))
    squares = polygons_layer(geo, route, lambda t: (t.get("highway") == "pedestrian" and t.get("area") == "yes") or t.get("place") == "square" or (t.get("area:highway") == "pedestrian"), route.line.buffer(200), tol=0.5, kind_key=("highway", "place"))
    parking = polygons_layer(geo, route, lambda t: t.get("amenity") == "parking", route.line.buffer(150), tol=1.0, kind_key=("parking",))
    streets = build_streets(osm, geo, route, set(int(w) for w in rmeta["raw"].ways))
    trees, tree_stats = build_trees(osm, geo, route, dsm, dtm, ndvi, polys, half, water, dsm_off, green)
    build_medians(secs, osm, geo, route, np.asarray(trees, float))
    furniture = build_furniture(osm, geo, route)
    pois = build_pois(osm, geo, route)
    junctions = build_junctions(osm, geo, route, rmeta["raw"], secs)
    terrain = build_terrain(geo, route, dtm, z0, water)

    sv = np.array([b["height"] for b in buildings])
    city = {
        "meta": {
            "version": 1,
            "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "osmTimestamp": osm.timestamp,
            "origin": {"lat": round(lat0, 7), "lon": round(lon0, 7), "osmNode": START_NODE,
                       "groundElevation": qn(z0, 2)},
            "frame": {"x": "east", "z": "south", "y": "up", "units": "m", "proj4": f.proj4,
                      "rasterCrs": "EPSG:25829"},
            "lapLength": qn(route.length),
            "routeStep": STEP,
            "attribution": ATTRIBUTION,
            "sources": {
                "osm": "OpenStreetMap via Overpass API (maps.mail.ru mirror)",
                "lidar": "PNOA-LiDAR 2nd coverage (flown 2018-19), MDS02/MDT02, 2 m, IGN/CNIG",
                "ndvi": "Sentinel-2 L2A NDVI composite 2025 (band 1 summer, band 2 winter)",
            },
            "counts": {},
            "bridges": prof["bridges"],
            "buildingHeights": {"p10": qn(np.percentile(sv, 10)), "p50": qn(np.percentile(sv, 50)),
                                "p90": qn(np.percentile(sv, 90)), "max": qn(sv.max())},
            "passesThrough": passes,
            "trees": tree_stats,
        },
        "route": {
            "points": qflat(np.c_[route.p, route.h], 2),
            "s": qflat(route.s, 2),
            "ground": qflat(route.ground, 2),
        },
        "sections": secs,
        "zones": zones,
        "junctions": junctions,
        "streets": streets,
        "buildings": buildings,
        "landmarks": landmarks,
        "water": water,
        "green": green,
        "squares": squares,
        "parking": parking,
        "trees": trees,
        "furniture": furniture,
        "pois": pois,
        "terrain": terrain,
    }
    city["meta"]["counts"] = {k: len(city[k]) for k in ("sections", "zones", "junctions", "streets", "buildings",
                                                         "landmarks", "water", "green", "squares", "parking",
                                                         "furniture", "pois")}
    city["meta"]["counts"]["trees"] = len(trees) // 5
    city["meta"]["counts"]["routePoints"] = len(route.s)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.2f} MB)")
    print(json.dumps(city["meta"]["counts"]))
    for z in zones:
        print(z)


if __name__ == "__main__":
    main()
