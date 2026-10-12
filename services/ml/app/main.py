"""ServiGo ML service.

Every endpoint answers even when no model has been trained or promoted yet: it
falls back to the baseline and says so in `model_version`. The Core API treats
this service as optional and enforces its own 300 ms budget.
"""
from __future__ import annotations

import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field
from scipy.optimize import linear_sum_assignment

from . import baselines, catalogue
from .features import with_catalogue
from .registry import Registry

ARTIFACT_DIR = Path(os.environ.get("ARTIFACT_DIR", "artifacts"))
API_KEY = os.environ.get("ML_API_KEY", "")


class State:
    registry: Registry
    models: dict[str, tuple[str, Any]]
    log_path: Path

    def __init__(self) -> None:
        self.registry = Registry(ARTIFACT_DIR)
        self.models = {}
        self.log_path = ARTIFACT_DIR / "prediction_log.jsonl"

    def reload(self) -> None:
        self.models = {}
        for name in ("triage", "duration", "price", "acceptance", "demand", "service_due", "anomaly"):
            try:
                loaded = self.registry.load_active(name)
            except Exception:  # a corrupt artifact must not take the service down
                loaded = None
            if loaded:
                self.models[name] = loaded

    def version(self, name: str) -> str:
        return self.models[name][0] if name in self.models else "baseline"

    def log(self, model: str, inputs: Any, output: Any, started: float) -> None:
        rec = {
            "at": time.time(), "model": model, "version": self.version(model),
            "inputs": inputs, "output": output, "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        }
        try:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.log_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(rec, default=float) + "\n")
        except OSError:
            pass  # logging must never fail a prediction


state = State()


@asynccontextmanager
async def lifespan(_: FastAPI):
    state.reload()
    yield


app = FastAPI(title="ServiGo ML service", version="2.0.0", lifespan=lifespan)


def require_key(x_ml_key: str | None = Header(default=None)) -> None:
    if API_KEY and x_ml_key != API_KEY:
        raise HTTPException(status_code=401, detail="bad key")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "servigo-ml", "models": {k: v[0] for k, v in state.models.items()}}


# ---- M1 -----------------------------------------------------------------------

class TriageIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    vehicle_kind: str = Field(pattern="^(car|bike)$")
    k: int = Field(default=3, ge=1, le=5)


@app.post("/triage", dependencies=[Depends(require_key)])
def triage(body: TriageIn) -> dict:
    t0 = time.perf_counter()
    if "triage" in state.models:
        ranked = state.models["triage"][1].predict_topk(body.text, body.vehicle_kind, body.k)
    else:
        codes = baselines.keyword_triage(body.text, body.vehicle_kind, body.k)
        ranked = [(c, 1.0 / (i + 1)) for i, c in enumerate(codes)]
    out = {
        "suggestions": [{"code": c, "name": catalogue.SERVICES[c][0], "probability": round(p, 4)} for c, p in ranked],
        "model_version": state.version("triage"),
    }
    state.log("triage", body.model_dump(), out["suggestions"], t0)
    return out


# ---- M2 / M3 ------------------------------------------------------------------

class JobIn(BaseModel):
    service_code: str
    segment: str = "hatchback"
    vehicle_age: float = Field(default=5.0, ge=0, le=40)
    km_since_service: float = Field(default=0.0, ge=0)
    hour: int = Field(default=10, ge=0, le=23)
    weekday: int = Field(default=1, ge=0, le=6)
    workshop_id: str | None = None


def _job_frame(b: JobIn) -> pd.DataFrame:
    if b.service_code not in catalogue.SERVICES:
        raise HTTPException(status_code=422, detail=f"unknown service {b.service_code}")
    row = {
        "service_code": b.service_code, "segment": b.segment, "vehicle_age": b.vehicle_age,
        "km_since_service": b.km_since_service, "hour": b.hour, "weekday": b.weekday,
        "is_holiday": 0, "mode": "workshop", "workshop_id": b.workshop_id,
        "category": catalogue.category(b.service_code), "vehicle_kind": catalogue.kind(b.service_code),
    }
    return with_catalogue(pd.DataFrame([row]))


@app.post("/predict/duration", dependencies=[Depends(require_key)])
def predict_duration(body: JobIn) -> dict:
    t0 = time.perf_counter()
    df = _job_frame(body)
    base = float(catalogue.base_duration(body.service_code))
    if "duration" in state.models:
        m = state.models["duration"][1]
        p = m.predict_minutes(df)
        out = {
            "minutes": round(float(p["minutes"][0]), 1), "low": round(float(p["low"][0]), 1),
            "high": round(float(p["high"][0]), 1),
            "why": [{"feature": f, "effect": round(v, 3)} for f, v in m.explain(m.with_workshop_stats(df, "wk_dur"))[0]],
        }
    else:
        out = {"minutes": base, "low": round(base * 0.8, 1), "high": round(base * 1.4, 1), "why": []}
    out["model_version"] = state.version("duration")
    state.log("duration", body.model_dump(), out, t0)
    return out


@app.post("/predict/price", dependencies=[Depends(require_key)])
def predict_price(body: JobIn) -> dict:
    t0 = time.perf_counter()
    df = _job_frame(body)
    exp = float(df["expected_price"].iloc[0])
    if "price" in state.models:
        m = state.models["price"][1]
        p = m.predict_price(df)
        out = {
            "low": round(float(p["low"][0]), 2), "median": round(float(p["median"][0]), 2),
            "high": round(float(p["high"][0]), 2),
            "why": [{"feature": f, "effect": round(v, 3)} for f, v in m.explain(m.with_workshop_stats(df, "wk_price"))[0]],
        }
    else:
        out = {"low": round(exp * 0.9, 2), "median": exp, "high": round(exp * 1.25, 2), "why": []}
    out["model_version"] = state.version("price")
    state.log("price", body.model_dump(), out, t0)
    return out


# ---- M4 -----------------------------------------------------------------------

class OfferIn(BaseModel):
    workshop_id: str
    distance_km: float = Field(ge=0)
    active_jobs: int = Field(default=0, ge=0)
    staff_count: int = Field(default=1, ge=1)
    hour: int = Field(default=10, ge=0, le=23)
    weekday: int = Field(default=1, ge=0, le=6)
    markup: float = 1.0
    rank: int = 1


class AcceptanceIn(BaseModel):
    offers: list[OfferIn] = Field(min_length=1, max_length=50)


@app.post("/predict/acceptance", dependencies=[Depends(require_key)])
def predict_acceptance(body: AcceptanceIn) -> dict:
    t0 = time.perf_counter()
    df = pd.DataFrame([o.model_dump() for o in body.offers])
    df["night"] = ((df.hour >= 20) | (df.hour < 8)).astype(int)
    if "acceptance" in state.models:
        probs = state.models["acceptance"][1].predict_proba(df)
    else:
        probs = np.full(len(df), 0.6)
    out = {
        "probabilities": {o.workshop_id: round(float(p), 4) for o, p in zip(body.offers, probs)},
        "model_version": state.version("acceptance"),
    }
    state.log("acceptance", {"n": len(body.offers)}, out["probabilities"], t0)
    return out


# ---- M6 -----------------------------------------------------------------------

class ServiceDueIn(BaseModel):
    kind: str = Field(pattern="^(car|bike)$")
    age_years: float = Field(default=5.0, ge=0, le=40)
    km_per_day: float = Field(default=25.0, gt=0, le=1000)
    days_since_service: float = Field(default=0.0, ge=0)
    within_days: float = Field(default=30.0, gt=0, le=365)


@app.post("/predict/service-due", dependencies=[Depends(require_key)])
def predict_service_due(body: ServiceDueIn) -> dict:
    t0 = time.perf_counter()
    if "service_due" in state.models:
        m = state.models["service_due"][1]
        df = pd.DataFrame({"km_per_day": [body.km_per_day], "age_years": [body.age_years],
                           "is_car": [1 if body.kind == "car" else 0]})
        median = float(m.median_days(df)[0])
        p = float(m.prob_due(df, np.array([body.days_since_service]), body.within_days)[0])
    else:
        # fixed rule: every 5,000 km or 6 months
        median = float(baselines.interval_rule_days(np.array([body.km_per_day]))[0])
        p = 1.0 if body.days_since_service + body.within_days >= median else 0.0
    out = {
        "median_days_between_services": round(median, 1),
        "days_left": round(max(median - body.days_since_service, 0.0), 1),
        "probability_due": round(p, 4),
        "within_days": body.within_days,
        "model_version": state.version("service_due"),
    }
    state.log("service_due", body.model_dump(), out, t0)
    return out


# ---- peak-load batch assignment (Hungarian) --------------------------------------

class Candidate(BaseModel):
    workshop_id: str
    score: float = Field(ge=0, le=1)


class BatchRequest(BaseModel):
    id: str
    candidates: list[Candidate]


class BatchIn(BaseModel):
    requests: list[BatchRequest] = Field(min_length=1, max_length=500)
    free_slots: dict[str, int]


@app.post("/assign/batch", dependencies=[Depends(require_key)])
def assign_batch(body: BatchIn) -> dict:
    """Minimum-cost assignment, cost = 1 - score; each workshop appears once per free slot."""
    t0 = time.perf_counter()
    cols: list[str] = []
    for w, n in body.free_slots.items():
        cols += [w] * max(0, n)
    if not cols:
        return {"assignments": {}, "unassigned": [r.id for r in body.requests]}
    BIG = 1e6
    cost = np.full((len(body.requests), len(cols)), BIG)
    for i, r in enumerate(body.requests):
        scores = {c.workshop_id: c.score for c in r.candidates}
        for j, w in enumerate(cols):
            if w in scores:
                cost[i, j] = 1.0 - scores[w]
    rows, picks = linear_sum_assignment(cost)
    assigned, unassigned = {}, []
    done = set()
    for i, j in zip(rows, picks):
        if cost[i, j] < BIG:
            assigned[body.requests[i].id] = cols[j]
            done.add(i)
    unassigned = [r.id for i, r in enumerate(body.requests) if i not in done]
    out = {"assignments": assigned, "unassigned": unassigned,
           "total_cost": round(float(sum(cost[i, j] for i, j in zip(rows, picks) if cost[i, j] < BIG)), 4)}
    state.log("assign_batch", {"n": len(body.requests)}, {"assigned": len(assigned)}, t0)
    return out


# ---- M5 / registry --------------------------------------------------------------

@app.get("/forecast", dependencies=[Depends(require_key)])
def forecast(cell: str | None = Query(default=None), category: str | None = None, limit: int = Query(default=500, le=5000)) -> dict:
    path = ARTIFACT_DIR / "forecast.csv"
    if not path.exists():
        return {"rows": [], "model_version": "baseline", "note": "no forecast has been produced yet"}
    df = pd.read_csv(path)
    if cell:
        df = df[df.h3_cell == cell]
    if category:
        df = df[df.category == category]
    return {"rows": df.head(limit).to_dict(orient="records"), "model_version": state.version("demand")}


@app.get("/models", dependencies=[Depends(require_key)])
def models() -> dict:
    out = []
    for s in state.registry.summary():
        entry = dict(s)
        if s["active"]:
            m = state.registry.metrics(s["name"], s["active"])
            entry["promotion"] = m.get("promotion")
        out.append(entry)
    return {"models": out}


class RollbackIn(BaseModel):
    version: str


@app.post("/models/{name}/rollback", dependencies=[Depends(require_key)])
def rollback(name: str, body: RollbackIn) -> dict:
    if body.version not in state.registry.versions(name):
        raise HTTPException(status_code=404, detail="unknown version")
    state.registry.rollback(name, body.version)
    state.reload()
    return {"name": name, "active": body.version}


@app.get("/allocation/weights", dependencies=[Depends(require_key)])
def allocation_weights() -> dict:
    p = ARTIFACT_DIR / "allocation_weights.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {"weights": {"eta": 0.35, "rating": 0.20, "load": 0.15, "accept": 0.20, "fairness": 0.10}, "source": "default"}
