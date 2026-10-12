import numpy as np
import pandas as pd

from app.pilot_report import NO_DATA, bootstrap, gini, real_metrics, render


def _bookings(n=200, seed=1):
    rng = np.random.default_rng(seed)
    return pd.DataFrame(
        {
            "booking_id": [f"BK-{i}" for i in range(n)],
            "created_at": pd.date_range("2026-11-02", periods=n, freq="h"),
            "status": rng.choice(["paid", "no_match", "completed"], size=n, p=[0.8, 0.1, 0.1]),
            "workshop_id": rng.choice(["w1", "w2", "w3"], size=n),
            "assign_s": rng.normal(50, 15, n).clip(5),
            "eta_error_min": rng.normal(2, 4, n),
            "duration_min": rng.normal(100, 20, n).clip(10),
            "predicted_duration_min": rng.normal(100, 5, n),
            "base_min": np.full(n, 120),
            "quote_low": np.full(n, 2000.0),
            "quote_high": np.full(n, 3000.0),
            "final_price": rng.normal(2600, 500, n),
            "rating": rng.integers(3, 6, n).astype(float),
            "payment_confirm_s": rng.normal(1800, 300, n),
            "disputed": rng.random(n) < 0.03,
            "rebooked": rng.random(n) < 0.2,
        }
    )


def _offers(n=400, seed=2):
    rng = np.random.default_rng(seed)
    return pd.DataFrame({"response": rng.choice(["accepted", "rejected", "expired"], size=n, p=[0.6, 0.25, 0.15])})


def test_bootstrap_interval_contains_the_point_estimate_and_shrinks_with_n():
    rng = np.random.default_rng(0)
    small = bootstrap(rng.normal(10, 2, 30))
    large = bootstrap(rng.normal(10, 2, 3000))
    assert small.lo <= small.value <= small.hi
    assert (large.hi - large.lo) < (small.hi - small.lo)
    assert small.n == 30 and large.n == 3000


def test_bootstrap_is_reproducible():
    x = np.random.default_rng(3).normal(0, 1, 100)
    assert bootstrap(x) == bootstrap(x)


def test_empty_input_is_no_data_not_zero():
    e = bootstrap(np.array([]))
    assert e.n == 0 and e.fmt() == "no data"
    assert bootstrap(np.array([np.nan, np.nan])).n == 0


def test_gini_extremes():
    assert gini(np.array([4, 4, 4, 4])) == 0
    assert gini(np.array([0, 0, 0, 10])) > 0.7


def test_real_metrics_carry_sample_sizes():
    m = real_metrics(_bookings(), _offers(), None)
    assert m["time_to_assign_median_s"].n == 200
    assert 40 < m["time_to_assign_median_s"].value < 60
    assert m["offer_acceptance_rate"].n == 400
    assert 0.5 < m["offer_acceptance_rate"].value < 0.7
    assert m["gini_jobs_per_workshop"].n == 3


def test_notifications_are_judged_against_the_latency_target_per_queue():
    notes = pd.DataFrame(
        {
            "queue": ["realtime"] * 4 + ["notify"] * 2,
            "channel": ["push"] * 6,
            "status": ["sent", "sent", "sent", "failed", "delivered", "sent"],
            "latency_s": [1.0, 2.0, 9.0, 1.0, 12.0, 45.0],
        }
    )
    m = real_metrics(_bookings(10), _offers(10), notes)
    # failed sends are excluded; 2 of 3 realtime were within 5 s
    assert abs(m["notification_within_target_realtime"].value - 2 / 3) < 1e-9
    assert m["notification_within_target_notify"].value == 0.5


def test_report_keeps_simulated_and_real_apart_and_never_fills_real_from_sim():
    # no real offers at all: the real acceptance rate must say "no data", whatever the sim says
    m = real_metrics(_bookings(50), pd.DataFrame({"response": []}), None)
    md = render(m, {"offer_acceptance_rate": 0.76, "no_match_rate": 0.05}, "pilot", 50)
    row = next(line for line in md.splitlines() if line.startswith("| Offer acceptance rate"))
    cells = [c.strip() for c in row.strip("|").split("|")]
    assert cells[1] == "76.0%"  # simulated column
    assert cells[2] == "no data"  # real column is never backfilled
    assert cells[3] == "—"  # so there is no gap either


def test_report_flags_a_model_that_loses_to_the_baseline_on_real_data():
    b = _bookings(300)
    b["predicted_duration_min"] = b["duration_min"] + 80  # a bad model
    b["base_min"] = b["duration_min"] + 5  # a good catalogue
    md = render(real_metrics(b, _offers(50), None), {}, "pilot", len(b))
    assert "does NOT beat the catalogue baseline" in md
    assert "Switch back to the baseline" in md
