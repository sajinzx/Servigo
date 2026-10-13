"""Download the public datasets used to calibrate the simulator and train M1/M6.

Only sources with a stable direct URL are fetched automatically. The rest need a
login or have a landing page, so the script prints what to do instead of guessing
a URL. Files go to data/raw/ (git-ignored).

Usage: python data/scripts/download_datasets.py [nhtsa] [osm]
"""
from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

RAW = Path(__file__).resolve().parents[1] / "raw"

AUTO = {
    "nhtsa": [
        (
            "https://static.nhtsa.gov/odi/ffdd/cmpl/FLAT_CMPL.zip",
            "nhtsa/FLAT_CMPL.zip",
            "NHTSA ODI complaints flat file (public domain, updated daily)",
        ),
        (
            "https://static.nhtsa.gov/odi/ffdd/cmpl/CMPL.txt",
            "nhtsa/CMPL.txt",
            "Field layout: COMPDESC, CDESCR, MILES ...",
        ),
    ],
    "osm": [
        (
            "https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf",
            "osm/southern-zone-latest.osm.pbf",
            "OpenStreetMap, southern India (ODbL: attribute OpenStreetMap in the app footer)",
        ),
    ],
}

MANUAL = [
    (
        "CarDekho vehicle dataset (Kaggle)",
        "Needs a Kaggle login. Download 'Vehicle dataset from CarDekho' and save the "
        "CSV as data/raw/cardekho.csv (columns: year, km_driven, fuel, ...). "
        "Check the columns for your file version.",
    ),
    (
        "Predictive Maintenance in Logistics Fleets (Mendeley Data, 2026)",
        "Landing page download. Licence is not stated on the page; confirm before "
        "publishing results. Save as data/raw/fleet_maintenance.csv.",
    ),
    (
        "Hyundai Cars Maintenance Dataset (Mendeley Data, 2024)",
        "Landing page download. Small (1,100 rows); M6/M7 experiments only. "
        "Save as data/raw/hyundai_maintenance.csv.",
    ),
    (
        "IndiaPIN (Department of Posts)",
        "Download the PIN code CSV with lat/lng and save as data/raw/india_pin.csv. "
        "One post office per PIN; last updated Dec 2021.",
    ),
]


def fetch(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        print(f"have  {dest}")
        return
    print(f"get   {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url) as r, open(tmp, "wb") as f:  # fixed https URLs above
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.rename(dest)
    print(f"saved {dest} ({dest.stat().st_size / 1e6:.1f} MB)")


def main(argv: list[str]) -> int:
    wanted = argv or list(AUTO)
    for key in wanted:
        if key not in AUTO:
            print(f"unknown source {key!r}; choose from {', '.join(AUTO)}")
            return 2
        for url, rel, note in AUTO[key]:
            print(f"-- {note}")
            fetch(url, RAW / rel)
    print("\nManual downloads:")
    for title, how in MANUAL:
        print(f"* {title}\n    {how}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
