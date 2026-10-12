-- 0010: payments, commission, refunds, payouts, GST invoices and the ledger (plan section 10).
--
-- Rules of this file:
--  * money only moves through ledger journals; every journal sums to exactly zero
--  * balances are always computed from the ledger, never stored
--  * a confirmed payment has exactly one invoice; a refund after invoicing
--    produces a credit note, never an edited invoice

create table public.platform_settings (
  key   text primary key,
  value jsonb not null
);
insert into public.platform_settings (key, value) values
  ('commission_default_rate', '0.10'),
  ('tcs_rate', '0.005'),             -- reserved; confirm with a chartered accountant before real launch
  ('cancellation_fee', '50'),
  ('payout_hold_hours', '72'),
  ('utr_overdue_hours', '24');

create function public.setting_num(p_key text) returns numeric language sql stable as $$
  select (value #>> '{}')::numeric from public.platform_settings where key = p_key
$$;

create table public.commission_rules (
  category text primary key,           -- service category, or '*' for the default
  rate     numeric(5, 4) not null check (rate between 0 and 1)
);
insert into public.commission_rules (category, rate) values ('*', 0.10);

create function public.commission_rate(p_category text) returns numeric language sql stable as $$
  select coalesce(
    (select rate from public.commission_rules where category = p_category),
    (select rate from public.commission_rules where category = '*'),
    public.setting_num('commission_default_rate'))
$$;

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------
create type public.payment_method as enum ('upi_link', 'upi_qr', 'razorpay');
create type public.payment_status as enum
  ('initiated', 'pending_verification', 'confirmed', 'failed', 'refunded');

create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null references public.bookings (id),
  amount              numeric(12, 2) not null check (amount > 0),
  method              public.payment_method not null,
  status              public.payment_status not null default 'initiated',
  reference           text not null,                 -- BK-10423, printed in the UPI note
  utr                 text,
  screenshot_path     text,
  razorpay_order_id   text,
  razorpay_payment_id text,
  commission          numeric(12, 2),
  gst_on_commission   numeric(12, 2),
  tcs                 numeric(12, 2),
  workshop_net        numeric(12, 2),
  created_at          timestamptz not null default now(),
  submitted_at        timestamptz,
  confirmed_at        timestamptz,
  confirmed_by        uuid references public.profiles (id),
  failure_reason      text,
  check (utr is null or utr ~ '^[0-9]{12}$')
);
create unique index payments_one_confirmed_per_booking
  on public.payments (booking_id) where status = 'confirmed';
create unique index payments_utr_unique on public.payments (utr) where utr is not null and status <> 'failed';
create unique index payments_rzp_payment_unique on public.payments (razorpay_payment_id)
  where razorpay_payment_id is not null;
create index payments_status_idx on public.payments (status, submitted_at);

-- ---------------------------------------------------------------------------
-- ledger: double entry, debits positive and credits negative
-- ---------------------------------------------------------------------------
create type public.ledger_account as enum (
  'platform_cash', 'workshop_payable', 'commission_revenue', 'gst_on_commission',
  'tcs_payable', 'discount_expense'
);

create table public.ledger_entries (
  id          bigserial primary key,
  journal_id  uuid not null,
  at          timestamptz not null default now(),
  account     public.ledger_account not null,
  workshop_id uuid references public.workshops (id),
  booking_id  uuid references public.bookings (id),
  payment_id  uuid references public.payments (id),
  kind        text not null,                    -- payment, refund, payout, discount
  amount      numeric(12, 2) not null,
  memo        text
);
create index ledger_journal_idx on public.ledger_entries (journal_id);
create index ledger_workshop_idx on public.ledger_entries (workshop_id, account);

-- a journal that does not sum to zero never commits
create function public.ledger_assert_balanced() returns trigger language plpgsql as $$
declare total numeric;
begin
  select sum(amount) into total from public.ledger_entries where journal_id = new.journal_id;
  if total is distinct from 0 then
    raise exception 'unbalanced journal %: %', new.journal_id, total;
  end if;
  return null;
end $$;

create constraint trigger ledger_balanced
  after insert on public.ledger_entries
  deferrable initially deferred
  for each row execute function public.ledger_assert_balanced();

create function public.workshop_balance(p_workshop uuid) returns numeric language sql stable as $$
  select coalesce(-sum(amount), 0) from public.ledger_entries
   where workshop_id = p_workshop and account = 'workshop_payable'
$$;

-- ---------------------------------------------------------------------------
-- invoices (gapless numbering per financial year and series)
-- ---------------------------------------------------------------------------
create table public.invoice_counters (
  financial_year text not null,
  series         text not null,
  last_seq       integer not null default 0,
  primary key (financial_year, series)
);

create table public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  invoice_no          text not null unique,
  series              text not null check (series in ('INV', 'BOS', 'CN', 'CI')),
  financial_year      text not null,
  seq                 integer not null,
  booking_id          uuid references public.bookings (id),
  payment_id          uuid references public.payments (id),
  workshop_id         uuid references public.workshops (id),
  customer_id         uuid references public.profiles (id),
  supplier_name       text not null,
  supplier_gstin      text,
  supplier_state_code text,
  customer_name       text,
  customer_gstin      text,
  place_of_supply     text,
  intra_state         boolean not null default true,
  lines               jsonb not null,
  taxable_value       numeric(12, 2) not null,
  cgst                numeric(12, 2) not null default 0,
  sgst                numeric(12, 2) not null default 0,
  igst                numeric(12, 2) not null default 0,
  total               numeric(12, 2) not null,
  reference           text,
  original_invoice_id uuid references public.invoices (id),
  pdf_path            text,
  issued_at           timestamptz not null default now(),
  unique (financial_year, series, seq)
);
-- exactly one invoice per confirmed payment (credit notes are keyed by refund instead)
create unique index invoices_one_per_payment on public.invoices (payment_id)
  where series in ('INV', 'BOS');

create function public.financial_year(p_at timestamptz default now()) returns text
language sql immutable as $$
  select case
    when extract(month from p_at at time zone 'Asia/Kolkata') >= 4
      then extract(year from p_at at time zone 'Asia/Kolkata')::int || '-' ||
           lpad(((extract(year from p_at at time zone 'Asia/Kolkata')::int + 1) % 100)::text, 2, '0')
    else (extract(year from p_at at time zone 'Asia/Kolkata')::int - 1) || '-' ||
         lpad((extract(year from p_at at time zone 'Asia/Kolkata')::int % 100)::text, 2, '0')
  end
$$;

-- row lock on the counter makes the sequence gapless: a rolled back transaction
-- releases its number
create function public.next_invoice_no(p_series text, p_at timestamptz default now())
returns table (invoice_no text, financial_year text, seq integer) language plpgsql as $$
declare
  fy text := public.financial_year(p_at);
  n  integer;
begin
  insert into public.invoice_counters (financial_year, series) values (fy, p_series)
  on conflict do nothing;
  update public.invoice_counters c set last_seq = c.last_seq + 1
   where c.financial_year = fy and c.series = p_series
  returning c.last_seq into n;
  invoice_no := case p_series
    when 'CN' then 'SG/CN/' || fy || '/' || lpad(n::text, 6, '0')
    when 'CI' then 'SG/CI/' || fy || '/' || lpad(n::text, 6, '0')
    when 'BOS' then 'SG/BOS/' || fy || '/' || lpad(n::text, 6, '0')
    else 'SG/' || fy || '/' || lpad(n::text, 6, '0')
  end;
  financial_year := fy;
  seq := n;
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- the payment flow
-- ---------------------------------------------------------------------------
-- The amount always comes from the booking; the client never names it.
create function public.start_payment(p_booking uuid, p_customer uuid, p_method public.payment_method)
returns public.payments language plpgsql as $$
declare
  b public.bookings;
  p public.payments;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.customer_id <> p_customer then
    raise exception 'booking not found' using errcode = '42501';
  end if;
  if b.status <> 'completed' then
    raise exception 'a booking can be paid once it is completed (it is %)', b.status;
  end if;
  if b.needs_price_approval and b.price_approved_at is null then
    raise exception 'approve the final price before paying';
  end if;
  if b.frozen then
    raise exception 'booking is frozen pending a review';
  end if;

  -- reuse an open attempt for the same method rather than piling up rows
  select * into p from public.payments
   where booking_id = p_booking and status in ('initiated', 'pending_verification')
   order by created_at desc limit 1;
  if found and p.status = 'initiated' and p.method = p_method and p.amount = b.final_price then
    return p;
  end if;
  if found and p.status = 'pending_verification' then
    raise exception 'a payment is already waiting for confirmation';
  end if;

  insert into public.payments (booking_id, amount, method, reference)
  values (p_booking, b.final_price, p_method, b.ref)
  returning * into p;
  return p;
end $$;

create function public.submit_utr(p_payment uuid, p_customer uuid, p_utr text, p_screenshot text)
returns public.payments language plpgsql as $$
declare
  p public.payments;
  b public.bookings;
begin
  select pay.* into p from public.payments pay
    join public.bookings bk on bk.id = pay.booking_id
   where pay.id = p_payment and bk.customer_id = p_customer for update of pay;
  if not found then
    raise exception 'payment not found' using errcode = '42501';
  end if;
  if p.status <> 'initiated' then
    raise exception 'payment is already %', p.status;
  end if;
  if p_utr !~ '^[0-9]{12}$' then
    raise exception 'a UTR is 12 digits';
  end if;
  if exists (select 1 from public.payments where utr = p_utr and status <> 'failed') then
    raise exception 'this UTR was already used for another payment';
  end if;

  update public.payments
     set utr = p_utr, screenshot_path = p_screenshot, status = 'pending_verification', submitted_at = now()
   where id = p.id returning * into p;

  perform public.transition_booking(p.booking_id, 'payment_pending_verification', p_customer,
                                    'customer', jsonb_build_object('payment_id', p.id));
  return p;
end $$;

-- the money split, journal and invoice that every confirmed payment produces
create function public.settle_payment(p_payment uuid, p_actor uuid, p_actor_role text)
returns public.payments language plpgsql as $$
declare
  p        public.payments;
  b        public.bookings;
  w        public.workshops;
  svc      public.services;
  taxable  numeric;
  rate     numeric;
  c        numeric;
  gc       numeric;
  tcs_amt  numeric;
  net      numeric;
  j        uuid := gen_random_uuid();
begin
  select * into p from public.payments where id = p_payment for update;
  select * into b from public.bookings where id = p.booking_id;
  select * into w from public.workshops where id = b.workshop_id;
  select * into svc from public.services where id = b.service_id;

  taxable := coalesce(b.labour_amount, 0) + coalesce(b.parts_amount, 0);
  rate := public.commission_rate(svc.category);
  c := round(coalesce(b.labour_amount, 0) * rate, 2);               -- parts are not commissioned
  gc := round(c * public.gst_rate(), 2);                             -- 18% GST on our own fee
  tcs_amt := round(taxable * public.setting_num('tcs_rate'), 2);
  net := p.amount - c - gc - tcs_amt;

  insert into public.ledger_entries (journal_id, account, workshop_id, booking_id, payment_id, kind, amount, memo)
  values
    (j, 'platform_cash',      w.id, b.id, p.id, 'payment',  p.amount, 'received ' || p.reference),
    (j, 'workshop_payable',   w.id, b.id, p.id, 'payment', -net,      'owed to workshop'),
    (j, 'commission_revenue', w.id, b.id, p.id, 'payment', -c,        'commission on labour'),
    (j, 'gst_on_commission',  w.id, b.id, p.id, 'payment', -gc,       'GST on commission'),
    (j, 'tcs_payable',        w.id, b.id, p.id, 'payment', -tcs_amt,  'TCS reserved');

  update public.payments
     set status = 'confirmed', confirmed_at = now(), confirmed_by = p_actor,
         commission = c, gst_on_commission = gc, tcs = tcs_amt, workshop_net = net
   where id = p.id returning * into p;

  -- booking: completed or payment_pending_verification -> paid
  perform public.transition_booking(b.id, 'paid', p_actor, p_actor_role,
                                    jsonb_build_object('payment_id', p.id));

  perform public.issue_invoice(p.id);
  perform public.enqueue_job('billing', 'invoice.render', jsonb_build_object('payment_id', p.id),
                             'invoice:' || p.id);
  return p;
end $$;

-- A mechanic taps "Payment received", or an admin matches the UTR to the statement.
create function public.confirm_payment(p_payment uuid, p_actor uuid, p_actor_role text)
returns public.payments language plpgsql as $$
declare
  p public.payments;
  b public.bookings;
  owner uuid;
begin
  select * into p from public.payments where id = p_payment for update;
  if not found then
    raise exception 'payment not found';
  end if;
  if p.status = 'confirmed' then
    return p; -- idempotent
  end if;
  if p.status <> 'pending_verification' then
    raise exception 'payment is %, not waiting for confirmation', p.status;
  end if;
  if p_actor_role not in ('mechanic', 'admin') then
    raise exception 'only the workshop or an admin can confirm a UPI payment' using errcode = '42501';
  end if;
  if p_actor_role = 'mechanic' then
    select * into b from public.bookings where id = p.booking_id;
    select w.owner_id into owner from public.workshops w where w.id = b.workshop_id;
    if owner is distinct from p_actor then
      raise exception 'not your workshop''s booking' using errcode = '42501';
    end if;
  end if;
  return public.settle_payment(p.id, p_actor, p_actor_role);
end $$;

-- Razorpay: called only after the API verified the webhook signature.
create function public.confirm_gateway_payment(
  p_order_id text, p_razorpay_payment_id text, p_amount numeric
) returns public.payments language plpgsql as $$
declare
  p public.payments;
begin
  select * into p from public.payments where razorpay_order_id = p_order_id for update;
  if not found then
    raise exception 'no payment for order %', p_order_id;
  end if;
  if p.status = 'confirmed' then
    return p; -- webhooks are delivered at least once
  end if;
  if p.amount <> p_amount then
    raise exception 'gateway amount % does not match the amount due %', p_amount, p.amount;
  end if;
  update public.payments set razorpay_payment_id = p_razorpay_payment_id where id = p.id;
  -- the customer never entered a UTR, so the booking is still `completed`
  return public.settle_payment(p.id, null, 'system');
end $$;

create function public.attach_gateway_order(p_payment uuid, p_order_id text)
returns void language sql as $$
  update public.payments set razorpay_order_id = p_order_id
   where id = p_payment and method = 'razorpay' and status = 'initiated';
$$;

-- A wrong UTR: the payment fails and the booking goes back to completed.
-- A fabricated one costs the customer a strike.
create function public.reject_payment(p_payment uuid, p_actor uuid, p_reason text, p_fake boolean default false)
returns public.payments language plpgsql as $$
declare
  p public.payments;
  b public.bookings;
begin
  update public.payments set status = 'failed', failure_reason = p_reason
   where id = p_payment and status = 'pending_verification' returning * into p;
  if not found then
    raise exception 'payment is not waiting for confirmation';
  end if;
  perform public.transition_booking(p.booking_id, 'completed', p_actor, 'admin',
                                    jsonb_build_object('payment_id', p.id, 'reason', p_reason));
  if p_fake then
    select * into b from public.bookings where id = p.booking_id;
    perform public.add_strike(null, b.customer_id, null, 'fake_utr', p_actor, 'fabricated UTR: ' || p_reason);
  end if;
  return p;
end $$;

-- UTRs unconfirmed after 24 hours become an admin task (once each).
create function public.flag_overdue_payments() returns integer language plpgsql as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id, booking_id from public.payments
     where status = 'pending_verification'
       and submitted_at < now() - make_interval(hours => public.setting_num('utr_overdue_hours')::int)
  loop
    perform public.enqueue_job('notify', 'admin.task',
      jsonb_build_object('kind', 'unconfirmed_utr', 'payment_id', r.id, 'booking_id', r.booking_id),
      'admin:utr:' || r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------
create function public.issue_invoice(p_payment uuid) returns public.invoices
language plpgsql as $$
declare
  p     public.payments;
  b     public.bookings;
  w     public.workshops;
  svc   public.services;
  cust  public.profiles;
  gstin text;
  v_series text;
  num   record;
  lbr   numeric;
  prt   numeric;
  tax_l numeric;
  tax_p numeric;
  half  numeric;
  inv   public.invoices;
  lines jsonb := '[]'::jsonb;
  registered boolean;
begin
  select * into inv from public.invoices where payment_id = p_payment and series in ('INV', 'BOS');
  if found then
    return inv;
  end if;

  select * into p from public.payments where id = p_payment;
  select * into b from public.bookings where id = p.booking_id;
  select * into w from public.workshops where id = b.workshop_id;
  select * into svc from public.services where id = b.service_id;
  select * into cust from public.profiles where id = b.customer_id;

  select d.number into gstin
    from public.workshop_applications a
    join public.workshop_documents d on d.application_id = a.id and d.kind = 'gstin'
   where a.workshop_id = w.id limit 1;
  registered := w.gst_registered;
  v_series := case when registered then 'INV' else 'BOS' end;

  lbr := coalesce(b.labour_amount, 0);
  prt := coalesce(b.parts_amount, 0);
  tax_l := case when registered then round(lbr * public.gst_rate(), 2) else 0 end;
  tax_p := case when registered then round(prt * public.gst_rate(), 2) else 0 end;

  lines := jsonb_build_array(jsonb_build_object(
    'description', svc.name || ' (labour)', 'code', '9987', 'taxable', lbr, 'tax', tax_l));
  if prt > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object(
      'description', 'Spare parts and consumables',
      'code', case svc.vehicle_kind when 'bike' then '8714' else '8708' end,
      'taxable', prt, 'tax', tax_p));
  end if;

  -- all intra-state (CGST + SGST) because the service is performed at the supplier's location
  half := round((tax_l + tax_p) / 2, 2);

  select * into num from public.next_invoice_no(v_series, now());

  insert into public.invoices
    (invoice_no, series, financial_year, seq, booking_id, payment_id, workshop_id, customer_id,
     supplier_name, supplier_gstin, supplier_state_code, customer_name, place_of_supply, intra_state,
     lines, taxable_value, cgst, sgst, igst, total, reference)
  values (num.invoice_no, v_series, num.financial_year, num.seq, b.id, p.id, w.id, b.customer_id,
          w.name, gstin, left(gstin, 2), cust.full_name, w.city, true,
          lines, lbr + prt, half, (tax_l + tax_p) - half, 0, p.amount,
          coalesce(p.utr, p.razorpay_payment_id, p.reference))
  returning * into inv;
  return inv;
end $$;

-- ---------------------------------------------------------------------------
-- refunds
-- ---------------------------------------------------------------------------
create type public.refund_status as enum ('pending', 'processed');

create table public.refunds (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references public.bookings (id),
  payment_id     uuid not null references public.payments (id),
  amount         numeric(12, 2) not null check (amount > 0),
  reason         text not null,
  status         public.refund_status not null default 'pending',
  reference      text,                  -- UPI/refund reference recorded by the admin
  credit_note_id uuid references public.invoices (id),
  dispute_id     uuid references public.disputes (id),
  created_at     timestamptz not null default now(),
  processed_at   timestamptz,
  processed_by   uuid references public.profiles (id)
);
create index refunds_payment_idx on public.refunds (payment_id);

-- refund policy (plan 10.6), in one place
create function public.cancellation_refund(p_booking uuid, p_paid numeric) returns numeric
language plpgsql stable as $$
declare
  st public.booking_status;
  fee numeric := public.setting_num('cancellation_fee');
begin
  select status into st from public.bookings where id = p_booking;
  return case
    when st in ('requested', 'matching', 'offered') then p_paid          -- before acceptance: 100%
    when st = 'accepted' then greatest(p_paid - fee, 0)                  -- fee goes to the workshop
    else 0
  end;
end $$;

create function public.create_refund(
  p_booking uuid, p_amount numeric, p_reason text, p_actor uuid, p_dispute uuid default null
) returns public.refunds language plpgsql as $$
declare
  pay public.payments;
  already numeric;
  r   public.refunds;
begin
  select * into pay from public.payments
   where booking_id = p_booking and status in ('confirmed', 'refunded')
   order by confirmed_at desc limit 1;
  if not found then
    return null; -- nothing was paid, so there is nothing to refund
  end if;
  select coalesce(sum(amount), 0) into already from public.refunds where payment_id = pay.id;
  if p_amount <= 0 or p_amount + already > pay.amount then
    raise exception 'refund of % exceeds what is left of the payment (% of % already refunded)',
      p_amount, already, pay.amount;
  end if;
  insert into public.refunds (booking_id, payment_id, amount, reason, dispute_id)
  values (p_booking, pay.id, p_amount, p_reason, p_dispute)
  returning * into r;
  return r;
end $$;

-- The admin sent the money back (UPI refunds are manual) and records the reference.
create function public.complete_refund(p_refund uuid, p_admin uuid, p_reference text)
returns public.refunds language plpgsql as $$
declare
  r      public.refunds;
  pay    public.payments;
  b      public.bookings;
  ratio  numeric;
  c      numeric;
  gc     numeric;
  t      numeric;
  wnet   numeric;
  j      uuid := gen_random_uuid();
  orig   public.invoices;
  num    record;
  cn     public.invoices;
  refunded numeric;
begin
  if coalesce(trim(p_reference), '') = '' then
    raise exception 'record the transfer reference';
  end if;
  select * into r from public.refunds where id = p_refund for update;
  if not found or r.status <> 'pending' then
    raise exception 'refund is not pending';
  end if;
  select * into pay from public.payments where id = r.payment_id;
  select * into b from public.bookings where id = r.booking_id;

  -- the workshop gives back its share; commission and tax on our fee unwind proportionally
  ratio := r.amount / pay.amount;
  c := round(pay.commission * ratio, 2);
  gc := round(pay.gst_on_commission * ratio, 2);
  t := round(pay.tcs * ratio, 2);
  wnet := r.amount - c - gc - t;

  insert into public.ledger_entries (journal_id, account, workshop_id, booking_id, payment_id, kind, amount, memo)
  values
    (j, 'platform_cash',      b.workshop_id, b.id, pay.id, 'refund', -r.amount, 'refund ' || p_reference),
    (j, 'workshop_payable',   b.workshop_id, b.id, pay.id, 'refund',  wnet,     'deducted from workshop'),
    (j, 'commission_revenue', b.workshop_id, b.id, pay.id, 'refund',  c,        'commission reversed'),
    (j, 'gst_on_commission',  b.workshop_id, b.id, pay.id, 'refund',  gc,       'GST on commission reversed'),
    (j, 'tcs_payable',        b.workshop_id, b.id, pay.id, 'refund',  t,        'TCS reversed');

  -- credit note against the original invoice, never an edit of it
  select * into orig from public.invoices where payment_id = pay.id and series in ('INV', 'BOS');
  if found then
    select * into num from public.next_invoice_no('CN', now());
    insert into public.invoices
      (invoice_no, series, financial_year, seq, booking_id, payment_id, workshop_id, customer_id,
       supplier_name, supplier_gstin, supplier_state_code, customer_name, place_of_supply, intra_state,
       lines, taxable_value, cgst, sgst, igst, total, reference, original_invoice_id)
    values (num.invoice_no, 'CN', num.financial_year, num.seq, b.id, null, orig.workshop_id, orig.customer_id,
            orig.supplier_name, orig.supplier_gstin, orig.supplier_state_code, orig.customer_name,
            orig.place_of_supply, orig.intra_state,
            jsonb_build_array(jsonb_build_object('description', 'Credit note: ' || r.reason,
                                                 'code', '9987', 'taxable', round(orig.taxable_value * ratio, 2))),
            round(orig.taxable_value * ratio, 2), round(orig.cgst * ratio, 2), round(orig.sgst * ratio, 2),
            round(orig.igst * ratio, 2), r.amount, p_reference, orig.id)
    returning * into cn;
  end if;

  update public.refunds
     set status = 'processed', reference = p_reference, processed_at = now(), processed_by = p_admin,
         credit_note_id = cn.id
   where id = r.id returning * into r;

  select coalesce(sum(amount), 0) into refunded from public.refunds
   where payment_id = pay.id and status = 'processed';
  if refunded >= pay.amount then
    update public.payments set status = 'refunded' where id = pay.id;
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- payouts: weekly, for confirmed payments past the dispute window
-- ---------------------------------------------------------------------------
create type public.payout_status as enum ('planned', 'paid');

create table public.payouts (
  id          uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id),
  amount      numeric(12, 2) not null,
  status      public.payout_status not null default 'planned',
  period_end  timestamptz not null,
  reference   text,
  created_at  timestamptz not null default now(),
  paid_at     timestamptz,
  paid_by     uuid references public.profiles (id)
);
create index payouts_workshop_idx on public.payouts (workshop_id, created_at desc);

-- Owed amounts older than the hold window, minus anything already planned or paid.
-- A negative balance (refunds deducted) carries over to the next payout.
create function public.payable_now(p_workshop uuid, p_now timestamptz default now()) returns numeric
language sql stable as $$
  select greatest(0, coalesce(-sum(e.amount), 0)
                     - coalesce((select sum(amount) from public.payouts po
                                  where po.workshop_id = p_workshop), 0))
    from public.ledger_entries e
   where e.workshop_id = p_workshop and e.account = 'workshop_payable'
     and e.kind in ('payment', 'refund')
     and e.at <= p_now - make_interval(hours => public.setting_num('payout_hold_hours')::int)
$$;

create function public.plan_payouts(p_now timestamptz default now()) returns integer
language plpgsql as $$
declare
  r record;
  amt numeric;
  n integer := 0;
begin
  for r in select distinct workshop_id from public.ledger_entries
            where account = 'workshop_payable' and workshop_id is not null
  loop
    -- never pay out a workshop with a planned payout still open
    continue when exists (select 1 from public.payouts where workshop_id = r.workshop_id and status = 'planned');
    amt := public.payable_now(r.workshop_id, p_now);
    if amt > 0 then
      insert into public.payouts (workshop_id, amount, period_end) values (r.workshop_id, amt, p_now);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create function public.mark_payout_paid(p_payout uuid, p_admin uuid, p_reference text)
returns public.payouts language plpgsql as $$
declare
  po public.payouts;
  j  uuid := gen_random_uuid();
begin
  if coalesce(trim(p_reference), '') = '' then
    raise exception 'record the transfer reference';
  end if;
  update public.payouts set status = 'paid', reference = p_reference, paid_at = now(), paid_by = p_admin
   where id = p_payout and status = 'planned' returning * into po;
  if not found then
    raise exception 'payout is not planned';
  end if;
  insert into public.ledger_entries (journal_id, account, workshop_id, kind, amount, memo)
  values
    (j, 'workshop_payable', po.workshop_id, 'payout',  po.amount, 'paid out ' || p_reference),
    (j, 'platform_cash',    po.workshop_id, 'payout', -po.amount, 'paid out ' || p_reference);
  return po;
end $$;

-- ---------------------------------------------------------------------------
-- reports an accountant will ask for
-- ---------------------------------------------------------------------------
create view public.ledger_trial_balance as
  select account, sum(amount) as balance from public.ledger_entries group by account;

create function public.ledger_is_balanced() returns boolean language sql stable as $$
  select coalesce(sum(amount), 0) = 0 from public.ledger_entries
$$;

-- ---------------------------------------------------------------------------
-- dispute resolution now creates the refund record too
-- ---------------------------------------------------------------------------
create or replace function public.resolve_dispute(
  p_dispute uuid, p_admin uuid, p_outcome public.dispute_status, p_refund numeric, p_resolution text
) returns public.disputes language plpgsql as $$
declare
  d public.disputes;
  b public.bookings;
begin
  if p_outcome = 'open' then
    raise exception 'choose upheld, partial or rejected';
  end if;
  select * into d from public.disputes where id = p_dispute and status = 'open' for update;
  if not found then
    raise exception 'dispute is not open';
  end if;
  select * into b from public.bookings where id = d.booking_id;

  if p_outcome in ('upheld', 'partial') then
    if coalesce(p_refund, 0) <= 0 or p_refund > coalesce(b.final_price, b.quote_high) then
      raise exception 'refund must be between 0 and the booking amount';
    end if;
    perform public.transition_booking(d.booking_id, 'refunded', p_admin, 'admin',
                                      jsonb_build_object('dispute_id', d.id, 'refund', p_refund));
    -- a refund record exists only if the customer actually paid
    perform public.create_refund(d.booking_id, p_refund, 'dispute: ' || coalesce(p_resolution, ''), p_admin, d.id);
    if b.workshop_id is not null then
      perform public.add_strike(b.workshop_id, null, null, 'dispute_upheld', p_admin,
                                'dispute upheld: ' || coalesce(p_resolution, ''));
    end if;
  else
    perform public.transition_booking(d.booking_id, coalesce(d.return_status, 'paid'), p_admin, 'admin',
                                      jsonb_build_object('dispute_id', d.id));
  end if;

  update public.disputes
     set status = p_outcome, refund_amount = case when p_outcome = 'rejected' then 0 else p_refund end,
         resolution = p_resolution, resolved_at = now(), resolved_by = p_admin
   where id = d.id returning * into d;
  return d;
end $$;

-- ---------------------------------------------------------------------------
-- access
-- ---------------------------------------------------------------------------
alter table public.payments         enable row level security;
alter table public.ledger_entries   enable row level security;
alter table public.invoices         enable row level security;
alter table public.refunds          enable row level security;
alter table public.payouts          enable row level security;
alter table public.commission_rules enable row level security;
alter table public.platform_settings enable row level security;
alter table public.invoice_counters enable row level security;

create policy payments_party on public.payments
  for select using (
    exists (select 1 from public.bookings b where b.id = booking_id
            and (b.customer_id = auth.uid()
                 or (b.workshop_id is not null and public.owns_workshop(b.workshop_id)))));
create policy payments_admin on public.payments for select using (public.is_admin());

create policy invoices_party on public.invoices
  for select using (customer_id = auth.uid()
                    or (workshop_id is not null and public.owns_workshop(workshop_id)));
create policy invoices_admin on public.invoices for select using (public.is_admin());

create policy refunds_party on public.refunds
  for select using (
    exists (select 1 from public.bookings b where b.id = booking_id
            and (b.customer_id = auth.uid()
                 or (b.workshop_id is not null and public.owns_workshop(b.workshop_id)))));
create policy refunds_admin on public.refunds for select using (public.is_admin());

create policy payouts_owner on public.payouts
  for select using (public.owns_workshop(workshop_id));
create policy payouts_admin on public.payouts for select using (public.is_admin());

create policy ledger_owner on public.ledger_entries
  for select using (workshop_id is not null and public.owns_workshop(workshop_id));
create policy ledger_admin on public.ledger_entries for select using (public.is_admin());

create policy commission_read on public.commission_rules for select using (true);
create policy commission_admin on public.commission_rules
  for all using (public.is_admin()) with check (public.is_admin());
create policy settings_admin on public.platform_settings
  for all using (public.is_admin()) with check (public.is_admin());

revoke insert, update, delete on public.payments, public.ledger_entries, public.invoices,
  public.refunds, public.payouts from anon, authenticated;
revoke all on public.invoice_counters from anon, authenticated;
revoke all on public.ledger_trial_balance from anon, authenticated;

revoke execute on function
  public.start_payment(uuid, uuid, public.payment_method),
  public.submit_utr(uuid, uuid, text, text),
  public.settle_payment(uuid, uuid, text),
  public.confirm_payment(uuid, uuid, text),
  public.confirm_gateway_payment(text, text, numeric),
  public.attach_gateway_order(uuid, text),
  public.reject_payment(uuid, uuid, text, boolean),
  public.flag_overdue_payments(),
  public.issue_invoice(uuid),
  public.next_invoice_no(text, timestamptz),
  public.create_refund(uuid, numeric, text, uuid, uuid),
  public.complete_refund(uuid, uuid, text),
  public.plan_payouts(timestamptz),
  public.mark_payout_paid(uuid, uuid, text),
  public.resolve_dispute(uuid, uuid, public.dispute_status, numeric, text)
from public, anon, authenticated;
