# M5 Demand forecast

**Question:** How many bookings per area, category and hour next week?

**Version:** `20261012211334`  
**Algorithm:** LightGBM (Poisson) with weekly lag features per H3 cell and category  
**Baseline to beat:** same hour last week

## Data

Trained and tested on **simulated** ServiGo data (`data/simulator`). Splits are time-ordered: the model never sees rows later than the ones it is tested on. Numbers below say how well the model recovers the simulator's rules; they are not evidence of performance on real customers, which the pilot (docs/pilot-report.md) measures separately.

## Result

| Metric | Model | Baseline |
| --- | --- | --- |
| wape | 1.7554 | 1.8783 |
| wape_cell_day | 0.4268 | 0.5757 |

Test rows: 559104

**Promotion:** promoted: promoted

## Failure modes

- Falls back to the baseline whenever the ML service is down or slower than 300 ms; bookings never depend on it.
- Weekly drift check (PSI > 0.2 on the top features) raises a flag on the admin dashboard.
