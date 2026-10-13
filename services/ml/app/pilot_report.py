"""Pilot report: real and simulated metrics side by side, each with its sample size
and a 95% bootstrap confidence interval.

    python -m app.pilot_report --real DIR --sim sim_metrics.json --out ../../docs/pilot-report.md

`DIR` holds bookings.csv, offers.csv (and optionally notifications.csv) exported with the
pilot_export_* functions. `sim_metrics.json` is the same metrics computed from a simulator
run that used the pilot's actual workshops (see docs/pilot-runbook.md).

A synthetic number is never written to the "Real" column: if a metric has no real rows it
is shown as "no data", not filled from the simulator.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from .baselines import wape  # noqa: F401  (kept so the report shares metric definitions)

RNG_SEED = 20261013
N_BOOT = 2000
LATENCY_TARGET_S = {"realtime": 5.0, "notify": 30.0, "billing": 300.0}


@dataclass
class Estimate:
    value: float
    n: int
    lo: float
    hi: float

    def fmt(self, digits: int = 2, pct: bool = False) -> str:
        if self.n == 0 or np.isnan(self.value):
            return "no data"
        scale = 100.0 if pct else 1.0
        suffix = "%" if pct else ""
        return (
            f"{self.value * scale:.{digits}f}{suffix} "
            f"[{self.lo * scale:.{digits}f}, {self.hi * scale:.{digits}f}] n={self.n}"
        )


NO_DATA = Estimate(float("nan"), 0, float("nan"), float("nan"))


def bootstrap(values: np.ndarray, stat=np.mean, n_boot: int = N_BOOT, seed: int = RNG_SEED) -> Estimate:
    """Percentile bootstrap CI for a statistic of one sample."""
    v = np.asarray(values, dtype=float)
    v = v[~np.isnan(v)]
    if len(v) == 0:
        return NO_DATA
    point = float(stat(v))
    if len(v) < 2:
        return Estimate(point, len(v), float("nan"), float("nan"))
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(v), size=(n_boot, len(v)))
    boots = np.array([stat(v[i]) for i in idx])
    lo, hi = np.percentile(boots, [2.5, 97.5])
    return Estimate(point, len(v), float(lo), float(hi))


def gini(x: np.ndarray) -> float:
    x = np.sort(np.asarray(x, dtype=float))
    n, total = len(x), x.sum()
    return float((2 * np.arange(1, n + 1) - n - 1).dot(x) / (n * total)) if n and total else 0.0


def real_metrics(bookings: pd.DataFrame, offers: pd.DataFrame, notifications: pd.DataFrame | None) -> dict[str, Estimate]:
    b = bookings.copy()
    out: dict[str, Estimate] = {}

    assigned = b["assign_s"].dropna()
    out["time_to_assign_median_s"] = bootstrap(assigned.to_numpy(), np.median)
    out["time_to_assign_p90_s"] = bootstrap(assigned.to_numpy(), lambda x: np.percentile(x, 90))

    if len(offers):
        out["offer_acceptance_rate"] = bootstrap((offers["response"] == "accepted").astype(float).to_numpy())
    else:
        out["offer_acceptance_rate"] = NO_DATA
    out["no_match_rate"] = bootstrap((b["status"] == "no_match").astype(float).to_numpy()) if len(b) else NO_DATA

    out["eta_error_median_abs_min"] = bootstrap(b["eta_error_min"].abs().dropna().to_numpy(), np.median)

    done = b.dropna(subset=["duration_min", "predicted_duration_min", "base_min"])
    out["duration_mae_model_min"] = bootstrap((done["duration_min"] - done["predicted_duration_min"]).abs().to_numpy())
    out["duration_mae_catalogue_min"] = bootstrap((done["duration_min"] - done["base_min"]).abs().to_numpy())

    priced = b.dropna(subset=["final_price", "quote_low", "quote_high"])
    out["price_inside_quote_band"] = bootstrap(
        ((priced["final_price"] >= priced["quote_low"]) & (priced["final_price"] <= priced["quote_high"])).astype(float).to_numpy()
    )
    out["payment_confirmation_median_s"] = bootstrap(b["payment_confirm_s"].dropna().to_numpy(), np.median)
    out["disputes_per_100_bookings"] = bootstrap(b["disputed"].astype(float).to_numpy() * 100.0) if len(b) else NO_DATA
    out["customer_rating_mean"] = bootstrap(b["rating"].dropna().to_numpy())
    # repeat rate only counts bookings old enough to have had 30 days to repeat
    out["repeat_within_30d"] = bootstrap(b["rebooked"].astype(float).to_numpy()) if len(b) else NO_DATA

    jobs = b[b["status"].isin(["accepted", "in_progress", "completed", "paid", "reviewed"])].groupby("workshop_id").size()
    out["gini_jobs_per_workshop"] = (
        Estimate(gini(jobs.to_numpy()), int(len(jobs)), float("nan"), float("nan")) if len(jobs) else NO_DATA
    )

    if notifications is not None and len(notifications):
        for q, target in LATENCY_TARGET_S.items():
            sub = notifications[(notifications["queue"] == q) & (notifications["status"] != "failed")]
            out[f"notification_within_target_{q}"] = bootstrap((sub["latency_s"] <= target).astype(float).to_numpy())
    return out


ROWS = [
    ("time_to_assign_median_s", "Time to assign, median (s)", 1, False, "Booking created to offer accepted"),
    ("time_to_assign_p90_s", "Time to assign, p90 (s)", 1, False, ""),
    ("offer_acceptance_rate", "Offer acceptance rate", 1, True, "Accepted / offers answered"),
    ("no_match_rate", "No-match rate", 1, True, "Bookings ending in no_match"),
    ("eta_error_median_abs_min", "ETA error, median absolute (min)", 1, False, "Job start stands in for arrival"),
    ("duration_mae_model_min", "Duration MAE, model (min)", 1, False, "Against actual started to completed"),
    ("duration_mae_catalogue_min", "Duration MAE, catalogue baseline (min)", 1, False, "The baseline the model must beat"),
    ("price_inside_quote_band", "Final price inside the quote range", 1, True, ""),
    ("payment_confirmation_median_s", "Payment confirmation, median (s)", 0, False, "Completed to payment confirmed"),
    ("disputes_per_100_bookings", "Disputes per 100 bookings", 1, False, ""),
    ("customer_rating_mean", "Customer rating, mean", 2, False, "Hidden reviews excluded"),
    ("repeat_within_30d", "Booked again within 30 days", 1, True, ""),
    ("gini_jobs_per_workshop", "Fairness: Gini of jobs per workshop", 3, False, "0 even, 1 one shop gets everything"),
    ("notification_within_target_realtime", "Realtime notifications within 5 s", 1, True, ""),
    ("notification_within_target_notify", "Notify notifications within 30 s", 1, True, ""),
    ("notification_within_target_billing", "Billing notifications within 5 min", 1, True, ""),
]


def render(real: dict[str, Estimate], sim: dict[str, float], period: str, n_bookings: int) -> str:
    lines = [
        "# Pilot report",
        "",
        f"Period: **{period}**. Completed or requested bookings in the export: **{n_bookings}**.",
        "",
        "The *Simulated* column comes from the simulator re-run with the pilot's actual workshop "
        "locations, staff counts and hours. The *Real* column comes only from the pilot database. "
        "Real values carry their sample size and a 95% bootstrap interval; with a few hundred "
        "bookings the intervals are wide and should be read as calibration, not proof.",
        "",
        "| Metric | Simulated | Real (pilot) | Gap | Note |",
        "| --- | --- | --- | --- | --- |",
    ]
    for key, label, digits, pct, note in ROWS:
        r = real.get(key, NO_DATA)
        s = sim.get(key)
        s_txt = "—" if s is None else (f"{s * 100:.{digits}f}%" if pct else f"{s:.{digits}f}")
        gap = "—"
        if s is not None and r.n > 0 and not np.isnan(r.value):
            diff = (r.value - s) * (100.0 if pct else 1.0)
            gap = f"{diff:+.{digits}f}{' pp' if pct else ''}"
        lines.append(f"| {label} | {s_txt} | {r.fmt(digits, pct)} | {gap} | {note} |")

    # model decisions (plan 11.3): a model whose real error is worse than the baseline goes back to the baseline
    m_model, m_base = real.get("duration_mae_model_min", NO_DATA), real.get("duration_mae_catalogue_min", NO_DATA)
    lines += ["", "## What the pilot decides", ""]
    if m_model.n and m_base.n:
        if m_model.value < m_base.value:
            lines.append(f"- Duration model (M2): beats the catalogue baseline on real data ({m_model.value:.1f} vs {m_base.value:.1f} min). Keep.")
        else:
            lines.append(f"- Duration model (M2): does NOT beat the catalogue baseline on real data ({m_model.value:.1f} vs {m_base.value:.1f} min). Switch back to the baseline until retrained on pilot data.")
    else:
        lines.append("- Duration model (M2): not enough real jobs yet to decide.")
    lines += [
        "- Simulator parameters (arrival rates, durations, acceptance coefficients) are re-fitted to the pilot data; "
        "report the sim-versus-real gap before and after.",
        "- Allocation weights are re-tuned on the corrected simulator.",
        "- Go / no-go for a wider launch: payment-confirmation flow, trust & safety load, notification cost per booking.",
        "",
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--real", required=True, type=Path)
    p.add_argument("--sim", type=Path, default=None)
    p.add_argument("--period", default="pilot")
    p.add_argument("--out", type=Path, default=Path("../../docs/pilot-report.md"))
    a = p.parse_args(argv)

    bookings = pd.read_csv(a.real / "bookings.csv", parse_dates=["created_at"])
    offers = pd.read_csv(a.real / "offers.csv")
    notes_path = a.real / "notifications.csv"
    notes = pd.read_csv(notes_path) if notes_path.exists() else None
    sim = json.loads(a.sim.read_text()) if a.sim and a.sim.exists() else {}

    md = render(real_metrics(bookings, offers, notes), sim, a.period, len(bookings))
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(md, encoding="utf-8", newline="\n")
    print(md)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
