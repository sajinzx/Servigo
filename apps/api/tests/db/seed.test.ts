import { readFileSync } from 'fs';
import path from 'path';
import { createDb } from './harness';

describe('seed.sql', () => {
  it('loads the catalogue and the 15 demo workshops with no ratings', async () => {
    const db = await createDb();
    await db.exec(readFileSync(path.resolve(__dirname, '../../../../supabase/seed.sql'), 'utf8'));

    const count = async (t: string) =>
      Number((await db.query<{ n: string }>(`select count(*)::text n from public.${t}`)).rows[0].n);

    expect(await count('services')).toBe(20);
    expect(await count('workshops')).toBe(15);
    expect(await count('workshop_services')).toBe(69);

    const rated = await db.query(
      'select 1 from public.workshops where rating_count <> 0 or rating_sum <> 0',
    );
    expect(rated.rows.length).toBe(0);

    // every seeded workshop got real coordinates inside India
    const bad = await db.query(
      'select 1 from public.workshops where lat not between 6 and 36 or lng not between 68 and 98',
    );
    expect(bad.rows.length).toBe(0);
    await db.close();
  });
});
