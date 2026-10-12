# Pilot report

**Status: the pilot has not been run.** There are no real numbers in this repository, and none are
filled in from the simulator.

When the pilot ends:

```bash
# 1. export the pilot window from the database (admin or service role)
psql "$DATABASE_URL" -c "\copy (select * from public.pilot_export_bookings('2026-11-02','2026-11-30'))      to data/pilot/bookings.csv csv header"
psql "$DATABASE_URL" -c "\copy (select * from public.pilot_export_offers('2026-11-02','2026-11-30'))        to data/pilot/offers.csv csv header"
psql "$DATABASE_URL" -c "\copy (select * from public.pilot_export_notifications('2026-11-02','2026-11-30')) to data/pilot/notifications.csv csv header"

# 2. (optional) store the headline numbers in pilot_metrics with source = 'real'
psql "$DATABASE_URL" -c "select public.compute_pilot_metrics('pilot','2026-11-02','2026-11-30')"

# 3. simulated column: re-run the simulator with the pilot's workshops, then
python -m servigo_sim.run --out data/generated/pilot --seed 7 --workshops 12 --customers 100 --bookings 400
#    and save the matching metrics as sim_metrics.json (keys as in services/ml/app/pilot_report.py ROWS)

# 4. write this file
cd services/ml && python -m app.pilot_report --real ../../data/pilot --sim ../../data/pilot/sim_metrics.json --period "2 to 30 Nov 2026"
```

The generated report has one row per metric with **Simulated**, **Real (pilot)** with its sample size and 95%
bootstrap interval, and the gap. A metric with no real rows shows `no data`. It also states whether the
duration model beats the catalogue baseline on real jobs, which is the plan's rule for switching a model back.

See `docs/runbook.md` for support during the pilot and `docs/milestones.md` for what is built.
