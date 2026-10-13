# M7 Anomaly flags

**Question:** Is this booking unusual enough for an admin to look at?

**Version:** `20261012211017`  
**Algorithm:** Isolation Forest  
**Baseline to beat:** random selection (no rule exists)

## Data

Trained and tested on **simulated** ServiGo data (`data/simulator`). Splits are time-ordered: the model never sees rows later than the ones it is tested on. Numbers below say how well the model recovers the simulator's rules; they are not evidence of performance on real customers, which the pilot (docs/pilot-report.md) measures separately.

## Result

| Metric | Model | Baseline |
| --- | --- | --- |
| base_rate | 0.0269 |  |
| k | 100 |  |
| precision_at_k | 0.1800 | 0.0300 |

**Promotion:** promoted: promoted

**Caveat:** labels are the simulator's price surprises, not hand-labelled cases

## Failure modes

- Falls back to the baseline whenever the ML service is down or slower than 300 ms; bookings never depend on it.
- Weekly drift check (PSI > 0.2 on the top features) raises a flag on the admin dashboard.
