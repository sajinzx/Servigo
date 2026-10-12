"""Nightly job: retrain from the latest data, refresh the demand forecast, check drift.

    python -m app.jobs.nightly --data DIR --out artifacts

Only versions that beat their baseline and the active model are promoted
(see registry.promote_if_better). The forecast covers the next 7 days.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import httpx
import pandas as pd

from .. import monitoring
from ..data import load_tables
from ..models import demand
from ..registry import Registry
from ..training import pipeline


def write_forecast(reg: Registry, bookings: pd.DataFrame, out: Path) -> pd.DataFrame | None:
    loaded = reg.load_active("demand")
    if not loaded:
        return None
    version, model = loaded
    start = bookings.created_at.min().floor("D")
    end = bookings.created_at.max().ceil("D")
    panel = demand.build_panel(bookings, start, end)
    fc = model.forecast_next_week(panel, origin=end)
    fc["model_version"] = version
    out.mkdir(parents=True, exist_ok=True)
    fc.to_csv(out / "forecast.csv", index=False, float_format="%.4f")
    return fc


def upsert_supabase(fc: pd.DataFrame) -> None:
    """Best-effort write to demand_forecasts through PostgREST; skipped when not configured."""
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return
    rows = [
        {"h3_cell": r.h3_cell, "category": r.category, "hour_ts": r.hour_ts.isoformat(),
         "yhat": float(r.yhat), "yhat_lo": float(r.yhat_lo), "yhat_hi": float(r.yhat_hi),
         "model_version": r.model_version}
        for r in fc.itertuples()
    ]
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
               "Prefer": "resolution=merge-duplicates"}
    with httpx.Client(timeout=30) as c:
        for i in range(0, len(rows), 1000):
            c.post(f"{url}/rest/v1/demand_forecasts?on_conflict=h3_cell,category,hour_ts", headers=headers,
                   json=rows[i:i + 1000]).raise_for_status()


def drift(bookings: pd.DataFrame, recent_days: int = 28) -> dict:
    cut = bookings.created_at.max() - pd.Timedelta(days=recent_days)
    train, recent = bookings[bookings.created_at <= cut], bookings[bookings.created_at > cut]
    return monitoring.drift_report(
        train, recent, ["vehicle_age", "km_since_service", "hour", "weekday", "quote_high"]
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True, type=Path)
    p.add_argument("--out", default=Path("artifacts"), type=Path)
    a = p.parse_args(argv)

    results = pipeline.run(a.data, a.out)
    tables = load_tables(a.data)
    reg = Registry(a.out)
    fc = write_forecast(reg, tables["bookings"], a.out)
    if fc is not None:
        upsert_supabase(fc)
    report = drift(tables["bookings"])
    (a.out / "drift.json").write_text(json.dumps(report, indent=2, default=float), encoding="utf-8")
    flagged = [k for k, v in report.items() if v["alert"]]
    print(f"trained {len(results)} models; drift alerts: {flagged or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
