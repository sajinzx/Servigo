#!/usr/bin/env bash
# Backup and restore drill. Run it before the pilot and after any schema change.
#
#   SOURCE_URL=postgres://...prod  SCRATCH_URL=postgres://...scratch  ./scripts/restore-drill.sh
#
# 1. dumps the source database (schemas `public` only; auth and storage are Supabase's)
# 2. restores into a throw-away scratch database
# 3. checks that the restore is complete and that the money still adds up
#
# It never writes to SOURCE_URL. Use a scratch database you can drop.

set -euo pipefail

: "${SOURCE_URL:?set SOURCE_URL to the database to back up}"
: "${SCRATCH_URL:?set SCRATCH_URL to an empty scratch database}"

if [ "$SOURCE_URL" = "$SCRATCH_URL" ]; then
  echo "SOURCE_URL and SCRATCH_URL must differ" >&2
  exit 2
fi

dump="$(mktemp -t servigo-dump-XXXXXX.dump)"
trap 'rm -f "$dump"' EXIT

echo "== dump"
pg_dump --format=custom --schema=public --no-owner --no-privileges --file="$dump" "$SOURCE_URL"
echo "dump size: $(du -h "$dump" | cut -f1)"

echo "== restore into scratch"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$SCRATCH_URL" "$dump" || {
  # pg_restore exits non-zero for harmless warnings (missing roles); the checks below decide
  echo "pg_restore reported warnings; continuing to the checks"
}

q() { psql "$1" -v ON_ERROR_STOP=1 -At -c "$2"; }

fail=0
check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "ok    $name ($actual)"
  else
    echo "FAIL  $name: source=$expected restored=$actual"
    fail=1
  fi
}

echo "== row counts match"
for t in profiles workshops vehicles bookings booking_events offers payments invoices ledger_entries refunds payouts; do
  check "count($t)" "$(q "$SOURCE_URL" "select count(*) from public.$t")" "$(q "$SCRATCH_URL" "select count(*) from public.$t")"
done

echo "== invariants hold on the restored copy"
check "ledger balanced" "t" "$(q "$SCRATCH_URL" "select public.ledger_is_balanced()")"
check "journals that do not sum to zero" "0" \
  "$(q "$SCRATCH_URL" "select count(*) from (select journal_id from public.ledger_entries group by journal_id having sum(amount) <> 0) x")"
check "confirmed payments without an invoice" "0" \
  "$(q "$SCRATCH_URL" "select count(*) from public.payments p where p.status in ('confirmed','refunded') and not exists (select 1 from public.invoices i where i.payment_id = p.id and i.series in ('INV','BOS'))")"
check "invoice numbers with gaps" "0" \
  "$(q "$SCRATCH_URL" "select count(*) from (select financial_year, series, max(seq) - count(*) as gap from public.invoices group by 1, 2) x where gap <> 0")"
check "bookings in an unknown status path" "0" \
  "$(q "$SCRATCH_URL" "select count(*) from public.booking_events e where e.from_status is not null and not exists (select 1 from public.booking_transitions t where t.from_status = e.from_status and t.to_status = e.to_status)")"

if [ "$fail" -ne 0 ]; then
  echo "RESTORE DRILL FAILED" >&2
  exit 1
fi
echo "restore drill passed"
