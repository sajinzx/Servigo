# Security notes

## Do this first: rotate what 1.0 leaked

The old backend committed a MySQL password (`localhost@123`) and two JWT secrets
(`your_jwt_secret_key`, `your-secret-key`). The code is gone from the working tree but **it is still in
git history**, and the repository is public on GitHub.

- Treat all three values as compromised. Change the MySQL password anywhere it was reused, and never
  reuse those strings.
- Rewriting history (`git filter-repo`) is optional and disruptive; rotation is what matters.
- ServiGo 2.0 uses none of them: secrets are only in host dashboards (Vercel, Render, Supabase, GitHub
  Actions) and in each app's untracked `.env`.

## Trust boundaries

| Component | Holds | Never holds |
| --- | --- | --- |
| Browser | Supabase **anon** key, the user's session | service-role key, any provider secret |
| Core API | service-role key, JWT secret, payout encryption key, Razorpay secret | plaintext payout details at rest |
| Worker | `DATABASE_URL`, provider tokens (WhatsApp, MSG91, Resend, FCM) | user passwords (Supabase Auth owns them) |
| ML service | optional Supabase service key (forecast upsert) | writes to core tables (it only writes forecasts, registry and prediction log) |
| Database | RLS on every table; ciphertext for payout accounts | the encryption key |

## What the database enforces

- Roles: every new account is a `customer`. `mechanic` is granted only by approving a workshop
  application; `admin` only by hand with the service role. A guard trigger blocks client edits of `role`,
  `phone`, `phone_verified` and `onboarded_at`.
- Writes: clients cannot insert, update or delete `bookings`, `offers`, `payments`, `ledger_entries`,
  `invoices`, `refunds`, `payouts`, `strikes`, `incidents`. Business-rule functions are revoked from
  `anon` and `authenticated`; only the service role (the API) can call them.
- Money: every ledger journal must sum to zero or the transaction fails (deferred constraint trigger).
  A confirmed payment has exactly one invoice. Invoice numbers are gapless per financial year.
- Verification: a workshop that is not `probation` or `active` is never returned by candidate search, and
  probation shops are capped by distance and jobs per day in the same SQL function.

## Payments and UPI

- The amount in a UPI link, QR note and gateway order always comes from the server's copy of the booking.
- UPI to a plain VPA sends no webhook, so a payment is confirmed by the workshop or an admin against the
  bank statement. UTRs are 12 digits and unique; a fabricated UTR is a strike on the customer.
- Before scaling past the pilot, move the payee to a merchant account with payment notifications, or use
  the gateway path (Razorpay) so confirmation is automatic.
- Razorpay webhooks are authenticated by HMAC over the raw body; WhatsApp receipts by
  `X-Hub-Signature-256`; MSG91 receipts by a shared token.

## Tax and compliance (not advice)

- Only a GST-registered workshop is charged GST. An unregistered workshop issues a bill of supply and the
  customer is not charged tax. This is a deliberate difference from "every price is GST-inclusive".
- TCS under section 52 is recorded at a configurable rate (`platform_settings.tcs_rate`, default 0.5%) so the
  ledger is ready, but whether ServiGo must collect it, and at what rate, **must be confirmed with a
  chartered accountant before any real-money launch**.
- Location is collected only at booking time with a consent screen; analytics tables use H3 cells, not
  exact coordinates (DPDP Act 2023).

## Known gaps

- The Core API's rate limits key on IP for the global limiter (the user is not known before auth runs).
- Prepayment for customers with repeated no-shows is modelled (`customer_requires_prepayment`) and refund
  policy exists (`cancellation_refund`), but collecting a payment before completion is not built.
- Contact numbers are shown only after acceptance **in the UI**. The `workshops` table is readable by any
  signed-in user (it is the public directory), so a determined user could read a workshop's phone earlier.
  Moving the phone into a table that only the assigned customer can read would close that; a
  proxy-number call flow is not built.
