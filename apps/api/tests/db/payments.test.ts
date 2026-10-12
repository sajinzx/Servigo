import type { PGlite } from '@electric-sql/pglite';
import { addUser, createDb } from './harness';

interface W {
  db: PGlite;
  admin: string;
  customer: string;
  mechanic: string;
  otherMechanic: string;
  workshop: string;
  vehicle: string;
  service: string;
  /** a completed booking with labour/parts, ready to be paid */
  completed(labour?: number, parts?: number): Promise<string>;
}

async function world(opts: { gst?: boolean } = {}): Promise<W> {
  const db = await createDb();
  const one = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
  const admin = await addUser(db, { name: 'Admin' });
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  const customer = await addUser(db, { name: 'Asha Customer' });
  const mechanic = await addUser(db, { name: 'Ravi' });
  const otherMechanic = await addUser(db, { name: 'Other' });
  await db.query(`update public.profiles set role = 'mechanic' where id in ($1,$2)`, [mechanic, otherMechanic]);

  const workshop = await one(
    `insert into public.workshops (owner_id, name, city, lat, lng, staff_count, stage, gst_registered)
     values ($1,'Anna Nagar Auto','Chennai',13.085,80.21,50,'active',$2) returning id`,
    [mechanic, opts.gst ?? true],
  );
  await db.query(
    `insert into public.workshops (owner_id, name, city, lat, lng, staff_count, stage)
     values ($1,'Other','Chennai',13.0,80.2,5,'active')`, [otherMechanic]);
  const service = await one(
    `insert into public.services (code, name, vehicle_kind, category, base_price, base_duration_min)
     values ('CAR_001','Car General Service','car','general',2500,180) returning id`,
  );
  const model = await one(
    `insert into public.vehicle_models (kind, make, model, segment) values ('car','Maruti','Swift','hatchback') returning id`,
  );
  const vehicle = await one(
    `insert into public.vehicles (owner_id, registration_no, model_id, year) values ($1,'TN09AB1234',$2,2019) returning id`,
    [customer, model],
  );

  const completed = async (labour = 2000, parts = 500) => {
    const id = await one(
      `select id from public.create_booking($1,$2,$3,'workshop',13.09,80.21,null,null,2500,4000,180)`,
      [customer, vehicle, service],
    );
    await db.query(`update public.bookings set workshop_id = $2 where id = $1`, [id, workshop]);
    await db.query(`select public.transition_booking($1,'offered',null,'system')`, [id]);
    await db.query(`select public.transition_booking($1,'accepted',$2,'mechanic')`, [id, mechanic]);
    await db.query(`select public.transition_booking($1,'in_progress',$2,'mechanic')`, [id, mechanic]);
    await db.query(`select * from public.complete_booking($1,$2,'mechanic',$3,$4)`, [id, mechanic, labour, parts]);
    return id;
  };
  return { db, admin, customer, mechanic, otherMechanic, workshop, vehicle, service, completed };
}

let utrSeq = 100000000000;
const nextUtr = () => String(utrSeq++);

const statusOf = async (db: PGlite, id: string) =>
  (await db.query<{ status: string }>(`select status from public.bookings where id = $1`, [id])).rows[0].status;

async function pay(w: W, booking: string, confirmer: { id: string; role: string } | null = null) {
  const p = await w.db.query<{ id: string; amount: string }>(
    `select * from public.start_payment($1,$2,'upi_link')`, [booking, w.customer]);
  const id = p.rows[0].id;
  await w.db.query(`select * from public.submit_utr($1,$2,$3,null)`, [id, w.customer, nextUtr()]);
  if (confirmer) {
    await w.db.query(`select * from public.confirm_payment($1,$2,$3)`, [id, confirmer.id, confirmer.role]);
  }
  return id;
}

describe('UPI payment flow', () => {
  let w: W;
  beforeEach(async () => {
    w = await world();
  });
  afterEach(async () => {
    await w.db.close();
  });

  it('takes the amount from the booking, never from the caller', async () => {
    const b = await w.completed();
    const p = await w.db.query<{ amount: string; reference: string }>(
      `select * from public.start_payment($1,$2,'upi_link')`, [b, w.customer]);
    expect(Number(p.rows[0].amount)).toBe(2950);
    expect(p.rows[0].reference).toMatch(/^BK-\d+$/);
  });

  it('only opens payment on a completed booking', async () => {
    const b = await w.completed();
    await w.db.query(`update public.bookings set status = 'in_progress' where id = $1`, [b]);
    await expect(
      w.db.query(`select * from public.start_payment($1,$2,'upi_link')`, [b, w.customer]),
    ).rejects.toThrow(/once it is completed/);
  });

  it("does not let someone else pay a customer's booking", async () => {
    const b = await w.completed();
    const stranger = await addUser(w.db, { name: 'Stranger' });
    await expect(
      w.db.query(`select * from public.start_payment($1,$2,'upi_link')`, [b, stranger]),
    ).rejects.toThrow(/booking not found/);
  });

  it('moves to pending verification when the customer enters a UTR', async () => {
    const b = await w.completed();
    await pay(w, b);
    expect(await statusOf(w.db, b)).toBe('payment_pending_verification');
  });

  it('refuses a malformed or reused UTR', async () => {
    const b = await w.completed();
    const p = await w.db.query<{ id: string }>(`select * from public.start_payment($1,$2,'upi_link')`, [b, w.customer]);
    await expect(
      w.db.query(`select * from public.submit_utr($1,$2,'12345',null)`, [p.rows[0].id, w.customer]),
    ).rejects.toThrow(/12 digits/);

    const first = await pay(w, await w.completed());
    const used = await w.db.query<{ utr: string }>(`select utr from public.payments where id = $1`, [first]);
    await expect(
      w.db.query(`select * from public.submit_utr($1,$2,$3,null)`, [p.rows[0].id, w.customer, used.rows[0].utr]),
    ).rejects.toThrow(/already used/);
  });

  it('confirms: split, ledger, invoice, paid', async () => {
    const b = await w.completed(2000, 500);
    const id = await pay(w, b, { id: w.mechanic, role: 'mechanic' });
    expect(await statusOf(w.db, b)).toBe('paid');

    const p = await w.db.query<Record<string, string>>(`select * from public.payments where id = $1`, [id]);
    expect(p.rows[0].status).toBe('confirmed');
    expect(Number(p.rows[0].commission)).toBe(200); // 10% of labour only
    expect(Number(p.rows[0].gst_on_commission)).toBe(36); // 18% of 200
    expect(Number(p.rows[0].tcs)).toBe(12.5); // 0.5% of 2500
    expect(Number(p.rows[0].workshop_net)).toBe(2701.5);

    const bal = await w.db.query<{ account: string; balance: string }>(
      `select * from public.ledger_trial_balance order by account`);
    const m = Object.fromEntries(bal.rows.map((r) => [r.account, Number(r.balance)]));
    expect(m.platform_cash).toBe(2950);
    expect(m.workshop_payable).toBe(-2701.5);
    expect(m.commission_revenue).toBe(-200);
    expect(Object.values(m).reduce((a, b2) => a + b2, 0)).toBeCloseTo(0, 6);

    const inv = await w.db.query<Record<string, string>>(`select * from public.invoices where payment_id = $1`, [id]);
    expect(inv.rows).toHaveLength(1);
    expect(inv.rows[0].series).toBe('INV');
    expect(inv.rows[0].invoice_no).toMatch(/^SG\/\d{4}-\d{2}\/000001$/);
    expect(Number(inv.rows[0].taxable_value)).toBe(2500);
    expect(Number(inv.rows[0].cgst)).toBe(225);
    expect(Number(inv.rows[0].sgst)).toBe(225);
    expect(Number(inv.rows[0].total)).toBe(2950);
    const queued = await w.db.query(
      `select 1 from public.outbox where event_type = 'invoice.render' and queue = 'billing'`);
    expect(queued.rows).toHaveLength(1);
  });

  it('lets only the booking\'s workshop or an admin confirm', async () => {
    const b = await w.completed();
    const id = await pay(w, b);
    await expect(
      w.db.query(`select * from public.confirm_payment($1,$2,'customer')`, [id, w.customer]),
    ).rejects.toThrow(/only the workshop or an admin/);
    await expect(
      w.db.query(`select * from public.confirm_payment($1,$2,'mechanic')`, [id, w.otherMechanic]),
    ).rejects.toThrow(/not your workshop/);
    await w.db.query(`select * from public.confirm_payment($1,$2,'admin')`, [id, w.admin]);
    expect(await statusOf(w.db, b)).toBe('paid');
  });

  it('is idempotent: confirming twice makes one invoice and one journal', async () => {
    const b = await w.completed();
    const id = await pay(w, b, { id: w.mechanic, role: 'mechanic' });
    await w.db.query(`select * from public.confirm_payment($1,$2,'admin')`, [id, w.admin]);
    const inv = await w.db.query(`select 1 from public.invoices where payment_id = $1`, [id]);
    const led = await w.db.query(`select 1 from public.ledger_entries where payment_id = $1 and kind = 'payment'`, [id]);
    expect(inv.rows).toHaveLength(1);
    expect(led.rows).toHaveLength(5);
  });

  it('puts the booking back to completed on a wrong UTR, and strikes a fake one', async () => {
    const b = await w.completed();
    const id = await pay(w, b);
    await w.db.query(`select * from public.reject_payment($1,$2,'not in the statement',true)`, [id, w.admin]);
    expect(await statusOf(w.db, b)).toBe('completed');
    const s = await w.db.query(`select 1 from public.strikes where customer_id = $1 and kind = 'fake_utr'`, [w.customer]);
    expect(s.rows).toHaveLength(1);
    // the customer can pay again
    await pay(w, b, { id: w.mechanic, role: 'mechanic' });
    expect(await statusOf(w.db, b)).toBe('paid');
  });

  it('holds payment until a price far over the quote is approved', async () => {
    const b = await w.completed(5000, 1000); // 7080 vs quote_high 4000
    await expect(
      w.db.query(`select * from public.start_payment($1,$2,'upi_link')`, [b, w.customer]),
    ).rejects.toThrow(/approve the final price/);
    await w.db.query(`select * from public.approve_price($1,$2)`, [b, w.customer]);
    await pay(w, b, { id: w.mechanic, role: 'mechanic' });
    expect(await statusOf(w.db, b)).toBe('paid');
  });

  it('flags UTRs unconfirmed after 24 hours once each', async () => {
    const b = await w.completed();
    const id = await pay(w, b);
    expect((await w.db.query<{ n: number }>(`select public.flag_overdue_payments() as n`)).rows[0].n).toBe(0);
    await w.db.query(`update public.payments set submitted_at = now() - interval '25 hours' where id = $1`, [id]);
    expect((await w.db.query<{ n: number }>(`select public.flag_overdue_payments() as n`)).rows[0].n).toBe(1);
    await w.db.query(`select public.flag_overdue_payments()`);
    const tasks = await w.db.query(`select 1 from public.outbox where event_type = 'admin.task'`);
    expect(tasks.rows).toHaveLength(1);
  });
});

describe('gateway payments', () => {
  let w: W;
  beforeEach(async () => {
    w = await world();
  });
  afterEach(async () => {
    await w.db.close();
  });

  const start = async (b: string) => {
    const p = await w.db.query<{ id: string }>(`select * from public.start_payment($1,$2,'razorpay')`, [b, w.customer]);
    await w.db.query(`select public.attach_gateway_order($1,'order_ABC')`, [p.rows[0].id]);
    return p.rows[0].id;
  };

  it('confirms on the webhook and is safe to deliver twice', async () => {
    const b = await w.completed();
    await start(b);
    await w.db.query(`select * from public.confirm_gateway_payment('order_ABC','pay_1',2950)`);
    await w.db.query(`select * from public.confirm_gateway_payment('order_ABC','pay_1',2950)`);
    expect(await statusOf(w.db, b)).toBe('paid');
    const n = await w.db.query<{ n: string }>(`select count(*)::text n from public.invoices`);
    expect(Number(n.rows[0].n)).toBe(1);
  });

  it('refuses a gateway amount that differs from the amount due', async () => {
    const b = await w.completed();
    await start(b);
    await expect(
      w.db.query(`select * from public.confirm_gateway_payment('order_ABC','pay_1',1)`),
    ).rejects.toThrow(/does not match/);
    expect(await statusOf(w.db, b)).toBe('completed');
  });
});

describe('refunds and credit notes', () => {
  let w: W;
  let b: string;
  let payment: string;
  beforeEach(async () => {
    w = await world();
    b = await w.completed(2000, 500);
    payment = await pay(w, b, { id: w.mechanic, role: 'mechanic' });
  });
  afterEach(async () => {
    await w.db.close();
  });

  it('issues a credit note for a partial refund and leaves the invoice alone', async () => {
    const r = await w.db.query<{ id: string }>(
      `select * from public.create_refund($1, 1000, 'parts not fitted', $2)`, [b, w.admin]);
    await w.db.query(`select * from public.complete_refund($1,$2,'UPI-REF-77')`, [r.rows[0].id, w.admin]);

    const notes = await w.db.query<{ invoice_no: string; total: string; original_invoice_id: string }>(
      `select invoice_no, total, original_invoice_id from public.invoices where series = 'CN'`);
    expect(notes.rows).toHaveLength(1);
    expect(notes.rows[0].invoice_no).toMatch(/^SG\/CN\/\d{4}-\d{2}\/000001$/);
    expect(Number(notes.rows[0].total)).toBe(1000);

    const orig = await w.db.query<{ total: string }>(
      `select total from public.invoices where id = $1`, [notes.rows[0].original_invoice_id]);
    expect(Number(orig.rows[0].total)).toBe(2950);

    const st = await w.db.query<{ status: string }>(`select status from public.payments where id = $1`, [payment]);
    expect(st.rows[0].status).toBe('confirmed');
    expect((await w.db.query<{ ok: boolean }>(`select public.ledger_is_balanced() as ok`)).rows[0].ok).toBe(true);
  });

  it('deducts the refund from the workshop and unwinds commission proportionally', async () => {
    const before = Number((await w.db.query<{ b: string }>(
      `select public.workshop_balance($1) as b`, [w.workshop])).rows[0].b);
    const r = await w.db.query<{ id: string }>(
      `select * from public.create_refund($1, 2950, 'job not done', $2)`, [b, w.admin]);
    await w.db.query(`select * from public.complete_refund($1,$2,'UPI-REF-1')`, [r.rows[0].id, w.admin]);
    const after = Number((await w.db.query<{ b: string }>(
      `select public.workshop_balance($1) as b`, [w.workshop])).rows[0].b);
    expect(before).toBe(2701.5);
    expect(after).toBe(0); // a full refund leaves nothing owed to the workshop
    const st = await w.db.query<{ status: string }>(`select status from public.payments where id = $1`, [payment]);
    expect(st.rows[0].status).toBe('refunded');
    const rev = await w.db.query<{ balance: string }>(
      `select balance from public.ledger_trial_balance where account = 'commission_revenue'`);
    expect(Number(rev.rows[0].balance)).toBe(0);
  });

  it('refuses to refund more than was paid', async () => {
    await w.db.query(`select * from public.create_refund($1, 2000, 'x', $2)`, [b, w.admin]);
    await expect(
      w.db.query(`select * from public.create_refund($1, 1000, 'y', $2)`, [b, w.admin]),
    ).rejects.toThrow(/exceeds what is left/);
  });

  it('needs the transfer reference to complete', async () => {
    const r = await w.db.query<{ id: string }>(`select * from public.create_refund($1, 100, 'x', $2)`, [b, w.admin]);
    await expect(
      w.db.query(`select * from public.complete_refund($1,$2,'')`, [r.rows[0].id, w.admin]),
    ).rejects.toThrow(/transfer reference/);
  });

  it('creates the refund record when a dispute is upheld', async () => {
    const d = await w.db.query<{ id: string }>(
      `select id from public.open_dispute($1,$2,'charged for parts not fitted','[]')`, [b, w.customer]);
    await w.db.query(`select * from public.resolve_dispute($1,$2,'partial',500,'half the parts')`, [d.rows[0].id, w.admin]);
    const r = await w.db.query<{ amount: string; status: string; dispute_id: string }>(
      `select amount, status, dispute_id from public.refunds where booking_id = $1`, [b]);
    expect(r.rows).toHaveLength(1);
    expect(Number(r.rows[0].amount)).toBe(500);
    expect(r.rows[0].status).toBe('pending');
  });

  it('applies the cancellation policy', async () => {
    const q = async (status: string, paid = 1000) => {
      await w.db.query(`update public.bookings set status = $2 where id = $1`, [b, status]);
      return Number((await w.db.query<{ r: string }>(
        `select public.cancellation_refund($1,$2) as r`, [b, paid])).rows[0].r);
    };
    expect(await q('matching')).toBe(1000);
    expect(await q('offered')).toBe(1000);
    expect(await q('accepted')).toBe(950); // minus the 50 rupee fee
    expect(await q('in_progress')).toBe(0);
  });
});

describe('invoices', () => {
  it('issues a bill of supply with no GST for an unregistered workshop', async () => {
    const w = await world({ gst: false });
    const b = await w.completed(2000, 500);
    const f = await w.db.query<{ final_price: string }>(`select final_price from public.bookings where id = $1`, [b]);
    expect(Number(f.rows[0].final_price)).toBe(2500); // no GST charged
    const id = await pay(w, b, { id: w.mechanic, role: 'mechanic' });
    const inv = await w.db.query<Record<string, string>>(`select * from public.invoices where payment_id = $1`, [id]);
    expect(inv.rows[0].series).toBe('BOS');
    expect(Number(inv.rows[0].cgst) + Number(inv.rows[0].sgst) + Number(inv.rows[0].igst)).toBe(0);
    expect(Number(inv.rows[0].total)).toBe(2500);
    await w.db.close();
  });

  it('numbers invoices without gaps, even when a transaction rolls back', async () => {
    const w = await world();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await pay(w, await w.completed(), { id: w.mechanic, role: 'mechanic' }));

    // a settlement that fails after taking a number must give it back
    const b = await w.completed();
    const p = await w.db.query<{ id: string }>(`select * from public.start_payment($1,$2,'upi_link')`, [b, w.customer]);
    await w.db.query(`select * from public.submit_utr($1,$2,$3,null)`, [p.rows[0].id, w.customer, nextUtr()]);
    await expect(
      w.db.transaction(async (tx) => {
        await tx.query(`select * from public.next_invoice_no('INV')`);
        throw new Error('crash after taking a number');
      }),
    ).rejects.toThrow();
    await w.db.query(`select * from public.confirm_payment($1,$2,'admin')`, [p.rows[0].id, w.admin]);

    const seqs = await w.db.query<{ seq: number }>(`select seq from public.invoices where series = 'INV' order by seq`);
    expect(seqs.rows.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
    await w.db.close();
  });

  it('one invoice per confirmed payment, enforced by the database', async () => {
    const w = await world();
    const id = await pay(w, await w.completed(), { id: w.mechanic, role: 'mechanic' });
    const first = await w.db.query<{ id: string }>(`select id from public.invoices where payment_id = $1`, [id]);
    const again = await w.db.query<{ id: string }>(`select id from public.issue_invoice($1)`, [id]);
    expect(again.rows[0].id).toBe(first.rows[0].id);
    await w.db.close();
  });
});

describe('payouts', () => {
  it('pays out only after the hold window and carries refunds forward', async () => {
    const w = await world();
    const b1 = await w.completed(2000, 500);
    const p1 = await pay(w, b1, { id: w.mechanic, role: 'mechanic' });

    expect(Number((await w.db.query<{ n: number }>(`select public.plan_payouts() as n`)).rows[0].n)).toBe(0);

    // 4 days later
    await w.db.query(`update public.ledger_entries set at = now() - interval '4 days'`);
    const n = await w.db.query<{ n: number }>(`select public.plan_payouts() as n`);
    expect(n.rows[0].n).toBe(1);
    const po = await w.db.query<{ id: string; amount: string }>(`select id, amount from public.payouts`);
    expect(Number(po.rows[0].amount)).toBe(2701.5);

    // a refund raised while the payout is planned is deducted from the next one
    const r = await w.db.query<{ id: string }>(`select * from public.create_refund($1, 1000, 'x', $2)`, [b1, w.admin]);
    await w.db.query(`select * from public.complete_refund($1,$2,'REF')`, [r.rows[0].id, w.admin]);
    await w.db.query(`select * from public.mark_payout_paid($1,$2,'NEFT-1')`, [po.rows[0].id, w.admin]);

    const bal = Number((await w.db.query<{ b: string }>(`select public.workshop_balance($1) as b`, [w.workshop])).rows[0].b);
    expect(bal).toBeLessThan(0); // they were paid before the refund; it comes out of the next job
    expect((await w.db.query<{ ok: boolean }>(`select public.ledger_is_balanced() as ok`)).rows[0].ok).toBe(true);

    // next job pays the balance down; payable_now never goes negative
    const b2 = await w.completed(2000, 500);
    await pay(w, b2, { id: w.mechanic, role: 'mechanic' });
    await w.db.query(`update public.ledger_entries set at = now() - interval '4 days'`);
    await w.db.query(`select public.plan_payouts()`);
    const next = await w.db.query<{ amount: string }>(`select amount from public.payouts where status = 'planned'`);
    expect(next.rows).toHaveLength(1);
    expect(Number(next.rows[0].amount)).toBeGreaterThan(0);
    expect(Number(next.rows[0].amount)).toBeLessThan(2701.5); // reduced by the carried-forward refund
    void p1;
    await w.db.close();
  });
});

describe('ledger invariants', () => {
  it('balances to zero across 1,000 payments with refunds and payouts', async () => {
    const w = await world();
    // generate bookings and payments inside the database: this is about the money rules, not HTTP
    await w.db.exec(`
      do $$
      declare
        i int; b uuid; p uuid; r uuid; labour numeric; parts numeric; w_id uuid; owner uuid; cust uuid; veh uuid; svc uuid;
      begin
        select id, owner_id into w_id, owner from public.workshops where name = 'Anna Nagar Auto';
        select id into svc from public.services limit 1;
        select id into cust from public.profiles where full_name = 'Asha Customer';
        select id into veh from public.vehicles limit 1;
        for i in 1..1000 loop
          labour := 500 + (i * 37) % 4000;
          parts  := (i * 53) % 1500;
          insert into public.bookings (customer_id, vehicle_id, service_id, workshop_id, status, mode,
                                       pickup_lat, pickup_lng, quote_low, quote_high, labour_amount,
                                       parts_amount, final_price, completed_at)
          values (cust, veh, svc, w_id, 'completed', 'workshop', 13.09, 80.21, 100, 100000, labour, parts,
                  round((labour + parts) * 1.18, 2), now() - interval '5 days')
          returning id into b;
          insert into public.payments (booking_id, amount, method, status, reference, utr, submitted_at)
          values (b, round((labour + parts) * 1.18, 2), 'upi_link', 'pending_verification', 'BK-' || i,
                  lpad(i::text, 12, '0'), now() - interval '5 days')
          returning id into p;
          perform public.transition_booking(b, 'payment_pending_verification', cust, 'customer');
          perform public.confirm_payment(p, owner, 'mechanic');
          if i % 7 = 0 then
            select (public.create_refund(b, round(((labour + parts) * 1.18) / 3, 2), 'partial', owner)).id into r;
            perform public.complete_refund(r, owner, 'REF-' || i);
          end if;
        end loop;
      end $$;
    `);
    await w.db.query(`update public.ledger_entries set at = now() - interval '5 days'`);
    await w.db.query(`select public.plan_payouts()`);
    const po = await w.db.query<{ id: string }>(`select id from public.payouts where status = 'planned'`);
    for (const row of po.rows) {
      await w.db.query(`select * from public.mark_payout_paid($1,$2,'NEFT-ALL')`, [row.id, w.admin]);
    }

    const balanced = await w.db.query<{ ok: boolean }>(`select public.ledger_is_balanced() as ok`);
    expect(balanced.rows[0].ok).toBe(true);

    // every journal also balances on its own
    const bad = await w.db.query(
      `select journal_id from public.ledger_entries group by journal_id having sum(amount) <> 0`);
    expect(bad.rows).toHaveLength(0);

    // every confirmed (or refunded) payment has exactly one invoice
    const confirmed = await w.db.query<{ n: string }>(
      `select count(*)::text n from public.payments where status in ('confirmed','refunded')`);
    const invoiced = await w.db.query<{ n: string; d: string }>(
      `select count(*)::text n, count(distinct payment_id)::text d from public.invoices where series in ('INV','BOS')`);
    expect(Number(confirmed.rows[0].n)).toBe(1000);
    expect(Number(invoiced.rows[0].n)).toBe(1000);
    expect(Number(invoiced.rows[0].d)).toBe(1000);

    // 142 refunds -> 142 credit notes, numbered without gaps
    const cn = await w.db.query<{ n: string; mx: number }>(
      `select count(*)::text n, max(seq) mx from public.invoices where series = 'CN'`);
    expect(Number(cn.rows[0].n)).toBe(142);
    expect(cn.rows[0].mx).toBe(142);

    // after paying out everything payable, what the workshop is still owed is exactly the
    // payments inside the hold window (none here) so the balance is zero or the refund remainder
    const owed = Number((await w.db.query<{ b: string }>(
      `select public.workshop_balance($1) as b`, [w.workshop])).rows[0].b);
    expect(Math.abs(owed)).toBeLessThan(0.05);
    await w.db.close();
  }, 240000);
});
