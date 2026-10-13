import importlib

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.monitoring import PSI_ALERT, drift_report, psi
from app.registry import Registry


class TestPromotion:
    def test_a_model_that_loses_to_its_baseline_is_not_promoted(self, tmp_path):
        reg = Registry(tmp_path)
        reg.save("duration", "v1", {"x": 1}, {})
        ok, why = reg.promote_if_better("duration", "v1", "mae", 30.0, 25.0, higher_is_better=False)
        assert not ok and "baseline" in why
        assert reg.active("duration") is None

    def test_a_winner_becomes_active(self, tmp_path):
        reg = Registry(tmp_path)
        reg.save("duration", "v1", {"x": 1}, {})
        ok, _ = reg.promote_if_better("duration", "v1", "mae", 15.0, 25.0, higher_is_better=False)
        assert ok
        assert reg.active("duration").version == "v1"
        assert reg.load_active("duration")[1] == {"x": 1}

    def test_a_worse_retrain_does_not_replace_the_active_model(self, tmp_path):
        reg = Registry(tmp_path)
        for v in ("v1", "v2"):
            reg.save("duration", v, {"v": v}, {})
        reg.promote_if_better("duration", "v1", "mae", 15.0, 25.0, False)
        ok, why = reg.promote_if_better("duration", "v2", "mae", 18.0, 25.0, False)
        assert not ok and "active" in why
        assert reg.active("duration").version == "v1"

    def test_a_better_retrain_replaces_it(self, tmp_path):
        reg = Registry(tmp_path)
        for v in ("v1", "v2"):
            reg.save("duration", v, {"v": v}, {})
        reg.promote_if_better("duration", "v1", "mae", 15.0, 25.0, False)
        ok, _ = reg.promote_if_better("duration", "v2", "mae", 12.0, 25.0, False)
        assert ok and reg.active("duration").version == "v2"

    def test_higher_is_better_metrics(self, tmp_path):
        reg = Registry(tmp_path)
        reg.save("acceptance", "v1", {}, {})
        assert not reg.promote_if_better("acceptance", "v1", "auc", 0.60, 0.65, True)[0]
        assert reg.promote_if_better("acceptance", "v1", "auc", 0.70, 0.65, True)[0]

    def test_rollback_points_serving_at_an_older_version(self, tmp_path):
        reg = Registry(tmp_path)
        reg.save("price", "v1", {"v": 1}, {"promotion": {"metric": "pinball", "score": 90.0, "higher_is_better": False}})
        reg.save("price", "v2", {"v": 2}, {})
        reg.promote_if_better("price", "v2", "pinball", 80.0, 100.0, False)
        reg.rollback("price", "v1")
        assert reg.active("price").version == "v1"


class TestMonitoring:
    def test_same_distribution_is_stable(self):
        rng = np.random.default_rng(0)
        a, b = pd.Series(rng.normal(0, 1, 5000)), pd.Series(rng.normal(0, 1, 5000))
        assert psi(a, b) < 0.05

    def test_a_shifted_distribution_raises_the_alert(self):
        rng = np.random.default_rng(0)
        a, b = pd.Series(rng.normal(0, 1, 5000)), pd.Series(rng.normal(1.5, 1, 5000))
        assert psi(a, b) > PSI_ALERT

    def test_report_flags_only_the_drifted_feature(self):
        rng = np.random.default_rng(1)
        train = pd.DataFrame({"a": rng.normal(0, 1, 3000), "b": rng.normal(0, 1, 3000)})
        recent = pd.DataFrame({"a": rng.normal(0, 1, 3000), "b": rng.normal(2, 1, 3000)})
        rep = drift_report(train, recent, ["a", "b"])
        assert not rep["a"]["alert"] and rep["b"]["alert"]

    def test_constant_feature_does_not_crash(self):
        assert psi(pd.Series([1.0] * 100), pd.Series([1.0] * 100)) == 0.0


@pytest.fixture()
def client_no_models(tmp_path, monkeypatch):
    monkeypatch.setenv("ARTIFACT_DIR", str(tmp_path))
    monkeypatch.delenv("ML_API_KEY", raising=False)
    import app.main as m

    importlib.reload(m)
    with TestClient(m.app) as c:
        yield c


class TestFallbacks:
    def test_every_endpoint_answers_without_any_model(self, client_no_models):
        c = client_no_models
        t = c.post("/triage", json={"text": "brake noise", "vehicle_kind": "car"}).json()
        assert t["model_version"] == "baseline"
        assert t["suggestions"][0]["code"] == "CAR_003"

        d = c.post("/predict/duration", json={"service_code": "CAR_002"}).json()
        assert d["model_version"] == "baseline" and d["minutes"] == 45

        p = c.post("/predict/price", json={"service_code": "CAR_001", "segment": "suv"}).json()
        assert p["model_version"] == "baseline"
        assert p["median"] == 3982.5 and p["low"] < p["median"] < p["high"]

        a = c.post("/predict/acceptance", json={"offers": [{"workshop_id": "w1", "distance_km": 3}]}).json()
        assert a["probabilities"]["w1"] == 0.6

        f = c.get("/forecast").json()
        assert f["rows"] == []

    def test_unknown_service_is_a_422(self, client_no_models):
        r = client_no_models.post("/predict/duration", json={"service_code": "NOPE"})
        assert r.status_code == 422

    def test_batch_assignment_beats_greedy_order(self, client_no_models):
        body = {
            "requests": [
                {"id": "r1", "candidates": [{"workshop_id": "A", "score": 0.9}, {"workshop_id": "B", "score": 0.8}]},
                {"id": "r2", "candidates": [{"workshop_id": "A", "score": 0.9}]},
            ],
            "free_slots": {"A": 1, "B": 1},
        }
        out = client_no_models.post("/assign/batch", json=body).json()
        # greedy would give A to r1 and strand r2; the optimal assignment serves both
        assert out["assignments"] == {"r1": "B", "r2": "A"}
        assert out["unassigned"] == []

    def test_batch_with_no_free_slots_assigns_nothing(self, client_no_models):
        out = client_no_models.post("/assign/batch", json={
            "requests": [{"id": "r1", "candidates": [{"workshop_id": "A", "score": 0.9}]}],
            "free_slots": {"A": 0},
        }).json()
        assert out["assignments"] == {} and out["unassigned"] == ["r1"]

    def test_default_allocation_weights(self, client_no_models):
        w = client_no_models.get("/allocation/weights").json()
        assert abs(sum(w["weights"].values()) - 1.0) < 1e-9

    def test_api_key_is_enforced_when_set(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARTIFACT_DIR", str(tmp_path))
        monkeypatch.setenv("ML_API_KEY", "s3cret")
        import app.main as m

        importlib.reload(m)
        with TestClient(m.app) as c:
            assert c.post("/triage", json={"text": "x", "vehicle_kind": "car"}).status_code == 401
            ok = c.post("/triage", json={"text": "x", "vehicle_kind": "car"}, headers={"X-ML-Key": "s3cret"})
            assert ok.status_code == 200
            assert c.get("/health").status_code == 200  # health stays open for uptime pings


def test_served_models_log_predictions(trained, monkeypatch):
    root, _, _ = trained
    monkeypatch.setenv("ARTIFACT_DIR", str(root))
    monkeypatch.delenv("ML_API_KEY", raising=False)
    import app.main as m

    importlib.reload(m)
    with TestClient(m.app) as c:
        h = c.get("/health").json()
        assert "duration" in h["models"]
        r = c.post("/predict/duration", json={"service_code": "CAR_001", "segment": "suv", "vehicle_age": 6}).json()
        assert r["model_version"] == h["models"]["duration"]
        assert r["low"] <= r["minutes"] <= r["high"]
        assert len(r["why"]) == 3
        models = c.get("/models").json()["models"]
        assert {x["name"] for x in models} >= {"triage", "duration", "price"}
    log = (root / "prediction_log.jsonl").read_text(encoding="utf-8").strip().splitlines()
    assert any('"model": "duration"' in line for line in log)
