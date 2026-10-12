"""A small file-based model registry.

    artifacts/<model>/<version>/model.joblib
    artifacts/<model>/<version>/metrics.json
    artifacts/<model>/active.json      -> the version that serves traffic

A version only becomes active if it beats its baseline and (when there is one)
the currently active version, on the latest time-ordered test split. In
production the same records are mirrored into Supabase's model_registry table.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib


@dataclass
class Active:
    name: str
    version: str
    metric: str
    score: float
    higher_is_better: bool


class Registry:
    def __init__(self, root: str | Path):
        self.root = Path(root)

    def _dir(self, name: str, version: str) -> Path:
        return self.root / name / version

    @staticmethod
    def new_version() -> str:
        return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

    def save(self, name: str, version: str, obj: Any, metrics: dict[str, Any]) -> Path:
        d = self._dir(name, version)
        d.mkdir(parents=True, exist_ok=True)
        joblib.dump(obj, d / "model.joblib", compress=3)
        (d / "metrics.json").write_text(json.dumps(metrics, indent=2, sort_keys=True, default=float), encoding="utf-8")
        return d

    def _active_path(self, name: str) -> Path:
        return self.root / name / "active.json"

    def active(self, name: str) -> Active | None:
        p = self._active_path(name)
        if not p.exists():
            return None
        return Active(**json.loads(p.read_text(encoding="utf-8")))

    def load_active(self, name: str):
        a = self.active(name)
        if a is None:
            return None
        return a.version, joblib.load(self._dir(name, a.version) / "model.joblib")

    def metrics(self, name: str, version: str) -> dict[str, Any]:
        return json.loads((self._dir(name, version) / "metrics.json").read_text(encoding="utf-8"))

    def versions(self, name: str) -> list[str]:
        d = self.root / name
        return sorted(p.name for p in d.iterdir() if p.is_dir()) if d.exists() else []

    def promote_if_better(
        self,
        name: str,
        version: str,
        metric: str,
        score: float,
        baseline_score: float,
        higher_is_better: bool,
    ) -> tuple[bool, str]:
        """Activate `version` only if it beats the baseline and the current active model."""
        def better(a: float, b: float) -> bool:
            return a > b if higher_is_better else a < b

        if not better(score, baseline_score):
            return False, f"{metric} {score:.4f} does not beat the baseline {baseline_score:.4f}"
        current = self.active(name)
        if current is not None and not better(score, current.score):
            return False, f"{metric} {score:.4f} does not beat active {current.version} ({current.score:.4f})"
        self._active_path(name).write_text(
            json.dumps(
                {"name": name, "version": version, "metric": metric, "score": score,
                 "higher_is_better": higher_is_better}, indent=2),
            encoding="utf-8",
        )
        return True, "promoted"

    def rollback(self, name: str, version: str) -> None:
        """Point serving back at an earlier version (the admin 'roll back' button)."""
        m = self.metrics(name, version)
        spec = m.get("promotion", {})
        self._active_path(name).write_text(
            json.dumps(
                {"name": name, "version": version, "metric": spec.get("metric", ""),
                 "score": spec.get("score", 0.0), "higher_is_better": spec.get("higher_is_better", True)}, indent=2),
            encoding="utf-8",
        )

    def summary(self) -> list[dict[str, Any]]:
        out = []
        if not self.root.exists():
            return out
        for d in sorted(p for p in self.root.iterdir() if p.is_dir()):
            a = self.active(d.name)
            out.append({"name": d.name, "active": a.version if a else None,
                        "versions": self.versions(d.name)})
        return out
