#!/usr/bin/env node
/**
 * Create one admin and two mechanic accounts with random passwords, and link the mechanics
 * to existing demo workshops that have no owner. Passwords are printed once and written to
 * deploy-env/demo-logins.txt (git-ignored). Re-running reuses accounts and only prints
 * passwords for accounts it creates.
 *
 *   node scripts/create-demo-logins.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
try {
  for (const line of readFileSync(resolve(root, 'apps/api/.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const call = async (path, init = {}) => {
  const r = await fetch(url + path, { ...init, headers: { ...h, ...(init.headers ?? {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
};
const password = () => randomBytes(12).toString('base64url') + '9a!';

// with arguments: create one mechanic login for a named workshop
//   node scripts/create-demo-logins.mjs <email> "<workshop name>"
const [argEmail, argShop] = process.argv.slice(2);
const wanted = argEmail
  ? [{ email: argEmail, role: 'mechanic', name: argShop ?? 'Workshop owner', shop: argShop }]
  : [
      { email: 'admin@servigo.app', role: 'admin', name: 'ServiGo Admin' },
      { email: 'mechanic1@servigo.app', role: 'mechanic', name: 'Demo Mechanic One' },
      { email: 'mechanic2@servigo.app', role: 'mechanic', name: 'Demo Mechanic Two' },
    ];

const existing = (await call('/auth/v1/admin/users?per_page=200')).users ?? [];
const free = await call('/rest/v1/workshops?select=id,name&owner_id=is.null&is_demo=eq.true&order=name&limit=2');
let w = 0;
const lines = [];

for (const a of wanted) {
  let user = existing.find((u) => u.email === a.email);
  let pw = null;
  if (!user) {
    pw = password();
    user = await call('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: a.email, password: pw, email_confirm: true, user_metadata: { full_name: a.name } }),
    });
  }
  // the profile row is created by a trigger; set role and mark onboarding done (service role is trusted)
  await call(`/rest/v1/profiles?id=eq.${user.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ role: a.role, full_name: a.name, onboarded_at: new Date().toISOString() }),
  });
  let shop = '';
  if (a.role === 'mechanic') {
    const mine = await call(`/rest/v1/workshops?select=id,name&owner_id=eq.${user.id}`);
    if (mine.length) shop = mine[0].name;
    else if (a.shop) {
      const named = await call(`/rest/v1/workshops?select=id,name,owner_id&name=eq.${encodeURIComponent(a.shop)}`);
      if (!named.length) throw new Error(`no workshop named "${a.shop}"`);
      if (named[0].owner_id) throw new Error(`"${a.shop}" already has an owner`);
      await call(`/rest/v1/workshops?id=eq.${named[0].id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ owner_id: user.id }),
      });
      shop = named[0].name;
    } else if (free[w]) {
      await call(`/rest/v1/workshops?id=eq.${free[w].id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ owner_id: user.id }),
      });
      shop = free[w++].name;
    }
  }
  lines.push(`${a.role.padEnd(8)} ${a.email}  password: ${pw ?? '(already existed, unchanged)'}${shop ? `  workshop: ${shop}` : ''}`);
}

const out = lines.join('\n');
mkdirSync(resolve(root, 'deploy-env'), { recursive: true });
writeFileSync(resolve(root, 'deploy-env/demo-logins.txt'), out + '\n');
console.log(out);
