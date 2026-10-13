"""Service catalogue and price factors.

This mirrors supabase/seed.sql. tests/test_catalogue.py parses the seed and fails
if the two drift apart, so the baselines here always match what the app sells.
"""
from __future__ import annotations

GST = 0.18

# code -> (name, vehicle kind, category, base price (taxable), base duration in minutes)
SERVICES: dict[str, tuple[str, str, str, float, int]] = {
    "CAR_001": ("Car General Service", "car", "general", 2500, 180),
    "CAR_002": ("Car Oil Change", "car", "oil", 800, 45),
    "CAR_003": ("Car Brake Inspection", "car", "brakes", 1500, 90),
    "CAR_004": ("Car Tire Rotation", "car", "tyres", 1200, 60),
    "CAR_005": ("Car AC Service", "car", "ac", 3000, 120),
    "CAR_006": ("Car Wash & Vacuum", "car", "wash", 700, 30),
    "CAR_007": ("Car Clutch Overhaul", "car", "clutch", 5000, 240),
    "CAR_008": ("Car Wheel Alignment", "car", "tyres", 2000, 75),
    "CAR_009": ("Car Battery Check", "car", "electrical", 1000, 45),
    "CAR_010": ("Car Denting/Painting", "car", "body", 4500, 180),
    "BIKE_001": ("Bike General Service", "bike", "general", 800, 120),
    "BIKE_002": ("Bike Oil Change", "bike", "oil", 350, 30),
    "BIKE_003": ("Bike Brake & Chain Lube", "bike", "brakes", 500, 60),
    "BIKE_004": ("Bike Puncture Repair", "bike", "tyres", 250, 20),
    "BIKE_005": ("Bike Engine Tuning", "bike", "engine", 1500, 180),
    "BIKE_006": ("Bike Water Wash", "bike", "wash", 300, 30),
    "BIKE_007": ("Bike Carburetor Cleaning", "bike", "engine", 600, 45),
    "BIKE_008": ("Bike Clutch Plate Check", "bike", "clutch", 1200, 90),
    "BIKE_009": ("Bike Electrical Checkup", "bike", "electrical", 400, 30),
    "BIKE_010": ("Bike Chain Tightening", "bike", "general", 200, 15),
}

SEGMENT_FACTOR = {
    "hatchback": 1.00, "sedan": 1.15, "suv": 1.35, "luxury": 1.80,
    "commuter": 1.00, "sports": 1.25, "cruiser": 1.40, "premium": 1.75,
}

CATEGORIES = sorted({v[2] for v in SERVICES.values()})
SEGMENTS = sorted(SEGMENT_FACTOR)
CODES = sorted(SERVICES)


def base_price(code: str) -> float:
    return SERVICES[code][3]


def base_duration(code: str) -> int:
    return SERVICES[code][4]


def category(code: str) -> str:
    return SERVICES[code][2]


def kind(code: str) -> str:
    return SERVICES[code][1]


def codes_for_kind(k: str) -> list[str]:
    return [c for c in CODES if SERVICES[c][1] == k]


def expected_price(code: str, segment: str) -> float:
    """Catalogue price x segment factor, GST-inclusive. The baseline every price model must beat."""
    return round(base_price(code) * SEGMENT_FACTOR.get(segment, 1.0) * (1 + GST), 2)
