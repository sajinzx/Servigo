"""Drift monitoring: Population Stability Index on the features that matter."""
from __future__ import annotations

import numpy as np
import pandas as pd

PSI_ALERT = 0.2


def psi(expected: pd.Series, actual: pd.Series, bins: int = 10) -> float:
    """PSI of `actual` against the `expected` (training) distribution.

    < 0.1 stable, 0.1-0.2 shifting, > 0.2 significant drift. Bin edges come from
    the expected data's quantiles; a small floor avoids log(0) for empty bins.
    """
    e = pd.to_numeric(expected, errors="coerce").dropna().to_numpy(dtype=float)
    a = pd.to_numeric(actual, errors="coerce").dropna().to_numpy(dtype=float)
    if len(e) == 0 or len(a) == 0:
        return float("nan")
    edges = np.unique(np.quantile(e, np.linspace(0, 1, bins + 1)))
    if len(edges) < 3:  # near-constant feature: compare share of the single value
        return float(abs((e == e[0]).mean() - (a == e[0]).mean()))
    edges[0], edges[-1] = -np.inf, np.inf
    pe = np.histogram(e, edges)[0] / len(e)
    pa = np.histogram(a, edges)[0] / len(a)
    pe, pa = np.clip(pe, 1e-4, None), np.clip(pa, 1e-4, None)
    return float(np.sum((pa - pe) * np.log(pa / pe)))


def drift_report(train: pd.DataFrame, recent: pd.DataFrame, features: list[str]) -> dict[str, dict[str, float | bool]]:
    out = {}
    for f in features:
        if f not in train.columns or f not in recent.columns:
            continue
        v = psi(train[f], recent[f])
        out[f] = {"psi": v, "alert": bool(v > PSI_ALERT)}
    return out
