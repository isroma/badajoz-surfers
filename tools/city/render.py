"""Debug renders of public/data/city.json into tools/city/.cache/:

- route.png: the whole lap by zone over the street network, with street names
- zone-<id>.png: per zone: carriageway, buildings coloured by height, trees, POIs, furniture
- profile.png: route height and ground along s
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.collections import LineCollection, PolyCollection

HERE = Path(__file__).parent
CACHE = HERE / ".cache"
CITY = HERE.parents[1] / "public" / "data" / "city.json"
ZCOL = {"puente-real": "#d62728", "valdepasillas": "#ff7f0e", "san-francisco": "#2ca02c",
        "casco-antiguo": "#9467bd", "alcazaba-palmas": "#8c564b", "margen-derecha": "#1f77b4"}
MAJOR = {"trunk", "primary", "secondary", "tertiary"}


def pts(a):
    return np.asarray(a, float).reshape(-1, 2)


def load():
    c = json.loads(CITY.read_text())
    P = np.asarray(c["route"]["points"], float).reshape(-1, 3)
    s = np.asarray(c["route"]["s"], float)
    return c, P, s


def flip(ax):
    ax.set_aspect("equal")
    ax.invert_yaxis()  # z is south: draw north up


def draw_base(ax, c, lw=0.6):
    for w in c["water"]:
        ax.fill(*pts(w["ring"]).T, color="#a6cee3", zorder=0, lw=0)
    for g in c["green"]:
        ax.fill(*pts(g["ring"]).T, color="#ccebc5", zorder=0, lw=0)
    segs = [pts(st["pts"]) for st in c["streets"]]
    cols = ["0.55" if st["highway"] in MAJOR else "0.8" for st in c["streets"]]
    ax.add_collection(LineCollection(segs, colors=cols, linewidths=lw, zorder=1))


def route_png(c, P, s):
    fig, ax = plt.subplots(figsize=(18, 16), dpi=110)
    draw_base(ax, c)
    blds = [pts(b["ring"]) for b in c["buildings"]]
    ax.add_collection(PolyCollection(blds, facecolors="0.88", edgecolors="none", zorder=1))
    for z in c["zones"]:
        m = (s >= z["fromS"]) & (s < z["toS"])
        ax.plot(P[m, 0], P[m, 1], color=ZCOL[z["id"]], lw=3.5, zorder=3, label=f"{z['id']} {z['length']:.0f} m")
    last = None
    for sec in c["sections"]:
        if sec["name"] != last and sec["name"]:
            i = int(np.searchsorted(s, (sec["fromS"] + sec["toS"]) / 2))
            i = min(i, len(P) - 1)
            ax.text(P[i, 0] + 8, P[i, 1], f"{sec['name']} ({sec['fromS']:.0f})", fontsize=7, zorder=5,
                    bbox=dict(fc="white", ec="none", alpha=0.7, pad=0.5))
        last = sec["name"]
        if sec["roundabout"]:
            rb = sec["roundabout"]
            ax.add_patch(plt.Circle((rb["cx"], rb["cz"]), rb["r"], fill=False, ec="k", lw=0.8, zorder=4))
    for k in range(0, len(P), 250):
        ax.annotate("", xy=(P[(k + 3) % len(P), 0], P[(k + 3) % len(P), 1]), xytext=(P[k, 0], P[k, 1]),
                    arrowprops=dict(arrowstyle="->", color="k", lw=1.5), zorder=6)
    for lm in c["landmarks"]:
        if "x" in lm and not lm["id"].startswith("osm-"):
            ax.plot(lm["x"], lm["z"], "k^", ms=6, zorder=6)
            ax.text(lm["x"], lm["z"] - 12, lm["id"], fontsize=7, color="darkred", zorder=6)
    ax.plot(0, 0, "ko", ms=10, zorder=7)
    mn, mx = P[:, :2].min(0) - 150, P[:, :2].max(0) + 150
    ax.set_xlim(mn[0], mx[0])
    ax.set_ylim(mn[1], mx[1])
    flip(ax)
    ax.legend(loc="lower left")
    ax.set_title(f"Badajoz Surfers lap, {c['meta']['lapLength']} m (north up, arrows = direction)")
    fig.savefig(CACHE / "route.png", bbox_inches="tight")
    plt.close(fig)


def offset(P2, d):
    t = np.roll(P2, -1, 0) - np.roll(P2, 1, 0)
    t /= np.hypot(*t.T)[:, None]
    nrm = np.c_[-t[:, 1], t[:, 0]]  # right-hand normal in x-east/z-south
    return P2 + nrm * np.asarray(d)[:, None]


def zone_png(c, P, s, z):
    fig, ax = plt.subplots(figsize=(16, 16), dpi=110)
    m = (s >= z["fromS"]) & (s < z["toS"])
    mn, mx = P[m, :2].min(0) - 60, P[m, :2].max(0) + 60
    span = max(mx - mn)
    mx = mn + span
    draw_base(ax, c, lw=1.0)
    for sq in c["squares"]:
        ax.fill(*pts(sq["ring"]).T, color="#fde0dd", zorder=0, lw=0)
    cmap = plt.get_cmap("viridis")
    polys, cols, edges = [], [], []
    for b in c["buildings"]:
        r = pts(b["ring"])
        if (r[:, 0].max() < mn[0]) or (r[:, 0].min() > mx[0]) or (r[:, 1].max() < mn[1]) or (r[:, 1].min() > mx[1]):
            continue
        polys.append(r)
        cols.append(cmap(min(b["height"], 40) / 40))
        edges.append("red" if b.get("passesThrough") else "none")
    ax.add_collection(PolyCollection(polys, facecolors=cols, edgecolors=edges, linewidths=1.2, zorder=2, alpha=0.85))
    # carriageway edges from section widths
    half = np.zeros(len(s))
    for sec in c["sections"]:
        mm = (s >= sec["fromS"]) & (s < sec["toS"])
        half[mm] = sec["width"] / 2
    L = offset(P[:, :2], -half)
    R = offset(P[:, :2], half)
    ax.plot(L[m, 0], L[m, 1], color="k", lw=0.8, zorder=3)
    ax.plot(R[m, 0], R[m, 1], color="k", lw=0.8, zorder=3)
    ax.plot(P[m, 0], P[m, 1], color=ZCOL[z["id"]], lw=1.5, zorder=3, ls="--")
    for sec in c["sections"]:
        if sec["toS"] <= z["fromS"] or sec["fromS"] >= z["toS"]:
            continue
        i = min(int(np.searchsorted(s, max(sec["fromS"], z["fromS"]))), len(P) - 1)
        lab = f"{sec['fromS']:.0f} {sec['name'] or sec['highway']} [{sec['highway']}, {sec['lanes']}l, {sec['width']} m{', dual' if sec['dual'] else ''}{', RB r=' + str(sec['roundabout']['r']) if sec['roundabout'] else ''}{', ' + sec['surface'] if sec['surface'] else ''}]"
        ax.plot(P[i, 0], P[i, 1], "k|", ms=10, zorder=4)
        ax.text(P[i, 0] + 3, P[i, 1] + 3, lab, fontsize=7, zorder=6, bbox=dict(fc="white", ec="none", alpha=0.75, pad=0.5))
    T = np.asarray(c["trees"], float).reshape(-1, 5)
    sel = (T[:, 0] > mn[0]) & (T[:, 0] < mx[0]) & (T[:, 1] > mn[1]) & (T[:, 1] < mx[1])
    T = T[sel]
    ax.scatter(T[:, 0], T[:, 1], s=(T[:, 3] * 2.2) ** 2, c=np.where(T[:, 4] > 0, "orange", "forestgreen"), alpha=0.5, zorder=4, lw=0)
    for p in c["pois"]:
        if mn[0] < p["x"] < mx[0] and mn[1] < p["z"] < mx[1]:
            ax.plot(p["x"], p["z"], "r.", ms=6, zorder=5)
            ax.text(p["x"], p["z"], p["name"][:22], fontsize=5.5, color="darkred", zorder=5)
    for f in c["furniture"]:
        if mn[0] < f["x"] < mx[0] and mn[1] < f["z"] < mx[1]:
            ax.plot(f["x"], f["z"], marker={"bus_stop": "s", "traffic_signals": "P", "crossing": "x"}.get(f["type"], "."), color="navy", ms=4, zorder=5)
    for j in c["junctions"]:
        if z["fromS"] <= j["s"] < z["toS"]:
            ax.plot(j["x"], j["z"], "o", mfc="none", mec="m", ms=6, zorder=5)
    for lm in c["landmarks"]:
        if "x" in lm and mn[0] < lm["x"] < mx[0] and mn[1] < lm["z"] < mx[1]:
            ax.text(lm["x"], lm["z"], lm["name"] or lm["id"], fontsize=7, color="purple", weight="bold", zorder=7)
        for w in lm.get("walls", []):
            ax.plot(*pts(w["line"]).T, color="saddlebrown", lw=2.5, zorder=3)
    ax.set_xlim(mn[0], mx[0])
    ax.set_ylim(mn[1], mx[1])
    flip(ax)
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=plt.Normalize(0, 40))
    fig.colorbar(sm, ax=ax, shrink=0.5, label="building height (m)")
    ax.set_title(f"{z['id']}: s {z['fromS']}–{z['toS']} ({z['length']} m); red outline = building over the carriageway")
    fig.savefig(CACHE / f"zone-{z['id']}.png", bbox_inches="tight")
    plt.close(fig)


def profile_png(c, P, s):
    fig, ax = plt.subplots(figsize=(18, 5), dpi=100)
    ax.plot(s, c["route"]["ground"], color="0.6", lw=0.8, label="ground (DTM, deck on bridges)")
    ax.plot(s, P[:, 2], color="k", lw=1.5, label="route h (smoothed, ≤8 %)")
    for z in c["zones"]:
        ax.axvspan(z["fromS"], z["toS"], color=ZCOL[z["id"]], alpha=0.12)
        ax.text(z["fromS"] + 10, np.nanmax(P[:, 2]) + 1, z["id"], fontsize=8)
    for sec in c["sections"]:
        if sec["bridge"]:
            ax.axvspan(sec["fromS"], sec["toS"], color="blue", alpha=0.15)
    ax.set_xlabel("s (m)")
    ax.set_ylabel("h (m, relative to start)")
    ax.legend()
    fig.savefig(CACHE / "profile.png", bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    c, P, s = load()
    which = sys.argv[1:] or ["route", "profile"] + [z["id"] for z in c["zones"]]
    if "route" in which:
        route_png(c, P[:, :2], s)
    if "profile" in which:
        profile_png(c, P, s)
    for z in c["zones"]:
        if z["id"] in which:
            zone_png(c, P, s, z)


if __name__ == "__main__":
    main()
