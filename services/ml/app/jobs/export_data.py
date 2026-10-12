"""Export the live database into the table layout the training pipeline reads.

    DATABASE_URL=postgres://... python -m app.jobs.export_data --out ../../data/export

The pipeline was built on simulator output, so the exported CSVs use the simulator's column
names. `to_training_tables` is a pure function (raw rows in, training tables out) so the
mapping is tested without a database.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import holidays
import h3
import numpy as np
import pandas as pd

H3_RES = 7

BOOKINGS_SQL = """
select b.ref as booking_id, b.created_at, b.status::text, b.pickup_lat as lat, b.pickup_lng as lng,
       b.customer_id::text, b.vehicle_id::text, vm.kind::text as vehicle_kind, vm.segment,
       v.year as vehicle_year, v.odometer_km, v.last_service_at, s.code as service_code, s.category,
       coalesce(b.symptom_text, '') as symptom_text, b.mode::text, b.quote_low, b.quote_high,
       b.workshop_id::text, b.eta_min, b.distance_km,
       extract(epoch from (b.completed_at - b.started_at)) / 60.0 as duration_min,
       b.final_price, r.rating,
       (select count(*) from public.offers o where o.booking_id = b.id) as n_offers,
       extract(epoch from (acc.at - b.created_at)) / 60.0 as wait_min
  from public.bookings b
  join public.services s on s.id = b.service_id
  join public.vehicles v on v.id = b.vehicle_id
  join public.vehicle_models vm on vm.id = v.model_id
  left join public.reviews r on r.booking_id = b.id and not r.hidden
  left join lateral (select min(e.at) as at from public.booking_events e
                      where e.booking_id = b.id and e.to_status = 'accepted') acc on true
 where b.created_at >= now() - interval '12 months'
"""

OFFERS_SQL = """
select o.id::text as offer_id, b.ref as booking_id, o.workshop_id::text, o.rank,
       coalesce((o.features ->> 'distance_km')::float, b.distance_km::float) as distance_km,
       coalesce((o.features ->> 'active_jobs')::int, 0) as active_jobs,
       w.staff_count, o.response::text, o.offered_at
  from public.offers o
  join public.bookings b on b.id = o.booking_id
  join public.workshops w on w.id = o.workshop_id
 where o.response <> 'pending' and o.offered_at >= now() - interval '12 months'
"""

WORKSHOPS_SQL = "select id::text as workshop_id, name, lat, lng, staff_count from public.workshops"

VEHICLES_SQL = """
select v.id::text as vehicle_id, v.owner_id::text as customer_id, vm.kind::text as kind, vm.make, vm.model,
       vm.fuel, vm.segment, v.year, v.odometer_km, v.last_service_at, a.lat, a.lng
  from public.vehicles v
  join public.vehicle_models vm on vm.id = v.model_id
  left join lateral (select lat, lng from public.addresses x where x.user_id = v.owner_id
                      order by is_default desc limit 1) a on true
"""


def _ist(ts: pd.Series) -> pd.Series:
    t = pd.to_datetime(ts, utc=True)
    return t.dt.tz_convert("Asia/Kolkata")


def to_training_tables(raw: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    b = raw["bookings"].copy()
    created = pd.to_datetime(b["created_at"], utc=True)
    local = _ist(b["created_at"])
    b["created_at"] = created.dt.tz_localize(None)

    b["hour"] = local.dt.hour
    b["weekday"] = local.dt.weekday
    years = sorted(local.dt.year.unique().tolist()) or [pd.Timestamp.now().year]
    hol = holidays.India(years=years, subdiv="TN")
    b["is_holiday"] = local.dt.date.map(lambda d: d in hol)

    year_now = local.dt.year
    b["vehicle_age"] = (year_now - b["vehicle_year"]).clip(lower=0).astype(float)
    km_per_day = (b["odometer_km"] / np.maximum(b["vehicle_age"] * 365.0, 30.0)).clip(lower=1.0)
    last = pd.to_datetime(b["last_service_at"], utc=True)
    days_since = ((created - last).dt.total_seconds() / 86400.0).fillna(b["vehicle_age"] * 365.0).clip(lower=0)
    b["km_since_service"] = (km_per_day * days_since).round(1)

    b["h3_cell"] = [h3.latlng_to_cell(la, lo, H3_RES) for la, lo in zip(b["lat"], b["lng"])]
    b["status"] = b["status"].where(b["status"] != "paid", "completed")
    for done in ("reviewed", "payment_pending_verification", "disputed", "refunded"):
        b["status"] = b["status"].where(b["status"] != done, "completed")
    b["final_price"] = pd.to_numeric(b["final_price"], errors="coerce")

    keep = [
        "booking_id", "created_at", "h3_cell", "lat", "lng", "customer_id", "vehicle_id", "vehicle_kind",
        "segment", "vehicle_age", "km_since_service", "service_code", "category", "symptom_text", "mode",
        "hour", "weekday", "is_holiday", "quote_low", "quote_high", "n_offers", "status", "workshop_id",
        "eta_min", "distance_km", "duration_min", "final_price", "rating", "wait_min",
    ]
    bookings = b[keep]

    w = raw["workshops"].copy()
    # the platform does not know a workshop's markup; estimate it from how its finished jobs priced
    done = bookings[(bookings.status == "completed") & bookings.final_price.notna()]
    from .. import catalogue

    exp = [catalogue.expected_price(c, s) for c, s in zip(done.service_code, done.segment)]
    ratio = (done.final_price.to_numpy() / np.array(exp)) if len(done) else np.array([])
    markup = pd.Series(ratio, index=done.workshop_id.to_numpy()).groupby(level=0).mean() if len(done) else pd.Series(dtype=float)
    w["markup"] = w["workshop_id"].map(markup).fillna(1.0).clip(0.5, 2.0)

    offers = raw["offers"].copy()
    off_local = _ist(offers["offered_at"])
    offers["offered_at"] = pd.to_datetime(offers["offered_at"], utc=True).dt.tz_localize(None)
    offers["hour"] = off_local.dt.hour
    offers["weekday"] = off_local.dt.weekday
    offers["night"] = ((offers["hour"] >= 20) | (offers["hour"] < 8)).astype(int)
    offers = offers.merge(w[["workshop_id", "markup"]], on="workshop_id", how="left")
    offers["markup"] = offers["markup"].fillna(1.0)

    v = raw["vehicles"].copy()
    now = pd.Timestamp.now(tz="UTC")
    v["age_years"] = (now.year - v["year"]).clip(lower=0).astype(float)
    v["km_per_day"] = (v["odometer_km"] / np.maximum(v["age_years"] * 365.0, 30.0)).clip(lower=1.0).round(2)
    last_v = pd.to_datetime(v["last_service_at"], utc=True)
    v["initial_days_since_service"] = ((now - last_v).dt.total_seconds() / 86400.0).fillna(v["age_years"] * 365.0).round(1)

    return {
        "workshops": w,
        "customers": v[["customer_id"]].drop_duplicates().assign(lat=np.nan, lng=np.nan, locality=""),
        "vehicles": v,
        "bookings": bookings,
        "offers": offers,
    }


def export(dsn: str, out: Path) -> dict[str, int]:
    import psycopg  # only needed when talking to a real database

    raw: dict[str, pd.DataFrame] = {}
    with psycopg.connect(dsn) as conn:
        for name, sql in (("bookings", BOOKINGS_SQL), ("offers", OFFERS_SQL),
                          ("workshops", WORKSHOPS_SQL), ("vehicles", VEHICLES_SQL)):
            with conn.cursor() as cur:
                cur.execute(sql)
                cols = [c.name for c in cur.description]
                raw[name] = pd.DataFrame(cur.fetchall(), columns=cols)
    tables = to_training_tables(raw)
    out.mkdir(parents=True, exist_ok=True)
    for name, df in tables.items():
        df.to_csv(out / f"{name}.csv", index=False, lineterminator="\n")
    return {k: len(v) for k, v in tables.items()}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True, type=Path)
    a = p.parse_args(argv)
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL is required", file=sys.stderr)
        return 2
    counts = export(dsn, a.out)
    print(", ".join(f"{k}: {v}" for k, v in counts.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
