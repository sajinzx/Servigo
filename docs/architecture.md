# Architecture

```
            ┌────────────────────┐        ┌────────────────────────────────────────┐
 browser ──▶│ apps/web (Vercel)  │──reads▶│ Supabase: Postgres + RLS, Auth, Realtime│
 (PWA)      │ React 19, Vite, TS │        │ Storage, pg_cron                        │
            └─────────┬──────────┘        └───────▲───────────────▲────────────────┘
                      │ writes (JWT)              │ service role  │ DATABASE_URL
                      ▼                           │               │
            ┌────────────────────┐   rpc          │      ┌────────┴──────────┐
            │ apps/api (Render)  │────────────────┘      │ worker (Render)   │
            │ Express 5, zod     │                       │ claims jobs, sends │
            └─────────┬──────────┘                       │ messages, PDFs,    │
                      │ ≤300 ms, optional                │ dispatches offers  │
                      ▼                                  └────────┬──────────┘
            ┌────────────────────┐                                │ OSRM table, WhatsApp, MSG91,
            │ services/ml        │◀── predictions ────────────────┘ Resend, FCM
            │ FastAPI, LightGBM  │
            └────────────────────┘
```

## Rules the design follows

1. **Fundamentals before ML.** Every model sits behind a rule. The API and worker run with the ML service off.
2. **The database is the source of truth.** Status changes, capacity, ratings, money and trust rules are SQL
   functions, constraints and RLS. The API is a thin, validated front for those functions.
3. **No fake data in production tables.** Ratings come from reviews, payments from confirmed UTRs or
   gateway events, and synthetic rows live in the `sim` schema.

## A booking, end to end

1. Customer picks a vehicle and describes the problem. `POST /api/triage` returns three services (model, or
   keyword rules if the ML service is slow). `GET /api/quote` returns a GST-inclusive range and a time
   estimate (model, or catalogue × segment factor).
2. `POST /api/bookings` validates a **strict** body (no price field exists), computes the band on the server
   and calls `create_booking()`, which inserts the booking, moves it to `matching` and queues a
   `dispatch.booking` job **in the same transaction**.
3. The worker claims that job. `find_candidates()` applies the hard filters (service offered and not paused,
   vehicle kind, open now, free staff, probation caps, not already tried). OSRM gives drive times with a
   haversine fallback. The score is
   `0.35·ETA + 0.20·Bayesian rating + 0.15·load + 0.20·P(accept) + 0.10·fairness`.
4. `create_offer()` locks the booking and workshop, writes the offer, moves the booking to `offered` and
   queues a delayed `offer.timeout` job for 90 s. The same status change queues the notification:
   push, then WhatsApp after 20 s if unanswered and not delivered, then SMS.
5. The workshop accepts (`respond_offer`), which re-checks capacity under a row lock. A reject or timeout
   goes back to `matching` for the next shop; after three misses the radius widens, and past 40 km the
   booking ends as `no_match` and the customer is told.
6. `accepted → in_progress → completed`. Completion takes labour and parts, and the server computes the
   GST-inclusive total. More than 15% above the top of the quote needs the customer's approval first.
7. Payment: UPI link or QR (UTR then confirmation) or Razorpay (webhook). Confirmation writes a balanced
   ledger journal, issues exactly one invoice, and queues the PDF.
8. Weekly: confirmed payments older than 72 h are batched into payouts, minus any refunds.

## Durable queue

The `outbox` table is the queue. Rows are written in the transaction that caused them and claimed with
`FOR UPDATE SKIP LOCKED` and a visibility timeout, so a crashed worker's job reappears. Retries back off
10 s, 1 min, 5 min, 30 min, 2 h with jitter, then go to the dead letter (visible in Admin > Models).
Notification idempotency keys make a retried job unable to send the same message twice.

## Migrations

| File | Purpose |
| --- | --- |
| `0001_profiles` | profiles, role guard, auth hooks |
| `0002_core_schema`, `0003_booking_logic`, `0004_rls` | domain tables, `transition_booking`, RLS |
| `0005_queue_and_notifications` | claim / complete / fail, notification log |
| `0006_allocation` | candidate search, offers, cascade |
| `0007_geo.postgis`, `0099_find_candidates.postgis` | PostGIS columns and the generated `ST_DWithin` search (Supabase only) |
| `0008_cron.supabase`, `0014_storage.supabase` | pg_cron and storage buckets (Supabase only) |
| `0009_onboarding_trust` | applications, KYC, strikes, disputes, appeals |
| `0010_payments` | payments, ledger, invoices, refunds, payouts |
| `0011_ml`, `0012_admin_reporting`, `0013_customer_onboarding`, `0015_pilot_export` | ML tables, admin views, onboarding gate, pilot export |

Files ending `.postgis.sql` or `.supabase.sql` need extensions the in-process test database does not have;
everything else runs in CI on every push.
