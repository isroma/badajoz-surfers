"""PNOA-LiDAR surface/terrain rasters (EPSG:25829, 2 m) and the Sentinel-2 NDVI raster, read-only."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.windows import from_bounds

LIDAR_DIR = Path("/Users/81031694/Claude/sol-y-cerveza/pipeline/.cache")
DSM = LIDAR_DIR / "badajoz_dsm.tif"
DTM = LIDAR_DIR / "badajoz_dtm.tif"
DSM_LEAFOFF = LIDAR_DIR / "badajoz_dsm_leafoff.tif"


class Raster:
    """A window of a single-band raster loaded in memory, sampled in its own CRS."""

    def __init__(self, path: Path, bounds: tuple[float, float, float, float], band: int = 1) -> None:
        with rasterio.open(path) as d:
            win = from_bounds(*bounds, transform=d.transform).round_offsets().round_lengths()
            self.a = d.read(band, window=win).astype(np.float32)
            self.t = d.window_transform(win)
            self.crs = d.crs
            nd = d.nodata
        if nd is not None:
            self.a[self.a == nd] = np.nan
        self.res = self.t.a

    def rc(self, e: np.ndarray, n: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        c = (np.asarray(e) - self.t.c) / self.t.a
        r = (np.asarray(n) - self.t.f) / self.t.e
        return r, c

    def sample(self, e: np.ndarray, n: np.ndarray) -> np.ndarray:
        """Bilinear sample; NaN outside."""
        r, c = self.rc(e, n)
        r, c = r - 0.5, c - 0.5
        r0, c0 = np.floor(r).astype(int), np.floor(c).astype(int)
        fr, fc = r - r0, c - c0
        H, W = self.a.shape
        ok = (r0 >= 0) & (c0 >= 0) & (r0 < H - 1) & (c0 < W - 1)
        r0c, c0c = np.clip(r0, 0, H - 2), np.clip(c0, 0, W - 2)
        a = self.a
        v = (a[r0c, c0c] * (1 - fr) * (1 - fc) + a[r0c + 1, c0c] * fr * (1 - fc)
             + a[r0c, c0c + 1] * (1 - fr) * fc + a[r0c + 1, c0c + 1] * fr * fc)
        return np.where(ok, v, np.nan)

    def mask(self, geoms_utm: list, value: int = 1, all_touched: bool = False) -> np.ndarray:
        return rasterize([(g, value) for g in geoms_utm], out_shape=self.a.shape, transform=self.t,
                         fill=0, dtype=np.uint8, all_touched=all_touched)


class Ndvi:
    """Sentinel-2 NDVI (EPSG:32629, 10 m); band 1 is used."""

    def __init__(self, bounds_25829: tuple[float, float, float, float]) -> None:
        paths = sorted(LIDAR_DIR.glob("sentinel2_ndvi_2025_*.tif"))
        self.ok = bool(paths)
        if not self.ok:
            return
        tr = Transformer.from_crs("EPSG:25829", "EPSG:32629", always_xy=True)
        e0, n0 = tr.transform(bounds_25829[0], bounds_25829[1])
        e1, n1 = tr.transform(bounds_25829[2], bounds_25829[3])
        self.r = Raster(paths[0], (min(e0, e1) - 50, min(n0, n1) - 50, max(e0, e1) + 50, max(n0, n1) + 50))
        self.tr = tr
        self.path = paths[0]

    def sample(self, e: np.ndarray, n: np.ndarray) -> np.ndarray:
        if not self.ok:
            return np.full(np.shape(e), np.nan)
        a, b = self.tr.transform(e, n)
        return self.r.sample(np.asarray(a), np.asarray(b))
