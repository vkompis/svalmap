#!/usr/bin/env python3
"""
Fetch Arctic sea-ice edge from Copernicus Marine (OSI SAF) and write GeoJSON
for MapLibre.

Product: SEAICE_GLO_SEAICE_L4_NRT_OBSERVATIONS_011_001
Dataset: osisaf_obs-si_glo_phy-siedge_nrt_nh-P1D

Ice edge classes (typical): 1=open water, 2=open ice, 3=closed ice.
We contour the open-water / ice boundary (between class 1 and >=2).

Credentials (env):
  COPERNICUSMARINE_SERVICE_USERNAME / COPERNICUSMARINE_SERVICE_PASSWORD
  (aliases: COPERNICUSMARINE_USERNAME / COPERNICUSMARINE_PASSWORD)
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
ENV_FILE = ROOT / ".env.local"
OUT_PATH = REPO / "data" / "source" / "overlays" / "ice-edge.geojson"
META_PATH = REPO / "data" / "source" / "overlays" / "ice-edge.meta.json"

# North Atlantic / Arctic monitoring box (matches AISStream AOI, extended north)
BBOX = {
    "minimum_longitude": -80.0,
    "maximum_longitude": 45.0,
    "minimum_latitude": 54.0,
    "maximum_latitude": 85.0,
}

DATASET_ID = "osisaf_obs-si_glo_phy-siedge_nrt_nh-P1D"


def load_env() -> None:
    if ENV_FILE.exists():
        load_dotenv(ENV_FILE, override=True)
    # Normalize aliases used by the toolbox
    user = os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME") or os.environ.get(
        "COPERNICUSMARINE_USERNAME"
    )
    pw = os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD") or os.environ.get(
        "COPERNICUSMARINE_PASSWORD"
    )
    if user:
        os.environ["COPERNICUSMARINE_SERVICE_USERNAME"] = user
    if pw:
        os.environ["COPERNICUSMARINE_SERVICE_PASSWORD"] = pw


def pick_ice_variable(ds) -> str:
    preferred = (
        "ice_edge",
        "sea_ice_edge",
        "siedge",
        "status_flag",
        "ice_conc",
        "sea_ice_concentration",
        "siconc",
    )
    names = list(ds.data_vars)
    lower = {n.lower(): n for n in names}
    for p in preferred:
        if p in lower:
            return lower[p]
    # Fallback: first 2D+ data var
    for n in names:
        if ds[n].ndim >= 2:
            return n
    raise RuntimeError(f"No suitable ice variable in {names}")


def latest_time_slice(da):
    if "time" not in da.dims:
        return da, None
    t = da["time"].values
    # Prefer last non-all-nan slice walking backwards a few days
    for i in range(len(t) - 1, max(-1, len(t) - 8), -1):
        sl = da.isel(time=i)
        vals = np.asarray(sl.values)
        if np.isfinite(vals).any():
            ts = np.datetime_as_string(t[i], unit="D")
            return sl, ts
    sl = da.isel(time=-1)
    ts = np.datetime_as_string(t[-1], unit="D")
    return sl, ts


def contours_to_geojson(lons, lats, field, levels, props_base) -> dict:
    """Build LineString features from matplotlib contour paths (no display needed)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    # meshgrid if 1D axes
    if lons.ndim == 1 and lats.ndim == 1:
        xx, yy = np.meshgrid(lons, lats)
    else:
        xx, yy = lons, lats

    fig, ax = plt.subplots()
    cs = ax.contour(xx, yy, field, levels=levels)
    features = []

    # Matplotlib ≥3.8: use allsegs; older: collections
    if hasattr(cs, "allsegs"):
        for level, segs in zip(cs.levels, cs.allsegs):
            for seg in segs:
                if seg is None or len(seg) < 2:
                    continue
                line = [
                    [float(x), float(y)]
                    for x, y in seg
                    if np.isfinite(x) and np.isfinite(y)
                ]
                if len(line) < 2:
                    continue
                features.append(
                    {
                        "type": "Feature",
                        "geometry": {"type": "LineString", "coordinates": line},
                        "properties": {**props_base, "level": float(level)},
                    }
                )
    else:
        for level, collection in zip(cs.levels, cs.collections):
            for path in collection.get_paths():
                coords = path.vertices
                if coords is None or len(coords) < 2:
                    continue
                line = [
                    [float(x), float(y)]
                    for x, y in coords
                    if np.isfinite(x) and np.isfinite(y)
                ]
                if len(line) < 2:
                    continue
                features.append(
                    {
                        "type": "Feature",
                        "geometry": {"type": "LineString", "coordinates": line},
                        "properties": {**props_base, "level": float(level)},
                    }
                )

    plt.close(fig)
    return {
        "type": "FeatureCollection",
        "features": features,
        "properties": props_base,
    }


def classify_edge_field(arr: np.ndarray) -> tuple[np.ndarray, list[float], str]:
    """
    Return (field, contour_levels, mode).
    - Classification edge (1/2/3): contour at 1.5 (water|ice)
    - Concentration 0–1 or 0–100: contour at 0.15 / 15
    """
    finite = arr[np.isfinite(arr)]
    if finite.size == 0:
        raise RuntimeError("Ice field has no finite values")

    vmax = float(np.nanmax(finite))
    vmin = float(np.nanmin(finite))
    uniq = np.unique(finite[~np.isnan(finite)])

    # Discrete edge classes
    if vmax <= 5 and len(uniq) <= 8:
        return arr.astype(float), [1.5], "ice_edge_class"

    # Fraction 0–1
    if vmax <= 1.5:
        return arr.astype(float), [0.15], "ice_conc_fraction"

    # Percent 0–100
    return arr.astype(float), [15.0], "ice_conc_percent"


def fetch_and_write() -> dict:
    import copernicusmarine

    load_env()
    user = os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME")
    if not user:
        raise SystemExit("Missing COPERNICUSMARINE_SERVICE_USERNAME")

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=5)

    print(f"[ice-edge] opening {DATASET_ID} …", flush=True)
    ds = copernicusmarine.open_dataset(
        dataset_id=DATASET_ID,
        minimum_longitude=BBOX["minimum_longitude"],
        maximum_longitude=BBOX["maximum_longitude"],
        minimum_latitude=BBOX["minimum_latitude"],
        maximum_latitude=BBOX["maximum_latitude"],
        start_datetime=start.strftime("%Y-%m-%d"),
        end_datetime=end.strftime("%Y-%m-%d"),
    )

    var = pick_ice_variable(ds)
    print(f"[ice-edge] variable={var} dims={ds[var].dims}", flush=True)
    da, time_str = latest_time_slice(ds[var])
    data = np.asarray(da.values, dtype=float)

    # Coordinate names vary
    lon_name = "longitude" if "longitude" in da.coords else "lon"
    lat_name = "latitude" if "latitude" in da.coords else "lat"
    if lon_name not in da.coords or lat_name not in da.coords:
        # try xc/yc polar stereo — project is harder; fail clearly
        raise RuntimeError(
            f"Expected lon/lat coords, got {list(da.coords)}. "
            "Dataset may be in polar stereographic — needs reprojection."
        )

    lons = np.asarray(da[lon_name].values, dtype=float)
    lats = np.asarray(da[lat_name].values, dtype=float)

    field, levels, mode = classify_edge_field(data)
    props = {
        "source": "Copernicus Marine / OSI SAF",
        "dataset_id": DATASET_ID,
        "variable": var,
        "mode": mode,
        "time": time_str,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    geojson = contours_to_geojson(lons, lats, field, levels, props)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(geojson))
    meta = {
        **props,
        "feature_count": len(geojson["features"]),
        "bbox": BBOX,
        "path": str(OUT_PATH),
    }
    META_PATH.write_text(json.dumps(meta, indent=2) + "\n")
    print(
        f"[ice-edge] wrote {len(geojson['features'])} features → {OUT_PATH} (time={time_str})",
        flush=True,
    )
    return meta


if __name__ == "__main__":
    try:
        fetch_and_write()
    except Exception as e:
        print(f"[ice-edge] FAILED: {e}", file=sys.stderr)
        raise
