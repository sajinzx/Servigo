# M3 Price range

**Question:** What will this job likely cost, as a range?

**Version:** `20261012210649`  
**Algorithm:** LightGBM quantile regression (0.1 / 0.5 / 0.9) on log(price / catalogue)  
**Baseline to beat:** catalogue price x segment factor x GST, with the +-band of the quote

## Data

Trained and tested on **simulated** ServiGo data (`data/simulator`). Splits are time-ordered: the model never sees rows later than the ones it is tested on. Numbers below say how well the model recovers the simulator's rules; they are not evidence of performance on real customers, which the pilot (docs/pilot-report.md) measures separately.

## Result

| Metric | Model | Baseline |
| --- | --- | --- |
| coverage_80 | 0.7726 | 0.6638 |
| mean_band_width | 735.8698 |  |
| pinball_loss | 94.9251 | 105.2551 |

Test rows: 8127

**Promotion:** promoted: promoted

## Top features (gain share)

- wk_price: 54.8%
- km_since_service: 13.2%
- vehicle_age: 13.0%
- hour: 5.8%
- service_code: 5.0%
- weekday: 4.0%

## Failure modes

- Falls back to the baseline whenever the ML service is down or slower than 300 ms; bookings never depend on it.
- Weekly drift check (PSI > 0.2 on the top features) raises a flag on the admin dashboard.
