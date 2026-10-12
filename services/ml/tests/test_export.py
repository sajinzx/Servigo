import numpy as np
import pandas as pd

from app.jobs.export_data import to_training_tables


def raw_tables():
    bookings = pd.DataFrame(
        {
            "booking_id": ["BK-1", "BK-2", "BK-3"],
            "created_at": pd.to_datetime(["2026-10-12T04:30:00Z", "2026-10-13T20:30:00Z", "2026-10-14T05:00:00Z"]),
            "status": ["paid", "reviewed", "no_match"],
            "lat": [13.085, 13.04, 13.0],
            "lng": [80.21, 80.23, 80.25],
            "customer_id": ["c1", "c2", "c1"],
            "vehicle_id": ["v1", "v2", "v1"],
            "vehicle_kind": ["car", "bike", "car"],
            "segment": ["suv", "commuter", "suv"],
            "vehicle_year": [2020, 2022, 2020],
            "odometer_km": [60000, 12000, 60000],
            "last_service_at": pd.to_datetime(["2026-06-01T00:00:00Z", None, "2026-06-01T00:00:00Z"]),
            "service_code": ["CAR_001", "BIKE_002", "CAR_003"],
            "category": ["general", "oil", "brakes"],
            "symptom_text": ["service due", "oil change", ""],
            "mode": ["workshop", "workshop", "doorstep"],
            "quote_low": [2800.0, 300.0, 1400.0],
            "quote_high": [4000.0, 500.0, 2100.0],
            "workshop_id": ["w1", "w2", None],
            "eta_min": [12.0, 8.0, None],
            "distance_km": [3.0, 2.0, None],
            "duration_min": [170.0, 28.0, None],
            "final_price": [3800.0, 420.0, None],
            "rating": [5.0, 4.0, None],
            "n_offers": [1, 2, 0],
            "wait_min": [1.2, 2.0, None],
        }
    )
    offers = pd.DataFrame(
        {
            "offer_id": ["o1", "o2"],
            "booking_id": ["BK-1", "BK-2"],
            "workshop_id": ["w1", "w2"],
            "rank": [1, 1],
            "distance_km": [3.0, 2.0],
            "active_jobs": [1, 0],
            "staff_count": [4, 2],
            "response": ["accepted", "rejected"],
            "offered_at": pd.to_datetime(["2026-10-12T04:30:00Z", "2026-10-13T20:30:00Z"]),
        }
    )
    workshops = pd.DataFrame({"workshop_id": ["w1", "w2"], "name": ["A", "B"], "lat": [13.0, 13.1], "lng": [80.2, 80.3], "staff_count": [4, 2]})
    vehicles = pd.DataFrame(
        {
            "vehicle_id": ["v1", "v2"], "customer_id": ["c1", "c2"], "kind": ["car", "bike"], "make": ["M", "H"],
            "model": ["X", "Y"], "fuel": ["petrol", "petrol"], "segment": ["suv", "commuter"], "year": [2020, 2022],
            "odometer_km": [60000, 12000], "last_service_at": pd.to_datetime(["2026-06-01T00:00:00Z", None]),
            "lat": [13.085, 13.04], "lng": [80.21, 80.23],
        }
    )
    return {"bookings": bookings, "offers": offers, "workshops": workshops, "vehicles": vehicles}


def test_output_has_the_columns_the_pipeline_reads():
    t = to_training_tables(raw_tables())
    for col in ("h3_cell", "hour", "weekday", "is_holiday", "vehicle_age", "km_since_service", "category", "symptom_text"):
        assert col in t["bookings"].columns
    for col in ("night", "markup", "hour", "weekday", "active_jobs", "staff_count"):
        assert col in t["offers"].columns
    assert {"km_per_day", "age_years", "initial_days_since_service"} <= set(t["vehicles"].columns)


def test_time_features_are_in_indian_time():
    b = to_training_tables(raw_tables())["bookings"]
    # 04:30 UTC is 10:00 IST; 20:30 UTC is 02:00 IST the next day
    assert list(b["hour"]) == [10, 2, 10]
    # 02:00 IST on 14 Oct 2026 is a Wednesday (Monday is 0), although it is still Tuesday in UTC
    assert list(b["weekday"]) == [0, 2, 2]
    assert b["created_at"].dt.tz is None


def test_paid_and_reviewed_count_as_completed_for_training():
    b = to_training_tables(raw_tables())["bookings"]
    assert list(b["status"]) == ["completed", "completed", "no_match"]


def test_vehicle_features_are_derived_from_odometer_and_service_date():
    b = to_training_tables(raw_tables())["bookings"]
    row = b.iloc[0]
    assert row["vehicle_age"] == 6.0
    # 60,000 km over 6 years is about 27 km/day; ~133 days since 1 June 2026 -> ~3,600 km
    assert 3000 < row["km_since_service"] < 4200


def test_markup_is_estimated_from_finished_jobs_and_defaults_to_one():
    t = to_training_tables(raw_tables())
    m = t["workshops"].set_index("workshop_id")["markup"]
    # CAR_001 suv: 2500 * 1.35 * 1.18 = 3982.5; the job cost 3800 -> ratio ~0.954
    assert abs(m["w1"] - 3800 / 3982.5) < 1e-6
    assert np.isclose(t["offers"].loc[t["offers"].workshop_id == "w1", "markup"].iloc[0], m["w1"])


def test_night_flag_follows_the_indian_clock():
    o = to_training_tables(raw_tables())["offers"]
    assert list(o["night"]) == [0, 1]
