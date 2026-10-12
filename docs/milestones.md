# Milestone status

What exists in the repository against the plan's M0 to M12. "Built and tested" means there is code and an
automated test that runs in CI. "Needs your accounts" means the code is written but cannot be exercised
without a real third-party account, which I did not have, so it is untested end to end.

| | Milestone | State | Notes |
| --- | --- | --- | --- |
| M0 | Foundation | Built and tested | npm workspaces, TypeScript API and web, pytest, GitHub Actions, `.env.example` per app. |
| M1 | Security and sign-in | Built and tested | JWT verification, roles from `profiles`, RLS, secrets removed. Google / phone / email sign-in is wired in the web app; **needs your Supabase project and Google OAuth client** to run. |
| M2 | Schema and core domain | Built and tested | 15 migrations; an exhaustive test walks every legal status move and refuses every illegal one. |
| M3 | Job queue and notifications | Built and tested | Outbox-backed queue with visibility timeout, jittered backoff and dead letter; channels for WhatsApp, MSG91, Resend, FCM. Provider calls are tested against fakes only: **needs WhatsApp templates, DLT registration, FCM and Resend accounts**. Uses the outbox table directly instead of `pgmq` (same semantics, testable without the extension). |
| M4 | Geo and allocation v1 | Built and tested | Radius search with widening, ETA from OSRM with haversine fallback, scoring, 90 s offer cascade, concurrency test. The PostGIS variant of `find_candidates` is generated and **has not been run against a real PostGIS** (no Docker in the build environment); the portable version is what the tests exercise. |
| M5 | Simulator and datasets | Built and tested | Reproducible byte for byte, ground-truth coefficients saved. The built-in priors are hand-written; the real public datasets are fetched by `data/scripts` but were **not** downloaded, so no result is calibrated to them. |
| M6 | Onboarding and trust & safety | Built and tested | Application pipeline, KYC format checks (GSTIN checksum, PAN, UPI, IFSC), encrypted payout details, probation, strikes, no-shows, disputes, appeals. Each rule has a test that triggers it. |
| M7 | Payments, refunds, invoices | Built and tested | UPI link and QR, UTR reconciliation, Razorpay order and webhook, commission and GST split, double-entry ledger (1,000 payments with refunds and payouts balance to zero), gapless invoices, credit notes, PDFs. Razorpay and the UPI flow on a real phone are **untested end to end**. |
| M8 | New UI | Built, unit-tested and compiled | Customer, workshop and admin screens, tokens, dark mode, loading / empty / error states. **Not run in a browser against a live backend**, no Lighthouse run, no Android/iOS UPI test. |
| M9 | ML v1 and tuning | Built and tested | Triage, duration, price, acceptance; fallbacks to baselines; weights tuned on the simulator. See `docs/allocation-eval.md` and `services/ml/model_cards/`. |
| M10 | Predictive analytics | Built and tested | Demand forecast (beats seasonal-naive), next-service survival model, reminders through the queue, anomaly flags. The transformer triage option is **not built**. |
| M11 | Hardening and pilot readiness | Partly | Rate limits, request IDs, readiness endpoint, validation audit, restore-drill script, runbook. **Sentry is not wired**, and recruiting workshops and registering templates are yours to do. |
| M12 | Real pilot and report | Tooling only | Export functions and `pilot_report.py` are built and tested. No pilot has been run, so there are no real numbers and `docs/pilot-report.md` says so. |

## Where the results disagree with the plan

- **Batch (Hungarian) assignment did not help at peak load** in the replay (`docs/allocation-eval.md`): mean
  ETA moved by -0.7 min, but the no-match rate rose 1.9 points and the share assigned within 60 s fell 8.8
  points once the 30 s window wait is counted. The batch path is built and enabled above 5 waiting bookings;
  decide after the pilot whether to keep it.
- **Hourly demand WAPE is above 1** for every method, because counts per cell, category and hour are mostly
  zero or one. The model beats seasonal-naive at that grain and clearly at cell-per-day (0.43 against 0.58),
  which is the grain the admin heatmap uses. On a small dataset the demand model does not beat the baseline
  and the registry correctly refuses to promote it.
- **Triage top-3 accuracy is 100%** on simulated text. That is the simulator's templates being easy, not a
  claim about real customers' wording.
- **Unregistered workshops are not charged GST.** The plan says every price is GST-inclusive; that cannot be
  right for a supplier without a GSTIN, so they issue a bill of supply.
