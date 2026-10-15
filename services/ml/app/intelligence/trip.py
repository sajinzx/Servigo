"""Trip planning: route order, time, fuel cost, and whether the vehicle is fit for the trip.

No map provider is called here. Distances are great-circle distance times a road factor
(roads are longer than straight lines; 1.3 is a common planning figure for Indian cities),
and speed is an assumed average. These are stated in the response so nobody mistakes
the result for turn by turn routing.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import permutations

ROAD_FACTOR = 1.3
CITY_KMPH = 22.0
HIGHWAY_KMPH = 55.0
EXACT_LIMIT = 8  # brute force up to this many stops, heuristic beyond


@dataclass(frozen=True)
class Point:
    name: str
    lat: float
    lng: float
    dwell_min: float = 0.0


def haversine_km(a: Point, b: Point) -> float:
    r = 6371.0088
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dp, dl = p2 - p1, math.radians(b.lng - a.lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _road_km(a: Point, b: Point) -> float:
    return haversine_km(a, b) * ROAD_FACTOR


def _length(order: list[Point], start: Point, end: Point | None) -> float:
    pts = [start, *order] + ([end] if end else [])
    return sum(_road_km(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def _two_opt(order: list[Point], start: Point, end: Point | None) -> list[Point]:
    best, best_len = order[:], _length(order, start, end)
    improved = True
    while improved:
        improved = False
        for i in range(len(best) - 1):
            for j in range(i + 1, len(best)):
                cand = best[:i] + best[i : j + 1][::-1] + best[j + 1 :]
                ln = _length(cand, start, end)
                if ln + 1e-9 < best_len:
                    best, best_len, improved = cand, ln, True
    return best


def optimise(start: Point, stops: list[Point], end: Point | None = None) -> list[Point]:
    """Visit every stop once, shortest road distance. Exact for small sets."""
    if len(stops) <= 1:
        return list(stops)
    if len(stops) <= EXACT_LIMIT:
        return list(min(permutations(stops), key=lambda p: _length(list(p), start, end)))
    remaining, cur, order = list(stops), start, []
    while remaining:
        nxt = min(remaining, key=lambda s: _road_km(cur, s))
        order.append(nxt)
        remaining.remove(nxt)
        cur = nxt
    return _two_opt(order, start, end)


def plan(
    start: Point,
    stops: list[Point],
    end: Point | None = None,
    mileage_kmpl: float = 15.0,
    fuel_price: float = 105.0,
    optimise_order: bool = True,
    health_components: list[dict] | None = None,
    km_per_day: float = 25.0,
) -> dict:
    order = optimise(start, stops, end) if optimise_order else list(stops)
    pts = [start, *order] + ([end] if end else [])

    legs, total_km, drive_min, dwell_min = [], 0.0, 0.0, 0.0
    for a, b in zip(pts, pts[1:]):
        km = _road_km(a, b)
        speed = HIGHWAY_KMPH if km > 40 else CITY_KMPH
        mins = km / speed * 60.0
        legs.append({"from": a.name, "to": b.name, "km": round(km, 1), "minutes": round(mins)})
        total_km += km
        drive_min += mins
    for s in order:
        dwell_min += s.dwell_min

    naive_km = _length(list(stops), start, end)
    litres = total_km / max(mileage_kmpl, 1.0)

    # parts that will cross their interval during this trip
    risks = []
    for c in health_components or []:
        km_int = c.get("interval_km")
        if not km_int:
            continue
        left_km = max(0.0, (1.0 - c["wear"]) * km_int)
        if c["status"] in ("due", "overdue"):
            risks.append({"label": c["label"], "service_code": c["service_code"], "level": "due_before_trip",
                          "note": f"{c['label']} is already {c['status']}; service it before leaving"})
        elif left_km < total_km:
            risks.append({"label": c["label"], "service_code": c["service_code"], "level": "due_during_trip",
                          "note": f"{c['label']} reaches its interval in about {round(left_km)} km, inside this {round(total_km)} km trip"})
    fit = not any(r["level"] == "due_before_trip" for r in risks)

    return {
        "order": [s.name for s in order],
        "legs": legs,
        "distance_km": round(total_km, 1),
        "drive_minutes": round(drive_min),
        "dwell_minutes": round(dwell_min),
        "total_minutes": round(drive_min + dwell_min),
        "fuel_litres": round(litres, 2),
        "fuel_cost": round(litres * fuel_price, 2),
        "saved_km": round(max(0.0, naive_km - total_km), 1) if optimise_order else 0.0,
        "fit_for_trip": fit,
        "risks": risks,
        "assumptions": {
            "road_factor": ROAD_FACTOR,
            "city_kmph": CITY_KMPH,
            "highway_kmph": HIGHWAY_KMPH,
            "mileage_kmpl": mileage_kmpl,
            "fuel_price": fuel_price,
            "note": "Straight-line distance scaled by a road factor, not turn-by-turn routing.",
        },
    }
