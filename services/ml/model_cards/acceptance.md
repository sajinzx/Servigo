# M4 Offer acceptance

**Question:** Will this workshop accept this offer?

**Version:** `20261012210652`  
**Algorithm:** logistic regression vs LightGBM (better validation Brier), isotonic calibration  
**Baseline to beat:** smoothed per-workshop acceptance rate

## Data

Trained and tested on **simulated** ServiGo data (`data/simulator`). Splits are time-ordered: the model never sees rows later than the ones it is tested on. Numbers below say how well the model recovers the simulator's rules; they are not evidence of performance on real customers, which the pilot (docs/pilot-report.md) measures separately.

## Result

| Metric | Model | Baseline |
| --- | --- | --- |
| brier | 0.1940 | 0.1988 |
| mean_abs_error_vs_true_probability | 0.0349 |  |
| n | 11566 |  |
| roc_auc | 0.6752 | 0.6488 |

**Promotion:** promoted: promoted

## Coefficients

| Feature | Fitted | Simulator truth |
| --- | --- | --- |
| distance_km | -0.1450 | -0.1600 |
| active_jobs | -0.4454 | -0.5500 |
| night | -0.6305 | -0.7000 |
| markup | -3.1860 | -3.0000 |

## Failure modes

- Falls back to the baseline whenever the ML service is down or slower than 300 ms; bookings never depend on it.
- Weekly drift check (PSI > 0.2 on the top features) raises a flag on the admin dashboard.
