import json
from pathlib import Path

import numpy as np
import pandas as pd

from app import allocation_eval as ae


def _load(d: Path):
    b = pd.read_csv(d / "bookings.csv", parse_dates=["created_at"])
    w = pd.read_csv(d / "workshops.csv")
    o = pd.read_csv(d / "offers.csv")
    truth = json.loads((d / "ground_truth.json").read_text())["rules"]
    return b, ae.build_shops(w, b, o), truth


def test_gini_extremes():
    assert ae.gini(np.array([5, 5, 5, 5])) == 0.0
    assert ae.gini(np.array([0, 0, 0, 20])) > 0.7


def test_bayesian_rating_prefers_volume():
    assert ae.bayes(4.6 * 200, 200) > ae.bayes(5.0, 1)


def test_strategies_rank_as_expected_on_a_simulated_week(sim_dir):
    b, shops, truth = _load(sim_dir)
    week = b[b.created_at >= b.created_at.max().normalize() - pd.Timedelta(days=7)]
    res = {s: ae.simulate(week, shops, s, truth) for s in ae.STRATEGIES}

    # ignoring distance costs customers a lot of driving
    assert res["highest_rating"]["mean_eta_min"] > res["nearest"]["mean_eta_min"] * 1.5
    # and piles work on a few shops
    assert res["highest_rating"]["gini_jobs"] > res["weighted_greedy"]["gini_jobs"]
    # the weighted rule spreads work compared with nearest-only
    assert res["weighted_greedy"]["gini_jobs"] <= res["nearest"]["gini_jobs"] + 0.02
    for m in res.values():
        assert 0 <= m["no_match_rate"] <= 1 and 0 <= m["utilisation"] <= 1.5


def test_the_same_seed_gives_the_same_result(sim_dir):
    b, shops, truth = _load(sim_dir)
    week = b.tail(300)
    a = ae.simulate(week, shops, "weighted_greedy", truth, seed=3)
    c = ae.simulate(week, shops, "weighted_greedy", truth, seed=3)
    assert a == c


def test_peak_batching_does_not_do_worse_than_greedy_on_assignment(sim_dir):
    b, shops, truth = _load(sim_dir)
    week = b[b.created_at >= b.created_at.max().normalize() - pd.Timedelta(days=7)]
    g = ae.simulate(week, shops, "weighted_greedy", truth, time_scale=60)
    h = ae.simulate(week, shops, "weighted_hungarian", truth, time_scale=60)
    assert h["no_match_rate"] <= g["no_match_rate"] + 0.03
