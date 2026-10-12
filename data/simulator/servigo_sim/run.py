"""CLI: python -m servigo_sim.run --out data/generated/chennai --seed 7"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from .generate import SimConfig, generate

TABLES = ["workshops", "customers", "vehicles", "bookings", "offers"]


def write_outputs(result: dict, out: Path) -> dict[str, str]:
    """Write CSVs with a fixed float format and LF line endings so output is byte-stable."""
    out.mkdir(parents=True, exist_ok=True)
    digests = {}
    for name in TABLES:
        path = out / f"{name}.csv"
        result[name].to_csv(path, index=False, float_format="%.6g", lineterminator="\n")
        digests[f"{name}.csv"] = hashlib.sha256(path.read_bytes()).hexdigest()
    truth_path = out / "ground_truth.json"
    truth_path.write_text(json.dumps(result["truth"], indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    digests["ground_truth.json"] = hashlib.sha256(truth_path.read_bytes()).hexdigest()
    return digests


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Generate the ServiGo synthetic marketplace")
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--days", type=int, default=365)
    p.add_argument("--workshops", type=int, default=150)
    p.add_argument("--customers", type=int, default=20_000)
    p.add_argument("--bookings", type=int, default=60_000)
    p.add_argument("--start", default="2025-01-01")
    args = p.parse_args(argv)

    cfg = SimConfig(
        seed=args.seed, days=args.days, n_workshops=args.workshops,
        n_customers=args.customers, target_bookings=args.bookings, start=args.start,
    )
    result = generate(cfg)
    digests = write_outputs(result, args.out)
    for name, d in digests.items():
        print(f"{d[:16]}  {name}")
    t = result["truth"]
    print(f"{t['n_bookings']} bookings, {t['n_completed']} completed, {t['n_offers']} offers")
    return 0


if __name__ == "__main__":
    sys.exit(main())
