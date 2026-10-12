# M1 Symptom triage

**Question:** Which service does this problem description point to?

**Version:** `20261012210625`  
**Algorithm:** TF-IDF (word + char n-grams) + logistic regression  
**Baseline to beat:** keyword rules

## Data

Trained and tested on **simulated** ServiGo data (`data/simulator`). Splits are time-ordered: the model never sees rows later than the ones it is tested on. Numbers below say how well the model recovers the simulator's rules; they are not evidence of performance on real customers, which the pilot (docs/pilot-report.md) measures separately.

## Result

| Metric | Model | Baseline |
| --- | --- | --- |
| macro_f1 | 1.0000 | 0.7893 |
| top3_accuracy | 1.0000 | 0.9796 |

Test rows: 8972

**Promotion:** promoted: promoted

## Failure modes

- Falls back to the baseline whenever the ML service is down or slower than 300 ms; bookings never depend on it.
- Weekly drift check (PSI > 0.2 on the top features) raises a flag on the admin dashboard.
