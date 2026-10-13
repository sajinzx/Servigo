"""M7 (optional): flag unusual bookings for the admin review queue.

Isolation Forest on how far a job strayed from its quote, its expected duration
and the usual number of offers. There is no ground truth in production, so the
simulator's large price surprises (final price more than 1.5x the top of the
quote) stand in for hand-labelled cases to compute precision@k.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

FEATURES = ["price_vs_quote_high", "duration_ratio", "n_offers", "wait_min"]


def to_features(completed: pd.DataFrame) -> pd.DataFrame:
    f = pd.DataFrame(index=completed.index)
    f["price_vs_quote_high"] = completed["final_price"] / completed["quote_high"]
    f["duration_ratio"] = completed["duration_min"] / completed["base_min"]
    f["n_offers"] = completed["n_offers"]
    f["wait_min"] = completed["wait_min"].fillna(completed["wait_min"].median())
    return f


class AnomalyModel:
    name = "anomaly"

    def __init__(self, contamination: float = 0.05) -> None:
        self.forest = IsolationForest(n_estimators=200, contamination=contamination, random_state=7)

    def fit(self, completed: pd.DataFrame) -> "AnomalyModel":
        self.forest.fit(to_features(completed)[FEATURES])
        return self

    def score(self, completed: pd.DataFrame) -> np.ndarray:
        """Higher = more unusual."""
        return -self.forest.score_samples(to_features(completed)[FEATURES])


def evaluate(model: AnomalyModel, test: pd.DataFrame, k: int = 100) -> dict[str, Any]:
    truth = (test["final_price"] / test["quote_high"] > 1.5).to_numpy()
    s = model.score(test)
    top = np.argsort(-s)[:k]
    rng = np.random.default_rng(7)
    random_top = rng.choice(len(test), size=min(k, len(test)), replace=False)
    return {
        "precision_at_k": float(truth[top].mean()),
        "random_precision_at_k": float(truth[random_top].mean()),
        "k": int(min(k, len(test))),
        "base_rate": float(truth.mean()),
    }
