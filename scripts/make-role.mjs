#!/usr/bin/env node
/**
 * Promote an existing account to mechanic or admin.
 *
 *   node scripts/make-role.mjs <email> admin
 *   node scripts/make-role.mjs <email> mechanic "<workshop name>"
 *
 * The person must have signed up first (so they have a password they chose). This script
 * never creates credentials. It reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
 * apps/api/.env or the environment, and writes through the same trusted path the database
 * uses for role changes.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
try {
  for (const line of readFileSync(resolve(root, 'apps/api/.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {
  /* env file is optional */
}

const [email, role, workshopName] = process.argv.slice(2);
if (!email || !['admin', 'mechanic', 'customer'].includes(role ?? '')) {
  console.error('usage: node scripts/make-role.mjs <email> <admin|mechanic|customer> ["workshop name"]');
  process.exit(2);
}
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(2);
}

const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const rest = async (path, init = {}) => {
  const r = await fetch(`${url}${path}`, { ...init, headers: { ...h, ...(init.headers ?? {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
};

// find the auth user by email
let user = null;
for (let page = 1; page <= 20 && !user; page++) {
  const res = await rest(`/auth/v1/admin/users?page=${page}&per_page=200`);
  const list = res.users ?? [];
  user = list.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
  if (list.length < 200) break;
}
if (!user) {
  console.error(`No account for ${email}. Sign up on the site first, then run this again.`);
  process.exit(1);
}

await rest(`/rest/v1/profiles?id=eq.${user.id}`, {
  method: 'PATCH',
  headers: { Prefer: 'return=minimal' },
  body: JSON.stringify({ role }),
});
console.log(`${email} is now ${role}`);

if (role === 'mechanic' && workshopName) {
  const found = await rest(`/rest/v1/workshops?name=eq.${encodeURIComponent(workshopName)}&select=id,owner_id`);
  if (!found.length) {
    console.error(`No workshop named "${workshopName}". Role was set; no workshop linked.`);
    process.exit(1);
  }
  await rest(`/rest/v1/workshops?id=eq.${found[0].id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ owner_id: user.id }),
  });
  console.log(`linked to workshop "${workshopName}"`);
}
