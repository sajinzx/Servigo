"""Write a model card (markdown) next to the code after each training run."""
from __future__ import annotations

from pathlib import Path
from typing import Any

TITLES = {
    "triage": ("M1 Symptom triage", "Which service does this problem description point to?"),
    "duration": ("M2 Job duration", "How long will this job take at this workshop?"),
    "price": ("M3 Price range", "What will this job likely cost, as a range?"),
    "acceptance": ("M4 Offer acceptance", "Will this workshop accept this offer?"),
    "demand": ("M5 Demand forecast", "How many bookings per area, category and hour next week?"),
    "service_due": ("M6 Next service due", "When will this vehicle need service, and how likely is it within 30 days?"),
    "anomaly": ("M7 Anomaly flags", "Is this booking unusual enough for an admin to look at?"),
}


def _fmt(v: Any) -> str:
    if isinstance(v, float):
        return f"{v:.4f}"
    return str(v)


def write_card(directory: Path, name: str, metrics: dict[str, Any], notes: dict[str, Any]) -> Path:
    title, question = TITLES[name]
    promo = metrics.get("promotion", {})
    lines = [
        f"# {title}",
        "",
        f"**Question:** {question}",
        "",
        f"**Version:** `{metrics.get('version', '?')}`  ",
        f"**Algorithm:** {notes.get('algorithm', '')}  ",
        f"**Baseline to beat:** {notes.get('baseline', '')}",
        "",
        "## Data",
        "",
        "Trained and tested on **simulated** ServiGo data (`data/simulator`). Splits are time-ordered: "
        "the model never sees rows later than the ones it is tested on. Numbers below say how well the "
        "model recovers the simulator's rules; they are not evidence of performance on real customers, "
        "which the pilot (docs/pilot-report.md) measures separately.",
        "",
        "## Result",
        "",
        "| Metric | Model | Baseline |",
        "| --- | --- | --- |",
    ]
    for k, v in sorted(metrics.items()):
        if k.startswith("baseline_") or k in {"version", "promotion", "coefficients", "true_coefficients", "n_test", "chosen"}:
            continue
        base = metrics.get(f"baseline_{k}")
        if isinstance(v, (int, float)):
            lines.append(f"| {k} | {_fmt(v)} | {_fmt(base) if base is not None else ''} |")
    if "n_test" in metrics:
        lines += ["", f"Test rows: {metrics['n_test']}"]
    if promo:
        lines += [
            "",
            f"**Promotion:** {'promoted' if promo.get('promoted') else 'not promoted'}: {promo.get('reason', '')}",
        ]
    if "coefficients" in metrics:
        lines += ["", "## Coefficients", "", "| Feature | Fitted | Simulator truth |", "| --- | --- | --- |"]
        truth = metrics.get("true_coefficients", {})
        for k, v in metrics["coefficients"].items():
            t = truth.get(k)
            lines.append(f"| {k} | {_fmt(v)} | {_fmt(t) if t is not None else ''} |")
    imp = notes.get("importance")
    if imp:
        lines += ["", "## Top features (gain share)", ""]
        for k, v in list(imp.items())[:6]:
            lines.append(f"- {k}: {v:.1%}")
    if notes.get("caveat"):
        lines += ["", f"**Caveat:** {notes['caveat']}"]
    lines += [
        "",
        "## Failure modes",
        "",
        "- Falls back to the baseline whenever the ML service is down or slower than 300 ms; "
        "bookings never depend on it.",
        "- Weekly drift check (PSI > 0.2 on the top features) raises a flag on the admin dashboard.",
        "",
    ]
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{name}.md"
    path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    return path
