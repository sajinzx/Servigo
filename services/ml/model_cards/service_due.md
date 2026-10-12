# M6 Next service due

**Question:** When will this vehicle need service, and how likely is it within 30 days?

**Version:** `20261012211012`  
**Algorithm:** Weibull accelerated failure time (lifelines); Cox PH fitted alongside  
**Baseline to beat:** service every 5,000 km or 6 months

## Data

Trained and tested on **simulated** ServiGo data (`data/simulator`). Splits are time-ordered: the model never sees rows later than the ones it is tested on. Numbers below say how well the model recovers the simulator's rules; they are not evidence of performance on real customers, which the pilot (docs/pilot-report.md) measures separately.

## Result

| Metric | Model | Baseline |
| --- | --- | --- |
| concordance | 0.6522 | 0.6243 |
| mae_days | 119.0653 | 139.2791 |
| n_events | 11604 |  |

Test rows: 35605

**Promotion:** promoted: promoted

## Coefficients

| Feature | Fitted | Simulator truth |
| --- | --- | --- |
| age_years | 0.0059 |  |
| is_car | 0.0070 |  |
| km_per_day | -0.0122 |  |
| Intercept | 6.1865 |  |

## Failure modes

- Falls back to the baseline whenever the ML service is down or slower than 300 ms; bookings never depend on it.
- Weekly drift check (PSI > 0.2 on the top features) raises a flag on the admin dashboard.
