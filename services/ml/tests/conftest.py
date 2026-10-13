import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "data" / "simulator"))


@pytest.fixture(scope="session")
def sim_dir(tmp_path_factory):
    """A small simulated marketplace (about 150 days), generated once per test session."""
    from servigo_sim.generate import SimConfig, generate
    from servigo_sim.run import write_outputs

    out = tmp_path_factory.mktemp("sim")
    cfg = SimConfig(seed=5, days=150, n_workshops=30, n_customers=3000, target_bookings=9000)
    write_outputs(generate(cfg), out)
    return out


@pytest.fixture(scope="session")
def trained(sim_dir, tmp_path_factory):
    """Train every model once and return (registry root, results, model-card dir)."""
    from app.training import pipeline

    root = tmp_path_factory.mktemp("artifacts")
    cards = tmp_path_factory.mktemp("cards")
    results = pipeline.run(sim_dir, root, cards_dir=cards)
    return root, results, cards
