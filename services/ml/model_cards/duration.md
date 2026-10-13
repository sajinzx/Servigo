# M2 Job duration

**Question:** How long will this job take at this workshop?

**Version:** `20261012210641`  
**Algorithm:** LightGBM on log(actual / catalogue minutes), plus 10th/90th percentile models  
**Baseline to beat:** catalogue base_duration_min

## Data

Trained and tested on **simulated** ServiGo data (`data/simulator`). Splits are time-ordered: the model never sees rows later than the ones it is tested on. Numbers below say how well the model recovers the simulator's rules; they are not evidence of performance on real customers, which the pilot (docs/pilot-report.md) measures separately.

## Result

| Metric | Model | Baseline |
| --- | --- | --- |
| coverage_80 | 0.7738 |  |
| mae | 15.5012 | 21.4865 |

Test rows: 8127

**Promotion:** promoted: promoted

## Top features (gain share)

- wk_dur: 73.3%
- vehicle_age: 17.0%
- km_since_service: 3.8%
- service_code: 1.9%
- hour: 1.6%
- weekday: 1.1%

## Failure modes

- Falls back to the baseline whenever the ML service is down or slower than 300 ms; bookings never depend on it.
- Weekly drift check (PSI > 0.2 on the top features) raises a flag on the admin dashboard.
