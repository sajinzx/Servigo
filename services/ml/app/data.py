"""Loading simulator output (or, later, the same tables exported from Supabase) and splitting by time."""
from __future__ import annotations

from pathlib import Path

import pandas as pd


def load_tables(directory: str | Path) -> dict[str, pd.DataFrame]:
    d = Path(directory)
    t = {
        name: pd.read_csv(d / f"{name}.csv")
        for name in ("workshops", "customers", "vehicles", "bookings", "offers")
    }
    t["bookings"]["created_at"] = pd.to_datetime(t["bookings"]["created_at"])
    t["offers"]["offered_at"] = pd.to_datetime(t["offers"]["offered_at"])
    return t


def time_split(df: pd.DataFrame, column: str, fractions=(0.70, 0.15, 0.15)):
    """Train on the earliest rows, validate on the next, test on the latest.

    Never a random split: with time-ordered data a random split leaks the future
    into training for every model here.
    """
    if abs(sum(fractions) - 1.0) > 1e-9:
        raise ValueError("fractions must sum to 1")
    ordered = df.sort_values(column, kind="stable").reset_index(drop=True)
    n = len(ordered)
    a = int(n * fractions[0])
    b = int(n * (fractions[0] + fractions[1]))
    return ordered.iloc[:a].copy(), ordered.iloc[a:b].copy(), ordered.iloc[b:].copy()
