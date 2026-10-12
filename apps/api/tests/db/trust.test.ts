import type { PGlite } from '@electric-sql/pglite';
import { addUser, asUser, createDb } from './harness';

const ALWAYS_OPEN = JSON.stringify(
  Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, ['00:00', '23:59']])),
);

interface W {
  db: PGlite;
  admin: string;
  customer: string;
  service: string;
  vehicle: string;
  shop(name: string, o?: { stage?: string; lat?: number; lng?: number; staff?: number; phone?: string; ownerPhone?: string }): Promise<{ id: string; owner: string }>;
  book(): Promise<string>;
  candidates(bookingId: string): Promise<string[]>;
  strikes(workshop: string): Promise<number>;
  stage(workshop: string): Promise<string>;
}

async function world(): Promise<W> {
  const db = await createDb();
  const one = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
  const admin = await addUser(db, { name: 'Admin' });
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  const customer = await addUser(db, { name: 'Customer', phone: '+919800000001' });
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

  const shop: W['shop'] = async (name, o = {}) => {
    const owner = await addUser(db, { name: `${name} owner`, phone: o.ownerPhone });
    await db.query(`update public.profiles set role = 'mechanic' where id = $1`, [owner]);
    const id = await one(
      `insert into public.workshops (owner_id, name, phone, city, lat, lng, staff_count, open_hours, stage)
       values ($1,$2,$3,'Chennai',$4,$5,$6,$7::jsonb,$8::public.workshop_stage) returning id`,
      [owner, name, o.phone ?? null, o.lat ?? 13.09, o.lng ?? 80.21, o.staff ?? 3, ALWAYS_OPEN, o.stage ?? 'active'],
    );
    await db.query(`insert into public.workshop_services (workshop_id, service_id) values ($1,$2)`, [id, service]);
    return { id, owner };
  };
  const book = () =>
    one(`select id from public.create_booking($1,$2,$3,'workshop',13.09,80.21,null,null,2950,3500,180)`, [
      customer, vehicle, service,
    ]);
  const candidates = async (bookingId: string) =>
    (await db.query<{ workshop_id: string }>(`select workshop_id from public.find_candidates($1, 20)`, [bookingId]))
      .rows.map((r) => r.workshop_id);
  const strikes = async (workshop: string) =>
    (await db.query<{ n: number }>(`select public.active_strikes($1) as n`, [workshop])).rows[0].n;
  const stage = async (workshop: string) =>
    (await db.query<{ stage: string }>(`select stage from public.workshops where id = $1`, [workshop])).rows[0].stage;
  return { db, admin, customer, service, vehicle, shop, book, candidates, strikes, stage };
}

describe('who can receive offers', () => {
  let w: W;
  beforeEach(async () => {
    w = await world();
  });
  afterEach(async () => {
    await w.db.close();
  });

  it('never offers to an unverified, in-review or suspended workshop', async () => {
    const applied = await w.shop('Applied', { stage: 'applied' });
    const review = await w.shop('Review', { stage: 'review' });
    const suspended = await w.shop('Suspended', { stage: 'suspended' });
    const active = await w.shop('Active');
    const got = await w.candidates(await w.book());
    expect(got).toEqual([active.id]);
    expect(got).not.toContain(applied.id);
    expect(got).not.toContain(review.id);
    expect(got).not.toContain(suspended.id);
  });

  it('keeps probation workshops to 5 km', async () => {
    const near = await w.shop('Near probation', { stage: 'probation', lat: 13.1, lng: 80.21 }); // ~1 km
    const far = await w.shop('Far probation', { stage: 'probation', lat: 13.2, lng: 80.21 }); // ~12 km
    const got = await w.candidates(await w.book());
    expect(got).toContain(near.id);
    expect(got).not.toContain(far.id);
  });

  it('caps probation workshops at 2 accepted jobs a day', async () => {
    const p = await w.shop('Probation', { stage: 'probation', staff: 5 });
    for (let i = 0; i < 2; i++) {
      const b = await w.book();
      await w.db.query(`update public.bookings set workshop_id = $2 where id = $1`, [b, p.id]);
      const o = await w.db.query<{ id: string }>(
        `insert into public.offers (booking_id, workshop_id, score, rank, expires_at, response, responded_at)
         values ($1,$2,0.5,1, now() + interval '1 minute','accepted', now()) returning id`,
        [b, p.id],
      );
      expect(o.rows).toHaveLength(1);
    }
    const next = await w.book();
    expect(await w.candidates(next)).not.toContain(p.id);
  });

  it('promotes a probation workshop to active after 10 completed jobs', async () => {
    const p = await w.shop('Probation', { stage: 'probation', staff: 20 });
    for (let i = 0; i < 10; i++) {
      const b = await w.book();
      await w.db.query(`update public.bookings set workshop_id = $2, status = 'in_progress' where id = $1`, [b, p.id]);
      await w.db.query(`select * from public.complete_booking($1, null, 'admin', 500, 0)`, [b]);
      if (i < 9) expect(await w.stage(p.id)).toBe('probation');
    }
    expect(await w.stage(p.id)).toBe('active');
  });

  it('sends a workshop back to review when it moves', async () => {
    const s = await w.shop('Mover');
    await asUser(w.db, s.owner, async () => {
      await w.db.query(`update public.workshops set lat = 13.5 where id = $1`, [s.id]);
    });
    expect(await w.stage(s.id)).toBe('review');
  });

  it('does not let a workshop edit its own stage', async () => {
    const s = await w.shop('Cheat', { stage: 'review' });
    await expect(
      asUser(w.db, s.owner, async () => {
        await w.db.query(`update public.workshops set stage = 'active' where id = $1`, [s.id]);
      }),
    ).rejects.toThrow(/cannot be edited directly/);
  });
});

describe('application pipeline', () => {
  let w: W;
  let applicant: string;
  beforeEach(async () => {
    w = await world();
    applicant = await addUser(w.db, { name: 'Ravi', phone: '+919840000099' });
    await w.db.query(`update public.profiles set phone_verified = true where id = $1`, [applicant]);
  });
  afterEach(async () => {
    await w.db.close();
  });

  const apply = async (who = applicant) =>
    (
      await w.db.query<{ id: string }>(
        `select id from public.create_application($1,'Ravi Motors','Ravi','+919840000099','Chennai',13.05,80.22,
                                                    $2::uuid[],3,null)`,
        [who, `{${w.service}}`],
      )
    ).rows[0].id;

  const docs = async (app: string, kinds = ['owner_id', 'shop_photo_outside', 'shop_photo_bay', 'pan', 'upi']) => {
    for (const k of kinds) {
      await w.db.query(`select * from public.attach_document($1,$2,$3::public.document_kind,'path/'||$3,'N')`, [
        app, applicant, k,
      ]);
    }
  };

  it('needs a verified phone to apply', async () => {
    const stranger = await addUser(w.db, { name: 'No OTP' });
    await expect(apply(stranger)).rejects.toThrow(/verify your phone/);
  });

  it('allows one open application at a time', async () => {
    await apply();
    await expect(apply()).rejects.toThrow();
  });

  it('refuses review until the required documents are in', async () => {
    const app = await apply();
    await docs(app, ['owner_id', 'pan']);
    await expect(
      w.db.query(`select * from public.submit_for_review($1,$2)`, [app, applicant]),
    ).rejects.toThrow(/missing documents: shop_photo_outside, shop_photo_bay/);
  });

  it('refuses review while a blocking check is failing', async () => {
    const app = await apply();
    await docs(app);
    await w.db.query(`select public.record_kyc_check($1,'pan_format',false,true,'{}')`, [app]);
    await expect(
      w.db.query(`select * from public.submit_for_review($1,$2)`, [app, applicant]),
    ).rejects.toThrow(/checks failed: pan_format/);
    // a later passing result clears it
    await w.db.query(`select public.record_kyc_check($1,'pan_format',true,true,'{}')`, [app]);
    const r = await w.db.query<{ stage: string }>(`select * from public.submit_for_review($1,$2)`, [app, applicant]);
    expect(r.rows[0].stage).toBe('review');
  });

  it('approves into probation, grants the mechanic role and never skips review', async () => {
    const app = await apply();
    await expect(
      w.db.query(`select * from public.approve_application($1,$2)`, [app, w.admin]),
    ).rejects.toThrow(/in review/);

    await docs(app);
    await w.db.query(`select * from public.submit_for_review($1,$2)`, [app, applicant]);
    const ws = await w.db.query<{ id: string; stage: string; owner_id: string }>(
      `select * from public.approve_application($1,$2)`, [app, w.admin]);
    expect(ws.rows[0].stage).toBe('probation');
    expect(ws.rows[0].owner_id).toBe(applicant);

    const role = await w.db.query<{ role: string }>('select role from public.profiles where id = $1', [applicant]);
    expect(role.rows[0].role).toBe('mechanic');
    const svc = await w.db.query('select 1 from public.workshop_services where workshop_id = $1', [ws.rows[0].id]);
    expect(svc.rows).toHaveLength(1);
  });

  it('needs a reason to reject', async () => {
    const app = await apply();
    await expect(
      w.db.query(`select * from public.reject_application($1,$2,'')`, [app, w.admin]),
    ).rejects.toThrow(/reason is required/);
    await w.db.query(`select * from public.reject_application($1,$2,'photos do not match the map pin')`, [app, w.admin]);
  });

  it('finds a duplicate phone across applications', async () => {
    const a = await apply();
    const other = await addUser(w.db, { name: 'Other', phone: '+919840000055' });
    await w.db.query(`update public.profiles set phone_verified = true where id = $1`, [other]);
    const b = (
      await w.db.query<{ id: string }>(
        `select id from public.create_application($1,'Copy Shop','Other','+919840000099','Chennai',13.0,80.2,'{}',2,null)`,
        [other],
      )
    ).rows[0].id;
    const dup = await w.db.query<{ reason: string; other_application: string }>(
      `select * from public.find_duplicate_applicants($1)`, [b]);
    expect(dup.rows).toEqual([{ reason: 'same phone', other_application: a }]);
  });

  it('keeps payout ciphertext away from clients', async () => {
    const app = await apply();
    await w.db.query(
      `insert into public.payout_accounts (application_id, kind, ciphertext, fingerprint, last4)
       values ($1,'upi','ciphertext','fp','1234')`, [app]);
    const rows = await asUser(w.db, applicant, async () => {
      try {
        return (await w.db.query('select * from public.payout_accounts')).rows;
      } catch {
        return 'denied';
      }
    });
    expect(rows === 'denied' || (Array.isArray(rows) && rows.length === 0)).toBe(true);
  });

  it('shows an applicant only their own application', async () => {
    await apply();
    const mine = await asUser(w.db, applicant, async () =>
      (await w.db.query('select id from public.workshop_applications')).rows);
    expect(mine).toHaveLength(1);
    const theirs = await asUser(w.db, w.customer, async () =>
      (await w.db.query('select id from public.workshop_applications')).rows);
    expect(theirs).toHaveLength(0);
  });
});

describe('trust and safety rules', () => {
  let w: W;
  beforeEach(async () => {
    w = await world();
  });
  afterEach(async () => {
    await w.db.close();
  });

  const strike = (ws: string, kind = 'overcharge') =>
    w.db.query(`select * from public.add_strike($1,null,null,$2,$3,'test')`, [ws, kind, w.admin]);

  it('suspends a workshop at 3 strikes in 90 days', async () => {
    const s = await w.shop('Risky');
    await strike(s.id);
    await strike(s.id);
    expect(await w.stage(s.id)).toBe('active');
    await strike(s.id);
    expect(await w.stage(s.id)).toBe('suspended');
    const log = await w.db.query<{ action: string }>(
      `select action from public.ts_actions where workshop_id = $1 order by id`, [s.id]);
    expect(log.rows.map((r) => r.action)).toContain('suspend_workshop');
  });

  it('does not count strikes older than 90 days', async () => {
    const s = await w.shop('Reformed');
    await strike(s.id);
    await strike(s.id);
    await w.db.query(
      `update public.strikes set created_at = now() - interval '100 days', expires_at = now() - interval '10 days'
        where id = (select id from public.strikes where workshop_id = $1 limit 1)`, [s.id]);
    await strike(s.id);
    expect(await w.strikes(s.id)).toBe(2);
    expect(await w.stage(s.id)).toBe('active');
  });

  it('lets a workshop appeal once and an accepted appeal removes the strike', async () => {
    const s = await w.shop('Appeals');
    const st = await w.db.query<{ id: string }>(
      `select id from public.add_strike($1,null,null,'overcharge',$2,'x')`, [s.id, w.admin]);
    const id = st.rows[0].id;
    await w.db.query(`select * from public.appeal_strike($1,$2,'quote was approved by the customer')`, [id, s.owner]);
    await expect(
      w.db.query(`select * from public.appeal_strike($1,$2,'again')`, [id, s.owner]),
    ).rejects.toThrow(/cannot be appealed/);
    await w.db.query(`select * from public.decide_appeal($1,$2,true,'evidence checked')`, [id, w.admin]);
    expect(await w.strikes(s.id)).toBe(0);
  });

  it("does not let another workshop appeal someone else's strike", async () => {
    const a = await w.shop('A');
    const b = await w.shop('B');
    const st = await w.db.query<{ id: string }>(
      `select id from public.add_strike($1,null,null,'overcharge',$2,'x')`, [a.id, w.admin]);
    await expect(
      w.db.query(`select * from public.appeal_strike($1,$2,'mine')`, [st.rows[0].id, b.owner]),
    ).rejects.toThrow(/cannot be appealed/);
  });

  it('strikes a no-show and re-matches the customer to a different workshop', async () => {
    const first = await w.shop('Flaky', { lat: 13.09 });
    const backup = await w.shop('Backup', { lat: 13.12 });
    const b = await w.book();
    await w.db.query(`update public.bookings set workshop_id = $2 where id = $1`, [b, first.id]);
    await w.db.query(`select public.transition_booking($1,'offered',null,'system')`, [b]);
    await w.db.query(`insert into public.offers (booking_id, workshop_id, score, rank, expires_at, response, responded_at)
                      values ($1,$2,0.9,1, now(), 'accepted', now())`, [b, first.id]);
    await w.db.query(`select public.transition_booking($1,'accepted',$2,'mechanic')`, [b, first.owner]);
    await w.db.query(`update public.bookings set scheduled_for = now() - interval '2 hours' where id = $1`, [b]);

    const n = await w.db.query<{ n: number }>(`select public.process_no_shows() as n`);
    expect(n.rows[0].n).toBe(1);
    expect(await w.strikes(first.id)).toBe(1);

    const st = await w.db.query<{ status: string }>(`select status from public.bookings where id = $1`, [b]);
    expect(st.rows[0].status).toBe('matching');
    const queued = await w.db.query(
      `select 1 from public.outbox where event_type = 'dispatch.booking' and idempotency_key like $1`,
      [`booking:${b}:noshow:%`]);
    expect(queued.rows).toHaveLength(1);
    expect(await w.candidates(b)).toEqual([backup.id]);
  });

  it('leaves a job alone that has not run late', async () => {
    const s = await w.shop('OnTime');
    const b = await w.book();
    await w.db.query(`update public.bookings set workshop_id = $2 where id = $1`, [b, s.id]);
    await w.db.query(`select public.transition_booking($1,'offered',null,'system')`, [b]);
    await w.db.query(`select public.transition_booking($1,'accepted',$2,'mechanic')`, [b, s.owner]);
    await w.db.query(`update public.bookings set scheduled_for = now() + interval '1 hour' where id = $1`, [b]);
    const n = await w.db.query<{ n: number }>(`select public.process_no_shows() as n`);
    expect(n.rows[0].n).toBe(0);
  });

  it('freezes a booking on a safety report until an admin resolves it', async () => {
    const s = await w.shop('Unsafe');
    const b = await w.book();
    await w.db.query(`update public.bookings set workshop_id = $2 where id = $1`, [b, s.id]);
    await w.db.query(`select public.transition_booking($1,'offered',null,'system')`, [b]);
    await w.db.query(`select public.transition_booking($1,'accepted',$2,'mechanic')`, [b, s.owner]);
    await w.db.query(`select public.transition_booking($1,'in_progress',$2,'mechanic')`, [b, s.owner]);

    const inc = await w.db.query<{ id: string }>(
      `select id from public.report_incident($1,$2,'safety','brakes failed after service','[]')`, [b, w.customer]);
    await expect(
      w.db.query(`select * from public.complete_booking($1,$2,'mechanic',100,0)`, [b, s.owner]),
    ).rejects.toThrow(/frozen/);

    await w.db.query(`select * from public.resolve_incident($1,$2,true,'workshop at fault')`, [inc.rows[0].id, w.admin]);
    expect(await w.strikes(s.id)).toBe(1);
    await w.db.query(`select * from public.complete_booking($1,$2,'mechanic',100,0)`, [b, s.owner]);
  });

  it('strikes on the first off-platform report and suspends on the second', async () => {
    const s = await w.shop('Offline');
    const make = async () => {
      const b = await w.book();
      await w.db.query(`update public.bookings set workshop_id = $2 where id = $1`, [b, s.id]);
      return b;
    };
    await w.db.query(`select * from public.report_incident($1,$2,'off_platform','asked for cash','[]')`, [
      await make(), w.customer]);
    expect(await w.strikes(s.id)).toBe(1);
    expect(await w.stage(s.id)).toBe('active');
    await w.db.query(`select * from public.report_incident($1,$2,'off_platform','asked again','[]')`, [
      await make(), w.customer]);
    expect(await w.stage(s.id)).toBe('suspended');
  });

  it('hides a review from an account linked to the workshop and strikes it', async () => {
    // the shop's listed phone is the reviewer's own number
    const s = await w.shop('Self promoter', { phone: '+919800000001' });
    const b = await w.book();
    await w.db.query(`update public.bookings set workshop_id = $2, status = 'paid' where id = $1`, [b, s.id]);
    await w.db.query(`select * from public.submit_review($1,$2,5,'best shop ever')`, [b, w.customer]);

    const r = await w.db.query<{ hidden: boolean }>(`select hidden from public.reviews where booking_id = $1`, [b]);
    expect(r.rows[0].hidden).toBe(true);
    const shop = await w.db.query<{ rating_sum: number; rating_count: number }>(
      `select rating_sum, rating_count from public.workshops where id = $1`, [s.id]);
    expect(shop.rows[0]).toEqual({ rating_sum: 0, rating_count: 0 });
    expect(await w.strikes(s.id)).toBe(1);
  });

  it('flags and clears the acceptance floor', async () => {
    const s = await w.shop('Picky');
    const offer = async (response: string) => {
      const b = await w.book();
      await w.db.query(
        `insert into public.offers (booking_id, workshop_id, score, rank, expires_at, response, responded_at)
         values ($1,$2,0.5,1, now(), $3::public.offer_response, now())`, [b, s.id, response]);
      await w.db.query(`update public.bookings set status = 'cancelled' where id = $1`, [b]);
    };
    for (let i = 0; i < 20; i++) await offer(i < 5 ? 'accepted' : 'rejected'); // 25%
    await w.db.query(`select public.refresh_acceptance_floor()`);
    const low = await w.db.query<{ low_acceptance: boolean }>(
      `select low_acceptance from public.workshops where id = $1`, [s.id]);
    expect(low.rows[0].low_acceptance).toBe(true);

    await w.db.query(`update public.offers set offered_at = now() - interval '1 day' where workshop_id = $1`, [s.id]);
    for (let i = 0; i < 20; i++) await offer('accepted');
    await w.db.query(`select public.refresh_acceptance_floor()`);
    const ok = await w.db.query<{ low_acceptance: boolean }>(
      `select low_acceptance from public.workshops where id = $1`, [s.id]);
    expect(ok.rows[0].low_acceptance).toBe(false);
  });

  it('requires prepayment after two customer no-show strikes', async () => {
    const q = async () =>
      (await w.db.query<{ r: boolean }>(`select public.customer_requires_prepayment($1) as r`, [w.customer])).rows[0].r;
    expect(await q()).toBe(false);
    for (let i = 0; i < 2; i++) {
      await w.db.query(`select * from public.add_strike(null,$1,null,'no_show',null,'did not turn up')`, [w.customer]);
    }
    expect(await q()).toBe(true);
  });

  it('upholds a dispute: refund, strike, refunded booking', async () => {
    const s = await w.shop('Overcharger');
    const b = await w.book();
    await w.db.query(`update public.bookings set workshop_id = $2, status = 'paid', final_price = 4000, completed_at = now() where id = $1`, [b, s.id]);
    const d = await w.db.query<{ id: string }>(
      `select id from public.open_dispute($1,$2,'charged for parts never fitted','[]')`, [b, w.customer]);
    const r = await w.db.query<{ status: string; refund_amount: string }>(
      `select * from public.resolve_dispute($1,$2,'upheld',1500,'parts not replaced')`, [d.rows[0].id, w.admin]);
    expect(r.rows[0].status).toBe('upheld');
    expect(Number(r.rows[0].refund_amount)).toBe(1500);
    const st = await w.db.query<{ status: string }>(`select status from public.bookings where id = $1`, [b]);
    expect(st.rows[0].status).toBe('refunded');
    expect(await w.strikes(s.id)).toBe(1);
  });

  it('puts a booking back where it was when a dispute is rejected', async () => {
    const s = await w.shop('Honest');
    const b = await w.book();
    await w.db.query(`update public.bookings set workshop_id = $2, status = 'completed', labour_amount = 2542.37,
              final_price = 3000, completed_at = now() where id = $1`, [b, s.id]);
    const d = await w.db.query<{ id: string }>(
      `select id from public.open_dispute($1,$2,'not happy','[]')`, [b, w.customer]);
    await w.db.query(`select * from public.resolve_dispute($1,$2,'rejected',0,'work was fine')`, [d.rows[0].id, w.admin]);
    const st = await w.db.query<{ status: string }>(`select status from public.bookings where id = $1`, [b]);
    expect(st.rows[0].status).toBe('completed');
    expect(await w.strikes(s.id)).toBe(0);
  });

  it('closes the dispute window after 72 hours', async () => {
    const s = await w.shop('Old job');
    const b = await w.book();
    await w.db.query(
      `update public.bookings set workshop_id = $2, status = 'paid', final_price = 3000,
              completed_at = now() - interval '80 hours' where id = $1`, [b, s.id]);
    await expect(
      w.db.query(`select * from public.open_dispute($1,$2,'late','[]')`, [b, w.customer]),
    ).rejects.toThrow(/72 hour/);
  });
});
