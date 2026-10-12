# Runbook

For whoever is on support during the pilot. Support runs 09:00 to 21:00 on a WhatsApp number; every case
is logged as an incident (`report_incident`) so it shows up in the admin Cases screen.

## Daily checks (5 minutes)

1. **Admin > Operations**: anything in "Unmatched or stuck"? A booking with 3+ misses or `no_match` needs a phone call.
2. **Admin > Finance**: UTRs older than 24 h are highlighted. Match each against the bank statement, then
   Confirm, Wrong UTR, or Fake (strike). Pending refunds and planned payouts are on the same page.
3. **Admin > Review queue**: applications past their 48 h SLA are marked overdue.
4. **Admin > Models**: any model serving the baseline, or a dead-letter job? Retry dead jobs once the cause is fixed.
5. **GitHub Actions > uptime**: green? The free hosts sleep; this ping keeps them warm.

## Common cases

| Customer or workshop says | What to check | What to do |
| --- | --- | --- |
| "I never got an offer" (workshop) | `notifications` for that user and booking: which channel, which status, `error` | If push failed and WhatsApp was not opted in, the chain ended at SMS; check the DLT template id is registered |
| "I paid but it still says pending" | `payments` row: `utr`, `submitted_at` | Match UTR in the statement and confirm. If it is not there, reject; if it never will be, mark fake |
| "The price is higher than quoted" | Booking `needs_price_approval` | The customer must approve before paying. If they dispute it, `open_dispute`, then resolve in Cases |
| "Workshop did not turn up" | Booking events for `accepted` with no `in_progress` | `process_no_shows()` runs every 5 minutes: it strikes the workshop and re-matches the customer |
| "I was asked to pay cash" | Report type `off_platform` | First report is a strike, second suspends. Call the workshop |
| "No workshop available" | Candidate search for that booking: radius, hours, staff, vehicle kind | Usually outside opening hours or probation caps. Offer a rescheduled time |
| "My invoice is wrong" | `invoices` row | Never edit an invoice. Issue a refund (which creates a credit note) and, if needed, a new payment |

## Money rules to remember

- Balances are computed from `ledger_entries`. If `select public.ledger_is_balanced()` is ever false,
  stop payouts and escalate: it means a bug or a manual edit.
- A refund is two steps: create (`create_refund`), then record the transfer reference (`complete_refund`).
  UPI refunds are sent by hand from the payer-facing UPI app.
- Payouts are planned on Monday for confirmed payments older than 72 hours; mark each paid with its bank reference.
- Commission is 10% of labour only. GST on commission is 18%. TCS is reserved in the ledger; **do not remit
  or report TCS until a chartered accountant has confirmed the rate and whether it applies.**

## Backups and restore

Supabase takes daily backups (point-in-time recovery on paid plans). Prove a restore works before the pilot
and after every schema change:

```bash
SOURCE_URL=postgres://<prod>  SCRATCH_URL=postgres://<empty scratch db>  ./scripts/restore-drill.sh
```

It restores into a scratch database, compares row counts and re-checks the invariants (ledger balanced,
one invoice per confirmed payment, no invoice-number gaps, no impossible status moves). Record the date and
result in the incident log.

## Incidents

| Symptom | First look | Likely cause |
| --- | --- | --- |
| API 5xx | Render logs, filter by `X-Request-Id` from the customer's report | database connection, a failed migration |
| `/ready` returns 503 | Supabase status, `SUPABASE_URL` / keys | project paused (free tier), key rotated |
| Offers not going out | `outbox` rows pending with old `next_run_at`; worker logs | worker asleep or crashed. Jobs are durable: restart the worker and they run |
| Duplicate WhatsApp | `notifications.idempotency_key` | should be impossible; if seen, check the provider retried a webhook |
| ML predictions missing | `/health` on the ML service | free host asleep; bookings continue on baselines |

## Secrets

Rotate on a schedule and immediately if one leaks. After rotating `PAYOUT_ENCRYPTION_KEY` existing payout
details cannot be decrypted, so re-encrypt them first with a one-off script that reads with the old key and
writes with the new one. Rotating `SUPABASE_JWT_SECRET` signs everyone out.

## Before real money

- [ ] Chartered accountant has confirmed GST invoicing on behalf of workshops and the TCS position
- [ ] UPI payee moved to a merchant account with payment notifications, or the gateway path is live
- [ ] WhatsApp templates approved and DLT templates registered (start these in week 5, not week 15)
- [ ] Restore drill passed within the last 7 days
- [ ] Old MySQL password and JWT secrets rotated (see `security.md`)
- [ ] Pilot notice and consent screen reviewed; deletion requests handled by an admin
