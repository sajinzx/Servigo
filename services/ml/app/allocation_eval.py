"""Replay one simulated week under four allocation strategies and compare them.

    python -m app.allocation_eval --data ../../data/generated/chennai --out-md ../../docs/allocation-eval.md

Strategies (plan 4.6):
  highest_rating       the ServiGo 1.0 rule: best-rated free workshop, distance ignored
  nearest              nearest free workshop that serves the vehicle
  weighted_greedy      the scoring function of plan 4.3, offers in score order
  weighted_hungarian   weighted scores, but when more than 5 bookings wait in an
                       area one minimum-cost assignment is solved per 30 s window

Everything runs against the simulator's own acceptance model, so absolute numbers
describe the simulator, not Chennai. What carries over is the *ordering* of the
strategies and the trade-offs between them.
"""
from __future__ import annotations

import argparse
import itertools
import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from . import catalogue
from .models.acceptance import add_features  # noqa: F401  (kept for parity with serving features)
from scipy.optimize import linear_sum_assignment

STRATEGIES = ["highest_rating", "nearest", "weighted_greedy", "weighted_hungarian"]
DEFAULT_WEIGHTS = {"eta": 0.35, "rating": 0.20, "load": 0.15, "accept": 0.20, "fairness": 0.10}
SPEED_KMH = 25.0
DETOUR = 1.4
RADIUS_KM = 15.0
OFFER_TTL_S = 90.0
MAX_OFFERS = 5
BATCH_WINDOW_S = 30.0
BATCH_THRESHOLD = 5


def haversine(lat1, lng1, lat2, lng2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin((np.radians(lng2) - np.radians(lng1)) / 2) ** 2
    return 2 * 6371.0088 * np.arcsin(np.sqrt(a))


@dataclass
class Shop:
    wid: str
    lat: float
    lng: float
    staff: int
    kinds: str
    effect: float
    eff: float
    open_h: int
    close_h: int
    closed_sun: bool
    rating_sum: float = 0.0
    rating_n: int = 0
    accept_rate: float = 0.6
    busy: list = field(default_factory=list)  # end times (s)
    jobs: int = 0
    jobs_today: dict = field(default_factory=dict)
    offers: int = 0
    accepted: int = 0
    busy_seconds: float = 0.0

    def load(self, t: float) -> int:
        self.busy = [e for e in self.busy if e > t]
        return len(self.busy)


def bayes(sum_r: float, n: int, mean: float = 4.0, c: float = 10.0) -> float:
    return (c * mean + sum_r) / (5 * (c + n))


def gini(x: np.ndarray) -> float:
    x = np.sort(np.asarray(x, dtype=float))
    if x.sum() == 0:
        return 0.0
    n = len(x)
    return float((2 * np.arange(1, n + 1) - n - 1).dot(x) / (n * x.sum()))


def build_shops(workshops: pd.DataFrame, bookings: pd.DataFrame, offers: pd.DataFrame) -> list[Shop]:
    r = bookings[bookings.rating.notna()].groupby("workshop_id")["rating"].agg(["sum", "count"])
    rates = (offers.assign(a=(offers.response == "accepted").astype(float)).groupby("workshop_id")["a"].agg(["sum", "count"]))
    prior = float((offers.response == "accepted").mean())
    shops = []
    for w in workshops.itertuples():
        rs, rn = (float(r.loc[w.workshop_id, "sum"]), int(r.loc[w.workshop_id, "count"])) if w.workshop_id in r.index else (0.0, 0)
        if w.workshop_id in rates.index:
            a, n = rates.loc[w.workshop_id, "sum"], rates.loc[w.workshop_id, "count"]
            acc = (a + 10 * prior) / (n + 10)
        else:
            acc = prior
        shops.append(Shop(w.workshop_id, w.lat, w.lng, int(w.staff_count), w.kinds, float(w.accept_effect),
                          float(w.efficiency), int(w.open_hour), int(w.close_hour), bool(w.closed_sunday),
                          rs, rn, float(acc)))
    return shops


def simulate(
    bookings: pd.DataFrame,
    shops_proto: list[Shop],
    strategy: str,
    truth: dict,
    weights: dict[str, float] | None = None,
    time_scale: float = 1.0,
    seed: int = 11,
) -> dict[str, float]:
    rng = np.random.default_rng(seed)
    W = weights or DEFAULT_WEIGHTS
    A = truth["acceptance_logit"]
    shops = [Shop(**{**s.__dict__, "busy": [], "jobs": 0, "jobs_today": {}, "offers": 0, "accepted": 0, "busy_seconds": 0.0}) for s in shops_proto]
    lat = np.array([s.lat for s in shops])
    lng = np.array([s.lng for s in shops])
    staff = np.array([s.staff for s in shops])
    horizon = None

    b = bookings.sort_values("created_at", kind="stable").reset_index(drop=True)
    t0 = b.created_at.iloc[0]
    secs = ((b.created_at - t0).dt.total_seconds() / time_scale).to_numpy()
    kinds = b.vehicle_kind.to_numpy()
    blat, blng = b.lat.to_numpy(), b.lng.to_numpy()
    hours = ((b.created_at.dt.hour).to_numpy() + 0)
    wdays = b.created_at.dt.weekday.to_numpy()
    base_min = b.service_code.map(catalogue.base_duration).to_numpy(dtype=float)
    modes = b["mode"].to_numpy()

    etas, ttas, results = [], [], []
    n_offers = n_accept = no_match = 0

    def candidates(i: int, t: float, *, radius: bool, strict_open: bool = True) -> list[int]:
        d = haversine(blat[i], blng[i], lat, lng)
        out = []
        for j, s in enumerate(shops):
            if not (s.kinds == "both" or s.kinds == kinds[i]):
                continue
            if radius and d[j] > RADIUS_KM:
                continue
            if strict_open and not (s.open_h <= hours[i] < s.close_h):
                continue
            if strict_open and wdays[i] == 6 and s.closed_sun:
                continue
            if s.load(t) >= s.staff:
                continue
            out.append(j)
        return out

    def p_accept(j: int, i: int, t: float, dist: float) -> float:
        s = shops[j]
        night = 1.0 if (hours[i] >= 20 or hours[i] < 8) else 0.0
        z = (A["intercept"] + A["per_km"] * dist + A["per_active_job"] * s.load(t) + A["night"] * night + s.effect)
        return 1.0 / (1.0 + math.exp(-z))

    def score_list(i: int, t: float, cand: list[int]) -> list[tuple[float, int]]:
        d = haversine(blat[i], blng[i], lat[cand], lng[cand])
        eta = d * DETOUR / SPEED_KMH * 60
        etamax = float(eta.max()) if len(eta) else 1.0
        day = int(t // 86400)
        out = []
        for k, j in enumerate(cand):
            s = shops[j]
            sc = (
                W["eta"] * (1 - eta[k] / etamax if etamax > 0 else 1.0)
                + W["rating"] * bayes(s.rating_sum, s.rating_n)
                + W["load"] * max(0.0, 1 - s.load(t) / s.staff)
                + W["accept"] * s.accept_rate
                + W["fairness"] / (1 + s.jobs_today.get(day, 0))
            )
            out.append((sc, j))
        return sorted(out, key=lambda x: (-x[0], x[1]))

    def run_cascade(i: int, t: float, order: list[int], waited: float = 0.0) -> tuple[bool, float]:
        """Offer down `order`; return (assigned, seconds until accepted).

        `waited` is time already spent before the first offer, e.g. in a batch window.
        """
        nonlocal n_offers, n_accept
        elapsed = 0.0
        d_all = haversine(blat[i], blng[i], lat, lng)
        for n, j in enumerate(order[:MAX_OFFERS]):
            s = shops[j]
            if s.load(t + elapsed) >= s.staff:
                continue
            n_offers += 1
            s.offers += 1
            p = p_accept(j, i, t + elapsed, float(d_all[j]))
            if rng.random() < p:
                resp = float(rng.uniform(5, 80))
                elapsed += resp
                n_accept += 1
                s.accepted += 1
                dur = base_min[i] * s.eff * math.exp(rng.normal(0, 0.2)) * 60
                eta_s = float(d_all[j]) * DETOUR / SPEED_KMH * 3600
                s.busy.append(t + elapsed + eta_s + dur)
                s.busy_seconds += eta_s + dur
                s.jobs += 1
                day = int((t + elapsed) // 86400)
                s.jobs_today[day] = s.jobs_today.get(day, 0) + 1
                etas.append(eta_s / 60.0)
                ttas.append(elapsed + waited)
                return True, elapsed + waited
            # rejects answer fast; silence takes the whole timeout
            elapsed += float(rng.uniform(5, 40)) if rng.random() < 0.6 else OFFER_TTL_S
        return False, elapsed

    def greedy_order(i: int, t: float) -> list[int]:
        if strategy == "highest_rating":
            cand = candidates(i, t, radius=False, strict_open=False)
            return [j for _, j in sorted(((-(shops[j].rating_sum / shops[j].rating_n) if shops[j].rating_n else 0.0, j) for j in cand))]
        cand = candidates(i, t, radius=True)
        if strategy == "nearest":
            d = haversine(blat[i], blng[i], lat[cand], lng[cand]) if cand else []
            return [cand[k] for k in np.argsort(d, kind="stable")] if cand else []
        return [j for _, j in score_list(i, t, cand)]

    if strategy != "weighted_hungarian":
        for i in range(len(b)):
            t = secs[i]
            order = greedy_order(i, t)
            ok, _ = run_cascade(i, t, order)
            results.append(ok)
            if not ok:
                no_match += 1
    else:
        # collect windows; solve per window when the queue is deep, greedy otherwise
        idx = 0
        n = len(b)
        while idx < n:
            win_start = secs[idx]
            j2 = idx
            while j2 < n and secs[j2] < win_start + BATCH_WINDOW_S:
                j2 += 1
            group = list(range(idx, j2))
            idx = j2
            t = secs[group[-1]]
            if len(group) > BATCH_THRESHOLD:
                per = {i: score_list(i, t, candidates(i, t, radius=True)) for i in group}
                slots, slot_of = [], {}
                for i in group:
                    for sc, j in per[i]:
                        if j not in slot_of:
                            slot_of[j] = shops[j].staff - shops[j].load(t)
                for j, free in slot_of.items():
                    slots += [j] * max(0, int(free))
                if slots:
                    cost = np.full((len(group), len(slots)), 1e6)
                    for r, i in enumerate(group):
                        sc = {j: s for s, j in per[i]}
                        for c, j in enumerate(slots):
                            if j in sc:
                                cost[r, c] = 1 - sc[j]
                    rows, cols = linear_sum_assignment(cost)
                    first = {group[r]: slots[c] for r, c in zip(rows, cols) if cost[r, c] < 1e6}
                else:
                    first = {}
                for i in group:
                    order = [j for _, j in per[i]]
                    if i in first:
                        order = [first[i]] + [j for j in order if j != first[i]]
                    ok, _ = run_cascade(i, t, order, waited=t - secs[i])
                    results.append(ok)
                    if not ok:
                        no_match += 1
            else:
                for i in group:
                    ok, _ = run_cascade(i, secs[i], greedy_order(i, secs[i]))
                    results.append(ok)
                    if not ok:
                        no_match += 1

    horizon = max(secs.max() - secs.min(), 3600.0)
    # capacity is staff time while the shop is open, over the replayed window
    cap_seconds = sum(s.staff * max(s.close_h - s.open_h, 1) * 3600.0 for s in shops) * (horizon / 86400.0)
    jobs = np.array([s.jobs for s in shops], dtype=float)
    total = len(b)
    tta = np.array(ttas) if ttas else np.array([0.0])
    return {
        "bookings": int(total),
        "mean_eta_min": float(np.mean(etas)) if etas else float("nan"),
        "assigned_within_60s": float(np.sum(tta <= 60) / total),
        "median_time_to_assign_s": float(np.median(tta)),
        "offer_acceptance_rate": float(n_accept / max(n_offers, 1)),
        "no_match_rate": float(no_match / total),
        "utilisation": float(sum(s.busy_seconds for s in shops) / cap_seconds) if time_scale == 1.0 else float("nan"),
        "gini_jobs": gini(jobs),
    }


def objective(m: dict[str, float], ref_eta: float) -> float:
    """Lower is better. ETA relative to a reference, plus failure and unfairness terms."""
    return m["mean_eta_min"] / ref_eta + (1 - m["assigned_within_60s"]) + m["gini_jobs"] + m["no_match_rate"]


def tune(bookings, shops, truth, grid=None, seed=11):
    grid = grid or {
        "eta": [0.25, 0.35, 0.5],
        "rating": [0.1, 0.2, 0.3],
        "load": [0.1, 0.15, 0.25],
        "accept": [0.1, 0.2, 0.3],
        "fairness": [0.05, 0.1, 0.2],
    }
    ref = simulate(bookings, shops, "nearest", truth, seed=seed)["mean_eta_min"] or 1.0
    best, best_j, tried = None, float("inf"), 0
    for combo in itertools.product(*grid.values()):
        w = dict(zip(grid.keys(), combo))
        s = sum(w.values())
        w = {k: v / s for k, v in w.items()}
        m = simulate(bookings, shops, "weighted_greedy", truth, weights=w, seed=seed)
        j = objective(m, ref)
        tried += 1
        if j < best_j:
            best, best_j = w, j
    return best, best_j, tried, ref


def _table(rows: dict[str, dict[str, float]]) -> str:
    cols = ["mean_eta_min", "assigned_within_60s", "median_time_to_assign_s", "offer_acceptance_rate",
            "no_match_rate", "utilisation", "gini_jobs"]
    head = "| Strategy | Mean ETA (min) | Assigned < 60 s | Median time to assign (s) | Offer acceptance | No match | Utilisation | Gini (jobs) |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n"
    body = ""
    for name, m in rows.items():
        body += f"| {name} | {m['mean_eta_min']:.1f} | {m['assigned_within_60s']:.1%} | {m['median_time_to_assign_s']:.0f} | {m['offer_acceptance_rate']:.1%} | {m['no_match_rate']:.1%} | {('n/a' if m['utilisation'] != m['utilisation'] else format(m['utilisation'], '.1%'))} | {m['gini_jobs']:.3f} |\n"
    return head + body


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True, type=Path)
    p.add_argument("--out-md", type=Path, default=Path("../../docs/allocation-eval.md"))
    p.add_argument("--weights-out", type=Path, default=Path("artifacts/allocation_weights.json"))
    p.add_argument("--peak-scale", type=float, default=40.0)
    a = p.parse_args(argv)

    b = pd.read_csv(a.data / "bookings.csv", parse_dates=["created_at"])
    w = pd.read_csv(a.data / "workshops.csv")
    o = pd.read_csv(a.data / "offers.csv")
    truth = json.loads((a.data / "ground_truth.json").read_text())["rules"]
    shops = build_shops(w, b, o)

    # three consecutive weeks near the end: tune on the first, report on the third
    end = b.created_at.max().normalize()
    wk = lambda k: b[(b.created_at >= end - pd.Timedelta(weeks=k)) & (b.created_at < end - pd.Timedelta(weeks=k - 1))]
    tune_week, report_week = wk(3), wk(1)

    weights, j, tried, ref = tune(tune_week, shops, truth)
    a.weights_out.parent.mkdir(parents=True, exist_ok=True)
    a.weights_out.write_text(json.dumps({"weights": weights, "source": "grid search on simulated week",
                                         "objective": j, "combinations": tried}, indent=2), encoding="utf-8")

    normal = {s: simulate(report_week, shops, s, truth, weights=weights) for s in STRATEGIES}
    peak = {s: simulate(report_week, shops, s, truth, weights=weights, time_scale=a.peak_scale) for s in STRATEGIES}

    n, p_ = normal, peak
    narrative = "\n".join([
        f"- The ServiGo 1.0 rule (`highest_rating`) ignores distance: mean ETA {n['highest_rating']['mean_eta_min']:.1f} min "
        f"against {n['nearest']['mean_eta_min']:.1f} for nearest-only, and a Gini of jobs of {n['highest_rating']['gini_jobs']:.2f} "
        f"against {n['weighted_greedy']['gini_jobs']:.2f} for the weighted rule.",
        f"- `weighted_greedy` costs {n['weighted_greedy']['mean_eta_min'] - n['nearest']['mean_eta_min']:+.1f} min of mean ETA "
        f"relative to nearest-only, and changes the Gini of jobs by "
        f"{n['weighted_greedy']['gini_jobs'] - n['nearest']['gini_jobs']:+.3f} and offer acceptance by "
        f"{(n['weighted_greedy']['offer_acceptance_rate'] - n['nearest']['offer_acceptance_rate']) * 100:+.1f} points.",
        f"- At peak, batch assignment moved mean ETA by "
        f"{p_['weighted_hungarian']['mean_eta_min'] - p_['weighted_greedy']['mean_eta_min']:+.1f} min and the no-match rate by "
        f"{(p_['weighted_hungarian']['no_match_rate'] - p_['weighted_greedy']['no_match_rate']) * 100:+.1f} points versus greedy; "
        f"share assigned within 60 s moved by "
        f"{(p_['weighted_hungarian']['assigned_within_60s'] - p_['weighted_greedy']['assigned_within_60s']) * 100:+.1f} points "
        f"(it includes the wait for the 30 s window).",
        "- Utilisation is shown only for the normal week; with arrivals compressed, jobs still take real time so the ratio means nothing.",
    ])

    md = f"""# Allocation evaluation

Generated by `python -m app.allocation_eval`. All four strategies replay the **same simulated
week** ({normal['highest_rating']['bookings']} bookings, {len(shops)} workshops) against the simulator's own acceptance
model. Absolute numbers describe the simulator; the ordering of strategies and the trade-offs are
what carry over. Real results come from the pilot (`docs/pilot-report.md`).

## Normal load

{_table(normal)}
## Peak load (arrivals compressed {a.peak_scale:.0f}x)

{_table(peak)}
## Tuned weights

Grid search over {tried} weight combinations on the week before the reporting week
(objective: mean ETA relative to nearest-only + share not assigned within 60 s + Gini of jobs + no-match rate).

| eta | rating | load | accept | fairness |
| --- | --- | --- | --- | --- |
| {weights['eta']:.3f} | {weights['rating']:.3f} | {weights['load']:.3f} | {weights['accept']:.3f} | {weights['fairness']:.3f} |

Starting values were 0.35 / 0.20 / 0.15 / 0.20 / 0.10. The chosen weights are written to
`artifacts/allocation_weights.json` and served at `GET /allocation/weights`.

## Reading this

{narrative}
"""
    a.out_md.parent.mkdir(parents=True, exist_ok=True)
    a.out_md.write_text(md, encoding="utf-8", newline="\n")
    print(md)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
