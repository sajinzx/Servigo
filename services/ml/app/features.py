"""Feature construction shared by training and serving.

Anything that looks at history uses only rows strictly before the one being
described (expanding mean, shifted), so training features never leak the future.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import catalogue

BOOKING_NUMERIC = ["base_min", "base_price", "vehicle_age", "km_since_service", "hour", "weekday", "is_holiday"]
BOOKING_CATEGORICAL = ["service_code", "category", "vehicle_kind", "segment", "mode"]


def with_catalogue(bookings: pd.DataFrame) -> pd.DataFrame:
    df = bookings.copy()
    df["base_min"] = df["service_code"].map(catalogue.base_duration).astype(float)
    df["base_price"] = df["service_code"].map(catalogue.base_price).astype(float)
    df["expected_price"] = [catalogue.expected_price(c, s) for c, s in zip(df.service_code, df.segment)]
    df["is_holiday"] = df["is_holiday"].astype(int)
    return df


def add_workshop_history(completed: pd.DataFrame) -> pd.DataFrame:
    """Per-workshop running averages of how far jobs ran from the catalogue, as of just before each job."""
    df = completed.sort_values("created_at", kind="stable").copy()
    df["log_dur_ratio"] = np.log(df["duration_min"] / df["base_min"])
    df["log_price_ratio"] = np.log(df["final_price"] / df["expected_price"])
    g = df.groupby("workshop_id", sort=False)
    for col, out in (("log_dur_ratio", "wk_dur"), ("log_price_ratio", "wk_price")):
        df[out] = g[col].transform(lambda s: s.shift(1).expanding().mean())
    df["wk_n"] = g.cumcount()
    df[["wk_dur", "wk_price"]] = df[["wk_dur", "wk_price"]].fillna(0.0)
    return df


def workshop_snapshot(history: pd.DataFrame) -> dict[str, dict[str, float]]:
    """The values to use at serving time: each workshop's mean after all training rows."""
    g = history.groupby("workshop_id")
    snap = pd.DataFrame(
        {
            "wk_dur": g["log_dur_ratio"].mean(),
            "wk_price": g["log_price_ratio"].mean(),
            "wk_n": g.size(),
        }
    )
    return snap.to_dict(orient="index")


def categorical(df: pd.DataFrame, columns: list[str], universe: dict[str, list[str]]) -> pd.DataFrame:
    """Fixed category sets so training and serving always encode the same way."""
    out = df.copy()
    for c in columns:
        out[c] = pd.Categorical(out[c].astype(str), categories=universe[c])
    return out


UNIVERSE: dict[str, list[str]] = {
    "service_code": catalogue.CODES,
    "category": catalogue.CATEGORIES,
    "vehicle_kind": ["car", "bike"],
    "segment": catalogue.SEGMENTS,
    "mode": ["workshop", "doorstep"],
}
