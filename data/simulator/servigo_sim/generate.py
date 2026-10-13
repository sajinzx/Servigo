"""ServiGo marketplace simulator.

Generates a year of bookings with *known* ground truth: the coefficients that
drive acceptance, duration, price and rating are returned alongside the data so
a model can be scored on how well it recovers them.

Everything is driven by one numpy Generator seeded from the config, and rows are
emitted in a fixed order, so the same config always yields the same bytes.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta

import h3
import holidays
import numpy as np
import pandas as pd

from . import priors

GST = 0.18
H3_RES = 7


@dataclass
class SimConfig:
    seed: int = 7
    start: str = "2025-01-01"
    days: int = 365
    n_workshops: int = 150
    n_customers: int = 20_000
    target_bookings: int = 60_000
    # multiplier on demand in Oct-Dec (north-east monsoon)
    season_bump: float = 1.25
    max_offers: int = 5
    search_radius_km: float = 15.0
    # share of workshops that also do doorstep jobs
    doorstep_share: float = 0.35
    km_per_year_scale: float = 1.0

    def to_dict(self) -> dict:
        return asdict(self)


# the rules the simulator uses; models are scored on how closely they recover these
TRUTH = {
    "acceptance_logit": {
        "intercept": 1.4,
        "per_km": -0.16,
        "per_active_job": -0.55,
        "night": -0.7,  # offered between 20:00 and 08:00
        "per_markup_point": -3.0,  # workshop markup above 1.0
        "workshop_sd": 0.5,  # random effect per workshop
    },
    "duration": {
        "formula": "base_min * workshop_efficiency * (1 + 0.025 * vehicle_age_years) * lognormal(0, 0.2)",
        "age_coef": 0.025,
        "sigma": 0.2,
    },
    "price": {
        "formula": "base_price * segment_factor * workshop_markup * lognormal(0, 0.12) * (1 + gst)",
        "sigma": 0.12,
        "parts_surprise_prob": 0.10,
        "parts_surprise_range": [1.3, 2.0],
        "quote_band": [0.9, 1.25],
    },
    "rating": {
        "formula": "4.7 - 0.01 * wait_min - 2.0 * max(0, final/quote_high - 1) + N(0, 0.5), rounded, clipped 1..5",
        "review_prob": 0.7,
    },
}


def _hour_shape() -> np.ndarray:
    h = np.full(24, 0.0)
    h[0:6] = 0.02
    h[6:8] = 0.35
    h[8:9] = 0.7
    h[9:13] = 1.0
    h[13:15] = 0.7
    h[15:19] = 1.0
    h[19:21] = 0.4
    h[21:24] = 0.08
    return h


def _haversine_km(lat1, lng1, lat2, lng2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = p2 - p1
    dl = np.radians(lng2) - np.radians(lng1)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * 6371.0088 * np.arcsin(np.sqrt(a))


def _jitter(rng, lat, lng, sigma_km, n):
    dlat = rng.normal(0, sigma_km / 111.0, n)
    dlng = rng.normal(0, sigma_km / (111.0 * np.cos(np.radians(lat))), n)
    return lat + dlat, lng + dlng


SEED_SHOPS = [
    ("Anna Nagar Auto Care", 13.0850, 80.2101, 5, "car"),
    ("T Nagar Motors", 13.0418, 80.2341, 8, "car"),
    ("Velachery Bike Works", 12.9815, 80.2180, 3, "bike"),
    ("Adyar Quick Fix", 13.0012, 80.2565, 2, "both"),
    ("Alwarpet Bike Garage", 13.0339, 80.2540, 4, "bike"),
]


def build_workshops(rng: np.random.Generator, cfg: SimConfig) -> pd.DataFrame:
    n = cfg.n_workshops
    loc_w = np.array([l[3] for l in priors.LOCALITIES])
    loc_w = loc_w / loc_w.sum()
    idx = rng.choice(len(priors.LOCALITIES), size=n, p=loc_w)
    base_lat = np.array([priors.LOCALITIES[i][1] for i in idx])
    base_lng = np.array([priors.LOCALITIES[i][2] for i in idx])
    lat, lng = _jitter(rng, base_lat, base_lng, 1.5, n)

    staff = np.clip(1 + rng.poisson(1.8, n), 1, 8)
    kinds = rng.choice(["car", "bike", "both"], size=n, p=[0.45, 0.30, 0.25])
    names = [f"{priors.LOCALITIES[i][0]} Garage {k + 1}" for k, i in enumerate(idx)]

    # the named seed workshops from ServiGo 1.0 take the first slots
    for k, (name, slat, slng, sstaff, skind) in enumerate(SEED_SHOPS[:n]):
        names[k], lat[k], lng[k], staff[k], kinds[k] = name, slat, slng, sstaff, skind

    df = pd.DataFrame(
        {
            "workshop_id": [f"W{k:04d}" for k in range(n)],
            "name": names,
            "lat": lat.round(6),
            "lng": lng.round(6),
            "staff_count": staff,
            "kinds": kinds,
            "efficiency": np.exp(rng.normal(0, 0.15, n)).round(4),
            "markup": rng.uniform(0.9, 1.15, n).round(4),
            "offers_doorstep": rng.random(n) < cfg.doorstep_share,
            "open_hour": rng.choice([8, 9], size=n),
            "close_hour": rng.choice([19, 20, 21], size=n),
            "closed_sunday": rng.random(n) < 0.6,
            "accept_effect": rng.normal(0, TRUTH["acceptance_logit"]["workshop_sd"], n).round(4),
        }
    )
    df["h3_cell"] = [h3.latlng_to_cell(a, b, H3_RES) for a, b in zip(df.lat, df.lng)]
    return df


def build_customers_and_vehicles(rng: np.random.Generator, cfg: SimConfig):
    n = cfg.n_customers
    loc_w = np.array([l[3] for l in priors.LOCALITIES])
    loc_w = loc_w / loc_w.sum()
    idx = rng.choice(len(priors.LOCALITIES), size=n, p=loc_w)
    base_lat = np.array([priors.LOCALITIES[i][1] for i in idx])
    base_lng = np.array([priors.LOCALITIES[i][2] for i in idx])
    lat, lng = _jitter(rng, base_lat, base_lng, 1.0, n)
    customers = pd.DataFrame(
        {
            "customer_id": [f"C{k:05d}" for k in range(n)],
            "lat": lat.round(6),
            "lng": lng.round(6),
            "locality": [priors.LOCALITIES[i][0] for i in idx],
        }
    )

    n_veh = 1 + (rng.random(n) < 0.2).astype(int)
    owner = np.repeat(np.arange(n), n_veh)
    m = len(owner)

    mix_w = np.array([v[7] for v in priors.VEHICLE_MIX])
    mix_w = mix_w / mix_w.sum()
    mix_idx = rng.choice(len(priors.VEHICLE_MIX), size=m, p=mix_w)
    kind = np.array([priors.VEHICLE_MIX[i][0] for i in mix_idx])

    age = np.minimum(rng.gamma(2.2, 2.2, m), 15.0)
    kmpd = np.where(
        kind == "car",
        np.exp(rng.normal(math.log(30), 0.4, m)),
        np.exp(rng.normal(math.log(20), 0.4, m)),
    ) * cfg.km_per_year_scale
    days_since = rng.uniform(0, 300, m)

    vehicles = pd.DataFrame(
        {
            "vehicle_id": [f"V{k:05d}" for k in range(m)],
            "customer_id": customers.customer_id.values[owner],
            "kind": kind,
            "make": [priors.VEHICLE_MIX[i][1] for i in mix_idx],
            "model": [priors.VEHICLE_MIX[i][2] for i in mix_idx],
            "fuel": [priors.VEHICLE_MIX[i][3] for i in mix_idx],
            "segment": [priors.VEHICLE_MIX[i][4] for i in mix_idx],
            "age_years": age.round(2),
            "km_per_day": kmpd.round(2),
            "odometer_km": (age * 365 * kmpd).round(0),
            "initial_days_since_service": days_since.round(1),
            "lat": customers.lat.values[owner],
            "lng": customers.lng.values[owner],
        }
    )
    vehicles["h3_cell"] = [h3.latlng_to_cell(a, b, H3_RES) for a, b in zip(vehicles.lat, vehicles.lng)]
    return customers, vehicles


def _day_hour_weights(cfg: SimConfig):
    start = date.fromisoformat(cfg.start)
    days = [start + timedelta(days=i) for i in range(cfg.days)]
    years = sorted({d.year for d in days})
    hol = holidays.India(years=years, subdiv="TN")
    dow = np.array([1.0, 1.0, 1.0, 1.0, 1.0, 1.3, 0.6])
    w_day = np.zeros(len(days))
    is_hol = np.zeros(len(days), dtype=bool)
    for i, d in enumerate(days):
        w = dow[d.weekday()]
        if d in hol:
            w *= 0.4
            is_hol[i] = True
        if d.month >= 10:
            w *= cfg.season_bump
        w_day[i] = w
    return days, w_day, is_hol


def generate(cfg: SimConfig) -> dict:
    rng = np.random.default_rng(cfg.seed)

    workshops = build_workshops(rng, cfg)
    customers, vehicles = build_customers_and_vehicles(rng, cfg)

    # ---- arrivals: Poisson count per (h3 cell, day, hour) -------------------
    days, w_day, is_hol = _day_hour_weights(cfg)
    hour_w = _hour_shape()
    cells = sorted(vehicles.h3_cell.unique())
    cell_index = {c: i for i, c in enumerate(cells)}
    veh_per_cell = vehicles.groupby("h3_cell").size().reindex(cells).values.astype(float)
    cell_w = veh_per_cell / veh_per_cell.sum()
    weekend_lift = rng.uniform(0.8, 1.4, len(cells))

    is_weekend = np.array([d.weekday() >= 5 for d in days])
    day_hour = np.outer(w_day, hour_w)  # days x 24
    lam = np.empty((len(cells), len(days), 24))
    for ci in range(len(cells)):
        lift = np.where(is_weekend, weekend_lift[ci], 1.0)[:, None]
        lam[ci] = cell_w[ci] * day_hour * lift
    lam *= cfg.target_bookings / lam.sum()
    counts = rng.poisson(lam)

    ci_idx, d_idx, h_idx = np.nonzero(counts)
    reps = counts[ci_idx, d_idx, h_idx]
    ev_cell = np.repeat(ci_idx, reps)
    ev_day = np.repeat(d_idx, reps)
    ev_hour = np.repeat(h_idx, reps)
    n_events = len(ev_cell)
    ev_min = rng.integers(0, 60, n_events)
    ev_sec = rng.integers(0, 60, n_events)
    order = np.lexsort((ev_cell, ev_sec, ev_min, ev_hour, ev_day))
    ev_cell, ev_day, ev_hour, ev_min, ev_sec = (a[order] for a in (ev_cell, ev_day, ev_hour, ev_min, ev_sec))

    # ---- per-vehicle state ----------------------------------------------------
    veh_cell = vehicles.h3_cell.map(cell_index).values
    members = [np.nonzero(veh_cell == ci)[0] for ci in range(len(cells))]
    kmpd = vehicles.km_per_day.values
    age = vehicles.age_years.values
    kinds_v = vehicles.kind.values
    last_service_day = -vehicles.initial_days_since_service.values.copy()  # day index (can be < 0)

    svc_by_kind = {
        k: [s for s in priors.SERVICES if s[2] == k] for k in ("car", "bike")
    }
    svc_code = {s[0]: s for s in priors.SERVICES}

    w_lat, w_lng = workshops.lat.values, workshops.lng.values
    w_staff = workshops.staff_count.values
    w_kinds = workshops.kinds.values
    w_door = workshops.offers_doorstep.values
    w_open, w_close = workshops.open_hour.values, workshops.close_hour.values
    w_sun = workshops.closed_sunday.values
    w_eff, w_markup, w_eff_accept = workshops.efficiency.values, workshops.markup.values, workshops.accept_effect.values
    busy_until: list[list[float]] = [[] for _ in range(len(workshops))]  # epoch minutes

    A = TRUTH["acceptance_logit"]
    start_dt = datetime.fromisoformat(cfg.start)

    bookings, offers = [], []

    for i in range(n_events):
        ci, d, h = int(ev_cell[i]), int(ev_day[i]), int(ev_hour[i])
        cand = members[ci]
        km_since = kmpd[cand] * (d - last_service_day[cand])
        w = 0.2 + np.maximum(km_since, 0) / 5000.0
        v = int(cand[rng.choice(len(cand), p=w / w.sum())])
        kind = kinds_v[v]

        # which service: rises with km since last service and with age
        ks = max(kmpd[v] * (d - last_service_day[v]), 0.0)
        opts = svc_by_kind[kind]
        sw = np.array(
            [
                priors.SERVICE_HAZARD[s[0]]["base"]
                * (1 + ks / 1000.0 * priors.SERVICE_HAZARD[s[0]]["km"])
                * (1 + age[v] * priors.SERVICE_HAZARD[s[0]]["age"])
                for s in opts
            ]
        )
        svc = opts[int(rng.choice(len(opts), p=sw / sw.sum()))]
        code, _name, _kind, category, base_price, base_dur = svc

        text = rng.choice(priors.SYMPTOMS[code])
        text = f"{rng.choice(priors.PREFIXES)}{text}{rng.choice(priors.SUFFIXES)}".strip()

        created = start_dt + timedelta(days=d, hours=h, minutes=int(ev_min[i]), seconds=int(ev_sec[i]))
        t_min = (created - start_dt).total_seconds() / 60.0
        mode = "doorstep" if rng.random() < 0.2 else "workshop"
        lat, lng = float(vehicles.lat.values[v]), float(vehicles.lng.values[v])
        seg = priors.SEGMENT_FACTOR[vehicles.segment.values[v]]
        weekday = created.weekday()

        dist = _haversine_km(lat, lng, w_lat, w_lng)
        ok = (
            ((w_kinds == kind) | (w_kinds == "both"))
            & (dist <= cfg.search_radius_km)
            & (h >= w_open) & (h < w_close)
            & ~((weekday == 6) & w_sun)
            & ((mode == "workshop") | w_door)
        )
        order_c = np.nonzero(ok)[0]
        order_c = order_c[np.argsort(dist[order_c], kind="stable")]

        e0 = base_price * seg * (1 + GST)
        quote_low, quote_high = e0 * 0.9, e0 * 1.25
        night = 1.0 if (h >= 20 or h < 8) else 0.0

        accepted_w, n_off = -1, 0
        bk_id = f"B{i:06d}"
        for wi in order_c:
            if n_off >= cfg.max_offers:
                break
            busy_until[wi] = [t for t in busy_until[wi] if t > t_min]
            load = len(busy_until[wi])
            if load >= w_staff[wi]:
                continue
            n_off += 1
            logit = (
                A["intercept"] + A["per_km"] * dist[wi] + A["per_active_job"] * load
                + A["night"] * night + A["per_markup_point"] * (w_markup[wi] - 1.0) + w_eff_accept[wi]
            )
            p = 1.0 / (1.0 + math.exp(-logit))
            ok_accept = rng.random() < p
            resp = "accepted" if ok_accept else ("rejected" if rng.random() < 0.6 else "expired")
            offers.append(
                {
                    "offer_id": f"O{len(offers):06d}",
                    "booking_id": bk_id,
                    "workshop_id": workshops.workshop_id.values[wi],
                    "rank": n_off,
                    "distance_km": round(float(dist[wi]), 3),
                    "active_jobs": load,
                    "staff_count": int(w_staff[wi]),
                    "hour": h,
                    "weekday": weekday,
                    "night": int(night),
                    "markup": float(w_markup[wi]),
                    "p_true": round(p, 5),
                    "response": resp,
                    "offered_at": created.isoformat(),
                }
            )
            if ok_accept:
                accepted_w = int(wi)
                break

        row = {
            "booking_id": bk_id,
            "created_at": created.isoformat(),
            "h3_cell": cells[ci],
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            "customer_id": vehicles.customer_id.values[v],
            "vehicle_id": vehicles.vehicle_id.values[v],
            "vehicle_kind": kind,
            "segment": vehicles.segment.values[v],
            "vehicle_age": round(float(age[v]), 2),
            "km_since_service": round(ks, 1),
            "service_code": code,
            "category": category,
            "symptom_text": text,
            "mode": mode,
            "hour": h,
            "weekday": weekday,
            "is_holiday": bool(is_hol[d]),
            "quote_low": round(quote_low, 2),
            "quote_high": round(quote_high, 2),
            "n_offers": n_off,
            "status": "no_match",
            "workshop_id": None,
            "eta_min": None,
            "distance_km": None,
            "duration_min": None,
            "final_price": None,
            "rating": None,
            "wait_min": None,
        }

        if accepted_w >= 0:
            wi = accepted_w
            eta = max(2.0, dist[wi] * 1.4 / 25.0 * 60.0 * math.exp(rng.normal(0, 0.2)))
            dur = (
                base_dur * w_eff[wi] * (1 + TRUTH["duration"]["age_coef"] * age[v])
                * math.exp(rng.normal(0, TRUTH["duration"]["sigma"]))
            )
            resp_s = float(rng.uniform(5, 80))
            wait = resp_s / 60.0 + eta
            final = base_price * seg * w_markup[wi] * math.exp(rng.normal(0, TRUTH["price"]["sigma"])) * (1 + GST)
            if rng.random() < TRUTH["price"]["parts_surprise_prob"]:
                final *= rng.uniform(*TRUTH["price"]["parts_surprise_range"])
            rating = None
            if rng.random() < TRUTH["rating"]["review_prob"]:
                r = 4.7 - 0.01 * wait - 2.0 * max(0.0, final / quote_high - 1.0) + rng.normal(0, 0.5)
                rating = int(min(5, max(1, round(r))))
            busy_until[wi].append(t_min + wait + dur)
            row.update(
                status="completed",
                workshop_id=workshops.workshop_id.values[wi],
                eta_min=round(float(eta), 1),
                distance_km=round(float(dist[wi]), 3),
                duration_min=round(float(dur), 1),
                final_price=round(float(final), 2),
                rating=rating,
                wait_min=round(float(wait), 1),
            )
            if category in ("general", "oil"):
                last_service_day[v] = d
        bookings.append(row)

    bookings_df = pd.DataFrame(bookings)
    offers_df = pd.DataFrame(offers)

    truth = {
        "config": cfg.to_dict(),
        "rules": TRUTH,
        "n_bookings": int(len(bookings_df)),
        "n_completed": int((bookings_df.status == "completed").sum()),
        "n_offers": int(len(offers_df)),
    }
    return {
        "workshops": workshops,
        "customers": customers,
        "vehicles": vehicles,
        "bookings": bookings_df,
        "offers": offers_df,
        "truth": truth,
    }
