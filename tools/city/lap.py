"""The lap: route the raw node path through the waypoints, then resample, smooth and attribute it."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

import networkx as nx
import numpy as np
from scipy.ndimage import gaussian_filter1d

from osm import OSM, Geo
from route import build_graph, route_through

# Start: the node where Puente Real's south-east-bound carriageway leaves the Avenida de Elvas
# roundabout on the right bank (OSM node 1142046712).
START_NODE = 1142046712

# Ordered waypoints in the local frame (metres from the start, x east, z south):
# (label, x, z, street-name regex the snapped node must lie on).
WAYPOINTS: list[tuple[str, float, float, str]] = [
    ("start", 0, 0, r"^Puente Real$"),
    ("sinforiano-mid", 819, 1448, r"Sinforiano Madroñero"),
    ("sinforiano-end", 1229, 1883, r"Sinforiano Madroñero"),
    ("europa", 2139, 868, r"Avenida de Europa"),
    ("san-francisco", 2128, 664, r"Paseo San Francisco"),
    ("obispo-ribera", 2290, 500, r"Obispo San Juan de Ribera"),
    ("plaza-espana", 2346, 438, r"Plaza de España"),
    ("san-juan", 2454, 261, r"^Calle San Juan$"),
    ("plaza-alta", 2549, 138, r"Plaza Alta|Moreno Zancudo"),
    ("plaza-san-jose", 2443, 14, r"Plaza San José"),
    ("joaquin-costa", 1960, 30, r"Avenida Joaquín Costa"),
    # through the archway of Puerta de Palmas: the covered footway under the gate (OSM way 96659409)
    ("puerta-palmas-arch", 1895.2, 180.8, r"way:96659409"),
    ("puerta-palmas-out", 1886.8, 168.7, r"way:96659407"),
    ("puerta-palmas", 1874, 150, r"Puente de Palmas"),
    ("puente-palmas", 1719, -72, r"Puente de Palmas"),
    ("adolfo-diaz-ambrona", 1259, -281, r"Díaz Ambrona"),
    ("avenida-elvas", 259, -112, r"Avenida de Elvas"),
]


def snap(g: nx.DiGraph, osm: OSM, geo: Geo, x: float, z: float, pattern: str) -> int:
    """Nearest graph node to (x, z) on a way whose name matches `pattern`, or on OSM way <id>
    when the pattern is "way:<id>"."""
    way_id = int(pattern[4:]) if pattern.startswith("way:") else None
    rx = re.compile(pattern)
    best, bd = None, math.inf
    for u, v, d in g.edges(data=True):
        if way_id is not None:
            if d["way"] != way_id:
                continue
        elif not rx.search(osm.ways[d["way"]].tags.get("name", "")):
            continue
        for n in (u, v):
            px, pz = geo.node_xz[n]
            dd = (px - x) ** 2 + (pz - z) ** 2
            if dd < bd:
                best, bd = n, dd
    if best is None:
        raise ValueError(f"no node on a street matching {pattern!r}")
    return best


@dataclass
class RawLap:
    nodes: list[int]
    ways: list[int]  # way id of each edge (len = len(nodes) - 1)
    xz: np.ndarray  # node positions
    waypoints: dict[str, int]


def raw_lap(osm: OSM, geo: Geo, avoid: set[int] | None = None, overrides: dict[int, float] | None = None) -> RawLap:
    g = build_graph(osm, geo, avoid, overrides)
    stops = []
    wp_nodes: dict[str, int] = {}
    for label, x, z, pat in WAYPOINTS:
        n = START_NODE if label == "start" else snap(g, osm, geo, x, z, pat)
        stops.append(n)
        wp_nodes[label] = n
    path = route_through(g, stops)
    ways = [g[u][v]["way"] for u, v in zip(path[:-1], path[1:])]
    xz = np.array([geo.node_xz[n] for n in path])
    return RawLap(path, ways, xz, wp_nodes)


def resample(xz: np.ndarray, step: float) -> tuple[np.ndarray, np.ndarray]:
    """Resample a closed polyline (last point == first) at ~step metres. Returns points (open, n)
    and the parameter (distance along the input) of each sample."""
    seg = np.hypot(*np.diff(xz, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]
    n = max(8, int(round(L / step)))
    t = np.linspace(0, L, n, endpoint=False)
    x = np.interp(t, s, xz[:, 0])
    z = np.interp(t, s, xz[:, 1])
    return np.stack([x, z], 1), t


def curvature_radius(p: np.ndarray) -> np.ndarray:
    """Signed radius at each point of a closed polyline (circumcircle of neighbours, +left turn)."""
    a, b, c = np.roll(p, 1, 0), p, np.roll(p, -1, 0)
    ab, bc, ca = b - a, c - b, a - c
    cross = ab[:, 0] * bc[:, 1] - ab[:, 1] * bc[:, 0]
    la, lb, lc = (np.hypot(*v.T) for v in (ab, bc, ca))
    with np.errstate(divide="ignore", invalid="ignore"):
        r = la * lb * lc / (2 * np.abs(cross))
    r = np.where(np.abs(cross) < 1e-9, np.inf, r)
    return np.sign(cross) * r


def radius_over(p: np.ndarray, span: int) -> np.ndarray:
    """Radius measured over +-span samples (robust to sample noise)."""
    a, b, c = np.roll(p, span, 0), p, np.roll(p, -span, 0)
    ab, bc, ca = b - a, c - b, a - c
    cross = ab[:, 0] * bc[:, 1] - ab[:, 1] * bc[:, 0]
    la, lb, lc = (np.hypot(*v.T) for v in (ab, bc, ca))
    with np.errstate(divide="ignore", invalid="ignore"):
        r = la * lb * lc / (2 * np.abs(cross))
    return np.where(np.abs(cross) < 1e-9, np.inf, r)


def smooth_closed(p: np.ndarray, sigma: np.ndarray | float, iters: int = 1) -> np.ndarray:
    """Gaussian smoothing of a closed polyline with a per-point sigma (in samples)."""
    sig = np.broadcast_to(np.asarray(sigma, float), (len(p),))
    out = p.copy()
    for _ in range(iters):
        levels = np.unique(np.round(sig * 2) / 2)
        res = out.copy()
        for lv in levels:
            if lv <= 0:
                continue
            sm = np.stack([gaussian_filter1d(out[:, k], lv, mode="wrap") for k in (0, 1)], 1)
            m = np.round(sig * 2) / 2 == lv
            res[m] = sm[m]
        out = res
    return out
