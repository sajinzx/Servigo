#!/usr/bin/env node
// Adds demo workshops so allocation, maps and the admin screens have something to work with.
//
//   node scripts/seed-extra-workshops.mjs            insert into the project in apps/api/.env (via the REST API)
//   node scripts/seed-extra-workshops.mjs --sql      write supabase/seed_extra_workshops.sql instead
//   node scripts/seed-extra-workshops.mjs --count 80 how many to make (default 60)
//
// Deterministic: the same arguments always produce the same workshops. Idempotent: a workshop whose
// name already exists is skipped. Every row is flagged is_demo = true, so a real pilot can switch
// them all off with one update. Phone numbers are left empty on purpose: invented numbers could
// belong to real people.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const COUNT = Number(args[args.indexOf('--count') + 1]) || 60;

// small deterministic generator (mulberry32)
let s = 20261016;
const rnd = () => {
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const jitter = (v, km, lat0) => v + ((rnd() - 0.5) * 2 * km) / (111 * (lat0 === undefined ? 1 : Math.cos((lat0 * Math.PI) / 180)));

// [name, city, lat, lng, weight]
const PLACES = [
  ['Anna Nagar', 'Chennai', 13.085, 80.2101, 3], ['T Nagar', 'Chennai', 13.0418, 80.2341, 3],
  ['Velachery', 'Chennai', 12.9815, 80.218, 3], ['Adyar', 'Chennai', 13.0012, 80.2565, 2],
  ['Guindy', 'Chennai', 13.0067, 80.2206, 2], ['Porur', 'Chennai', 13.0382, 80.1565, 2],
  ['Tambaram', 'Chennai', 12.9249, 80.1, 2], ['Mylapore', 'Chennai', 13.0368, 80.2676, 2],
  ['Kodambakkam', 'Chennai', 13.0521, 80.2255, 2], ['Perambur', 'Chennai', 13.1143, 80.2329, 2],
  ['Sholinganallur', 'Chennai', 12.901, 80.2279, 2], ['Vadapalani', 'Chennai', 13.05, 80.2121, 2],
  ['Ambattur', 'Chennai', 13.1143, 80.1548, 2], ['Chromepet', 'Chennai', 12.9516, 80.1462, 2],
  ['Nungambakkam', 'Chennai', 13.0569, 80.2425, 1], ['Egmore', 'Chennai', 13.0732, 80.2609, 1],
  ['Koramangala', 'Bangalore', 12.9352, 77.6245, 1], ['Indiranagar', 'Bangalore', 12.9784, 77.6408, 1],
  ['Whitefield', 'Bangalore', 12.9698, 77.75, 1], ['Jubilee Hills', 'Hyderabad', 17.4326, 78.4071, 1],
  ['Hitech City', 'Hyderabad', 17.4435, 78.3772, 1], ['Bandra', 'Mumbai', 19.0596, 72.8295, 1],
  ['Andheri', 'Mumbai', 19.1136, 72.8697, 1], ['Koregaon Park', 'Pune', 18.5362, 73.894, 1],
  ['RS Puram', 'Coimbatore', 11.0168, 76.9558, 1], ['Anna Nagar Madurai', 'Madurai', 9.9252, 78.1198, 1],
];
const WEIGHTED = PLACES.flatMap((p) => Array(p[4]).fill(p));

const KIND_NAMES = {
  car: ['Auto Care', 'Car Clinic', 'Motors', 'Car Works', 'Auto Hub', 'Garage'],
  bike: ['Bike Clinic', 'Two Wheeler Care', 'Bike Works', 'Bike Garage', 'Moto Fix', 'Cycle Motors'],
  both: ['Auto & Bike Care', 'Service Hub', 'Speed Fix', 'Garage', 'Motor Works', 'Quick Service'],
};

const CAR = ['CAR_001', 'CAR_002', 'CAR_003', 'CAR_004', 'CAR_005', 'CAR_006', 'CAR_007', 'CAR_008', 'CAR_009', 'CAR_010'];
const BIKE = ['BIKE_001', 'BIKE_002', 'BIKE_003', 'BIKE_004', 'BIKE_005', 'BIKE_006', 'BIKE_007', 'BIKE_008', 'BIKE_009', 'BIKE_010'];
// a workshop always offers the basics; the rest varies
const BASICS = { car: ['CAR_001', 'CAR_002'], bike: ['BIKE_001', 'BIKE_002'] };

const sample = (arr, n) => {
  const a = [...arr];
  const out = [];
  while (out.length < n && a.length) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]);
  return out;
};

const day = (open, close) => ({ open, close });
const HOURS = {
  standard: (days) => Object.fromEntries(days.map((d) => [d, ['09:00', '19:00']])),
  early: (days) => Object.fromEntries(days.map((d) => [d, ['07:30', '20:30']])),
  allday: (days) => Object.fromEntries(days.map((d) => [d, ['00:00', '23:59']])),
};
const WEEK6 = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEK7 = [...WEEK6, 'sun'];
void day;

function generate(count, existing) {
  const used = new Set(existing);
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 40) {
    const place = pick(WEEKED());
    const kinds = pick(['car', 'car', 'bike', 'bike', 'both', 'both', 'both']);
    const base = place[0];
    const name = `${base} ${pick(KIND_NAMES[kinds])}`;
    if (used.has(name)) continue;
    used.add(name);

    const vehicleKinds = kinds === 'both' ? ['car', 'bike'] : [kinds];
    const pool = kinds === 'both' ? [...CAR, ...BIKE] : kinds === 'car' ? CAR : BIKE;
    const services = new Set(vehicleKinds.flatMap((k) => BASICS[k]));
    for (const c of sample(pool, between(3, 8))) services.add(c);

    // a few shops are open around the clock so night bookings can match too
    const r = rnd();
    const open_hours =
      r < 0.12 ? HOURS.allday(WEEK7) : r < 0.5 ? HOURS.early(rnd() < 0.5 ? WEEK7 : WEEK6) : HOURS.standard(rnd() < 0.3 ? WEEK7 : WEEK6);

    out.push({
      name,
      city: place[1],
      lat: Number(jitter(place[2], 1.8, place[2]).toFixed(5)),
      lng: Number(jitter(place[3], 1.8, place[2]).toFixed(5)),
      staff_count: between(1, 8),
      vehicle_kinds: vehicleKinds,
      offers_doorstep: rnd() < 0.35,
      service_radius_km: between(5, 15),
      open_hours,
      gst_registered: rnd() < 0.7,
      address_line: `${between(1, 240)}, ${base} main road`,
      services: [...services].sort(),
    });
  }
  return out;
}
function WEEKED() {
  return WEIGHTED;
}

// ---- output ------------------------------------------------------------------------------------

const sqlStr = (v) => `'${String(v).replace(/'/g, "''")}'`;
function toSql(rows) {
  const lines = [
    '-- Extra demo workshops. GENERATED by scripts/seed-extra-workshops.mjs; do not edit by hand.',
    '-- Idempotent by name. Phone numbers are intentionally empty.',
    '',
    'with new_shops(name, city, address_line, lat, lng, staff_count, vehicle_kinds, offers_doorstep, service_radius_km, open_hours, gst_registered) as (values',
  ];
  lines.push(
    rows
      .map(
        (w) =>
          `  (${sqlStr(w.name)}, ${sqlStr(w.city)}, ${sqlStr(w.address_line)}, ${w.lat}, ${w.lng}, ${w.staff_count}, ` +
          `'{${w.vehicle_kinds.join(',')}}'::public.vehicle_kind[], ${w.offers_doorstep}, ${w.service_radius_km}, ` +
          `${sqlStr(JSON.stringify(w.open_hours))}::jsonb, ${w.gst_registered})`,
      )
      .join(',\n'),
  );
  lines.push(
    ')',
    'insert into public.workshops',
    '  (name, city, address_line, lat, lng, staff_count, vehicle_kinds, offers_doorstep, service_radius_km, open_hours, gst_registered, is_demo, stage, verified_at)',
    "select n.*, true, 'active', now() from new_shops n",
    ' where not exists (select 1 from public.workshops w where w.name = n.name);',
    '',
    'insert into public.workshop_services (workshop_id, service_id)',
    'select w.id, s.id from (values',
    rows.flatMap((w) => w.services.map((c) => `  (${sqlStr(w.name)}, ${sqlStr(c)})`)).join(',\n'),
    ') as x(wname, scode)',
    'join public.workshops w on w.name = x.wname and w.is_demo',
    'join public.services s on s.code = x.scode',
    'on conflict do nothing;',
    '',
  );
  return lines.join('\n');
}

async function insertViaRest(rows) {
  const envOf = (k) => (readFileSync(resolve(ROOT, 'apps/api/.env'), 'utf8').match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
  const url = envOf('SUPABASE_URL');
  const key = envOf('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in apps/api/.env');
  const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rest = async (path, init = {}) => {
    const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
    const t = await r.text();
    if (!r.ok) throw new Error(`${path}: ${r.status} ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : null;
  };

  const have = new Set((await rest('workshops?select=name&limit=5000')).map((w) => w.name));
  const fresh = rows.filter((w) => !have.has(w.name));
  const svc = Object.fromEntries((await rest('services?select=id,code')).map((x) => [x.code, x.id]));
  if (fresh.length === 0) return { inserted: 0, skipped: rows.length, links: 0 };

  const created = await rest('workshops', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(
      fresh.map(({ services, ...w }) => ({ ...w, is_demo: true, stage: 'active', verified_at: new Date().toISOString() })),
    ),
  });
  const idOf = Object.fromEntries(created.map((w) => [w.name, w.id]));
  const links = fresh.flatMap((w) => w.services.map((c) => ({ workshop_id: idOf[w.name], service_id: svc[c] })));
  await rest('workshop_services', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify(links),
  });
  return { inserted: created.length, skipped: rows.length - fresh.length, links: links.length };
}

// names already used by supabase/seed.sql; the generated names must not collide with them
const SEEDED = [
  'Anna Nagar Auto Care', 'T Nagar Motors', 'Velachery Bike Works', 'Adyar Quick Fix', 'Koramangala Car Clinic',
  'Indiranagar Garage', 'Bandra Auto Studio', 'Andheri Bike Hub', 'Koregaon Park Garage', 'Jubilee Hills Car Care',
  'Connaught Place Auto', 'Salt Lake Car Works', 'Alwarpet Bike Garage', 'Whitefield Auto Hub', 'Hitech City Car Electric',
];
const existingNames = SEEDED;
const rows = generate(COUNT, existingNames);

if (flag('--sql')) {
  const out = resolve(ROOT, 'supabase/seed_extra_workshops.sql');
  writeFileSync(out, toSql(rows), 'utf8');
  console.log(`wrote ${out} (${rows.length} workshops, ${rows.reduce((n, w) => n + w.services.length, 0)} service links)`);
} else {
  const r = await insertViaRest(rows);
  console.log(`inserted ${r.inserted} workshops (${r.skipped} already existed), ${r.links} service links`);
}
