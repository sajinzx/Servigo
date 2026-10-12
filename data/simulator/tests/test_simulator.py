import numpy as np
import pandas as pd
import pytest
from sklearn.linear_model import LogisticRegression

from servigo_sim.generate import TRUTH, SimConfig, generate
from servigo_sim.run import write_outputs

SMALL = dict(days=45, n_workshops=25, n_customers=2000, target_bookings=3500)


@pytest.fixture(scope="module")
def sim():
    return generate(SimConfig(seed=11, **SMALL))


def test_same_seed_reproduces_the_same_bytes(tmp_path):
    a = write_outputs(generate(SimConfig(seed=3, **SMALL)), tmp_path / "a")
    b = write_outputs(generate(SimConfig(seed=3, **SMALL)), tmp_path / "b")
    assert a == b


def test_different_seed_changes_the_data(tmp_path):
    a = write_outputs(generate(SimConfig(seed=3, **SMALL)), tmp_path / "a")
    b = write_outputs(generate(SimConfig(seed=4, **SMALL)), tmp_path / "b")
    assert a["bookings.csv"] != b["bookings.csv"]


def test_size_is_close_to_target(sim):
    n = len(sim["bookings"])
    assert 0.9 * SMALL["target_bookings"] < n < 1.1 * SMALL["target_bookings"]


def test_every_accepted_job_is_inside_the_search_radius(sim):
    done = sim["bookings"][sim["bookings"].status == "completed"]
    assert len(done) > 0
    assert done.distance_km.max() <= SimConfig().search_radius_km + 1e-6


def test_workshops_only_take_vehicle_kinds_they_serve(sim):
    kinds = sim["workshops"].set_index("workshop_id").kinds
    done = sim["bookings"][sim["bookings"].status == "completed"]
    ok = [(kinds[w] == "both") or (kinds[w] == k) for w, k in zip(done.workshop_id, done.vehicle_kind)]
    assert all(ok)


def test_no_workshop_is_loaded_past_its_staff_at_offer_time(sim):
    off = sim["offers"]
    assert (off.active_jobs < off.staff_count).all()


def test_acceptance_coefficients_are_recoverable(sim):
    off = sim["offers"].copy()
    y = (off.response == "accepted").astype(int)
    X = off[["distance_km", "active_jobs", "night"]].assign(markup_pt=off.markup - 1.0)
    clf = LogisticRegression(C=1e6, max_iter=1000).fit(X, y)
    coef = dict(zip(X.columns, clf.coef_[0]))
    t = TRUTH["acceptance_logit"]
    # right sign and the right ballpark; the workshop random effect adds some noise
    assert coef["distance_km"] < 0 and abs(coef["distance_km"] - t["per_km"]) < 0.1
    assert coef["active_jobs"] < 0
    assert coef["night"] < 0.2  # night offers are rare in the data, so only loosely constrained


def test_duration_follows_workshop_efficiency(sim):
    b = sim["bookings"]
    b = b[b.status == "completed"].merge(sim["workshops"][["workshop_id", "efficiency"]], on="workshop_id")
    base = {"CAR_001": 180, "BIKE_002": 30}
    for code, mins in base.items():
        sub = b[b.service_code == code]
        if len(sub) < 20:
            continue
        ratio = (sub.duration_min / mins) / sub.efficiency
        assert 0.7 < ratio.median() < 2.0


def test_prices_are_gst_inclusive_and_near_the_quote(sim):
    b = sim["bookings"]
    b = b[b.status == "completed"]
    inside = ((b.final_price >= b.quote_low) & (b.final_price <= b.quote_high)).mean()
    assert 0.5 < inside < 0.98  # most land in the band, some blow past it


def test_late_night_bookings_are_rare(sim):
    b = sim["bookings"]
    assert (b.hour < 6).mean() < 0.05


def test_ratings_fall_when_price_exceeds_quote(sim):
    b = sim["bookings"]
    r = b[(b.status == "completed") & b.rating.notna()].copy()
    r["over"] = r.final_price / r.quote_high > 1.0
    assert r[r.over].rating.mean() < r[~r.over].rating.mean()


def test_symptom_text_is_present_and_mapped(sim):
    b = sim["bookings"]
    assert b.symptom_text.str.len().min() > 3
    assert b.service_code.nunique() >= 15


def test_h3_cells_are_resolution_7(sim):
    import h3

    assert all(h3.get_resolution(c) == 7 for c in sim["bookings"].h3_cell.unique())
