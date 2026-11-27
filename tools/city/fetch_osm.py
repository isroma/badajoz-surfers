"""Download (once) all OSM data in the city bounding box from Overpass and cache the raw responses.

The box is fetched as a few tiles (smaller queries survive busy servers better); each tile's
response is cached under .cache/ and `load_all()` merges them. Re-run with --force to refresh.
"""
from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

import requests
import truststore

truststore.inject_into_ssl()  # use the OS trust store (corporate TLS proxies); verification stays on

CACHE = Path(__file__).parent / ".cache"
BBOX = (38.858, -7.008, 38.893, -6.955)  # south, west, north, east
TILES = (2, 2)  # rows, cols
ENDPOINTS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
HEADERS = {"User-Agent": "badajoz-surfers-data/0.1"}


def tiles() -> list[tuple[float, float, float, float]]:
    s, w, n, e = BBOX
    rows, cols = TILES
    out = []
    for i in range(rows):
        for j in range(cols):
            out.append((s + (n - s) * i / rows, w + (e - w) * j / cols,
                        s + (n - s) * (i + 1) / rows, w + (e - w) * (j + 1) / cols))
    return out


def query_text(b: tuple[float, float, float, float]) -> str:
    s, w, n, e = b
    return f"[out:json][timeout:300][maxsize:536870912];(nwr({s:.5f},{w:.5f},{n:.5f},{e:.5f}););out body;>;out skel qt;"


def fetch_one(q: str, force: bool = False) -> Path:
    key = hashlib.sha1(q.encode()).hexdigest()[:12]
    path = CACHE / f"overpass_{key}.json"
    if path.exists() and not force:
        return path
    CACHE.mkdir(exist_ok=True)
    last: Exception | None = None
    for attempt in range(2):
        for url in ENDPOINTS:
            try:
                print(f"Overpass: {url}", file=sys.stderr)
                r = requests.post(url, data={"data": q}, headers=HEADERS, timeout=(20, 400))
                r.raise_for_status()
                data = r.json()
                if "elements" not in data:
                    raise ValueError("no elements in response")
                path.write_text(json.dumps(data))
                return path
            except (requests.RequestException, ValueError) as exc:
                last = exc
                print(f"  failed: {exc}", file=sys.stderr)
        time.sleep(30 * (attempt + 1))
    raise RuntimeError(f"all Overpass endpoints failed: {last}")


def cached_paths(force: bool = False) -> list[Path]:
    return [fetch_one(query_text(b), force) for b in tiles()]


def merged_path(force: bool = False) -> Path:
    """Fetch every tile (cached) and write one merged, de-duplicated element file."""
    parts = cached_paths(force)
    out = CACHE / "osm_merged.json"
    if out.exists() and not force and all(out.stat().st_mtime >= p.stat().st_mtime for p in parts):
        return out
    seen: dict[tuple[str, int], dict] = {}
    ts = ""
    for p in parts:
        d = json.loads(p.read_text())
        ts = max(ts, d.get("osm3s", {}).get("timestamp_osm_base", ""))
        for el in d["elements"]:
            k = (el["type"], el["id"])
            # keep the fullest copy (out body beats out skel)
            if k not in seen or len(el) > len(seen[k]):
                seen[k] = el
    out.write_text(json.dumps({"osm3s": {"timestamp_osm_base": ts}, "elements": list(seen.values())}))
    return out


if __name__ == "__main__":
    p = merged_path(force="--force" in sys.argv)
    d = json.loads(p.read_text())
    print(len(d["elements"]), "elements", d["osm3s"]["timestamp_osm_base"])
