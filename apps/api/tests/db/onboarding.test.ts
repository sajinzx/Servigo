import type { PGlite } from '@electric-sql/pglite';
import { addUser, asUser, createDb } from './harness';

describe('customer onboarding', () => {
  let db: PGlite;
  let user: string;
  beforeEach(async () => {
    db = await createDb();
    user = await addUser(db, { name: 'Asha' });
  });
  afterEach(async () => {
    await db.close();
  });

  const complete = () =>
    asUser(db, user, async () => (await db.query<{ t: string | null }>(`select public.complete_onboarding() as t`)).rows[0].t);

  it('needs a verified phone, an address and a vehicle, in that order of checks', async () => {
    await expect(complete()).rejects.toThrow(/verify your phone/);

    await db.query(`update public.profiles set phone = '+919840012345', phone_verified = true where id = $1`, [user]);
    await expect(complete()).rejects.toThrow(/add an address/);

    await asUser(db, user, async () => {
      await db.query(
        `insert into public.addresses (user_id, line1, city, lat, lng) values ($1,'12 Main Rd','Chennai',13.08,80.27)`, [user]);
    });
    await expect(complete()).rejects.toThrow(/first vehicle/);

    const model = await db.query<{ id: string }>(
      `insert into public.vehicle_models (kind, make, model, segment) values ('car','Maruti','Swift','hatchback') returning id`);
    await asUser(db, user, async () => {
      await db.query(
        `insert into public.vehicles (owner_id, registration_no, model_id, year) values ($1,'TN09AB1234',$2,2019)`,
        [user, model.rows[0].id]);
    });
    const at = await complete();
    expect(at).not.toBeNull();

    // finishing again keeps the original timestamp
    const again = await complete();
    expect(new Date(again!).getTime()).toBe(new Date(at!).getTime());
  });

  it('cannot be faked by editing the profile directly', async () => {
    for (const set of [`onboarded_at = now()`, `phone_verified = true`, `phone = '+919800000000'`]) {
      await expect(
        asUser(db, user, async () => {
          await db.query(`update public.profiles set ${set} where id = $1`, [user]);
        }),
      ).rejects.toThrow(/set by verification/);
    }
    const r = await db.query<{ onboarded_at: string | null; phone_verified: boolean }>(
      `select onboarded_at, phone_verified from public.profiles where id = $1`, [user]);
    expect(r.rows[0]).toEqual({ onboarded_at: null, phone_verified: false });
  });

  it('still lets a customer edit their name and notification choice', async () => {
    await asUser(db, user, async () => {
      await db.query(`update public.profiles set full_name = 'Asha K', whatsapp_opt_in = true where id = $1`, [user]);
    });
    const r = await db.query<{ full_name: string; whatsapp_opt_in: boolean }>(
      `select full_name, whatsapp_opt_in from public.profiles where id = $1`, [user]);
    expect(r.rows[0]).toEqual({ full_name: 'Asha K', whatsapp_opt_in: true });
  });

  it('marks the phone verified only when Supabase Auth confirms it', async () => {
    await db.query(`update auth.users set phone = '919840012345' where id = $1`, [user]);
    let r = await db.query<{ phone: string; phone_verified: boolean }>(
      `select phone, phone_verified from public.profiles where id = $1`, [user]);
    expect(r.rows[0]).toEqual({ phone: '+919840012345', phone_verified: false });

    await db.query(`update auth.users set phone_confirmed_at = now() where id = $1`, [user]);
    r = await db.query(`select phone, phone_verified from public.profiles where id = $1`, [user]);
    expect(r.rows[0]).toEqual({ phone: '+919840012345', phone_verified: true });

    // changing the number un-verifies it until it is confirmed again
    await db.query(`update auth.users set phone = '919800011111', phone_confirmed_at = null where id = $1`, [user]);
    r = await db.query(`select phone, phone_verified from public.profiles where id = $1`, [user]);
    expect(r.rows[0]).toEqual({ phone: '+919800011111', phone_verified: false });
  });
});
