"""Off-route layers for city.json: landmarks, area polygons, streets, trees, furniture, POIs, terrain."""
from __future__ import annotations

import math
import re

import numpy as np
from rasterio.features import rasterize
from scipy.ndimage import maximum_filter
from shapely.geometry import LineString, MultiLineString, Point, Polygon
from shapely.ops import transform as shp_transform

from build import PEDESTRIAN, num, polys_of, qflat, qn, ring_coords
from osm import OSM, Geo

# ---------------------------------------------------------------------------
# Landmarks

# (id, name regex, extra tag predicate or None). The first match by name wins; areas are preferred.
NAMED_LANDMARKS = [
    ("puente-real", r"^Puente Real$", lambda t: t.get("man_made") == "bridge"),
    ("torre-siglo-xxi", r"Siglo XXI|Caja Badajoz|Torre Ibercaja", None),
    ("catedral", r"Catedral", None),
    ("ayuntamiento", r"Ayuntamiento|Casas Consistoriales", None),
    ("plaza-espana", r"^Plaza de España$", lambda t: "highway" not in t or t.get("area") == "yes"),
    ("plaza-alta", r"^Plaza Alta$", lambda t: "highway" not in t or t.get("area") == "yes"),
    ("alcazaba", r"^Alcazaba", None),
    ("torre-espantaperros", r"Espantaperros", None),
    ("puerta-palmas", r"Puerta de Palmas", None),
    ("puente-palmas", r"^Puente de Palmas$", lambda t: t.get("man_made") == "bridge"),
    ("puente-universidad", r"Puente de la Universidad", lambda t: t.get("man_made") == "bridge"),
    ("puente-autonomia", r"Puente de [Ll]a Autonom", lambda t: t.get("man_made") == "bridge"),
    ("templete-san-francisco", r"Templete|Quiosco de (la )?[Mm]úsica|Kiosko de (la )?[Mm]úsica", None),
    ("meiac", r"MEIAC|Museo Extremeño e Iberoamericano", None),
    ("palacio-congresos", r"Palacio de Congresos", None),
    ("plaza-de-toros", r"Plaza de Toros", None),
    ("museo-arqueologico", r"Museo Arqueológico", None),
    ("puerta-pilar", r"Puerta (del )?Pilar", None),
    ("puerta-capitel", r"Puerta del Capitel", None),
    ("fuerte-san-cristobal", r"San Crist[oó]bal", lambda t: "historic" in t or t.get("military")),
]


def _centroid_and_ring(geo: Geo, kind: str, el) -> tuple[float, float, Polygon | None, LineString | None]:
    if kind == "n":
        x, z = geo.node_xz[el]
        return x, z, None, None
    if kind == "w":
        w = geo.osm.ways[el]
        c = geo.way_xz(w)
        if c is None:
            return math.nan, math.nan, None, None
        if w.closed:
            p = geo.way_polygon(w)
            if p is not None:
                return p.centroid.x, p.centroid.y, p, None
        ln = LineString(c)
        q = ln.interpolate(0.5, normalized=True)
        return q.x, q.y, None, ln
    r = geo.osm.rels[el]
    p = geo.rel_polygon(r)
    if p is not None:
        return p.centroid.x, p.centroid.y, p, None
    pts = []
    for m in r.members:
        if m["type"] == "node" and m["ref"] in geo.node_xz:
            pts.append(geo.node_xz[m["ref"]])
        elif m["type"] == "way" and m["ref"] in geo.osm.ways:
            c = geo.way_xz(geo.osm.ways[m["ref"]])
            if c is not None:
                pts.extend(c.tolist())
    if not pts:
        return math.nan, math.nan, None, None
    a = np.array(pts)
    return float(a[:, 0].mean()), float(a[:, 1].mean()), None, None


def _elements(osm: OSM):
    for nid, t in osm.node_tags.items():
        yield "n", nid, t
    for w in osm.ways.values():
        if w.tags:
            yield "w", w.id, w.tags
    for r in osm.rels.values():
        yield "r", r.id, r.tags


def _raster_stats(poly_or_line, f, dsm, dtm, z0, buffer=0.0):
    g = poly_or_line.buffer(buffer) if buffer else poly_or_line
    u = shp_transform(lambda x, y, z=None: f.utm(np.asarray(x), np.asarray(y)), g)
    m = rasterize([(u, 1)], out_shape=dsm.a.shape, transform=dsm.t, fill=0, dtype="uint8", all_touched=True).astype(bool)
    if not m.any():
        return None
    chm = (dsm.a - dtm.a)[m]
    top = dsm.a[m]
    ground = dtm.a[m]
    return {"heightP90": qn(np.nanpercentile(chm, 90)), "heightMax": qn(np.nanmax(chm)),
            "topMax": qn(np.nanmax(top) - z0), "ground": qn(np.nanmedian(ground) - z0)}


def build_landmarks(osm: OSM, geo: Geo, route, dsm, dtm, z0: float, near) -> list[dict]:
    f = geo.f
    out: list[dict] = []
    used = set()
    elements = list(_elements(osm))
    for lid, rx, pred in NAMED_LANDMARKS:
        rxc = re.compile(rx)
        cands = []
        for kind, oid, t in elements:
            name = t.get("name", "")
            if not name or not rxc.search(name):
                continue
            if pred is not None and not pred(t):
                continue
            x, z, poly, line = _centroid_and_ring(geo, kind, oid)
            if not np.isfinite(x) or not near.contains(Point(x, z)):
                continue
            score = (2 if poly is not None else 1 if line is not None else 0) + (1 if "building" in t or "historic" in t or "man_made" in t else 0)
            cands.append((score, poly.area if poly is not None else 0, kind, oid, t, x, z, poly, line))
        if not cands:
            out.append({"id": lid, "missing": True})
            continue
        cands.sort(key=lambda c: (-c[0], -c[1]))
        _, _, kind, oid, t, x, z, poly, line = cands[0]
        used.add((kind, oid))
        s, lat, _ = route.locate(x, z)
        d = {"id": lid, "name": t.get("name"), "osm": f"{kind}{oid}", "x": qn(x), "z": qn(z),
             "s": qn(s[0]), "lateral": qn(lat[0])}
        for k in ("historic", "tourism", "amenity", "building", "man_made", "bridge:structure", "wikidata", "start_date", "heritage"):
            if k in t:
                d[k] = t[k]
        if poly is not None:
            d["footprint"] = [ring_coords(p, 0.5) for p in polys_of(poly)]
            st = _raster_stats(poly, f, dsm, dtm, z0)
            if st:
                d.update(st)
        elif line is not None:
            d["line"] = qflat(np.asarray(line.simplify(0.5).coords))
        else:
            st = _raster_stats(Point(x, z), f, dsm, dtm, z0, buffer=4)
            if st:
                d.update(st)
        out.append(d)

    by_id = {d["id"]: d for d in out}
    # Puente Real: decks of both carriageways and the pylon (DSM peak along the deck)
    pr = by_id.get("puente-real", {"id": "puente-real"})
    decks = []
    for w in osm.ways.values():
        if w.tags.get("name") == "Puente Real" and w.tags.get("bridge", "no") != "no" and "highway" in w.tags:
            c = geo.way_xz(w)
            if c is not None and LineString(c).length > 100:
                e, n = f.utm(c[:, 0], c[:, 1])
                ln = LineString(c)
                pts = np.array([ln.interpolate(t).coords[0] for t in np.arange(0, ln.length, 2.0)])
                pe, pn = f.utm(pts[:, 0], pts[:, 1])
                dh = dtm.sample(pe, pn)
                decks.append({"osmWay": w.id, "lanes": num(w.tags.get("lanes")), "oneway": w.tags.get("oneway"),
                              "line": qflat(np.asarray(ln.simplify(0.3).coords)), "length": qn(ln.length)})
    pr["decks"] = decks
    # pylon: search the DSM in a 60 m corridor round the decks for the highest point
    if decks:
        allc = np.vstack([np.array(d["line"]).reshape(-1, 2) for d in decks])
        mn, mx = allc.min(0) - 30, allc.max(0) + 30
        xs, zs = np.meshgrid(np.arange(mn[0], mx[0], 1.0), np.arange(mn[1], mx[1], 1.0))
        dl = MultiLineString([np.array(d["line"]).reshape(-1, 2) for d in decks])
        cand = np.array([dl.distance(Point(a, b)) < 25 for a, b in zip(xs.ravel(), zs.ravel())])
        px, pz = xs.ravel()[cand], zs.ravel()[cand]
        e, n = f.utm(px, pz)
        top = dsm.sample(e, n)
        k = int(np.nanargmax(top))
        gx, gz = px[k], pz[k]
        s, lat, _ = route.locate(gx, gz)
        # deck level next to it: route height at that s
        ri = int(np.argmin(np.abs(route.s - s[0])))
        pylon = {"x": qn(gx), "z": qn(gz), "s": qn(s[0]), "lateral": qn(lat[0]),
                 "topAboveOrigin": qn(top[k] - z0), "aboveDeck": qn(top[k] - z0 - route.h[ri]),
                 "topElevation": qn(top[k], 1), "source": "DSM maximum within 25 m of the decks"}
        towers = []
        for nid, t in osm.node_tags.items():
            if t.get("man_made") in ("tower", "mast") or t.get("bridge:support") or t.get("power") == "tower":
                x, z = geo.node_xz[nid]
                if dl.distance(Point(x, z)) < 40:
                    towers.append({"osm": f"n{nid}", "x": qn(x), "z": qn(z), "tags": t})
        for w in osm.ways.values():
            if w.tags.get("man_made") in ("tower", "pylon") or w.tags.get("bridge:support"):
                c = geo.way_xz(w)
                if c is not None and dl.distance(Point(*c.mean(0))) < 40:
                    towers.append({"osm": f"w{w.id}", "x": qn(c[:, 0].mean()), "z": qn(c[:, 1].mean()), "tags": w.tags})
        pylon["osmSupports"] = towers
        pr["pylon"] = pylon
    if "puente-real" not in by_id:
        out.append(pr)

    # Alcazaba / city walls as polylines with DSM heights per vertex
    walls = []
    for w in osm.ways.values():
        t = w.tags
        if t.get("barrier") == "city_wall" or t.get("historic") in ("citywalls", "city_walls") or t.get("wall") == "castle_wall" or t.get("historic") == "castle_wall":
            c = geo.way_xz(w)
            if c is None:
                continue
            ln = LineString(c)
            if ln.distance(route.line) > 600:
                continue
            ls = ln.simplify(0.5)
            cc = np.asarray(ls.coords)
            e, n = f.utm(cc[:, 0], cc[:, 1])
            # wall top: max DSM within ~3 m of each vertex
            tops = []
            for a, b in zip(e, n):
                ee, nn = np.meshgrid(a + np.array([-2, 0, 2]), b + np.array([-2, 0, 2]))
                tops.append(np.nanmax(dsm.sample(ee.ravel(), nn.ravel())))
            ground = dtm.sample(e, n)
            hgt = np.clip(np.array(tops) - ground, 0, 40)
            walls.append({"osm": f"w{w.id}", "name": t.get("name"), "line": qflat(cc),
                          "ground": qflat(ground - z0), "height": qflat(hgt),
                          "length": qn(ln.length), "dist": qn(ln.distance(route.line))})
    out.append({"id": "murallas", "name": "Murallas y Alcazaba (OSM city_wall)", "walls": walls})

    # Every other named notable thing near the route
    extra_pred = lambda t: (t.get("amenity") in ("place_of_worship", "townhall", "university", "college", "theatre", "library", "hospital", "arts_centre")
                            or t.get("tourism") in ("museum", "attraction", "artwork", "viewpoint")
                            or "historic" in t or t.get("man_made") in ("bridge", "tower", "water_tower")
                            or t.get("leisure") in ("stadium",) or t.get("building") in ("cathedral", "church", "chapel", "university"))
    for kind, oid, t in elements:
        if (kind, oid) in used or not t.get("name") or not extra_pred(t):
            continue
        if "highway" in t:
            continue
        x, z, poly, line = _centroid_and_ring(geo, kind, oid)
        if not np.isfinite(x):
            continue
        d_route = route.line.distance(Point(x, z))
        big = poly is not None and poly.area > 1500
        if d_route > (600 if big or t.get("amenity") in ("place_of_worship", "university") else 300):
            continue
        s, lat, _ = route.locate(x, z)
        d = {"id": f"osm-{kind}{oid}", "name": t["name"], "osm": f"{kind}{oid}", "x": qn(x), "z": qn(z),
             "s": qn(s[0]), "lateral": qn(lat[0])}
        for k in ("historic", "tourism", "amenity", "building", "man_made", "religion", "leisure"):
            if k in t:
                d[k] = t[k]
        if poly is not None:
            d["footprint"] = [ring_coords(p, 0.5) for p in polys_of(poly)][:4]
            st = _raster_stats(poly, f, dsm, dtm, z0)
            if st:
                d.update(st)
        elif line is not None:
            d["line"] = qflat(np.asarray(line.simplify(0.5).coords))
        out.append(d)
    return out


# ---------------------------------------------------------------------------
# Polygons


def polygons_layer(geo: Geo, route, pred, clip, tol: float, kind_key: tuple[str, ...]) -> list[dict]:
    out = []
    for kind, oid, tags, poly in geo.areas(pred):
        if not poly.intersects(clip):
            continue
        g = poly.intersection(clip)
        for p in polys_of(g):
            if p.area < 10:
                continue
            p = p.simplify(tol, preserve_topology=True)
            if p.is_empty or not isinstance(p, Polygon):
                continue
            d = {"osm": f"{kind}{oid}", "kind": next((tags[k] for k in kind_key if k in tags), None),
                 "ring": qflat(np.asarray(p.exterior.coords)[:-1])}
            holes = [qflat(np.asarray(i.coords)[:-1]) for i in p.interiors if Polygon(i).area > 50]
            if holes:
                d["holes"] = holes
            if tags.get("name"):
                d["name"] = tags["name"]
            out.append(d)
    return out


# ---------------------------------------------------------------------------
# Streets


def build_streets(osm: OSM, geo: Geo, route, route_ways: set[int]) -> list[dict]:
    clip = route.line.buffer(150)
    out = []
    for w in osm.ways.values():
        t = w.tags
        hw = t.get("highway")
        if not hw or hw in ("proposed", "construction", "platform", "elevator", "corridor", "bus_stop"):
            continue
        if t.get("area") == "yes":
            continue
        if t.get("footway") in ("sidewalk", "crossing") or t.get("cycleway") == "crossing":
            continue
        if hw in ("footway", "path", "cycleway", "service", "track", "steps") and not t.get("name") and hw != "service":
            continue
        if hw == "service" and t.get("service") in ("parking_aisle", "driveway"):
            continue
        c = geo.way_xz(w)
        if c is None:
            continue
        ln = LineString(c)
        if not ln.intersects(clip):
            continue
        g = ln.intersection(clip)
        parts = [g] if isinstance(g, LineString) else list(getattr(g, "geoms", []))
        for part in parts:
            if not isinstance(part, LineString) or part.length < 3:
                continue
            lanes = num(t.get("lanes"))
            width = num(t.get("width"))
            d = {"osmWay": w.id, "highway": hw, "name": t.get("name"),
                 "pts": qflat(np.asarray(part.simplify(0.5).coords))}
            if lanes:
                d["lanes"] = int(lanes)
            if width:
                d["width"] = width
            if t.get("oneway") in ("yes", "-1"):
                d["oneway"] = t["oneway"]
            if t.get("bridge", "no") != "no":
                d["bridge"] = True
            if t.get("tunnel", "no") != "no":
                d["tunnel"] = True
            if t.get("junction") == "roundabout":
                d["roundabout"] = True
            if t.get("surface"):
                d["surface"] = t["surface"]
            if w.id in route_ways:
                d["onRoute"] = True
            out.append(d)
    return out


# ---------------------------------------------------------------------------
# Trees

PALM_RX = re.compile(r"phoenix|washingtonia|trachycarpus|chamaerops|syagrus|butia|livistona|palm|palmera|arecaceae", re.I)


def build_trees(osm: OSM, geo: Geo, route, dsm, dtm, ndvi, building_polys, half, water=(), dsm_off=None, green=()) -> tuple[list, dict]:
    f = geo.f
    near = route.line.buffer(60)
    osm_trees = []  # x, z, height|nan, crown|nan, palm
    for nid, t in osm.node_tags.items():
        if t.get("natural") != "tree":
            continue
        x, z = geo.node_xz[nid]
        if not near.contains(Point(x, z)):
            continue
        txt = " ".join(t.get(k, "") for k in ("genus", "species", "taxon", "species:es", "name", "leaf_type", "genus:es"))
        palm = 1 if PALM_RX.search(txt) else 0
        osm_trees.append([x, z, num(t.get("height")) or np.nan, (num(t.get("diameter_crown")) or np.nan) / 2, palm])
    rows = 0
    for w in osm.ways.values():
        if w.tags.get("natural") != "tree_row":
            continue
        c = geo.way_xz(w)
        if c is None:
            continue
        ln = LineString(c)
        if not ln.intersects(near):
            continue
        rows += 1
        txt = " ".join(w.tags.get(k, "") for k in ("genus", "species", "taxon", "name", "leaf_type"))
        palm = 1 if PALM_RX.search(txt) else 0
        for d in np.arange(0, ln.length + 0.1, 7.0):
            q = ln.interpolate(d)
            if near.contains(q):
                osm_trees.append([q.x, q.y, np.nan, np.nan, palm])
    osm_trees = np.array(osm_trees) if osm_trees else np.zeros((0, 5))

    # LiDAR canopy height model, masked away from buildings (+2 m), bridges and the carriageway
    chm = dsm.a - dtm.a
    to_utm = lambda g: shp_transform(lambda x, y, z=None: f.utm(np.asarray(x), np.asarray(y)), g)
    shapes = [(to_utm(p.buffer(2.0)), 1) for p in building_polys if p.distance(route.line) < 80]
    for w in osm.ways.values():
        t = w.tags
        if t.get("man_made") in ("bridge", "pier") or (t.get("bridge", "no") != "no" and "highway" in t) or t.get("building:part"):
            c = geo.way_xz(w)
            if c is not None and LineString(c).distance(route.line) < 80:
                g = geo.way_polygon(w) if w.closed else LineString(c).buffer(8)
                if g is not None:
                    shapes.append((to_utm(g.buffer(2)), 1))
    mask = rasterize(shapes, out_shape=chm.shape, transform=dsm.t, fill=0, dtype="uint8", all_touched=True).astype(bool) if shapes else np.zeros(chm.shape, bool)
    c2 = np.where(mask | ~np.isfinite(chm), 0, chm)
    mx = maximum_filter(c2, size=5)  # 10 m window
    peaks = (c2 == mx) & (c2 >= 3) & (c2 <= 30)
    r, cidx = np.nonzero(peaks)
    e = dsm.t.c + (cidx + 0.5) * dsm.t.a
    n = dsm.t.f + (r + 0.5) * dsm.t.e
    # back to local
    from pyproj import Transformer
    tr = Transformer.from_crs("EPSG:25829", f.proj4, always_xy=True)
    lx, ly = tr.transform(e, n)
    lz = -np.asarray(ly)
    lx = np.asarray(lx)
    s, lat, idx = route.locate(lx, lz)
    keep = (np.abs(lat) <= 60) & (np.abs(lat) > half[idx] + 0.8)
    r, cidx, lx, lz, e, n, s, lat = (a[keep] for a in (r, cidx, lx, lz, e, n, s, lat))
    hts = c2[r, cidx]
    # crown radius: mean distance along 8 directions to where the CHM falls below half the height
    dirs = [(0, 1), (1, 0), (0, -1), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)]
    H, W = c2.shape
    crown = np.zeros(len(r))
    for k in range(len(r)):
        ds = []
        for dr, dc in dirs:
            step = math.hypot(dr, dc) * dsm.res
            dist = 0.0
            for m in range(1, 6):
                rr, cc = r[k] + dr * m, cidx[k] + dc * m
                if not (0 <= rr < H and 0 <= cc < W) or c2[rr, cc] < max(hts[k] * 0.5, 2.0):
                    break
                dist = m * step
            ds.append(dist + dsm.res / 2)
        crown[k] = float(np.mean(ds))
    nd = ndvi.sample(e, n) if ndvi.ok else np.full(len(r), np.nan)
    veg_ok = ~(nd < 0.12)  # NaN passes; Sentinel-2 summer NDVI at 10 m: asphalt/roofs ~0.05-0.1
    # no LiDAR "trees" standing in mapped water (reeds / riverbed scrub under the bridges)
    from shapely import contains_xy
    from shapely.ops import unary_union
    wet = np.zeros(len(r), bool)
    if water:
        wpoly = unary_union([Polygon(np.asarray(w["ring"]).reshape(-1, 2), [np.asarray(h).reshape(-1, 2) for h in w.get("holes", [])]).buffer(0) for w in water])
        wet = contains_xy(wpoly, lx, lz)
    lidar = np.c_[lx, lz, hts, crown, np.zeros(len(r))][veg_ok & ~wet]
    stats = {"lidarPeaks": int(len(r)), "lidarRejectedNdvi": int((~veg_ok).sum()), "lidarRejectedWater": int((veg_ok & wet).sum()), "osmTrees": int(len(osm_trees)),
             "osmTreeRows": rows}

    # OSM trees take the LiDAR height / crown of a peak within 3.5 m; those peaks are then dropped
    from scipy.spatial import cKDTree
    used = np.zeros(len(lidar), bool)
    if len(lidar) and len(osm_trees):
        kt = cKDTree(lidar[:, :2])
        dd, ii = kt.query(osm_trees[:, :2], distance_upper_bound=3.5)
        for k, (d, i) in enumerate(zip(dd, ii)):
            if np.isfinite(d):
                used[i] = True
                if not np.isfinite(osm_trees[k, 2]):
                    osm_trees[k, 2] = lidar[i, 2]
                if not np.isfinite(osm_trees[k, 3]):
                    osm_trees[k, 3] = lidar[i, 3]
    # OSM trees without LiDAR support: sample the CHM at the point (young/new trees default to 5 m)
    for k in range(len(osm_trees)):
        if not np.isfinite(osm_trees[k, 2]):
            ee, nn = f.utm(osm_trees[k, 0], osm_trees[k, 1])
            v = float((dsm.sample(np.atleast_1d(ee), np.atleast_1d(nn)) - dtm.sample(np.atleast_1d(ee), np.atleast_1d(nn)))[0])
            osm_trees[k, 2] = v if 3 <= v <= 30 else (8.0 if osm_trees[k, 4] else 5.0)
        if not np.isfinite(osm_trees[k, 3]):
            osm_trees[k, 3] = 1.5 if osm_trees[k, 4] else max(1.5, osm_trees[k, 2] * 0.3)
    # drop OSM trees standing on the carriageway
    if len(osm_trees):
        s2, lat2, i2 = route.locate(osm_trees[:, 0], osm_trees[:, 1])
        osm_trees = osm_trees[np.abs(lat2) > half[i2] + 0.5]
    lidar = lidar[~used]
    # thin LiDAR trees: at most one per 4 m, tallest first, then cap the total
    order = np.argsort(-lidar[:, 2]) if len(lidar) else np.array([], int)
    keep_idx = []
    if len(order):
        kt = cKDTree(lidar[:, :2])
        taken = np.zeros(len(lidar), bool)
        for i in order:
            if taken[i]:
                continue
            keep_idx.append(i)
            for j in kt.query_ball_point(lidar[i, :2], 4.0):
                taken[j] = True
    lidar = lidar[keep_idx]
    cap = 6000 - len(osm_trees)
    if len(lidar) > cap:
        lidar = lidar[np.argsort(-lidar[:, 2])[:cap]]
    allt = np.vstack([osm_trees, lidar]) if len(lidar) else osm_trees
    allt[:, 4] = palm_likely(allt, f, dsm, dsm_off, water, green)
    stats.update({"fromOsm": int(len(osm_trees)), "fromLidar": int(len(lidar)), "palms": int((allt[:, 4] == 1).sum()),
                  "palmLikely": int((allt[:, 4] == 2).sum()),
                  "heightP50": qn(np.median(allt[:, 2])), "note": "LiDAR flown 2018-19; OSM trees use the LiDAR height of a crown peak within 3.5 m"})
    out = []
    for x, z, h, cr, palm in allt:
        out += [qn(x), qn(z), qn(h), qn(cr), int(palm)]
    return out, stats


# ---------------------------------------------------------------------------
# Furniture and POIs


def palm_likely(T: np.ndarray, f, dsm, dsm_off, water, green) -> np.ndarray:
    """Palm flag per tree: 1 = OSM says palm; 2 = palm-like from the data: taller than 8 m, crown
    radius under a quarter of the height (a slender trunk with a small head), evergreen (the
    leaf-off surface model is within 1 m of the leaf-on one at the crown) and standing in a park or
    garden (Paseo de San Francisco, the riverside parks) or within 40 m of the river."""
    flag = T[:, 4].copy()
    if dsm_off is None or not len(T):
        return flag
    from shapely import contains_xy
    from shapely.ops import unary_union
    shape = (T[:, 2] > 8) & (T[:, 3] < 0.25 * T[:, 2])
    e, n = f.utm(T[:, 0], T[:, 1])
    on = np.max([dsm.sample(e + dx, n + dz) for dx in (-2, 0, 2) for dz in (-2, 0, 2)], axis=0)
    off = np.max([dsm_off.sample(e + dx, n + dz) for dx in (-2, 0, 2) for dz in (-2, 0, 2)], axis=0)
    evergreen = (on - off) < 1.0
    parks = unary_union([Polygon(np.asarray(g["ring"]).reshape(-1, 2)).buffer(0) for g in green if g.get("kind") in ("park", "garden")])
    river = unary_union([Polygon(np.asarray(w["ring"]).reshape(-1, 2)).buffer(0) for w in water]).buffer(40)
    ctx = contains_xy(parks, T[:, 0], T[:, 1]) | contains_xy(river, T[:, 0], T[:, 1])
    return np.where((flag == 0) & shape & evergreen & ctx, 2, flag)


def _furniture_kind(t: dict) -> str | None:
    hw, am = t.get("highway"), t.get("amenity")
    if hw == "bus_stop" or t.get("public_transport") == "platform" and t.get("bus") == "yes":
        return "bus_stop"
    if hw == "traffic_signals":
        return "traffic_signals"
    if hw == "crossing":
        return "crossing"
    if hw == "street_lamp":
        return "street_lamp"
    if am in ("bench", "fountain", "drinking_water", "bicycle_parking", "waste_basket", "recycling", "waste_disposal",
              "post_box", "telephone", "clock", "toilets", "vending_machine", "parking_entrance", "bicycle_rental", "atm"):
        return am
    if t.get("barrier") in ("bollard", "planter"):
        return t["barrier"]
    if t.get("historic") in ("memorial", "monument") or t.get("tourism") == "artwork" or t.get("memorial"):
        return "statue" if t.get("memorial") == "statue" or t.get("artwork_type") in ("statue", "sculpture") else "memorial"
    if t.get("leisure") in ("playground", "fitness_station"):
        return t["leisure"]
    if t.get("man_made") in ("flagpole",):
        return "flagpole"
    return None


def build_furniture(osm: OSM, geo: Geo, route) -> list[dict]:
    out = []
    for nid, t in osm.node_tags.items():
        k = _furniture_kind(t)
        if k is None:
            continue
        x, z = geo.node_xz[nid]
        s, lat, _ = route.locate(x, z)
        if abs(lat[0]) > 25 or route.line.distance(Point(x, z)) > 25:
            continue
        d = {"type": k, "x": qn(x), "z": qn(z), "s": qn(s[0]), "lateral": qn(lat[0]), "osm": f"n{nid}"}
        if t.get("name"):
            d["name"] = t["name"]
        for key in ("crossing", "shelter", "bench", "route_ref", "inscription", "artwork_type", "subject", "operator", "recycling_type"):
            if key in t:
                d[key] = t[key]
        out.append(d)
    out.sort(key=lambda d: d["s"])
    return out


POI_AMENITY = {"bar", "cafe", "restaurant", "fast_food", "pub", "ice_cream", "pharmacy", "bank", "atm", "biergarten",
               "nightclub", "cinema", "theatre", "dentist", "doctors", "clinic", "post_office", "fuel", "library",
               "bureau_de_change", "car_rental", "driving_school", "gambling", "townhall", "police", "marketplace",
               "veterinary", "language_school", "music_school", "kindergarten", "school", "place_of_worship", "food_court"}


def build_pois(osm: OSM, geo: Geo, route) -> list[dict]:
    out = []
    for kind, oid, t in _elements(osm):
        if not t.get("name"):
            continue
        cat = None
        if "shop" in t:
            cat = f"shop:{t['shop']}"
        elif t.get("amenity") in POI_AMENITY:
            cat = f"amenity:{t['amenity']}"
        elif t.get("tourism") in ("hotel", "hostel", "guest_house", "apartment", "museum", "information"):
            cat = f"tourism:{t['tourism']}"
        elif "office" in t and t.get("office") not in ("yes",):
            cat = f"office:{t['office']}"
        elif t.get("craft"):
            cat = f"craft:{t['craft']}"
        elif t.get("leisure") in ("fitness_centre", "sports_centre"):
            cat = f"leisure:{t['leisure']}"
        if cat is None:
            continue
        x, z, poly, line = _centroid_and_ring(geo, kind, oid)
        if not np.isfinite(x):
            continue
        g = poly if poly is not None else Point(x, z)
        dist = g.distance(route.line)
        if dist > 35:
            continue
        s, lat, _ = route.locate(x, z)
        d = {"name": t["name"], "category": cat, "x": qn(x), "z": qn(z), "s": qn(s[0]),
             "side": "right" if lat[0] > 0 else "left", "dist": qn(dist), "osm": f"{kind}{oid}"}
        for key in ("brand", "cuisine", "opening_hours", "addr:street", "addr:housenumber", "outdoor_seating"):
            if key in t:
                d[key] = t[key]
        out.append(d)
    out.sort(key=lambda d: d["s"])
    return out


# ---------------------------------------------------------------------------
# Terrain


def build_terrain(geo: Geo, route, dtm, z0: float, water: list[dict]) -> dict:
    cell = 10.0
    mn = np.floor((route.p.min(0) - 260) / cell) * cell
    mx = np.ceil((route.p.max(0) + 260) / cell) * cell
    xs = np.arange(mn[0], mx[0] + cell / 2, cell)
    zs = np.arange(mn[1], mx[1] + cell / 2, cell)
    X, Z = np.meshgrid(xs, zs)
    e, n = geo.f.utm(X.ravel(), Z.ravel())
    # mean of a 5x5 m neighbourhood (2 m grid) to avoid aliasing
    acc = np.zeros(len(e))
    cnt = np.zeros(len(e))
    for dx in (-3, -1, 1, 3):
        for dz in (-3, -1, 1, 3):
            v = dtm.sample(e + dx, n + dz)
            ok = np.isfinite(v)
            acc[ok] += v[ok]
            cnt[ok] += 1
    h = np.where(cnt > 0, acc / np.maximum(cnt, 1), np.nan) - z0
    corridor = route.line.buffer(250)
    from shapely import contains_xy
    inside = contains_xy(corridor, X.ravel(), Z.ravel())
    h = np.where(inside, h, np.nan)
    # river level: DTM inside the Guadiana's water polygons near the route (LiDAR water returns / interpolated surface)
    wl = []
    for wpoly in water:
        ring = np.array(wpoly["ring"]).reshape(-1, 2)
        p = Polygon(ring)
        if p.area < 2000 or p.distance(route.line) > 300:
            continue
        pts = p.buffer(-4)
        if pts.is_empty:
            continue
        sel = contains_xy(pts, X.ravel(), Z.ravel())
        vals = h[sel]
        vals = vals[np.isfinite(vals)]
        if len(vals):
            wl.append(np.percentile(vals, 20))
    water_level = float(np.median(wl)) if wl else None
    return {"x0": qn(xs[0]), "z0": qn(zs[0]), "cell": cell, "nx": len(xs), "nz": len(zs),
            "h": [None if not np.isfinite(v) else qn(v) for v in h],
            "waterLevel": qn(water_level) if water_level is not None else None,
            "note": "row-major: h[iz*nx + ix] at (x0 + ix*cell, z0 + iz*cell); null outside the ±250 m corridor"}
