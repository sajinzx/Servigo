"""Optional calibration from real data in data/raw/.

If the CarDekho CSV is present, derive median km per year and use it to scale the
simulator's driving distances. Without the file this returns the config
unchanged, and the caller records that no calibration was applied.
"""
from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pandas as pd

from .generate import SimConfig

# the simulator's built-in prior: ~30 km/day for cars = ~11,000 km/year
PRIOR_KM_PER_YEAR = 11_000.0


def calibrate(cfg: SimConfig, raw_dir: Path) -> tuple[SimConfig, dict]:
    path = raw_dir / "cardekho.csv"
    if not path.exists():
        return cfg, {"applied": False, "reason": f"{path.name} not found"}
    df = pd.read_csv(path)
    needed = {"year", "km_driven"}
    if not needed.issubset(df.columns):
        return cfg, {"applied": False, "reason": f"missing columns {sorted(needed - set(df.columns))}"}
    age = (2025 - df["year"]).clip(lower=1)
    per_year = (df["km_driven"] / age).clip(upper=60_000)
    median = float(per_year.median())
    scale = median / PRIOR_KM_PER_YEAR
    return replace(cfg, km_per_year_scale=cfg.km_per_year_scale * scale), {
        "applied": True,
        "source": path.name,
        "median_km_per_year": round(median, 0),
        "scale": round(scale, 3),
    }
