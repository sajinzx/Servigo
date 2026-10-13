import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app import baselines, catalogue
from app.data import load_tables, time_split
from app.features import add_workshop_history, with_catalogue

ROOT = Path(__file__).resolve().parents[3]


def test_catalogue_matches_the_seed():
    seed = (ROOT / "supabase" / "seed.sql").read_text(encoding="utf-8")
    rows = re.findall(r"\('((?:CAR|BIKE)_\d+)','[^']+','(car|bike)','([a-z]+)',(\d+),(\d+)\)", seed)
    assert len(rows) == 20
    for code, kind, cat, price, minutes in rows:
        name, k, c, p, m = catalogue.SERVICES[code]
        assert (k, c, p, m) == (kind, cat, float(price), int(minutes)), code


def test_time_split_is_ordered_and_disjoint():
    df = pd.DataFrame({"t": pd.date_range("2026-01-01", periods=100, freq="h"), "v": range(100)})
    shuffled = df.sample(frac=1, random_state=1)
    tr, va, te = time_split(shuffled, "t")
    assert (len(tr), len(va), len(te)) == (70, 15, 15)
    assert tr.t.max() < va.t.min() <= va.t.max() < te.t.min()


def test_time_split_rejects_bad_fractions():
    with pytest.raises(ValueError):
        time_split(pd.DataFrame({"t": [1, 2]}), "t", (0.5, 0.2, 0.2))


def test_workshop_history_never_uses_the_current_or_future_row(sim_dir):
    t = load_tables(sim_dir)
    b = with_catalogue(t["bookings"])
    done = b[b.status == "completed"]
    h = add_workshop_history(done)
    one = h[h.workshop_id == h.workshop_id.iloc[0]].sort_values("created_at")
    expected = one["log_dur_ratio"].shift(1).expanding().mean().fillna(0.0)
    np.testing.assert_allclose(one["wk_dur"].to_numpy(), expected.to_numpy(), atol=1e-9)
    assert one["wk_dur"].iloc[0] == 0.0


def test_keyword_baseline_respects_vehicle_kind():
    codes = baselines.keyword_triage("grinding noise when braking", "bike", 3)
    assert all(c.startswith("BIKE_") for c in codes)
    assert codes[0] == "BIKE_003"


def test_every_model_trained_and_promotion_follows_the_metrics(trained):
    _, results, _ = trained
    assert set(results) == {"triage", "duration", "price", "acceptance", "demand", "service_due", "anomaly"}
    for name, m in results.items():
        p = m["promotion"]
        better = p["score"] > p["baseline_score"] if p["higher_is_better"] else p["score"] < p["baseline_score"]
        # a model is promoted exactly when it beats its baseline (nothing is active yet in a fresh registry)
        assert p["promoted"] == better, f"{name}: {p}"
    # on this small dataset the tabular and text models must clearly win
    for name in ("triage", "duration", "price", "acceptance", "service_due", "anomaly"):
        assert results[name]["promotion"]["promoted"], name


def test_demand_beats_seasonal_naive_at_the_grain_the_heatmap_uses(trained):
    _, results, _ = trained
    d = results["demand"]
    # hourly counts per cell and category are mostly 0/1, so hourly WAPE is noise-dominated and a
    # small dataset may legitimately fail to promote; per cell and day the model should win
    assert d["wape_cell_day"] < d["baseline_wape_cell_day"]


def test_duration_error_is_lower_than_the_catalogue_time(trained):
    _, r, _ = trained
    assert r["duration"]["mae"] < r["duration"]["baseline_mae"]
    assert 0.6 < r["duration"]["coverage_80"] < 0.95


def test_price_band_is_tighter_or_better_calibrated_than_the_fixed_band(trained):
    _, r, _ = trained
    p = r["price"]
    assert p["pinball_loss"] < p["baseline_pinball_loss"]
    assert p["coverage_80"] > 0.6


def test_acceptance_recovers_the_direction_of_the_true_coefficients(trained):
    _, r, _ = trained
    c, t = r["acceptance"]["coefficients"], r["acceptance"]["true_coefficients"]
    assert c["distance_km"] < 0 and t["distance_km"] < 0
    assert c["active_jobs"] < 0 and t["active_jobs"] < 0
    # and the size of the distance effect is in the right ballpark
    assert abs(c["distance_km"] - t["distance_km"]) < 0.1
    assert r["acceptance"]["brier"] < r["acceptance"]["baseline_brier"]


def test_triage_suggestions_are_for_the_right_vehicle_kind(trained):
    from app.registry import Registry

    root, _, _ = trained
    _, m = Registry(root).load_active("triage")
    top = m.predict_topk("ac is not cooling properly", "car", 3)
    assert top[0][0] == "CAR_005"
    assert all(c.startswith("CAR_") for c, _ in top)
    assert abs(sum(p for _, p in top) - 1.0) < 0.05 or sum(p for _, p in top) <= 1.0


def test_service_due_probability_grows_with_the_window(trained):
    from app.registry import Registry

    root, _, _ = trained
    _, m = Registry(root).load_active("service_due")
    v = pd.DataFrame({"km_per_day": [30.0], "age_years": [5.0], "is_car": [1]})
    p30 = m.prob_due(v, np.array([100.0]), 30)[0]
    p90 = m.prob_due(v, np.array([100.0]), 90)[0]
    assert 0 <= p30 <= p90 <= 1
    later = m.prob_due(v, np.array([200.0]), 30)[0]
    assert later >= p30 - 1e-6  # the longer since the last service, the likelier it is due


def test_demand_forecast_covers_the_next_week(trained, sim_dir):
    from app.jobs.nightly import write_forecast
    from app.registry import Registry

    root, results, _ = trained
    b = load_tables(sim_dir)["bookings"]
    reg = Registry(root)
    if reg.active("demand") is None:  # not promoted on this small dataset: force it for the shape test
        reg.rollback("demand", results["demand"]["version"])
    fc = write_forecast(reg, b, root)
    assert fc is not None
    assert fc.hour_ts.nunique() == 168
    assert (fc.yhat >= 0).all() and (fc.yhat_lo <= fc.yhat).all() and (fc.yhat <= fc.yhat_hi).all()


def test_model_cards_are_written_with_the_simulation_caveat(trained):
    _, _, cards = trained
    text = (cards / "duration.md").read_text(encoding="utf-8")
    assert "simulated" in text.lower()
    assert "| mae |" in text
    assert "Promotion" in text


def test_anomaly_flags_beat_random(trained):
    _, r, _ = trained
    a = r["anomaly"]
    assert a["precision_at_k"] > a["baseline_precision_at_k"]


def test_results_are_json_serialisable(trained):
    _, r, _ = trained
    json.dumps(r, default=float)
