"""M2 (job duration) and M3 (price range): LightGBM on log ratios to the catalogue.

Predicting the log of (actual / catalogue) instead of the raw value keeps one
model good across a 15-minute chain tightening and a 4-hour clutch overhaul.
Quantile models give the range shown to the customer.
"""
from __future__ import annotations

from typing import Any

import lightgbm as lgb
import numpy as np
import pandas as pd

from .. import catalogue
from ..features import UNIVERSE, categorical

LGB_BASE = dict(n_estimators=400, learning_rate=0.05, num_leaves=31, min_child_samples=20,
                subsample=0.8, subsample_freq=1, colsample_bytree=0.9, verbose=-1, random_state=7)


def pinball(y: np.ndarray, q_pred: np.ndarray, alpha: float) -> float:
    d = y - q_pred
    return float(np.mean(np.maximum(alpha * d, (alpha - 1) * d)))


class _LogRatioModel:
    """Shared machinery: mean + 10th/50th/90th percentile models of a log ratio."""

    numeric: list[str] = []
    categorical_cols: list[str] = []
    target: str = ""
    history_col: str = ""
    name = ""

    def __init__(self) -> None:
        self.models: dict[str, lgb.LGBMRegressor] = {}
        self.workshop_stats: dict[str, dict[str, float]] = {}
        self.feature_names: list[str] = []

    def _x(self, df: pd.DataFrame) -> pd.DataFrame:
        x = df[self.numeric + self.categorical_cols].copy()
        return categorical(x, self.categorical_cols, UNIVERSE)

    def fit(self, train: pd.DataFrame, snapshot: dict[str, dict[str, float]]) -> "_LogRatioModel":
        X, y = self._x(train), train[self.target].to_numpy()
        self.feature_names = list(X.columns)
        self.models["mean"] = lgb.LGBMRegressor(objective="regression", **LGB_BASE).fit(X, y)
        for a in (0.1, 0.5, 0.9):
            self.models[f"q{int(a * 100)}"] = lgb.LGBMRegressor(objective="quantile", alpha=a, **LGB_BASE).fit(X, y)
        self.workshop_stats = snapshot
        return self

    def predict_log(self, df: pd.DataFrame) -> dict[str, np.ndarray]:
        X = self._x(df)
        out = {k: m.predict(X) for k, m in self.models.items()}
        # quantiles from separate models can cross; sort them so the band is always valid
        stacked = np.sort(np.vstack([out["q10"], out["q50"], out["q90"]]), axis=0)
        out["q10"], out["q50"], out["q90"] = stacked
        return out

    def feature_importance(self) -> dict[str, float]:
        m = self.models["mean"]
        imp = m.booster_.feature_importance(importance_type="gain")
        total = float(imp.sum()) or 1.0
        return {n: float(v) / total for n, v in sorted(zip(self.feature_names, imp), key=lambda x: -x[1])}

    def explain(self, df: pd.DataFrame, top: int = 3) -> list[list[tuple[str, float]]]:
        """Top contributing features per row (LightGBM's native SHAP values)."""
        X = self._x(df)
        contrib = self.models["mean"].booster_.predict(X, pred_contrib=True)[:, :-1]
        out = []
        for row in contrib:
            idx = np.argsort(-np.abs(row))[:top]
            out.append([(self.feature_names[i], float(row[i])) for i in idx])
        return out

    def with_workshop_stats(self, df: pd.DataFrame, key: str) -> pd.DataFrame:
        d = df.copy()
        d[self.history_col] = d["workshop_id"].map(
            lambda w: self.workshop_stats.get(w, {}).get(key, 0.0) if isinstance(w, str) else 0.0
        )
        return d


class DurationModel(_LogRatioModel):
    name = "duration"
    numeric = ["base_min", "vehicle_age", "km_since_service", "hour", "weekday", "wk_dur"]
    categorical_cols = ["service_code", "category", "vehicle_kind", "segment"]
    target = "log_dur_ratio"
    history_col = "wk_dur"

    def predict_minutes(self, df: pd.DataFrame) -> dict[str, np.ndarray]:
        d = df if self.history_col in df.columns else self.with_workshop_stats(df, "wk_dur")
        p = self.predict_log(d)
        base = d["base_min"].to_numpy(dtype=float)
        # E[exp(x)] for the mean model is a little above exp(E[x]); the median is the honest point estimate
        return {
            "minutes": base * np.exp(p["q50"]),
            "low": base * np.exp(p["q10"]),
            "high": base * np.exp(p["q90"]),
        }


class PriceModel(_LogRatioModel):
    name = "price"
    numeric = ["base_price", "vehicle_age", "km_since_service", "hour", "weekday", "wk_price"]
    categorical_cols = ["service_code", "category", "vehicle_kind", "segment"]
    target = "log_price_ratio"
    history_col = "wk_price"

    def predict_price(self, df: pd.DataFrame) -> dict[str, np.ndarray]:
        d = df if self.history_col in df.columns else self.with_workshop_stats(df, "wk_price")
        p = self.predict_log(d)
        exp = d["expected_price"].to_numpy(dtype=float)
        return {
            "median": exp * np.exp(p["q50"]),
            "low": exp * np.exp(p["q10"]),
            "high": exp * np.exp(p["q90"]),
        }


def evaluate_duration(model: DurationModel, test: pd.DataFrame) -> dict[str, Any]:
    p = model.predict_minutes(test)
    y = test["duration_min"].to_numpy()
    base = test["base_min"].to_numpy(dtype=float)
    return {
        "mae_min": float(np.mean(np.abs(y - p["minutes"]))),
        "baseline_mae_min": float(np.mean(np.abs(y - base))),
        "coverage_80": float(np.mean((y >= p["low"]) & (y <= p["high"]))),
        "n": int(len(test)),
    }


def evaluate_price(model: PriceModel, test: pd.DataFrame) -> dict[str, Any]:
    p = model.predict_price(test)
    y = test["final_price"].to_numpy()
    exp = test["expected_price"].to_numpy(dtype=float)
    lo_b, hi_b = test["quote_low"].to_numpy(), test["quote_high"].to_numpy()
    model_loss = np.mean([pinball(y, p["low"], 0.1), pinball(y, p["median"], 0.5), pinball(y, p["high"], 0.9)])
    base_loss = np.mean([pinball(y, lo_b, 0.1), pinball(y, exp, 0.5), pinball(y, hi_b, 0.9)])
    return {
        "pinball_loss": float(model_loss),
        "baseline_pinball_loss": float(base_loss),
        "coverage_80": float(np.mean((y >= p["low"]) & (y <= p["high"]))),
        "baseline_coverage": float(np.mean((y >= lo_b) & (y <= hi_b))),
        "mean_band_width": float(np.mean(p["high"] - p["low"])),
        "baseline_band_width": float(np.mean(hi_b - lo_b)),
        "n": int(len(test)),
    }
