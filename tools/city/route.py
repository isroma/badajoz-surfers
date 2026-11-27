"""Route the closed lap through ordered waypoints on the OSM way graph."""
from __future__ import annotations

import math
from dataclasses import dataclass

import networkx as nx
import numpy as np

from shapely.geometry import LineString
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

from osm import OSM, Geo

ROUTABLE = {
    "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
    "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
    "living_street", "pedestrian", "service", "footway", "path", "cycleway", "track", "steps",
}
# Cost multiplier per class: named streets are preferred over service roads and paths.
CLASS_COST = {
    "primary": 1.0, "secondary": 1.0, "tertiary": 1.0, "trunk": 1.05, "residential": 1.05,
    "unclassified": 1.15, "living_street": 1.05, "pedestrian": 1.05,
    "primary_link": 1.3, "secondary_link": 1.3, "tertiary_link": 1.3, "trunk_link": 1.4,
    "motorway": 4.0, "motorway_link": 4.0,
    "service": 3.0, "footway": 1.8, "path": 2.2, "cycleway": 2.0, "track": 3.0, "steps": 12.0,
}
# Roads where a oneway tag means "this is one carriageway of a dual road" (or a ring), so the
# runner keeps to the carriageway traffic in its direction uses.
DIRECTIONAL = {"motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link",
               "primary_link", "secondary_link", "tertiary_link"}


@dataclass
class Edge:
    way: int
    a: int
    b: int
    length: float


# Connectors OSM lacks: (node a, node b, way id whose tags the segment takes).
# Puerta de Palmas: the footway out of the gate's archway ends at the Ronda; the Puente de Palmas
# path continues on the same axis 16 m further on (the crossing of the Ronda isn't mapped as one).
EXTRA_EDGES = [(1118840050, 4163916263, 96659407)]


def oneway_dir(tags: dict[str, str]) -> int:
    """+1 forward only, -1 backward only, 0 both."""
    ow = tags.get("oneway", "")
    if tags.get("junction") in ("roundabout", "circular") and ow != "no":
        return 1
    if ow in ("yes", "true", "1"):
        return 1
    if ow == "-1":
        return -1
    return 0


def roundabout_islands(osm: OSM, geo: Geo):
    """Polygons enclosed by roundabout rings (OSM junction=roundabout ways, merged)."""
    lines = []
    for w in osm.ways.values():
        if w.tags.get("junction") in ("roundabout", "circular") and "highway" in w.tags:
            c = geo.way_xz(w)
            if c is not None:
                lines.append(LineString(c))
    return [p for p in polygonize(unary_union(lines)) if p.area < 60000]


def build_graph(osm: OSM, geo: Geo, avoid_ways: set[int] | None = None,
                cost_overrides: dict[int, float] | None = None) -> nx.DiGraph:
    avoid_ways = set(avoid_ways or set())
    # never cut across a roundabout's central island on a footway: go round the ring
    islands = STRtree(roundabout_islands(osm, geo))
    for w in osm.ways.values():
        if w.tags.get("highway") in ("footway", "path", "cycleway", "pedestrian", "service", "steps"):
            c = geo.way_xz(w)
            if c is None:
                continue
            if w.closed and w.tags["highway"] in ("footway", "path", "cycleway"):
                avoid_ways.add(w.id)  # rings round plazas and roundabouts (e.g. Plaza de la Constitución's raised walk)
                continue
            line = LineString(c)
            mid = line.interpolate(0.5, normalized=True)
            for i in islands.query(line):
                isl = islands.geometries[i]
                if isl.buffer(-1).contains(mid) or isl.buffer(4).contains(line):
                    avoid_ways.add(w.id)
    cost_overrides = cost_overrides or {}
    g = nx.DiGraph()
    for w in osm.ways.values():
        hw = w.tags.get("highway")
        if hw not in ROUTABLE or w.id in avoid_ways:
            continue
        if w.tags.get("area") == "yes" or w.tags.get("access") == "private" and hw == "service":
            continue
        if hw == "service" and w.tags.get("service") in ("parking_aisle", "driveway", "drive-through"):
            continue
        coords = geo.way_xz(w)
        if coords is None:
            continue
        mult = cost_overrides.get(w.id, CLASS_COST.get(hw, 2.0))
        if not w.tags.get("name") and hw not in ("primary", "secondary", "tertiary", "trunk"):
            mult *= 1.35
        d = oneway_dir(w.tags)
        ring = w.tags.get("junction") in ("roundabout", "circular")
        strict = ring or (hw in DIRECTIONAL)
        for i in range(len(w.nodes) - 1):
            a, b = w.nodes[i], w.nodes[i + 1]
            L = float(np.hypot(*(coords[i + 1] - coords[i])))
            if L <= 0:
                continue
            fwd_ok = d >= 0
            bwd_ok = d <= 0
            for (u, v, ok) in ((a, b, fwd_ok), (b, a, bwd_ok)):
                cost = L * mult
                if not ok:
                    if strict:
                        continue  # never against a ring or a directional carriageway
                    cost *= 1.25  # runner on foot: wrong way down a one-way street is fine
                prev = g.get_edge_data(u, v)
                if prev is None or prev["cost"] > cost:
                    g.add_edge(u, v, cost=cost, length=L, way=w.id)
    for a, b, wid in EXTRA_EDGES:
        if a in geo.node_xz and b in geo.node_xz:
            L = float(np.hypot(*(np.array(geo.node_xz[a]) - geo.node_xz[b])))
            for u, v in ((a, b), (b, a)):
                g.add_edge(u, v, cost=L, length=L, way=wid)
    return g


def nearest_node(g: nx.DiGraph, geo: Geo, x: float, z: float, ways: set[int] | None = None) -> int:
    best, bd = None, math.inf
    for n in g.nodes:
        if ways is not None:
            ws = {d["way"] for _, _, d in g.out_edges(n, data=True)} | {d["way"] for _, _, d in g.in_edges(n, data=True)}
            if not ws & ways:
                continue
        px, pz = geo.node_xz[n]
        dd = (px - x) ** 2 + (pz - z) ** 2
        if dd < bd:
            best, bd = n, dd
    assert best is not None
    return best


def route_through(g: nx.DiGraph, nodes: list[int]) -> list[int]:
    """Shortest path visiting nodes in order, closing back to the first. Edges already used get
    expensive so the lap does not double back on itself."""
    path: list[int] = [nodes[0]]
    used: set[tuple[int, int]] = set()

    def w(u, v, d):
        c = d["cost"]
        if (u, v) in used or (v, u) in used:
            c *= 8
        return c

    seq = nodes + [nodes[0]]
    for a, b in zip(seq[:-1], seq[1:]):
        p = nx.shortest_path(g, a, b, weight=w)
        for u, v in zip(p[:-1], p[1:]):
            used.add((u, v))
        path.extend(p[1:])
    return path
