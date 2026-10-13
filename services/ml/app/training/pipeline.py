"""Train every model on a dataset, compare with its baseline on a time-ordered test
split, and promote only winners.

    python -m app.training.pipeline --data ../../data/generated/chennai --out artifacts
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd

from .. import baselines, catalogue
from ..data import load_tables, time_split
from ..features import add_workshop_history, with_catalogue, workshop_snapshot
from ..models import acceptance, anomaly, demand, service_due
from ..models.tabular import DurationModel, PriceModel, evaluate_duration, evaluate_price
from ..models.triage import TriageModel, evaluate_baseline
from ..registry import Registry
from .cards import write_card

MODELS = ["triage", "duration", "price", "acceptance", "demand", "service_due", "anomaly"]


def _prepare(tables: dict[str, pd.DataFrame]) -> dict[str, Any]:
    b = with_catalogue(tables["bookings"])
    b = b.merge(tables["workshops"][["workshop_id", "staff_count", "markup"]], on="workshop_id", how="left")
    completed = b[b.status == "completed"].copy()
    history = add_workshop_history(completed)
    return {"bookings": b, "completed": completed, "history": history}


def _finish(
    reg: Registry,
    name: str,
    obj: Any,
    metrics: dict[str, Any],
    metric: str,
    higher_is_better: bool,
    baseline_key: str,
    out_dir: Path,
    notes: dict[str, Any],
) -> dict[str, Any]:
    version = Registry.new_version()
    score, base = float(metrics[metric]), float(metrics[baseline_key])
    reg.save(name, version, obj, {**metrics, "version": version})
    ok, why = reg.promote_if_better(name, version, metric, score, base, higher_is_better)
    metrics = {**metrics, "version": version, "promotion": {
        "promoted": ok, "reason": why, "metric": metric, "score": score,
        "baseline_score": base, "higher_is_better": higher_is_better}}
    reg.save(name, version, obj, metrics)
    write_card(out_dir, name, metrics, notes)
    print(f"{name:12s} {metric}={score:.4f} baseline={base:.4f} -> {why}")
    return metrics


def train_triage(data, reg, out_dir):
    b = data["bookings"].sort_values("created_at", kind="stable")
    tr, va, te = time_split(b, "created_at")
    tr = pd.concat([tr, va])
    m = TriageModel().fit(tr.symptom_text, tr.vehicle_kind, tr.service_code)
    res = m.evaluate(te.symptom_text, te.vehicle_kind, te.service_code)
    base = evaluate_baseline(te.symptom_text, te.vehicle_kind, te.service_code)
    metrics = {**res, "baseline_macro_f1": base["macro_f1"], "baseline_top3_accuracy": base["top3_accuracy"], "n_test": len(te)}
    return _finish(reg, "triage", m, metrics, "top3_accuracy", True, "baseline_top3_accuracy", out_dir,
                   {"algorithm": "TF-IDF (word + char n-grams) + logistic regression", "baseline": "keyword rules"})


def train_duration(data, reg, out_dir):
    h = data["history"]
    tr, va, te = time_split(h, "created_at")
    tr = pd.concat([tr, va])
    m = DurationModel().fit(tr, workshop_snapshot(h[h.created_at <= tr.created_at.max()]))
    res = evaluate_duration(m, te)
    metrics = {"mae": res["mae_min"], "baseline_mae": res["baseline_mae_min"], "coverage_80": res["coverage_80"], "n_test": res["n"]}
    return _finish(reg, "duration", m, metrics, "mae", False, "baseline_mae", out_dir,
                   {"algorithm": "LightGBM on log(actual / catalogue minutes), plus 10th/90th percentile models",
                    "baseline": "catalogue base_duration_min", "unit": "minutes",
                    "importance": m.feature_importance()})


def train_price(data, reg, out_dir):
    h = data["history"]
    tr, va, te = time_split(h, "created_at")
    tr = pd.concat([tr, va])
    m = PriceModel().fit(tr, workshop_snapshot(h[h.created_at <= tr.created_at.max()]))
    res = evaluate_price(m, te)
    metrics = {
        "pinball_loss": res["pinball_loss"], "baseline_pinball_loss": res["baseline_pinball_loss"],
        "coverage_80": res["coverage_80"], "baseline_coverage_80": res["baseline_coverage"],
        "mean_band_width": res["mean_band_width"], "baseline_band_width": res["baseline_band_width"], "n_test": res["n"],
    }
    return _finish(reg, "price", m, metrics, "pinball_loss", False, "baseline_pinball_loss", out_dir,
                   {"algorithm": "LightGBM quantile regression (0.1 / 0.5 / 0.9) on log(price / catalogue)",
                    "baseline": "catalogue price x segment factor x GST, with the +-band of the quote",
                    "unit": "rupees", "importance": m.feature_importance()})


def train_acceptance(data, reg, out_dir, tables):
    offers = tables["offers"].sort_values("offered_at", kind="stable")
    offers = offers.merge(tables["workshops"][["workshop_id"]], on="workshop_id", how="left")
    tr, va, te = time_split(offers, "offered_at")
    m = acceptance.AcceptanceModel().fit(tr, va)
    res = acceptance.evaluate(m, te)
    metrics = {**res, "chosen": m.validation["chosen"], "coefficients": m.coefficients()}
    truth_path = Path(tables.get("_truth_path", ""))
    if truth_path.exists():
        truth = json.loads(truth_path.read_text())["rules"]["acceptance_logit"]
        metrics["true_coefficients"] = {
            "distance_km": truth["per_km"], "active_jobs": truth["per_active_job"],
            "night": truth["night"], "markup": truth["per_markup_point"],
        }
    return _finish(reg, "acceptance", m, metrics, "roc_auc", True, "baseline_roc_auc", out_dir,
                   {"algorithm": "logistic regression vs LightGBM (better validation Brier), isotonic calibration",
                    "baseline": "smoothed per-workshop acceptance rate"})


def train_demand(data, reg, out_dir):
    b = data["bookings"]
    start = b.created_at.min().floor("D")
    end = b.created_at.max().ceil("D")
    panel = demand.build_panel(b, start, end)
    test_end = end
    test_start = end - pd.Timedelta(weeks=4)
    m = demand.DemandForecaster().fit(panel, train_end=test_start, train_weeks=16)
    res = demand.evaluate(m, panel, test_start, test_end)
    return _finish(reg, "demand", m,
                   {"wape": res["wape"], "baseline_wape": res["baseline_wape"],
                    "wape_cell_day": res["wape_cell_day"], "baseline_wape_cell_day": res["baseline_wape_cell_day"],
                    "n_test": res["n"]},
                   "wape", False, "baseline_wape", out_dir,
                   {"algorithm": "LightGBM (Poisson) with weekly lag features per H3 cell and category",
                    "baseline": "same hour last week", "unit": "bookings per hour"})


def train_service_due(data, reg, out_dir, tables):
    b, v = data["bookings"], tables["vehicles"]
    t0, t1 = b.created_at.min().floor("D"), b.created_at.max().ceil("D")
    # survival split: fit on what was observable at the cutoff (open intervals censored there),
    # test on intervals that end after it
    cutoff = t0 + (t1 - t0) * 0.7
    train_iv = service_due.build_intervals(b[b.created_at <= cutoff], v, t0, cutoff)
    full_iv = service_due.build_intervals(b, v, t0, t1)
    test_iv = full_iv[full_iv.ended_at > cutoff]
    m = service_due.ServiceDueModel().fit(train_iv)
    res = service_due.evaluate(m, test_iv)
    metrics = {"concordance": res["concordance"], "baseline_concordance": res["baseline_concordance"],
               "mae_days": res["mae_days"], "baseline_mae_days": res["baseline_mae_days"],
               "n_test": res["n"], "n_events": res["n_events"], "coefficients": m.coefficients()}
    return _finish(reg, "service_due", m, metrics, "concordance", True, "baseline_concordance", out_dir,
                   {"algorithm": "Weibull accelerated failure time (lifelines); Cox PH fitted alongside",
                    "baseline": "service every 5,000 km or 6 months", "unit": "days"})


def train_anomaly(data, reg, out_dir):
    c = data["completed"].sort_values("created_at", kind="stable")
    tr, va, te = time_split(c, "created_at")
    m = anomaly.AnomalyModel().fit(pd.concat([tr, va]))
    res = anomaly.evaluate(m, te)
    return _finish(reg, "anomaly", m, {"precision_at_k": res["precision_at_k"], "baseline_precision_at_k": res["random_precision_at_k"],
                                       "k": res["k"], "base_rate": res["base_rate"]},
                   "precision_at_k", True, "baseline_precision_at_k", out_dir,
                   {"algorithm": "Isolation Forest", "baseline": "random selection (no rule exists)",
                    "caveat": "labels are the simulator's price surprises, not hand-labelled cases"})


def run(data_dir: Path, out: Path, only: list[str] | None = None, cards_dir: Path | None = None) -> dict[str, Any]:
    tables = load_tables(data_dir)
    tables["_truth_path"] = str(Path(data_dir) / "ground_truth.json")  # type: ignore[assignment]
    data = _prepare(tables)
    reg = Registry(out)
    cards = cards_dir or Path(__file__).resolve().parents[2] / "model_cards"
    cards.mkdir(parents=True, exist_ok=True)

    steps: dict[str, Callable[[], dict[str, Any]]] = {
        "triage": lambda: train_triage(data, reg, cards),
        "duration": lambda: train_duration(data, reg, cards),
        "price": lambda: train_price(data, reg, cards),
        "acceptance": lambda: train_acceptance(data, reg, cards, tables),
        "demand": lambda: train_demand(data, reg, cards),
        "service_due": lambda: train_service_due(data, reg, cards, tables),
        "anomaly": lambda: train_anomaly(data, reg, cards),
    }
    results = {}
    for name in only or MODELS:
        results[name] = steps[name]()
    return results


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True, type=Path)
    p.add_argument("--out", default=Path("artifacts"), type=Path)
    p.add_argument("--only", nargs="*", choices=MODELS)
    p.add_argument("--cards", type=Path, default=None)
    a = p.parse_args(argv)
    run(a.data, a.out, a.only, a.cards)
    return 0


if __name__ == "__main__":
    sys.exit(main())
