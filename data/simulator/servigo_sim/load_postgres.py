"""Load generated CSVs into the `sim` schema.

python -m servigo_sim.load_postgres DIR DATABASE_URL
"""
from __future__ import annotations

import sys
from pathlib import Path

TABLES = ["workshops", "customers", "vehicles", "bookings", "offers"]


def main(directory: str, dsn: str) -> int:
    import psycopg  # imported lazily: only needed for loading

    here = Path(__file__).resolve().parents[1]
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute((here / "sql" / "sim_schema.sql").read_text())
        for t in TABLES:
            cur.execute(f"truncate sim.{t}")
            with open(Path(directory) / f"{t}.csv", "rb") as f, cur.copy(
                f"copy sim.{t} from stdin with (format csv, header true)"
            ) as cp:
                while chunk := f.read(1 << 16):
                    cp.write(chunk)
            print(f"loaded sim.{t}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(*sys.argv[1:]))
