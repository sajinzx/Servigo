# ServiGo

A location-aware marketplace for vehicle service. A customer describes a problem in plain words, sees a
price range and a time estimate, and is matched to the best nearby verified workshop within seconds. The
workshop sees a live queue; the admin sees demand, fairness and model health. Payments are UPI or card,
with a GST invoice for every job.

> ServiGo 2.0 is a rebuild of the original React + Express + MySQL demo. Read
> [`docs/audit-status.md`](docs/audit-status.md) for what was wrong with 1.0 and
> [`docs/milestones.md`](docs/milestones.md) for what is built, what needs your accounts, and where the
> results disagree with the plan.

## Layout

```
apps/web/            React 19 + Vite + TypeScript, Tailwind on design tokens, MapLibre (customer, workshop, admin)
apps/api/            Express 5 + TypeScript + zod: Core API and the background worker
services/ml/         FastAPI + LightGBM + lifelines: seven models, registry, nightly job, model cards
supabase/migrations/ Schema, RLS, business rules (SQL functions), queue, ledger, reporting
supabase/seed.sql    Catalogue and the 15 demo workshops, carried over from 1.0
data/simulator/      Reproducible marketplace simulator with ground-truth coefficients
data/scripts/        Public dataset downloader
docs/                Architecture, audit, security, runbook, allocation evaluation, pilot report
```

## How it fits together

See [`docs/architecture.md`](docs/architecture.md). In one paragraph: the browser reads simple data straight
from Supabase under Row Level Security and sends every write to the Core API; business rules live in
Postgres functions (one function changes a booking's status, one writes the ledger); side effects go
through a transactional outbox that a worker delivers with retries; and the ML service is optional, because
every model sits behind a rule-based baseline.

## Quick start

Requirements: Node 20+, Python 3.11+, a Supabase project.

```bash
npm install
pip install -r services/ml/requirements.txt h3 holidays

# database: apply supabase/migrations/*.sql in order, then supabase/seed.sql
# (the Supabase CLI does this: `supabase db push && psql ... -f supabase/seed.sql`)

cp apps/api/.env.example apps/api/.env      # fill in the Supabase URL, service key, JWT secret
cp apps/web/.env.example apps/web/.env      # Supabase URL and anon key, API URL

npm run dev:api        # http://localhost:3000   (GET /health, /ready)
npm run worker:dev -w apps/api                  # queue worker (needs DATABASE_URL)
npm run dev:web        # http://localhost:5173

# optional: train the models on a simulated year and serve them
cd data/simulator && python -m servigo_sim.run --out ../generated/chennai --seed 7
cd ../../services/ml && python -m app.training.pipeline --data ../../data/generated/chennai --out artifacts
uvicorn app.main:app --port 8000
```

To make the first admin, sign in once, then in the SQL editor:
`update public.profiles set role = 'admin' where id = '<your user id>';`

## Tests

```bash
npm test                         # API (Jest + an in-process Postgres running every migration) and web (Vitest)
cd services/ml && python -m pytest
cd data/simulator && python -m pytest
python supabase/tools/gen_postgis_find_candidates.py --check
```

The database tests run the real migrations on an in-process Postgres (PGlite) with a small stand-in for
Supabase's `auth` schema. That covers the state machine, RLS, queue, ledger and trust rules. It cannot cover
PostGIS or `pg_cron`, so those two migrations (`*.postgis.sql`, `*.supabase.sql`) are only exercised on a
real Supabase project.

## Configuration

Every secret comes from the environment; see each app's `.env.example`. Nothing is committed. Anything
unset degrades gracefully: no ML service means baselines, no WhatsApp credentials means the fallback chain
moves to the next channel, no Razorpay keys means the card option reports that it is not configured.

## Deploy

- Web: Vercel, using `apps/web/vercel.json`.
- API, worker, ML service: Render, using `render.yaml`. The worker needs a plan that does not sleep.
- Database: Supabase. Run the restore drill (`scripts/restore-drill.sh`) before the pilot.
- GitHub Actions: `ci.yml` on every push, `nightly.yml` retrains and refreshes the forecast, `uptime.yml`
  pings the free hosts.

## Security

The 1.0 code committed a database password and two JWT secrets. They are gone from the tree but remain in
git history: **rotate them**. See [`docs/security.md`](docs/security.md).

## What is not done

No pilot has been run, so there are no real-world metrics (`docs/pilot-report.md` says so). The UI has not
been exercised in a browser against a live backend. The WhatsApp, DLT SMS, FCM, Razorpay and PostGIS
integrations are written but untested against the real services. Details in
[`docs/milestones.md`](docs/milestones.md).

## Map data

© OpenStreetMap contributors (ODbL). The app footer carries the attribution.
