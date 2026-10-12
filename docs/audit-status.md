# Audit of ServiGo 1.0, and where each item was fixed

The 20 issues from the implementation plan (section 1), what changed, and the test that keeps it fixed.

## Security and correctness

| # | Problem in 1.0 | Fix in 2.0 | Guarded by |
| --- | --- | --- | --- |
| A1 | Plain-text passwords, bcrypt commented out | Supabase Auth owns credentials. No password column exists in `public`. | `profiles` has no secret columns (`0001_profiles.sql`) |
| A2 | Two hard-coded JWT secrets | One project secret from the environment; the API verifies HS256 + audience and fails closed without it | `apps/api/tests/auth.test.ts` (wrong secret, expired, `alg: none`, secret unset) |
| A3 | Tokens issued but never verified; `/api/admin/*` public | `authenticate` + `requireRole` on every route; role read from `profiles`, never from the token; RLS under every table | `auth.test.ts`, `admin.routes.test.ts`, `db/bookings.test.ts` (RLS) |
| A4 | MySQL password committed | Old backend deleted; config validated from env; `.env.example` only. **The password is still in git history: rotate it** (see `security.md`) | `config.ts`, `.gitignore` |
| A5 | Price taken from the client body | `createSchema` is `.strict()` and has no price field; the server computes the quote | `bookings.routes.test.ts` ("rejects a price sent by the client"), validation audit |
| A6 | Mechanic types their own rating | `rating_sum`/`rating_count` are derived by a trigger from reviews; a guard trigger blocks direct edits | `db/bookings.test.ts` ("stops a workshop owner editing their own rating") |
| A7 | Hard-coded `Paid` and `4.5` | Payment is a row with a UTR/gateway reference and a confirmation step; ratings only come from `submit_review` | `db/payments.test.ts` |

## Algorithm and data model

| # | Problem in 1.0 | Fix in 2.0 | Guarded by |
| --- | --- | --- | --- |
| B1 | Highest-rated free mechanic, anywhere | Radius search, OSRM ETA, weighted score, offer cascade, 40 km cap | `db/allocation.test.ts` ("never to a higher-rated Bangalore one"); `docs/allocation-eval.md` |
| B2 | Locations as strings | lat/lng columns + PostGIS `geom` and GiST indexes | `0002_core_schema.sql`, `0007_geo.postgis.sql` |
| B3 | Assignment never changes load | `workshop_active_jobs` + pending offers counted; capacity re-checked under a row lock on accept | `db/allocation.test.ts` ("100 simultaneous bookings never push any workshop past its staff count") |
| B4 | Mixed-case statuses | One `booking_status` enum and a `booking_transitions` table; one function changes status | `db/bookings.test.ts` (every legal and illegal pair) |
| B5 | `service_id LIKE 'CAR_%'` | `services.vehicle_kind`; `create_booking` rejects a car service on a bike | `db/bookings.test.ts` |
| B6 | Booked services hidden forever | Services are a catalogue; nothing is filtered by history | n/a (no such query exists) |
| B7 | Copy then delete, no transaction | One `bookings` table; completion is `complete_booking()` in one transaction | `db/bookings.test.ts` |
| B8 | "Pause" deletes the row | `workshop_services.is_paused` flag, honoured by candidate search | `db/allocation.test.ts` ("skips shops that cannot do the job") |
| B9 | 10 flattened address columns; stale `totalspent` | `addresses` table; no derived totals stored | `0002_core_schema.sql` |

## Frontend and delivery

| # | Problem in 1.0 | Fix in 2.0 | Guarded by |
| --- | --- | --- | --- |
| C1 | Bare `axios`, wrong base URL | One `api()` client with the base URL from env and the user's token | `apps/web/tests/lib.test.ts` |
| C2 | `localhost:3000` hard-coded | `VITE_API_URL` | `apps/web/src/lib/env.ts` |
| C3 | No design system, guards, or loading/error states | Tokens, UI kit, `RequireRole`, skeleton / empty / error states on every data screen | `apps/web/tests/components.test.tsx` |
| C4 | No tests, migrations, env example, CI, deploy config | Jest + Vitest + pytest, 16 migration files, `.env.example` per app, GitHub Actions, `render.yaml`, `vercel.json` | `.github/workflows/ci.yml` |
