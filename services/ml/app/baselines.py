"""Rule-based baselines. Every model ships behind one of these and replaces it only
after beating it on a held-out, time-ordered test set."""
from __future__ import annotations

import re

import numpy as np
import pandas as pd

from . import catalogue

# ---- M1: keyword rules ------------------------------------------------------

# category -> keywords (English, Tanglish, Hinglish stems). Deliberately simple, as a
# hand-written rule set would be.
KEYWORDS: dict[str, list[str]] = {
    "brakes": ["brake", "braking", "pidikkala", "lagane"],
    "oil": ["oil", "maathanum", "badalna"],
    "ac": ["ac ", "air condition", "cooling", "thanda", "gas"],
    "tyres": ["tyre", "tire", "puncture", "flat", "alignment", "pulls", "rotation"],
    "clutch": ["clutch", "gear"],
    "electrical": ["battery", "headlight", "horn", "light", "self start", "electrical"],
    "body": ["dent", "scratch", "paint", "bumper"],
    "wash": ["wash", "vacuum", "dusty", "mud", "safai", "dhulai"],
    "engine": ["engine", "carburetor", "mileage", "tuning", "knock"],
    "general": ["service", "maintenance", "chain", "periodic"],
}


def keyword_triage(text: str, vehicle_kind: str, k: int = 3) -> list[str]:
    """Rank the services for this vehicle kind by how many keywords of their category appear."""
    t = f" {text.lower()} "
    scores: dict[str, int] = {}
    for cat, words in KEYWORDS.items():
        scores[cat] = sum(1 for w in words if w in t)
    codes = catalogue.codes_for_kind(vehicle_kind)
    ranked = sorted(
        codes,
        key=lambda c: (-scores.get(catalogue.category(c), 0), c),
    )
    return ranked[:k]


# ---- M2 / M3 ----------------------------------------------------------------

def duration_baseline(codes: pd.Series) -> np.ndarray:
    return codes.map(catalogue.base_duration).to_numpy(dtype=float)


def price_baseline(codes: pd.Series, segments: pd.Series) -> np.ndarray:
    return np.array([catalogue.expected_price(c, s) for c, s in zip(codes, segments)])


# ---- M4 ---------------------------------------------------------------------

class SmoothedAcceptance:
    """Per-workshop acceptance rate, shrunk towards the platform mean (prior weight 10)."""

    def __init__(self, prior_weight: float = 10.0):
        self.prior_weight = prior_weight
        self.prior = 0.6
        self.rates: dict[str, float] = {}

    def fit(self, offers: pd.DataFrame) -> "SmoothedAcceptance":
        y = (offers["response"] == "accepted").astype(float)
        self.prior = float(y.mean()) if len(y) else 0.6
        g = pd.DataFrame({"w": offers["workshop_id"].values, "y": y.values}).groupby("w")["y"].agg(["sum", "count"])
        self.rates = ((g["sum"] + self.prior_weight * self.prior) / (g["count"] + self.prior_weight)).to_dict()
        return self

    def predict(self, workshop_ids: pd.Series) -> np.ndarray:
        return workshop_ids.map(self.rates).fillna(self.prior).to_numpy(dtype=float)


# ---- M5 ---------------------------------------------------------------------

def seasonal_naive(series: pd.DataFrame, horizon_hours: int = 168) -> pd.Series:
    """Forecast = the same hour one week earlier. `series` has columns key, hour_ts, y."""
    s = series.copy()
    s["target_ts"] = s["hour_ts"] + pd.Timedelta(hours=horizon_hours)
    return s.set_index(["key", "target_ts"])["y"]


# ---- M6 ---------------------------------------------------------------------

def interval_rule_days(km_per_day: np.ndarray, km_interval: float = 5000.0, max_days: float = 180.0) -> np.ndarray:
    """Service every 5,000 km or 6 months, whichever comes first."""
    return np.minimum(max_days, km_interval / np.maximum(km_per_day, 1e-6))


def wape(actual: np.ndarray, predicted: np.ndarray) -> float:
    denom = np.abs(actual).sum()
    return float(np.abs(actual - predicted).sum() / denom) if denom else float("nan")


def normalise_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()
