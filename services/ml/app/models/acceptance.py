"""M4: will this workshop accept this offer?

Logistic regression first (its coefficients can be read and compared to the
simulator's ground truth), a LightGBM classifier second; the one with the better
validation Brier score wins, then isotonic calibration on the validation set.
"""
from __future__ import annotations

from typing import Any

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.preprocessing import StandardScaler

from ..baselines import SmoothedAcceptance

FEATURES = ["distance_km", "active_jobs", "load_ratio", "staff_count", "hour", "night", "weekday", "markup", "rank", "wk_rate"]
LINEAR = ["distance_km", "active_jobs", "night", "markup"]


def add_features(offers: pd.DataFrame, history: SmoothedAcceptance) -> pd.DataFrame:
    df = offers.copy()
    df["load_ratio"] = df["active_jobs"] / df["staff_count"].clip(lower=1)
    df["wk_rate"] = history.predict(df["workshop_id"])
    return df


class AcceptanceModel:
    name = "acceptance"

    def __init__(self) -> None:
        self.kind = ""
        self.scaler = StandardScaler()
        self.lr: LogisticRegression | None = None
        self.gbm: lgb.LGBMClassifier | None = None
        self.iso: IsotonicRegression | None = None
        self.history = SmoothedAcceptance()
        self.validation: dict[str, float] = {}

    def fit(self, train: pd.DataFrame, valid: pd.DataFrame) -> "AcceptanceModel":
        self.history.fit(train)
        tr, va = add_features(train, self.history), add_features(valid, self.history)
        y_tr = (tr["response"] == "accepted").astype(int)
        y_va = (va["response"] == "accepted").astype(int)

        Xl = self.scaler.fit_transform(tr[LINEAR])
        self.lr = LogisticRegression(C=1e3, max_iter=1000).fit(Xl, y_tr)
        p_lr = self.lr.predict_proba(self.scaler.transform(va[LINEAR]))[:, 1]

        self.gbm = lgb.LGBMClassifier(
            n_estimators=300, learning_rate=0.05, num_leaves=15, min_child_samples=40,
            subsample=0.8, subsample_freq=1, verbose=-1, random_state=7,
        ).fit(tr[FEATURES], y_tr)
        p_gbm = self.gbm.predict_proba(va[FEATURES])[:, 1]

        b_lr, b_gbm = brier_score_loss(y_va, p_lr), brier_score_loss(y_va, p_gbm)
        self.kind = "logistic" if b_lr <= b_gbm else "lightgbm"
        raw_va = p_lr if self.kind == "logistic" else p_gbm
        self.iso = IsotonicRegression(out_of_bounds="clip", y_min=0.001, y_max=0.999).fit(raw_va, y_va)
        self.validation = {"brier_logistic": float(b_lr), "brier_lightgbm": float(b_gbm), "chosen": self.kind}
        return self

    def _raw(self, df: pd.DataFrame) -> np.ndarray:
        if self.kind == "logistic":
            return self.lr.predict_proba(self.scaler.transform(df[LINEAR]))[:, 1]
        return self.gbm.predict_proba(df[FEATURES])[:, 1]

    def predict_proba(self, offers: pd.DataFrame) -> np.ndarray:
        df = add_features(offers, self.history) if "wk_rate" not in offers.columns else offers
        return self.iso.predict(self._raw(df))

    def coefficients(self) -> dict[str, float]:
        """Logistic coefficients in the original units, comparable to the simulator's truth."""
        w = self.lr.coef_[0] / self.scaler.scale_
        return {name: float(c) for name, c in zip(LINEAR, w)}


def evaluate(model: AcceptanceModel, test: pd.DataFrame) -> dict[str, Any]:
    y = (test["response"] == "accepted").astype(int).to_numpy()
    p = model.predict_proba(test)
    base = model.history.predict(test["workshop_id"])
    out = {
        "roc_auc": float(roc_auc_score(y, p)),
        "baseline_roc_auc": float(roc_auc_score(y, base)),
        "brier": float(brier_score_loss(y, p)),
        "baseline_brier": float(brier_score_loss(y, base)),
        "n": int(len(test)),
    }
    if "p_true" in test.columns:
        out["mean_abs_error_vs_true_probability"] = float(np.mean(np.abs(p - test["p_true"].to_numpy())))
    return out
