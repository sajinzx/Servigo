import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Config } from '../config';

/**
 * The service-role client bypasses RLS. It must only ever be created on the
 * server, and every route that uses it has to check the caller itself.
 */
export function createAdminClient(config: Config): SupabaseClient | null {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Db = SupabaseClient;

/** Throw the postgres error from a supabase-js response so errorHandler can map it. */
export function unwrap<T>(res: { data: T | null; error: { code?: string; message: string } | null }): T {
  if (res.error) {
    const err = new Error(res.error.message) as Error & { code?: string };
    err.code = res.error.code;
    throw err;
  }
  return res.data as T;
}
