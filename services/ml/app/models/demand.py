"""M5: demand forecast per H3 cell, service category and hour, a week ahead.

Because the forecast is made once a week for the whole next week, only lags of a
week or more are valid features. The baseline is "same hour last week".
"""
from __future__ import annotations

from typing import Any

import holidays
import lightgbm as lgb
import numpy as np
import pandas as pd

from ..baselines import wape

HORIZON_H = 168
LAGS = [168, 336, 504, 672]
FEATURES = ["hour", "weekday", "is_holiday", "lag_168", "lag_336", "lag_504", "lag_672", "mean_4w", "cell_code", "cat_code"]


def build_panel(bookings: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    """Hourly counts for every (cell, category) pair that ever has demand, zeros included."""
    b = bookings[["created_at", "h3_cell", "category"]].copy()
    b["hour_ts"] = b["created_at"].dt.floor("h")
    b = b[(b.hour_ts >= start) & (b.hour_ts < end)]
    counts = b.groupby(["h3_cell", "category", "hour_ts"]).size().rename("y").reset_index()
    pairs = counts[["h3_cell", "category"]].drop_duplicates()
    hours = pd.date_range(start, end - pd.Timedelta(hours=1), freq="h")
    grid = pairs.merge(pd.DataFrame({"hour_ts": hours}), how="cross")
    panel = grid.merge(counts, how="left", on=["h3_cell", "category", "hour_ts"])
    panel["y"] = panel["y"].fillna(0).astype("float32")
    return panel.sort_values(["h3_cell", "category", "hour_ts"], kind="stable").reset_index(drop=True)


def add_features(panel: pd.DataFrame, cell_codes: dict[str, int], cat_codes: dict[str, int]) -> pd.DataFrame:
    df = panel.copy()
    g = df.groupby(["h3_cell", "category"], sort=False)["y"]
    for lag in LAGS:
        df[f"lag_{lag}"] = g.shift(lag)
    df["mean_4w"] = df[[f"lag_{lag}" for lag in LAGS]].mean(axis=1)
    df["hour"] = df["hour_ts"].dt.hour
    df["weekday"] = df["hour_ts"].dt.weekday
    years = sorted(df["hour_ts"].dt.year.unique().tolist())
    hol = holidays.India(years=years, subdiv="TN")
    days = df["hour_ts"].dt.date
    df["is_holiday"] = days.map(lambda d: int(d in hol))
    df["cell_code"] = df["h3_cell"].map(cell_codes).fillna(-1).astype(int)
    df["cat_code"] = df["category"].map(cat_codes).fillna(-1).astype(int)
    return df


class DemandForecaster:
    name = "demand"

    def __init__(self) -> None:
        self.model: lgb.LGBMRegressor | None = None
        self.cell_codes: dict[str, int] = {}
        self.cat_codes: dict[str, int] = {}

    def fit(self, panel: pd.DataFrame, train_end: pd.Timestamp, train_weeks: int = 16) -> "DemandForecaster":
        self.cell_codes = {c: i for i, c in enumerate(sorted(panel["h3_cell"].unique()))}
        self.cat_codes = {c: i for i, c in enumerate(sorted(panel["category"].unique()))}
        feats = add_features(panel, self.cell_codes, self.cat_codes)
        lo = train_end - pd.Timedelta(weeks=train_weeks)
        tr = feats[(feats.hour_ts >= lo) & (feats.hour_ts < train_end)].dropna(subset=["lag_672"])
        self.model = lgb.LGBMRegressor(
            objective="poisson", n_estimators=300, learning_rate=0.05, num_leaves=31,
            min_child_samples=50, subsample=0.8, subsample_freq=1, verbose=-1, random_state=7,
        ).fit(tr[FEATURES], tr["y"], categorical_feature=["cell_code", "cat_code"])
        return self

    def predict_frame(self, feats: pd.DataFrame) -> np.ndarray:
        return np.clip(self.model.predict(feats[FEATURES].fillna(0)), 0, None)

    def forecast_next_week(self, panel: pd.DataFrame, origin: pd.Timestamp) -> pd.DataFrame:
        """Rows for [origin, origin + 7 days): predicted count with a rough 80% band."""
        future_hours = pd.date_range(origin, origin + pd.Timedelta(hours=HORIZON_H - 1), freq="h")
        pairs = panel[["h3_cell", "category"]].drop_duplicates()
        future = pairs.merge(pd.DataFrame({"hour_ts": future_hours}), how="cross")
        future["y"] = np.nan
        combined = pd.concat([panel[panel.hour_ts < origin], future], ignore_index=True)
        combined = combined.sort_values(["h3_cell", "category", "hour_ts"], kind="stable").reset_index(drop=True)
        feats = add_features(combined, self.cell_codes, self.cat_codes)
        out = feats[feats.hour_ts >= origin].copy()
        yhat = self.predict_frame(out)
        out["yhat"] = yhat
        # Poisson-ish interval: sqrt scaling, floored at zero
        out["yhat_lo"] = np.clip(yhat - 1.28 * np.sqrt(np.maximum(yhat, 0.05)), 0, None)
        out["yhat_hi"] = yhat + 1.28 * np.sqrt(np.maximum(yhat, 0.05))
        return out[["h3_cell", "category", "hour_ts", "yhat", "yhat_lo", "yhat_hi"]].reset_index(drop=True)


def evaluate(model: DemandForecaster, panel: pd.DataFrame, test_start: pd.Timestamp, test_end: pd.Timestamp) -> dict[str, Any]:
    feats = add_features(panel, model.cell_codes, model.cat_codes)
    te = feats[(feats.hour_ts >= test_start) & (feats.hour_ts < test_end)].dropna(subset=["lag_672"])
    actual = te["y"].to_numpy()
    pred = model.predict_frame(te)
    base = te["lag_168"].to_numpy()

    # hourly counts per (cell, category) are mostly 0 or 1, so WAPE at that grain is dominated by
    # Poisson noise for any forecaster; the admin heatmap works at cell x day, so report that too
    daily = te.assign(pred=pred, base=base, day=te["hour_ts"].dt.floor("D")).groupby(["h3_cell", "day"])[["y", "pred", "base"]].sum()
    return {
        "wape": wape(actual, pred),
        "baseline_wape": wape(actual, base),
        "wape_cell_day": wape(daily["y"].to_numpy(), daily["pred"].to_numpy()),
        "baseline_wape_cell_day": wape(daily["y"].to_numpy(), daily["base"].to_numpy()),
        "n": int(len(te)),
        "total_actual": float(actual.sum()),
    }
