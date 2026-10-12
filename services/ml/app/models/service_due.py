"""M6: when is this vehicle due for service, and how likely is it within 30 days?

Survival analysis on the gaps between general/oil services. A vehicle that has
not been serviced yet at the end of the data contributes a censored interval,
which is exactly what survival models are for.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from lifelines import CoxPHFitter, WeibullAFTFitter
from lifelines.utils import concordance_index

from ..baselines import interval_rule_days

COVARIATES = ["km_per_day", "age_years", "is_car"]
SERVICE_CATEGORIES = {"general", "oil"}


def build_intervals(bookings: pd.DataFrame, vehicles: pd.DataFrame, data_start: pd.Timestamp, data_end: pd.Timestamp) -> pd.DataFrame:
    """One row per service interval: days since the previous service, and whether it ended in a service."""
    v = vehicles.set_index("vehicle_id")
    svc = bookings[(bookings.status == "completed") & bookings.category.isin(SERVICE_CATEGORIES)]
    svc = svc.sort_values("created_at", kind="stable")
    rows = []
    for vid, grp in svc.groupby("vehicle_id", sort=False):
        if vid not in v.index:
            continue
        info = v.loc[vid]
        # the vehicle was last serviced `initial_days_since_service` days before the data starts
        prev = data_start - pd.Timedelta(days=float(info["initial_days_since_service"]))
        for t in grp["created_at"]:
            rows.append((vid, (t - prev).total_seconds() / 86400, 1, t))
            prev = t
        rows.append((vid, (data_end - prev).total_seconds() / 86400, 0, data_end))
    # vehicles that never had a service in the window are censored from the start
    seen = set(r[0] for r in rows)
    for vid, info in v.iterrows():
        if vid not in seen:
            prev = data_start - pd.Timedelta(days=float(info["initial_days_since_service"]))
            rows.append((vid, (data_end - prev).total_seconds() / 86400, 0, data_end))

    iv = pd.DataFrame(rows, columns=["vehicle_id", "duration", "event", "ended_at"])
    iv = iv[iv.duration > 0].merge(
        vehicles[["vehicle_id", "km_per_day", "age_years", "kind"]], on="vehicle_id", how="left"
    )
    iv["is_car"] = (iv["kind"] == "car").astype(int)
    return iv


class ServiceDueModel:
    name = "service_due"

    def __init__(self) -> None:
        self.weibull = WeibullAFTFitter()
        self.cox = CoxPHFitter(penalizer=0.01)
        self.use = "weibull"

    def fit(self, intervals: pd.DataFrame) -> "ServiceDueModel":
        cols = COVARIATES + ["duration", "event"]
        d = intervals[cols].replace([np.inf, -np.inf], np.nan).dropna()
        d = d[d.duration > 0.5]
        self.weibull.fit(d, duration_col="duration", event_col="event")
        self.cox.fit(d, duration_col="duration", event_col="event")
        return self

    def median_days(self, df: pd.DataFrame) -> np.ndarray:
        return self.weibull.predict_median(df[COVARIATES]).to_numpy(dtype=float)

    def prob_due(self, df: pd.DataFrame, elapsed_days: np.ndarray, within_days: float = 30.0) -> np.ndarray:
        """P(service falls in the next `within_days` | no service yet after `elapsed_days`)."""
        times = np.vstack([elapsed_days, elapsed_days + within_days])
        out = np.zeros(len(df))
        for i, (_, row) in enumerate(df[COVARIATES].iterrows()):
            s = self.weibull.predict_survival_function(row.to_frame().T, times=[times[0][i], times[1][i]])
            s0, s1 = float(s.iloc[0, 0]), float(s.iloc[1, 0])
            out[i] = 1.0 - s1 / s0 if s0 > 1e-9 else 1.0
        return np.clip(out, 0.0, 1.0)

    def coefficients(self) -> dict[str, float]:
        return {str(k[1]): float(v) for k, v in self.weibull.params_.items() if k[0] == "lambda_"}


def evaluate(model: ServiceDueModel, test: pd.DataFrame) -> dict[str, Any]:
    t = test.replace([np.inf, -np.inf], np.nan).dropna(subset=COVARIATES + ["duration"])
    pred = model.median_days(t)
    base = interval_rule_days(t["km_per_day"].to_numpy())
    dur, ev = t["duration"].to_numpy(), t["event"].to_numpy()
    observed = ev == 1

    def c_index(scores: np.ndarray) -> float:
        try:
            return float(concordance_index(dur, scores, ev))
        except ZeroDivisionError:  # no comparable pairs
            return float("nan")

    return {
        "concordance": c_index(pred),
        "baseline_concordance": c_index(base),
        "mae_days": float(np.mean(np.abs(dur[observed] - pred[observed]))) if observed.any() else float("nan"),
        "baseline_mae_days": float(np.mean(np.abs(dur[observed] - base[observed]))) if observed.any() else float("nan"),
        "n": int(len(t)),
        "n_events": int(observed.sum()),
    }
