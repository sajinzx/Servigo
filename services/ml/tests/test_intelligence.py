from app.intelligence import health as H
from app.intelligence import trip as T


def test_new_vehicle_with_recent_service_is_healthy():
    v = H.VehicleProfile(kind="car", age_years=1, km_per_day=20, days_since_service=30,
                         history_days_ago={"general": 30, "oil": 30, "brakes": 100, "tyres": 100, "electrical": 100, "ac": 100, "clutch": 100})
    r = H.assess(v)
    assert r["score"] >= 85 and r["attention"] == []
    assert r["confidence"] == "high"


def test_neglected_vehicle_is_flagged_and_scores_low():
    v = H.VehicleProfile(kind="bike", age_years=6, km_per_day=40, days_since_service=500)
    r = H.assess(v)
    assert r["score"] < 50
    assert "engine_oil" in r["attention"]
    assert r["confidence"] == "low"


def test_bike_has_no_air_conditioning():
    r = H.assess(H.VehicleProfile(kind="bike"))
    assert "ac" not in {c["key"] for c in r["components"]}


def test_learned_interval_shortens_general_service_never_beyond_a_year():
    v = H.VehicleProfile(kind="car", days_since_service=150, history_days_ago={"general": 150, "oil": 150})
    fixed = {c["key"]: c for c in H.assess(v)["components"]}
    learned = {c["key"]: c for c in H.assess(v, general_interval_days=120)["components"]}
    assert learned["general"]["wear"] > fixed["general"]["wear"]
    far = {c["key"]: c for c in H.assess(v, general_interval_days=900)["components"]}
    assert far["general"]["interval_days"] == 365


def test_costs_now_are_subset_of_year_and_ordered():
    v = H.VehicleProfile(kind="car", segment="sedan", age_years=5, km_per_day=40, days_since_service=400)
    out = H.intelligence(v)
    c = out["cost"]
    assert c["now"]["low"] <= c["now"]["median"] <= c["now"]["high"]
    assert c["next_12_months"]["median"] >= c["now"]["median"]
    assert out["actions"] and out["actions"][0]["urgency"] in ("overdue", "due")


def test_trip_order_is_never_longer_than_given_order():
    s = T.Point("home", 13.0, 80.2)
    stops = [T.Point("far", 13.2, 80.3), T.Point("near", 13.01, 80.21), T.Point("mid", 13.1, 80.25)]
    out = T.plan(s, stops, end=s)
    assert sorted(out["order"]) == ["far", "mid", "near"]
    assert out["saved_km"] >= 0
    naive = T.plan(s, stops, end=s, optimise_order=False)
    assert out["distance_km"] <= naive["distance_km"]


def test_trip_flags_part_due_inside_trip():
    comps = [{"label": "Brakes", "service_code": "CAR_003", "status": "watch", "wear": 0.98, "interval_km": 5000}]
    out = T.plan(T.Point("a", 12.9, 77.5), [T.Point("b", 13.9, 77.9)], health_components=comps)
    assert out["risks"][0]["level"] == "due_during_trip"
    assert out["fit_for_trip"]


def test_trip_unfit_when_part_already_due():
    comps = [{"label": "Brakes", "service_code": "CAR_003", "status": "overdue", "wear": 1.4, "interval_km": 20000}]
    out = T.plan(T.Point("a", 12.9, 77.5), [T.Point("b", 12.95, 77.6)], health_components=comps)
    assert out["fit_for_trip"] is False


def test_large_trip_uses_heuristic_and_visits_everything():
    s = T.Point("s", 13.0, 80.0)
    stops = [T.Point(f"p{i}", 13.0 + (i % 5) * 0.02, 80.0 + (i // 5) * 0.02) for i in range(12)]
    out = T.plan(s, stops)
    assert sorted(out["order"]) == sorted(p.name for p in stops)
