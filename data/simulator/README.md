# ServiGo simulator

Generates a year of Chennai bookings with known ground truth.

```bash
pip install -r ../../services/ml/requirements.txt h3 holidays
python -m servigo_sim.run --out ../generated/chennai --seed 7      # ~60k bookings
python -m pytest                                                   # reproducibility + sanity checks
```

Outputs `workshops.csv`, `customers.csv`, `vehicles.csv`, `bookings.csv`, `offers.csv` and
`ground_truth.json` (the rules the data was generated from). The same seed gives the same
bytes. Load into Supabase's `sim` schema with
`python -m servigo_sim.load_postgres DIR DATABASE_URL`.

## What is real and what is not

The localities, vehicle mix and symptom phrases are hand-written priors. With
`data/raw/cardekho.csv` present (see `data/scripts/download_datasets.py`) driving distance can be
scaled to the dataset's median km per year via `servigo_sim.calibration`. Nothing here is real
ServiGo data, and any result measured on it must be reported as simulated.

## Ground truth

| Quantity | Rule |
| --- | --- |
| Offer acceptance | logistic in distance, active jobs, night, workshop markup, plus a per-workshop effect |
| Duration | catalogue minutes x workshop efficiency x (1 + 0.025 x vehicle age) x lognormal noise |
| Price | catalogue x segment x workshop markup x lognormal noise x GST, with occasional parts surprises |
| Rating | falls with wait time and with price above the quote |

The exact coefficients are written to `ground_truth.json`, so a model can be scored on how
closely it recovers them.
