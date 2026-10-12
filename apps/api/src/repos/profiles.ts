import type { Db } from '../db/supabase';
import { unwrap } from '../db/supabase';
import type { Role } from '../auth/types';
import type { ProfileRepo, Profile } from '../routes/me';

const COLUMNS = 'id, role, full_name, phone, phone_verified, whatsapp_opt_in, onboarded_at';

export function supabaseProfiles(db: Db): ProfileRepo & { roleOf(id: string): Promise<Role | null> } {
  return {
    async get(id) {
      const res = await db.from('profiles').select(COLUMNS).eq('id', id).maybeSingle();
      return unwrap(res) as Profile | null;
    },
    async update(id, patch) {
      const res = await db.from('profiles').update(patch).eq('id', id).select(COLUMNS).single();
      return unwrap(res) as Profile;
    },
    async roleOf(id) {
      const res = await db.from('profiles').select('role').eq('id', id).maybeSingle();
      const row = unwrap(res) as { role: Role } | null;
      return row?.role ?? null;
    },
  };
}
