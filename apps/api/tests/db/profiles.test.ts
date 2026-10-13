import type { PGlite } from '@electric-sql/pglite';
import { addUser, asUser, createDb } from './harness';

describe('profiles and RLS', () => {
  let db: PGlite;
  let alice: string;
  let bob: string;
  let admin: string;

  beforeAll(async () => {
    db = await createDb();
    alice = await addUser(db, { name: 'Alice' });
    bob = await addUser(db, { name: 'Bob' });
    admin = await addUser(db, { name: 'Root' });
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates a customer profile for every new auth user', async () => {
    const res = await db.query<{ role: string; full_name: string }>(
      'select role, full_name from public.profiles where id = $1',
      [alice],
    );
    expect(res.rows[0]).toEqual({ role: 'customer', full_name: 'Alice' });
  });

  it('lets a user read only their own profile', async () => {
    const rows = await asUser(db, alice, async () => {
      const r = await db.query<{ id: string }>('select id from public.profiles');
      return r.rows;
    });
    expect(rows.map((r) => r.id)).toEqual([alice]);
  });

  it('lets an admin read every profile', async () => {
    const rows = await asUser(db, admin, async () => {
      const r = await db.query('select id from public.profiles');
      return r.rows;
    });
    expect(rows.length).toBe(3);
  });

  it('lets a user update their own name', async () => {
    await asUser(db, alice, async () => {
      await db.query(`update public.profiles set full_name = 'Alice K' where id = $1`, [alice]);
    });
    const r = await db.query<{ full_name: string }>(
      'select full_name from public.profiles where id = $1',
      [alice],
    );
    expect(r.rows[0].full_name).toBe('Alice K');
  });

  it('does not let a user make themselves an admin', async () => {
    await expect(
      asUser(db, alice, async () => {
        await db.query(`update public.profiles set role = 'admin' where id = $1`, [alice]);
      }),
    ).rejects.toThrow(/role can only be changed/);
  });

  it('does not let a user edit someone else', async () => {
    await asUser(db, alice, async () => {
      await db.query(`update public.profiles set full_name = 'hacked' where id = $1`, [bob]);
    });
    const r = await db.query<{ full_name: string }>(
      'select full_name from public.profiles where id = $1',
      [bob],
    );
    expect(r.rows[0].full_name).toBe('Bob');
  });
});
