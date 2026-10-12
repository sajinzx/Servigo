import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

/**
 * Test harness: an in-process Postgres with a small stand-in for the parts of
 * Supabase our migrations rely on (auth schema, auth.uid(), the three API roles).
 * Migrations named *.postgis.sql need the PostGIS extension and are skipped here.
 */
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../supabase/migrations');

const SUPABASE_SHIM = `
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  phone text,
  phone_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export async function createDb(opts: { upTo?: string } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.postgis.sql'))
    .sort();
  for (const file of files) {
    if (opts.upTo && file > opts.upTo) break;
    try {
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    } catch (e) {
      throw new Error(`migration ${file} failed: ${(e as Error).message}`);
    }
  }
  return db;
}

/** Run a callback as a signed-in Supabase user (RLS applies). */
export async function asUser<T>(
  db: PGlite,
  userId: string,
  fn: () => Promise<T>,
  role: 'authenticated' | 'service_role' | 'anon' = 'authenticated',
): Promise<T> {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${userId}', false);
                 select set_config('request.jwt.claim.role', '${role}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);
                   select set_config('request.jwt.claim.role', '', false);`);
  }
}

export async function addUser(
  db: PGlite,
  opts: { name?: string; phone?: string; email?: string } = {},
): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into auth.users (email, phone, raw_user_meta_data)
     values ($1, $2, $3::jsonb) returning id`,
    [opts.email ?? null, opts.phone ?? null, JSON.stringify({ full_name: opts.name ?? 'Test User' })],
  );
  return res.rows[0].id;
}
