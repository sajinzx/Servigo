"""Vehicle health engine, maintenance projection and cost estimation.

What is learned and what is not
-------------------------------
* The *general / oil service interval* comes from the survival model (M6) when one is
  promoted, so it adapts to how each vehicle is actually driven.
* The other component intervals are **typical manufacturer-style intervals written down
  below**, not fitted to data. They are an engineering default and are easy to change in
  one table. Nothing here claims they were learned.
* Prices come from the price model (M3) when available, otherwise catalogue x segment x GST.

A component's *wear* is how far through its interval it is: max(km since / km interval,
days since / day interval). 1.0 means "due now".
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterable

from .. import catalogue

# wear thresholds for the status shown to the customer
WATCH, DUE, OVERDUE = 0.6, 0.9, 1.1


@dataclass(frozen=True)
class Component:
    key: str
    label: str
    category: str  # service category in the catalogue
    codes: dict[str, str]  # vehicle kind -> service code to recommend
    km: dict[str, float | None]  # vehicle kind -> km interval (None = time only)
    days: dict[str, float | None]
    weight: float = 1.0  # safety-critical parts count for more


COMPONENTS: list[Component] = [
    Component("engine_oil", "Engine oil", "oil", {"car": "CAR_002", "bike": "BIKE_002"},
              {"car": 7500, "bike": 3000}, {"car": 180, "bike": 120}),
    Component("general", "General service", "general", {"car": "CAR_001", "bike": "BIKE_001"},
              {"car": 10000, "bike": 6000}, {"car": 365, "bike": 270}),
    Component("brakes", "Brakes", "brakes", {"car": "CAR_003", "bike": "BIKE_003"},
              {"car": 20000, "bike": 5000}, {"car": 540, "bike": 180}, weight=2.0),
    Component("tyres", "Tyres and alignment", "tyres", {"car": "CAR_004", "bike": "BIKE_004"},
              {"car": 10000, "bike": 15000}, {"car": 730, "bike": 730}, weight=2.0),
    Component("battery", "Battery and electrical", "electrical", {"car": "CAR_009", "bike": "BIKE_009"},
              {"car": None, "bike": None}, {"car": 1095, "bike": 730}),
    Component("ac", "Air conditioning", "ac", {"car": "CAR_005", "bike": ""},
              {"car": None, "bike": None}, {"car": 365, "bike": None}),
    Component("clutch", "Clutch", "clutch", {"car": "CAR_007", "bike": "BIKE_008"},
              {"car": 60000, "bike": 30000}, {"car": 1825, "bike": 1460}),
    Component("engine", "Engine tuning", "engine", {"car": "", "bike": "BIKE_005"},
              {"car": None, "bike": 20000}, {"car": None, "bike": 730}),
]

# the last categories whose "since" can come from the vehicle's own record
_GENERAL_CATEGORIES = {"general", "oil"}


def _status(wear: float) -> str:
    if wear >= OVERDUE:
        return "overdue"
    if wear >= DUE:
        return "due"
    if wear >= WATCH:
        return "watch"
    return "ok"


def _component_score(wear: float) -> int:
    """100 until half way through the interval, 50 at due, 0 at 1.5x overdue."""
    return int(round(100 * max(0.0, min(1.0, 1.0 - max(0.0, wear - 0.5)))))


def _grade(score: int) -> str:
    return "excellent" if score >= 85 else "good" if score >= 70 else "fair" if score >= 50 else "poor"


@dataclass
class VehicleProfile:
    kind: str  # car | bike
    segment: str = "hatchback"
    age_years: float = 5.0
    odometer_km: float = 0.0
    km_per_day: float = 25.0
    # days since the last general/oil service, if known
    days_since_service: float | None = None
    # completed jobs: category -> days ago of the most recent one
    history_days_ago: dict[str, float] | None = None


def assess(
    v: VehicleProfile,
    general_interval_days: float | None = None,
) -> dict:
    """Score every component of one vehicle. `general_interval_days` is the learned interval (M6)."""
    if v.kind not in ("car", "bike"):
        raise ValueError("kind must be car or bike")
    hist = v.history_days_ago or {}
    age_days = max(v.age_years * 365.0, 1.0)
    out = []

    for c in COMPONENTS:
        km_int, day_int = c.km.get(v.kind), c.days.get(v.kind)
        code = c.codes.get(v.kind) or ""
        if not code or (km_int is None and day_int is None):
            continue  # this component does not apply to this kind of vehicle
        if general_interval_days and c.category in _GENERAL_CATEGORIES and day_int:
            # the learned interval replaces the fixed one, never longer than a year
            day_int = float(min(max(general_interval_days, 30.0), 365.0))

        if c.category in hist:
            since_days, basis = float(hist[c.category]), "service record"
        elif c.category in _GENERAL_CATEGORIES and v.days_since_service is not None:
            since_days, basis = float(v.days_since_service), "last service date"
        else:
            # no record: assume it has never been done since the vehicle was new
            since_days, basis = age_days, "assumed from age"
        since_km = since_days * max(v.km_per_day, 0.0)

        wear_parts = []
        if km_int:
            wear_parts.append(since_km / km_int)
        if day_int:
            wear_parts.append(since_days / day_int)
        wear = max(wear_parts)
        status = _status(wear)

        out.append(
            {
                "key": c.key,
                "label": c.label,
                "category": c.category,
                "service_code": code,
                "status": status,
                "score": _component_score(wear),
                "wear": round(wear, 2),
                "since_days": round(since_days),
                "since_km": round(since_km),
                "interval_km": km_int,
                "interval_days": round(day_int) if day_int else None,
                "days_left": max(0, round((1.0 - wear) * since_days / max(wear, 1e-6))) if wear < 1 else 0,
                "basis": basis,
                "weight": c.weight,
            }
        )

    if not out:
        return {"score": 100, "grade": "excellent", "components": [], "attention": []}

    wsum = sum(c["weight"] for c in out)
    mean = sum(c["score"] * c["weight"] for c in out) / wsum
    worst = min(c["score"] for c in out)
    # a single neglected part matters more than an average suggests, so the worst counts half
    overall = int(round(0.5 * mean + 0.5 * worst))
    attention = sorted(
        (c for c in out if c["status"] in ("due", "overdue")),
        key=lambda c: (-c["weight"], -c["wear"]),
    )
    return {
        "score": overall,
        "grade": _grade(overall),
        "components": sorted(out, key=lambda c: c["score"]),
        "attention": [c["key"] for c in attention],
        "confidence": "high"
        if sum(c["basis"] != "assumed from age" for c in out) >= max(2, len(out) // 2)
        else "low",
    }


# ---- cost ------------------------------------------------------------------------------------

PriceFn = Callable[[str], tuple[float, float, float]]  # service code -> (low, median, high)


def catalogue_price_fn(segment: str) -> PriceFn:
    def f(code: str) -> tuple[float, float, float]:
        e = catalogue.expected_price(code, segment)
        return (round(e * 0.9, 2), e, round(e * 1.25, 2))

    return f


def project_costs(
    v: VehicleProfile,
    health: dict,
    price: PriceFn,
    horizon_days: int = 365,
) -> dict:
    """What to spend now, and what the next `horizon_days` are expected to cost."""
    by_key = {c.key: c for c in COMPONENTS}
    year_km = max(v.km_per_day, 0.0) * horizon_days
    now_items, lo_now, mid_now, hi_now = [], 0.0, 0.0, 0.0
    ahead_items, lo_y, mid_y, hi_y = [], 0.0, 0.0, 0.0

    for c in health["components"]:
        comp = by_key[c["key"]]
        low, mid, high = price(c["service_code"])
        if c["status"] in ("due", "overdue"):
            now_items.append({"service_code": c["service_code"], "label": c["label"], "low": low, "median": mid, "high": high,
                              "reason": f"{c['status']}: {int(c['wear'] * 100)}% of its interval used"})
            lo_now += low
            mid_now += mid
            hi_now += high

        # expected visits over the horizon: the faster of the distance and time clocks
        rates = []
        if comp.km.get(v.kind):
            rates.append(year_km / comp.km[v.kind])  # type: ignore[index]
        if comp.days.get(v.kind):
            rates.append(horizon_days / comp.days[v.kind])  # type: ignore[index]
        n = max(rates) if rates else 0.0
        # a part already past due is also needed once now: it is counted in "now", not twice here
        n_ahead = max(0.0, n - (1.0 if c["status"] in ("due", "overdue") else 0.0))
        if n_ahead > 0:
            ahead_items.append({"service_code": c["service_code"], "label": c["label"], "expected_visits": round(n_ahead, 2),
                                "median": round(mid * n_ahead, 2)})
            lo_y += low * n_ahead
            mid_y += mid * n_ahead
            hi_y += high * n_ahead

    return {
        "now": {"items": now_items, "low": round(lo_now, 2), "median": round(mid_now, 2), "high": round(hi_now, 2)},
        "next_12_months": {
            "items": ahead_items,
            "low": round(lo_now + lo_y, 2),
            "median": round(mid_now + mid_y, 2),
            "high": round(hi_now + hi_y, 2),
            "horizon_days": horizon_days,
        },
    }


def intelligence(
    v: VehicleProfile,
    general_interval_days: float | None = None,
    price: PriceFn | None = None,
    p_due_30d: float | None = None,
    sources: Iterable[str] = (),
) -> dict:
    """The full picture for one vehicle: health, what to do, what it costs."""
    health = assess(v, general_interval_days)
    cost = project_costs(v, health, price or catalogue_price_fn(v.segment))
    actions = [
        {"service_code": c["service_code"], "label": c["label"], "urgency": c["status"], "why": f"{c['label']} is {c['status']}"}
        for c in health["components"]
        if c["status"] in ("due", "overdue", "watch")
    ]
    order = {"overdue": 0, "due": 1, "watch": 2}
    actions.sort(key=lambda a: order[a["urgency"]])
    return {
        "health": health,
        "actions": actions,
        "cost": cost,
        "service_due_probability_30d": p_due_30d,
        "sources": sorted(set(sources)),
    }
