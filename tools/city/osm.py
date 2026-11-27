"""OSM element store and the local coordinate frame."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import linemerge, polygonize, unary_union

CACHE = Path(__file__).parent / ".cache"


class Frame:
    """Local tangent plane: metres, origin at (lat0, lon0), x = east, z = south (north is -z).

    Implemented as a transverse Mercator centred on the origin with scale 1, so distortion is
    negligible (< 1e-6) over the few kilometres of the game world.
    """

    def __init__(self, lat0: float, lon0: float) -> None:
        self.lat0, self.lon0 = lat0, lon0
        self.proj4 = f"+proj=tmerc +lat_0={lat0} +lon_0={lon0} +k=1 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs"
        self._fwd = Transformer.from_crs("EPSG:4326", self.proj4, always_xy=True)
        self._inv = Transformer.from_crs(self.proj4, "EPSG:4326", always_xy=True)
        self._to_utm = Transformer.from_crs(self.proj4, "EPSG:25829", always_xy=True)

    def xz(self, lon: np.ndarray | float, lat: np.ndarray | float) -> tuple[np.ndarray, np.ndarray]:
        e, n = self._fwd.transform(lon, lat)
        return np.asarray(e), -np.asarray(n)

    def lonlat(self, x: np.ndarray | float, z: np.ndarray | float) -> tuple[np.ndarray, np.ndarray]:
        lon, lat = self._inv.transform(x, -np.asarray(z))
        return np.asarray(lon), np.asarray(lat)

    def utm(self, x: np.ndarray | float, z: np.ndarray | float) -> tuple[np.ndarray, np.ndarray]:
        e, n = self._to_utm.transform(x, -np.asarray(z))
        return np.asarray(e), np.asarray(n)


@dataclass
class Way:
    id: int
    nodes: list[int]
    tags: dict[str, str]

    @property
    def closed(self) -> bool:
        return len(self.nodes) > 3 and self.nodes[0] == self.nodes[-1]


@dataclass
class Rel:
    id: int
    members: list[dict]
    tags: dict[str, str]


@dataclass
class OSM:
    nodes: dict[int, tuple[float, float]] = field(default_factory=dict)  # id -> (lon, lat)
    node_tags: dict[int, dict[str, str]] = field(default_factory=dict)
    ways: dict[int, Way] = field(default_factory=dict)
    rels: dict[int, Rel] = field(default_factory=dict)
    timestamp: str = ""

    @classmethod
    def load(cls, path: Path) -> "OSM":
        raw = json.loads(path.read_text())
        o = cls(timestamp=raw.get("osm3s", {}).get("timestamp_osm_base", ""))
        for el in raw["elements"]:
            t = el["type"]
            if t == "node":
                o.nodes[el["id"]] = (el["lon"], el["lat"])
                if el.get("tags"):
                    o.node_tags[el["id"]] = el["tags"]
            elif t == "way":
                prev = o.ways.get(el["id"])
                tags = el.get("tags") or (prev.tags if prev else {})
                o.ways[el["id"]] = Way(el["id"], el.get("nodes", []), tags)
            elif t == "relation":
                o.rels[el["id"]] = Rel(el["id"], el.get("members", []), el.get("tags", {}))
        return o

    def way_lonlat(self, w: Way) -> np.ndarray | None:
        pts = [self.nodes[n] for n in w.nodes if n in self.nodes]
        if len(pts) < 2 or len(pts) != len(w.nodes):
            return None
        return np.array(pts)


class Geo:
    """OSM geometry in the local frame."""

    def __init__(self, osm: OSM, frame: Frame) -> None:
        self.osm, self.f = osm, frame
        ids = np.array(list(osm.nodes.keys()))
        ll = np.array(list(osm.nodes.values()))
        x, z = frame.xz(ll[:, 0], ll[:, 1])
        self.node_xz = {int(i): (float(a), float(b)) for i, a, b in zip(ids, x, z)}

    def way_xz(self, w: Way) -> np.ndarray | None:
        try:
            return np.array([self.node_xz[n] for n in w.nodes])
        except KeyError:
            return None

    def way_polygon(self, w: Way) -> Polygon | None:
        c = self.way_xz(w)
        if c is None or not w.closed or len(c) < 4:
            return None
        p = Polygon(c)
        if not p.is_valid:
            p = p.buffer(0)
        return p if not p.is_empty else None

    def rel_polygon(self, r: Rel) -> Polygon | MultiPolygon | None:
        outers, inners = [], []
        for m in r.members:
            if m["type"] != "way" or m["ref"] not in self.osm.ways:
                continue
            c = self.way_xz(self.osm.ways[m["ref"]])
            if c is None:
                continue
            (inners if m.get("role") == "inner" else outers).append(LineString(c))
        if not outers:
            return None
        outer = unary_union(list(polygonize(linemerge(outers))))
        if outer.is_empty:
            return None
        if inners:
            inner = unary_union(list(polygonize(linemerge(inners))))
            outer = outer.difference(inner)
        if not outer.is_valid:
            outer = outer.buffer(0)
        return outer if not outer.is_empty else None

    def areas(self, pred) -> list[tuple[str, int, dict, Polygon | MultiPolygon]]:
        """All closed ways / multipolygon relations whose tags satisfy pred."""
        out = []
        for w in self.osm.ways.values():
            if w.tags and w.closed and pred(w.tags):
                p = self.way_polygon(w)
                if p is not None:
                    out.append(("w", w.id, w.tags, p))
        for r in self.osm.rels.values():
            if r.tags.get("type") in ("multipolygon", "building") and pred(r.tags):
                p = self.rel_polygon(r)
                if p is not None:
                    out.append(("r", r.id, r.tags, p))
        return out
