"""Debug: route the raw lap and draw it over the street network (tools/city/.cache/route_raw.png)."""
from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from fetch_osm import merged_path
from lap import START_NODE, raw_lap
from osm import CACHE, OSM, Frame, Geo

MAJOR = {"trunk", "primary", "secondary", "tertiary"}


def main() -> None:
    osm = OSM.load(merged_path())
    lon, lat = osm.nodes[START_NODE]
    geo = Geo(osm, Frame(lat, lon))
    lap = raw_lap(osm, geo)
    fig, ax = plt.subplots(figsize=(20, 16), dpi=110)
    for w in osm.ways.values():
        hw = w.tags.get("highway")
        if not hw:
            continue
        c = geo.way_xz(w)
        if c is None:
            continue
        ax.plot(c[:, 0], -c[:, 1], color="0.6" if hw in MAJOR else "0.85", lw=1.5 if hw in MAJOR else 0.5, zorder=1)
    ax.plot(lap.xz[:, 0], -lap.xz[:, 1], color="red", lw=2.5, zorder=3)
    # street labels along the route
    last = None
    total = 0.0
    seg = np.hypot(*np.diff(lap.xz, axis=0).T)
    for i, wid in enumerate(lap.ways):
        name = osm.ways[wid].tags.get("name", f"({osm.ways[wid].tags.get('highway')})")
        if name != last:
            ax.text(lap.xz[i, 0], -lap.xz[i, 1], f"{name} @{total:.0f}", fontsize=7, color="navy", zorder=4)
            print(f"{total:7.0f}  {name}  [{osm.ways[wid].tags.get('highway')}] way {wid}")
            last = name
        total += seg[i]
    print("raw length", total)
    for k, n in lap.waypoints.items():
        x, z = geo.node_xz[n]
        ax.plot(x, -z, "k*", ms=10, zorder=5)
        ax.text(x, -z, k, fontsize=9, color="green", zorder=5)
    mn, mx = lap.xz.min(0) - 100, lap.xz.max(0) + 100
    ax.set_xlim(mn[0], mx[0])
    ax.set_ylim(-mx[1], -mn[1])
    ax.set_aspect("equal")
    fig.savefig(CACHE / "route_raw.png", bbox_inches="tight")


if __name__ == "__main__":
    main()
